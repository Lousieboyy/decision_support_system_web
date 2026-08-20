import { useState, useEffect, useMemo } from 'react';
import {
  X, MapPin, Sparkles, CheckCircle2, ChevronRight, Image as ImageIcon,
  Send, Building2, Clock, AlertTriangle, MessageSquare, ShieldCheck,
  RotateCcw, ChevronDown, Mail, Phone, Wrench, HardHat, Camera,
  Navigation, ExternalLink
} from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { 
  getImageUrl, updateReportStatus, adminReview, adminReject,
  startMaintenance, completeTask, authorityResolve,
  fetchAllReports, analyzeReportImage, rejectProof,
  fetchTeams, dispatchToTeam, transferReport, claimReport,
  fetchCrews, fetchCrewWorkload, reassignCrew
} from '../api/reportsApi';
import { describeVerdict } from '../api/datasetApi';
import { AUTHORITIES } from '../utils/authorities';
import { useAuth } from '../context/AuthContext';
import L from 'leaflet';
import { MapContainer, TileLayer, Marker, Popup, Polyline, useMap } from 'react-leaflet';

// Pulsing custom user GPS icon and custom issue pin
const issueIcon = typeof window !== 'undefined' && L ? L.divIcon({
  html: `
    <div style="display: flex; align-items: center; justify-content: center; width: 30px; height: 30px;">
      <svg width="30" height="30" viewBox="0 0 24 24" fill="#ef4444" stroke="#ffffff" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="filter: drop-shadow(0 2px 4px rgba(0,0,0,0.3));">
        <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path>
        <circle cx="12" cy="10" r="3" fill="#ffffff"></circle>
      </svg>
    </div>
  `,
  className: 'custom-issue-pin',
  iconSize: [30, 30],
  iconAnchor: [15, 30],
  popupAnchor: [0, -30]
}) : null;

const userIcon = typeof window !== 'undefined' && L ? L.divIcon({
  html: `
    <div style="position: relative; width: 24px; height: 24px;">
      <div style="position: absolute; top: 4px; left: 4px; width: 16px; height: 16px; background-color: #3b82f6; border: 2.5px solid #ffffff; border-radius: 50%; box-shadow: 0 0 8px #3b82f6; z-index: 10;"></div>
      <div style="position: absolute; top: 0; left: 0; width: 24px; height: 24px; background-color: rgba(59, 130, 246, 0.4); border-radius: 50%; animation: pulse-gps 2s infinite ease-in-out;"></div>
    </div>
    <style>
      @keyframes pulse-gps {
        0% { transform: scale(0.6); opacity: 1; }
        100% { transform: scale(1.6); opacity: 0; }
      }
    </style>
  `,
  className: 'custom-user-gps',
  iconSize: [24, 24],
  iconAnchor: [12, 12]
}) : null;

function MapBoundsFitter({ points }) {
  const map = useMap();
  useEffect(() => {
    if (points && points.length >= 2) {
      const bounds = L.latLngBounds(points);
      map.fitBounds(bounds, { padding: [30, 30] });
    } else if (points && points.length === 1) {
      map.setView(points[0], 14);
    }
  }, [map, points]);
  return null;
}

