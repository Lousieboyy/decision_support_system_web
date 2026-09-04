import { useState } from 'react';
import { X, ChevronLeft, ChevronRight, FileDown } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { deriveZone, reportDurationDays, fmtDuration } from '../utils/analyticsMetrics';
import { getImageUrl } from '../api/reportsApi';

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

const PAGE_SIZE = 10;

// Renders nothing when there's no photo, rather than a placeholder box —
// most reports won't have one, and an empty frame on every row just adds
// visual noise without telling the admin anything.
function RowThumb({ report }) {
  const url = getImageUrl(report.completion_image_path || report.image_path);
  if (!url) {
    return (
      <div
        className="w-12 h-12 rounded-lg shrink-0 flex items-center justify-center text-[8px] font-bold uppercase tracking-wide text-center"
        style={{ background: 'rgba(31,30,26,0.05)', color: '#8a8477' }}
      >
        No photo
      </div>
    );
  }
  return (
    <img
      src={url}
      alt={report.categories || ''}
      loading="lazy"
      className="w-12 h-12 rounded-lg object-cover shrink-0 border border-[#1f1e1a]/10"
    />
  );
}

/**
 * The single "find reports" tool behind all four Overview charts. It used
 * to be four separate single-dimension popups (click a day, OR a category,
 * OR a department) that couldn't be combined — finding "MBMB's Road Damage
 * reports from last week" meant three different clicks that each threw
 * away the others. Here every filter is live at once: a chart click just
 * pre-fills one field, and the rest stay adjustable in the same modal.
 */
