import { useState } from 'react';
import {
  AreaChart, Area, Line, ComposedChart, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend, BarChart, Bar, Cell, LabelList, ReferenceLine,
} from 'recharts';
import { Info, X, MapPin } from 'lucide-react';
import { format } from 'date-fns';
import {
  SPI_WEIGHTS, UCI_WEIGHTS, UCI_BURDEN_TARGETS, SLA_TARGET_DAYS,
  AGE_WEIGHT_DAYS, MIN_N_FOR_STAGE, MIN_N_FOR_SCORE, MIN_N_FOR_INDEX,
  IFI_WEIGHTS, REINCIDENCE, gradeFor, GRADE_SCALE, GRADE_COLOR,
} from '../utils/analyticsConstants';
import { fmtDuration } from '../utils/analyticsMetrics';

const HATCH = 'repeating-linear-gradient(135deg, rgba(31,30,26,.06) 0 6px, transparent 6px 12px)';

const scoreColor = (s) => {
  const grade = gradeFor(s);
  return grade ? GRADE_COLOR[grade.grade] : '#8a8477';
};

// Ascending order (Critical -> Optimal, left to right), each with its actual
// score range — GRADE_SCALE itself is stored highest-first for lookup.
const GRADE_SEGMENTS = [...GRADE_SCALE].reverse().map((g, i, arr) => ({
  ...g,
  start: g.min,
  end: i === arr.length - 1 ? 100 : arr[i + 1].min,
}));

// What to actually do at each grade tier — differs per band because "60"
// means something different when it's council speed vs. open-issue burden
// vs. zone-level structural fragility.
const BAND_ACTIONS = {
  spi: {
    A: 'Every step is beating its target — no action needed. If this holds, the targets may be worth tightening.',
    B: 'On track. Keep monitoring — no action needed right now.',
    C: 'Slipping in places. Check which category below is falling behind its own target.',
    D: 'Falling behind its own targets. Reassign capacity to the slowest step in the categories below.',
    F: 'Missing its own targets badly. Start with whichever category below is taking the longest — that\'s the step to fix first.',
  },
  uci: {
    A: 'Open issues are well within the agreed limits — no action needed.',
    B: 'Comfortably within limits. Keep monitoring.',
    C: 'Approaching the limit in places — check which category below is closest to its cap.',
    D: 'Over the agreed limit. This is a capacity question — consider more crew, not faster processing.',
    F: 'Far over the agreed limit, no matter how fast reports get resolved. Needs more capacity or budget, not process changes.',
  },
  ifi: {
    A: 'No zone is fragile by design — no action needed.',
    B: 'Holding up well. Keep an eye on the zone chart below for early signs.',
    C: 'Some zones are borderline — check the zone chart below for which one, and why.',
    D: "At least one zone keeps breaking. Its driving factor below — repairs not holding, recurring failures, or under-resourcing — points to a different fix.",
    F: 'Structurally weak zones present. The zone chart below names the driving factor — that determines what kind of fix is actually needed.',
  },
};

// "100 is good, but when does it become critical?" — the ladder answers
// that by drawing the whole scale, not just the one number landed on.
function GradeLadder({ value }) {
  const grade = gradeFor(value);
  return (
    <div className="w-full">
      <div className="relative">
        <div className="h-3 rounded-full overflow-hidden flex" style={{ background: '#f0ede4' }}>
          {GRADE_SEGMENTS.map((s) => (
            <div key={s.grade} style={{ width: `${s.end - s.start}%`, background: GRADE_COLOR[s.grade] }} />
          ))}
        </div>
        {value != null && (
          <div
            className="absolute top-1/2 rounded-full bg-white border-2"
            style={{
              left: `${Math.min(100, Math.max(0, value))}%`,
              width: 10,
              height: 10,
              borderColor: '#201f1b',
              transform: 'translate(-50%, -50%)',
              boxShadow: '0 1px 3px rgba(0,0,0,0.35)',
            }}
            title={`This score: ${value}`}
          />
        )}
      </div>
      <div className="flex flex-wrap gap-1 justify-center mt-2.5">
        {GRADE_SEGMENTS.map((s) => (
          <span
            key={s.grade}
            className="px-1.5 py-0.5 rounded text-[9px] font-bold whitespace-nowrap"
            style={
              grade?.grade === s.grade
                ? { background: GRADE_COLOR[s.grade], color: '#fff' }
                : { background: 'rgba(31,30,26,0.05)', color: GRADE_COLOR[s.grade] }
            }
          >
            {s.label} {s.end === 100 ? `${s.start}+` : `${s.start}–${s.end - 1}`}
          </span>
        ))}
      </div>
    </div>
  );
}