function ReportDirectionsMap({ reportLat, reportLng, reportAddress }) {
  const [userLocation, setUserLocation] = useState(null);
  const [routeCoords, setRouteCoords] = useState([]);
  const [distance, setDistance] = useState(null);
  const [duration, setDuration] = useState(null);
  const [loading, setLoading] = useState(false);
  const [locating, setLocating] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if ("geolocation" in navigator) {
      setLocating(true);
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const lat = position.coords.latitude;
          const lng = position.coords.longitude;
          setUserLocation([lat, lng]);
          setLocating(false);
        },
        (err) => {
          console.warn("User geolocation denied or failed. Fallback to Melaka city center.", err);
          setUserLocation([2.1896, 102.2501]);
          setLocating(false);
        },
        { enableHighAccuracy: true, timeout: 6000 }
      );
    } else {
      setUserLocation([2.1896, 102.2501]);
    }
  }, []);

  useEffect(() => {
    if (!userLocation || !reportLat || !reportLng) return;
    const [userLat, userLng] = userLocation;
    
    setLoading(true);
    setError(null);
    
    fetch(`https://router.project-osrm.org/route/v1/driving/${userLng},${userLat};${reportLng},${reportLat}?overview=full&geometries=geojson`)
      .then((res) => {
        if (!res.ok) throw new Error("OSRM server returned error status");
        return res.json();
      })
      .then((data) => {
        if (data.code === 'Ok' && data.routes && data.routes[0]) {
          const route = data.routes[0];
          const coords = route.geometry.coordinates.map((c) => [c[1], c[0]]);
          setRouteCoords(coords);
          setDistance(route.distance);
          setDuration(route.duration);
        } else {
          setError("No route found between locations.");
        }
        setLoading(false);
      })
      .catch((err) => {
        console.error("OSRM routing failure:", err);
        setError("Routing service unavailable. Using straight line fallback.");
        setRouteCoords([[userLat, userLng], [reportLat, reportLng]]);
        setLoading(false);
      });
  }, [userLocation, reportLat, reportLng]);

  const openGoogleMaps = () => {
    if (!userLocation) return;
    const [userLat, userLng] = userLocation;
    window.open(`https://www.google.com/maps/dir/?api=1&origin=${userLat},${userLng}&destination=${reportLat},${reportLng}&travelmode=driving`, '_blank');
  };

  const formatDistance = (m) => {
    if (!m) return '';
    return m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`;
  };

  const formatDuration = (s) => {
    if (!s) return '';
    const mins = Math.round(s / 60);
    return mins >= 60 ? `${Math.floor(mins / 60)}h ${mins % 60}m` : `${mins} mins`;
  };

  const mapPoints = useMemo(() => {
    const pts = [];
    if (userLocation) pts.push(userLocation);
    if (reportLat && reportLng) pts.push([reportLat, reportLng]);
    return pts;
  }, [userLocation, reportLat, reportLng]);

  return (
    <div className="flex flex-col">
      <div className="relative w-full h-[220px] rounded-b-none border-b animate-fade-in" style={{ borderColor: 'rgba(31,30,26,0.08)' }}>
        {userLocation ? (
          <MapContainer
            center={userLocation}
            zoom={13}
            style={{ width: '100%', height: '100%', zIndex: 1 }}
            zoomControl={false}
          >
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />

            {userIcon && <Marker position={userLocation} icon={userIcon}>
              <Popup>
                <div className="text-xs font-bold text-[#201f1b]">Your Location</div>
              </Popup>
            </Marker>}

            {issueIcon && <Marker position={[reportLat, reportLng]} icon={issueIcon}>
              <Popup>
                <div className="text-xs text-[#201f1b]">
                  <p className="font-bold">Report Target</p>
                  <p className="text-[10px] mt-0.5">{reportAddress}</p>
                </div>
              </Popup>
            </Marker>}

            {routeCoords.length > 0 && (
              <Polyline
                positions={routeCoords}
                color="#6366f1"
                weight={4}
                opacity={0.85}
                dashArray={error ? "5, 10" : undefined}
              />
            )}

            <MapBoundsFitter points={mapPoints} />
          </MapContainer>
        ) : (
          <div className="w-full h-full flex items-center justify-center text-xs text-[#8a8477] py-20 text-center" style={{ background: 'var(--cream-200)' }}>
            {locating ? 'Acquiring GPS location...' : 'Loading map...'}
          </div>
        )}

        {!loading && distance !== null && (
          <div className="absolute bottom-2 left-2 z-[2] px-3 py-1.5 rounded-lg text-[11px] font-bold flex items-center gap-2 border bg-white/95 text-[#201f1b]" style={{ borderColor: 'rgba(31,30,26,0.12)' }}>
            <span className="text-indigo-700">🚗 {formatDuration(duration)}</span>
            <span className="text-[#8a8477]">|</span>
            <span>{formatDistance(distance)}</span>
          </div>
        )}
      </div>

      <div className="p-3 flex gap-2" style={{ background: 'var(--cream-100)' }}>
        <button
          onClick={openGoogleMaps}
          disabled={!userLocation}
          className="w-full py-2.5 px-3 rounded-lg text-xs font-bold flex items-center justify-center gap-2 border hover:bg-[#4a5d3f]/8 transition-colors disabled:opacity-40 cursor-pointer text-[#201f1b]"
          style={{ background: '#ffffff', borderColor: 'rgba(31,30,26,0.08)' }}
        >
          <Navigation size={13} className="text-blue-700" />
          Open in Google Maps
          <ExternalLink size={10} className="text-[#8a8477]" />
        </button>
      </div>
    </div>
  );
}

// --- Dept Tag helper ---
/**
 * Image provenance panel.
 *
 * Shows the individual forensic signals rather than a single score, because
 * "no metadata" and "declares itself AI-generated" are very different findings
 * and an admin acting on this needs to see which one it is.
 */
function ImageAuthenticityCard({ verdict, score, signals }) {
  const [expanded, setExpanded] = useState(false);
  const { label, tone, hint } = describeVerdict(verdict);

  const palette = {
    danger:  { bg: 'rgba(239,68,68,0.08)',  border: 'rgba(239,68,68,0.25)',  text: '#b91c1c' },
    warn:    { bg: 'rgba(234,179,8,0.10)',  border: 'rgba(234,179,8,0.28)',  text: '#b45309' },
    ok:      { bg: 'rgba(34,197,94,0.08)',  border: 'rgba(34,197,94,0.25)',  text: '#047857' },
    neutral: { bg: 'rgba(31,30,26,0.03)', border: 'rgba(31,30,26,0.10)', text: '#8a8477' },
  }[tone];

  const list = Array.isArray(signals) ? signals : [];

  return (
    <div className="rounded-xl p-4 border" style={{ background: palette.bg, borderColor: palette.border }}>
      <div className="flex items-start gap-3">
        <ShieldCheck size={16} className="mt-0.5 shrink-0" style={{ color: palette.text }} />
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-bold uppercase tracking-wider mb-1" style={{ color: '#8a8477' }}>
            Image Authenticity
          </p>
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-bold" style={{ color: palette.text }}>{label}</p>
            {score != null && (
              <span className="text-[10px] font-bold px-2 py-0.5 rounded"
                    style={{ background: 'rgba(31,30,26,0.06)', color: '#4b473d' }}>
                {score}/100
              </span>
            )}
          </div>
          <p className="text-xs mt-1" style={{ color: 'rgba(75,71,61,0.8)' }}>{hint}</p>

          {list.length > 0 && (
            <>
              <button
                onClick={() => setExpanded(v => !v)}
                className="mt-2 text-[11px] font-semibold flex items-center gap-1"
                style={{ color: 'rgba(138,132,119,0.9)' }}
              >
                {expanded ? 'Hide' : 'Show'} {list.length} signal{list.length > 1 ? 's' : ''}
                <ChevronDown size={12} style={{ transform: expanded ? 'rotate(180deg)' : 'none' }} />
              </button>
              {expanded && (
                <ul className="mt-2 space-y-1.5">
                  {list.map((signal, i) => (
                    <li key={i} className="text-[11px] flex items-start gap-2"
                        style={{ color: 'rgba(75,71,61,0.85)' }}>
                      <span className="mt-1 w-1 h-1 rounded-full shrink-0"
                            style={{ background: 'rgba(138,132,119,0.6)' }} />
                      <span>{signal.detail}</span>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function DeptTag({ department }) {
  if (!department) return <span className="text-[#8a8477] text-xs">—</span>;
  const lowerDept = department.toLowerCase();
  const auth = AUTHORITIES.find(a =>
    lowerDept.includes(a.abbr.toLowerCase()) ||
    lowerDept.includes(a.id.toLowerCase()) ||
    (a.name && lowerDept.includes(a.name.toLowerCase()))
  );
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold border ${
      auth?.color || 'bg-stone-100 border-stone-200 text-stone-600'
    }`}>
      <Building2 size={10} />
      {auth?.abbr || department.slice(0, 10)}
    </span>
  );
}

// --- Distance helper ---
function getDistance(lat1, lon1, lat2, lon2) {
  if (!lat1 || !lon1 || !lat2 || !lon2) return 9999;
  const R = 6371e3; // metres
  const φ1 = lat1 * Math.PI/180;
  const φ2 = lat2 * Math.PI/180;
  const Δφ = (lat2-lat1) * Math.PI/180;
  const Δλ = (lon2-lon1) * Math.PI/180;
  const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) +
          Math.cos(φ1) * Math.cos(φ2) *
          Math.sin(Δλ/2) * Math.sin(Δλ/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
}


function suggestDepartment(report) {
  const text = `${report.categories || ''} ${report.ai_prediction || ''} ${report.address || ''}`.toLowerCase();
  for (const a of AUTHORITIES) {
    if (a.keywords.some(kw => text.includes(kw))) return a.id;
  }
  return 'mbmb';
}

function buildNotificationText(report, authorityName, note) {
  const lines = [
    `[SMART CITY REPORT #${report.id}]`,
    `Category   : ${report.categories || 'N/A'}`,
    `Location   : ${report.address || report.location || 'Unknown'}`,
    `Description: ${report.description || 'No description.'}`,
    `Authority  : ${authorityName}`,
    note ? `Admin Note : ${note}` : null,
    ``,
    `Please review this issue and assign a worker.`,
  ].filter(l => l !== null);
  return lines.join('\n');
}

// --- Status helpers ---
function getStatusStyle(status) {
  switch (status) {
    case 'Pending':        return { bg: 'bg-amber-500/10 border border-amber-500/25',  text: 'text-amber-700',  border: 'border-amber-500/25',  dot: 'bg-amber-500'  };
    case 'In Review':      return { bg: 'bg-blue-500/10 border border-blue-500/25',  text: 'text-blue-700',  border: 'border-blue-500/25',  dot: 'bg-blue-500'  };
    case 'In Process':     return { bg: 'bg-indigo-500/10 border border-indigo-500/25',  text: 'text-indigo-700',  border: 'border-indigo-500/25',  dot: 'bg-indigo-500'  };
    case 'In Maintenance': return { bg: 'bg-purple-500/10 border border-purple-500/25',  text: 'text-purple-700',  border: 'border-purple-500/25',  dot: 'bg-purple-500'  };
    case 'Resolved':       return { bg: 'bg-emerald-500/10 border border-emerald-500/25', text: 'text-emerald-700 font-extrabold', border: 'border-emerald-500/25', dot: 'bg-emerald-500' };
    case 'Rejected':       return { bg: 'bg-red-500/10 border border-red-500/25 text-red-700 line-through', text: 'text-red-700 line-through', border: 'border-red-500/25', dot: 'bg-red-500' };
    default:               return { bg: 'bg-stone-100 border border-stone-200', text: 'text-stone-600',  border: 'border-stone-200',  dot: 'bg-stone-400'  };
  }
}

function fmtDate(iso) {
  if (!iso) return null;
  try { return format(parseISO(iso), 'MMM d, yyyy · HH:mm'); } catch { return iso; }
}

