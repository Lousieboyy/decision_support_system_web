import { useMemo, useState } from 'react';
import { RotateCcw, FlaskConical, Users, User, Minus, Plus, AlertTriangle } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { MapContainer, TileLayer, CircleMarker, Popup, Tooltip as LeafletTooltip } from 'react-leaflet';
import {
  SPI_WEIGHTS, UCI_WEIGHTS, UCI_BURDEN_TARGETS, IFI_WEIGHTS, SLA_TARGET_DAYS,
  gradeFor, GRADE_COLOR, GRADE_SCALE, MELAKA_ZONES, MELAKA_BOUNDS, ZONE_UNMAPPED,
} from '../utils/analyticsConstants';
import { buildServicePerformance, buildUrbanCondition, buildInfrastructureFragility, deriveZone } from '../utils/analyticsMetrics';
import { AUTHORITIES } from '../utils/authorities';

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

// A day-based target under ~1 isn't something people naturally picture —
// "0.25 days" reads as an abstract fraction, "6h" reads as a workday chunk.
function fmtHours(days) {
  const hours = Math.round(days * 24 * 10) / 10;
  return `${Number.isInteger(hours) ? hours : hours.toFixed(1)}h`;
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
        <div className="w-14 leading-tight shrink-0">
          <div className="text-[10px] text-[#8a8477]">{unit === 'days' ? 'days' : 'cap'}</div>
          {unit === 'days' && (
            <div className="text-[9px] font-bold text-[#4a5d3f]">{fmtHours(value)}</div>
          )}
        </div>
      </div>
    </div>
  );
}

function effectivePercents(weights) {
  const sum = Object.values(weights).reduce((s, v) => s + v, 0);
  return Object.fromEntries(Object.entries(weights).map(([k, v]) => [k, sum > 0 ? Math.round((v / sum) * 100) : 0]));
}

const ZONE_INSUFFICIENT_COLOR = '#8a8477';
function zoneMarkerColor(score) {
  const grade = gradeFor(score);
  return grade ? GRADE_COLOR[grade.grade] : ZONE_INSUFFICIENT_COLOR;
}

// ── Rebalance model ──────────────────────────────────────────────────────────
// Deliberately not a hiring/growth forecast: this system's report volume is
// too thin for a reliable historical throughput rate for most departments,
// and "0.34 reports/day" isn't a number anyone acts on anyway. Backlog count
// and worker count, on the other hand, are always known exactly, right now,
// for every department — no minimum-sample gate needed. So the question
// becomes "how well is the staff we already have distributed", answered with
// backlog-per-worker, and it's immediately actionable: moving someone
// between teams is a real button elsewhere in this app, unlike hiring.
function matchAuthority(text) {
  const lower = (text || '').toLowerCase();
  if (!lower) return null;
  return AUTHORITIES.find(
    (a) => lower.includes(a.abbr.toLowerCase()) || lower.includes(a.id.toLowerCase()) || lower.includes(a.name.toLowerCase())
  ) || null;
}

function buildRebalanceRoster(allReports, teams) {
  const roster = new Map();
  for (const t of teams || []) {
    const auth = matchAuthority(t.name);
    const key = auth ? auth.abbr : t.name;
    if (!roster.has(key)) {
      roster.set(key, { key, label: auth ? `${auth.abbr} — ${auth.name}` : t.name, workerCount: t.worker_count ?? 0, backlog: 0 });
    }
  }
  for (const r of allReports || []) {
    if (r?.status === 'Resolved' || r?.status === 'Rejected') continue;
    const auth = matchAuthority(r?.assigned_department);
    const key = auth?.abbr;
    if (key && roster.has(key)) roster.get(key).backlog += 1;
  }
  return [...roster.values()].sort((a, b) => a.key.localeCompare(b.key));
}

function loadPerWorker(backlog, workers) {
  return workers > 0 ? backlog / workers : null;
}

