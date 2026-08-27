/**
 * Pure derivation helpers for the Infrastructure Analytics page.
 *
 * Kept free of React so the arithmetic can be tested without mounting a
 * component, and so the funnel and the Service Performance Index are guaranteed
 * to derive from one implementation rather than two that can drift apart.
 */

import {
  MELAKA_ZONES,
  MAX_ZONE_SNAP_KM,
  ZONE_UNMAPPED,
  ZONE_UNASSIGNED,
  SLA_TARGET_DAYS,
  SLA_END_TO_END_DAYS,
  SPI_WEIGHTS,
  UCI_WEIGHTS,
  UCI_BURDEN_TARGETS,
  AGE_WEIGHT_DAYS,
  MIN_N_FOR_STAGE,
  MIN_N_FOR_SCORE,
  MIN_N_FOR_INDEX,
  REINCIDENCE,
  IFI_WEIGHTS,
  ZONE_DISTRICT,
  MELAKA_DISTRICT_POPULATION,
} from './analyticsConstants';
import { AUTHORITIES } from './authorities';

const MS_PER_DAY = 1000 * 60 * 60 * 24;

// ── Primitives ───────────────────────────────────────────────────────────────

/** Parses an API timestamp to epoch ms, or null if absent/unparseable. */
export function toDate(value) {
  if (!value) return null;
  const ms = new Date(value).getTime();
  return Number.isNaN(ms) ? null : ms;
}

export function mean(values) {
  const nums = values.filter((v) => v != null && !Number.isNaN(v));
  if (!nums.length) return null;
  return nums.reduce((s, v) => s + v, 0) / nums.length;
}

/**
 * Linear-interpolated percentile (the "R-7" / Excel PERCENTILE.INC method).
 * Pinned deliberately: the figure appears in exported PDFs, so it has to be
 * reproducible rather than dependent on an implementation default.
 */
export function percentile(values, p) {
  const nums = values.filter((v) => v != null && !Number.isNaN(v)).sort((a, b) => a - b);
  if (!nums.length) return null;
  if (nums.length === 1) return nums[0];
  const rank = (p / 100) * (nums.length - 1);
  const low = Math.floor(rank);
  const high = Math.ceil(rank);
  if (low === high) return nums[low];
  return nums[low] + (rank - low) * (nums[high] - nums[low]);
}

export const median = (values) => percentile(values, 50);

/**
 * A fractional-day value like "0.5" reads as nothing to someone who hasn't
 * been told what a percentile or a decimal day means. Below a day, switch
 * to minutes/hours; a day or more stays in days.
 */
export const fmtDuration = (v) => {
  if (v == null) return '—';
  if (v <= 0) return '0 min';
  const hrs = v * 24;
  if (hrs < 1) return Math.max(1, Math.round(hrs * 60)) + ' min';
  if (v < 1) return Math.round(hrs) + ' hrs';
  const rounded = Math.round(v * 10) / 10;
  return rounded + (rounded === 1 ? ' day' : ' days');
};

/** Great-circle distance in metres. */
export function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 6371; // km
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)) * 1000;
}

/** Folds the free-text category strings into six comparable groups. */
export function canonicalizeCategory(catName) {
  const name = (catName || '').toLowerCase();
  if (name.includes('road') || name.includes('pothole') || name.includes('sidewalk') || name.includes('pavement')) {
    return 'Road Damage';
  }
  if (name.includes('light') || name.includes('lamp') || name.includes('lighting')) {
    return 'Street Lighting';
  }
  if (name.includes('waste') || name.includes('garbage') || name.includes('dumping') || name.includes('trash') || name.includes('burning')) {
    return 'Waste Management';
  }
  if (name.includes('drain') || name.includes('water') || name.includes('drainage') || name.includes('flood')) {
    return 'Drainage System';
  }
  if (name.includes('vandal') || name.includes('graffiti') || name.includes('damage') || name.includes('property')) {
    return 'Vandalism';
  }
  return 'Other Infrastructure';
}

// ── Geography ────────────────────────────────────────────────────────────────

/**
 * Resolves a report to a named Melaka locality by nearest surveyed centroid.
 *
 * Reports carry coordinates but no zone field. The previous fallback chain
 * (r.zone -> r.location -> last comma-separated part of the address) produced
 * either a raw postcode string or the literal "Malaysia", so the zone scorecard
 * collapsed to a single meaningless row. Snapping is capped at
 * MAX_ZONE_SNAP_KM so a distant report is reported as unmapped rather than
 * attributed to whichever zone happens to be least far away.
 */