// --- Timeline step ---
function TimelineStep({ icon, label, time, active, last }) {
  return (
    <div className="flex gap-3">
      <div className="flex flex-col items-center">
        <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${active ? 'bg-[#4a5d3f] text-white shadow-md shadow-[#4a5d3f]/20' : 'text-[#8a8477]'}`} style={!active ? { background: 'rgba(31,30,26,0.06)' } : {}}>
          {icon}
        </div>
        {!last && <div className={`w-0.5 flex-1 mt-1 ${active ? 'bg-[#4a5d3f]/40' : 'bg-[#1f1e1a]/10'}`} style={{ minHeight: 20 }} />}
      </div>
      <div className="pb-4">
        <p className={`text-sm font-semibold ${active ? 'text-[#201f1b]' : 'text-[#8a8477]'}`}>{label}</p>
        {time && <p className="text-xs mt-0.5" style={{ color: 'rgba(138,132,119,0.85)' }}>{time}</p>}
      </div>
    </div>
  );
}

export function ReportDetailModal({ report, onClose, onUpdate, currentRole = 'admin' }) {
  const isCitizen = currentRole?.toLowerCase() === 'citizen';
  const { logStatusChange } = useAuth();
  const [manualStatus, setManualStatus] = useState(report?.status || 'Pending');
  const [updating, setUpdating] = useState(false);

  // Admin -> Authority
  const [selectedDept, setSelectedDept] = useState('mbmb');
  const [dispatchNote, setDispatchNote] = useState('');
  
  // Authority -> Team (shared pool). Worker is an optional pin; the default is
  // to leave the job in the team pool for whoever is free to accept first.
  const [teams, setTeams] = useState([]);
  const [selectedTeam, setSelectedTeam] = useState('');
  const [assignNote, setAssignNote] = useState('');

  // Authority -> Crew (sub-team within the chosen team, e.g. MBMB "Team A").
  // Selecting a crew narrows the worker pin list to that crew's members.
  const [crews, setCrews] = useState([]);
  const [selectedCrew, setSelectedCrew] = useState('');

  // Authority -> another team
  const [transferTeam, setTransferTeam] = useState('');
  const [transferReason, setTransferReason] = useState('');
  const [showTransfer, setShowTransfer] = useState(false);

  // Authority -> another crew, same team (rebalance)
  const [reassignCrewTarget, setReassignCrewTarget] = useState('');
  const [reassignNote, setReassignNote] = useState('');
  const [showReassign, setShowReassign] = useState(false);

  // Worker -> Proof
  const [workerProofNote, setWorkerProofNote] = useState('');
  const [workerFile, setWorkerFile] = useState(null);

  // Authority -> Resolve
  const [authorityNote, setAuthorityNote] = useState('');

  const [actionLoading, setActionLoading] = useState(false);
  const [actionError, setActionError] = useState(null);
  const [actionSuccess, setActionSuccess] = useState(null);

  // AI analysis state
  const [aiAnalyzing, setAiAnalyzing] = useState(false);
  const [aiResult, setAiResult] = useState(null);

  // Fullscreen image state
  const [fullScreenImage, setFullScreenImage] = useState(null);
  // Tracks a photo that 404s, so the placeholder can say so honestly.
  const [imageFailed, setImageFailed] = useState(false);
  
  // Before / After toggle state
  const [showAfter, setShowAfter] = useState(false);

  // Duplicate detection state
  const [duplicates, setDuplicates] = useState([]);

  useEffect(() => {
    if (report) {
      setManualStatus(report.status || 'Pending');
      setSelectedDept(suggestDepartment(report));
      setDispatchNote('');
      setAssignNote('');
      setSelectedCrew('');
      setTransferReason('');
      setTransferTeam('');
      setShowTransfer(false);
      setReassignCrewTarget('');
      setReassignNote('');
      setShowReassign(false);
      setWorkerProofNote('');
      setWorkerFile(null);
      setAuthorityNote('');
      setActionError(null);
      setActionSuccess(null);
      setShowAfter(report.status === 'Resolved' && !!report.completion_image_path);
      setImageFailed(false);
      
      // Check for duplicates if Admin. Must scan every report, not just the
      // newest page, or near-duplicates older than one page go undetected.
      if (currentRole === 'admin' && report.status === 'Pending') {
        fetchAllReports('admin').then(all => {
          const dups = all.filter(r => 
            r.id !== report.id && 
            r.status !== 'Resolved' &&
            r.categories === report.categories &&
            getDistance(report.latitude, report.longitude, r.latitude, r.longitude) < 50
          );
          setDuplicates(dups);
        }).catch(e => console.error('Failed to fetch duplicates', e));
      } else {
        setDuplicates([]);
      }
    }
  }, [report?.id, currentRole]);

  // Load the real team list so the authority picks an existing team instead of
  // typing a worker name that may match nobody.
  useEffect(() => {
    if (!report || isCitizen) return;
    let cancelled = false;
    fetchTeams()
      .then(list => {
        if (cancelled) return;
        setTeams(list);
        const owning = list.find(t => t.id === report.assigned_agency_id);
        setSelectedTeam(String(owning?.id ?? list[0]?.id ?? ''));
      })
      .catch(() => { if (!cancelled) setTeams([]); });
    return () => { cancelled = true; };
  }, [report?.id, isCitizen]);

  // Crews (sub-teams) within the chosen team, e.g. MBMB "Team A" vs "Team B".
  useEffect(() => {
    if (!selectedTeam) { setCrews([]); return; }
    let cancelled = false;
    fetchCrews(selectedTeam)
      .then(list => {
        if (cancelled) return;
        setCrews(list);
        // Pre-select the crew this report is already with, so reopening the
        // panel doesn't silently reset a dispatch that's already crew-scoped.
        if (report?.assigned_crew_id && list.some(c => c.id === report.assigned_crew_id)) {
          setSelectedCrew(String(report.assigned_crew_id));
        }
      })
      .catch(() => { if (!cancelled) setCrews([]); });
    return () => { cancelled = true; };
  }, [selectedTeam, report?.id]);

  // Live workload per crew, so the dispatcher can send the job to whichever crew
  // is carrying least rather than guessing. Failure is silent: the crew list
  // still works without it, just without the load figures.
  const [crewLoad, setCrewLoad] = useState({});
  useEffect(() => {
    if (!selectedTeam) { setCrewLoad({}); return; }
    let cancelled = false;
    fetchCrewWorkload(selectedTeam)
      .then(data => {
        if (cancelled) return;
        const byId = {};
        (data?.crews || []).forEach(c => { byId[c.id] = c; });
        setCrewLoad(byId);
      })
      .catch(() => { if (!cancelled) setCrewLoad({}); });
    return () => { cancelled = true; };
  }, [selectedTeam]);

  // Crews of the report's OWNING team, for the "move to another crew" panel —
  // independent of whatever team is selected in the dispatch dropdown above.
  const [ownCrews, setOwnCrews] = useState([]);
  useEffect(() => {
    if (!report?.assigned_agency_id) { setOwnCrews([]); return; }
    let cancelled = false;
    fetchCrews(report.assigned_agency_id)
      .then(list => { if (!cancelled) setOwnCrews(list); })
      .catch(() => { if (!cancelled) setOwnCrews([]); });
    return () => { cancelled = true; };
  }, [report?.assigned_agency_id, report?.id]);

  if (!report) return null;

  const style = getStatusStyle(report.status);
  const isResolved = report.status === 'Resolved';
  const hasProof = !!report.completion_image_path;

  const displayImage = (hasProof && showAfter) 
    ? getImageUrl(report.completion_image_path)
    : (report.image_path ? getImageUrl(report.image_path) : null);

  // 5-Step Timeline
  const steps = [
    { label: 'Report Submitted', icon: <AlertTriangle size={14} />, time: fmtDate(report.timestamp), done: true },
    { 
      label: report.status === 'Rejected' 
        ? 'Rejected by Admin' 
        : (report.reviewed_at ? `Approved & Forwarded to ${report.assigned_department || 'Authority'}` : 'Awaiting Admin Verification'), 
      icon: report.status === 'Rejected' ? <X size={14} className="text-[#8a8477]" /> : <Send size={14} />, 
      time: fmtDate(report.reviewed_at || report.forwarded_at), 
      done: !!report.reviewed_at || report.status === 'Rejected' 
    },
    ...(report.status !== 'Rejected' ? [
      { 
        label: report.in_process_at
          ? (isCitizen
              ? 'Task Assigned to Worker'
              : report.assigned_worker
                ? `Assigned to Worker: ${report.assigned_worker}`
                : 'Unclaimed — Sitting in Team Pool')
          : 'Awaiting Worker Assignment',
        icon: <HardHat size={14} />, 
        time: fmtDate(report.in_process_at), 
        done: !!report.in_process_at 
      },
      { label: report.completion_submitted_at ? 'Maintenance Completed' : (report.in_maintenance_at ? 'Maintenance In Progress' : 'Awaiting Maintenance'), icon: <Wrench size={14} />, time: fmtDate(report.completion_submitted_at || report.in_maintenance_at), done: !!report.in_maintenance_at },
      { 
        label: report.resolved_at 
          ? 'Resolved & Verified' 
          : (report.worker_completed ? 'Awaiting Final Admin Verification' : 'Awaiting Worker Completion'), 
        icon: <ShieldCheck size={14} />, 
        time: fmtDate(report.resolved_at), 
        done: !!report.resolved_at 
      },
    ] : [])
  ];

  const execAction = async (actionFn, successMsg, newStatus) => {
    try {
      setActionLoading(true); setActionError(null);
      const res = await actionFn();
      if (newStatus && newStatus !== report.status) {
        logStatusChange(report.id, report.status, newStatus);
      }
      onUpdate(report.id, res); // res is the updated report from backend
      setActionSuccess(successMsg);
      setTimeout(() => setActionSuccess(null), 3000);
    } catch (err) {
      setActionError(err.message);
    } finally {
      setActionLoading(false);
    }
  };

  const handleManualUpdate = () => execAction(
    () => updateReportStatus(report.id, manualStatus), 
    'Status manually overridden.',
    manualStatus
  );

  const handleAdminApprove = () => execAction(
    () => {
      const deptName = AUTHORITIES.find(a => a.id === selectedDept)?.abbr || selectedDept;
      return adminReview(report.id, deptName, dispatchNote);
    },
    'Report approved and sent to Local Authority.',
    'In Review'
  );

  const handleAdminReject = () => execAction(
    () => adminReject(report.id, dispatchNote),
    'Report rejected and closed.',
    'Rejected'
  );

  const handleAuthorityAssign = () => {
    if (!selectedTeam) return setActionError('Select a team to dispatch this report to.');
    const team = teams.find(t => String(t.id) === String(selectedTeam));
    const crew = selectedCrew ? crews.find(c => String(c.id) === String(selectedCrew)) : null;
    const crewId = crew ? crew.id : null;
    // Dispatch is to a crew, never to an individual: the crew shares the job and
    // sorts out between themselves who goes.
    const poolLabel = crew ? `${crew.name} (${team?.name || 'team'})` : (team?.name || 'team');
    return execAction(
      () => dispatchToTeam(report.id, Number(selectedTeam), null, assignNote, crewId),
      `Sent to ${poolLabel}. Everyone on the crew can see and work on it.`,
      'In Process'
    );
  };

  const handleTransfer = () => {
    if (!transferTeam) return setActionError('Select the team to hand this over to.');
    const target = teams.find(t => String(t.id) === String(transferTeam));
    return execAction(
      () => transferReport(report.id, Number(transferTeam), transferReason),
      `Transferred to ${target?.name || 'the selected team'}. It is now in their pool.`,
      'In Process'
    );
  };

  const handleReassignCrew = () => {
    // An empty selection means "move to the general (crew-less) pool" — a
    // legitimate destination, not a missing choice, so nothing to block here.
    const crewId = reassignCrewTarget ? Number(reassignCrewTarget) : null;
    const crew = crewId ? ownCrews.find(c => c.id === crewId) : null;
    return execAction(
      () => reassignCrew(report.id, crewId, reassignNote),
      crew
        ? `Moved to ${crew.name}'s pool.`
        : 'Moved back to the general team pool.',
      'In Process'
    );
  };

  const handleWorkerClaim = () => execAction(
    () => claimReport(report.id),
    'Task claimed. It is yours now.',
    'In Process'
  );

  const handleWorkerStart = () => execAction(
    () => startMaintenance(report.id),
    'Maintenance started.',
    'In Maintenance'
  );

  const handleWorkerComplete = async () => {
    if (!workerProofNote.trim()) return setActionError('Please provide completion notes.');
    try {
      setActionLoading(true);
      setActionError(null);
      setAiResult(null);

      // Submit the proof photo
      const res = await completeTask(report.id, workerProofNote, workerFile);
      onUpdate(report.id, res);
      setActionSuccess('✓ Proof submitted successfully for verification!');

      setTimeout(() => setActionSuccess(null), 5000);
    } catch (err) {
      setActionError(err.message);
    } finally {
      setActionLoading(false);
    }
  };

  const handleAuthorityResolve = () => {
    if (!authorityNote.trim()) return setActionError('Please provide resolution verification notes.');
    return execAction(
      () => authorityResolve(report.id, authorityNote),
      'Report fully resolved.',
      'Resolved'
    );
  };

  const handleRejectProof = () => {
    if (!authorityNote.trim()) return setActionError('Please provide a rejection reason in the notes field.');
    return execAction(
      () => rejectProof(report.id, authorityNote),
      'Completion proof rejected. Task returned to worker.',
      'In Maintenance'
    );
  };

  return (
    <>
      <div className="fixed inset-0 z-40" style={{ background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(8px)' }} onClick={onClose} />
      <div className="fixed inset-y-0 right-0 w-full max-w-lg z-50 flex flex-col" style={{ background: '#ffffff', boxShadow: '0 32px 80px rgba(31,30,26,0.18)', borderLeft: '1px solid rgba(31,30,26,0.08)' }}>
        {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 shrink-0" style={{ borderBottom: '1px solid rgba(31,30,26,0.07)', background: 'var(--cream-200)' }}>
          <div className="flex items-center gap-3">
            <div>
              <h2 className="text-lg font-bold" style={{ color: '#201f1b' }}>Report #{report.id}</h2>
              <p className="text-xs mt-0.5" style={{ color: '#8a8477' }}>{fmtDate(report.timestamp) || 'Unknown Date'}</p>
            </div>
            <span className={`px-3 py-1 rounded-full text-xs font-bold border ${style.bg} ${style.text} ${style.border}`}>
              <span className={`inline-block w-1.5 h-1.5 rounded-full ${style.dot} mr-1.5`} />
              {report.status || 'Pending'}
            </span>
          </div>
          <button onClick={onClose} className="p-2 rounded-full transition-colors" style={{ color: '#8a8477' }}>
            <X size={20} />
          </button>
        </div>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto">
          {/* Main Image */}
          <div className="w-full h-52 relative shrink-0" style={{ background: 'var(--cream-200)' }}>
            {displayImage && !imageFailed ? (
              <img
                src={displayImage}
                alt={showAfter ? 'After fix' : 'Original issue'}
                className="w-full h-full object-cover cursor-pointer hover:opacity-90 transition-opacity"
                onClick={() => setFullScreenImage(displayImage)}
                // A photo that fails to load falls through to the placeholder
                // below. It used to be replaced with a stock street scene, which
                // an authority had no way of telling apart from the real thing.
                onError={() => setImageFailed(true)}
              />
            ) : (
              <div className="absolute inset-0 flex flex-col items-center justify-center text-[#8a8477] px-4 text-center">
                <ImageIcon size={40} className="opacity-40 mb-2" />
                <p className="text-sm font-medium">
                  {imageFailed ? 'Photo no longer available' : 'No Image Provided'}
                </p>
                {imageFailed && (
                  <p className="text-[11px] mt-1 max-w-xs">
                    The file is missing from the server. Do not judge this report from
                    the image.
                  </p>
                )}
              </div>
            )}

            {/* Before / After toggle tabs */}
            {hasProof && (
              <div className="absolute bottom-3 right-3 flex rounded-lg overflow-hidden shadow-lg border border-[#1f1e1a]/10">
                <button
                  onClick={(e) => { e.stopPropagation(); setShowAfter(false); }}
                  className={`px-3 py-1.5 text-xs font-bold transition-colors ${
                    !showAfter ? 'bg-[#4a5d3f] text-white' : 'bg-white text-[#8a8477] hover:bg-[#f7f4ec]'
                  }`}
                >
                  Before
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); setShowAfter(true); }}
                  className={`px-3 py-1.5 text-xs font-bold transition-colors ${
                    showAfter ? 'bg-[#4a5d3f] text-white' : 'bg-white text-[#8a8477] hover:bg-[#f7f4ec]'
                  }`}
                >
                  After
                </button>
              </div>
            )}
          </div>

          <div className="p-6 space-y-6">
            {/* Category + Description + AI */}
            <div className="flex gap-12">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider mb-1" style={{ color: '#8a8477' }}>Category</p>
              <p className="text-xl font-bold" style={{ color: '#201f1b' }}>{report.categories || 'Uncategorized'}</p>
              </div>
              {report.assigned_department && (
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider mb-1" style={{ color: '#8a8477' }}>Assigned To</p>
                  <DeptTag department={report.assigned_department} />
                </div>
              )}
            </div>

            {duplicates.length > 0 && (
              <div className="rounded-xl p-4 border" style={{ background: 'rgba(239,68,68,0.05)', borderColor: 'rgba(239,68,68,0.20)' }}>
                <div className="flex items-center gap-2 mb-2" style={{ color: '#b91c1c' }}>
                  <AlertTriangle size={16} />
                  <p className="font-bold text-sm" style={{ color: '#b91c1c' }}>Potential Duplicates Detected!</p>
                </div>
                <p className="text-xs mb-2" style={{ color: '#4b473d' }}>
                  There are {duplicates.length} other active report(s) of <strong>{report.categories}</strong> within 50 meters of this location.
                </p>
                <div className="flex flex-wrap gap-2">
                  {duplicates.map(d => (
                    <span key={d.id} className="text-[10px] font-bold px-2 py-1 rounded-md" style={{ background: 'rgba(239,68,68,0.08)', color: '#b91c1c', border: '1px solid rgba(239,68,68,0.25)' }}>
                      Report #{d.id} ({d.status})
                    </span>
                  ))}
                </div>
              </div>
            )}

            {report.authenticity_verdict && (
              <ImageAuthenticityCard
                verdict={report.authenticity_verdict}
                score={report.authenticity_score}
                signals={report.authenticity_signals}
              />
            )}

            {report.ai_prediction && (
              <div className="rounded-xl p-4 border" style={{ background: 'var(--cream-100)', borderColor: 'rgba(31,30,26,0.07)' }}>
                <div className="min-w-0 flex-1">
                  <p className="text-[10px] font-bold uppercase tracking-wider mb-1" style={{ color: '#8a8477' }}>Original Analysis</p>
                  <p className="text-sm font-semibold mb-1" style={{ color: '#201f1b' }}>{report.ai_prediction}</p>
                  <div className="flex items-center gap-2">
                    <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: 'rgba(31,30,26,0.08)' }}>
                      <div className="h-full bg-[#4a5d3f] rounded-full" style={{ width: report.confidence || '0%' }} />
                    </div>
                    <span className="text-[10px] font-bold shrink-0" style={{ color: '#4b473d' }}>{report.confidence}</span>
                  </div>
                </div>
              </div>
            )}

            <div>
              <p className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: '#8a8477' }}>Description</p>
              <p className="text-sm leading-relaxed p-4 rounded-xl" style={{ color: '#4b473d', background: 'var(--cream-100)', border: '1px solid rgba(31,30,26,0.07)' }}>
                {report.description || 'No description provided.'}
              </p>
            </div>

            <div>
              <p className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: '#8a8477' }}>Location & Directions</p>
              <div className="rounded-xl overflow-hidden border" style={{ background: 'var(--cream-100)', borderColor: 'rgba(31,30,26,0.07)' }}>
                <div className="p-3 flex items-start gap-3" style={{ borderBottom: '1px solid rgba(31,30,26,0.07)', background: 'var(--cream-200)' }}>
                  <MapPin className="shrink-0 mt-0.5 text-indigo-700" size={16} />
                  <div>
                    <p className="text-sm font-semibold" style={{ color: '#201f1b' }}>{report.address || report.location || 'Not available'}</p>
                    {report.latitude && report.longitude && (
                      <p className="text-[10px] text-[#8a8477] mt-0.5">GPS: {report.latitude.toFixed(5)}, {report.longitude.toFixed(5)}</p>
                    )}
                  </div>
                </div>
                {!isCitizen && report.latitude && report.longitude && (
                  <ReportDirectionsMap 
                    reportLat={report.latitude} 
                    reportLng={report.longitude}
                    reportAddress={report.address || report.location || 'Issue Location'}
                  />
                )}
              </div>
            </div>

            {/* Timeline */}
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider mb-4" style={{ color: '#8a8477' }}>Lifecycle Timeline</p>
              <div className="pl-1">
                {steps.map((s, i) => (
                  <TimelineStep key={i} icon={s.icon} label={s.label} time={s.time} active={s.done} last={i === steps.length - 1} />
                ))}
              </div>
            </div>

            {/* Notes Thread */}
            {!isCitizen && report.authority_notes && (
              <div className="rounded-xl overflow-hidden" style={{ background: 'var(--cream-100)', border: '1px solid rgba(31,30,26,0.07)' }}>
                <div className="flex items-center gap-2 px-4 py-3" style={{ borderBottom: '1px solid rgba(31,30,26,0.07)', background: 'var(--cream-200)' }}>
                  <MessageSquare size={14} className="text-[#8a8477]" />
                  <p className="text-xs font-bold uppercase tracking-wider" style={{ color: '#8a8477' }}>Communication Thread</p>
                </div>
                <div className="p-4 space-y-2">
                  {report.authority_notes.split('\n').map((line, i) => {
                    const isAuth = line.startsWith('[Authority]');
                    const isAdmin = line.startsWith('[Admin]');
                    const isRes = line.startsWith('[Resolved]');
                    return (
                      <div key={i} className={`flex items-start gap-2 p-3 rounded-lg text-sm`} style={{ background: '#ffffff', border: '1px solid rgba(31,30,26,0.07)' }}>
                        <MessageSquare size={14} className="shrink-0 mt-0.5 text-[#8a8477]" />
                        <p className="text-sm" style={{ color: '#4b473d' }}>{line}</p>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Worker Proof Display (Visible to all if it exists) */}
            {!isCitizen && report.worker_completed && (
              <div className="rounded-xl overflow-hidden" style={{ background: 'var(--cream-100)', border: '1px solid rgba(31,30,26,0.07)' }}>
                <div className="px-4 py-3 flex items-center justify-between" style={{ borderBottom: '1px solid rgba(31,30,26,0.07)', background: 'var(--cream-200)' }}>
                  <div className="flex items-center gap-2">
                    <Camera size={14} className="text-[#8a8477]" />
                    <p className="text-xs font-bold uppercase tracking-wider" style={{ color: '#4b473d' }}>Worker Completion Proof</p>
                    <span className="ml-2 px-1.5 py-0.5 text-[9px] font-bold rounded bg-[#4a5d3f]/10 text-[#4a5d3f] border border-[#4a5d3f]/20">
                      {report.status === 'Resolved' ? 'Final (Locked)' : 'Awaiting Admin Verification'}
                    </span>
                  </div>
                </div>
                <div className="p-4">
                  {report.completion_image_path && (
                    <img
                      src={getImageUrl(report.completion_image_path)}
                      alt="Proof"
                      className="w-full h-40 object-cover rounded-lg mb-3 border border-[#1f1e1a]/10 cursor-pointer hover:opacity-90 transition-opacity"
                      onClick={() => setFullScreenImage(getImageUrl(report.completion_image_path))}
                    />
                  )}

                  <p className="text-sm p-3 rounded-lg" style={{ color: '#4b473d', background: '#ffffff', border: '1px solid rgba(31,30,26,0.07)' }}>{report.completion_notes}</p>
                  <p className="text-xs mt-2 text-right" style={{ color: '#8a8477' }}>Submitted: {fmtDate(report.completion_submitted_at)}</p>
                </div>
              </div>
            )}

            {/* =========================================
                ROLE-BASED ACTION PANELS 
                ========================================= */}

            {/* 1. ADMIN PANEL (Pending) */}
            {currentRole === 'admin' && report.status === 'Pending' && (
              <div className="rounded-2xl overflow-hidden" style={{ background: '#ffffff', border: '1px solid rgba(31,30,26,0.08)' }}>
                <div className="flex items-center gap-2 px-5 py-4 bg-[#4a5d3f]">
                  <Send size={18} className="text-white" />
                  <p className="text-sm font-bold text-white">Approve & Forward to Authority</p>
                </div>
                <div className="p-5 space-y-4">
                  <div>
                    <label className="block text-xs font-semibold mb-2" style={{ color: '#201f1b' }}>Select Authority</label>
                    <select value={selectedDept} onChange={e => setSelectedDept(e.target.value)} className="w-full px-3 py-2 rounded-xl text-sm" style={{ background: 'var(--cream-200)', border: '1px solid rgba(31,30,26,0.10)', color: '#201f1b' }}>
                      {AUTHORITIES.filter(a => ['mbmb', 'jkr', 'swcorp'].includes(a.id)).map(a => <option key={a.id} value={a.id}>[{a.abbr}] {a.name}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold mb-2" style={{ color: '#201f1b' }}>Admin Note</label>
                    <textarea value={dispatchNote} onChange={e => setDispatchNote(e.target.value)} rows={2} className="w-full px-3 py-2 rounded-xl text-sm resize-none" style={{ background: 'var(--cream-200)', border: '1px solid rgba(31,30,26,0.10)', color: '#201f1b' }} />
                  </div>
                  <div className="flex gap-3">
                    <button onClick={handleAdminApprove} disabled={actionLoading} className="flex-2 py-3 bg-[#4a5d3f] text-white font-bold text-sm rounded-xl hover:bg-[#3d4d34] disabled:opacity-50 transition-colors border border-[#4a5d3f] cursor-pointer">
                      {actionLoading ? 'Approving...' : 'Approve & Send'}
                    </button>
                    <button onClick={handleAdminReject} disabled={actionLoading} className="flex-1 py-3 bg-stone-100 border border-stone-200 text-stone-600 hover:bg-stone-200 font-bold text-sm rounded-xl disabled:opacity-50 transition-colors cursor-pointer">
                      Reject
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* 2. AUTHORITY PANEL (In Review) - Dispatch to a team pool */}
            {currentRole?.startsWith('authority') && report.status === 'In Review' && (
              <div className="rounded-2xl overflow-hidden" style={{ background: '#ffffff', border: '1px solid rgba(31,30,26,0.08)' }}>
                <div className="flex items-center gap-2 px-5 py-4 bg-[#4a5d3f]">
                  <HardHat size={18} className="text-white" />
                  <p className="text-sm font-bold text-white">Dispatch to Team</p>
                </div>
                <div className="p-5 space-y-4">
                  <div>
                    <label className="block text-xs font-semibold mb-2" style={{ color: '#201f1b' }}>Team</label>
                    <select value={selectedTeam} onChange={e => { setSelectedTeam(e.target.value); setSelectedCrew(''); }} className="w-full px-3 py-2 rounded-xl text-sm" style={{ background: 'var(--cream-200)', border: '1px solid rgba(31,30,26,0.10)', color: '#201f1b' }}>
                      {teams.length === 0 && <option value="">Loading teams...</option>}
                      {teams.map(t => (
                        <option key={t.id} value={t.id}>
                          {t.name} — {t.open_count} open, {t.unclaimed_count} unclaimed, {t.worker_count} workers
                        </option>
                      ))}
                    </select>
                  </div>
                  {crews.length > 0 && (
                    <div>
                      <label className="block text-xs font-semibold mb-2" style={{ color: '#201f1b' }}>Crew</label>
                      <select value={selectedCrew} onChange={e => setSelectedCrew(e.target.value)} className="w-full px-3 py-2 rounded-xl text-sm" style={{ background: 'var(--cream-200)', border: '1px solid rgba(31,30,26,0.10)', color: '#201f1b' }}>
                        <option value="">Whole team — shared by every worker</option>
                        {crews.map(c => {
                          // Load figures let the dispatcher balance burden rather
                          // than guess which crew is free.
                          const load = crewLoad[c.id];
                          const parts = [`${c.members.length} member${c.members.length === 1 ? '' : 's'}`];
                          if (load) {
                            parts.push(`${load.open_count} open`);
                            if (load.load_per_worker != null) parts.push(`${load.load_per_worker}/worker`);
                            if (load.sla_breached_count > 0) parts.push(`${load.sla_breached_count} past SLA`);
                          }
                          return (
                            <option key={c.id} value={c.id} disabled={c.status === 'disabled'}>
                              {c.name}{c.status === 'disabled' ? ' (disabled)' : ''} — {parts.join(' · ')}
                            </option>
                          );
                        })}
                      </select>
                      <p className="mt-2 text-[11px] text-[#8a8477]">
                        The whole crew shares this job — any member can start it and any member can
                        finish it, so they coordinate between themselves. Other crews cannot see it.
                        Pick the crew carrying the lightest load.
                      </p>
                    </div>
                  )}
                  <div>
                    <label className="block text-xs font-semibold mb-2" style={{ color: '#201f1b' }}>Assignment Notes</label>
                    <textarea value={assignNote} onChange={e => setAssignNote(e.target.value)} rows={2} className="w-full px-3 py-2 rounded-xl text-sm resize-none" style={{ background: 'var(--cream-200)', border: '1px solid rgba(31,30,26,0.10)', color: '#201f1b' }} />
                  </div>
                  <button onClick={handleAuthorityAssign} disabled={actionLoading || !selectedTeam} className="w-full py-3 bg-[#4a5d3f] text-white font-bold text-sm rounded-xl hover:bg-[#3d4d34] disabled:opacity-50 border border-[#4a5d3f] cursor-pointer">
                    {actionLoading ? 'Dispatching...' : 'Send to Crew'}
                  </button>
                </div>
              </div>
            )}

            {/* 2b. AUTHORITY — hand an unfinished job to another team */}
            {currentRole?.startsWith('authority') && ['In Process', 'In Maintenance'].includes(report.status) && !report.worker_completed && (
              <div className="rounded-2xl overflow-hidden" style={{ background: '#ffffff', border: '1px solid rgba(31,30,26,0.08)' }}>
                <div className="flex items-center justify-between px-5 py-4 bg-[#4a5d3f]">
                  <div className="flex items-center gap-2">
                    <Send size={18} className="text-white" />
                    <p className="text-sm font-bold text-white">Team Status</p>
                  </div>
                  <div className="flex items-center gap-3">
                    {ownCrews.length > 0 && (
                      <button onClick={() => setShowReassign(v => !v)} className="text-xs font-semibold text-white/80 hover:text-white cursor-pointer">
                        {showReassign ? 'Cancel' : 'Move crew'}
                      </button>
                    )}
                    <button onClick={() => setShowTransfer(v => !v)} className="text-xs font-semibold text-white/80 hover:text-white cursor-pointer">
                      {showTransfer ? 'Cancel' : 'Transfer team'}
                    </button>
                  </div>
                </div>
                <div className="p-5 space-y-3">
                  <div className="flex flex-wrap gap-2 text-xs">
                    <span className="px-2 py-1 rounded-lg bg-[#4a5d3f]/10 text-[#4a5d3f]">
                      Team: <strong className="text-[#3d4d34]">{report.assigned_team || report.assigned_department || 'Unassigned'}</strong>
                    </span>
                    {report.assigned_crew && (
                      <span className="px-2 py-1 rounded-lg bg-[#4a5d3f]/10 text-[#4a5d3f]">
                        Crew: <strong className="text-[#3d4d34]">{report.assigned_crew}</strong>
                      </span>
                    )}
                    <span className="px-2 py-1 rounded-lg bg-[#4a5d3f]/10 text-[#4a5d3f]">
                      {report.assigned_worker
                        ? <>Claimed by <strong className="text-[#3d4d34]">{report.assigned_worker}</strong></>
                        : <strong className="text-amber-700">Unclaimed — sitting in the pool</strong>}
                    </span>
                    {report.release_count > 0 && (
                      <span className="px-2 py-1 rounded-lg bg-amber-500/10 text-amber-700">
                        Released {report.release_count}x
                      </span>
                    )}
                  </div>

                  {showReassign && (
                    <div className="space-y-3 pt-2">
                      <div>
                        <label className="block text-xs font-semibold mb-2" style={{ color: '#201f1b' }}>Move to crew</label>
                        <select value={reassignCrewTarget} onChange={e => setReassignCrewTarget(e.target.value)} className="w-full px-3 py-2 rounded-xl text-sm" style={{ background: 'var(--cream-200)', border: '1px solid rgba(31,30,26,0.10)', color: '#201f1b' }}>
                          <option value="">General pool — whole team</option>
                          {ownCrews.filter(c => c.id !== report.assigned_crew_id).map(c => (
                            <option key={c.id} value={c.id} disabled={c.status === 'disabled'}>
                              {c.name}{c.status === 'disabled' ? ' (disabled)' : ''} — {c.members.length} member{c.members.length === 1 ? '' : 's'}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs font-semibold mb-2" style={{ color: '#201f1b' }}>Note</label>
                        <textarea value={reassignNote} onChange={e => setReassignNote(e.target.value)} rows={2} placeholder="e.g. Team A is overloaded, Team B has room" className="w-full px-3 py-2 rounded-xl text-sm resize-none" style={{ background: 'var(--cream-200)', border: '1px solid rgba(31,30,26,0.10)', color: '#201f1b' }} />
                      </div>
                      <button onClick={handleReassignCrew} disabled={actionLoading} className="w-full py-3 bg-[#4a5d3f] text-white font-bold text-sm rounded-xl hover:bg-[#3d4d34] disabled:opacity-50 border border-[#4a5d3f] cursor-pointer">
                        {actionLoading ? 'Moving...' : 'Move Crew'}
                      </button>
                      <p className="text-[11px] text-[#8a8477]">
                        Stays within {report.assigned_team || 'this team'} — no approval needed. If the current claimant isn't on the destination crew, the job goes back to unclaimed.
                      </p>
                    </div>
                  )}

                  {showTransfer && (
                    <div className="space-y-3 pt-2">
                      <div>
                        <label className="block text-xs font-semibold mb-2" style={{ color: '#201f1b' }}>Hand over to</label>
                        <select value={transferTeam} onChange={e => setTransferTeam(e.target.value)} className="w-full px-3 py-2 rounded-xl text-sm" style={{ background: 'var(--cream-200)', border: '1px solid rgba(31,30,26,0.10)', color: '#201f1b' }}>
                          <option value="">Select a team...</option>
                          {teams.filter(t => t.id !== report.assigned_agency_id).map(t => (
                            <option key={t.id} value={t.id}>
                              {t.name} — {t.open_count} open, {t.worker_count} workers
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs font-semibold mb-2" style={{ color: '#201f1b' }}>Reason</label>
                        <textarea value={transferReason} onChange={e => setTransferReason(e.target.value)} rows={2} placeholder="e.g. team overloaded, outside our scope" className="w-full px-3 py-2 rounded-xl text-sm resize-none" style={{ background: 'var(--cream-200)', border: '1px solid rgba(31,30,26,0.10)', color: '#201f1b' }} />
                      </div>
                      <button onClick={handleTransfer} disabled={actionLoading || !transferTeam} className="w-full py-3 bg-[#4a5d3f] text-white font-bold text-sm rounded-xl hover:bg-[#3d4d34] disabled:opacity-50 border border-[#4a5d3f] cursor-pointer">
                        {actionLoading ? 'Transferring...' : 'Transfer to Team'}
                      </button>
                      <p className="text-[11px] text-[#8a8477]">
                        The job returns to an unclaimed state in the receiving team's pool.
                      </p>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* 3. WORKER PANEL (In Process) — claim from the pool, then start */}
            {currentRole?.startsWith('worker') && report.status === 'In Process' && (
              <div className="rounded-2xl p-5 text-center" style={{ background: '#ffffff', border: '1px solid rgba(31,30,26,0.08)' }}>
                {report.in_pool ? (
                  <>
                    <h3 className="font-bold text-[#201f1b] mb-2">Open job in your team pool</h3>
                    <p className="text-sm text-[#8a8477] mb-4">
                      Nobody has taken this yet. Accept it to claim it — whoever accepts first gets it.
                    </p>
                    <button onClick={handleWorkerClaim} disabled={actionLoading} className="w-full py-3 bg-[#4a5d3f] text-white font-bold text-sm rounded-xl hover:bg-[#3d4d34] border border-[#4a5d3f] disabled:opacity-50 cursor-pointer">
                      {actionLoading ? 'Accepting...' : 'Accept Task'}
                    </button>
                  </>
                ) : (
                  <>
                    <h3 className="font-bold text-[#201f1b] mb-2">You've been assigned this task</h3>
                    <p className="text-sm text-[#8a8477] mb-4">Click below when you have arrived at the location and are starting the maintenance work.</p>
                    <button onClick={handleWorkerStart} disabled={actionLoading} className="w-full py-3 bg-[#4a5d3f] text-white font-bold text-sm rounded-xl hover:bg-[#3d4d34] border border-[#4a5d3f] disabled:opacity-50 cursor-pointer">
                      {actionLoading ? 'Updating...' : 'Start Work'}
                    </button>
                  </>
                )}
              </div>
            )}

            {/* 4. WORKER PANEL (In Maintenance) - Submit Proof */}
            {currentRole?.startsWith('worker') && report.status === 'In Maintenance' && !report.worker_completed && (
              <div className="rounded-2xl overflow-hidden" style={{ background: '#ffffff', border: '1px solid rgba(31,30,26,0.08)' }}>
                <div className="flex items-center gap-2 px-5 py-4 bg-[#4a5d3f]">
                  <Camera size={18} className="text-white" />
                  <p className="text-sm font-bold text-white">Submit Completion Proof</p>
                </div>
                <div className="p-5 space-y-4">
                  <div>
                    <label className="block text-xs font-semibold text-[#8a8477] mb-2">Upload Photo Proof</label>
                    <input type="file" accept="image/*" onChange={e => setWorkerFile(e.target.files[0])} className="w-full text-sm text-[#8a8477] file:mr-4 file:py-2 file:px-4 file:rounded-xl file:border-0 file:text-sm file:font-semibold file:bg-[#4a5d3f]/10 file:text-[#4a5d3f] hover:file:bg-[#4a5d3f]/20" />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold mb-2" style={{ color: '#201f1b' }}>Completion Notes</label>
                    <textarea value={workerProofNote} onChange={e => setWorkerProofNote(e.target.value)} placeholder="Describe what was fixed..." rows={3} className="w-full px-3 py-2 rounded-xl text-sm resize-none" style={{ background: 'var(--cream-200)', border: '1px solid rgba(31,30,26,0.10)', color: '#201f1b' }} />
                  </div>
                  <button onClick={handleWorkerComplete} disabled={actionLoading || !workerProofNote} className="w-full py-3 bg-[#4a5d3f] text-white font-bold text-sm rounded-xl hover:bg-[#3d4d34] disabled:opacity-50">
                    {actionLoading ? 'Submitting...' : 'Submit Proof'}
                  </button>
                </div>
              </div>
            )}

            {/* 5. ADMIN PANEL (In Maintenance + worker completed) - Confirm Resolve or Reject */}
            {currentRole === 'admin' && report.status === 'In Maintenance' && report.worker_completed && (
              <div className="rounded-2xl overflow-hidden" style={{ background: '#ffffff', border: '1px solid rgba(31,30,26,0.08)' }}>
                <div className="flex items-center gap-2 px-5 py-4 bg-[#4a5d3f]">
                  <ShieldCheck size={18} className="text-white" />
                  <p className="text-sm font-bold text-white">Admin Verification & Resolution</p>
                </div>
                <div className="p-5 space-y-4">
                  <div className="p-3 text-xs rounded-lg flex flex-col gap-1" style={{ background: 'var(--cream-100)', border: '1px solid rgba(31,30,26,0.08)', color: '#201f1b' }}>
                    <p className="font-bold flex items-center gap-1">Action Required</p>
                    <p>Review the completion proof notes and image above. You can either approve the resolution or reject the proof if it is blurry or ambiguous.</p>
                  </div>
                  <p className="text-sm mb-3" style={{ color: '#4b473d' }}>Please review the notes and photo above to verify the fix or reject it.</p>
                  <div>
                    <label className="block text-xs font-semibold mb-2" style={{ color: '#201f1b' }}>Verification Notes / Rejection Reason</label>
                    <textarea value={authorityNote} onChange={e => setAuthorityNote(e.target.value)} placeholder="Looks good... / Please retake, image is blurry." rows={2} className="w-full px-3 py-2 rounded-xl text-sm resize-none" style={{ background: 'var(--cream-200)', border: '1px solid rgba(31,30,26,0.10)', color: '#201f1b' }} />
                  </div>
                  <div className="flex gap-3">
                    <button onClick={handleAuthorityResolve} disabled={actionLoading} className="flex-2 py-3 bg-[#4a5d3f] text-white font-bold text-sm rounded-xl hover:bg-[#3d4d34] disabled:opacity-50 transition-colors border border-[#4a5d3f] cursor-pointer">
                      {actionLoading ? 'Verifying...' : 'Confirm Resolved'}
                    </button>
                    <button onClick={handleRejectProof} disabled={actionLoading} className="flex-1 py-3 bg-stone-100 border border-stone-200 text-stone-600 hover:bg-stone-200 font-bold text-sm rounded-xl disabled:opacity-50 transition-colors cursor-pointer">
                      Reject Proof
                    </button>
                  </div>
                </div>
              </div>
            )}

          </div>
        </div>

        {/* Footer — Manual Override */}
        <div className="px-6 py-4 shrink-0" style={{ borderTop: '1px solid rgba(31,30,26,0.07)', background: 'var(--cream-200)' }}>
          {actionError && (
            <div className="mb-3 p-3 text-xs rounded-lg flex items-center gap-2" style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', color: '#b91c1c' }}>
              {actionError}
            </div>
          )}
          {actionSuccess && (
            <div className="mb-3 p-3 text-xs rounded-lg flex items-center gap-2" style={{ background: 'rgba(74,93,63,0.08)', border: '1px solid rgba(74,93,63,0.25)', color: '#3d4d34' }}>
              {actionSuccess}
            </div>
          )}
          {currentRole === 'admin' && (
            <div className="flex items-center gap-2">
              <RotateCcw size={13} className="text-[#8a8477] shrink-0" />
              <p className="text-xs text-[#8a8477] font-medium mr-auto">Manual override</p>
              <div className="relative">
                <select value={manualStatus} onChange={e => setManualStatus(e.target.value)} className="appearance-none text-xs rounded-lg px-3 py-2 pr-7 font-medium" style={{ background: 'var(--cream-100)', border: '1px solid rgba(31,30,26,0.10)', color: '#201f1b' }}>
                  <option value="Pending">Pending</option>
                  <option value="In Review">In Review</option>
                  <option value="In Process">In Process</option>
                  <option value="In Maintenance">In Maintenance</option>
                  <option value="Resolved">Resolved</option>
                  <option value="Rejected">Rejected</option>
                </select>
                <ChevronDown size={12} className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[#8a8477]" />
              </div>
              <button onClick={handleManualUpdate} disabled={actionLoading || manualStatus === report.status} className="flex items-center gap-1.5 px-4 py-2 bg-[#4a5d3f] text-white text-xs font-bold rounded-lg hover:bg-[#3d4d34] disabled:opacity-40 shadow-sm border border-[#4a5d3f] cursor-pointer">
                Save
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Full Screen Image Viewer */}
      {fullScreenImage && (
        <div 
          className="fixed inset-0 bg-black/90 z-[100] flex items-center justify-center p-4 cursor-pointer"
          onClick={() => setFullScreenImage(null)}
        >
          <button 
            className="absolute top-6 right-6 text-white/70 hover:text-white bg-black/50 p-2 rounded-full backdrop-blur-sm transition-colors"
            onClick={(e) => { e.stopPropagation(); setFullScreenImage(null); }}
          >
            <X size={24} />
          </button>
          <img 
            src={fullScreenImage} 
            alt="Full Screen" 
            className="max-w-full max-h-full object-contain rounded-lg shadow-2xl cursor-default"
            onClick={(e) => e.stopPropagation()} 
          />
        </div>
      )}
    </>
  );
}
