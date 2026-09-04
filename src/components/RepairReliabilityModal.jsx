import { Fragment, useEffect, useState } from 'react';
import { X, AlertTriangle, FileDown } from 'lucide-react';
import { MapContainer, TileLayer, CircleMarker, Popup, Polyline, useMap } from 'react-leaflet';
import L from 'leaflet';
import { jsPDF } from 'jspdf';
import { format } from 'date-fns';
import { REINCIDENCE, SLA_END_TO_END_DAYS, gradeFor, GRADE_SCALE, GRADE_COLOR, MELAKA_BOUNDS } from '../utils/analyticsConstants';
import { calculateDistance } from '../utils/analyticsMetrics';

const fmtDate = (v) => {
  if (!v) return 'unknown date';
  const d = new Date(v);
  return isNaN(d.getTime()) ? 'unknown date' : format(d, 'd MMM yyyy');
};

// Was its own 3-bucket green/amber/red before — that disagreed with the
// letter badge next to it, which already used the real 5-tier A-F scale
// (a "C" and a "D" both showed the same amber). One scale, one color.
const rateColor = (rate) => {
  const grade = gradeFor(rate);
  return grade ? GRADE_COLOR[grade.grade] : '#8a8477';
};

const isValidPoint = (lat, lng) => Number.isFinite(Number(lat)) && Number.isFinite(Number(lng));

// Pure proximity, no category/time matching — a looser radius than
// REINCIDENCE's 50m (which is specifically the repeat-failure detection
// rule) so ordinary spatial clustering among all tickets is still visible.
const AREA_RADIUS_M = 100;

const STATUS_FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'onTime', label: 'On time' },
  { key: 'late', label: 'Late' },
  { key: 'repeat', label: 'Repeat failures' },
];

// Blank-grey-tiles fix: a map mounted inside a modal has no real size on its
// first render, so Leaflet measures a 0x0 box unless told to recheck once
// the modal has actually painted.
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