export function deriveZone(report) {
  const lat = Number(report?.latitude);
  const lng = Number(report?.longitude);

  if (Number.isFinite(lat) && Number.isFinite(lng)) {
    let best = null;
    let bestM = Infinity;
    for (const zone of MELAKA_ZONES) {
      const d = calculateDistance(lat, lng, zone.lat, zone.lng);
      if (d < bestM) {
        bestM = d;
        best = zone;
      }
    }
    if (best && bestM <= MAX_ZONE_SNAP_KM * 1000) return best.name;
    return ZONE_UNMAPPED;
  }

  // No coordinates: fall back to the postcode, labelled as such so nobody
  // mistakes it for a surveyed area name.
  const postcode = String(report?.location || report?.address || '').match(/\b\d{5}\b/);
  return postcode ? `Postcode ${postcode[0]}` : ZONE_UNASSIGNED;
}

/**
 * Builds the department option list from the reports actually present.
 *
 * The filter previously offered exactly three hardcoded departments, so reports
 * belonging to the other ten authorities could not be isolated at all. Listing
 * every authority would mostly show empty scopes; listing the ones with data
 * keeps the control honest. Falls back to the raw department string so a
 * department outside the AUTHORITIES table is still selectable.
 */
export function deriveDepartmentOptions(reports) {
  const counts = new Map();

  for (const report of reports || []) {
    const assigned = (report?.assigned_department || '').trim();
    if (!assigned) continue;

    const lower = assigned.toLowerCase();
    const match = AUTHORITIES.find(
      (a) => lower.includes(a.abbr.toLowerCase()) || lower.includes(a.id.toLowerCase())
    );

    const key = match ? match.abbr : assigned;
    const existing = counts.get(key);
    if (existing) existing.count += 1;
    else counts.set(key, { key, label: match ? `${match.abbr} — ${match.name}` : assigned, count: 1 });
  }

  return [...counts.values()].sort((a, b) => b.count - a.count);
}

// ── Stage durations ──────────────────────────────────────────────────────────

/**
 * The seven contiguous stages a report passes through, in order. Each stage is
 * defined by the pair of timestamps that bound it, so for a well-formed
 * resolved report the durations sum exactly to `resolved_at - timestamp`.
 */
export const STAGES = [
  { key: 'triage', label: 'Triage', from: 'timestamp', to: 'reviewed_at', owner: 'Admin' },
  { key: 'dispatch', label: 'Dispatch decision', from: 'reviewed_at', to: 'in_process_at', owner: 'Authority' },
  { key: 'rework', label: 'Rework / re-pooling', from: 'in_process_at', to: 'dispatched_at', owner: 'Authority + crew' },
  { key: 'poolWait', label: 'Pool wait (unclaimed)', from: 'dispatched_at', to: 'claimed_at', owner: 'Crew' },
  { key: 'mobilise', label: 'Mobilisation', from: 'claimed_at', to: 'in_maintenance_at', owner: 'Worker' },
  { key: 'work', label: 'Work', from: 'in_maintenance_at', to: 'completion_submitted_at', owner: 'Worker' },
  { key: 'verify', label: 'Verification', from: 'completion_submitted_at', to: 'resolved_at', owner: 'Authority' },
];

/**
 * Per-stage durations in days for a single report.
 *
 * Returns `{ durations, nonMonotonic, eligible }` where a stage is:
 *   - a number  — both boundaries present and ordered
 *   - 0         — boundaries inverted (clamped, and counted in nonMonotonic)
 *   - null      — a boundary is missing, i.e. the report has not reached this
 *                 stage yet. Never imputed: a report sitting in the pool right
 *                 now has an unfinished pool wait, not a pool wait of zero.
 *
 * Rejected reports are ineligible. `reviewed_at` is stamped on rejection as
 * well as approval, so including them would blend "approved in 4h" with
 * "rejected in 4h" into one triage figure.
 *
 * Note on bounced reports: release, crew reassignment and cross-team transfer
 * all null `claimed_at`/`in_maintenance_at` and re-stamp `dispatched_at`, while
 * `in_process_at` survives from the first dispatch. The rework stage
 * (in_process_at -> dispatched_at) therefore captures exactly the time consumed
 * by abandoned cycles: zero for a clean report, the full bounce duration for a
 * bounced one. The later stages describe only the final cycle.
 */
