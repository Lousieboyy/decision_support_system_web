import { useMemo, useState } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  ErrorBar, Cell, ReferenceLine,
} from 'recharts';
import { AlertTriangle, Info } from 'lucide-react';
import { buildFunnel, buildComposition } from '../utils/analyticsMetrics';
import { SLA_TARGET_DAYS, SLA_END_TO_END_DAYS, MIN_N_FOR_STAGE } from '../utils/analyticsConstants';

const SEGMENT_COLORS = {
  triage: '#6366f1',
  dispatch: '#0ea5e9',
  rework: '#d97757',
  poolWait: '#f59e0b',
  mobilise: '#8b5cf6',
  work: '#4a5d3f',
  verify: '#14b8a6',
};

const fmtDays = (v) => (v == null ? '—' : `${v.toFixed(1)}d`);

function StageTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="bg-white border border-[#1f1e1a]/10 rounded-lg p-3 text-xs shadow-lg">
      <div className="font-bold text-[#201f1b] mb-1">{d.label}</div>
      <div className="text-[#8a8477] mb-2">Owner: {d.owner}</div>
      {d.sufficient ? (
        <div className="space-y-0.5 text-[#4b473d]">
          <div>Median <strong className="text-[#201f1b]">{fmtDays(d.median)}</strong></div>
          <div>p25–p90 {fmtDays(d.p25)} – {fmtDays(d.p90)}</div>
          <div>Mean {fmtDays(d.mean)}</div>
          <div className="pt-1 text-[#8a8477]">
            n = {d.n} ({Math.round(d.coverage * 100)}% of reports)
          </div>
          {d.target != null && <div className="text-[#8a8477]">Target {fmtDays(d.target)}</div>}
        </div>
      ) : (
        <div className="text-[#8a8477]">
          Insufficient data — {d.n} of {MIN_N_FOR_STAGE} needed
        </div>
      )}
    </div>
  );
}

/**
 * Where the days actually go, between a citizen submitting a report and the
 * council signing it off.
 *
 * Medians are plotted rather than means because municipal durations are heavily
 * right-skewed: a handful of tickets waiting on budget approval move a mean by
 * days without changing what a typical citizen experiences. The p25–p90 whisker
 * puts the tail on the same row as the typical case, and p90 is the figure worth
 * alerting on.
 *
 * The composition strip below the bars deliberately switches to means, because
 * only means decompose additively — a stacked bar of medians would assert a
 * breakdown that the arithmetic does not support.
 */
