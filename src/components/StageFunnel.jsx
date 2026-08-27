import { useMemo, useState } from 'react';
import { AlertTriangle, Info } from 'lucide-react';
import { buildFunnel, buildComposition, fmtDuration } from '../utils/analyticsMetrics';
import { MIN_N_FOR_STAGE } from '../utils/analyticsConstants';
import { StageEvidenceModal } from './StageEvidenceModal';

const SEGMENT_COLORS = {
  triage: '#6366f1',
  dispatch: '#0ea5e9',
  rework: '#d97757',
  poolWait: '#f59e0b',
  mobilise: '#8b5cf6',
  work: '#4a5d3f',
  verify: '#14b8a6',
};

/**
 * Where the time actually goes, between a citizen submitting a report and
 * the council signing it off — rebuilt as plain labeled bars in real time
 * units (minutes/hours/days) rather than a statistics chart, because
 * "0.3d" and a p25–p90 whisker line mean nothing to a reader who hasn't
 * been told what a percentile is. Stages without enough reports to trust a
 * typical time collapse into one line instead of an empty row each.
 *
 * Medians (not means) still drive the bars: municipal durations are heavily
 * right-skewed, and a handful of tickets awaiting budget approval would move
 * a mean by days without changing what a typical citizen experiences.
 *
 * The composition strip below deliberately switches to means, because only
 * means decompose additively — a stacked bar of medians would assert a
 * breakdown the arithmetic doesn't support.
 */
