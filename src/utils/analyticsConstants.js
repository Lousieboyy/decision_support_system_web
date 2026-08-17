/**
 * Tunable constants for the Infrastructure Analytics page.
 *
 * Everything the analytics display depends on lives here rather than as inline
 * literals, because in a municipal deployment every threshold has to be
 * explainable to the people whose performance it measures. Values marked
 * POLICY INPUT are choices to agree with the council, not facts discovered
 * from the data.
 */

// ── Service-level targets ────────────────────────────────────────────────────
// POLICY INPUT. The backend also exposes an operational dispatch SLA
// (`sla_hours`, default 48, env DISPATCH_SLA_HOURS) via GET /teams/workload;
// prefer that value at runtime where it is available.
export const SLA_END_TO_END_DAYS = 3;

// Per-stage budget. Must sum to SLA_END_TO_END_DAYS — asserted below in dev.
// `rework` is budgeted at zero: a report needing re-dispatch is already a
// failure of routing, so any time here is over budget by definition.
export const SLA_TARGET_DAYS = {
  triage: 0.5,
  dispatch: 0.5,
  rework: 0,
  poolWait: 0.75,
  mobilise: 0.25,
  work: 0.75,
  verify: 0.25,
};

// ── The single grading rubric ────────────────────────────────────────────────
// Replaces three separate scales that previously disagreed (contractors
// 90/80/70, city index 90/80/70/60, zones 90/75/60/45) while looking identical
// to anyone comparing a zone grade against a contractor grade.
export const GRADE_SCALE = [
  { min: 90, grade: 'A', label: 'Optimal' },
  { min: 80, grade: 'B', label: 'Good' },
  { min: 70, grade: 'C', label: 'Satisfactory' },
  { min: 60, grade: 'D', label: 'At Risk' },
  { min: 0, grade: 'F', label: 'Critical' },
];

/** Returns the GRADE_SCALE entry for a score, or null when unmeasured. */
export const gradeFor = (score) =>
  score == null || Number.isNaN(score)
    ? null
    : GRADE_SCALE.find((g) => score >= g.min) ?? null;

// ── Sufficiency thresholds ───────────────────────────────────────────────────
// Below these counts a figure is reported as "Insufficient data" rather than
// shown, so a single report cannot drive a headline percentage.
export const MIN_N_FOR_STAGE = 5;
export const MIN_N_FOR_SCORE = 5;
export const MIN_N_FOR_INDEX = 10;

// ── Spatial clustering ───────────────────────────────────────────────────────
export const CLUSTER = {
  radiusM: 250,
  minSize: 2,
  radiusMin: 50,
  radiusMax: 1000,
  radiusStep: 50,
  sizeOptions: [2, 3, 4, 5, 6, 8, 10, 15],
};

// A new complaint within this radius and window of a resolved one of the same
// category is treated as the earlier fix not having held.
export const REINCIDENCE = { radiusM: 50, windowDays: 60 };

// ── Insight rule thresholds ──────────────────────────────────────────────────
export const INSIGHT = {
  backlogAlertTickets: 5,
  agedReportDays: 14,
  highEngagementUpvotes: 5,
  volumeSpikeRatio: 1.25,
};

// ── Criticality scoring for the dispatch queue ───────────────────────────────
// POLICY INPUT. These weights rank which cluster a crew should be sent to next.
export const CRITICALITY = {
  size: 8,
  upvote: 1.5,
  highPriority: 15,
  agingPerDay: 4,
  systemicBonus: 15,
  trustDamping: 3.0,
};

// ── Index weights ────────────────────────────────────────────────────────────
// Rendered verbatim in the methodology panel, read from here at runtime so the
// documented weights can never drift from the ones actually applied.

/** Service Performance Index — how well the council responds. */
export const SPI_WEIGHTS = {
  triage: 0.15,
  dispatch: 0.15,
  poolWait: 0.2,
  work: 0.2,
  verify: 0.15,
  firstPass: 0.15,
};

/** Urban Condition Index — the state of the city itself. */
export const UCI_WEIGHTS = {
  'Road Damage': 0.25,
  'Drainage System': 0.2,
  'Street Lighting': 0.15,
  'Waste Management': 0.15,
  Vandalism: 0.15,
  'Other Infrastructure': 0.1,
};

// POLICY INPUT — the age-weighted count of open defects per category the
// council considers tolerable. A burden at target scores 0; no burden scores
// 100. These are service standards to agree with the client, not measurements.
export const UCI_BURDEN_TARGETS = {
  'Road Damage': 40,
  'Drainage System': 30,
  'Street Lighting': 30,
  'Waste Management': 30,
  Vandalism: 20,
  'Other Infrastructure': 25,
};

