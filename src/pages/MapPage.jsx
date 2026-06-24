import { useEffect, useState, useMemo } from 'react';
import { fetchReports, getImageUrl, updateReportStatus } from '../api/reportsApi';
import { useAuth } from '../context/AuthContext';
import L from 'leaflet';
import 'leaflet.heat';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import MarkerClusterGroup from 'react-leaflet-cluster';
import { format } from 'date-fns';
import { MapPin, Image as ImageIcon, Filter, ChevronLeft, ChevronRight, Layers, CheckCircle2, Sparkles } from 'lucide-react';

function HeatmapLayer({ points }) {
  const map = useMap();
  useEffect(() => {
    if (!points || points.length === 0) return;
    const heatPoints = points.map(p => [p.latitude, p.longitude, 1]); // Lat, Lng, Intensity
    const heat = L.heatLayer(heatPoints, { 
      radius: 25, 
      blur: 15, 
      maxZoom: 14,
      gradient: {0.4: 'blue', 0.6: 'cyan', 0.7: 'lime', 0.8: 'yellow', 1.0: 'red'}
    }).addTo(map);
    return () => { map.removeLayer(heat); };
  }, [map, points]);
  return null;
}

// Fixes the blank grey tiles bug in Leaflet+React: forces size recalculation after mount
function MapResizer() {
  const map = useMap();
  useEffect(() => {
    setTimeout(() => map.invalidateSize(), 100);
  }, [map]);
  return null;
}

function getDeptId(role, username) {
  if (!role) return null;
  if (role.includes('_')) {
    return role.split('_').slice(1).join('_');
  }
  if (role === 'authority' && username) {
    return username.toLowerCase();
  }
  if (role === 'worker' && username) {
    const name = username.toLowerCase();
    if (name.includes('mbmb') || name === 'worker1' || name === 'worker') return 'mbmb';
    if (name.includes('jkr') || name === 'worker2') return 'jkr';
    if (name.includes('swcorp')) return 'swcorp';
    if (name.includes('mphtj')) return 'mphtj';
  }
  return null;
}

const CATEGORIES = ["All", "Road", "Lighting", "Waste", "Drainage", "Noise"];
const STATUSES = ["All", "Pending", "In Review", "In Process", "In Maintenance", "Resolved", "Rejected"];

const getPriority = (status, categories) => {
  if (status === 'Resolved') return 'Resolved';
  const cat = categories || '';
  if (cat.includes('Damage') || cat.includes('Drainage') || cat.includes('Tree')) {
    return 'High';
  }
  return 'Medium';
};

const getPriorityColor = (priority) => {
  switch (priority) {
    case 'High':     return '#ef4444'; // Red
    case 'Medium':   return '#f97316'; // Orange
    case 'Resolved': return '#10b981'; // Green
    default:         return '#f97316';
  }
};

// Custom Marker Pin Creator
const createCustomMarkerIcon = (priority, color, count) => {
  const pinSize = count > 1 ? 42 : 36;
  const pinColor = color;
  
  // Custom SVG Map Pin pointing to the location.
  // Center-bottom tip is at (12, 23).
  const innerContent = count > 1 
    ? `
      <circle cx="12" cy="10" r="6" fill="#ffffff"></circle>
      <text x="12" y="13" fill="${pinColor}" font-size="9" font-weight="900" text-anchor="middle">${count}</text>
    `
    : `
      <circle cx="12" cy="10" r="3" fill="#ffffff"></circle>
    `;
    
  return L.divIcon({
    html: `
      <div style="
        display: flex;
        align-items: center;
        justify-content: center;
        width: ${pinSize}px;
        height: ${pinSize}px;
        filter: drop-shadow(0px 3px 5px rgba(0, 0, 0, 0.4));
        cursor: pointer;
        transition: transform 0.15s ease-in-out;
      " class="hover:scale-110">
        <svg width="${pinSize}" height="${pinSize}" viewBox="0 0 24 24" fill="${pinColor}" stroke="#ffffff" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path>
          ${innerContent}
        </svg>
      </div>
    `,
    className: 'custom-div-icon',
    iconSize: [pinSize, pinSize],
    iconAnchor: [pinSize / 2, pinSize],
    popupAnchor: [0, -pinSize]
  });
};