function spreadOf(values) {
  const valid = values.filter((v) => v != null);
  if (valid.length < 2) return null;
  return Math.max(...valid) - Math.min(...valid);
}

function rebalanceVerdict(currentSpread, simulatedSpread, strandedCount) {
  if (strandedCount > 0) {
    return {
      tone: '#b91c1c',
      text: `${strandedCount} department${strandedCount > 1 ? 's have' : ' has'} open reports and nobody
      assigned to work them right now.`,
    };
  }
  if (currentSpread == null || simulatedSpread == null) {
    return { tone: '#8a8477', text: 'Need at least two staffed departments to compare balance.' };
  }
  const diff = currentSpread - simulatedSpread;
  if (Math.abs(diff) < 0.5) {
    return {
      tone: '#8a8477',
      text: `About as balanced as today's split — a gap of ~${simulatedSpread.toFixed(1)} reports per worker between the busiest and quietest team.`,
    };
  }
  if (diff > 0) {
    return {
      tone: '#15803d',
      text: `More balanced than today — the gap between the busiest and quietest team drops from ~${currentSpread.toFixed(1)} to ~${simulatedSpread.toFixed(1)} reports per worker.`,
    };
  }
  return {
    tone: '#b91c1c',
    text: `Less balanced than today — the gap between the busiest and quietest team grows from ~${currentSpread.toFixed(1)} to ~${simulatedSpread.toFixed(1)} reports per worker.`,
  };
}

