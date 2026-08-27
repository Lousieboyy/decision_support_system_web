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
  IFI_WEIGHTS, REINCIDENCE, gradeFor,
} from '../utils/analyticsConstants';
import { fmtDuration } from '../utils/analyticsMetrics';

const HATCH = 'repeating-linear-gradient(135deg, rgba(31,30,26,.06) 0 6px, transparent 6px 12px)';

const scoreColor = (s) =>
  s == null ? '#8a8477' : s >= 80 ? '#15803d' : s >= 60 ? '#b45309' : '#b91c1c';

/** Radial gauge that degrades to an explicit unmeasured state. */
function IndexGauge({ value, label, caption, excludedCount, totalDomains }) {
  const grade = gradeFor(value);
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
        <div className="mt-5 text-base font-bold text-[#8a8477]">Not enough data</div>
      )}
      <div className="mt-3 text-[10px] text-[#8a8477] text-center leading-relaxed">
        {caption}
        {excludedCount > 0 && (
          <div className="mt-1 font-semibold">
            {excludedCount} of {totalDomains} categories left out — not enough data
          </div>
        )}
      </div>
    </div>
  );
}

/** Score card whose box model is identical whether or not the score exists. */
function DomainCard({ name, score, primary, secondary }) {
  const measured = score != null;
  return (
    <div className="domain-card">
      <div className="flex items-center justify-between mb-1">
        <span className="text-[10px] font-extrabold text-[#8a8477] uppercase tracking-wider truncate pr-2">
          {name}
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
      title: 'Service Performance Score',
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
      title: 'Urban Condition Score',
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
      title: 'Infrastructure Fragility Score',
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
export function CityHealthBands({ servicePerformance, urbanCondition, infrastructureFragility, backlogFlow, reportCount, activeBand, onBandChange, onZoneClick }) {
  const [methodology, setMethodology] = useState(null);

  const spiDomains = Object.values(servicePerformance.domains);
  const uciDomains = Object.values(urbanCondition.domains);
  const ifiZones = Object.values(infrastructureFragility.domains)
    .filter((d) => d.score != null)
    .sort((a, b) => a.score - b.score);
  const ifiUnscored = Object.keys(infrastructureFragility.domains).length - ifiZones.length;

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

  const flowData = backlogFlow.map((p) => ({
    week: format(new Date(p.weekEnd), 'MMM dd'),
    Open: p.open,
    'New Reports': p.inflow,
    Resolved: p.outflow,
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
          />
          <div className="lg:col-span-3 grid grid-cols-2 md:grid-cols-3 gap-3">
            {spiDomains.map((d) => (
              <DomainCard
                key={d.key}
                name={d.name}
                score={d.score}
                primary={
                  d.medianDays != null
                    ? `Typical (median) time: ${fmtDuration(d.medianDays)}, vs a target of ${fmtDuration(d.targetDays)} (based on ${d.n} reports)`
                    : `${d.n} dispatched reports`
                }
                secondary={`Not enough data — ${d.n} of ${d.key === 'firstPass' ? MIN_N_FOR_SCORE : MIN_N_FOR_STAGE} reports needed`}
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
                <ComposedChart data={flowData} margin={{ top: 5, right: 10, left: -18, bottom: 0 }}>
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
          />
          <div className="lg:col-span-3 grid grid-cols-2 md:grid-cols-3 gap-3">
            {uciDomains.map((d) => (
              <DomainCard
                key={d.key}
                name={d.name}
                score={d.score}
                primary={
                  `${d.openCount} open · current load ${d.burden} of ${d.target} allowed` +
                  (d.medianAgeDays != null ? ` · typical time open: ${Math.round(d.medianAgeDays)} days` : '')
                }
                secondary="Not enough data — no reports in this category"
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
            caption={`${ifiZones.length} zone${ifiZones.length === 1 ? '' : 's'} scored`}
            excludedCount={0}
            totalDomains={ifiZones.length}
          />

          <div className="lg:col-span-3 content-card">
            {ifiZones.length === 0 ? (
              <div className="p-8 text-center text-sm text-[#8a8477]">
                No zone yet has {MIN_N_FOR_INDEX}+ reports with a known district, so none can be scored.
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