// Custom Cluster Icon Creator
const createClusterCustomIcon = (cluster) => {
  const count = cluster.getChildCount();
  const markers = cluster.getAllChildMarkers();
  
  let hasHigh = false;
  let hasMed = false;
  let allResolved = true;
  
  markers.forEach(m => {
    const priority = m.options.priority;
    if (priority === 'High') hasHigh = true;
    if (priority === 'Medium') hasMed = true;
    if (priority !== 'Resolved') allResolved = false;
  });
  
  const priority = hasHigh ? 'High' : hasMed ? 'Medium' : allResolved ? 'Resolved' : 'Medium';
  const color = getPriorityColor(priority);
  
  return L.divIcon({
    html: `
      <div style="
        display: flex;
        align-items: center;
        justify-content: center;
        width: 44px;
        height: 44px;
        background-color: ${color}26;
        border: 2px solid ${color};
        border-radius: 50%;
        color: #ffffff;
        font-weight: 800;
        font-size: 14px;
        box-shadow: 0 4px 10px rgba(0, 0, 0, 0.4), inset 0 0 8px ${color};
        position: relative;
        transition: all 0.2s ease-in-out;
      " class="hover:scale-105">
        <div style="
          position: absolute;
          inset: 4px;
          background-color: ${color};
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
        ">
          ${count}
        </div>
      </div>
    `,
    className: 'custom-cluster-icon-div',
    iconSize: [44, 44],
    iconAnchor: [22, 22]
  });
};

function PopupContent({ reports, setFullScreenImage }) {
  const [index, setIndex] = useState(0);
  const [showAfter, setShowAfter] = useState(true); // true = show completion/after, false = show original/before
  const report = reports[index];
  const priority = getPriority(report.status, report.categories);
  const reportColor = getPriorityColor(priority);

  const isResolved = report.status === 'Resolved';
  const hasProof   = !!report.completion_image_path;

  // Which image URL to display
  const displayImage = (isResolved && hasProof && showAfter)
    ? getImageUrl(report.completion_image_path)
    : (report.image_path ? getImageUrl(report.image_path) : null);

  return (
    <div className="w-64">
      {/* Multi-report navigator */}
      {reports.length > 1 && (
        <div className="flex items-center justify-between bg-slate-800 text-white px-3 py-2 text-xs font-bold rounded-t-lg">
          <button
            disabled={index === 0}
            onClick={(e) => { e.stopPropagation(); setIndex(i => i - 1); setShowAfter(true); }}
            className="p-1 disabled:opacity-30 hover:bg-slate-700 rounded transition-colors"
          >
            <ChevronLeft size={16} />
          </button>
          <span>Issue {index + 1} of {reports.length}</span>
          <button
            disabled={index === reports.length - 1}
            onClick={(e) => { e.stopPropagation(); setIndex(i => i + 1); setShowAfter(true); }}
            className="p-1 disabled:opacity-30 hover:bg-slate-700 rounded transition-colors"
          >
            <ChevronRight size={16} />
          </button>
        </div>
      )}

      {/* Image — Before / After toggle when resolved with proof */}
      <div className={`relative w-full h-32 bg-slate-100 ${reports.length === 1 ? 'rounded-t-lg' : ''} overflow-hidden`}>
        {displayImage ? (
          <img
            src={displayImage}
            alt={showAfter ? 'After fix' : 'Original issue'}
            className="w-full h-full object-cover cursor-pointer hover:opacity-90 transition-opacity"
            onClick={() => setFullScreenImage(displayImage)}
            onError={(e) => { e.target.style.display = 'none'; }}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <ImageIcon className="text-slate-400" size={32} />
          </div>
        )}

        {/* Resolved "AI Verified" banner */}
        {isResolved && (
          <div className="absolute top-2 left-2 flex items-center gap-1 bg-white text-black text-[10px] font-bold px-2 py-1 rounded-full shadow-md">
            <CheckCircle2 size={10} />
            RESOLVED
          </div>
        )}

        {/* Before / After toggle tabs — only shown when resolved + has proof */}
        {isResolved && hasProof && (
          <div className="absolute bottom-2 right-2 flex rounded-lg overflow-hidden shadow-md border border-white/10">
            <button
              onClick={(e) => { e.stopPropagation(); setShowAfter(false); }}
              className={`px-2 py-0.5 text-[10px] font-bold transition-colors ${
                !showAfter ? 'bg-white text-black' : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'
              }`}
            >
              Before
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); setShowAfter(true); }}
              className={`px-2 py-0.5 text-[10px] font-bold transition-colors ${
                showAfter ? 'bg-white text-black' : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'
              }`}
            >
              After
            </button>
          </div>
        )}
      </div>

      {/* Info card */}
      <div className="p-3">
        <div className="flex justify-between items-start mb-2">
          <h3 className="font-bold text-slate-800 text-sm line-clamp-1">{report.categories || 'Unknown Issue'}</h3>
          <span
            className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full"
            style={{ backgroundColor: `${reportColor}20`, color: reportColor }}
          >
            {priority}
          </span>
        </div>

        {/* AI result row */}
        {!showAfter && report.ai_prediction && (
          <div className="flex items-center gap-1.5 text-xs text-slate-600 mb-2">
            <span className="font-semibold text-slate-350">
              {report.ai_prediction}
            </span>
            <span className="text-slate-500">
              ({report.confidence})
            </span>
          </div>
        )}

        <div className="flex items-start gap-1 text-xs text-slate-500 mb-3">
          <MapPin size={14} className="mt-0.5 shrink-0" />
          <span className="line-clamp-2">{report.address || 'No address'}</span>
        </div>

        <div className="flex justify-between items-center text-xs">
          <span className="text-slate-400">
            {(() => {
              const dateField = isResolved ? report.resolved_at : report.timestamp;
              if (!dateField) return 'Unknown time';
              const d = new Date(dateField);
              if (isNaN(d.getTime())) return String(dateField);
              return format(d, 'MMM d, h:mm a');
            })()}
          </span>
          <span
            className="font-bold px-2 py-1 rounded text-xs"
            style={{ backgroundColor: `${reportColor}20`, color: reportColor }}
          >
            {report.status || 'Pending'}
          </span>
        </div>
      </div>
    </div>
  );
}