export function stageDurations(report) {
  const eligible = report?.status !== 'Rejected';
  const durations = {};
  const boundaries = {};
  let nonMonotonic = 0;

  if (!eligible) {
    for (const s of STAGES) {
      durations[s.key] = null;
      boundaries[s.key] = null;
    }
    return { durations, nonMonotonic, eligible, boundaries };
  }

  for (const stage of STAGES) {
    const from = toDate(report?.[stage.from]);
    const to = toDate(report?.[stage.to]);
    if (from == null || to == null) {
      durations[stage.key] = null;
      boundaries[stage.key] = null;
      continue;
    }
    boundaries[stage.key] = { from: report[stage.from], to: report[stage.to] };
    const days = (to - from) / MS_PER_DAY;
    if (days < 0) {
      nonMonotonic += 1;
      durations[stage.key] = 0;
    } else {
      durations[stage.key] = days;
    }
  }

  return { durations, nonMonotonic, eligible, boundaries };
}

/** End-to-end days from submission to resolution, or null. */
export function endToEndDays(report) {
  const start = toDate(report?.timestamp);
  const end = toDate(report?.resolved_at);
  if (start == null || end == null) return null;
  return (end - start) / MS_PER_DAY;
}

/**
 * Aggregates stage durations across a set of reports.
 *
 * `cohort` is 'all' (default) or 'resolved'. Under 'all' every stage is
 * summarised over however many reports have reached it, so each stage carries
 * its own n; restricting to resolved reports only would bias every stage toward
 * the quickest cases. Under 'resolved' the n is identical across stages, which
 * is the only cohort where the stage durations sum to the end-to-end time.
 *
 * Medians are reported rather than means: municipal durations are heavily
 * right-skewed, and a handful of tickets awaiting budget approval move a mean
 * by days without changing what a typical citizen experiences.
 */
export function buildFunnel(reports, { cohort = 'all', minN = 5 } = {}) {
  const pool = (reports || []).filter((r) => r?.status !== 'Rejected');
  const scoped = cohort === 'resolved' ? pool.filter((r) => r.status === 'Resolved') : pool;

  const samples = {};
  for (const s of STAGES) samples[s.key] = [];
  let nonMonotonic = 0;

  for (const report of scoped) {
    const { durations, nonMonotonic: nm, boundaries } = stageDurations(report);
    nonMonotonic += nm;
    for (const s of STAGES) {
      const v = durations[s.key];
      if (v != null) {
        samples[s.key].push({
          value: v,
          id: report.id,
          address: report.address || report.location || 'Unknown location',
          category: canonicalizeCategory(report.categories || report.ai_prediction),
          status: report.status,
          latitude: report.latitude,
          longitude: report.longitude,
          fromAt: boundaries[s.key]?.from ?? null,
          toAt: boundaries[s.key]?.to ?? null,
        });
      }
    }
  }

  const eligibleCount = scoped.length;
  const stages = STAGES.map((s) => {
    const samplesForStage = samples[s.key];
    const values = samplesForStage.map((x) => x.value);
    const n = values.length;
    const sufficient = n >= minN;
    return {
      key: s.key,
      label: s.label,
      owner: s.owner,
      n,
      coverage: eligibleCount ? n / eligibleCount : 0,
      sufficient,
      median: sufficient ? median(values) : null,
      p25: sufficient ? percentile(values, 25) : null,
      p90: sufficient ? percentile(values, 90) : null,
      mean: sufficient ? mean(values) : null,
      // Slowest first — the reports worth checking are the outliers dragging
      // the median up, not the ones already inside target.
      reports: samplesForStage.slice().sort((a, b) => b.value - a.value),
    };
  });

  // Bounce rate is a routing-quality signal: release_count survives the
  // timestamp resets, so it is the one durable trace that a report was
  // re-pooled at all.
  const dispatched = scoped.filter((r) => toDate(r.dispatched_at) != null);
  const bounced = dispatched.filter((r) => (r.release_count || 0) > 0);
  const firstPassYield = dispatched.length
    ? Math.round((1 - bounced.length / dispatched.length) * 100)
    : null;

  const endToEnd = scoped.map(endToEndDays).filter((v) => v != null);

  return {
    stages,
    cohort,
    eligibleCount,
    nonMonotonic,
    bouncedCount: bounced.length,
    dispatchedCount: dispatched.length,
    firstPassYield,
    medianReleaseCount: bounced.length
      ? median(bounced.map((r) => r.release_count || 0))
      : null,
    endToEnd: {
      n: endToEnd.length,
      median: endToEnd.length ? median(endToEnd) : null,
      mean: endToEnd.length ? mean(endToEnd) : null,
      p90: endToEnd.length ? percentile(endToEnd, 90) : null,
    },
  };
}

/**
 * Mean share of end-to-end time per stage, over resolved reports only.
 *
 * Means are used here on purpose, and only here: they are additive, so the
 * shares genuinely sum to the mean total. Medians are not additive, so a
 * stacked chart of medians would assert a decomposition the numbers cannot
 * support. Complete cases only, so every stage covers the same reports.
 */
