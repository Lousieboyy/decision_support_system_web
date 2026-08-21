import { Info } from 'lucide-react';
import { RISK_TONE, DEFAULT_RISK_TONE } from '../utils/analyticsConstants';
import { ClusterDispatchAction } from './ClusterDispatchAction';

/**
 * The dispatch queue ranks clusters by criticality so a duty officer can decide
 * where to send the next crew. The repair-reliability breakdown (was a second
 * section on this tab) now lives in its own modal off the Repair Reliability
 * card, opened without leaving the Overview tab.
 */
export function DispatchAudit({ dispatchQueue, onDispatched }) {
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
                    <div className="mt-2 pl-9 flex">
                      <ClusterDispatchAction item={item} onDispatched={onDispatched} />
                    </div>
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
    </div>
  );
}
