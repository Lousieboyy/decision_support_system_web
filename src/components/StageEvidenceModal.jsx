import { Fragment, useEffect, useState } from 'react';
import { X, FileDown } from 'lucide-react';
import { MapContainer, TileLayer, CircleMarker, Popup, Polyline, useMap } from 'react-leaflet';
import L from 'leaflet';
import { jsPDF } from 'jspdf';
import { format } from 'date-fns';
import { calculateDistance } from '../utils/analyticsMetrics';

const fmtDate = (v) => {
  if (!v) return 'unknown date';
  const d = new Date(v);
  return isNaN(d.getTime()) ? 'unknown date' : format(d, 'd MMM yyyy HH:mm');
};

const fmtDays = (v) => (v == null ? '—' : `${v.toFixed(1)}d`);

const isValidPoint = (lat, lng) => Number.isFinite(Number(lat)) && Number.isFinite(Number(lng));

// Pure proximity, no category/time matching — surfaces spatial clustering
// among slow (or fast) cases independent of what's actually causing it.
const AREA_RADIUS_M = 100;

// Blank-grey-tiles fix: a map mounted inside a modal has no real size on
// its first render, so Leaflet measures a 0x0 box unless told to recheck
// once the modal has actually painted.
function MapResizer() {
  const map = useMap();
  useEffect(() => {
    const timer = setTimeout(() => {
      try { map.invalidateSize(); } catch (_) { /* ignore */ }
    }, 150);
    return () => clearTimeout(timer);
  }, [map]);
  return null;
}

function MapBoundsFitter({ points }) {
  const map = useMap();
  useEffect(() => {
    if (points.length >= 2) {
      map.fitBounds(L.latLngBounds(points), { padding: [30, 30] });
    } else if (points.length === 1) {
      map.setView(points[0], 15);
    }
  }, [map, points]);
  return null;
}

/**
 * The report-level evidence behind one stage's median/p90 numbers, in a
 * modal rather than an inline drop-down — an expanding section below the
 * chart is easy to miss or skip past; a modal is the thing people actually
 * stop and read.
 */
