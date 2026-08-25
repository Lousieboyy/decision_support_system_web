import { X } from 'lucide-react';
import { format, parseISO } from 'date-fns';

/**
 * The reports behind whichever Overview chart element was just clicked (a
 * day, a category, a department, a status bucket) — a modal rather than a
 * card at the bottom of the page, which people scrolled straight past and
 * assumed clicking did nothing.
 */
export function ChartSpotlightModal({ spotlight, reports, onClose }) {
  if (!spotlight) return null;

  return (
    <>
      <div className="fixed inset-0 z-40" style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)' }} onClick={onClose} />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div
          className="w-full max-w-lg max-h-[85vh] flex flex-col rounded-2xl overflow-hidden"
          style={{ background: '#fff', boxShadow: '0 32px 80px rgba(31,30,26,0.25)' }}
        >
          <div className="flex items-center justify-between px-5 py-4 border-b border-[#1f1e1a]/8 shrink-0">
            <div>
              <div className="text-sm font-black text-[#201f1b]">{spotlight.label}</div>
              <div className="text-[11px] text-[#8a8477]">
                {reports.length} report{reports.length === 1 ? '' : 's'}
              </div>
            </div>
            <button onClick={onClose} className="p-2 rounded-full transition-colors" style={{ color: '#8a8477' }}>
              <X size={18} />
            </button>
          </div>

          <div className="p-5 overflow-y-auto">
            {reports.length === 0 ? (
              <div className="text-center text-[#8a8477] py-6 text-xs">No reports match.</div>
            ) : (
              <div className="space-y-2">
                {reports.map((r) => (
                  <div key={r.id} className="rounded-xl p-3 border border-[#1f1e1a]/8 flex items-center justify-between gap-3" style={{ background: 'var(--cream-100)' }}>
                    <div className="min-w-0">
                      <div className="text-xs font-bold text-[#201f1b] truncate">{r.address || r.location || 'Unknown location'}</div>
                      <div className="text-[10px] text-[#8a8477]">
                        {r.categories || 'Other'} · {r.assigned_department || 'Unassigned'}
                        {/* Date-only parse, not new Date(fullTimestamp) — the trend
                            chart buckets by the raw UTC date string, and converting
                            the full timestamp to local time here could roll the
                            displayed day forward/back across the same boundary,
                            showing "16 Aug" under a "Reports from Aug 15" header. */}
                        {r.timestamp && ` · ${format(parseISO(r.timestamp.split('T')[0]), 'd MMM yyyy')}`}
                      </div>
                    </div>
                    <span
                      className="text-[10px] font-black uppercase tracking-wide shrink-0"
                      style={{ color: r.status === 'Resolved' ? '#15803d' : r.status === 'Rejected' ? '#8a8477' : '#b45309' }}
                    >
                      {r.status}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