export function buildComposition(reports) {
  const complete = (reports || []).filter((r) => {
    if (r?.status !== 'Resolved') return false;
    const { durations } = stageDurations(r);
    return STAGES.every((s) => durations[s.key] != null);
  });

  if (!complete.length) return { n: 0, meanTotalDays: null, segments: [] };

  const perStageMeans = STAGES.map((s) => {
    const vals = complete.map((r) => stageDurations(r).durations[s.key]);
    return { key: s.key, label: s.label, meanDays: mean(vals) };
  });

  const meanTotalDays = perStageMeans.reduce((sum, s) => sum + (s.meanDays || 0), 0);

  return {
    n: complete.length,
    meanTotalDays,
    segments: perStageMeans.map((s) => ({
      ...s,
      share: meanTotalDays > 0 ? s.meanDays / meanTotalDays : 0,
    })),
  };
}

// ── Composite indices ────────────────────────────────────────────────────────

/**
 * Combines domain scores into an index, renormalising over the domains that
 * could actually be measured.
 *
 * Without renormalisation a single unmeasured domain either poisons the sum to
 * NaN or, worse, gets a flattering default and drags the index toward it. This
 * returns the excluded list too, so the UI can state what the score covers
 * rather than implying it covers everything.
 */
export function weightedIndex(scoresByKey, weights) {
  const keys = Object.keys(weights);
  const included = keys.filter((k) => scoresByKey[k] != null);
  const excluded = keys.filter((k) => scoresByKey[k] == null);
  const weightSum = included.reduce((s, k) => s + weights[k], 0);

  return {
    value: weightSum > 0
      ? Math.round(included.reduce((s, k) => s + scoresByKey[k] * weights[k], 0) / weightSum)
      : null,
    included,
    excluded,
    coverage: weightSum,
  };
}

/**
 * Service Performance Index — how well the council responds.
 *
 * Every input is a council action, measured as attainment against the agreed
 * per-stage SLA budget. Scores cap at 100: beating a target is not extra
 * credit, it means the target is stale, which is a different conversation.
 *
 * Derives from the same buildFunnel output the funnel chart renders, so the two
 * panels cannot disagree about how long a stage takes.
 */
export function buildServicePerformance(reports) {
  const funnel = buildFunnel(reports, { cohort: 'all', minN: MIN_N_FOR_STAGE });
  const byKey = Object.fromEntries(funnel.stages.map((s) => [s.key, s]));

  const attainment = (key) => {
    const stage = byKey[key];
    const target = SLA_TARGET_DAYS[key];
    if (!stage?.sufficient || stage.median == null || target == null) return null;
    // A zero-budget stage (rework) scores 100 only when it actually took no time.
    if (target === 0) return stage.median <= 0 ? 100 : 0;
    return Math.max(0, Math.min(100, Math.round((target / Math.max(stage.median, 1e-6)) * 100)));
  };

  const domains = {
    triage: { key: 'triage', name: 'Triage', score: attainment('triage'), n: byKey.triage?.n ?? 0, medianDays: byKey.triage?.median ?? null, targetDays: SLA_TARGET_DAYS.triage },
    dispatch: { key: 'dispatch', name: 'Dispatch decision', score: attainment('dispatch'), n: byKey.dispatch?.n ?? 0, medianDays: byKey.dispatch?.median ?? null, targetDays: SLA_TARGET_DAYS.dispatch },
    poolWait: { key: 'poolWait', name: 'Pool wait', score: attainment('poolWait'), n: byKey.poolWait?.n ?? 0, medianDays: byKey.poolWait?.median ?? null, targetDays: SLA_TARGET_DAYS.poolWait },
    work: { key: 'work', name: 'Work', score: attainment('work'), n: byKey.work?.n ?? 0, medianDays: byKey.work?.median ?? null, targetDays: SLA_TARGET_DAYS.work },
    verify: { key: 'verify', name: 'Verification', score: attainment('verify'), n: byKey.verify?.n ?? 0, medianDays: byKey.verify?.median ?? null, targetDays: SLA_TARGET_DAYS.verify },
    firstPass: {
      key: 'firstPass',
      name: 'Right First Time',
      // Routing quality: the share of dispatched reports never re-pooled.
      score: funnel.dispatchedCount >= MIN_N_FOR_SCORE ? funnel.firstPassYield : null,
      n: funnel.dispatchedCount,
      medianDays: null,
      targetDays: null,
    },
  };

  const scores = Object.fromEntries(Object.entries(domains).map(([k, d]) => [k, d.score]));
  const index = weightedIndex(scores, SPI_WEIGHTS);

  return { index: index.value, excluded: index.excluded, domains, funnel };
}

