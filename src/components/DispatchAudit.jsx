import { Info, AlertTriangle } from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, LabelList,
} from 'recharts';
import { REINCIDENCE, SLA_END_TO_END_DAYS, gradeFor, RISK_TONE, DEFAULT_RISK_TONE } from '../utils/analyticsConstants';

const rateColor = (rate) => (rate == null ? '#8a8477' : rate >= 80 ? '#15803d' : rate >= 60 ? '#b45309' : '#b91c1c');

function ReliabilityTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  const grade = d.rate == null ? null : gradeFor(d.rate);
  return (
    <div className="bg-white border border-[#1f1e1a]/10 rounded-lg p-3 text-xs shadow-lg">
      <div className="font-bold text-[#201f1b] mb-1">{d.name}</div>
      <div className="text-[#4b473d] space-y-0.5">
        <div>{d.resolvedCount ?? 0} resolved tickets</div>
        <div>
          {d.reIncidence > 0 ? (
            <span className="text-[#c1613f] font-bold">{d.reIncidence} repeat failure{d.reIncidence === 1 ? '' : 's'}</span>
          ) : 'No repeat failures'}
        </div>
        {grade && <div>Grade <strong style={{ color: rateColor(d.rate) }}>{grade.grade}</strong></div>}
      </div>
    </div>
  );
}

/**
 * The two analytics that were computed on every render but never displayed.
 *
 * The dispatch queue ranks clusters by criticality so a duty officer can decide
 * where to send the next crew. The contractor audit answers a different and
 * harder question — whether a completed repair actually held — by looking for a
 * new complaint of the same category near a previously resolved one.
 */
