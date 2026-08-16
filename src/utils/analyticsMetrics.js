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
  let nonMonotonic = 0;

  if (!eligible) {
    for (const s of STAGES) durations[s.key] = null;
    return { durations, nonMonotonic, eligible };
  }

  for (const stage of STAGES) {
    const from = toDate(report?.[stage.from]);
    const to = toDate(report?.[stage.to]);
    if (from == null || to == null) {
      durations[stage.key] = null;
      continue;
    }
    const days = (to - from) / MS_PER_DAY;
    if (days < 0) {
      nonMonotonic += 1;
      durations[stage.key] = 0;
    } else {
      durations[stage.key] = days;
    }
  }

  return { durations, nonMonotonic, eligible };
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
    const { durations, nonMonotonic: nm } = stageDurations(report);
    nonMonotonic += nm;
    for (const s of STAGES) {
      const v = durations[s.key];
      if (v != null) samples[s.key].push(v);
    }
  }

  const eligibleCount = scoped.length;
  const stages = STAGES.map((s) => {
    const values = samples[s.key];
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