// Caps how far this map can zoom/pan out to roughly Melaka's own extent,
// computed from the map's actual pixel size rather than a guessed zoom
// number. A container that's just been inserted can still report a 0x0
// size, which would make getBoundsZoom() return 0 and silently remove the
// limit instead of setting it — retry instead of trusting the first read.
function MapExtentLimiter({ bounds }) {
  const map = useMap();
  useEffect(() => {
    const b = L.latLngBounds(bounds);
    map.setMaxBounds(b);
    let cancelled = false;
    const tryApply = (attempt = 0) => {
      if (cancelled) return;
      try {
        map.invalidateSize();
        const size = map.getSize();
        if ((size.x < 50 || size.y < 50) && attempt < 20) {
          setTimeout(() => tryApply(attempt + 1), 100);
          return;
        }
        const fitZoom = map.getBoundsZoom(b);
        if (Number.isFinite(fitZoom) && fitZoom > 0) {
          map.setMinZoom(fitZoom);
        }
      } catch (e) {
        // ignore sizing glitches
      }
    };
    const timer = setTimeout(() => tryApply(), 150);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [map, bounds]);
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
 * The "so what" behind the Repair Reliability headline number, in a modal
 * rather than a tab switch — this used to live on the Dispatch & Audit tab,
 * three clicks from the card that references it.
 */
export function RepairReliabilityModal({ contractorAudit, auditActions, onClose }) {
  const auditAvailable = auditActions !== null;
  const [selectedAuthority, setSelectedAuthority] = useState(null);
  const [statusFilter, setStatusFilter] = useState('all');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const selectedRow = selectedAuthority
    ? contractorAudit.find((d) => d.name === selectedAuthority)
    : null;
  const selectedGrade = selectedRow?.rate == null ? null : gradeFor(selectedRow.rate);
  // reIncidence counts every new complaint that reappeared near a resolved
  // one; a single problem site that keeps failing racks up several of
  // those against just one original ticket, so this can be smaller than
  // reIncidence — that's not a discrepancy, it's the same handful of
  // locations failing repeatedly rather than many different ones.
  const flaggedTicketCount = (selectedRow?.tickets || []).filter((t) => t.reappearances.length > 0).length;

  const mappable = (selectedRow?.tickets || []).filter((t) => isValidPoint(t.latitude, t.longitude));
  const unmapped = (selectedRow?.tickets?.length || 0) - mappable.length;
  const categories = [...new Set(mappable.map((t) => t.category).filter(Boolean))].sort();
  const filteredMappable = mappable.filter((t) => {
    if (statusFilter === 'onTime' && !t.onTime) return false;
    if (statusFilter === 'late' && t.onTime) return false;
    if (statusFilter === 'repeat' && t.reappearances.length === 0) return false;
    if (categoryFilter !== 'all' && t.category !== categoryFilter) return false;
    // Dated by resolution, matching how the rest of this modal already
    // cohorts ("resolved tickets") rather than by submission date.
    if (dateFrom || dateTo) {
      const resolved = t.resolvedAt ? new Date(t.resolvedAt) : null;
      if (!resolved || isNaN(resolved.getTime())) return false;
      if (dateFrom && resolved < new Date(dateFrom)) return false;
      if (dateTo) {
        const end = new Date(dateTo);
        end.setHours(23, 59, 59, 999);
        if (resolved > end) return false;
      }
    }
    return true;
  });
  const boundsPoints = filteredMappable.flatMap((t) => {
    const pts = [[t.latitude, t.longitude]];
    for (const rep of t.reappearances) {
      if (isValidPoint(rep.latitude, rep.longitude)) pts.push([rep.latitude, rep.longitude]);
    }
    return pts;
  });

  // Every pair of tickets close enough to plausibly be the same trouble
  // spot, independent of the reincidence rule's category/time matching —
  // this surfaces area-level clustering the repeat-failure count alone
  // wouldn't show (e.g. two different-category tickets on the same corner).
  const areaConnections = [];
  for (let i = 0; i < filteredMappable.length; i++) {
    for (let j = i + 1; j < filteredMappable.length; j++) {
      const a = filteredMappable[i];
      const b = filteredMappable[j];
      const dist = calculateDistance(a.latitude, a.longitude, b.latitude, b.longitude);
      if (dist <= AREA_RADIUS_M) {
        areaConnections.push({ id: `${a.id}-${b.id}`, positions: [[a.latitude, a.longitude], [b.latitude, b.longitude]] });
      }
    }
  }

  // Text-and-table PDF, not a map screenshot — the app's other export
  // (AnalyticsPage's Executive Brief) already moved off html2canvas because
  // rasterised map tiles were unreliable and produced no selectable text.
  // The map's evidence is exactly what the ticket table already shows.
  const exportEvidencePDF = () => {
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
    doc.text('Repair Reliability - Evidence Report', M, y); y += 8;
    doc.setFontSize(9); doc.setFont(undefined, 'normal');
    doc.text('Generated ' + format(new Date(), 'd MMM yyyy HH:mm'), M, y); y += 5;
    doc.text('Department: ' + selectedAuthority, M, y); y += 5;
    const filterParts = [
      'Status: ' + (STATUS_FILTERS.find((f) => f.key === statusFilter)?.label || 'All'),
      'Category: ' + (categoryFilter === 'all' ? 'All' : categoryFilter),
    ];
    if (dateFrom || dateTo) filterParts.push('Resolved ' + (dateFrom || 'any') + ' to ' + (dateTo || 'any'));
    doc.text('Filters - ' + filterParts.join('  |  '), M, y); y += 6;
    doc.setDrawColor(180); doc.line(M, y, 196, y); y += 2;

    heading('Summary');
    line((selectedRow?.resolvedCount ?? 0) + ' resolved reports total, ' + filteredMappable.length + ' shown after filters');
    line((selectedRow?.reIncidence ?? 0) + ' repeat failure(s) overall' + (selectedGrade ? ', Grade ' + selectedGrade.grade : ''));

    heading('Reports (' + filteredMappable.length + ')');
    row(['Address', 'Category', 'Status', 'Resolved', 'Days'], [65, 40, 20, 30, 20], true);
    filteredMappable.forEach((t) => {
      row([
        truncate(t.address, 36),
        truncate(t.category, 22),
        t.onTime ? 'On time' : 'Late',
        fmtDate(t.resolvedAt),
        t.daysToResolve + 'd',
      ], [65, 40, 20, 30, 20]);
      t.reappearances.forEach((rep) => {
        room();
        doc.setFont(undefined, 'italic'); doc.setTextColor(185, 28, 28);
        doc.text('  -> Reappeared ' + rep.distanceM + 'm away at ' + truncate(rep.address, 50) + ', ' + fmtDate(rep.at), M, y);
        y += 5;
        doc.setFont(undefined, 'normal'); doc.setTextColor(0, 0, 0);
      });
    });

    doc.save('repair-reliability-' + selectedAuthority.replace(/\s+/g, '-').toLowerCase() + '.pdf');
  };

  return (
    <>
      <div className="fixed inset-0 z-40 overlay-fade-in" style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)' }} onClick={onClose} />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div
          className="w-full max-w-3xl max-h-[85vh] flex flex-col rounded-2xl overflow-hidden modal-pop-in"
          style={{ background: '#fff', boxShadow: '0 32px 80px rgba(31,30,26,0.25)' }}
        >
          <div className="flex items-center justify-between px-5 py-4 border-b border-[#1f1e1a]/8 shrink-0">
            <div>
              <div className="text-sm font-black text-[#201f1b]">Repair Reliability — full breakdown</div>
              <div className="text-[11px] text-[#8a8477]">Did the fix hold?</div>
            </div>
            <button onClick={onClose} className="p-2 rounded-full transition-colors" style={{ color: '#8a8477' }}>
              <X size={18} />
            </button>
          </div>

          <div className="p-5 overflow-y-auto">
            <p className="text-xs text-[#8a8477] mb-4 leading-relaxed">
              A new report of the same category within {REINCIDENCE.radiusM}m and{' '}
              {REINCIDENCE.windowDays} days of a resolved one suggests the earlier repair did
              not hold. This is the closest thing available to a measure of the city's actual
              condition rather than the council's response speed.
            </p>

            {contractorAudit.length === 0 ? (
              <div className="text-center text-[#8a8477] py-8 text-sm">No department data available</div>
            ) : (
              <>
                <div className="flex flex-wrap gap-2 mb-3">
                  {GRADE_SCALE.map((g) => (
                    <span
                      key={g.grade}
                      className="flex items-center gap-1.5 px-2 py-1 rounded-lg text-[10px] font-bold"
                      style={{ background: 'rgba(31,30,26,0.05)', color: GRADE_COLOR[g.grade] }}
                    >
                      <span
                        className="inline-flex items-center justify-center rounded-full shrink-0 text-white font-black"
                        style={{ width: 14, height: 14, background: GRADE_COLOR[g.grade], fontSize: 8 }}
                      >
                        {g.grade}
                      </span>
                      {g.label} ({g.min}{g.grade === 'A' ? '+' : `–${GRADE_SCALE[GRADE_SCALE.indexOf(g) - 1]?.min - 1}`})
                    </span>
                  ))}
                </div>
                {/* Three departments doesn't need a full chart's worth of axis
                    and gridline chrome — and a bar only ever showed on-time
                    rate, while the thing this whole modal is about (did the
                    fix hold) is repeat failures, which used to be buried in
                    a hover tooltip. Cards put both numbers in view at once. */}
                <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${Math.min(3, contractorAudit.length)}, minmax(0, 1fr))` }}>
                  {contractorAudit.map((d) => {
                    const grade = d.rate == null ? null : gradeFor(d.rate);
                    const isSelected = selectedAuthority === d.name;
                    const isDimmed = selectedAuthority && !isSelected;
                    const color = rateColor(d.rate);
                    return (
                      <button
                        key={d.name}
                        onClick={() => setSelectedAuthority((prev) => (prev === d.name ? null : d.name))}
                        className="text-left rounded-xl p-3 cursor-pointer transition-opacity hover:opacity-90"
                        style={{
                          background: '#fff',
                          border: `2px solid ${isSelected ? color : 'rgba(31,30,26,0.1)'}`,
                          opacity: isDimmed ? 0.5 : 1,
                        }}
                      >
                        <div className="text-xs font-bold text-[#201f1b] mb-2 leading-tight min-h-[2rem]">{d.name}</div>
                        <div className="flex items-end justify-between mb-2">
                          <div>
                            <div className="text-2xl font-black leading-none" style={{ color }}>
                              {d.rate == null ? '—' : `${d.rate}%`}
                            </div>
                            <div className="text-[10px] text-[#8a8477] font-semibold mt-0.5">on time</div>
                          </div>
                          {grade && (
                            <div className="px-2 py-0.5 rounded text-xs font-black text-white" style={{ background: color }}>
                              {grade.grade}
                            </div>
                          )}
                        </div>
                        <div className="flex items-center justify-between text-[11px] pt-2 border-t border-[#1f1e1a]/8">
                          <span className="text-[#8a8477]">{d.resolvedCount} resolved</span>
                          <span className="font-bold" style={{ color: d.reIncidence > 0 ? '#b91c1c' : '#8a8477' }}>
                            {d.reIncidence} repeat{d.reIncidence === 1 ? '' : 's'}
                          </span>
                        </div>
                      </button>
                    );
                  })}
                </div>
                <p className="text-[10px] text-[#8a8477] mt-2 mb-2">
                  Click a card to see every resolved report behind that department's numbers.
                </p>
              </>
            )}

            <p className="text-[10px] text-[#8a8477] mt-3 leading-relaxed">
              On-time rate is the share of resolved reports closed within{' '}
              {SLA_END_TO_END_DAYS} days, measured from submission. Reports missing either
              date are excluded from both sides of the ratio rather than counted as on time.
            </p>

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

            <div className="mt-6 pt-5 border-t border-[#1f1e1a]/8">
              {!selectedAuthority ? (
                <div className="text-center text-[#8a8477] py-8 text-xs leading-relaxed">
                  Click a department card above to see the evidence behind its numbers —<br />
                  every resolved report, which ones missed the SLA, and which ones came back.
                </div>
              ) : (
                <>
                  <div className="flex items-center justify-between mb-1 flex-wrap gap-2">
                    <div className="text-xs font-black text-[#201f1b] uppercase tracking-wide">Evidence — {selectedAuthority}</div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={exportEvidencePDF}
                        disabled={!selectedRow?.tickets?.length}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold disabled:opacity-40 disabled:cursor-not-allowed transition-opacity hover:opacity-80"
                        style={{ background: '#3d4d34', color: '#fff' }}
                      >
                        <FileDown size={11} /> Export PDF
                      </button>
                      <button
                        onClick={() => setSelectedAuthority(null)}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold transition-opacity hover:opacity-70"
                        style={{ background: 'rgba(74,93,63,0.1)', color: '#3d4d34' }}
                      >
                        Clear <X size={11} />
                      </button>
                    </div>
                  </div>
                  <p className="text-xs text-[#8a8477] mb-1 leading-relaxed">
                    {selectedRow?.resolvedCount ?? 0} resolved report{selectedRow?.resolvedCount === 1 ? '' : 's'}
                    {' · '}
                    {flaggedTicketCount > 0 ? (
                      <span className="text-[#c1613f] font-bold">{flaggedTicketCount} place{flaggedTicketCount === 1 ? '' : 's'} keep{flaggedTicketCount === 1 ? 's' : ''} breaking again</span>
                    ) : 'nothing has broken again'}
                    {selectedGrade && <> · Grade <strong style={{ color: rateColor(selectedRow.rate) }}>{selectedGrade.grade}</strong></>}
                    {' — every report below, most recently resolved first.'}
                  </p>
                  {selectedRow?.reIncidence > 0 && (
                    <p className="text-[11px] text-[#8a8477] mb-3 leading-relaxed">
                      Shown as {flaggedTicketCount === 1 ? 'a red marker' : 'red markers'} below.{' '}
                      {flaggedTicketCount !== selectedRow.reIncidence
                        ? <>Between {flaggedTicketCount === 1 ? 'it' : 'them'}, {flaggedTicketCount === 1 ? "it's" : "they've"} come back {selectedRow.reIncidence} time{selectedRow.reIncidence === 1 ? '' : 's'} in total — click a red marker to see how many times each place failed.</>
                        : <>Each has failed once so far — click a red marker for details.</>}
                    </p>
                  )}
                  {!selectedRow?.tickets?.length ? (
                    <div className="text-center text-[#8a8477] py-6 text-xs">
                      No resolved reports with both a submitted and resolved date for {selectedAuthority}.
                    </div>
                  ) : mappable.length === 0 ? (
                    <div className="text-center text-[#8a8477] py-6 text-xs">
                      None of these reports have usable coordinates to plot.
                    </div>
                  ) : (
                    <>
                      <div className="flex items-center gap-2 mb-2 flex-wrap">
                        {STATUS_FILTERS.map((f) => (
                          <button
                            key={f.key}
                            onClick={() => setStatusFilter(f.key)}
                            className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition-colors ${
                              statusFilter === f.key
                                ? 'bg-[#4a5d3f] text-white'
                                : 'bg-[#f5f1e6] text-[#4b473d] hover:bg-[#4a5d3f]/10'
                            }`}
                          >
                            {f.label}
                          </button>
                        ))}
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
                      <p className="text-[10px] text-[#8a8477] -mt-1 mb-2">Date range filters by resolved date.</p>
                      {filteredMappable.length === 0 ? (
                        <div className="text-center text-[#8a8477] py-6 text-xs">
                          No {STATUS_FILTERS.find((f) => f.key === statusFilter)?.label.toLowerCase()}
                          {categoryFilter !== 'all' ? ` ${categoryFilter}` : ''} reports
                          {(dateFrom || dateTo) ? ' in this date range' : ''} for {selectedAuthority}.
                        </div>
                      ) : (
                      <>
                      <div className="rounded-xl overflow-hidden border border-[#1f1e1a]/8" style={{ height: 420 }}>
                        <MapContainer
                          center={[2.1896, 102.2501]}
                          zoom={12.5}
                          maxBounds={MELAKA_BOUNDS}
                          maxBoundsViscosity={1.0}
                          style={{ height: '100%', width: '100%' }}
                        >
                          <TileLayer
                            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                          />
                          <MapExtentLimiter bounds={MELAKA_BOUNDS} />
                          {areaConnections.map((c) => (
                            <Polyline
                              key={c.id}
                              positions={c.positions}
                              pathOptions={{ color: '#8a8477', weight: 1.5, opacity: 0.6, dashArray: '2 6' }}
                            />
                          ))}
                          {filteredMappable.map((t) => {
                            const hasReappeared = t.reappearances.length > 0;
                            const color = hasReappeared ? '#b91c1c' : t.onTime ? '#15803d' : '#b45309';
                            const validReappearances = t.reappearances.filter((rep) => isValidPoint(rep.latitude, rep.longitude));
                            return (
                              <Fragment key={t.id}>
                                <CircleMarker
                                  center={[t.latitude, t.longitude]}
                                  radius={7}
                                  pathOptions={{ color, fillColor: color, fillOpacity: 0.85, weight: 2 }}
                                >
                                  <Popup>
                                    <div style={{ fontSize: 12, minWidth: 180 }}>
                                      <div style={{ fontWeight: 700 }}>{t.address}</div>
                                      <div style={{ color: '#8a8477', marginTop: 2 }}>Category: {t.category}</div>
                                      <div style={{ color: '#8a8477' }}>Status: {t.status}</div>
                                      <div style={{ color: '#8a8477' }}>Submitted {fmtDate(t.submittedAt)}</div>
                                      <div style={{ color: '#8a8477' }}>Resolved {fmtDate(t.resolvedAt)}</div>
                                      <div style={{ color: t.onTime ? '#15803d' : '#b45309', fontWeight: 700 }}>
                                        {t.onTime ? 'On time' : 'Late'} · {t.daysToResolve}d to fix
                                      </div>
                                      {hasReappeared && (
                                        <div style={{ marginTop: 4, paddingTop: 4, borderTop: '1px solid #eee' }}>
                                          <div style={{ color: '#b91c1c', fontWeight: 700 }}>
                                            Reappeared {t.reappearances.length} time{t.reappearances.length === 1 ? '' : 's'}
                                          </div>
                                          {t.reappearances.map((rep) => (
                                            <div key={rep.id} style={{ color: '#8a8477' }}>
                                              {rep.distanceM}m away, {fmtDate(rep.at)}
                                            </div>
                                          ))}
                                        </div>
                                      )}
                                    </div>
                                  </Popup>
                                </CircleMarker>
                                {validReappearances.map((rep) => (
                                  <Fragment key={rep.id}>
                                    <Polyline
                                      positions={[[t.latitude, t.longitude], [rep.latitude, rep.longitude]]}
                                      pathOptions={{ color: '#b91c1c', weight: 2, dashArray: '4 4' }}
                                    />
                                    <CircleMarker
                                      center={[rep.latitude, rep.longitude]}
                                      radius={5}
                                      pathOptions={{ color: '#b91c1c', fillColor: '#fff', fillOpacity: 1, weight: 2 }}
                                    >
                                      <Popup>
                                        <div style={{ fontSize: 12, minWidth: 160 }}>
                                          <div style={{ fontWeight: 700 }}>{rep.address}</div>
                                          <div style={{ color: '#8a8477' }}>New report, {fmtDate(rep.at)}</div>
                                          <div style={{ color: '#8a8477' }}>{rep.distanceM}m from the original repair</div>
                                        </div>
                                      </Popup>
                                    </CircleMarker>
                                  </Fragment>
                                ))}
                              </Fragment>
                            );
                          })}
                          <MapResizer />
                          <MapBoundsFitter points={boundsPoints} />
                        </MapContainer>
                      </div>
                      <div className="flex items-center gap-4 flex-wrap mt-2 text-[10px] text-[#8a8477]">
                        <span className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-full inline-block" style={{ background: '#15803d' }} /> On time</span>
                        <span className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-full inline-block" style={{ background: '#b45309' }} /> Late</span>
                        <span className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-full inline-block" style={{ background: '#b91c1c' }} /> Repeat failure (red dashed line to where it reappeared)</span>
                        <span className="inline-flex items-center gap-1"><span className="w-3 h-0 border-t border-dashed inline-block" style={{ borderColor: '#8a8477' }} /> Within {AREA_RADIUS_M}m of another report</span>
                        {unmapped > 0 && <span>{unmapped} report{unmapped === 1 ? '' : 's'} without usable coordinates not shown</span>}
                      </div>
                      </>
                      )}
                    </>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