export function DispatchAudit({ dispatchQueue, contractorAudit, auditActions }) {
  const auditAvailable = auditActions !== null;

  return (
    <div className="space-y-6">
      {/* ── Dispatch priority queue ─────────────────────────────── */}
      <div className="content-card">
        <div className="content-card-header">
          <div className="content-card-title">Dispatch priority queue</div>
          <span className="text-[11px] text-[#8a8477]">
            {dispatchQueue.length} cluster{dispatchQueue.length === 1 ? '' : 's'} ranked
          </span>
        </div>
        <div className="p-5">
          {dispatchQueue.length === 0 ? (
            <div className="py-8 text-center text-sm text-[#8a8477]">
              No clusters meet the current radius and density settings.
            </div>
          ) : (
            <div className="space-y-3">
              {dispatchQueue.slice(0, 8).map((item, i) => {
                const tone = RISK_TONE[item.primaryRisk] || DEFAULT_RISK_TONE;
                return (
                  <div
                    key={item.id}
                    className="rounded-xl p-4 border border-[#1f1e1a]/8"
                    style={{ background: 'var(--cream-100)' }}
                  >
                    <div className="flex items-start justify-between gap-3 flex-wrap">
                      <div className="flex items-start gap-3 min-w-0">
                        <span className="text-lg font-black text-[#8a8477] shrink-0 w-6">
                          {i + 1}
                        </span>
                        <div className="min-w-0">
                          <div className="text-sm font-bold text-[#201f1b] truncate">
                            {item.address || item.category || 'Cluster'}
                          </div>
                          <div className="text-[11px] text-[#8a8477] mt-0.5">
                            {item.size} report{item.size === 1 ? '' : 's'}
                            {item.upvotes > 0 && ` · ${item.upvotes} upvotes`}
                            {item.isSystemic && ' · systemic'}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-3 shrink-0">
                        <span
                          className="px-2 py-0.5 rounded-md text-[10px] font-black uppercase tracking-wide"
                          style={{ color: tone.color, background: tone.bg }}
                        >
                          {item.primaryRisk}
                        </span>
                        <div className="text-right">
                          <div className="text-xl font-black text-[#201f1b] leading-none">
                            {item.priorityScore}
                          </div>
                          <div className="text-[9px] text-[#8a8477] uppercase tracking-wider">
                            priority
                          </div>
                        </div>
                      </div>
                    </div>
                    {item.dispatchAdvice && (
                      <p className="text-[11px] text-[#4b473d] mt-2 pl-9 leading-relaxed">
                        {item.dispatchAdvice}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          )}
          <p className="text-[10px] text-[#8a8477] mt-4 leading-relaxed">
            <Info size={10} className="inline mr-1 -mt-0.5" />
            Score combines how many reports are in the cluster, citizen upvotes, how
            urgent the categories are, and how long they've been open — reports that
            are tightly clustered together and come from reporters with a track record
            of accurate reports count for more.
          </p>
        </div>
      </div>

      {/* ── Repeat-failure audit ────────────────────────────────── */}
      <div className="content-card">
        <div className="content-card-header">
          <div className="content-card-title">Repeat-failure audit</div>
          <span className="text-[11px] text-[#8a8477]">
            Did the fix hold?
          </span>
        </div>
        <div className="p-5">
          <p className="text-xs text-[#8a8477] mb-4 leading-relaxed">
            A new complaint of the same category within {REINCIDENCE.radiusM}m and{' '}
            {REINCIDENCE.windowDays} days of a resolved one suggests the earlier repair did
            not hold. This is the closest thing available to a measure of the city's actual
            condition rather than the council's response speed.
          </p>

          {contractorAudit.length === 0 ? (
            <div className="text-center text-[#8a8477] py-8 text-sm">No department data available</div>
          ) : (
            <div style={{ height: Math.max(120, contractorAudit.length * 44) }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={contractorAudit} layout="vertical" margin={{ top: 5, right: 60, left: 10, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="rgba(31,30,26,0.08)" />
                  <XAxis type="number" domain={[0, 100]} stroke="#8a8477" fontSize={10} tickLine={false} unit="%" />
                  <YAxis type="category" dataKey="name" stroke="#8a8477" fontSize={11} tickLine={false} width={170} />
                  <Tooltip content={<ReliabilityTooltip />} cursor={{ fill: 'rgba(74,93,63,0.05)' }} />
                  <Bar dataKey="rate" radius={[0, 4, 4, 0]} maxBarSize={26}>
                    {contractorAudit.map((d) => (
                      <Cell key={d.name} fill={rateColor(d.rate)} />
                    ))}
                    <LabelList
                      dataKey="rate"
                      position="right"
                      formatter={(v) => (v == null ? 'no data' : `${v}%`)}
                      style={{ fontSize: 10, fontWeight: 700, fill: '#4b473d' }}
                    />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          <p className="text-[10px] text-[#8a8477] mt-3 leading-relaxed">
            On-time rate is the share of resolved tickets closed within{' '}
            {SLA_END_TO_END_DAYS} days, measured from submission. Tickets missing either
            date are excluded from both sides of the ratio rather than counted as on time.
          </p>

          {/* A percentage alone doesn't say what to do — name whoever has
              actual repeat failures, since that's a different problem than
              a low on-time rate (repairs that don't hold vs. repairs that
              are just slow). */}
          {contractorAudit.length > 0 && (() => {
            const worst = [...contractorAudit].sort((a, b) => (b.reIncidence || 0) - (a.reIncidence || 0))[0];
            return worst.reIncidence > 0 ? (
              <div className="mt-3 rounded-lg px-3 py-2 text-xs font-semibold" style={{ background: 'rgba(185,28,28,0.06)', color: '#b91c1c' }}>
                {worst.name} has the most repeat failures ({worst.reIncidence}) — worth checking whether the problem
                is how it repairs, not just how fast.
              </div>
            ) : (
              <div className="mt-3 rounded-lg px-3 py-2 text-xs font-semibold" style={{ background: 'rgba(21,128,61,0.06)', color: '#15803d' }}>
                No department has a repeat failure right now — repairs are holding.
              </div>
            );
          })()}

          {!auditAvailable && (
            <p className="text-[10px] text-[#8a8477] mt-2 leading-relaxed">
              <AlertTriangle size={10} className="inline mr-1 -mt-0.5 text-amber-700" />
              Estimated from report timestamps. Per-cycle detail — who handled each
              attempt, and how long each abandoned cycle took — requires the workflow
              audit endpoint, which this backend does not serve.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
