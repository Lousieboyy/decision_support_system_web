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
        <div className="mt-5 text-base font-bold text-[#8a8477]">Insufficient data</div>
      )}
      <div className="mt-3 text-[10px] text-[#8a8477] text-center leading-relaxed">
        {caption}
        {excludedCount > 0 && (
          <div className="mt-1 font-semibold">
            {excludedCount} of {totalDomains} domains omitted — insufficient data
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
      title: 'Service Performance Index',
      subtitle: 'Measures the council. Every input is an action the council controls.',
      rows: Object.entries(SPI_WEIGHTS).map(([k, w]) => ({
        key: k,
        weight: w,
        detail: SLA_TARGET_DAYS[k] != null
          ? `target ${SLA_TARGET_DAYS[k]}d · score = min(100, target ÷ median × 100)`
          : 'share of dispatched reports never re-pooled',
      })),
      footer: (
        <p>
          A stage needs {MIN_N_FOR_STAGE} reports to be scored. Scores cap at 100 —
          beating a target is not extra credit, it means the target needs revisiting.
        </p>
      ),
    },
    uci: {
      title: 'Urban Condition Index',
      subtitle: 'Measures the city. Deliberately excludes resolution rate, which describes council throughput rather than the condition of the city.',
      rows: Object.entries(UCI_WEIGHTS).map(([k, w]) => ({
        key: k,
        weight: w,
        detail: `tolerance ${UCI_BURDEN_TARGETS[k]} age-weighted open defects · score = 100 × (1 − burden ÷ tolerance)`,
      })),
      footer: (
        <p>
          <strong className="text-[#c1613f]">Policy input:</strong> the tolerances above are
          service standards to agree with the council, not measurements. Each open defect
          counts as 1, plus 1 more per {AGE_WEIGHT_DAYS} days it stays open.
        </p>
      ),
    },
    ifi: {
      title: 'Infrastructure Fragility Index',
      subtitle: 'Measures the zone, over its full history — the only index here that looks past what is currently open. Neither SPI nor UCI answers where infrastructure is weak by design rather than by bad luck.',
      rows: Object.entries(IFI_WEIGHTS).map(([k, w]) => ({
        key: k,
        weight: w,
        detail: {
          reportRate: `reports per 10,000 residents vs. city average · score 50 at the average, 100 at 2×`,
          failureRate: `% of resolved reports that reoccurred within ${REINCIDENCE.radiusM}m / ${REINCIDENCE.windowDays}d`,
          mtbf: `mean days between defects in the zone vs. city average · shorter gaps score worse`,
        }[k],
      })),
      footer: (
        <>
          <p>
            <strong className="text-[#c1613f]">Population source:</strong> Department of
            Statistics Malaysia, district-level 2024 figures — not per-neighborhood. Zones
            sharing a district share that district's population, so the report-rate
            component compares fairly within a district but not below it.
          </p>
          <p>
            A zone needs {MIN_N_FOR_INDEX} reports (its full history, not just open ones) to
            be scored. The headline figure is population-weighted across scored zones, so a
            fragile but tiny zone can't move the city number as much as a fragile, populous
            one.
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
              <th className="text-left pb-2">Domain</th>
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
            Weights are read from the constants module at runtime, so this table cannot
            drift from the values actually applied.
          </p>
          <p>
            When a domain has no data it is excluded and the remaining weights are
            renormalised to 1. The gauge states how many domains were omitted rather than
            substituting a default score.
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
export function CityHealthBands({ servicePerformance, urbanCondition, infrastructureFragility, backlogFlow, reportCount }) {
  const [methodology, setMethodology] = useState(null);

  const spiDomains = Object.values(servicePerformance.domains);
  const uciDomains = Object.values(urbanCondition.domains);
  const ifiZones = Object.values(infrastructureFragility.domains)
    .filter((d) => d.score != null)
    .sort((a, b) => a.score - b.score);
  const ifiUnscored = Object.keys(infrastructureFragility.domains).length - ifiZones.length;

  const flowData = backlogFlow.map((p) => ({
    week: format(new Date(p.weekEnd), 'MMM dd'),
    Open: p.open,
    Inflow: p.inflow,
    Resolved: p.outflow,
  }));

  return (
    <div className="space-y-8">
      {/* ── BAND A · SERVICE PERFORMANCE ───────────────────────────── */}
      <section className="space-y-4">
        <BandHeader
          title="Service Performance"
          subtitle="How well the council responds. Every input is a council action, scored against the agreed stage targets."
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
                    ? `median ${d.medianDays.toFixed(1)}d vs ${d.targetDays}d target · n=${d.n}`
                    : `${d.n} dispatched reports`
                }
                secondary={`Insufficient data — ${d.n} of ${d.key === 'firstPass' ? MIN_N_FOR_SCORE : MIN_N_FOR_STAGE} needed`}
              />
            ))}
          </div>
        </div>

        {/* Backlog & flow — a real point-in-time reconstruction. */}
        <div className="content-card">
          <div className="content-card-header">
            <div className="content-card-title">Backlog &amp; flow (12 weeks)</div>
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
                  <Line type="monotone" dataKey="Inflow" stroke="#6366f1" strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="Resolved" stroke="#4a5d3f" strokeWidth={2} dot={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
            <p className="text-[10px] text-[#8a8477] mt-2 leading-relaxed">
              <Info size={10} className="inline mr-1 -mt-0.5" />
              Open backlog reconstructed week by week from submission and resolution dates.
              Rejection date is inferred from the review timestamp, which is safe because a
              rejected report is never later approved.
            </p>
          </div>
        </div>
      </section>

      {/* ── BAND B · URBAN CONDITION ───────────────────────────────── */}
      <section className="space-y-4 pt-2 border-t border-[#1f1e1a]/10">
        <BandHeader
          title="Urban Condition"
          subtitle="The state of the city itself — the open defect burden the council is responding to. Largely outside its short-term control, and scored without reference to resolution rate."
          onMethodology={() => setMethodology('uci')}
        />

        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
          <IndexGauge
            value={urbanCondition.index}
            label="Urban Cond."
            caption="Open defects, weighted by age"
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
                  `${d.openCount} open · burden ${d.burden}/${d.target}` +
                  (d.medianAgeDays != null ? ` · median age ${Math.round(d.medianAgeDays)}d` : '')
                }
                secondary="Insufficient data — no reports in this category"
              />
            ))}
          </div>
        </div>
      </section>

      {/* ── BAND C · INFRASTRUCTURE FRAGILITY ──────────────────────── */}
      <section className="space-y-4 pt-2 border-t border-[#1f1e1a]/10">
        <BandHeader
          title="Infrastructure Fragility"
          subtitle="Where the city is breaking by design, not by bad luck — scored per zone against its own population, over full history rather than just what's open right now."
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
                No zone has {MIN_N_FOR_INDEX}+ reports with a known district yet — nothing to score.
              </div>
            ) : (
              <div className="p-5">
                <div style={{ height: Math.max(180, ifiZones.length * 32) }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={ifiZones} layout="vertical" margin={{ top: 5, right: 40, left: 10, bottom: 5 }}>
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
                                <div>{d.ratePer10k.toFixed(1)} per 10k residents</div>
                                {d.failureRatePct != null && <div>{d.failureRatePct}% of repairs reoccurred</div>}
                                {d.mtbfDays != null && <div>{Math.round(d.mtbfDays)}d between defects, avg</div>}
                                {d.driverLabel && <div className="pt-1 mt-1 border-t border-[#1f1e1a]/6 italic">Driven by: {d.driverLabel}</div>}
                              </div>
                            </div>
                          );
                        }}
                        cursor={{ fill: 'rgba(74,93,63,0.05)' }}
                      />
                      <ReferenceLine x={80} stroke="#15803d" strokeDasharray="4 4" />
                      <Bar dataKey="score" radius={[0, 4, 4, 0]} maxBarSize={18}>
                        {ifiZones.map((z) => (
                          <Cell key={z.zone} fill={scoreColor(z.score)} />
                        ))}
                        <LabelList dataKey="score" position="right" style={{ fontSize: 10, fontWeight: 700, fill: '#4b473d' }} />
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <p className="text-[10px] text-[#8a8477] mt-2">
                  Score = 100 − fragility, so higher is more durable. Dashed line marks 80, the start of a passing grade.
                  {ifiUnscored > 0 && ` ${ifiUnscored} zone${ifiUnscored === 1 ? '' : 's'} excluded — fewer than ${MIN_N_FOR_INDEX} reports, or no district mapping.`}
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
                        {infrastructureFragility.worst.zone} is the most fragile zone at {infrastructureFragility.worst.score} —
                        driven mainly by {infrastructureFragility.worst.driverLabel}. That points to
                        {infrastructureFragility.worst.driver === 'failureRate'
                          ? ' inspecting installation quality there, not dispatching faster.'
                          : infrastructureFragility.worst.driver === 'mtbf'
                          ? ' a proactive inspection schedule for this zone, rather than waiting for the next citizen report.'
                          : ' checking whether this zone is under-resourced relative to how often it actually breaks.'}
                      </>
                    ) : (
                      <>No zone is critically fragile — the lowest, {infrastructureFragility.worst.zone}, still scores {infrastructureFragility.worst.score}.</>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </section>

      {methodology && (
        <MethodologyPanel kind={methodology} onClose={() => setMethodology(null)} />
      )}
    </div>
  );
}
