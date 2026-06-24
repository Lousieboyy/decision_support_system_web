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
  assignWorker, startMaintenance, completeTask, authorityResolve,
  fetchReports, analyzeReportImage, rejectProof
} from '../api/reportsApi';
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
      <div className="relative w-full h-[220px] rounded-b-none border-b animate-fade-in" style={{ borderColor: 'rgba(255,255,255,0.08)' }}>
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
                <div className="text-xs font-bold text-slate-800">Your Location</div>
              </Popup>
            </Marker>}

            {issueIcon && <Marker position={[reportLat, reportLng]} icon={issueIcon}>
              <Popup>
                <div className="text-xs text-slate-800">
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
          <div className="w-full h-full flex items-center justify-center text-xs text-slate-500 py-20 bg-zinc-950 text-center">
            {locating ? 'Acquiring GPS location...' : 'Loading map...'}
          </div>
        )}

        {!loading && distance !== null && (
          <div className="absolute bottom-2 left-2 z-[2] px-3 py-1.5 rounded-lg text-[11px] font-bold flex items-center gap-2 border bg-zinc-900/90 text-white" style={{ borderColor: 'rgba(255,255,255,0.12)' }}>
            <span className="text-indigo-400">🚗 {formatDuration(duration)}</span>
            <span className="text-slate-400">|</span>
            <span>{formatDistance(distance)}</span>
          </div>
        )}
      </div>

      <div className="p-3 flex gap-2" style={{ background: 'rgba(255,255,255,0.02)' }}>
        <button 
          onClick={openGoogleMaps}
          disabled={!userLocation}
          className="w-full py-2.5 px-3 rounded-lg text-xs font-bold flex items-center justify-center gap-2 border hover:bg-zinc-800 transition-colors disabled:opacity-40 cursor-pointer text-white"
          style={{ background: 'rgba(255,255,255,0.04)', borderColor: 'rgba(255,255,255,0.08)' }}
        >
          <Navigation size={13} className="text-blue-400" />
          Open in Google Maps
          <ExternalLink size={10} className="text-slate-500" />
        </button>
      </div>
    </div>
  );
}