export function StageFunnel({ reports, dateFilterLabel }) {
  const [cohort, setCohort] = useState('all');

  const funnel = useMemo(
    () => buildFunnel(reports, { cohort, minN: MIN_N_FOR_STAGE }),
    [reports, cohort]
  );
  const composition = useMemo(() => buildComposition(reports), [reports]);

  const chartData = funnel.stages.map((s) => ({
    ...s,
    target: SLA_TARGET_DAYS[s.key] ?? null,
    // Recharts needs a numeric value; unmeasured stages plot nothing.
    value: s.sufficient ? s.median : null,
    // ErrorBar takes [distance below, distance above] from the bar value.
    errorRange: s.sufficient && s.median != null ? [s.median - s.p25, s.p90 - s.median] : null,
  }));

  const anyMeasured = funnel.stages.some((s) => s.sufficient);
  const censored = funnel.stages.filter((s) => s.coverage < 0.5 && s.n > 0);

  return (
    <div className="content-card">
      <div className="content-card-header">
        <div className="content-card-title">
          Where the time goes — stage durations
        </div>
        <div className="flex items-center gap-2">
          {['all', 'resolved'].map((c) => (
            <button
              key={c}
              onClick={() => setCohort(c)}
              className={`px-3 py-1 rounded-lg text-[11px] font-bold transition-colors ${
                cohort === c
                  ? 'bg-[#4a5d3f] text-white'
                  : 'bg-[#f5f1e6] text-[#4b473d] hover:bg-[#4a5d3f]/10'
              }`}
            >
              {c === 'all' ? 'All reports' : 'Resolved only'}
            </button>
          ))}
        </div>
      </div>

      <div className="p-5">
        <p className="text-xs text-[#8a8477] mb-4">
          {dateFilterLabel}. Bars show the <strong className="text-[#4b473d]">median</strong> days
          in each stage; whiskers span p25–p90.{' '}
          {cohort === 'all'
            ? 'Each stage covers however many reports have reached it.'
            : 'Resolved reports only, so every stage covers the same reports.'}
        </p>

        {!anyMeasured ? (
          <div className="py-12 text-center text-sm text-[#8a8477]">
            Insufficient data — no stage yet has {MIN_N_FOR_STAGE} reports to measure.
          </div>
        ) : (
          <>
            <div style={{ height: 300 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} layout="vertical" margin={{ top: 5, right: 60, left: 10, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="rgba(31,30,26,0.08)" />
                  <XAxis
                    type="number"
                    stroke="#8a8477"
                    fontSize={11}
                    tickLine={false}
                    label={{ value: 'Days', position: 'insideBottom', offset: -2, fill: '#8a8477', fontSize: 10 }}
                  />
                  <YAxis
                    type="category"
                    dataKey="label"
                    stroke="#8a8477"
                    fontSize={11}
                    tickLine={false}
                    width={140}
                  />
                  <Tooltip content={<StageTooltip />} cursor={{ fill: 'rgba(74,93,63,0.05)' }} />
                  <ReferenceLine
                    x={SLA_END_TO_END_DAYS}
                    stroke="#b91c1c"
                    strokeDasharray="4 4"
                    label={{ value: `${SLA_END_TO_END_DAYS}d end-to-end target`, fill: '#b91c1c', fontSize: 9, position: 'top' }}
                  />
                  <Bar dataKey="value" radius={[0, 6, 6, 0]} maxBarSize={22}>
                    {chartData.map((d) => (
                      <Cell key={d.key} fill={SEGMENT_COLORS[d.key] || '#4a5d3f'} />
                    ))}
                    <ErrorBar dataKey="errorRange" width={4} strokeWidth={1.5} stroke="#8a8477" direction="x" />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* Per-stage n and coverage, so a thin stage can be discounted. */}
            <div className="mt-4 grid gap-1.5">
              {funnel.stages.map((s) => (
                <div key={s.key} className="flex items-center gap-3 text-[11px]">
                  <span className="w-2 h-2 rounded-sm shrink-0" style={{ background: SEGMENT_COLORS[s.key] }} />
                  <span className="w-36 text-[#4b473d] font-semibold truncate">{s.label}</span>
                  <span className="w-16 font-bold text-[#201f1b]">
                    {s.sufficient ? fmtDays(s.median) : '—'}
                  </span>
                  <span className="text-[#8a8477]">
                    {s.sufficient
                      ? `p90 ${fmtDays(s.p90)} · n=${s.n} · ${Math.round(s.coverage * 100)}%`
                      : `Insufficient data (n=${s.n})`}
                  </span>
                </div>
              ))}
            </div>

            {/* Composition strip — means, because only means are additive. */}
            {composition.n > 0 && (
              <div className="mt-6 pt-5 border-t border-[#1f1e1a]/8">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[11px] font-bold text-[#4b473d] uppercase tracking-wide">
                    Share of end-to-end time
                  </span>
                  <span className="text-[11px] text-[#8a8477]">
                    mean total {fmtDays(composition.meanTotalDays)} · n={composition.n}
                  </span>
                </div>
                <div className="flex h-6 rounded-lg overflow-hidden border border-[#1f1e1a]/8">
                  {composition.segments.map((seg) =>
                    seg.share > 0 ? (
                      <div
                        key={seg.key}
                        title={`${seg.label}: ${fmtDays(seg.meanDays)} (${Math.round(seg.share * 100)}%)`}
                        style={{ width: `${seg.share * 100}%`, background: SEGMENT_COLORS[seg.key] }}
                      />
                    ) : null
                  )}
                </div>
                <p className="text-[10px] text-[#8a8477] mt-2 leading-relaxed">
                  <Info size={10} className="inline mr-1 -mt-0.5" />
                  Means are used in this strip because only means decompose additively, so the
                  segments genuinely sum to the mean total. The bars above show medians, which
                  better represent the typical case. Complete resolved reports only.
                </p>
              </div>
            )}

            {/* Data-quality and survivorship disclosure. */}
            <div className="mt-4 space-y-1.5">
              {funnel.bouncedCount > 0 && (
                <p className="text-[11px] text-[#8a8477]">
                  <strong className="text-[#c1613f]">Rework:</strong> {funnel.bouncedCount} of{' '}
                  {funnel.dispatchedCount} dispatched reports were re-pooled at least once
                  {funnel.medianReleaseCount != null && ` (median ${funnel.medianReleaseCount} release${funnel.medianReleaseCount === 1 ? '' : 's'})`}.
                  First-pass yield {funnel.firstPassYield}%. Stages after rework describe only
                  each report's final cycle.
                </p>
              )}
              {censored.length > 0 && cohort === 'all' && (
                <p className="text-[11px] text-[#8a8477]">
                  <AlertTriangle size={11} className="inline mr-1 -mt-0.5 text-amber-700" />
                  Only {Math.round(censored[0].coverage * 100)}% of reports in this window have
                  reached {censored[0].label.toLowerCase()}; that figure describes the fastest cases.
                </p>
              )}
              {funnel.nonMonotonic > 0 && (
                <p className="text-[11px] text-[#8a8477]">
                  <AlertTriangle size={11} className="inline mr-1 -mt-0.5 text-amber-700" />
                  {funnel.nonMonotonic} out-of-order timestamp{funnel.nonMonotonic === 1 ? '' : 's'}{' '}
                  clamped to zero.
                </p>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