/**
 * Urban Condition Index — the state of the city itself.
 *
 * Deliberately does NOT use resolution rate. Resolution rate measures the
 * council's throughput, and scoring city condition with it is exactly the
 * conflation this split exists to remove: a council could close every ticket
 * quickly while the city steadily accumulates defects.
 *
 * Instead it scores the open-defect burden per category, weighting each open
 * defect by how long it has stayed open, against a tolerance the council sets
 * (UCI_BURDEN_TARGETS — a policy input, not a measurement).
 */
export function buildUrbanCondition(reports, now = Date.now()) {
  const open = (reports || []).filter(
    (r) => r?.status !== 'Resolved' && r?.status !== 'Rejected'
  );

  const categories = Object.keys(UCI_WEIGHTS);
  const domains = {};

  for (const cat of categories) {
    const inCat = open.filter((r) => canonicalizeCategory(r.categories || r.ai_prediction) === cat);
    const allInCat = (reports || []).filter(
      (r) => canonicalizeCategory(r.categories || r.ai_prediction) === cat
    );

    // A category nobody has ever reported is unmeasured, not perfect.
    if (allInCat.length === 0) {
      domains[cat] = { key: cat, name: cat, score: null, openCount: 0, burden: null, medianAgeDays: null, target: UCI_BURDEN_TARGETS[cat] };
      continue;
    }

    const ages = [];
    let burden = 0;
    for (const r of inCat) {
      const submitted = toDate(r.timestamp);
      const ageDays = submitted == null ? 0 : Math.max(0, (now - submitted) / MS_PER_DAY);
      ages.push(ageDays);
      burden += 1 + ageDays / AGE_WEIGHT_DAYS;
    }

    const target = UCI_BURDEN_TARGETS[cat];
    domains[cat] = {
      key: cat,
      name: cat,
      score: Math.max(0, Math.min(100, Math.round(100 * (1 - burden / target)))),
      openCount: inCat.length,
      burden: Math.round(burden * 10) / 10,
      medianAgeDays: ages.length ? median(ages) : null,
      target,
    };
  }

  const scores = Object.fromEntries(Object.entries(domains).map(([k, d]) => [k, d.score]));
  const index = weightedIndex(scores, UCI_WEIGHTS);

  return { index: index.value, excluded: index.excluded, domains };
}

/**
 * Weekly cumulative flow, reconstructed point-in-time from real timestamps.
 *
 * Replaces a trend that recomputed each past week from present-day statuses, so
 * a ticket resolved this morning counted as resolved in all twelve historical
 * weeks and the line could only ever slope upward.
 *
 * Rejection date is inferred from reviewed_at, which is stamped on both approval
 * and rejection; that is safe here because a rejected report is never
 * subsequently approved.
 */
export function buildBacklogFlow(reports, { weeks = 12, now = Date.now() } = {}) {
  const points = [];

  for (let i = weeks - 1; i >= 0; i--) {
    const weekEnd = now - i * 7 * MS_PER_DAY;
    const weekStart = weekEnd - 7 * MS_PER_DAY;

    let open = 0;
    let inflow = 0;
    let outflow = 0;

    for (const r of reports || []) {
      const submitted = toDate(r.timestamp);
      if (submitted == null) continue;

      const resolvedAt = toDate(r.resolved_at);
      const rejectedAt = r.status === 'Rejected' ? toDate(r.reviewed_at) : null;

      if (submitted > weekStart && submitted <= weekEnd) inflow += 1;
      if (resolvedAt != null && resolvedAt > weekStart && resolvedAt <= weekEnd) outflow += 1;

      const isResolvedAsOf = resolvedAt != null && resolvedAt <= weekEnd;
      const isRejectedAsOf = rejectedAt != null && rejectedAt <= weekEnd;
      if (submitted <= weekEnd && !isResolvedAsOf && !isRejectedAsOf) open += 1;
    }

    points.push({ weekEnd, open, inflow, outflow });
  }

  return points;
}

// ── Repair reliability ───────────────────────────────────────────────────────

/**
 * Repair reliability per authority — whether a completed fix actually held,
 * not just how fast the council closed the ticket. The only headline figure
 * derived from every resolved report rather than only the ones still open.
 *
 * Runs over every authority that has resolved at least one ticket, rather
 * than a fixed shortlist: a report assigned to any of the fourteen agencies
 * in AUTHORITIES contributes, not just the two or three biggest ones. An
 * authority absent from the result has simply never closed a ticket yet.
 *
 * A repeat incident is an open report that reappeared within
 * REINCIDENCE.radiusM and REINCIDENCE.windowDays of a previously resolved
 * report of the same category, attributed to the authority that did the
 * earlier repair — counted once per repeat report, not once per historical
 * fix at that spot.
 */