// --- Dept Tag helper ---
function DeptTag({ department }) {
  if (!department) return <span className="text-slate-300 text-xs">—</span>;
  const lowerDept = department.toLowerCase();
  const auth = AUTHORITIES.find(a =>
    lowerDept.includes(a.abbr.toLowerCase()) ||
    lowerDept.includes(a.id.toLowerCase()) ||
    (a.name && lowerDept.includes(a.name.toLowerCase()))
  );
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold border ${
      auth?.color || 'bg-slate-100 border-slate-200 text-slate-600'
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
    case 'Pending':        return { bg: 'bg-amber-500/15 border border-amber-500/30',  text: 'text-amber-300',  border: 'border-amber-500/30',  dot: 'bg-amber-400'  };
    case 'In Review':      return { bg: 'bg-blue-500/15 border border-blue-500/30',  text: 'text-blue-300',  border: 'border-blue-500/30',  dot: 'bg-blue-400'  };
    case 'In Process':     return { bg: 'bg-indigo-500/15 border border-indigo-500/30',  text: 'text-indigo-300',  border: 'border-indigo-500/30',  dot: 'bg-indigo-400'  };
    case 'In Maintenance': return { bg: 'bg-purple-500/15 border border-purple-500/30',  text: 'text-purple-300',  border: 'border-purple-500/30',  dot: 'bg-purple-400'  };
    case 'Resolved':       return { bg: 'bg-emerald-500/15 border border-emerald-500/30', text: 'text-emerald-300 font-extrabold', border: 'border-emerald-500/30', dot: 'bg-emerald-400' };
    case 'Rejected':       return { bg: 'bg-red-500/15 border border-red-500/30 text-red-400 line-through', text: 'text-red-400 line-through', border: 'border-red-500/30', dot: 'bg-red-500' };
    default:               return { bg: 'bg-slate-800/60 border border-slate-700/40', text: 'text-slate-300',  border: 'border-slate-700/40',  dot: 'bg-slate-400'  };
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
        <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${active ? 'bg-white text-black shadow-md shadow-white/20' : 'text-slate-500'}`} style={!active ? { background: 'rgba(255,255,255,0.07)' } : {}}>
          {icon}
        </div>
        {!last && <div className={`w-0.5 flex-1 mt-1 ${active ? 'bg-white/30' : 'bg-white/8'}`} style={{ minHeight: 20 }} />}
      </div>
      <div className="pb-4">
        <p className={`text-sm font-semibold ${active ? 'text-slate-100' : 'text-slate-500'}`}>{label}</p>
        {time && <p className="text-xs mt-0.5" style={{ color: 'rgba(148,163,184,0.55)' }}>{time}</p>}
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
  
  // Authority -> Worker
  const [workerName, setWorkerName] = useState('');
  const [assignNote, setAssignNote] = useState('');
  
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
  
  // Before / After toggle state
  const [showAfter, setShowAfter] = useState(false);

  // Duplicate detection state
  const [duplicates, setDuplicates] = useState([]);

  useEffect(() => {
    if (report) {
      setManualStatus(report.status || 'Pending');
      setSelectedDept(suggestDepartment(report));
      setDispatchNote('');
      setWorkerName('');
      setAssignNote('');
      setWorkerProofNote('');
      setWorkerFile(null);
      setAuthorityNote('');
      setActionError(null);
      setActionSuccess(null);
      setShowAfter(report.status === 'Resolved' && !!report.completion_image_path);
      
      // Check for duplicates if Admin
      if (currentRole === 'admin' && report.status === 'Pending') {
        fetchReports('admin').then(all => {
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
      icon: report.status === 'Rejected' ? <X size={14} className="text-zinc-400" /> : <Send size={14} />, 
      time: fmtDate(report.reviewed_at || report.forwarded_at), 
      done: !!report.reviewed_at || report.status === 'Rejected' 
    },
    ...(report.status !== 'Rejected' ? [
      { 
        label: report.in_process_at 
          ? (isCitizen ? 'Task Assigned to Worker' : `Assigned to Worker: ${report.assigned_worker || 'Unknown'}`) 
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
    if (!workerName.trim()) return setActionError('Worker name is required.');
    return execAction(
      () => assignWorker(report.id, workerName, assignNote),
      'Worker assigned. Task is now In Process.',
      'In Process'
    );
  };

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
      <div className="fixed inset-y-0 right-0 w-full max-w-lg shadow-2xl z-50 flex flex-col" style={{ background: 'rgba(8,8,8,0.96)', backdropFilter: 'blur(32px)', borderLeft: '1px solid rgba(255,255,255,0.09)' }}>
        {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 shrink-0" style={{ borderBottom: '1px solid rgba(255,255,255,0.07)', background: 'rgba(255,255,255,0.03)' }}>
          <div className="flex items-center gap-3">
            <div>
              <h2 className="text-lg font-bold" style={{ color: '#f1f5f9' }}>Report #{report.id}</h2>
              <p className="text-xs mt-0.5" style={{ color: 'rgba(148,163,184,0.55)' }}>{fmtDate(report.timestamp) || 'Unknown Date'}</p>
            </div>
            <span className={`px-3 py-1 rounded-full text-xs font-bold border ${style.bg} ${style.text} ${style.border}`}>
              <span className={`inline-block w-1.5 h-1.5 rounded-full ${style.dot} mr-1.5`} />
              {report.status || 'Pending'}
            </span>
          </div>
          <button onClick={onClose} className="p-2 rounded-full transition-colors" style={{ color: 'rgba(148,163,184,0.6)' }}>
            <X size={20} />
          </button>
        </div>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto">
          {/* Main Image */}
          <div className="w-full h-52 relative shrink-0" style={{ background: 'rgba(255,255,255,0.05)' }}>
            {displayImage ? (
              <img 
                src={displayImage} 
                alt={showAfter ? 'After fix' : 'Original issue'}
                className="w-full h-full object-cover cursor-pointer hover:opacity-90 transition-opacity" 
                onClick={() => setFullScreenImage(displayImage)}
                onError={e => { e.target.style.display = 'none'; }} 
              />
            ) : (
              <div className="absolute inset-0 flex flex-col items-center justify-center text-slate-400">
                <ImageIcon size={40} className="opacity-40 mb-2" />
                <p className="text-sm font-medium">No Image Provided</p>
              </div>
            )}
            
            {/* Before / After toggle tabs */}
            {hasProof && (
              <div className="absolute bottom-3 right-3 flex rounded-lg overflow-hidden shadow-lg border border-white/10">
                <button
                  onClick={(e) => { e.stopPropagation(); setShowAfter(false); }}
                  className={`px-3 py-1.5 text-xs font-bold transition-colors ${
                    !showAfter ? 'bg-white text-black' : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'
                  }`}
                >
                  Before
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); setShowAfter(true); }}
                  className={`px-3 py-1.5 text-xs font-bold transition-colors ${
                    showAfter ? 'bg-white text-black' : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'
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
                <p className="text-xs font-semibold uppercase tracking-wider mb-1" style={{ color: 'rgba(148,163,184,0.65)' }}>Category</p>
              <p className="text-xl font-bold" style={{ color: '#f1f5f9' }}>{report.categories || 'Uncategorized'}</p>
              </div>
              {report.assigned_department && (
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider mb-1" style={{ color: 'rgba(148,163,184,0.65)' }}>Assigned To</p>
                  <DeptTag department={report.assigned_department} />
                </div>
              )}
            </div>

            {duplicates.length > 0 && (
              <div className="rounded-xl p-4 border" style={{ background: 'rgba(255,255,255,0.04)', borderColor: 'rgba(255,255,255,0.12)' }}>
                <div className="flex items-center gap-2 mb-2" style={{ color: '#e2e8f0' }}>
                  <AlertTriangle size={16} />
                  <p className="font-bold text-sm" style={{ color: '#e2e8f0' }}>Potential Duplicates Detected!</p>
                </div>
                <p className="text-xs mb-2" style={{ color: 'rgba(148,163,184,0.7)' }}>
                  There are {duplicates.length} other active report(s) of <strong>{report.categories}</strong> within 50 meters of this location.
                </p>
                <div className="flex flex-wrap gap-2">
                  {duplicates.map(d => (
                    <span key={d.id} className="text-[10px] font-bold px-2 py-1 rounded-md" style={{ background: 'rgba(255,255,255,0.06)', color: '#fca5a5', border: '1px solid rgba(239,68,68,0.25)' }}>
                      Report #{d.id} ({d.status})
                    </span>
                  ))}
                </div>
              </div>
            )}

            {report.ai_prediction && (
              <div className="rounded-xl p-4 border" style={{ background: 'rgba(255,255,255,0.04)', borderColor: 'rgba(255,255,255,0.08)' }}>
                <div className="min-w-0 flex-1">
                  <p className="text-[10px] font-bold uppercase tracking-wider mb-1" style={{ color: '#94a3b8' }}>Original Analysis</p>
                  <p className="text-sm font-semibold mb-1" style={{ color: '#e2e8f0' }}>{report.ai_prediction}</p>
                  <div className="flex items-center gap-2">
                    <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.08)' }}>
                      <div className="h-full bg-white/40 rounded-full" style={{ width: report.confidence || '0%' }} />
                    </div>
                    <span className="text-[10px] font-bold shrink-0" style={{ color: '#cbd5e1' }}>{report.confidence}</span>
                  </div>
                </div>
              </div>
            )}

            <div>
              <p className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'rgba(148,163,184,0.65)' }}>Description</p>
              <p className="text-sm leading-relaxed p-4 rounded-xl" style={{ color: 'rgba(203,213,225,0.85)', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.07)' }}>
                {report.description || 'No description provided.'}
              </p>
            </div>

            <div>
              <p className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'rgba(148,163,184,0.65)' }}>Location & Directions</p>
              <div className="rounded-xl overflow-hidden border" style={{ background: 'rgba(255,255,255,0.04)', borderColor: 'rgba(255,255,255,0.08)' }}>
                <div className="p-3 flex items-start gap-3" style={{ borderBottom: '1px solid rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.02)' }}>
                  <MapPin className="shrink-0 mt-0.5 text-indigo-400" size={16} />
                  <div>
                    <p className="text-sm font-semibold" style={{ color: '#e2e8f0' }}>{report.address || report.location || 'Not available'}</p>
                    {report.latitude && report.longitude && (
                      <p className="text-[10px] text-slate-400 mt-0.5">GPS: {report.latitude.toFixed(5)}, {report.longitude.toFixed(5)}</p>
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
              <p className="text-xs font-semibold uppercase tracking-wider mb-4" style={{ color: 'rgba(148,163,184,0.65)' }}>Lifecycle Timeline</p>
              <div className="pl-1">
                {steps.map((s, i) => (
                  <TimelineStep key={i} icon={s.icon} label={s.label} time={s.time} active={s.done} last={i === steps.length - 1} />
                ))}
              </div>
            </div>

            {/* Notes Thread */}
            {!isCitizen && report.authority_notes && (
              <div className="rounded-xl overflow-hidden" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)' }}>
                <div className="flex items-center gap-2 px-4 py-3" style={{ borderBottom: '1px solid rgba(255,255,255,0.07)', background: 'rgba(255,255,255,0.04)' }}>
                  <MessageSquare size={14} className="text-slate-500" />
                  <p className="text-xs font-bold uppercase tracking-wider" style={{ color: 'rgba(148,163,184,0.75)' }}>Communication Thread</p>
                </div>
                <div className="p-4 space-y-2">
                  {report.authority_notes.split('\n').map((line, i) => {
                    const isAuth = line.startsWith('[Authority]');
                    const isAdmin = line.startsWith('[Admin]');
                    const isRes = line.startsWith('[Resolved]');
                    return (
                      <div key={i} className={`flex items-start gap-2 p-3 rounded-lg text-sm`} style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.07)' }}>
                        <MessageSquare size={14} className="shrink-0 mt-0.5 text-slate-400" />
                        <p className="text-sm" style={{ color: 'rgba(203,213,225,0.85)' }}>{line}</p>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Worker Proof Display (Visible to all if it exists) */}
            {!isCitizen && report.worker_completed && (
              <div className="rounded-xl overflow-hidden" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}>
                <div className="px-4 py-3 flex items-center justify-between" style={{ borderBottom: '1px solid rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.05)' }}>
                  <div className="flex items-center gap-2">
                    <Camera size={14} className="text-zinc-400" />
                    <p className="text-xs font-bold uppercase tracking-wider" style={{ color: '#cbd5e1' }}>Worker Completion Proof</p>
                    <span className="ml-2 px-1.5 py-0.5 text-[9px] font-bold rounded bg-zinc-800 text-zinc-300 border border-zinc-700">
                      {report.status === 'Resolved' ? 'Final (Locked)' : 'Awaiting Admin Verification'}
                    </span>
                  </div>
                </div>
                <div className="p-4">
                  {report.completion_image_path && (
                    <img 
                      src={getImageUrl(report.completion_image_path)} 
                      alt="Proof" 
                      className="w-full h-40 object-cover rounded-lg mb-3 border border-white/10 cursor-pointer hover:opacity-90 transition-opacity" 
                      onClick={() => setFullScreenImage(getImageUrl(report.completion_image_path))}
                    />
                  )}

                  <p className="text-sm p-3 rounded-lg" style={{ color: 'rgba(203,213,225,0.85)', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.07)' }}>{report.completion_notes}</p>
                  <p className="text-xs mt-2 text-right" style={{ color: 'rgba(148,163,184,0.55)' }}>Submitted: {fmtDate(report.completion_submitted_at)}</p>
                </div>
              </div>
            )}

            {/* =========================================
                ROLE-BASED ACTION PANELS 
                ========================================= */}

            {/* 1. ADMIN PANEL (Pending) */}
            {currentRole === 'admin' && report.status === 'Pending' && (
              <div className="rounded-2xl overflow-hidden" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}>
                <div className="flex items-center gap-2 px-5 py-4 bg-zinc-800">
                  <Send size={18} className="text-white" />
                  <p className="text-sm font-bold text-white">Approve & Forward to Authority</p>
                </div>
                <div className="p-5 space-y-4">
                  <div>
                    <label className="block text-xs font-semibold mb-2" style={{ color: '#ffffff' }}>Select Authority</label>
                    <select value={selectedDept} onChange={e => setSelectedDept(e.target.value)} className="w-full px-3 py-2 rounded-xl text-sm" style={{ background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.12)', color: '#f1f5f9' }}>
                      {AUTHORITIES.filter(a => ['mbmb', 'jkr', 'swcorp'].includes(a.id)).map(a => <option key={a.id} value={a.id}>[{a.abbr}] {a.name}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold mb-2" style={{ color: '#ffffff' }}>Admin Note</label>
                    <textarea value={dispatchNote} onChange={e => setDispatchNote(e.target.value)} rows={2} className="w-full px-3 py-2 rounded-xl text-sm resize-none" style={{ background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.12)', color: '#f1f5f9' }} />
                  </div>
                  <div className="flex gap-3">
                    <button onClick={handleAdminApprove} disabled={actionLoading} className="flex-2 py-3 bg-white text-black font-bold text-sm rounded-xl hover:bg-zinc-200 disabled:opacity-50 transition-colors border border-white cursor-pointer">
                      {actionLoading ? 'Approving...' : 'Approve & Send'}
                    </button>
                    <button onClick={handleAdminReject} disabled={actionLoading} className="flex-1 py-3 bg-zinc-800 border border-zinc-700 text-zinc-300 hover:bg-zinc-700 font-bold text-sm rounded-xl disabled:opacity-50 transition-colors cursor-pointer">
                      Reject
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* 2. AUTHORITY PANEL (In Review) - Assign Worker */}
            {currentRole?.startsWith('authority') && report.status === 'In Review' && (
              <div className="rounded-2xl overflow-hidden" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}>
                <div className="flex items-center gap-2 px-5 py-4 bg-zinc-800">
                  <HardHat size={18} className="text-white" />
                  <p className="text-sm font-bold text-white">Assign Task to Worker</p>
                </div>
                <div className="p-5 space-y-4">
                  <div>
                    <label className="block text-xs font-semibold mb-2" style={{ color: '#ffffff' }}>Worker / Contractor Name</label>
                    <input type="text" value={workerName} onChange={e => setWorkerName(e.target.value)} placeholder="e.g. Ali (Team Alpha)" className="w-full px-3 py-2 rounded-xl text-sm" style={{ background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.12)', color: '#f1f5f9' }} />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold mb-2" style={{ color: '#ffffff' }}>Assignment Notes</label>
                    <textarea value={assignNote} onChange={e => setAssignNote(e.target.value)} rows={2} className="w-full px-3 py-2 rounded-xl text-sm resize-none" style={{ background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.12)', color: '#f1f5f9' }} />
                  </div>
                  <button onClick={handleAuthorityAssign} disabled={actionLoading || !workerName} className="w-full py-3 bg-white text-black font-bold text-sm rounded-xl hover:bg-zinc-200 disabled:opacity-50 border border-white cursor-pointer">
                    {actionLoading ? 'Assigning...' : 'Assign Task'}
                  </button>
                </div>
              </div>
            )}

            {/* 3. WORKER PANEL (In Process) - Start Work */}
            {currentRole?.startsWith('worker') && report.status === 'In Process' && (
              <div className="rounded-2xl p-5 text-center" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}>
                <h3 className="font-bold text-zinc-100 mb-2">You've been assigned this task</h3>
                <p className="text-sm text-zinc-400 mb-4">Click below when you have arrived at the location and are starting the maintenance work.</p>
                <button onClick={handleWorkerStart} disabled={actionLoading} className="w-full py-3 bg-white text-black font-bold text-sm rounded-xl hover:bg-zinc-200 border border-white disabled:opacity-50 cursor-pointer">
                  {actionLoading ? 'Updating...' : 'Accept & Start Work'}
                </button>
              </div>
            )}

            {/* 4. WORKER PANEL (In Maintenance) - Submit Proof */}
            {currentRole?.startsWith('worker') && report.status === 'In Maintenance' && !report.worker_completed && (
              <div className="rounded-2xl overflow-hidden" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
                <div className="flex items-center gap-2 px-5 py-4 bg-zinc-800">
                  <Camera size={18} className="text-white" />
                  <p className="text-sm font-bold text-white">Submit Completion Proof</p>
                </div>
                <div className="p-5 space-y-4">
                  <div>
                    <label className="block text-xs font-semibold text-zinc-400 mb-2">Upload Photo Proof</label>
                    <input type="file" accept="image/*" onChange={e => setWorkerFile(e.target.files[0])} className="w-full text-sm text-slate-500 file:mr-4 file:py-2 file:px-4 file:rounded-xl file:border-0 file:text-sm file:font-semibold file:bg-zinc-800 file:text-zinc-300 hover:file:bg-zinc-700" />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold mb-2" style={{ color: '#94a3b8' }}>Completion Notes</label>
                    <textarea value={workerProofNote} onChange={e => setWorkerProofNote(e.target.value)} placeholder="Describe what was fixed..." rows={3} className="w-full px-3 py-2 rounded-xl text-sm resize-none" style={{ background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.12)', color: '#f1f5f9' }} />
                  </div>
                  <button onClick={handleWorkerComplete} disabled={actionLoading || !workerProofNote} className="w-full py-3 bg-zinc-700 text-white font-bold text-sm rounded-xl hover:bg-zinc-600 disabled:opacity-50">
                    {actionLoading ? 'Submitting...' : 'Submit Proof'}
                  </button>
                </div>
              </div>
            )}

            {/* 5. ADMIN PANEL (In Maintenance + worker completed) - Confirm Resolve or Reject */}
            {currentRole === 'admin' && report.status === 'In Maintenance' && report.worker_completed && (
              <div className="rounded-2xl overflow-hidden" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}>
                <div className="flex items-center gap-2 px-5 py-4 bg-zinc-800">
                  <ShieldCheck size={18} className="text-white" />
                  <p className="text-sm font-bold text-white">Admin Verification & Resolution</p>
                </div>
                <div className="p-5 space-y-4">
                  <div className="p-3 text-xs rounded-lg flex flex-col gap-1" style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: '#ffffff' }}>
                    <p className="font-bold flex items-center gap-1">Action Required</p>
                    <p>Review the completion proof notes and image above. You can either approve the resolution or reject the proof if it is blurry or ambiguous.</p>
                  </div>
                  <p className="text-sm mb-3" style={{ color: '#cbd5e1' }}>Please review the notes and photo above to verify the fix or reject it.</p>
                  <div>
                    <label className="block text-xs font-semibold mb-2" style={{ color: '#ffffff' }}>Verification Notes / Rejection Reason</label>
                    <textarea value={authorityNote} onChange={e => setAuthorityNote(e.target.value)} placeholder="Looks good... / Please retake, image is blurry." rows={2} className="w-full px-3 py-2 rounded-xl text-sm resize-none" style={{ background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.12)', color: '#f1f5f9' }} />
                  </div>
                  <div className="flex gap-3">
                    <button onClick={handleAuthorityResolve} disabled={actionLoading} className="flex-2 py-3 bg-white text-black font-bold text-sm rounded-xl hover:bg-zinc-200 disabled:opacity-50 transition-colors border border-white cursor-pointer">
                      {actionLoading ? 'Verifying...' : 'Confirm Resolved'}
                    </button>
                    <button onClick={handleRejectProof} disabled={actionLoading} className="flex-1 py-3 bg-zinc-800 border border-zinc-700 text-zinc-300 hover:bg-zinc-700 font-bold text-sm rounded-xl disabled:opacity-50 transition-colors cursor-pointer">
                      Reject Proof
                    </button>
                  </div>
                </div>
              </div>
            )}

          </div>
        </div>

        {/* Footer — Manual Override */}
        <div className="px-6 py-4 shrink-0" style={{ borderTop: '1px solid rgba(255,255,255,0.07)', background: 'rgba(255,255,255,0.03)' }}>
          {actionError && (
            <div className="mb-3 p-3 text-xs rounded-lg flex items-center gap-2" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', color: '#cbd5e1' }}>
              {actionError}
            </div>
          )}
          {actionSuccess && (
            <div className="mb-3 p-3 text-xs rounded-lg flex items-center gap-2" style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.15)', color: '#ffffff' }}>
              {actionSuccess}
            </div>
          )}
          {currentRole === 'admin' && (
            <div className="flex items-center gap-2">
              <RotateCcw size={13} className="text-slate-400 shrink-0" />
              <p className="text-xs text-slate-400 font-medium mr-auto">Manual override</p>
              <div className="relative">
                <select value={manualStatus} onChange={e => setManualStatus(e.target.value)} className="appearance-none text-xs rounded-lg px-3 py-2 pr-7 font-medium" style={{ background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.10)', color: '#e2e8f0' }}>
                  <option value="Pending">Pending</option>
                  <option value="In Review">In Review</option>
                  <option value="In Process">In Process</option>
                  <option value="In Maintenance">In Maintenance</option>
                  <option value="Resolved">Resolved</option>
                  <option value="Rejected">Rejected</option>
                </select>
                <ChevronDown size={12} className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-slate-400" />
              </div>
              <button onClick={handleManualUpdate} disabled={actionLoading || manualStatus === report.status} className="flex items-center gap-1.5 px-4 py-2 bg-white text-black text-xs font-bold rounded-lg hover:bg-zinc-200 disabled:opacity-40 shadow-sm border border-white cursor-pointer">
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
