import { useMemo, useState } from 'react';
import { RotateCcw, FlaskConical, Users } from 'lucide-react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine,
} from 'recharts';
import {
  SPI_WEIGHTS, UCI_WEIGHTS, UCI_BURDEN_TARGETS, IFI_WEIGHTS, SLA_TARGET_DAYS,
  gradeFor, GRADE_COLOR,
} from '../utils/analyticsConstants';
import { buildServicePerformance, buildUrbanCondition, buildInfrastructureFragility, toDate } from '../utils/analyticsMetrics';
import { AUTHORITIES } from '../utils/authorities';

const MS_PER_DAY = 1000 * 60 * 60 * 24;

// Every domain buildServicePerformance actually scores against a day budget —
// firstPass is a rate, not a duration, so it has no target to tune here.
const SPI_TARGET_KEYS = ['triage', 'dispatch', 'poolWait', 'work', 'verify'];
const SPI_LABELS = {
  triage: 'Triage', dispatch: 'Dispatch decision', poolWait: 'Pool wait',
  work: 'Work', verify: 'Verification', firstPass: 'Right First Time',
};
const IFI_LABELS = {
  failureRate: 'Repeat-failure rate', reportRate: 'Report rate vs. city average', mtbf: 'Time between failures',
};

function GradeChip({ score }) {
  const grade = gradeFor(score);
  if (!grade) {
    return <span className="text-xs font-bold text-[#8a8477]">Insufficient data</span>;
  }
  return (
    <span
      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-sm font-bold"
      style={{ background: `${GRADE_COLOR[grade.grade]}18`, color: GRADE_COLOR[grade.grade] }}
    >
      {score} · {grade.grade} — {grade.label}
    </span>
  );
}

function Delta({ from, to }) {
  if (from == null || to == null) return <span className="text-[11px] font-semibold text-[#8a8477]">n/a</span>;
  const diff = to - from;
  if (diff === 0) return <span className="text-[11px] font-semibold text-[#8a8477]">No change</span>;
  const up = diff > 0;
  return (
    <span className="text-[11px] font-bold" style={{ color: up ? '#15803d' : '#b91c1c' }}>
      {up ? '▲' : '▼'} {Math.abs(diff)} pt{Math.abs(diff) === 1 ? '' : 's'}
    </span>
  );
}

// Sliders are relative units, not percentages that must sum to 100 —
// weightedIndex() already renormalizes by whatever the included weights add
// up to, so only each slider's size *relative to the others* matters. This
// avoids the fiddly "make five sliders sum to exactly 100" UX for no benefit.
function WeightSlider({ label, value, onChange, effectivePct }) {
  return (
    <div className="flex items-center gap-3">
      <span className="text-xs font-semibold text-[#3d3a30] w-40 shrink-0">{label}</span>
      <input
        type="range" min={0} max={100} step={1} value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="flex-1 accent-[#4a5d3f]"
      />
      <span className="text-xs font-bold text-[#4a5d3f] w-10 text-right shrink-0">{effectivePct}%</span>
    </div>
  );
}

function TargetInput({ label, value, onChange, unit }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-xs font-semibold text-[#3d3a30]">{label}</span>
      <div className="flex items-center gap-1.5">
        <input
          type="number" min={0} step={unit === 'days' ? 0.05 : 1} value={value}
          onChange={(e) => onChange(Math.max(0, Number(e.target.value)))}
          className="w-20 px-2 py-1 rounded-lg text-xs font-semibold text-right custom-select"
          style={{ backgroundColor: 'var(--cream-200)', border: '1px solid rgba(31,30,26,0.10)', color: '#201f1b' }}
        />
        <span className="text-[10px] text-[#8a8477] w-8">{unit === 'days' ? 'days' : 'cap'}</span>
      </div>
    </div>
  );
}

function effectivePercents(weights) {
  const sum = Object.values(weights).reduce((s, v) => s + v, 0);
  return Object.fromEntries(Object.entries(weights).map(([k, v]) => [k, sum > 0 ? Math.round((v / sum) * 100) : 0]));
}

