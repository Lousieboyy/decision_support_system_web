import { useState } from 'react';
import {
  AreaChart, Area, Line, ComposedChart, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend,
} from 'recharts';
import { Info, X } from 'lucide-react';
import { format } from 'date-fns';
import {
  SPI_WEIGHTS, UCI_WEIGHTS, UCI_BURDEN_TARGETS, SLA_TARGET_DAYS,
  AGE_WEIGHT_DAYS, MIN_N_FOR_STAGE, MIN_N_FOR_SCORE, gradeFor,
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
  const isSPI = kind === 'spi';
  const rows = isSPI
    ? Object.entries(SPI_WEIGHTS).map(([k, w]) => ({
        key: k,
        weight: w,
        detail: SLA_TARGET_DAYS[k] != null
          ? `target ${SLA_TARGET_DAYS[k]}d · score = min(100, target ÷ median × 100)`
          : 'share of dispatched reports never re-pooled',
      }))
    : Object.entries(UCI_WEIGHTS).map(([k, w]) => ({
        key: k,
        weight: w,
        detail: `tolerance ${UCI_BURDEN_TARGETS[k]} age-weighted open defects · score = 100 × (1 − burden ÷ tolerance)`,
      }));

  return (
    <div className="fixed inset-0 z-[300] flex items-center justify-center p-4 bg-black/40" onClick={onClose}>
      <div
        className="bg-white rounded-2xl max-w-2xl w-full p-6 max-h-[80vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between mb-4">
          <div>
            <h3 className="text-lg font-black text-[#201f1b]">
              {isSPI ? 'Service Performance Index' : 'Urban Condition Index'}
            </h3>
            <p className="text-xs text-[#8a8477] mt-1">
              {isSPI
                ? 'Measures the council. Every input is an action the council controls.'
                : 'Measures the city. Deliberately excludes resolution rate, which describes council throughput rather than the condition of the city.'}
            </p>
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
          {isSPI ? (
            <p>
              A stage needs {MIN_N_FOR_STAGE} reports to be scored. Scores cap at 100 —
              beating a target is not extra credit, it means the target needs revisiting.
            </p>
          ) : (
            <p>
              <strong className="text-[#c1613f]">Policy input:</strong> the tolerances above are
              service standards to agree with the council, not measurements. Each open defect
              counts as 1, plus 1 more per {AGE_WEIGHT_DAYS} days it stays open.
            </p>
          )}
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
export function CityHealthBands({ servicePerformance, urbanCondition, backlogFlow, reportCount }) {
  const [methodology, setMethodology] = useState(null);

  const spiDomains = Object.values(servicePerformance.domains);
  const uciDomains = Object.values(urbanCondition.domains);

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

      {methodology && (
        <MethodologyPanel kind={methodology} onClose={() => setMethodology(null)} />
      )}
    </div>
  );
}