export function buildReliabilityAudit(reports, { minResolved = 1 } = {}) {
  const resolved = (reports || []).filter((r) => r?.status === 'Resolved');
  const open = (reports || []).filter((r) => r?.status !== 'Resolved' && r?.status !== 'Rejected');

  const findAuthority = (report) => {
    const dept = (report?.assigned_department || '').toLowerCase();
    if (!dept) return null;
    return AUTHORITIES.find((a) => dept.includes(a.abbr.toLowerCase()) || dept.includes(a.id.toLowerCase())) || null;
  };

  const byAuthority = new Map();
  const bucket = (authority) => {
    if (!byAuthority.has(authority.abbr)) {
      byAuthority.set(authority.abbr, {
        key: authority.abbr,
        name: authority.name,
        reIncidence: 0,
        resolvedCount: 0,
        onTimeCount: 0,
      });
    }
    return byAuthority.get(authority.abbr);
  };

  // Every resolved ticket behind the aggregate counts, keyed by report id so
  // the reincidence pass below can mark which ones turned out not to hold —
  // the evidence trail behind "15 resolved, 7 repeat failures, Grade F"
  // rather than just the three numbers.
  const ticketById = new Map();
  const ticketsByAuthority = new Map();

  for (const r of resolved) {
    const authority = findAuthority(r);
    if (!authority) continue;
    const start = toDate(r.timestamp);
    const end = toDate(r.resolved_at);
    if (start == null || end == null) continue;
    const entry = bucket(authority);
    entry.resolvedCount += 1;
    const daysToResolve = (end - start) / MS_PER_DAY;
    const onTime = daysToResolve <= SLA_END_TO_END_DAYS;
    if (onTime) entry.onTimeCount += 1;

    const ticket = {
      id: r.id,
      address: r.address || r.location || 'Unknown location',
      category: canonicalizeCategory(r.categories || r.ai_prediction),
      status: r.status,
      submittedAt: r.timestamp,
      resolvedAt: r.resolved_at,
      daysToResolve: Math.round(daysToResolve * 10) / 10,
      onTime,
      latitude: r.latitude,
      longitude: r.longitude,
      // One original repair can attract more than one later complaint —
      // a single boolean+fields here used to silently overwrite earlier
      // matches, so a ticket that reappeared 5 times looked identical to
      // one that reappeared once, and the count above this list could run
      // ahead of how many tickets actually showed as flagged.
      reappearances: [],
    };
    ticketById.set(r.id, ticket);
    if (!ticketsByAuthority.has(authority.abbr)) ticketsByAuthority.set(authority.abbr, []);
    ticketsByAuthority.get(authority.abbr).push(ticket);
  }

  const incidents = [];

  for (const report of open) {
    const openTime = toDate(report.timestamp);
    if (openTime == null) continue;

    let nearest = null;
    let nearestDist = Infinity;
    for (const res of resolved) {
      const resTime = toDate(res.timestamp);
      if (resTime == null) continue;
      const daysDiff = Math.abs(openTime - resTime) / MS_PER_DAY;
      if (daysDiff > REINCIDENCE.windowDays) continue;
      if (canonicalizeCategory(report.categories || report.ai_prediction) !==
          canonicalizeCategory(res.categories || res.ai_prediction)) continue;
      const dist = calculateDistance(report.latitude, report.longitude, res.latitude, res.longitude);
      if (dist <= REINCIDENCE.radiusM && dist < nearestDist) {
        nearestDist = dist;
        nearest = res;
      }
    }
    if (nearest) {
      const authority = findAuthority(nearest);
      if (authority) {
        bucket(authority).reIncidence += 1;
        const ticket = ticketById.get(nearest.id);
        if (ticket) {
          ticket.reappearances.push({
            id: report.id,
            at: report.timestamp,
            address: report.address || report.location || 'Unknown location',
            distanceM: Math.round(nearestDist),
            latitude: report.latitude,
            longitude: report.longitude,
          });
        }
        incidents.push({
          id: `${nearest.id}-${report.id}`,
          authority: authority.name,
          category: canonicalizeCategory(report.categories || report.ai_prediction),
          originalAddress: nearest.address || nearest.location || 'Unknown location',
          originalResolvedAt: nearest.resolved_at,
          newAddress: report.address || report.location || 'Unknown location',
          newReportedAt: report.timestamp,
          distanceM: Math.round(nearestDist),
        });
      }
    }
  }

  const rows = [...byAuthority.values()]
    .filter((d) => d.resolvedCount >= minResolved)
    .map((d) => ({
      key: d.key,
      name: d.name,
      reIncidence: d.reIncidence,
      resolvedCount: d.resolvedCount,
      rate: d.resolvedCount ? Math.round((d.onTimeCount / d.resolvedCount) * 100) : null,
      tickets: (ticketsByAuthority.get(d.key) || [])
        .slice()
        .sort((a, b) => (toDate(b.resolvedAt) || 0) - (toDate(a.resolvedAt) || 0)),
    }))
    .sort((a, b) => b.resolvedCount - a.resolvedCount);

  const totalResolved = rows.reduce((s, d) => s + d.resolvedCount, 0);
  const totalReIncidence = rows.reduce((s, d) => s + d.reIncidence, 0);
  const overallHoldRate = totalResolved ? Math.round((1 - totalReIncidence / totalResolved) * 100) : null;
  const worst = [...rows].filter((d) => d.reIncidence > 0).sort((a, b) => b.reIncidence - a.reIncidence)[0] || null;

  // Most recent repeat failure first — that's the one worth checking today.
  incidents.sort((a, b) => (toDate(b.newReportedAt) || 0) - (toDate(a.newReportedAt) || 0));

  return { rows, totalResolved, totalReIncidence, overallHoldRate, worst, incidents };
}