export function ReportExplorerModal({ filters, onFiltersChange, categories, departments, statuses, zones, results, onClose }) {
  const [page, setPage] = useState(1);
  // A new filter selection should always land back on page 1 — staying on
  // page 3 of a list that just shrank to one page would either show
  // nothing or an out-of-range slice. Reset during render (React's own
  // documented pattern for "adjust state when a prop changes") rather
  // than an effect, since `filters` is a fresh object every time a filter
  // changes — comparing references here is exactly as reliable and skips
  // the extra render an effect-based reset would cost.
  const [prevFilters, setPrevFilters] = useState(filters);
  if (filters !== prevFilters) {
    setPrevFilters(filters);
    setPage(1);
  }

  if (!filters) return null;

  const set = (field) => (e) => onFiltersChange({ ...filters, [field]: e.target.value });
  const isEmpty =
    !filters.dateFrom && !filters.dateTo &&
    filters.category === 'all' && filters.department === 'all' && filters.status === 'all' && filters.zone === 'all' &&
    filters.durationMin === '' && filters.durationMax === '';

  const totalPages = Math.max(1, Math.ceil(results.length / PAGE_SIZE));
  const pageResults = results.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  // A human-readable line describing whatever filters produced this list, so
  // the PDF still makes sense once it's been saved, printed, or forwarded
  // and separated from the modal that made it.
  const filterSummary = isEmpty
    ? 'No filters applied — every report.'
    : [
        filters.dateFrom && `From ${fmtRowDate(filters.dateFrom)}`,
        filters.dateTo && `To ${fmtRowDate(filters.dateTo)}`,
        filters.category !== 'all' && `Category: ${filters.category}`,
        filters.department !== 'all' && `Department: ${filters.department}`,
        filters.zone !== 'all' && `Zone: ${filters.zone}`,
        filters.status !== 'all' && `Status: ${filters.status}`,
        filters.durationMin !== '' && `Min ${filters.durationMin}d open/to-resolve`,
        filters.durationMax !== '' && `Max ${filters.durationMax}d open/to-resolve`,
      ].filter(Boolean).join(' · ');

  const handleExportPDF = () => {
    const doc = new jsPDF({ orientation: 'landscape' });
    doc.setFontSize(16);
    doc.text('Find Reports — Export', 14, 17);
    doc.setFontSize(9);
    doc.setTextColor(120);
    doc.text(`${results.length} matching report${results.length === 1 ? '' : 's'} · Generated ${new Date().toLocaleString()}`, 14, 23);
    const summaryLines = doc.splitTextToSize(filterSummary, 260);
    doc.text(summaryLines, 14, 29);
    doc.setTextColor(0);

    // Truncated to fit ourselves, at the exact font/size the table uses,
    // rather than relying on autoTable's own overflow handling — its
    // wrap-then-ellipsize path was placing a cell's text a full row too
    // high whenever the untruncated string would have wrapped to 2 lines,
    // visually bleeding it into the row above.
    const TABLE_FONT_SIZE = 8;
    const fitText = (text, maxWidthMm) => {
      const str = String(text ?? '');
      doc.setFontSize(TABLE_FONT_SIZE);
      if (doc.getTextWidth(str) <= maxWidthMm) return str;
      let lo = 0, hi = str.length;
      while (lo < hi) {
        const mid = Math.ceil((lo + hi) / 2);
        if (doc.getTextWidth(str.slice(0, mid) + '…') <= maxWidthMm) lo = mid;
        else hi = mid - 1;
      }
      return str.slice(0, lo) + '…';
    };
    // cellWidth minus 2×cellPadding (2.5mm) from columnStyles below.
    const COLUMN_TEXT_WIDTH = [9, 19, 19, 50, 23, 63, 17, 33];

    autoTable(doc, {
      startY: 29 + summaryLines.length * 5 + 4,
      head: [['ID', 'Status', 'Category', 'Department', 'Zone', 'Location', 'Reported', 'Duration']],
      body: results.map((r) => {
        const days = reportDurationDays(r);
        return [
          `#${r.id}`,
          r.status || 'Pending',
          r.categories || 'Other',
          r.assigned_department || 'Unassigned',
          deriveZone(r),
          r.address || r.location || 'Unknown location',
          fmtRowDate(r.timestamp) || '—',
          days == null ? '—' : (r.status === 'Resolved' ? `Took ${fmtDuration(days)}` : `Open ${fmtDuration(days)}`),
        ].map((cell, i) => fitText(cell, COLUMN_TEXT_WIDTH[i]));
      }),
      styles: { fontSize: TABLE_FONT_SIZE, cellPadding: 2.5 },
      columnStyles: {
        0: { cellWidth: 14 },
        1: { cellWidth: 24 },
        2: { cellWidth: 24 },
        3: { cellWidth: 55 },
        4: { cellWidth: 28 },
        5: { cellWidth: 68 },
        6: { cellWidth: 22 },
      },
      headStyles: { fillColor: [74, 93, 63] },
      alternateRowStyles: { fillColor: [245, 241, 230] },
    });

    doc.save(`find_reports_${new Date().toISOString().slice(0, 10)}.pdf`);
  };

  return (
    <>
      <div className="fixed inset-0 z-40 overlay-fade-in" style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)' }} onClick={onClose} />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div
          className="w-full max-w-3xl max-h-[94vh] flex flex-col rounded-2xl overflow-hidden modal-pop-in"
          style={{ background: '#fff', boxShadow: '0 32px 80px rgba(31,30,26,0.25)' }}
        >
          <div className="flex items-center justify-between px-5 py-4 border-b border-[#1f1e1a]/8 shrink-0">
            <div className="min-w-0">
              <div className="text-sm font-black text-[#201f1b]">Find Reports</div>
              {/* Filters are all live-editable right here, so this modal is no
                  longer just "the result of the one thing you clicked" — the
                  count alone didn't say what it was currently scoped to. */}
              <div className="text-[11px] text-[#8a8477] truncate" title={isEmpty ? undefined : filterSummary}>
                {results.length} matching report{results.length === 1 ? '' : 's'}
                {!isEmpty && <> · {filterSummary}</>}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={handleExportPDF}
                disabled={results.length === 0}
                className="export-btn disabled:opacity-40 disabled:cursor-not-allowed"
                title="Export the matching reports as a PDF"
              >
                <FileDown size={14} /> PDF
              </button>
              <button onClick={onClose} className="p-2 rounded-full transition-colors" style={{ color: '#8a8477' }}>
                <X size={18} />
              </button>
            </div>
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
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
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
            {/* Days open/to-resolve — same reportDurationDays used on each
                row below, so filtering by it and reading it off a row use
                the exact same number, not two different definitions of
                "duration" that could disagree. */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[10px] font-bold text-[#8a8477] uppercase tracking-wider block mb-1">Min days open/to-resolve</label>
                <input
                  type="number"
                  min="0"
                  step="0.5"
                  value={filters.durationMin}
                  onChange={set('durationMin')}
                  placeholder="0"
                  className={dateClass}
                />
              </div>
              <div>
                <label className="text-[10px] font-bold text-[#8a8477] uppercase tracking-wider block mb-1">Max days open/to-resolve</label>
                <input
                  type="number"
                  min="0"
                  step="0.5"
                  value={filters.durationMax}
                  onChange={set('durationMax')}
                  placeholder="No limit"
                  className={dateClass}
                />
              </div>
            </div>
            {!isEmpty && (
              <button
                onClick={() => onFiltersChange({ dateFrom: '', dateTo: '', category: 'all', department: 'all', status: 'all', zone: 'all', durationMin: '', durationMax: '' })}
                className="mt-3 text-[11px] font-bold text-[#8a8477] hover:text-[#201f1b]"
              >
                Clear all filters
              </button>
            )}
          </div>

          <div className="p-5 overflow-y-auto flex-1">
            {results.length === 0 ? (
              <div className="text-center text-[#8a8477] py-6 text-xs">No reports match these filters.</div>
            ) : (
              <div className="space-y-2">
                {pageResults.map((r) => {
                  const days = reportDurationDays(r);
                  return (
                    <div key={r.id} className="rounded-xl p-3 border border-[#1f1e1a]/8 flex items-center gap-3" style={{ background: 'var(--cream-100)' }}>
                      <RowThumb report={r} />
                      <div className="min-w-0 flex-1">
                        <div className="text-xs font-bold text-[#201f1b] truncate">{r.address || r.location || 'Unknown location'}</div>
                        <div className="text-[10px] text-[#8a8477]">
                          {deriveZone(r)} · {r.categories || 'Other'} · {r.assigned_department || 'Unassigned'}
                          {fmtRowDate(r.timestamp) && ` · ${fmtRowDate(r.timestamp)}`}
                        </div>
                        {days != null && (
                          <div className="text-[10px] font-semibold mt-0.5" style={{ color: r.status === 'Resolved' ? '#15803d' : '#b45309' }}>
                            {r.status === 'Resolved' ? `Took ${fmtDuration(days)} to resolve` : `Open ${fmtDuration(days)}`}
                          </div>
                        )}
                      </div>
                      <span
                        className="text-[10px] font-black uppercase tracking-wide shrink-0"
                        style={{ color: r.status === 'Resolved' ? '#15803d' : r.status === 'Rejected' ? '#8a8477' : '#b45309' }}
                      >
                        {r.status}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {results.length > PAGE_SIZE && (
            <div className="flex items-center justify-between px-5 py-3 border-t border-[#1f1e1a]/8 shrink-0">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-bold cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed hover:bg-[#f5f1e6]"
                style={{ color: '#4b473d', border: '1px solid rgba(31,30,26,0.12)' }}
              >
                <ChevronLeft size={12} /> Prev
              </button>
              <span className="text-[11px] font-semibold text-[#8a8477]">
                Page {page} of {totalPages}
              </span>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-bold cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed hover:bg-[#f5f1e6]"
                style={{ color: '#4b473d', border: '1px solid rgba(31,30,26,0.12)' }}
              >
                Next <ChevronRight size={12} />
              </button>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
