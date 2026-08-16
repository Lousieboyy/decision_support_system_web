import {
  toDate, mean, median, percentile, canonicalizeCategory, deriveZone,
  stageDurations, endToEndDays, buildFunnel, buildComposition, STAGES,
  deriveDepartmentOptions,
} from './analyticsMetrics';
import { gradeFor, SPI_WEIGHTS, UCI_WEIGHTS, SLA_TARGET_DAYS, SLA_END_TO_END_DAYS } from './analyticsConstants';

const DAY = 86400000;
const base = new Date('2026-01-01T00:00:00.000Z').getTime();
const at = (days) => new Date(base + days * DAY).toISOString();

/** A well-formed resolved report whose seven stages are contiguous. */
const wellFormed = (overrides = {}) => ({
  id: 1,
  status: 'Resolved',
  timestamp: at(0),
  reviewed_at: at(1),
  in_process_at: at(2),
  dispatched_at: at(2),      // no rework
  claimed_at: at(3),
  in_maintenance_at: at(4),
  completion_submitted_at: at(6),
  resolved_at: at(7),
  ...overrides,
});

describe('analyticsMetrics', () => {
  describe('the additivity identity', () => {
    it('sums the seven stages to exactly the end-to-end duration', () => {
      const r = wellFormed();
      const { durations } = stageDurations(r);
      const total = STAGES.reduce((s, st) => s + durations[st.key], 0);
      expect(total).to.be.closeTo(endToEndDays(r), 1e-9);
      expect(total).to.be.closeTo(7, 1e-9);
    });

    it('still holds when each boundary is perturbed', () => {
      const boundaries = [
        'reviewed_at', 'in_process_at', 'dispatched_at',
        'claimed_at', 'in_maintenance_at', 'completion_submitted_at',
      ];
      boundaries.forEach((field, i) => {
        const r = wellFormed({ [field]: at(1 + i * 0.9 + 0.13) });
        const { durations, nonMonotonic } = stageDurations(r);
        if (nonMonotonic > 0) return; // clamping intentionally breaks the identity
        const total = STAGES.reduce((s, st) => s + durations[st.key], 0);
        expect(total, `perturbing ${field}`).to.be.closeTo(endToEndDays(r), 1e-9);
      });
    });

    it('captures abandoned cycles in the rework stage', () => {
      // First dispatched at day 2, bounced, re-dispatched at day 5. The later
      // stages describe only the final cycle, so they are compressed into the
      // remaining two days.
      const r = wellFormed({
        dispatched_at: at(5),
        claimed_at: at(6),
        in_maintenance_at: at(6.5),
        completion_submitted_at: at(6.8),
        resolved_at: at(7),
        release_count: 1,
      });
      const { durations, nonMonotonic } = stageDurations(r);
      expect(nonMonotonic).to.equal(0);
      expect(durations.rework).to.be.closeTo(3, 1e-9);
      const total = STAGES.reduce((s, st) => s + durations[st.key], 0);
      expect(total).to.be.closeTo(endToEndDays(r), 1e-9);
      expect(total).to.be.closeTo(7, 1e-9);
    });
  });

  describe('null handling', () => {
    it('yields null, not zero, for a stage not yet reached', () => {
      const { durations } = stageDurations(wellFormed({ claimed_at: null, in_maintenance_at: null, completion_submitted_at: null, resolved_at: null, status: 'In Process' }));
      expect(durations.poolWait).to.equal(null);
      expect(durations.mobilise).to.equal(null);
    });

    it('excludes unreached stages from n', () => {
      const reports = [wellFormed({ id: 1 }), wellFormed({ id: 2, claimed_at: null, status: 'In Process' })];
      const funnel = buildFunnel(reports, { minN: 1 });
      expect(funnel.stages.find((s) => s.key === 'triage').n).to.equal(2);
      expect(funnel.stages.find((s) => s.key === 'poolWait').n).to.equal(1);
    });
  });

  describe('data quality', () => {
    it('clamps inverted timestamps and counts them', () => {
      // The legacy /assign path could leave in_process_at after dispatched_at.
      const { durations, nonMonotonic } = stageDurations(wellFormed({ in_process_at: at(4), dispatched_at: at(2) }));
      expect(durations.rework).to.equal(0);
      expect(nonMonotonic).to.equal(1);
    });

    it('excludes rejected reports from every stage', () => {
      const funnel = buildFunnel([wellFormed({ status: 'Rejected' })], { minN: 1 });
      funnel.stages.forEach((s) => expect(s.n, s.key).to.equal(0));
      expect(funnel.eligibleCount).to.equal(0);
    });
  });

  describe('statistics', () => {
    it('reports median, mean and p90 distinctly on skewed data', () => {
      const v = [1, 1, 1, 1, 100];
      expect(median(v)).to.equal(1);
      expect(mean(v)).to.be.closeTo(20.8, 1e-9);
      expect(percentile(v, 90)).to.be.closeTo(60.4, 1e-9);
    });

    it('handles single and empty samples', () => {
      expect(median([7])).to.equal(7);
      expect(median([])).to.equal(null);
      expect(mean([])).to.equal(null);
    });

    it('parses timestamps and rejects junk', () => {
      expect(toDate(null)).to.equal(null);
      expect(toDate('not-a-date')).to.equal(null);
      expect(toDate(at(1))).to.equal(base + DAY);
    });
  });

  describe('composition uses additive means', () => {
    it('sums segment shares to 1 and stage means to the mean total', () => {
      const comp = buildComposition([wellFormed({ id: 1 }), wellFormed({ id: 2, resolved_at: at(9), completion_submitted_at: at(8) })]);
      expect(comp.n).to.equal(2);
      const shareSum = comp.segments.reduce((s, x) => s + x.share, 0);
      expect(shareSum).to.be.closeTo(1, 1e-9);
      const meanSum = comp.segments.reduce((s, x) => s + x.meanDays, 0);
      expect(meanSum).to.be.closeTo(comp.meanTotalDays, 1e-9);
    });
  });

  describe('first-pass yield', () => {
    it('counts bounced reports against dispatched ones', () => {
      const funnel = buildFunnel([
        wellFormed({ id: 1, release_count: 0 }),
        wellFormed({ id: 2, release_count: 2 }),
        wellFormed({ id: 3, release_count: 0 }),
        wellFormed({ id: 4, release_count: 0 }),
      ], { minN: 1 });
      expect(funnel.dispatchedCount).to.equal(4);
      expect(funnel.bouncedCount).to.equal(1);
      expect(funnel.firstPassYield).to.equal(75);
    });
  });

  describe('deriveZone', () => {
    it('snaps coordinates to the nearest surveyed locality', () => {
      expect(deriveZone({ latitude: 2.1896, longitude: 102.2501 })).to.equal('Bandar Hilir');
      expect(deriveZone({ latitude: 2.2648, longitude: 102.2920 })).to.equal('Ayer Keroh');
      expect(deriveZone({ latitude: 2.3818, longitude: 102.2055 })).to.equal('Alor Gajah');
    });

    it('does not snap a distant report to the least-far zone', () => {
      expect(deriveZone({ latitude: 3.139, longitude: 101.6869 })).to.equal('Unmapped area'); // KL
    });

    it('falls back to a labelled postcode, never a bare string', () => {
      expect(deriveZone({ location: '75200, Melaka, Malaysia' })).to.equal('Postcode 75200');
      expect(deriveZone({})).to.equal('Unassigned');
    });
  });

  describe('canonicalizeCategory', () => {
    it('folds variants into the six groups', () => {
      expect(canonicalizeCategory('Road Damage')).to.equal('Road Damage');
      expect(canonicalizeCategory('pothole on Jalan X')).to.equal('Road Damage');
      expect(canonicalizeCategory('Street Lighting')).to.equal('Street Lighting');
      expect(canonicalizeCategory('Flooding')).to.equal('Drainage System');
      expect(canonicalizeCategory('Something else')).to.equal('Other Infrastructure');
    });
  });

  describe('the shared grading rubric', () => {
    it('grades on one scale and returns null when unmeasured', () => {
      expect(gradeFor(90).grade).to.equal('A');
      expect(gradeFor(89).grade).to.equal('B');
      expect(gradeFor(80).grade).to.equal('B');
      expect(gradeFor(79).grade).to.equal('C');
      expect(gradeFor(70).grade).to.equal('C');
      expect(gradeFor(69).grade).to.equal('D');
      expect(gradeFor(60).grade).to.equal('D');
      expect(gradeFor(59).grade).to.equal('F');
      expect(gradeFor(0).grade).to.equal('F');
      expect(gradeFor(null)).to.equal(null);
    });
  });

  describe('deriveDepartmentOptions', () => {
    it('surfaces authorities beyond the three that used to be hardcoded', () => {
      const opts = deriveDepartmentOptions([
        { assigned_department: 'MBMB' },
        { assigned_department: 'MBMB' },
        { assigned_department: 'JPS (Jabatan Pengairan dan Saliran Melaka)' },
        { assigned_department: 'IWK' },
      ]);
      const keys = opts.map((o) => o.key);
      expect(keys).to.include('JPS');
      expect(keys).to.include('IWK');
      expect(opts[0]).to.deep.include({ key: 'MBMB', count: 2 }); // busiest first
    });

    it('keeps an unrecognised department selectable rather than dropping it', () => {
      const opts = deriveDepartmentOptions([{ assigned_department: 'Some New Agency' }]);
      expect(opts).to.have.length(1);
      expect(opts[0].key).to.equal('Some New Agency');
    });

    it('ignores reports with no department', () => {
      expect(deriveDepartmentOptions([{ assigned_department: '' }, {}])).to.have.length(0);
      expect(deriveDepartmentOptions([])).to.have.length(0);
    });
  });

  describe('weight invariants', () => {
    const sum = (o) => Object.values(o).reduce((s, v) => s + v, 0);
    it('keeps index weights normalised and the stage budget balanced', () => {
      expect(sum(SPI_WEIGHTS)).to.be.closeTo(1, 1e-9);
      expect(sum(UCI_WEIGHTS)).to.be.closeTo(1, 1e-9);
      expect(sum(SLA_TARGET_DAYS)).to.be.closeTo(SLA_END_TO_END_DAYS, 1e-9);
    });
  });
});