// ── Infrastructure Fragility Index (IFI) ────────────────────────────────────

/**
 * Score a zone value against the city-wide average on a 0-100 "how much
 * worse than typical" scale: matching the average scores 50, twice the
 * average (or, for a metric where lower is worse, half the average) scores
 * 100, zero scores 0. A relative scale rather than an absolute policy
 * target (like UCI_BURDEN_TARGETS) because nobody has the standing to set
 * "the correct pothole rate for Melaka" — the city's own average is the one
 * benchmark that needs no one's sign-off.
 */
function relativeFragility(zoneValue, cityAvg, { higherIsWorse }) {
  if (zoneValue == null || cityAvg == null || cityAvg <= 0) return null;
  const ratio = higherIsWorse ? zoneValue / cityAvg : cityAvg / Math.max(zoneValue, 1e-6);
  return Math.max(0, Math.min(100, Math.round(ratio * 50)));
}

const IFI_DRIVER_LABEL = {
  reportRate: 'reports far above the district average for its population',
  failureRate: 'repeat failures — repairs here are not holding',
  mtbf: 'defects recurring in tight succession, little time between failures',
};

/**
 * Infrastructure Fragility Index — where is the city breaking by design,
 * not by bad luck. SPI measures whether the council responds fast; UCI
 * measures how much is open right now; neither says whether a *zone's*
 * infrastructure itself is weak. A pothole patched in two days that comes
 * back every season is not a response-time problem, and nothing else in
 * this app flags it.
 *
 * Three components per zone, computed over full history (including
 * resolved reports — the only index here that looks past what's currently
 * open):
 *   - reportRate:  defect reports per 10,000 residents, relative to the
 *                  city average. Population-normalized so a zone isn't
 *                  penalised just for having more people to report.
 *   - failureRate: share of this zone's resolved reports that reoccurred
 *                  nearby within REINCIDENCE.windowDays — same matching
 *                  logic as buildReliabilityAudit, bucketed by zone instead
 *                  of by authority.
 *   - mtbf:        mean days between consecutive defect reports in the
 *                  zone. Short gaps between failures is itself a fragility
 *                  signal independent of the other two.
 *
 * Population comes from MELAKA_DISTRICT_POPULATION — real government
 * figures, but only at district granularity, so zones sharing a district
 * share a population figure (see ZONE_DISTRICT). A zone whose district is
 * unknown, or with fewer than MIN_N_FOR_INDEX reports, is reported as
 * unmeasured rather than scored on too little data.
 */