export function MapPage() {
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedCategory, setSelectedCategory] = useState("All");
  const [selectedStatus, setSelectedStatus] = useState("All");
  const { role: currentRole, user } = useAuth();
  const [fullScreenImage, setFullScreenImage] = useState(null);
  const [showHeatmap, setShowHeatmap] = useState(false);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [secondsAgo, setSecondsAgo] = useState(0);

  const loadReports = async () => {
    try {
      setLoading(true);
      const data = await fetchReports(currentRole);
      
      // Filter out resolved reports that are older than 7 days
      const activeMapReports = data.filter(r => {
        if (!r.latitude || !r.longitude) return false;
        if (r.status === 'Resolved') {
          const dateField = r.resolved_at || r.timestamp;
          if (dateField) {
            const resolvedDate = new Date(dateField);
            const now = new Date();
            const diffTime = now - resolvedDate;
            const diffDays = diffTime / (1000 * 60 * 60 * 24);
            if (!isNaN(diffDays) && diffDays > 7) {
              return false; // hide older resolved pins
            }
          }
        }
        return true;
      });

      setReports(activeMapReports);
      setLastUpdated(new Date());
      setSecondsAgo(0);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadReports();
    // Auto-refresh every 30 seconds so AI results & status changes appear on the map
    const refreshInterval = setInterval(loadReports, 30000);
    return () => clearInterval(refreshInterval);
  }, []);

  // Tick counter for "X seconds ago" label
  useEffect(() => {
    const tick = setInterval(() => {
      setSecondsAgo(prev => prev + 5);
    }, 5000);
    return () => clearInterval(tick);
  }, []);

  const filteredReports = useMemo(() => {
    let result = reports;
    if (selectedCategory !== "All") {
      result = result.filter(r => 
        (r.categories || '').toLowerCase().includes(selectedCategory.toLowerCase())
      );
    }
    if (selectedStatus !== "All") {
      result = result.filter(r => (r.status || 'Pending') === selectedStatus);
    }

    if (currentRole?.startsWith('authority')) {
      const deptId = getDeptId(currentRole, user?.username);
      result = result.filter(r => {
        if (r.status === 'Pending') return false;
        if (!deptId) return true;
        const assigned = (r.assigned_department || '').toLowerCase();
        if (deptId === 'mbmb' && (assigned.includes('mbmb') || assigned.includes('bersejarah'))) return true;
        if (deptId === 'samb' && (assigned.includes('samb') || assigned.includes('air'))) return true;
        const deptAbbr = deptId.toLowerCase();
        if (assigned.includes(deptAbbr)) return true;
        if (deptId === 'jkr' && (assigned.includes('jkr') || assigned.includes('kerja raya'))) return true;
        if (deptId === 'jps' && (assigned.includes('jps') || assigned.includes('pengairan'))) return true;
        if (deptId === 'mphtj' && assigned.includes('tuah jaya')) return true;
        if (deptId === 'mpag' && assigned.includes('alor gajah')) return true;
        if (deptId === 'mpj' && assigned.includes('jasin')) return true;
        if (deptId === 'jas' && assigned.includes('alam sekitar')) return true;
        return false;
      });
    } else if (currentRole?.startsWith('worker')) {
      const deptId = getDeptId(currentRole, user?.username);
      result = result.filter(r => {
        if (!r.status || r.status === 'Pending' || r.status === 'In Review') return false;
        if (!deptId) return true; 
        const assigned = (r.assigned_department || '').toLowerCase();
        if (deptId === 'mbmb' && (assigned.includes('mbmb') || assigned.includes('bersejarah'))) return true;
        if (deptId === 'samb' && (assigned.includes('samb') || assigned.includes('air'))) return true;
        const deptAbbr = deptId.toLowerCase();
        if (assigned.includes(deptAbbr)) return true;
        if (deptId === 'jkr' && (assigned.includes('jkr') || assigned.includes('kerja raya'))) return true;
        if (deptId === 'jps' && (assigned.includes('jps') || assigned.includes('pengairan'))) return true;
        if (deptId === 'mphtj' && assigned.includes('tuah jaya')) return true;
        if (deptId === 'mpag' && assigned.includes('alor gajah')) return true;
        if (deptId === 'mpj' && assigned.includes('jasin')) return true;
        if (deptId === 'jas' && assigned.includes('alam sekitar')) return true;
        return false;
      });
    }

    return result;
  }, [reports, selectedCategory, selectedStatus, currentRole]);

  const groupedReports = useMemo(() => {
    const groups = {};
    filteredReports.forEach(r => {
      const key = `${r.latitude},${r.longitude}`;
      if (!groups[key]) groups[key] = [];
      groups[key].push(r);
    });
    return Object.values(groups);
  }, [filteredReports]);

  return (
    <div className="flex flex-col p-6" style={{ minHeight: 'calc(100vh - 64px)' }}>
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="page-header-title">Live Issues Map</h1>
          <p className="page-header-sub">Geospatial overview of reported city events.</p>
        </div>
        {/* Live indicator */}
        <div className="flex flex-col items-end gap-1">
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-full" style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.15)' }}>
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-white" />
            </span>
            <span className="text-xs font-bold" style={{ color: '#ffffff' }}>Live</span>
          </div>
          {lastUpdated && (
            <span className="text-[10px]" style={{ color: 'rgba(148,163,184,0.5)' }}>
              {secondsAgo < 10 ? 'Just now' : `${secondsAgo}s ago`} &middot; auto-refreshes every 30s
            </span>
          )}
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-4 mb-4">
        <div className="flex overflow-x-auto pb-2 gap-2 no-scrollbar flex-1">
          {CATEGORIES.map(cat => (
            <button
              key={cat}
              onClick={() => setSelectedCategory(cat)}
              className={`px-5 py-2 rounded-full text-sm font-semibold transition-all whitespace-nowrap border
                ${selectedCategory === cat 
                  ? 'bg-white text-black border-white shadow-md shadow-white/10' 
                  : 'bg-white/6 text-slate-300 border-white/10 hover:border-white/20 hover:bg-white/10'
                }
              `}
            >
              {cat}
            </button>
          ))}
        </div>
        
        <div className="flex items-center gap-2 shrink-0 pb-2">
           <button 
             onClick={() => setShowHeatmap(!showHeatmap)}
             className={`flex items-center gap-2 px-4 py-2 rounded-full text-sm font-bold transition-all border ${
               showHeatmap ? 'bg-white text-black border-white shadow-md shadow-white/10' : 'bg-white/6 text-slate-355 border-white/10 hover:bg-white/10'
             }`}
           >
             <Layers size={16} />
             {showHeatmap ? 'Heatmap On' : 'Heatmap Off'}
           </button>

           {/* Resolved Only quick-filter */}
           <button
             onClick={() => setSelectedStatus(s => s === 'Resolved' ? 'All' : 'Resolved')}
             className={`flex items-center gap-2 px-4 py-2 rounded-full text-sm font-bold transition-all border ${
               selectedStatus === 'Resolved'
                 ? 'bg-white text-black border-white shadow-md shadow-white/10'
                 : 'bg-white/6 text-slate-355 border-white/10 hover:bg-white/10'
             }`}
           >
             <CheckCircle2 size={16} />
             {selectedStatus === 'Resolved' ? 'Resolved Only' : 'Resolved Only'}
           </button>

           <select 
             value={selectedStatus}
             onChange={(e) => setSelectedStatus(e.target.value)}
             className="px-4 py-2 rounded-full text-sm font-semibold outline-none focus:border-white/40 cursor-pointer" style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.10)', color: '#e2e8f0' }}
           >
             {STATUSES.map(s => (
               <option key={s} value={s}>{s}</option>
             ))}
           </select>
        </div>
      </div>

      {/* Map Container */}
      <div 
        className="rounded-2xl overflow-hidden relative" style={{ border: '1px solid rgba(255,255,255,0.09)', height: 'calc(100vh - 220px)', minHeight: '500px' }}
      >
        {loading && (
          <div className="absolute inset-0 z-20 flex flex-col items-center justify-center" style={{ background: 'rgba(10,10,10,0.75)', backdropFilter: 'blur(8px)' }}>
            <div className="w-10 h-10 border-4 border-white border-t-transparent rounded-full animate-spin mb-4"></div>
            <p style={{ color: '#e2e8f0' }} className="font-medium">Loading map data...</p>
          </div>
        )}
        
        <MapContainer 
          center={[2.1896, 102.2501]}
          zoom={13} 
          style={{ height: '100%', width: '100%' }}
          whenReady={(map) => {
            setTimeout(() => map.target.invalidateSize(), 200);
          }}
        >
          <MapResizer />
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          
          {showHeatmap ? (
            <HeatmapLayer points={filteredReports} />
          ) : (
            <MarkerClusterGroup 
              chunkedLoading 
              maxClusterRadius={50}
              iconCreateFunction={createClusterCustomIcon}
            >
              {groupedReports.map(group => {
                const hasHigh = group.some(r => getPriority(r.status, r.categories) === 'High');
                const hasMed  = group.some(r => getPriority(r.status, r.categories) === 'Medium');
                const allResolved = group.every(r => r.status === 'Resolved');
                const priority = hasHigh ? 'High' : hasMed ? 'Medium' : allResolved ? 'Resolved' : 'Medium';
                const color = getPriorityColor(priority);
                
                return (
                  <Marker
                    key={group[0].id}
                    position={[group[0].latitude, group[0].longitude]}
                    icon={createCustomMarkerIcon(priority, color, group.length)}
                    priority={priority}
                  >
                    <Popup className="custom-popup">
                      <PopupContent reports={group} setFullScreenImage={setFullScreenImage} />
                    </Popup>
                  </Marker>
                );
              })}
            </MarkerClusterGroup>
          )}
        </MapContainer>

        {/* Legend */}
        <div className="absolute bottom-6 left-6 z-[400] p-4 rounded-xl pointer-events-auto" style={{ background: 'rgba(10,10,10,0.88)', backdropFilter: 'blur(20px)', border: '1px solid rgba(255,255,255,0.10)', boxShadow: '0 8px 32px rgba(0,0,0,0.5)' }}>
            <h4 className="text-xs font-bold uppercase tracking-wider mb-3" style={{ color: 'rgba(148,163,184,0.65)' }}>Map Legend</h4>
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-red-500 ring-2 ring-white shadow-sm"></div>
              <span className="text-sm font-medium" style={{ color: '#e2e8f0' }}>High Priority</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-orange-500 ring-2 ring-white shadow-sm"></div>
              <span className="text-sm font-medium" style={{ color: '#e2e8f0' }}>Medium Priority</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-green-500 ring-2 ring-white shadow-sm"></div>
              <span className="text-sm font-medium" style={{ color: '#e2e8f0' }}>Resolved</span>
            </div>
          </div>
            <div className="mt-3 pt-3 text-xs" style={{ borderTop: '1px solid rgba(255,255,255,0.08)', color: 'rgba(148,163,184,0.55)' }}>
            {filteredReports.length} {filteredReports.length === 1 ? 'issue' : 'issues'} shown
          </div>
        </div>
      </div>
      
      <style>{`
        .custom-popup .leaflet-popup-content-wrapper { padding: 0; overflow: hidden; border-radius: 12px; }
        .custom-popup .leaflet-popup-content { margin: 0; width: 256px !important; }
      `}</style>

      {/* Full Screen Image Viewer */}
      {fullScreenImage && (
        <div 
          className="fixed inset-0 bg-black/90 z-[9999] flex items-center justify-center p-4 cursor-pointer"
          onClick={() => setFullScreenImage(null)}
        >
          <button 
            className="absolute top-6 right-6 text-white/70 hover:text-white bg-black/50 p-2 rounded-full backdrop-blur-sm transition-colors"
            onClick={(e) => { e.stopPropagation(); setFullScreenImage(null); }}
          >
            <span className="text-xl font-bold px-2">×</span>
          </button>
          <img 
            src={fullScreenImage} 
            alt="Full Screen" 
            className="max-w-full max-h-full object-contain rounded-lg shadow-2xl cursor-default"
            onClick={(e) => e.stopPropagation()} 
          />
        </div>
      )}
    </div>
  );
}