export function StageEvidenceModal({ stage, color, onClose }) {
  const [statusFilter, setStatusFilter] = useState('all');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  if (!stage) return null;

  const statuses = [...new Set(stage.reports.map((r) => r.status).filter(Boolean))].sort();
  const categories = [...new Set(stage.reports.map((r) => r.category).filter(Boolean))].sort();

  const filtered = stage.reports.filter((r) => {
    if (statusFilter !== 'all' && r.status !== statusFilter) return false;
    if (categoryFilter !== 'all' && r.category !== categoryFilter) return false;
    if (dateFrom || dateTo) {
      const exited = r.toAt ? new Date(r.toAt) : null;
      if (!exited || isNaN(exited.getTime())) return false;
      if (dateFrom && exited < new Date(dateFrom)) return false;
      if (dateTo) {
        const end = new Date(dateTo);
        end.setHours(23, 59, 59, 999);
        if (exited > end) return false;
      }
    }
    return true;
  });

  const mappable = filtered.filter((r) => isValidPoint(r.latitude, r.longitude));
  const unmapped = filtered.length - mappable.length;
  const boundsPoints = mappable.map((r) => [r.latitude, r.longitude]);

  // Color by how this case compares to the rest of the stage — the point of
  // "slowest first" evidence is spotting the outliers, not just listing
  // everything in one flat color.
  const markerColor = (r) => {
    if (!stage.sufficient) return color || '#4a5d3f';
    if (r.value > stage.p90) return '#b91c1c';
    if (r.value > stage.median) return '#b45309';
    return '#15803d';
  };

  const areaConnections = [];
  for (let i = 0; i < mappable.length; i++) {
    for (let j = i + 1; j < mappable.length; j++) {
      const a = mappable[i];
      const b = mappable[j];
      const dist = calculateDistance(a.latitude, a.longitude, b.latitude, b.longitude);
      if (dist <= AREA_RADIUS_M) {
        areaConnections.push({ id: `${a.id}-${b.id}`, positions: [[a.latitude, a.longitude], [b.latitude, b.longitude]] });
      }
    }
  }

  const exportPDF = () => {
    const doc = new jsPDF();
    const M = 14;
    const BOTTOM = 275;
    let y = 20;

    const nextPage = () => { doc.addPage(); y = 20; };
    const room = (needed = 8) => { if (y + needed > BOTTOM) nextPage(); };
    const heading = (text) => {
      room(14);
      y += 4;
      doc.setFontSize(12); doc.setFont(undefined, 'bold');
      doc.text(text, M, y); y += 7;
      doc.setFontSize(9); doc.setFont(undefined, 'normal');
    };
    const line = (text) => { room(); doc.text(String(text), M, y); y += 5; };
    const row = (cols, widths, bold = false) => {
      room();
      doc.setFont(undefined, bold ? 'bold' : 'normal');
      let x = M;
      cols.forEach((c, i) => { doc.text(String(c), x, y); x += widths[i]; });
      doc.setFont(undefined, 'normal');
      y += 5;
    };
    const truncate = (s, n) => (s && s.length > n ? s.slice(0, n - 1) + '.' : (s || '-'));

    doc.setFontSize(16); doc.setFont(undefined, 'bold');
    doc.text('Stage Duration - Evidence Report', M, y); y += 8;
    doc.setFontSize(9); doc.setFont(undefined, 'normal');
    doc.text('Generated ' + format(new Date(), 'd MMM yyyy HH:mm'), M, y); y += 5;
    doc.text('Stage: ' + stage.label, M, y); y += 5;
    const filterParts = [
      'Status: ' + (statusFilter === 'all' ? 'All' : statusFilter),
      'Category: ' + (categoryFilter === 'all' ? 'All' : categoryFilter),
    ];
    if (dateFrom || dateTo) filterParts.push('Exited stage ' + (dateFrom || 'any') + ' to ' + (dateTo || 'any'));
    doc.text('Filters - ' + filterParts.join('  |  '), M, y); y += 6;
    doc.setDrawColor(180); doc.line(M, y, 196, y); y += 2;

    heading('Summary');
    line(stage.n + ' reports have reached this stage total, ' + filtered.length + ' shown after filters');
    if (stage.sufficient) line('Median ' + fmtDays(stage.median) + ', up to ' + fmtDays(stage.p90) + ' for slower cases');

    heading('Reports (' + filtered.length + ')');
    row(['Address', 'Category', 'Status', 'Days', 'From -> To'], [55, 35, 25, 15, 60], true);
    filtered.forEach((r) => {
      row([
        truncate(r.address, 30),
        truncate(r.category, 18),
        truncate(r.status, 14),
        fmtDays(r.value),
        truncate(fmtDate(r.fromAt) + ' -> ' + fmtDate(r.toAt), 40),
      ], [55, 35, 25, 15, 60]);
    });

    doc.save('stage-evidence-' + stage.key.toLowerCase() + '.pdf');
  };

  return (
    <>
      <div className="fixed inset-0 z-40" style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)' }} onClick={onClose} />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div
          className="w-full max-w-3xl max-h-[85vh] flex flex-col rounded-2xl overflow-hidden"
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
            <div className="flex items-center gap-2">
              <button
                onClick={exportPDF}
                disabled={!stage.reports.length}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold disabled:opacity-40 disabled:cursor-not-allowed"
                style={{ background: '#3d4d34', color: '#fff' }}
              >
                <FileDown size={11} /> Export PDF
              </button>
              <button onClick={onClose} className="p-2 rounded-full transition-colors" style={{ color: '#8a8477' }}>
                <X size={18} />
              </button>
            </div>
          </div>

          <div className="p-5 overflow-y-auto">
            <p className="text-xs text-[#8a8477] mb-3 leading-relaxed">
              Every report that has reached this stage — the exact timestamps the median and
              p90 above are computed from. Red markers are slower than the p90 line, orange are
              slower than typical, green are at or faster than typical.
            </p>

            <div className="flex items-center gap-2 mb-2 flex-wrap">
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="bg-[#f5f1e6] border border-[#1f1e1a]/12 rounded-lg px-2 py-1 text-[11px] font-bold text-[#201f1b] outline-none custom-select"
              >
                <option value="all">All statuses</option>
                {statuses.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
              {categories.length > 1 && (
                <select
                  value={categoryFilter}
                  onChange={(e) => setCategoryFilter(e.target.value)}
                  className="bg-[#f5f1e6] border border-[#1f1e1a]/12 rounded-lg px-2 py-1 text-[11px] font-bold text-[#201f1b] outline-none custom-select"
                >
                  <option value="all">All categories</option>
                  {categories.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              )}
              <span className="w-px h-4 bg-[#1f1e1a]/10 mx-1" />
              <input
                type="date"
                value={dateFrom}
                max={dateTo || undefined}
                onChange={(e) => setDateFrom(e.target.value)}
                className="bg-[#f5f1e6] border border-[#1f1e1a]/12 rounded-lg px-2 py-1 text-[11px] font-semibold text-[#201f1b] outline-none"
              />
              <span className="text-[11px] text-[#8a8477]">to</span>
              <input
                type="date"
                value={dateTo}
                min={dateFrom || undefined}
                onChange={(e) => setDateTo(e.target.value)}
                className="bg-[#f5f1e6] border border-[#1f1e1a]/12 rounded-lg px-2 py-1 text-[11px] font-semibold text-[#201f1b] outline-none"
              />
              {(dateFrom || dateTo) && (
                <button
                  onClick={() => { setDateFrom(''); setDateTo(''); }}
                  className="text-[11px] font-bold text-[#8a8477] hover:text-[#201f1b]"
                >
                  Clear dates
                </button>
              )}
            </div>
            <p className="text-[10px] text-[#8a8477] -mt-1 mb-2">Date range filters by when the report left this stage.</p>

            {filtered.length === 0 ? (
              <div className="text-center text-[#8a8477] py-6 text-xs">
                No reports match these filters.
              </div>
            ) : mappable.length === 0 ? (
              <div className="text-center text-[#8a8477] py-6 text-xs">
                None of these {filtered.length} report{filtered.length === 1 ? '' : 's'} have usable coordinates to plot.
              </div>
            ) : (
              <>
                <div className="rounded-xl overflow-hidden border border-[#1f1e1a]/8" style={{ height: 380 }}>
                  <MapContainer center={[2.1896, 102.2501]} zoom={12.5} style={{ height: '100%', width: '100%' }}>
                    <TileLayer
                      attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                      url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                    />
                    {areaConnections.map((c) => (
                      <Polyline
                        key={c.id}
                        positions={c.positions}
                        pathOptions={{ color: '#8a8477', weight: 1.5, opacity: 0.6, dashArray: '2 6' }}
                      />
                    ))}
                    {mappable.map((r) => (
                      <CircleMarker
                        key={r.id}
                        center={[r.latitude, r.longitude]}
                        radius={7}
                        pathOptions={{ color: markerColor(r), fillColor: markerColor(r), fillOpacity: 0.85, weight: 2 }}
                      >
                        <Popup>
                          <div style={{ fontSize: 12, minWidth: 180 }}>
                            <div style={{ fontWeight: 700 }}>{r.address}</div>
                            <div style={{ color: '#8a8477', marginTop: 2 }}>Category: {r.category}</div>
                            <div style={{ color: '#8a8477' }}>Status: {r.status}</div>
                            <div style={{ color: '#8a8477' }}>{fmtDate(r.fromAt)} → {fmtDate(r.toAt)}</div>
                            <div style={{ color: markerColor(r), fontWeight: 700, marginTop: 2 }}>
                              {fmtDays(r.value)} in this stage
                              {stage.sufficient && (r.value > stage.p90 ? ' — slower than p90' : r.value > stage.median ? ' — slower than typical' : ' — at or faster than typical')}
                            </div>
                          </div>
                        </Popup>
                      </CircleMarker>
                    ))}
                    <MapResizer />
                    <MapBoundsFitter points={boundsPoints} />
                  </MapContainer>
                </div>
                <div className="flex items-center gap-4 flex-wrap mt-2 text-[10px] text-[#8a8477]">
                  <span className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-full inline-block" style={{ background: '#15803d' }} /> At/faster than typical</span>
                  <span className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-full inline-block" style={{ background: '#b45309' }} /> Slower than typical</span>
                  <span className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-full inline-block" style={{ background: '#b91c1c' }} /> Slower than p90</span>
                  <span className="inline-flex items-center gap-1"><span className="w-3 h-0 border-t border-dashed inline-block" style={{ borderColor: '#8a8477' }} /> Within {AREA_RADIUS_M}m of another report</span>
                  {unmapped > 0 && <span>{unmapped} report{unmapped === 1 ? '' : 's'} without usable coordinates not shown</span>}
                </div>
              </>
            )}

            <div className="space-y-2 mt-4">
              {filtered.map((r) => (
                <div key={r.id} className="rounded-xl p-3 border border-[#1f1e1a]/8" style={{ background: 'var(--cream-100)' }}>
                  <div className="flex items-center justify-between gap-2 flex-wrap mb-1">
                    <span className="text-xs font-bold text-[#201f1b]">{r.address}</span>
                    <span className="text-xs font-black" style={{ color: markerColor(r) }}>
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