export function StageFunnel({ reports, dateFilterLabel }) {
  const [cohort, setCohort] = useState('all');
  const [selectedStageKey, setSelectedStageKey] = useState(null);

  const funnel = useMemo(
    () => buildFunnel(reports, { cohort, minN: MIN_N_FOR_STAGE }),
    [reports, cohort]
  );
  const composition = useMemo(() => buildComposition(reports), [reports]);
  const selectedStage = selectedStageKey ? funnel.stages.find((s) => s.key === selectedStageKey) : null;

  const anyMeasured = funnel.stages.some((s) => s.sufficient);
  const censored = funnel.stages.filter((s) => s.coverage < 0.5 && s.n > 0);
  const measuredStages = funnel.stages.filter((s) => s.sufficient);
  const thinStages = funnel.stages.filter((s) => !s.sufficient && s.n > 0);
  const maxMedian = Math.max(...measuredStages.map((s) => s.median), 0.0001);
  // The slowest measured stage, named plainly — "which step should I
  // actually look at" is the one thing this whole panel needs to answer.
  const bottleneck = measuredStages.length
    ? [...measuredStages].sort((a, b) => b.median - a.median)[0]
    : null;

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
          {dateFilterLabel}. Each bar is the typical time reports spend in that step.{' '}
          {cohort === 'all'
            ? 'Each stage covers however many reports have reached it so far.'
            : 'Resolved reports only, so every stage covers the same reports.'}
        </p>

        {!anyMeasured ? (
          <div className="py-12 text-center text-sm text-[#8a8477]">
            Not enough reports yet — no stage has {MIN_N_FOR_STAGE} or more to measure.
          </div>
        ) : (
          <>
            {bottleneck && (
              <div
                className="rounded-xl px-3 py-2.5 mb-4 text-xs font-semibold leading-relaxed"
                style={{ background: 'rgba(180,83,9,0.06)', color: '#8a4b0a' }}
              >
                <strong>{bottleneck.label}</strong> takes the longest — typically{' '}
                <strong>{fmtDuration(bottleneck.median)}</strong>, up to {fmtDuration(bottleneck.p90)} for
                slower cases. That's the step worth checking first.
              </div>
            )}

            <div className="space-y-3">
              {measuredStages.map((s) => (
                <button
                  key={s.key}
                  onClick={() => setSelectedStageKey((prev) => (prev === s.key ? null : s.key))}
                  className={`w-full text-left rounded-lg px-1.5 py-1 -mx-1.5 transition-colors hover:bg-[#4a5d3f]/5 ${
                    selectedStageKey === s.key ? 'bg-[#4a5d3f]/8' : ''
                  }`}
                >
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <span className="text-xs font-bold text-[#201f1b]">{s.label}</span>
                    <span className="text-xs font-black" style={{ color: SEGMENT_COLORS[s.key] }}>
                      {fmtDuration(s.median)}
                    </span>
                  </div>
                  <div className="h-2.5 rounded-full overflow-hidden" style={{ background: '#f5f1e6' }}>
                    <div
                      className="h-full rounded-full transition-all"
                      style={{ width: `${Math.max(4, (s.median / maxMedian) * 100)}%`, background: SEGMENT_COLORS[s.key] }}
                    />
                  </div>
                  <div className="text-[10px] text-[#8a8477] mt-1">
                    Up to {fmtDuration(s.p90)} for slower cases · {s.n} report{s.n === 1 ? '' : 's'}
                  </div>
                </button>
              ))}
            </div>

            {thinStages.length > 0 && (
              <p className="text-[11px] text-[#8a8477] mt-3 leading-relaxed">
                Not enough reports yet to show a typical time for{' '}
                {thinStages.map((s, i) => (
                  <span key={s.key}>
                    <button
                      onClick={() => setSelectedStageKey((prev) => (prev === s.key ? null : s.key))}
                      className="font-semibold underline decoration-dotted underline-offset-2 hover:text-[#201f1b]"
                    >
                      {s.label} ({s.n})
                    </button>
                    {i < thinStages.length - 1 ? (i === thinStages.length - 2 ? ' and ' : ', ') : ''}
                  </span>
                ))}
                .
              </p>
            )}

            <p className="text-[10px] text-[#8a8477] mt-2">
              Click any stage to see the individual reports behind it.
            </p>

            {selectedStage && (
              <StageEvidenceModal
                stage={selectedStage}
                color={SEGMENT_COLORS[selectedStage.key]}
                onClose={() => setSelectedStageKey(null)}
              />
            )}

            {/* Composition strip — means, because only means are additive.
                Requires every stage complete, so this cohort is small; below
                the reporting threshold a "mean" from 1-2 reports asserts a
                pattern the data can't back up, so it's shown as a caveat
                instead of a bar that looks authoritative. */}
            {composition.n > 0 && (
              <div className="mt-6 pt-5 border-t border-[#1f1e1a]/8">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[11px] font-bold text-[#4b473d] uppercase tracking-wide">
                    Share of end-to-end time
                  </span>
                  <span className="text-[11px] text-[#8a8477]">
                    from {composition.n} fully-complete report{composition.n === 1 ? '' : 's'}
                  </span>
                </div>

                {composition.n < MIN_N_FOR_STAGE ? (
                  <p className="text-xs text-[#8a8477] leading-relaxed">
                    Only {composition.n} report{composition.n === 1 ? '' : 's'} {composition.n === 1 ? 'has' : 'have'} gone
                    all the way through every stage so far — not enough to say where the total time
                    typically goes. This fills in once {MIN_N_FOR_STAGE}+ reports complete the full pipeline.
                  </p>
                ) : (
                  <>
                    {(() => {
                      const biggest = [...composition.segments].sort((a, b) => b.share - a.share)[0];
                      return biggest && biggest.share > 0 ? (
                        <p className="text-xs font-semibold leading-relaxed mb-2" style={{ color: '#8a4b0a' }}>
                          {biggest.label} is the biggest piece — {Math.round(biggest.share * 100)}% of the average{' '}
                          {fmtDuration(composition.meanTotalDays)} total. Click it below to see those reports.
                        </p>
                      ) : null;
                    })()}
                    <div className="flex h-6 rounded-lg overflow-hidden border border-[#1f1e1a]/8">
                      {composition.segments.map((seg) =>
                        seg.share > 0 ? (
                          <button
                            key={seg.key}
                            title={`${seg.label}: ${fmtDuration(seg.meanDays)} (${Math.round(seg.share * 100)}%)`}
                            onClick={() => setSelectedStageKey((prev) => (prev === seg.key ? null : seg.key))}
                            style={{ width: `${seg.share * 100}%`, background: SEGMENT_COLORS[seg.key] }}
                            className="transition-opacity hover:opacity-80 cursor-pointer"
                          />
                        ) : null
                      )}
                    </div>
                    <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2">
                      {composition.segments.filter((seg) => seg.share > 0).map((seg) => (
                        <button
                          key={seg.key}
                          onClick={() => setSelectedStageKey((prev) => (prev === seg.key ? null : seg.key))}
                          className="inline-flex items-center gap-1 text-[10px] text-[#4b473d] hover:text-[#201f1b]"
                        >
                          <span className="w-2 h-2 rounded-sm shrink-0" style={{ background: SEGMENT_COLORS[seg.key] }} />
                          {seg.label} {Math.round(seg.share * 100)}%
                        </button>
                      ))}
                    </div>
                    <p className="text-[10px] text-[#8a8477] mt-2 leading-relaxed">
                      <Info size={10} className="inline mr-1 -mt-0.5" />
                      Means are used here because only means decompose additively, so the segments
                      genuinely sum to the total. The bars above show medians, which better represent
                      the typical case.
                    </p>
                  </>
                )}
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
