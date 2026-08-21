import { X } from 'lucide-react';
import { format } from 'date-fns';

const fmtDate = (v) => {
  if (!v) return 'unknown date';
  const d = new Date(v);
  return isNaN(d.getTime()) ? 'unknown date' : format(d, 'd MMM yyyy HH:mm');
};

const fmtDays = (v) => (v == null ? '—' : `${v.toFixed(1)}d`);

/**
 * The report-level evidence behind one stage's median/p90 numbers, in a
 * modal rather than an inline drop-down — an expanding section below the
 * chart is easy to miss or skip past; a modal is the thing people actually
 * stop and read.
 */
export function StageEvidenceModal({ stage, color, onClose }) {
  if (!stage) return null;

  return (
    <>
      <div className="fixed inset-0 z-40" style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)' }} onClick={onClose} />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div
          className="w-full max-w-2xl max-h-[85vh] flex flex-col rounded-2xl overflow-hidden"
          style={{ background: '#fff', boxShadow: '0 32px 80px rgba(31,30,26,0.25)' }}
        >
          <div className="flex items-center justify-between px-5 py-4 border-b border-[#1f1e1a]/8 shrink-0">
            <div>
              <div className="text-sm font-black text-[#201f1b]">Evidence — {stage.label}</div>
              <div className="text-[11px] text-[#8a8477]">
                {stage.n} report{stage.n === 1 ? '' : 's'} have reached this stage
                {stage.sufficient && <> · median {fmtDays(stage.median)}</>}
              </div>
            </div>
            <button onClick={onClose} className="p-2 rounded-full transition-colors" style={{ color: '#8a8477' }}>
              <X size={18} />
            </button>
          </div>

          <div className="p-5 overflow-y-auto">
            <p className="text-xs text-[#8a8477] mb-3 leading-relaxed">
              Every report that has reached this stage, slowest first — the exact timestamps
              the median and p90 above are computed from.
            </p>
            <div className="space-y-2">
              {stage.reports.map((r) => (
                <div key={r.id} className="rounded-xl p-3 border border-[#1f1e1a]/8" style={{ background: 'var(--cream-100)' }}>
                  <div className="flex items-center justify-between gap-2 flex-wrap mb-1">
                    <span className="text-xs font-bold text-[#201f1b]">{r.address}</span>
                    <span className="text-xs font-black" style={{ color: color || '#4a5d3f' }}>
                      {fmtDays(r.value)}
                    </span>
                  </div>
                  <div className="text-[10px] text-[#8a8477]">
                    {r.category} · {r.status}
                  </div>
                  <div className="text-[10px] text-[#8a8477] mt-0.5">
                    {fmtDate(r.fromAt)} → {fmtDate(r.toAt)}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