export function buildInfrastructureFragility(reports, { minN = MIN_N_FOR_INDEX } = {}) {
  const qualifying = (reports || []).filter((r) => r?.status !== 'Rejected');

  const raw = new Map(); // zone -> { reportCount, timestamps, resolvedCount, reIncidenceCount }
  const bucket = (zone) => {
    if (!raw.has(zone)) raw.set(zone, { reportCount: 0, timestamps: [], resolvedCount: 0, reIncidenceCount: 0 });
    return raw.get(zone);
  };

  for (const r of qualifying) {
    const zone = deriveZone(r);
    const entry = bucket(zone);
    entry.reportCount += 1;
    const t = toDate(r.timestamp);
    if (t != null) entry.timestamps.push(t);
    if (r.status === 'Resolved') entry.resolvedCount += 1;
  }

  // Reincidence pass — identical matching rule to buildReliabilityAudit
  // (same category, within REINCIDENCE.radiusM and .windowDays of a
  // resolved report), attributed to the zone of the earlier repair.
  const resolved = qualifying.filter((r) => r.status === 'Resolved');
  const open = qualifying.filter((r) => r.status !== 'Resolved');
  for (const report of open) {
    const openTime = toDate(report.timestamp);
    if (openTime == null) continue;
    let nearest = null;
    let nearestDist = Infinity;
    for (const res of resolved) {
      const resTime = toDate(res.timestamp);
      if (resTime == null) continue;
      if (Math.abs(openTime - resTime) / MS_PER_DAY > REINCIDENCE.windowDays) continue;
      if (canonicalizeCategory(report.categories || report.ai_prediction) !==
          canonicalizeCategory(res.categories || res.ai_prediction)) continue;
      const dist = calculateDistance(report.latitude, report.longitude, res.latitude, res.longitude);
      if (dist <= REINCIDENCE.radiusM && dist < nearestDist) {
        nearestDist = dist;
        nearest = res;
      }
    }
    if (nearest) bucket(deriveZone(nearest)).reIncidenceCount += 1;
  }

  // Per-zone raw stats, gated to zones with a known population.
  const zoneStats = [];
  for (const [zone, stat] of raw) {
    const district = ZONE_DISTRICT[zone];
    const population = district ? MELAKA_DISTRICT_POPULATION[district] : null;
    if (!population) continue; // unmapped/unassigned zones can't be exposure-normalized

    const sortedT = [...stat.timestamps].sort((a, b) => a - b);
    const gaps = [];
    for (let i = 1; i < sortedT.length; i++) gaps.push((sortedT[i] - sortedT[i - 1]) / MS_PER_DAY);

    zoneStats.push({
      zone,
      district,
      population,
      reportCount: stat.reportCount,
      resolvedCount: stat.resolvedCount,
      reIncidenceCount: stat.reIncidenceCount,
      ratePer10k: stat.reportCount / (population / 10000),
      failureRatePct: stat.resolvedCount >= MIN_N_FOR_SCORE
        ? Math.min(100, Math.round((stat.reIncidenceCount / stat.resolvedCount) * 100))
        : null,
      mtbfDays: gaps.length >= MIN_N_FOR_SCORE - 1 ? mean(gaps) : null,
    });
  }

  // City-wide benchmarks. Rate is pooled (total reports / total distinct
  // district population) rather than a simple mean of zone rates, so a
  // sparse zone can't skew the benchmark as much as a populous one.
  const distinctDistrictPop = Object.values(MELAKA_DISTRICT_POPULATION).reduce((s, v) => s + v, 0);
  const totalReports = zoneStats.reduce((s, z) => s + z.reportCount, 0);
  const cityAvgRatePer10k = distinctDistrictPop > 0 ? totalReports / (distinctDistrictPop / 10000) : null;
  const cityAvgMtbfDays = mean(zoneStats.map((z) => z.mtbfDays).filter((v) => v != null));

  const domains = {};
  for (const z of zoneStats) {
    if (z.reportCount < minN) {
      domains[z.zone] = { ...z, score: null, grade: null, components: null, driver: null };
      continue;
    }

    const components = {
      reportRate: relativeFragility(z.ratePer10k, cityAvgRatePer10k, { higherIsWorse: true }),
      failureRate: z.failureRatePct,
      mtbf: relativeFragility(z.mtbfDays, cityAvgMtbfDays, { higherIsWorse: false }),
    };

    const composite = weightedIndex(components, IFI_WEIGHTS);
    const score = composite.value != null ? 100 - composite.value : null;

    const driver = Object.entries(components)
      .filter(([, v]) => v != null)
      .sort((a, b) => b[1] - a[1])[0]?.[0] || null;

    domains[z.zone] = { ...z, score, components, driver, driverLabel: driver ? IFI_DRIVER_LABEL[driver] : null };
  }

  const scored = Object.values(domains).filter((d) => d.score != null);
  // Headline figure: population-weighted, so a fragile-but-tiny zone
  // doesn't move the city number as much as a fragile, populous one.
  const popWeighted = scored.reduce((s, d) => s + d.population, 0);
  const index = popWeighted > 0
    ? Math.round(scored.reduce((s, d) => s + d.score * d.population, 0) / popWeighted)
    : null;

  const worst = [...scored].sort((a, b) => a.score - b.score)[0] || null;

  return {
    index,
    domains,
    worst,
    measuredZoneCount: scored.length,
    cityAvgRatePer10k,
    cityAvgMtbfDays,
  };
}
