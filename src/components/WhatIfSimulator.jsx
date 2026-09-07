import { useMemo, useState } from 'react';
import { RotateCcw, FlaskConical } from 'lucide-react';
import {
  SPI_WEIGHTS, UCI_WEIGHTS, UCI_BURDEN_TARGETS, IFI_WEIGHTS, SLA_TARGET_DAYS,
  gradeFor, GRADE_COLOR,
} from '../utils/analyticsConstants';
import { buildServicePerformance, buildUrbanCondition, buildInfrastructureFragility } from '../utils/analyticsMetrics';

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

export function WhatIfSimulator({ filteredReports, current }) {
  const [indexKind, setIndexKind] = useState('spi'); // 'spi' | 'uci' | 'ifi'

  const [spiWeights, setSpiWeights] = useState(() => {
    const pct = effectivePercents(SPI_WEIGHTS);
    return { ...pct };
  });
  const [spiTargets, setSpiTargets] = useState(() =>
    Object.fromEntries(SPI_TARGET_KEYS.map((k) => [k, SLA_TARGET_DAYS[k]]))
  );

  const [uciWeights, setUciWeights] = useState(() => effectivePercents(UCI_WEIGHTS));
  const [uciTargets, setUciTargets] = useState(() => ({ ...UCI_BURDEN_TARGETS }));

  const [ifiWeights, setIfiWeights] = useState(() => effectivePercents(IFI_WEIGHTS));

  const simulated = useMemo(() => {
    if (indexKind === 'spi') {
      return buildServicePerformance(filteredReports, {
        weights: spiWeights,
        slaTargets: { ...SLA_TARGET_DAYS, ...spiTargets },
      });
    }
    if (indexKind === 'uci') {
      return buildUrbanCondition(filteredReports, { weights: uciWeights, burdenTargets: uciTargets });
    }
    return buildInfrastructureFragility(filteredReports, { weights: ifiWeights });
  }, [indexKind, filteredReports, spiWeights, spiTargets, uciWeights, uciTargets, ifiWeights]);

  const currentResult = indexKind === 'spi' ? current.spi : indexKind === 'uci' ? current.uci : current.ifi;

  const resetActive = () => {
    if (indexKind === 'spi') {
      setSpiWeights(effectivePercents(SPI_WEIGHTS));
      setSpiTargets(Object.fromEntries(SPI_TARGET_KEYS.map((k) => [k, SLA_TARGET_DAYS[k]])));
    } else if (indexKind === 'uci') {
      setUciWeights(effectivePercents(UCI_WEIGHTS));
      setUciTargets({ ...UCI_BURDEN_TARGETS });
    } else {
      setIfiWeights(effectivePercents(IFI_WEIGHTS));
    }
  };

  const weights = indexKind === 'spi' ? spiWeights : indexKind === 'uci' ? uciWeights : ifiWeights;
  const setWeights = indexKind === 'spi' ? setSpiWeights : indexKind === 'uci' ? setUciWeights : setIfiWeights;
  const weightPct = effectivePercents(weights);
  const labels = indexKind === 'spi' ? SPI_LABELS : indexKind === 'ifi' ? IFI_LABELS : null; // UCI labels are the category names themselves

  const INDEX_META = {
    spi: { name: 'Service Performance', short: 'SPI', question: 'is the council fast enough?' },
    uci: { name: 'Urban Condition', short: 'UCI', question: 'how much is broken right now?' },
    ifi: { name: 'Infrastructure Fragility', short: 'IFI', question: 'which zones keep breaking?' },
  };

  return (
    <div className="space-y-5 animate-fade-in">
      <div className="content-card p-5">
        <div className="flex items-start gap-3">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0" style={{ background: 'rgba(74,93,63,0.10)' }}>
            <FlaskConical size={17} className="text-[#4a5d3f]" />
          </div>
          <div>
            <div className="text-sm font-bold text-[#201f1b]">What-If Simulator</div>
            <p className="text-xs text-[#8a8477] leading-relaxed mt-0.5 max-w-2xl">
              Adjust the policy inputs behind each index — how much weight a domain carries, or what
              target counts as acceptable — and see how the grade would respond, using the reports
              currently in view. Nothing here changes real data, saved settings, or any live report.
            </p>
          </div>
        </div>
      </div>

      <div className="flex bg-[#f5f1e6] p-1 rounded-2xl border border-[#1f1e1a]/8 self-start w-fit gap-1.5">
        {Object.entries(INDEX_META).map(([key, meta]) => (
          <button
            key={key}
            onClick={() => setIndexKind(key)}
            className={`px-4 py-2 rounded-xl text-sm font-bold transition-all cursor-pointer ${
              indexKind === key
                ? 'bg-[#4a5d3f] text-white shadow-lg shadow-[#4a5d3f]/20 border border-[#4a5d3f]'
                : 'text-[#8a8477] hover:text-[#201f1b] hover:bg-[#4a5d3f]/8 border border-transparent'
            }`}
          >
            {meta.short}
          </button>
        ))}
      </div>

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

            {indexKind === 'spi' && (
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

            {indexKind === 'uci' && (
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

            {indexKind === 'ifi' && (
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
    </div>
  );
}
