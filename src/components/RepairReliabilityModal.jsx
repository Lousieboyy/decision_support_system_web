import { Fragment, useEffect, useState } from 'react';
import { X, AlertTriangle } from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, LabelList,
} from 'recharts';
import { MapContainer, TileLayer, CircleMarker, Popup, Polyline, useMap } from 'react-leaflet';
import L from 'leaflet';
import { format } from 'date-fns';
import { REINCIDENCE, SLA_END_TO_END_DAYS, gradeFor } from '../utils/analyticsConstants';

const fmtDate = (v) => {
  if (!v) return 'unknown date';
  const d = new Date(v);
  return isNaN(d.getTime()) ? 'unknown date' : format(d, 'd MMM yyyy');
};

const rateColor = (rate) => (rate == null ? '#8a8477' : rate >= 80 ? '#15803d' : rate >= 60 ? '#b45309' : '#b91c1c');

const isValidPoint = (lat, lng) => Number.isFinite(Number(lat)) && Number.isFinite(Number(lng));

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
 * The "so what" behind the Repair Reliability headline number, in a modal
 * rather than a tab switch — this used to live on the Dispatch & Audit tab,
 * three clicks from the card that references it.
 */
export function RepairReliabilityModal({ contractorAudit, auditActions, onClose }) {
  const auditAvailable = auditActions !== null;
  const [selectedAuthority, setSelectedAuthority] = useState(null);

  const selectedRow = selectedAuthority
    ? contractorAudit.find((d) => d.name === selectedAuthority)
    : null;
  const selectedGrade = selectedRow?.rate == null ? null : gradeFor(selectedRow.rate);

  const mappable = (selectedRow?.tickets || []).filter((t) => isValidPoint(t.latitude, t.longitude));
  const unmapped = (selectedRow?.tickets?.length || 0) - mappable.length;
  const boundsPoints = mappable.flatMap((t) => {
    const pts = [[t.latitude, t.longitude]];
    if (t.reappeared && isValidPoint(t.reappearedLatitude, t.reappearedLongitude)) {
      pts.push([t.reappearedLatitude, t.reappearedLongitude]);
    }
    return pts;
  });

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
              <div className="text-sm font-black text-[#201f1b]">Repair Reliability — full breakdown</div>
              <div className="text-[11px] text-[#8a8477]">Did the fix hold?</div>
            </div>
            <button onClick={onClose} className="p-2 rounded-full transition-colors" style={{ color: '#8a8477' }}>
              <X size={18} />
            </button>
          </div>

          <div className="p-5 overflow-y-auto">
            <p className="text-xs text-[#8a8477] mb-4 leading-relaxed">
              A new complaint of the same category within {REINCIDENCE.radiusM}m and{' '}
              {REINCIDENCE.windowDays} days of a resolved one suggests the earlier repair did
              not hold. This is the closest thing available to a measure of the city's actual
              condition rather than the council's response speed.
            </p>

            {contractorAudit.length === 0 ? (
              <div className="text-center text-[#8a8477] py-8 text-sm">No department data available</div>
            ) : (
              <>
                <div style={{ height: Math.max(120, contractorAudit.length * 44) }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={contractorAudit} layout="vertical" margin={{ top: 5, right: 60, left: 10, bottom: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="rgba(31,30,26,0.08)" />
                      <XAxis type="number" domain={[0, 100]} stroke="#8a8477" fontSize={10} tickLine={false} unit="%" />
                      <YAxis type="category" dataKey="name" stroke="#8a8477" fontSize={11} tickLine={false} width={170} />
                      <Tooltip content={<ReliabilityTooltip />} cursor={{ fill: 'rgba(74,93,63,0.05)' }} />
                      <Bar
                        dataKey="rate"
                        radius={[0, 4, 4, 0]}
                        maxBarSize={26}
                        cursor="pointer"
                        onClick={(d) => {
                          const name = d?.payload?.name ?? d?.name;
                          setSelectedAuthority((prev) => (prev === name ? null : name));
                        }}
                      >
                        {contractorAudit.map((d) => (
                          <Cell
                            key={d.name}
                            fill={rateColor(d.rate)}
                            fillOpacity={!selectedAuthority || selectedAuthority === d.name ? 1 : 0.3}
                          />
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
                <p className="text-[10px] text-[#8a8477] -mt-1 mb-2">
                  Click a bar to see every resolved ticket behind that department's numbers.
                </p>
              </>
            )}

            <p className="text-[10px] text-[#8a8477] mt-3 leading-relaxed">
              On-time rate is the share of resolved tickets closed within{' '}
              {SLA_END_TO_END_DAYS} days, measured from submission. Tickets missing either
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
                  Click a department bar above to see the evidence behind its numbers —<br />
                  every resolved ticket, which ones missed the SLA, and which ones came back.
                </div>
              ) : (
                <>
                  <div className="flex items-center justify-between mb-1 flex-wrap gap-2">
                    <div className="text-xs font-black text-[#201f1b] uppercase tracking-wide">Evidence — {selectedAuthority}</div>
                    <button
                      onClick={() => setSelectedAuthority(null)}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold"
                      style={{ background: 'rgba(74,93,63,0.1)', color: '#3d4d34' }}
                    >
                      Clear <X size={11} />
                    </button>
                  </div>
                  <p className="text-xs text-[#8a8477] mb-3 leading-relaxed">
                    {selectedRow?.resolvedCount ?? 0} resolved ticket{selectedRow?.resolvedCount === 1 ? '' : 's'}
                    {' · '}
                    {selectedRow?.reIncidence > 0 ? (
                      <span className="text-[#c1613f] font-bold">{selectedRow.reIncidence} repeat failure{selectedRow.reIncidence === 1 ? '' : 's'}</span>
                    ) : 'no repeat failures'}
                    {selectedGrade && <> · Grade <strong style={{ color: rateColor(selectedRow.rate) }}>{selectedGrade.grade}</strong></>}
                    {' — every ticket below, most recently resolved first.'}
                  </p>
                  {!selectedRow?.tickets?.length ? (
                    <div className="text-center text-[#8a8477] py-6 text-xs">
                      No resolved tickets with both a submitted and resolved date for {selectedAuthority}.
                    </div>
                  ) : mappable.length === 0 ? (
                    <div className="text-center text-[#8a8477] py-6 text-xs">
                      None of these tickets have usable coordinates to plot.
                    </div>
                  ) : (
                    <>
                      <div className="rounded-xl overflow-hidden border border-[#1f1e1a]/8" style={{ height: 420 }}>
                        <MapContainer center={[2.1896, 102.2501]} zoom={12.5} style={{ height: '100%', width: '100%' }}>
                          <TileLayer
                            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                          />
                          {mappable.map((t) => {
                            const color = t.reappeared ? '#b91c1c' : t.onTime ? '#15803d' : '#b45309';
                            const hasReappearPoint = t.reappeared && isValidPoint(t.reappearedLatitude, t.reappearedLongitude);
                            return (
                              <Fragment key={t.id}>
                                <CircleMarker
                                  center={[t.latitude, t.longitude]}
                                  radius={7}
                                  pathOptions={{ color, fillColor: color, fillOpacity: 0.85, weight: 2 }}
                                >
                                  <Popup>
                                    <div style={{ fontSize: 12, minWidth: 160 }}>
                                      <div style={{ fontWeight: 700 }}>{t.address}</div>
                                      <div style={{ color: '#8a8477' }}>{t.category} · {t.onTime ? 'On time' : 'Late'} · {t.daysToResolve}d to fix</div>
                                      <div style={{ color: '#8a8477' }}>Resolved {fmtDate(t.resolvedAt)}</div>
                                      {t.reappeared && (
                                        <div style={{ marginTop: 4, paddingTop: 4, borderTop: '1px solid #eee', color: '#b91c1c', fontWeight: 700 }}>
                                          Reappeared {t.reappearedDistanceM}m away, {fmtDate(t.reappearedAt)}
                                        </div>
                                      )}
                                    </div>
                                  </Popup>
                                </CircleMarker>
                                {hasReappearPoint && (
                                  <>
                                    <Polyline
                                      positions={[[t.latitude, t.longitude], [t.reappearedLatitude, t.reappearedLongitude]]}
                                      pathOptions={{ color: '#b91c1c', weight: 2, dashArray: '4 4' }}
                                    />
                                    <CircleMarker
                                      center={[t.reappearedLatitude, t.reappearedLongitude]}
                                      radius={5}
                                      pathOptions={{ color: '#b91c1c', fillColor: '#fff', fillOpacity: 1, weight: 2 }}
                                    >
                                      <Popup>
                                        <div style={{ fontSize: 12, minWidth: 160 }}>
                                          <div style={{ fontWeight: 700 }}>{t.reappearedAddress}</div>
                                          <div style={{ color: '#8a8477' }}>New report, {fmtDate(t.reappearedAt)}</div>
                                          <div style={{ color: '#8a8477' }}>{t.reappearedDistanceM}m from the original repair</div>
                                        </div>
                                      </Popup>
                                    </CircleMarker>
                                  </>
                                )}
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
                        <span className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-full inline-block" style={{ background: '#b91c1c' }} /> Repeat failure (dashed line to where it reappeared)</span>
                        {unmapped > 0 && <span>{unmapped} ticket{unmapped === 1 ? '' : 's'} without usable coordinates not shown</span>}
                      </div>
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