// An open defect counts as 1, plus 1 more for every AGE_WEIGHT_DAYS it has
// stayed open, so a long-unfixed defect weighs more than a fresh one.
export const AGE_WEIGHT_DAYS = 30;

// ── Geography ────────────────────────────────────────────────────────────────
// Reports carry coordinates but no zone. `location` is a postcode string
// ("75200, Melaka, Malaysia"), so grouping by it produced one meaningless row.
// These centroids are derived from the surveyed Melaka localities in
// seed_30_reports.py and let deriveZone() assign a real area by proximity.
export const MELAKA_ZONES = [
  { name: 'Bandar Hilir', lat: 2.19245, lng: 102.24885 },
  { name: 'Taman Melaka Raya', lat: 2.186, lng: 102.2521 },
  { name: 'Bukit Baru', lat: 2.20585, lng: 102.25645 },
  { name: 'Kota Laksamana', lat: 2.1992, lng: 102.244 },
  { name: 'Kampung Morten', lat: 2.1968, lng: 102.2392 },
  { name: 'Ayer Keroh', lat: 2.266625, lng: 102.289625 },
  { name: 'Durian Tunggal', lat: 2.317, lng: 102.18975 },
  { name: 'Alor Gajah', lat: 2.3818, lng: 102.2055 },
  { name: 'Jasin', lat: 2.30715, lng: 102.4345 },
  { name: 'Masjid Tanah', lat: 2.3522, lng: 102.0845 },
  { name: 'Batu Berendam', lat: 2.2401, lng: 102.26725 },
  { name: 'Cheng', lat: 2.22215, lng: 102.21525 },
  { name: 'Krubong', lat: 2.2478, lng: 102.2885 },
  { name: 'Bukit Katil', lat: 2.218, lng: 102.272 },
  { name: 'Tangga Batu', lat: 2.2065, lng: 102.234 },
  { name: 'Bachang', lat: 2.2142, lng: 102.2475 },
  { name: 'Klebang', lat: 2.228, lng: 102.205 },
  { name: 'Ujong Pasir', lat: 2.1815, lng: 102.2605 },
];

// Beyond this distance from every known centroid a report is reported as
// unmapped rather than snapped to a far-away zone.
export const MAX_ZONE_SNAP_KM = 5;

export const ZONE_UNMAPPED = 'Unmapped area';
export const ZONE_UNASSIGNED = 'Unassigned';

// ── Dispatch-queue risk tone ─────────────────────────────────────────────────
// Keyed on the primaryRisk labels AnalyticsPage assigns to a cluster.
// Shared by the priority panel and the full dispatch table so a badge never
// shows one color at the top of the page and a different one further down.
export const RISK_TONE = {
  'Recurring Problem':   { color: '#b91c1c', bg: 'rgba(185,28,28,0.08)' },
  'Safety Risk':         { color: '#c1613f', bg: 'rgba(193,97,63,0.08)' },
  'Long Overdue':        { color: '#b45309', bg: 'rgba(180,83,9,0.08)' },
  'High Public Concern': { color: '#b45309', bg: 'rgba(180,83,9,0.08)' },
  'Many Reports':        { color: '#15803d', bg: 'rgba(21,128,61,0.08)' },
};
export const DEFAULT_RISK_TONE = RISK_TONE['Many Reports'];

// ── Development-time invariants ──────────────────────────────────────────────
// Catches the class of edit that silently rescales an index or unbalances the
// stage budget. Dev-only: never ships to production bundles.
if (import.meta.env?.DEV) {
  const near = (a, b) => Math.abs(a - b) < 1e-9;
  const sum = (o) => Object.values(o).reduce((s, v) => s + v, 0);

  if (!near(sum(SPI_WEIGHTS), 1)) {
    console.error(`[analyticsConstants] SPI_WEIGHTS must sum to 1, got ${sum(SPI_WEIGHTS)}`);
  }
  if (!near(sum(UCI_WEIGHTS), 1)) {
    console.error(`[analyticsConstants] UCI_WEIGHTS must sum to 1, got ${sum(UCI_WEIGHTS)}`);
  }
  if (!near(sum(SLA_TARGET_DAYS), SLA_END_TO_END_DAYS)) {
    console.error(
      `[analyticsConstants] SLA_TARGET_DAYS must sum to SLA_END_TO_END_DAYS ` +
        `(${SLA_END_TO_END_DAYS}), got ${sum(SLA_TARGET_DAYS)}`
    );
  }
  const uciCats = Object.keys(UCI_WEIGHTS);
  const targetCats = Object.keys(UCI_BURDEN_TARGETS);
  if (uciCats.some((c) => !targetCats.includes(c))) {
    console.error('[analyticsConstants] every UCI_WEIGHTS category needs a UCI_BURDEN_TARGETS entry');
  }
}