// A row of person icons instead of a bare range track — clicking icon i sets
// the count to i+1 (a star-rating pattern), and +/- handle 0 and going past
// the drawn row. Small integer counts (a handful of workers per department)
// are exactly the case this reads better than a slider for.
function WorkerPicker({ workers, onChange, minIcons = 8 }) {
  const iconCount = Math.max(minIcons, workers + 2);
  return (
    <div className="flex items-center gap-1.5">
      <button
        onClick={() => onChange(Math.max(0, workers - 1))}
        className="w-6 h-6 rounded-md flex items-center justify-center bg-[#f5f1e6] text-[#4a5d3f] hover:bg-[#4a5d3f]/15 cursor-pointer shrink-0 transition-colors"
        aria-label="Remove a worker"
      >
        <Minus size={12} />
      </button>
      <div className="flex flex-wrap gap-0.5 flex-1">
        {Array.from({ length: iconCount }).map((_, i) => (
          <button
            key={i}
            onClick={() => onChange(i + 1)}
            title={`Set to ${i + 1} worker${i === 0 ? '' : 's'}`}
            className="cursor-pointer transition-transform hover:scale-110"
          >
            <User
              size={18}
              fill={i < workers ? '#4a5d3f' : 'none'}
              stroke={i < workers ? '#4a5d3f' : '#c9c3b4'}
              strokeWidth={1.6}
            />
          </button>
        ))}
      </div>
      <button
        onClick={() => onChange(workers + 1)}
        className="w-6 h-6 rounded-md flex items-center justify-center bg-[#f5f1e6] text-[#4a5d3f] hover:bg-[#4a5d3f]/15 cursor-pointer shrink-0 transition-colors"
        aria-label="Add a worker"
      >
        <Plus size={12} />
      </button>
    </div>
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

  // Rebalance state — only departments the user has actually touched get an
  // entry; everyone else stays at their real current worker count.
  const rebalanceRoster = useMemo(() => buildRebalanceRoster(allReports, teams), [allReports, teams]);
  const [allocationOverrides, setAllocationOverrides] = useState({});

  const rebalanceRows = useMemo(() => rebalanceRoster.map((r) => {
    const simWorkers = allocationOverrides[r.key] ?? r.workerCount;
    return {
      ...r,
      simWorkers,
      currentLoad: loadPerWorker(r.backlog, r.workerCount),
      simulatedLoad: loadPerWorker(r.backlog, simWorkers),
    };
  }), [rebalanceRoster, allocationOverrides]);

  const totalPool = rebalanceRoster.reduce((s, r) => s + r.workerCount, 0);
  const totalAssigned = rebalanceRows.reduce((s, r) => s + r.simWorkers, 0);
  const currentSpread = spreadOf(rebalanceRows.map((r) => r.currentLoad));
  const simulatedSpread = spreadOf(rebalanceRows.map((r) => r.simulatedLoad));
  const strandedCount = rebalanceRows.filter((r) => r.simWorkers === 0 && r.backlog > 0).length;
  const verdict = rebalanceVerdict(currentSpread, simulatedSpread, strandedCount);

  const chartRows = useMemo(() => rebalanceRows.map((r) => ({
    name: r.key,
    'Current backlog/worker': r.currentLoad != null ? Math.round(r.currentLoad * 10) / 10 : 0,
    'Simulated backlog/worker': r.simulatedLoad != null ? Math.round(r.simulatedLoad * 10) / 10 : 0,
  })), [rebalanceRows]);

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

  // Zone map — IFI already scores per zone (its domains ARE zones), so that
  // one is reused directly. SPI and UCI don't have a per-zone breakdown
  // anywhere in the real app, so for those this re-runs the exact same
  // scoring function used above, scoped to just that zone's own reports,
  // with the exact same simulated weights/targets — the real formula, not an
  // approximation, just computed on a smaller slice of the same data.
  const zoneReportGroups = useMemo(() => {
    const groups = {};
    for (const r of filteredReports) {
      const zone = deriveZone(r);
      if (zone === ZONE_UNMAPPED) continue;
      if (!groups[zone]) groups[zone] = [];
      groups[zone].push(r);
    }
    return groups;
  }, [filteredReports]);

  const zoneResults = useMemo(() => {
    if (mode === 'ifi') {
      const out = {};
      for (const [zoneName, d] of Object.entries(simulated?.domains || {})) {
        out[zoneName] = { score: d.score, n: d.reportCount ?? 0 };
      }
      return out;
    }
    if (mode === 'spi' || mode === 'uci') {
      const out = {};
      for (const z of MELAKA_ZONES) {
        const zoneReports = zoneReportGroups[z.name] || [];
        if (zoneReports.length === 0) {
          out[z.name] = { score: null, n: 0 };
          continue;
        }
        const computed = mode === 'spi'
          ? buildServicePerformance(zoneReports, {
              weights: spiWeights,
              slaTargets: { ...SLA_TARGET_DAYS, ...spiTargets },
            })
          : buildUrbanCondition(zoneReports, { weights: uciWeights, burdenTargets: uciTargets });
        out[z.name] = { score: computed.index, n: zoneReports.length };
      }
      return out;
    }
    return {};
  }, [mode, zoneReportGroups, simulated, spiWeights, spiTargets, uciWeights, uciTargets]);

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
      setAllocationOverrides({});
    }
  };

  const weights = mode === 'spi' ? spiWeights : mode === 'uci' ? uciWeights : ifiWeights;
  const setWeights = mode === 'spi' ? setSpiWeights : mode === 'uci' ? setUciWeights : setIfiWeights;
  const weightPct = effectivePercents(weights);
  const labels = mode === 'spi' ? SPI_LABELS : mode === 'ifi' ? IFI_LABELS : null; // UCI labels are the category names themselves

  // IFI mode hidden per supervisor scope cut — its logic above (buildInfrastructureFragility
  // calls, zoneResults, weight reset) stays in place in case scope comes back; only the
  // mode button that makes it reachable is removed.
  const MODE_META = {
    spi: { short: 'SPI' },
    uci: { short: 'UCI' },
    staffing: { short: 'Staffing', icon: Users },
  };

  const introText = mode === 'staffing'
    ? "Move workers between departments and see backlog-per-worker rebalance live — this is about using who you already have, not hiring. Nothing here changes any real assignment."
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
        <>
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

          {/* Comparison + zone map — kept in the same column as the sliders
              on the left, so a reader never has to scroll away from the
              controls to see the map react to them. */}
          <div className="content-card">
            <div className="content-card-header">
              <div className="content-card-title">Zone map &amp; current vs. simulated</div>
              <div className="text-[10px] font-semibold text-[#8a8477]">
                {filteredReports.length} reports in view
              </div>
            </div>
            <div className="p-5 space-y-5">
              <div>
                <p className="text-[11px] text-[#8a8477] leading-relaxed mb-2">
                  Each dot is one zone. <b className="text-[#3d3a30]">Colour</b> is its grade under the policy
                  on the left; <b className="text-[#3d3a30]">size</b> is how many reports it has. Hover a dot
                  for its name and score — starts matching today, and shifts as you adjust a slider.
                </p>
                <div className="rounded-xl overflow-hidden border border-[#1f1e1a]/8" style={{ height: 260 }}>
                  <MapContainer
                    center={[2.1896, 102.2501]}
                    zoom={11}
                    maxBounds={MELAKA_BOUNDS}
                    maxBoundsViscosity={1.0}
                    style={{ height: '100%', width: '100%' }}
                  >
                    <TileLayer
                      attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                      url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                    />
                    {MELAKA_ZONES.map((z) => {
                      const result = zoneResults[z.name];
                      const color = zoneMarkerColor(result?.score);
                      const n = result?.n ?? 0;
                      return (
                        <CircleMarker
                          key={z.name}
                          center={[z.lat, z.lng]}
                          radius={n > 0 ? Math.min(18, 8 + Math.sqrt(n) * 2) : 5}
                          pathOptions={{ color, fillColor: color, fillOpacity: result?.score != null ? 0.75 : 0.2, weight: 2 }}
                        >
                          <LeafletTooltip direction="top" offset={[0, -4]} opacity={0.95}>
                            <div style={{ fontSize: 11, lineHeight: 1.4 }}>
                              <div style={{ fontWeight: 700 }}>{z.name}</div>
                              {result?.score != null ? (
                                <div style={{ color, fontWeight: 700 }}>{result.score} · {gradeFor(result.score)?.grade} — {gradeFor(result.score)?.label}</div>
                              ) : (
                                <div style={{ color: '#8a8477' }}>Not enough data ({n} report{n === 1 ? '' : 's'})</div>
                              )}
                            </div>
                          </LeafletTooltip>
                          <Popup>
                            <div style={{ fontSize: 12, minWidth: 140 }}>
                              <div style={{ fontWeight: 700 }}>{z.name}</div>
                              {result?.score != null ? (
                                <div style={{ color, fontWeight: 700 }}>{result.score} · {gradeFor(result.score)?.grade} — {gradeFor(result.score)?.label}</div>
                              ) : (
                                <div style={{ color: '#8a8477' }}>Not enough data ({n} report{n === 1 ? '' : 's'})</div>
                              )}
                            </div>
                          </Popup>
                        </CircleMarker>
                      );
                    })}
                  </MapContainer>
                </div>
                <div className="flex flex-wrap gap-x-3 gap-y-1.5 mt-2.5">
                  {GRADE_SCALE.map((g) => (
                    <span key={g.grade} className="flex items-center gap-1.5 text-[10px] font-bold" style={{ color: GRADE_COLOR[g.grade] }}>
                      <span className="w-2 h-2 rounded-full inline-block" style={{ background: GRADE_COLOR[g.grade] }} />
                      {g.grade} {g.label}
                    </span>
                  ))}
                  <span className="flex items-center gap-1.5 text-[10px] font-bold" style={{ color: ZONE_INSUFFICIENT_COLOR }}>
                    <span className="w-2 h-2 rounded-full inline-block" style={{ background: ZONE_INSUFFICIENT_COLOR }} />
                    Not enough data
                  </span>
                </div>
              </div>

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
        </>
      )}

      {mode === 'staffing' && (
        rebalanceRoster.length === 0 ? (
          <div className="content-card p-6 text-center text-sm text-[#8a8477]">
            No team data available yet — this needs at least one department with staff on record.
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            <div className="content-card">
              <div className="content-card-header">
                <div className="content-card-title">Reallocate workers</div>
                <button
                  onClick={resetActive}
                  className="flex items-center gap-1.5 text-[11px] font-bold text-[#8a8477] hover:text-[#4a5d3f] cursor-pointer"
                >
                  <RotateCcw size={12} />
                  Reset
                </button>
              </div>
              <div className="p-5 space-y-4">
                <div
                  className="flex items-center justify-between px-3 py-2 rounded-lg text-xs font-bold"
                  style={{
                    background: totalAssigned === totalPool ? 'rgba(21,128,61,0.08)' : 'rgba(180,83,9,0.08)',
                    color: totalAssigned === totalPool ? '#15803d' : '#b45309',
                  }}
                >
                  <span>{totalAssigned} of {totalPool} real workers assigned</span>
                  {totalAssigned !== totalPool && (
                    <span>{totalAssigned > totalPool ? `+${totalAssigned - totalPool} modeled as new hires` : `${totalPool - totalAssigned} left unassigned`}</span>
                  )}
                </div>

                <div className="space-y-3">
                  {rebalanceRows.map((r) => (
                    <div key={r.key} className="rounded-xl p-3" style={{ background: 'rgba(31,30,26,0.03)' }}>
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="text-xs font-bold text-[#201f1b]">{r.key}</span>
                        <span className="text-[11px] font-semibold text-[#8a8477]">
                          {r.backlog} open report{r.backlog === 1 ? '' : 's'}
                        </span>
                      </div>
                      <WorkerPicker
                        workers={r.simWorkers}
                        onChange={(v) => setAllocationOverrides((prev) => ({ ...prev, [r.key]: v }))}
                      />
                      <div className="flex items-center justify-between mt-1.5 text-[11px]">
                        <span className="text-[#8a8477]">Currently {r.workerCount} worker{r.workerCount === 1 ? '' : 's'}</span>
                        {r.simWorkers === 0 && r.backlog > 0 ? (
                          <span className="flex items-center gap-1 font-bold" style={{ color: '#b91c1c' }}>
                            <AlertTriangle size={11} /> nobody assigned
                          </span>
                        ) : (
                          <span className="font-bold text-[#4a5d3f]">
                            {r.simulatedLoad != null ? `${r.simulatedLoad.toFixed(1)} / worker` : '—'}
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="content-card">
              <div className="content-card-header">
                <div className="content-card-title">Balance, before vs. after</div>
              </div>
              <div className="p-5 space-y-4">
                <p className="text-xs leading-relaxed font-semibold" style={{ color: verdict.tone }}>
                  {verdict.text}
                </p>
                <div style={{ width: '100%', height: 220 }}>
                  <ResponsiveContainer>
                    <BarChart data={chartRows} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(31,30,26,0.08)" />
                      <XAxis dataKey="name" stroke="#8a8477" fontSize={11} tickLine={false} />
                      <YAxis stroke="#8a8477" fontSize={10} tickLine={false} allowDecimals={false}
                        label={{ value: 'Backlog / worker', angle: -90, position: 'insideLeft', fontSize: 10, fill: '#8a8477' }} />
                      <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                      <Legend wrapperStyle={{ fontSize: 11 }} />
                      <Bar dataKey="Current backlog/worker" fill="#c9c3b4" radius={[4, 4, 0, 0]} maxBarSize={36} isAnimationActive={false} />
                      <Bar dataKey="Simulated backlog/worker" fill="#4a5d3f" radius={[4, 4, 0, 0]} maxBarSize={36} isAnimationActive={false} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>
          </div>
        )
      )}
    </div>
  );
}
