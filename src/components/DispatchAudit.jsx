import { Info, AlertTriangle } from 'lucide-react';
import { REINCIDENCE, SLA_END_TO_END_DAYS, gradeFor, RISK_TONE, DEFAULT_RISK_TONE } from '../utils/analyticsConstants';

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

          <div className="overflow-x-auto">
            <table className="scorecard-table">
              <thead>
                <tr>
                  <th>Department</th>
                  <th>Repeat incidents</th>
                  <th>Resolved tickets</th>
                  <th>On-time rate</th>
                  <th>Grade</th>
                </tr>
              </thead>
              <tbody>
                {contractorAudit.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="text-center text-[#8a8477] py-8">
                      No department data available
                    </td>
                  </tr>
                ) : (
                  contractorAudit.map((d) => {
                    const grade = d.rate == null ? null : gradeFor(d.rate);
                    return (
                      <tr key={d.name}>
                        <td className="font-bold text-[#201f1b]">{d.name}</td>
                        <td>
                          <span className={d.reIncidence > 0 ? 'text-[#c1613f] font-bold' : 'text-[#4b473d]'}>
                            {d.reIncidence ?? 0}
                          </span>
                        </td>
                        <td className="text-[#4b473d]">{d.resolvedCount ?? '—'}</td>
                        <td>
                          {d.rate == null ? (
                            <span className="text-[#8a8477]">—</span>
                          ) : (
                            <span className="font-bold" style={{ color: d.rate >= 80 ? '#15803d' : d.rate >= 60 ? '#b45309' : '#b91c1c' }}>
                              {d.rate}%
                            </span>
                          )}
                        </td>
                        <td>
                          {grade ? (
                            <span className={`wellness-grade grade-${grade.grade}`}>{grade.grade}</span>
                          ) : (
                            <span
                              className="wellness-grade grade-NA"
                              title="No resolved tickets with both dates to measure"
                            >—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          <p className="text-[10px] text-[#8a8477] mt-3 leading-relaxed">
            On-time rate is the share of resolved tickets closed within{' '}
            {SLA_END_TO_END_DAYS} days, measured from submission. Tickets missing either
            date are excluded from both sides of the ratio rather than counted as on time.
          </p>

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