// ── Staffing / capacity model ────────────────────────────────────────────────
// A deliberately simple fluid model, not a stochastic queue simulation: over
// the lookback window, how many reports arrived per day and how many this
// department resolved per day, per worker. Projecting forward assumes both
// rates hold — true only as a first approximation, which is exactly what a
// capacity conversation needs (is this roughly a 1-worker gap or a 5-worker
// gap), not a precise forecast.
const WINDOW_OPTIONS = [14, 30, 60, 90];
const MIN_RESOLUTIONS_FOR_RATE = 5;
const PROJECTION_DAYS = 60;

function matchAuthority(text) {
  const lower = (text || '').toLowerCase();
  if (!lower) return null;
  return AUTHORITIES.find(
    (a) => lower.includes(a.abbr.toLowerCase()) || lower.includes(a.id.toLowerCase()) || lower.includes(a.name.toLowerCase())
  ) || null;
}

function buildDepartmentRoster(teams) {
  const roster = new Map();
  for (const t of teams || []) {
    const auth = matchAuthority(t.name);
    const key = auth ? auth.abbr : t.name;
    if (!roster.has(key)) {
      roster.set(key, { key, label: auth ? `${auth.abbr} — ${auth.name}` : t.name, workerCount: t.worker_count ?? 0 });
    }
  }
  return [...roster.values()].sort((a, b) => a.key.localeCompare(b.key));
}

function buildCapacityStats(allReports, deptKey, windowDays, workerCount) {
  const now = Date.now();
  const windowStart = now - windowDays * MS_PER_DAY;

  const inDept = (r) => matchAuthority(r?.assigned_department)?.abbr === deptKey;

  const backlogNow = (allReports || []).filter(
    (r) => inDept(r) && r.status !== 'Resolved' && r.status !== 'Rejected'
  ).length;

  const arrivals = (allReports || []).filter((r) => {
    if (!inDept(r)) return false;
    const t = toDate(r.timestamp);
    return t != null && t >= windowStart;
  }).length;

  const resolutions = (allReports || []).filter((r) => {
    if (!inDept(r) || r.status !== 'Resolved') return false;
    const t = toDate(r.resolved_at);
    return t != null && t >= windowStart;
  }).length;

  const arrivalRate = arrivals / windowDays;
  const throughputRate = resolutions / windowDays;
  const sufficient = resolutions >= MIN_RESOLUTIONS_FOR_RATE && workerCount > 0;
  const perWorkerThroughput = sufficient ? throughputRate / workerCount : null;

  return { backlogNow, arrivalRate, throughputRate, perWorkerThroughput, sufficient, resolutions };
}

function projectBacklog(startBacklog, netFlowPerDay, days, points = 20) {
  const step = Math.max(1, Math.round(days / points));
  const series = [];
  for (let d = 0; d <= days; d += step) {
    series.push({ day: d, backlog: Math.max(0, Math.round(startBacklog + netFlowPerDay * d)) });
  }
  return series;
}

function StaffingVerdict({ arrivalRate, netFlowPerDay, daysToClear, workersToBreakEven, simulatedWorkers }) {
  if (netFlowPerDay == null) {
    return (
      <p className="text-xs text-[#8a8477] leading-relaxed">
        Not enough resolved reports in this window to estimate a reliable per-worker rate for this
        department — try a longer lookback window.
      </p>
    );
  }
  if (netFlowPerDay <= 0) {
    return (
      <p className="text-xs leading-relaxed" style={{ color: '#15803d' }}>
        At <b>{simulatedWorkers}</b> worker{simulatedWorkers === 1 ? '' : 's'}, this department's backlog
        would shrink by ~<b>{Math.abs(netFlowPerDay).toFixed(2)}</b> reports/day and fully clear in about{' '}
        <b>{Math.ceil(daysToClear)}</b> day{Math.ceil(daysToClear) === 1 ? '' : 's'}, assuming arrivals stay
        steady at ~{arrivalRate.toFixed(2)}/day.
      </p>
    );
  }
  return (
    <p className="text-xs leading-relaxed" style={{ color: '#b91c1c' }}>
      At <b>{simulatedWorkers}</b> worker{simulatedWorkers === 1 ? '' : 's'}, this department can't keep up —
      the backlog would keep growing by ~<b>{netFlowPerDay.toFixed(2)}</b> reports/day. At least{' '}
      <b>{workersToBreakEven}</b> worker{workersToBreakEven === 1 ? '' : 's'} would be needed just to stop it
      growing.
    </p>
  );
}

