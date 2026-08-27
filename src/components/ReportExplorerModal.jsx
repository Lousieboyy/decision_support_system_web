import { X } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { deriveZone } from '../utils/analyticsMetrics';

const fmtRowDate = (timestamp) => {
  if (!timestamp) return null;
  // Date-only parse, not new Date(fullTimestamp) — avoids a local-timezone
  // roll near midnight that would show a different day than the one a
  // date-range filter actually matched on.
  return format(parseISO(timestamp.split('T')[0]), 'd MMM yyyy');
};

const selectClass =
  'bg-[#f5f1e6] border border-[#1f1e1a]/12 rounded-lg px-2.5 py-1.5 text-xs font-bold text-[#201f1b] outline-none custom-select w-full';
const dateClass =
  'bg-[#f5f1e6] border border-[#1f1e1a]/12 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-[#201f1b] outline-none w-full';

/**
 * The single "find reports" tool behind all four Overview charts. It used
 * to be four separate single-dimension popups (click a day, OR a category,
 * OR a department) that couldn't be combined — finding "MBMB's Road Damage
 * reports from last week" meant three different clicks that each threw
 * away the others. Here every filter is live at once: a chart click just
 * pre-fills one field, and the rest stay adjustable in the same modal.
 */
export function ReportExplorerModal({ filters, onFiltersChange, categories, departments, statuses, zones, results, onClose }) {
  if (!filters) return null;

  const set = (field) => (e) => onFiltersChange({ ...filters, [field]: e.target.value });
  const isEmpty =
    !filters.dateFrom && !filters.dateTo &&
    filters.category === 'all' && filters.department === 'all' && filters.status === 'all' && filters.zone === 'all';

  return (
    <>
      <div className="fixed inset-0 z-40 overlay-fade-in" style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)' }} onClick={onClose} />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div
          className="w-full max-w-2xl max-h-[85vh] flex flex-col rounded-2xl overflow-hidden modal-pop-in"
          style={{ background: '#fff', boxShadow: '0 32px 80px rgba(31,30,26,0.25)' }}
        >
          <div className="flex items-center justify-between px-5 py-4 border-b border-[#1f1e1a]/8 shrink-0">
            <div>
              <div className="text-sm font-black text-[#201f1b]">Find Reports</div>
              <div className="text-[11px] text-[#8a8477]">
                {results.length} matching report{results.length === 1 ? '' : 's'}
              </div>
            </div>
            <button onClick={onClose} className="p-2 rounded-full transition-colors" style={{ color: '#8a8477' }}>
              <X size={18} />
            </button>
          </div>

          <div className="px-5 py-4 border-b border-[#1f1e1a]/8 shrink-0">
            <div className="grid grid-cols-2 gap-3 mb-3">
              <div>
                <label className="text-[10px] font-bold text-[#8a8477] uppercase tracking-wider block mb-1">From</label>
                <input type="datetime-local" value={filters.dateFrom} onChange={set('dateFrom')} className={dateClass} />
              </div>
              <div>
                <label className="text-[10px] font-bold text-[#8a8477] uppercase tracking-wider block mb-1">To</label>
                <input type="datetime-local" value={filters.dateTo} onChange={set('dateTo')} className={dateClass} />
              </div>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div>
                <label className="text-[10px] font-bold text-[#8a8477] uppercase tracking-wider block mb-1">Category</label>
                <select value={filters.category} onChange={set('category')} className={selectClass}>
                  <option value="all">All categories</option>
                  {categories.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-[10px] font-bold text-[#8a8477] uppercase tracking-wider block mb-1">Department</label>
                <select value={filters.department} onChange={set('department')} className={selectClass}>
                  <option value="all">All departments</option>
                  {departments.map((d) => (
                    <option key={d.key} value={d.key}>{d.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-[10px] font-bold text-[#8a8477] uppercase tracking-wider block mb-1">Zone</label>
                <select value={filters.zone} onChange={set('zone')} className={selectClass}>
                  <option value="all">All zones</option>
                  {zones.map((z) => (
                    <option key={z} value={z}>{z}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-[10px] font-bold text-[#8a8477] uppercase tracking-wider block mb-1">Status</label>
                <select value={filters.status} onChange={set('status')} className={selectClass}>
                  <option value="all">All statuses</option>
                  {statuses.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </div>
            </div>
            {!isEmpty && (
              <button
                onClick={() => onFiltersChange({ dateFrom: '', dateTo: '', category: 'all', department: 'all', status: 'all', zone: 'all' })}
                className="mt-3 text-[11px] font-bold text-[#8a8477] hover:text-[#201f1b]"
              >
                Clear all filters
              </button>
            )}
          </div>

          <div className="p-5 overflow-y-auto">
            {results.length === 0 ? (
              <div className="text-center text-[#8a8477] py-6 text-xs">No reports match these filters.</div>
            ) : (
              <div className="space-y-2">
                {results.map((r) => (
                  <div key={r.id} className="rounded-xl p-3 border border-[#1f1e1a]/8 flex items-center justify-between gap-3" style={{ background: 'var(--cream-100)' }}>
                    <div className="min-w-0">
                      <div className="text-xs font-bold text-[#201f1b] truncate">{r.address || r.location || 'Unknown location'}</div>
                      <div className="text-[10px] text-[#8a8477]">
                        {deriveZone(r)} · {r.categories || 'Other'} · {r.assigned_department || 'Unassigned'}
                        {fmtRowDate(r.timestamp) && ` · ${fmtRowDate(r.timestamp)}`}
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