/** Radial gauge that degrades to an explicit unmeasured state. */
function IndexGauge({ value, label, caption, excludedCount, totalDomains, formula, onMethodology, actionsByGrade }) {
  const grade = gradeFor(value);
  const action = actionsByGrade && grade ? actionsByGrade[grade.grade] : null;
  return (
    <div className="content-card flex flex-col items-center justify-center py-8 px-6">
      <div
        className="cwi-gauge"
        style={{ '--gauge-pct': value ?? 0, '--gauge-color': scoreColor(value) }}
      >
        <div className="cwi-gauge-glow" />
        <div className="cwi-gauge-ring" />
        <div className="cwi-gauge-value">{value ?? '—'}</div>
        <div className="cwi-gauge-label">{label}</div>
      </div>
      {grade ? (
        <div className={`mt-5 text-2xl font-black cwi-grade-${grade.grade}`}>
          Grade {grade.grade}
          <span className="block text-[10px] font-bold tracking-wider uppercase text-[#8a8477] mt-0.5">
            {grade.label}
          </span>
        </div>
      ) : (
        <div className="mt-5 text-base font-bold text-[#8a8477]">Insufficient data</div>
      )}
      {/* Where does "critical" actually start? The full scale, not just the
          one number this happens to land on. */}
      <div className="mt-4 w-full">
        <GradeLadder value={value} />
      </div>
      {action && (
        <div
          className="mt-3 rounded-lg px-3 py-2 text-[11px] font-semibold leading-relaxed text-left w-full"
          style={{ background: grade ? `${GRADE_COLOR[grade.grade]}14` : 'rgba(31,30,26,0.05)', color: grade ? GRADE_COLOR[grade.grade] : '#8a8477' }}
        >
          {action}
        </div>
      )}
      <div className="mt-3 text-[10px] text-[#8a8477] text-center leading-relaxed">
        {caption}
        {excludedCount > 0 && (
          <div className="mt-1 font-semibold">
            {excludedCount} of {totalDomains} categories left out — not enough data
          </div>
        )}
      </div>
      {/* The number alone doesn't say how it was built — state the model in
          plain words right here, with a direct path to the exact weights,
          instead of leaving that only behind the small header button. */}
      {formula && (
        <div className="mt-3 pt-3 border-t border-[#1f1e1a]/8 w-full text-center">
          <p className="text-[10px] text-[#8a8477] leading-relaxed">{formula}</p>
          {onMethodology && (
            <button
              onClick={onMethodology}
              className="mt-1.5 text-[10px] font-bold underline decoration-dotted underline-offset-2 cursor-pointer"
              style={{ color: '#4a5d3f' }}
            >
              See the exact weights and math →
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** Score card whose box model is identical whether or not the score exists. */
function DomainCard({ name, score, weight, effectiveWeight, primary, secondary }) {
  const measured = score != null;
  // When another category is excluded for lacking data, this one silently
  // absorbs part of its share so the index still sums to 100% — the badge
  // used to keep showing the fixed nominal weight regardless, which didn't
  // match what the score above was actually built from.
  const showEffective =
    measured && effectiveWeight != null && Math.round(effectiveWeight * 100) !== Math.round(weight * 100);
  return (
    <div className="domain-card">
      <div className="flex items-center justify-between mb-1">
        <span className="text-[10px] font-extrabold text-[#8a8477] uppercase tracking-wider truncate pr-2 flex items-center gap-1.5">
          {name}
          {weight != null && (
            <span
              className="shrink-0 px-1 py-px rounded text-[9px] font-black normal-case tracking-normal"
              style={{ background: 'rgba(74,93,63,0.10)', color: '#4a5d3f' }}
              title={
                showEffective
                  ? `Normally ${Math.round(weight * 100)}% — temporarily counts for ${Math.round(effectiveWeight * 100)}% while another category is excluded for lacking data`
                  : 'How much this category counts toward the score above'
              }
            >
              {showEffective ? `${Math.round(weight * 100)}% → ${Math.round(effectiveWeight * 100)}%` : `${Math.round(weight * 100)}%`}
            </span>
          )}
        </span>
        <span className="text-lg font-black shrink-0" style={{ color: scoreColor(score) }}>
          {measured ? score : '—'}
        </span>
      </div>
      <div className="domain-score-bar">
        <div
          className="domain-score-fill"
          style={
            measured
              ? { width: `${score}%`, backgroundColor: scoreColor(score) }
              : { width: '100%', background: HATCH }
          }
        />
      </div>
      <div className="text-[10px] text-[#8a8477] font-medium mt-2 leading-snug">
        {measured ? primary : secondary}
      </div>
    </div>
  );
}

/** Renders the live weights and targets, read from the constants at runtime. */
function MethodologyPanel({ kind, onClose }) {
  const config = {
    spi: {
      title: 'Service Performance Index',
      subtitle: 'This measures the council. Every part of the score is something the council controls.',
      rows: Object.entries(SPI_WEIGHTS).map(([k, w]) => ({
        key: {
          triage: 'Triage', dispatch: 'Dispatch decision', poolWait: 'Pool wait',
          work: 'Work', verify: 'Verification', firstPass: 'Right First Time',
        }[k] || k,
        weight: w,
        detail: SLA_TARGET_DAYS[k] != null
          ? `Target: ${fmtDuration(SLA_TARGET_DAYS[k])}. Score is 100 if the typical (median) time is at or under the target; otherwise the score is lower, in proportion to how much slower it is.`
          : 'The percentage of dispatched reports that were not sent back to the assignment pool again.',
      })),
      footer: (
        <p>
          A step needs at least {MIN_N_FOR_STAGE} reports before it can be scored. The
          highest possible score is 100 — beating the target doesn't earn extra points. It
          just means the target should be reviewed.
        </p>
      ),
    },
    uci: {
      title: 'Urban Condition Index',
      subtitle: "This measures the city itself. It does not count how many reports get resolved, since that describes how fast the council works, not the actual condition of the city.",
      rows: Object.entries(UCI_WEIGHTS).map(([k, w]) => ({
        key: k,
        weight: w,
        detail: `Allowed limit: ${UCI_BURDEN_TARGETS[k]} open issues (issues open longer count for more). Score = 100 minus a percentage based on how far over that limit the current total is.`,
      })),
      footer: (
        <p>
          <strong className="text-[#c1613f]">Policy setting:</strong> the limits above are
          targets to agree on with the council — they are not measured facts. Each open
          issue counts as 1, plus 1 more for every {AGE_WEIGHT_DAYS} days it stays open.
        </p>
      ),
    },
    ifi: {
      title: 'Infrastructure Fragility Index',
      subtitle: "This measures each zone using its full history, not just what's open right now — the only score here that looks at the past this way. Neither Service Performance nor Urban Condition shows where infrastructure is weak because of how it was built, rather than by bad luck.",
      rows: Object.entries(IFI_WEIGHTS).map(([k, w]) => ({
        key: {
          reportRate: 'Report rate', failureRate: 'Failure rate', mtbf: 'Time between problems',
        }[k] || k,
        weight: w,
        detail: {
          reportRate: `Reports per 10,000 residents, compared with the city average. A score of 50 means it matches the average; 100 means it's twice the average.`,
          failureRate: `Percentage of resolved reports where a similar new report appeared again within ${REINCIDENCE.radiusM}m and ${REINCIDENCE.windowDays} days.`,
          mtbf: `Average number of days between problems in the zone, compared with the city average. Shorter gaps (problems happening more often) score worse.`,
        }[k],
      })),
      footer: (
        <>
          <p>
            <strong className="text-[#c1613f]">Population source:</strong> Department of
            Statistics Malaysia, district-level 2024 figures — not per-neighborhood figures.
            Zones in the same district share that district's population number, so the
            reports-per-resident figure is fair when comparing between districts, but less
            precise when comparing zones within the same district.
          </p>
          <p>
            A zone needs at least {MIN_N_FOR_INDEX} reports (its full history, not just open
            ones) before it can be scored. The city-wide figure is weighted by population
            across scored zones, so a small, fragile zone moves the city number less than a
            large, fragile one.
          </p>
        </>
      ),
    },
  }[kind];

  const { title, subtitle, rows, footer } = config;

  return (
    <div className="fixed inset-0 z-[300] flex items-center justify-center p-4 bg-black/40" onClick={onClose}>
      <div
        className="bg-white rounded-2xl max-w-2xl w-full p-6 max-h-[80vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between mb-4">
          <div>
            <h3 className="text-lg font-black text-[#201f1b]">{title}</h3>
            <p className="text-xs text-[#8a8477] mt-1">{subtitle}</p>
          </div>
          <button onClick={onClose} className="text-[#8a8477] hover:text-[#201f1b]">
            <X size={18} />
          </button>
        </div>

        <table className="w-full text-xs">
          <thead>
            <tr className="text-[#8a8477] uppercase text-[10px] tracking-wider">
              <th className="text-left pb-2">Category</th>
              <th className="text-right pb-2 w-16">Weight</th>
              <th className="text-left pb-2 pl-4">How it is scored</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key} className="border-t border-[#1f1e1a]/6">
                <td className="py-2 font-semibold text-[#201f1b]">{r.key}</td>
                <td className="py-2 text-right font-mono text-[#4b473d]">
                  {Math.round(r.weight * 100)}%
                </td>
                <td className="py-2 pl-4 text-[#4b473d]">{r.detail}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="mt-4 pt-4 border-t border-[#1f1e1a]/8 text-[11px] text-[#8a8477] space-y-2 leading-relaxed">
          <p>
            These weights come directly from the system's live settings, so this table
            always matches what is actually used — it can't fall out of date.
          </p>
          <p>
            If a category has no data, it is left out, and the other categories' weights are
            adjusted so they still add up to a full score. The gauge shows how many
            categories were left out, instead of guessing a score for them.
          </p>
          {footer}
        </div>
      </div>
    </div>
  );
}

function BandHeader({ title, subtitle, onMethodology }) {
  return (
    <div className="flex items-start justify-between gap-4 flex-wrap">
      <div>
        <h2 className="text-sm font-black text-[#201f1b] uppercase tracking-wider">{title}</h2>
        <p className="text-xs text-[#8a8477] mt-0.5 max-w-2xl">{subtitle}</p>
      </div>
      <button onClick={onMethodology} className="export-btn shrink-0">
        <Info size={13} /> Methodology
      </button>
    </div>
  );
}

/**
 * City Health, split into the two things it previously conflated.
 *
 * The old composite scored the council's ticket throughput and labelled the
 * result city condition, so a council closing tickets fast scored well even as
 * defects accumulated. Band A now measures the council; Band B measures the
 * city.
 */
export function CityHealthBands({ servicePerformance, urbanCondition, infrastructureFragility, backlogFlow, reportCount, activeBand, onBandChange, onZoneClick, onWeekClick }) {
  const [methodology, setMethodology] = useState(null);

  const spiDomains = Object.values(servicePerformance.domains);
  const uciDomains = Object.values(urbanCondition.domains);
  // Returns each included category's real, rescaled share of the score —
  // null for an excluded one, since its usual weight isn't being used at all
  // right now. Kept separate from the nominal SPI_WEIGHTS/UCI_WEIGHTS table
  // so the "how it's scored" methodology panel still documents the normal,
  // undiluted split.
  const effectiveWeights = (weights, excluded) => {
    const excludedSet = new Set(excluded);
    const weightSum = Object.entries(weights)
      .filter(([k]) => !excludedSet.has(k))
      .reduce((s, [, w]) => s + w, 0);
    return (key) => (weightSum > 0 && !excludedSet.has(key) ? weights[key] / weightSum : null);
  };
  const spiEffectiveWeight = effectiveWeights(SPI_WEIGHTS, servicePerformance.excluded);
  const uciEffectiveWeight = effectiveWeights(UCI_WEIGHTS, urbanCondition.excluded);
  const ifiZones = Object.values(infrastructureFragility.domains)
    .filter((d) => d.score != null)
    .sort((a, b) => a.score - b.score);
  const ifiUnscored = Object.keys(infrastructureFragility.domains).length - ifiZones.length;
  // Unscored zones still carry a real reportCount (just under MIN_N_FOR_INDEX)
  // — surfacing the closest ones turns "not enough data" into "here's what's
  // coming next" instead of a dead end.
  const ifiCloseToQualifying = Object.values(infrastructureFragility.domains)
    .filter((d) => d.score == null)
    .sort((a, b) => b.reportCount - a.reportCount)
    .slice(0, 4);

  // A bare score doesn't say why — put the short version of the driving
  // factor right on the label, matching the two zone charts on this tab.
  const IFI_DRIVER_SHORT = { reportRate: 'report rate', failureRate: 'failure rate', mtbf: 'recurrence' };
  const IfiScoreLabel = (props) => {
    const { x, y, width, height, index } = props;
    const z = ifiZones[index];
    if (!z) return null;
    return (
      <text x={x + width + 6} y={y + height / 2} dy={3.5} fontSize={10} fontWeight={700} fill="#4b473d">
        {z.score}{z.driver ? ` · ${IFI_DRIVER_SHORT[z.driver]}` : ''}
      </text>
    );
  };

  const MS_PER_DAY = 24 * 60 * 60 * 1000;
  const flowData = backlogFlow.map((p) => ({
    week: format(new Date(p.weekEnd), 'MMM dd'),
    Open: p.open,
    'New Reports': p.inflow,
    Resolved: p.outflow,
    // The window this point covers is (weekEnd - 7d, weekEnd] — see
    // buildBacklogFlow — so a click needs both ends to filter that exact week.
    weekStart: p.weekEnd - 7 * MS_PER_DAY,
    weekEnd: p.weekEnd,
  }));

  const BAND_TABS = [
    { key: 'spi', label: 'Service Performance', score: servicePerformance.index },
    { key: 'uci', label: 'Urban Condition', score: urbanCondition.index },
    { key: 'ifi', label: 'Infrastructure Fragility', score: infrastructureFragility.index },
  ];

  return (
    <div className="space-y-6">
      {/* One score band shown at a time — all three stacked at once was a lot
          to scroll through just to see one rating. */}
      <div className="flex bg-[#f5f1e6] p-1 rounded-xl border border-[#1f1e1a]/8 flex-wrap gap-1 self-start">
        {BAND_TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => onBandChange(tab.key)}
            className={`px-3.5 py-2 rounded-lg text-xs font-bold transition-all cursor-pointer ${
              activeBand === tab.key
                ? 'bg-[#4a5d3f] text-white border border-[#4a5d3f] shadow-lg'
                : 'text-[#8a8477] hover:text-[#201f1b] border border-transparent'
            }`}
          >
            {tab.label} ({tab.score ?? '—'})
          </button>
        ))}
      </div>

      {/* ── BAND A · SERVICE PERFORMANCE ───────────────────────────── */}
      {activeBand === 'spi' && (
      <section className="space-y-4">
        <BandHeader
          title="Service Performance"
          subtitle="How well the council responds. Every part of this score is something the council does, measured against the agreed target for each step."
          onMethodology={() => setMethodology('spi')}
        />

        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
          <IndexGauge
            value={servicePerformance.index}
            label="Service Perf."
            caption={`Based on ${reportCount} reports`}
            excludedCount={servicePerformance.excluded.length}
            totalDomains={Object.keys(SPI_WEIGHTS).length}
            formula="A weighted average of the categories shown here — the % on each card is its share of this score."
            onMethodology={() => setMethodology('spi')}
            actionsByGrade={BAND_ACTIONS.spi}
          />
          <div className="lg:col-span-3 grid grid-cols-2 md:grid-cols-3 gap-3">
            {spiDomains.map((d) => (
              <DomainCard
                key={d.key}
                name={d.name}
                score={d.score}
                weight={SPI_WEIGHTS[d.key]}
                effectiveWeight={spiEffectiveWeight(d.key)}
                primary={
                  d.medianDays != null
                    ? `Typical (median) time: ${fmtDuration(d.medianDays)}, vs a target of ${fmtDuration(d.targetDays)} (based on ${d.n} reports)`
                    : `${d.n} dispatched reports`
                }
                secondary={`Insufficient data — ${d.n} of ${d.key === 'firstPass' ? MIN_N_FOR_SCORE : MIN_N_FOR_STAGE} reports needed`}
              />
            ))}
          </div>
        </div>

        {/* Backlog & flow — a real point-in-time reconstruction. */}
        <div className="content-card">
          <div className="content-card-header">
            <div className="content-card-title">Open, New, and Resolved Reports (12 weeks)</div>
            <span className="text-[11px] text-[#8a8477]">Are we keeping up?</span>
          </div>
          <div className="p-5">
            <div style={{ height: 240 }}>
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart
                  data={flowData}
                  margin={{ top: 5, right: 10, left: -18, bottom: 0 }}
                  onClick={(e) => {
                    // ComposedChart's onClick doesn't reliably populate
                    // activePayload the way a plain AreaChart/BarChart does —
                    // activeIndex is the one field it always sets on click.
                    const point = e?.activeIndex != null ? flowData[e.activeIndex] : null;
                    if (point && onWeekClick) {
                      onWeekClick(
                        `${format(new Date(point.weekStart + MS_PER_DAY), 'yyyy-MM-dd')}T00:00`,
                        `${format(new Date(point.weekEnd), 'yyyy-MM-dd')}T23:59`
                      );
                    }
                  }}
                  style={{ cursor: onWeekClick ? 'pointer' : 'default' }}
                >
                  <defs>
                    <linearGradient id="openGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#d97757" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#d97757" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(31,30,26,0.08)" />
                  <XAxis dataKey="week" stroke="#8a8477" fontSize={10} tickLine={false} />
                  <YAxis stroke="#8a8477" fontSize={10} tickLine={false} allowDecimals={false} />
                  <Tooltip
                    contentStyle={{ background: '#ffffff', border: '1px solid rgba(31,30,26,0.10)', borderRadius: 8, fontSize: 12 }}
                    labelStyle={{ color: '#8a8477' }}
                  />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Area type="monotone" dataKey="Open" stroke="#d97757" strokeWidth={2} fill="url(#openGrad)" />
                  <Line type="monotone" dataKey="New Reports" stroke="#6366f1" strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="Resolved" stroke="#4a5d3f" strokeWidth={2} dot={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
            <p className="text-[10px] text-[#8a8477] mt-2 leading-relaxed">
              <Info size={10} className="inline mr-1 -mt-0.5" />
              The number of open reports each week is calculated from the dates reports were
              submitted and resolved. The rejection date is estimated from the review date,
              which is accurate because a rejected report is never later approved.
              {onWeekClick && ' Click a point to see the reports submitted that week.'}
            </p>
          </div>
        </div>
      </section>
      )}

      {/* ── BAND B · URBAN CONDITION ───────────────────────────────── */}
      {activeBand === 'uci' && (
      <section className="space-y-4">
        <BandHeader
          title="Urban Condition"
          subtitle="The actual condition of the city — how many open issues the council is dealing with. This is mostly outside the council's short-term control, and the score does not depend on how many reports get resolved."
          onMethodology={() => setMethodology('uci')}
        />

        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
          <IndexGauge
            value={urbanCondition.index}
            label="Urban Cond."
            caption="Open issues, weighted by how long they've been open"
            excludedCount={urbanCondition.excluded.length}
            totalDomains={Object.keys(UCI_WEIGHTS).length}
            formula="A weighted average of the categories shown here — the % on each card is its share of this score."
            onMethodology={() => setMethodology('uci')}
            actionsByGrade={BAND_ACTIONS.uci}
          />
          <div className="lg:col-span-3 grid grid-cols-2 md:grid-cols-3 gap-3">
            {uciDomains.map((d) => (
              <DomainCard
                key={d.key}
                name={d.name}
                score={d.score}
                weight={UCI_WEIGHTS[d.key]}
                effectiveWeight={uciEffectiveWeight(d.key)}
                primary={
                  `${d.openCount} open · current load ${d.burden} of ${d.target} allowed` +
                  (d.medianAgeDays != null ? ` · typical time open: ${Math.round(d.medianAgeDays)} days` : '')
                }
                secondary="Insufficient data — no reports in this category"
              />
            ))}
          </div>
        </div>
      </section>
      )}

      {/* ── BAND C · INFRASTRUCTURE FRAGILITY ──────────────────────── */}
      {activeBand === 'ifi' && (
      <section className="space-y-4">
        <BandHeader
          title="Infrastructure Fragility"
          subtitle="Shows where the city keeps breaking because of how it was built, not just bad luck. Each zone is scored against its own population, using its full history — not just what's open right now."
          onMethodology={() => setMethodology('ifi')}
        />

        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
          <IndexGauge
            value={infrastructureFragility.index}
            label="Fragility"
            caption={
              ifiZones.length === 1
                ? `This is ${ifiZones[0].zone}'s score, not yet a citywide average — only one zone has enough reports.`
                : `${ifiZones.length} zone${ifiZones.length === 1 ? '' : 's'} scored`
            }
            excludedCount={0}
            totalDomains={ifiZones.length}
            formula="Each zone below blends three signals into its own score — this number is those zone scores averaged, weighted by population."
            onMethodology={() => setMethodology('ifi')}
            actionsByGrade={BAND_ACTIONS.ifi}
          />

          <div className="lg:col-span-3 content-card">
            {ifiZones.length <= 1 ? (
              <div className="p-5 space-y-4">
                {ifiZones.length === 1 ? (
                  <button
                    onClick={() => onZoneClick(ifiZones[0].zone)}
                    className="w-full flex items-center justify-between gap-3 rounded-xl p-4 text-left cursor-pointer transition-opacity hover:opacity-80"
                    style={{ background: 'rgba(74,93,63,0.05)', border: '1px solid rgba(74,93,63,0.15)' }}
                  >
                    <div className="min-w-0">
                      <div className="text-[10px] font-bold text-[#8a8477] uppercase tracking-wider">Only zone scored so far</div>
                      <div className="text-sm font-black text-[#201f1b] mt-0.5">{ifiZones[0].zone}</div>
                      {ifiZones[0].driverLabel && (
                        <div className="text-[11px] text-[#8a8477] mt-1 leading-relaxed max-w-md">Mainly {ifiZones[0].driverLabel}.</div>
                      )}
                      <div className="text-[10px] text-[#8a8477] mt-2 leading-relaxed max-w-md">
                        {ifiZones[0].reportCount} reports · {ifiZones[0].district} district · {ifiZones[0].ratePer10k.toFixed(1)} per 10,000 residents
                        {ifiZones[0].failureRatePct != null && <> · {ifiZones[0].failureRatePct}% of repairs broke again</>}
                        {ifiZones[0].mtbfDays != null && <> · avg {Math.round(ifiZones[0].mtbfDays)}d between problems</>}
                      </div>
                    </div>
                    <div className="text-2xl font-black shrink-0" style={{ color: scoreColor(ifiZones[0].score) }}>
                      {ifiZones[0].score}
                    </div>
                  </button>
                ) : (
                  <p className="text-xs text-[#8a8477]">
                    No zone yet has {MIN_N_FOR_INDEX}+ reports with a known district, so none can be scored.
                  </p>
                )}
                {ifiCloseToQualifying.length > 0 && (
                  <div>
                    <div className="text-[10px] font-bold text-[#8a8477] uppercase tracking-wider mb-2">Closest to being scored next</div>
                    <div className="space-y-1.5">
                      {ifiCloseToQualifying.map((z) => (
                        <div key={z.zone} className="flex items-center justify-between text-xs">
                          <span className="font-semibold text-[#201f1b]">{z.zone}</span>
                          <span className="text-[#8a8477]">{z.reportCount} of {MIN_N_FOR_INDEX} reports</span>
                        </div>
                      ))}
                    </div>
                    <p className="text-[10px] text-[#8a8477] mt-2 leading-relaxed">
                      {MIN_N_FOR_INDEX - ifiCloseToQualifying[0].reportCount} more report{MIN_N_FOR_INDEX - ifiCloseToQualifying[0].reportCount === 1 ? '' : 's'} from {ifiCloseToQualifying[0].zone} and it'll get scored too.
                    </p>
                  </div>
                )}
              </div>
            ) : (
              <div className="p-5">
                <div style={{ height: Math.max(180, ifiZones.length * 32) }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={ifiZones} layout="vertical" margin={{ top: 5, right: 95, left: 10, bottom: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="rgba(31,30,26,0.08)" />
                      <XAxis type="number" domain={[0, 100]} stroke="#8a8477" fontSize={10} tickLine={false} />
                      <YAxis type="category" dataKey="zone" stroke="#8a8477" fontSize={11} tickLine={false} width={140} />
                      <Tooltip
                        content={({ active, payload }) => {
                          if (!active || !payload?.length) return null;
                          const d = payload[0].payload;
                          return (
                            <div className="bg-white border border-[#1f1e1a]/10 rounded-lg p-3 text-xs shadow-lg max-w-[220px]">
                              <div className="font-bold text-[#201f1b] mb-1">{d.zone}</div>
                              <div className="text-[#4b473d] space-y-0.5">
                                <div>{d.reportCount} reports · {d.district} district</div>
                                <div>{d.ratePer10k.toFixed(1)} reports per 10,000 residents</div>
                                {d.failureRatePct != null && <div>{d.failureRatePct}% of repairs broke again</div>}
                                {d.mtbfDays != null && <div>On average, {Math.round(d.mtbfDays)} days between problems</div>}
                                {d.driverLabel && <div className="pt-1 mt-1 border-t border-[#1f1e1a]/6 italic">Main reason: {d.driverLabel}</div>}
                              </div>
                            </div>
                          );
                        }}
                        cursor={{ fill: 'rgba(74,93,63,0.05)' }}
                      />
                      <ReferenceLine x={80} stroke="#15803d" strokeDasharray="4 4" />
                      <Bar
                        dataKey="score"
                        isAnimationActive={false}
                        radius={[0, 4, 4, 0]}
                        maxBarSize={18}
                        cursor="pointer"
                        onClick={(d) => {
                          const zone = d?.payload?.zone ?? d?.zone;
                          if (zone) onZoneClick(zone);
                        }}
                      >
                        {ifiZones.map((z) => (
                          <Cell key={z.zone} fill={scoreColor(z.score)} />
                        ))}
                        <LabelList dataKey="score" content={IfiScoreLabel} />
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <p className="text-[10px] text-[#8a8477] mt-2">
                  A higher score means the zone holds up better. The dashed line at 80 marks where a passing grade starts.
                  {ifiUnscored > 0 && ` ${ifiUnscored} zone${ifiUnscored === 1 ? '' : 's'} left out — fewer than ${MIN_N_FOR_INDEX} reports, or the district isn't known.`}
                  {' '}Click a bar to see the reports behind it.
                </p>
                {/* The ranking alone doesn't say what to do — name the worst
                    zone and which of the three signals is actually driving
                    it, since "slow but holds" and "fast but fails again"
                    need different fixes. */}
                {infrastructureFragility.worst && (
                  <div
                    className="mt-3 rounded-lg px-3 py-2 text-xs font-semibold"
                    style={{
                      background: infrastructureFragility.worst.score < 60 ? 'rgba(185,28,28,0.06)' : 'rgba(21,128,61,0.06)',
                      color: infrastructureFragility.worst.score < 60 ? '#b91c1c' : '#15803d',
                    }}
                  >
                    {infrastructureFragility.worst.score < 60 ? (
                      <>
                        {infrastructureFragility.worst.zone} is the most fragile zone, scoring {infrastructureFragility.worst.score} —
                        mainly because of {infrastructureFragility.worst.driverLabel}. This suggests
                        {infrastructureFragility.worst.driver === 'failureRate'
                          ? ' checking the quality of the original repairs there, instead of just responding faster.'
                          : infrastructureFragility.worst.driver === 'mtbf'
                          ? ' setting up regular inspections in this zone, instead of waiting for the next resident report.'
                          : ' checking whether this zone has enough resources for how often problems actually happen there.'}
                      </>
                    ) : (
                      <>No zone is seriously fragile — even the lowest, {infrastructureFragility.worst.zone}, still scores {infrastructureFragility.worst.score}.</>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </section>
      )}

      {methodology && (
        <MethodologyPanel kind={methodology} onClose={() => setMethodology(null)} />
      )}
    </div>
  );
}