export function WhatIfSimulator({ filteredReports, current, allReports, teams }) {
  const [mode, setMode] = useState('spi'); // 'spi' | 'uci' | 'ifi' | 'staffing'

  const [spiWeights, setSpiWeights] = useState(() => effectivePercents(SPI_WEIGHTS));
  const [spiTargets, setSpiTargets] = useState(() =>
    Object.fromEntries(SPI_TARGET_KEYS.map((k) => [k, SLA_TARGET_DAYS[k]]))
  );

  const [uciWeights, setUciWeights] = useState(() => effectivePercents(UCI_WEIGHTS));
  const [uciTargets, setUciTargets] = useState(() => ({ ...UCI_BURDEN_TARGETS }));

  const [ifiWeights, setIfiWeights] = useState(() => effectivePercents(IFI_WEIGHTS));

  // Staffing state
  const roster = useMemo(() => buildDepartmentRoster(teams), [teams]);
  const [selectedDept, setSelectedDept] = useState(null);
  const [windowDays, setWindowDays] = useState(30);
  const [simulatedWorkers, setSimulatedWorkers] = useState(null);
  const activeDept = selectedDept || roster[0]?.key || null;
  const activeTeam = roster.find((r) => r.key === activeDept);

  const capacity = useMemo(() => {
    if (!activeDept || !activeTeam) return null;
    return buildCapacityStats(allReports, activeDept, windowDays, activeTeam.workerCount);
  }, [allReports, activeDept, activeTeam, windowDays]);

  const workers = simulatedWorkers ?? activeTeam?.workerCount ?? 0;

  const simulatedCapacity = useMemo(() => {
    if (!capacity) return null;
    const simulatedThroughputRate = capacity.perWorkerThroughput != null ? capacity.perWorkerThroughput * workers : null;
    const netFlowPerDay = simulatedThroughputRate != null ? capacity.arrivalRate - simulatedThroughputRate : null;
    const daysToClear = netFlowPerDay != null && netFlowPerDay < 0 ? capacity.backlogNow / -netFlowPerDay : null;
    const workersToBreakEven = capacity.perWorkerThroughput > 0
      ? Math.ceil(capacity.arrivalRate / capacity.perWorkerThroughput)
      : null;
    return { simulatedThroughputRate, netFlowPerDay, daysToClear, workersToBreakEven };
  }, [capacity, workers]);

  const currentNetFlow = capacity ? capacity.arrivalRate - capacity.throughputRate : null;

  const chartData = useMemo(() => {
    if (!capacity || currentNetFlow == null) return [];
    const currentSeries = projectBacklog(capacity.backlogNow, currentNetFlow, PROJECTION_DAYS);
    const simSeries = simulatedCapacity?.netFlowPerDay != null
      ? projectBacklog(capacity.backlogNow, simulatedCapacity.netFlowPerDay, PROJECTION_DAYS)
      : [];
    return currentSeries.map((pt, i) => ({
      day: pt.day,
      'Current staffing': pt.backlog,
      'Simulated staffing': simSeries[i]?.backlog ?? null,
    }));
  }, [capacity, currentNetFlow, simulatedCapacity]);

  const simulated = useMemo(() => {
    if (mode === 'spi') {
      return buildServicePerformance(filteredReports, {
        weights: spiWeights,
        slaTargets: { ...SLA_TARGET_DAYS, ...spiTargets },
      });
    }
    if (mode === 'uci') {
      return buildUrbanCondition(filteredReports, { weights: uciWeights, burdenTargets: uciTargets });
    }
    if (mode === 'ifi') {
      return buildInfrastructureFragility(filteredReports, { weights: ifiWeights });
    }
    return null;
  }, [mode, filteredReports, spiWeights, spiTargets, uciWeights, uciTargets, ifiWeights]);

  const currentResult = mode === 'spi' ? current.spi : mode === 'uci' ? current.uci : mode === 'ifi' ? current.ifi : null;

  const resetActive = () => {
    if (mode === 'spi') {
      setSpiWeights(effectivePercents(SPI_WEIGHTS));
      setSpiTargets(Object.fromEntries(SPI_TARGET_KEYS.map((k) => [k, SLA_TARGET_DAYS[k]])));
    } else if (mode === 'uci') {
      setUciWeights(effectivePercents(UCI_WEIGHTS));
      setUciTargets({ ...UCI_BURDEN_TARGETS });
    } else if (mode === 'ifi') {
      setIfiWeights(effectivePercents(IFI_WEIGHTS));
    } else {
      setSimulatedWorkers(null);
    }
  };

  const weights = mode === 'spi' ? spiWeights : mode === 'uci' ? uciWeights : ifiWeights;
  const setWeights = mode === 'spi' ? setSpiWeights : mode === 'uci' ? setUciWeights : setIfiWeights;
  const weightPct = effectivePercents(weights);
  const labels = mode === 'spi' ? SPI_LABELS : mode === 'ifi' ? IFI_LABELS : null; // UCI labels are the category names themselves

  const MODE_META = {
    spi: { short: 'SPI' },
    uci: { short: 'UCI' },
    ifi: { short: 'IFI' },
    staffing: { short: 'Staffing', icon: Users },
  };

  const introText = mode === 'staffing'
    ? "Adjust a department's worker count and see whether its backlog would grow, shrink, or hold steady — estimated from its own recent arrival and resolution rates. Nothing here changes any real assignment."
    : 'Adjust the policy inputs behind each index — how much weight a domain carries, or what target counts as acceptable — and see how the grade would respond, using the reports currently in view. Nothing here changes real data, saved settings, or any live report.';

  return (
    <div className="space-y-5 animate-fade-in">
      <div className="content-card p-5">
        <div className="flex items-start gap-3">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0" style={{ background: 'rgba(74,93,63,0.10)' }}>
            <FlaskConical size={17} className="text-[#4a5d3f]" />
          </div>
          <div>
            <div className="text-sm font-bold text-[#201f1b]">What-If Simulator</div>
            <p className="text-xs text-[#8a8477] leading-relaxed mt-0.5 max-w-2xl">{introText}</p>
          </div>
        </div>
      </div>

      <div className="flex bg-[#f5f1e6] p-1 rounded-2xl border border-[#1f1e1a]/8 self-start w-fit gap-1.5">
        {Object.entries(MODE_META).map(([key, meta]) => (
          <button
            key={key}
            onClick={() => setMode(key)}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-bold transition-all cursor-pointer ${
              mode === key
                ? 'bg-[#4a5d3f] text-white shadow-lg shadow-[#4a5d3f]/20 border border-[#4a5d3f]'
                : 'text-[#8a8477] hover:text-[#201f1b] hover:bg-[#4a5d3f]/8 border border-transparent'
            }`}
          >
            {meta.icon && <meta.icon size={14} />}
            {meta.short}
          </button>
        ))}
      </div>

      {mode !== 'staffing' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {/* Policy inputs */}
          <div className="content-card">
            <div className="content-card-header">
              <div className="content-card-title">Policy inputs</div>
              <button
                onClick={resetActive}
                className="flex items-center gap-1.5 text-[11px] font-bold text-[#8a8477] hover:text-[#4a5d3f] cursor-pointer"
              >
                <RotateCcw size={12} />
                Reset to current policy
              </button>
            </div>
            <div className="p-5 space-y-5">
              <div>
                <div className="text-[10px] font-bold text-[#8a8477] uppercase tracking-wider mb-2.5">
                  Domain weight — relative importance, not required to sum to 100
                </div>
                <div className="space-y-2.5">
                  {Object.keys(weights).map((key) => (
                    <WeightSlider
                      key={key}
                      label={labels ? labels[key] : key}
                      value={weights[key]}
                      effectivePct={weightPct[key]}
                      onChange={(v) => setWeights((prev) => ({ ...prev, [key]: v }))}
                    />
                  ))}
                </div>
              </div>

              {mode === 'spi' && (
                <div>
                  <div className="text-[10px] font-bold text-[#8a8477] uppercase tracking-wider mb-2.5">
                    Stage SLA target (days)
                  </div>
                  <div className="space-y-2">
                    {SPI_TARGET_KEYS.map((key) => (
                      <TargetInput
                        key={key}
                        label={SPI_LABELS[key]}
                        value={spiTargets[key]}
                        unit="days"
                        onChange={(v) => setSpiTargets((prev) => ({ ...prev, [key]: v }))}
                      />
                    ))}
                  </div>
                </div>
              )}

              {mode === 'uci' && (
                <div>
                  <div className="text-[10px] font-bold text-[#8a8477] uppercase tracking-wider mb-2.5">
                    Open-burden tolerance per category
                  </div>
                  <div className="space-y-2">
                    {Object.keys(uciTargets).map((key) => (
                      <TargetInput
                        key={key}
                        label={key}
                        value={uciTargets[key]}
                        unit="cap"
                        onChange={(v) => setUciTargets((prev) => ({ ...prev, [key]: v }))}
                      />
                    ))}
                  </div>
                </div>
              )}

              {mode === 'ifi' && (
                <p className="text-[11px] text-[#8a8477] leading-relaxed">
                  IFI scores each zone relative to the city's own average rather than a fixed policy
                  target, so there's no cap to tune here — only how much each of the three signals
                  should count toward the composite score.
                </p>
              )}
            </div>
          </div>

          {/* Comparison */}
          <div className="content-card">
            <div className="content-card-header">
              <div className="content-card-title">Current vs. simulated</div>
              <div className="text-[10px] font-semibold text-[#8a8477]">
                {filteredReports.length} reports in view
              </div>
            </div>
            <div className="p-5 space-y-5">
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-xl p-3.5" style={{ background: 'rgba(31,30,26,0.03)' }}>
                  <div className="text-[10px] font-bold text-[#8a8477] uppercase tracking-wider mb-1.5">
                    Current policy
                  </div>
                  <GradeChip score={currentResult?.index} />
                </div>
                <div className="rounded-xl p-3.5" style={{ background: 'rgba(74,93,63,0.06)' }}>
                  <div className="text-[10px] font-bold text-[#4a5d3f] uppercase tracking-wider mb-1.5">
                    Simulated policy
                  </div>
                  <GradeChip score={simulated?.index} />
                  <div className="mt-1.5"><Delta from={currentResult?.index} to={simulated?.index} /></div>
                </div>
              </div>

              <div>
                <div className="text-[10px] font-bold text-[#8a8477] uppercase tracking-wider mb-2">
                  Per-domain score
                </div>
                <div className="space-y-1.5">
                  {Object.entries(simulated?.domains || {}).map(([key, d]) => {
                    const curD = currentResult?.domains?.[key];
                    return (
                      <div key={key} className="flex items-center justify-between text-xs py-1 border-b border-[#1f1e1a]/6 last:border-0">
                        <span className="font-semibold text-[#3d3a30] truncate pr-2">{d.name || key}</span>
                        <div className="flex items-center gap-3 shrink-0">
                          <span className="text-[#8a8477] w-8 text-right">{curD?.score ?? '—'}</span>
                          <span className="text-[#8a8477]">→</span>
                          <span className="font-bold text-[#201f1b] w-8 text-right">{d.score ?? '—'}</span>
                          <Delta from={curD?.score} to={d.score} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {mode === 'staffing' && (
        roster.length === 0 ? (
          <div className="content-card p-6 text-center text-sm text-[#8a8477]">
            No team data available yet — this needs at least one department with staff on record.
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            <div className="content-card">
              <div className="content-card-header">
                <div className="content-card-title">Department &amp; capacity</div>
                <button
                  onClick={resetActive}
                  className="flex items-center gap-1.5 text-[11px] font-bold text-[#8a8477] hover:text-[#4a5d3f] cursor-pointer"
                >
                  <RotateCcw size={12} />
                  Reset workers
                </button>
              </div>
              <div className="p-5 space-y-5">
                <div className="flex flex-wrap gap-1.5">
                  {roster.map((r) => (
                    <button
                      key={r.key}
                      onClick={() => { setSelectedDept(r.key); setSimulatedWorkers(null); }}
                      className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                        activeDept === r.key
                          ? 'bg-[#4a5d3f] text-white'
                          : 'bg-[#f5f1e6] text-[#8a8477] hover:text-[#201f1b]'
                      }`}
                    >
                      {r.key}
                    </button>
                  ))}
                </div>

                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-bold text-[#8a8477] uppercase tracking-wider">Lookback window</span>
                  <div className="flex gap-1">
                    {WINDOW_OPTIONS.map((w) => (
                      <button
                        key={w}
                        onClick={() => setWindowDays(w)}
                        className={`px-2 py-1 rounded-md text-[11px] font-bold cursor-pointer ${
                          windowDays === w ? 'bg-[#4a5d3f] text-white' : 'bg-[#f5f1e6] text-[#8a8477]'
                        }`}
                      >
                        {w}d
                      </button>
                    ))}
                  </div>
                </div>

                {capacity && (
                  <div className="grid grid-cols-2 gap-3 text-xs">
                    <div className="rounded-lg p-3" style={{ background: 'rgba(31,30,26,0.03)' }}>
                      <div className="text-[10px] font-bold text-[#8a8477] uppercase tracking-wider mb-1">Open backlog now</div>
                      <div className="text-lg font-bold text-[#201f1b]">{capacity.backlogNow}</div>
                    </div>
                    <div className="rounded-lg p-3" style={{ background: 'rgba(31,30,26,0.03)' }}>
                      <div className="text-[10px] font-bold text-[#8a8477] uppercase tracking-wider mb-1">Arrivals / day</div>
                      <div className="text-lg font-bold text-[#201f1b]">{capacity.arrivalRate.toFixed(2)}</div>
                    </div>
                    <div className="rounded-lg p-3 col-span-2" style={{ background: 'rgba(31,30,26,0.03)' }}>
                      <div className="text-[10px] font-bold text-[#8a8477] uppercase tracking-wider mb-1">
                        Current resolution rate
                      </div>
                      <div className="text-lg font-bold text-[#201f1b]">
                        {capacity.throughputRate.toFixed(2)} reports/day
                        {activeTeam?.workerCount > 0 && (
                          <span className="text-xs font-semibold text-[#8a8477]">
                            {' '}across {activeTeam.workerCount} worker{activeTeam.workerCount === 1 ? '' : 's'}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                )}

                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[10px] font-bold text-[#8a8477] uppercase tracking-wider">
                      Workers assigned
                    </span>
                    <span className="text-sm font-bold text-[#4a5d3f]">{workers}</span>
                  </div>
                  <input
                    type="range" min={0} max={Math.max(10, (activeTeam?.workerCount ?? 0) + 5)} step={1}
                    value={workers}
                    onChange={(e) => setSimulatedWorkers(Number(e.target.value))}
                    className="w-full accent-[#4a5d3f]"
                  />
                  <div className="text-[10px] text-[#8a8477] mt-1">
                    Currently {activeTeam?.workerCount ?? 0} worker{(activeTeam?.workerCount ?? 0) === 1 ? '' : 's'}
                  </div>
                </div>
              </div>
            </div>

            <div className="content-card">
              <div className="content-card-header">
                <div className="content-card-title">Projected backlog</div>
                <div className="text-[10px] font-semibold text-[#8a8477]">next {PROJECTION_DAYS} days</div>
              </div>
              <div className="p-5 space-y-4">
                {!capacity?.sufficient ? (
                  <StaffingVerdict arrivalRate={capacity?.arrivalRate} netFlowPerDay={null} />
                ) : (
                  <>
                    <StaffingVerdict
                      arrivalRate={capacity.arrivalRate}
                      netFlowPerDay={simulatedCapacity?.netFlowPerDay}
                      daysToClear={simulatedCapacity?.daysToClear}
                      workersToBreakEven={simulatedCapacity?.workersToBreakEven}
                      simulatedWorkers={workers}
                    />
                    <div style={{ width: '100%', height: 200 }}>
                      <ResponsiveContainer>
                        <LineChart data={chartData} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="rgba(31,30,26,0.08)" />
                          <XAxis dataKey="day" stroke="#8a8477" fontSize={10} tickLine={false}
                            label={{ value: 'Days from now', position: 'insideBottom', offset: -2, fontSize: 10, fill: '#8a8477' }} />
                          <YAxis stroke="#8a8477" fontSize={10} tickLine={false} allowDecimals={false} />
                          <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                          <ReferenceLine y={0} stroke="rgba(31,30,26,0.15)" />
                          <Line type="monotone" dataKey="Current staffing" stroke="#8a8477" strokeWidth={2} dot={false} strokeDasharray="4 3" />
                          <Line type="monotone" dataKey="Simulated staffing" stroke="#4a5d3f" strokeWidth={2.5} dot={false} />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        )
      )}
    </div>
  );
}
