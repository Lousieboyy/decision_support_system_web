import { useEffect, useState, useMemo } from 'react';
import { fetchReports, getImageUrl, updateReportStatus } from '../api/reportsApi';
import { useAuth } from '../context/AuthContext';
import { MapContainer, TileLayer, CircleMarker, Popup, useMap } from 'react-leaflet';
import { format } from 'date-fns';
import { MapPin, Image as ImageIcon } from 'lucide-react';

// Fixes the blank grey tiles bug in Leaflet+React: forces size recalculation after mount
function MapResizer() {
  const map = useMap();
  useEffect(() => {
    setTimeout(() => map.invalidateSize(), 100);
  }, [map]);
  return null;
}

const CATEGORIES = ["All", "Road", "Lighting", "Waste", "Drainage", "Noise"];

const getPriority = (status, categories) => {
  if (status === 'Resolved') return 'Low';
  const cat = categories || '';
  if (cat.includes('Damage') || cat.includes('Drainage') || cat.includes('Tree')) {
    return 'High';
  }
  return 'Medium';
};

const getPriorityColor = (priority) => {
  switch (priority) {
    case 'High': return '#ef4444'; // Red
    case 'Medium': return '#f59e0b'; // Orange
    case 'Low': return '#22c55e'; // Green
    default: return '#f59e0b';
  }
};

export function MapPage() {
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedCategory, setSelectedCategory] = useState("All");
  const { role: currentRole } = useAuth();
  const [fullScreenImage, setFullScreenImage] = useState(null);

  const loadReports = async () => {
    try {
      setLoading(true);
      const data = await fetchReports(currentRole);
      setReports(data.filter(r => r.latitude && r.longitude));
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadReports();
  }, []);

  const filteredReports = useMemo(() => {
    let result = reports;
    if (selectedCategory !== "All") {
      result = result.filter(r => 
        (r.categories || '').toLowerCase().includes(selectedCategory.toLowerCase())
      );
    }

    if (currentRole?.startsWith('authority')) {
      const deptId = currentRole.split('_')[1];
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
      const deptId = currentRole.split('_')[1];
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
  }, [reports, selectedCategory, currentRole]);

  return (
    <div className="flex flex-col p-6" style={{ minHeight: 'calc(100vh - 64px)' }}>
      <div className="mb-6">
        <h1 className="text-3xl font-bold tracking-tight text-slate-900 mb-1">Live Issues Map</h1>
        <p className="text-slate-500">Geospatial overview of reported city events.</p>
      </div>

      {/* Filters */}
      <div className="flex overflow-x-auto pb-4 gap-2 no-scrollbar mb-4">
        {CATEGORIES.map(cat => (
          <button
            key={cat}
            onClick={() => setSelectedCategory(cat)}
            className={`px-5 py-2 rounded-full text-sm font-semibold transition-all whitespace-nowrap border
              ${selectedCategory === cat 
                ? 'bg-primary-500 text-white border-primary-500 shadow-md shadow-primary-500/20' 
                : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300 hover:bg-slate-50'
              }
            `}
          >
            {cat}
          </button>
        ))}
      </div>

      {/* Map Container */}
      <div 
        className="rounded-2xl overflow-hidden border border-slate-200 shadow-sm relative"
        style={{ height: 'calc(100vh - 220px)', minHeight: '500px' }}
      >
        {loading && (
          <div className="absolute inset-0 z-20 bg-white/70 backdrop-blur-sm flex flex-col items-center justify-center">
            <div className="w-10 h-10 border-4 border-primary-500 border-t-transparent rounded-full animate-spin mb-4"></div>
            <p className="text-slate-800 font-medium">Loading map data...</p>
          </div>
        )}
        
        <MapContainer 
          center={[3.1390, 101.6869]}
          zoom={12} 
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
          
          {filteredReports.map(report => {
            const priority = getPriority(report.status, report.categories);
            const color = getPriorityColor(priority);
            
            return (
              <CircleMarker
                key={report.id}
                center={[report.latitude, report.longitude]}
                radius={8}
                pathOptions={{
                  color: 'white',
                  weight: 2,
                  fillColor: color,
                  fillOpacity: 0.9,
                }}
              >
                <Popup className="custom-popup">
                  <div className="w-64">
                    {report.image_path ? (
                      <img 
                        src={getImageUrl(report.image_path)} 
                        alt="Issue" 
                        className="w-full h-32 object-cover rounded-t-lg cursor-pointer hover:opacity-90 transition-opacity"
                        onClick={() => setFullScreenImage(getImageUrl(report.image_path))}
                        onError={(e) => {
                          e.target.style.display = 'none';
                          e.target.nextSibling.style.display = 'flex';
                        }}
                      />
                    ) : null}
                    <div className="flex w-full h-32 bg-slate-100 rounded-t-lg items-center justify-center" style={{ display: report.image_path ? 'none' : 'flex' }}>
                       <ImageIcon className="text-slate-400" size={32} />
                    </div>
                    
                    <div className="p-3">
                      <div className="flex justify-between items-start mb-2">
                         <h3 className="font-bold text-slate-800 text-sm line-clamp-1">{report.categories || 'Unknown Issue'}</h3>
                         <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full" style={{ backgroundColor: `${color}20`, color }}>
                           {priority}
                         </span>
                      </div>
                      
                      {report.ai_prediction && (
                         <div className="text-xs text-slate-600 mb-2">
                           <span className="font-semibold text-slate-700">AI: </span>
                           {report.ai_prediction} ({report.confidence})
                         </div>
                      )}
                      
                      <div className="flex items-start gap-1 text-xs text-slate-500 mb-3">
                        <MapPin size={14} className="mt-0.5 shrink-0" />
                        <span className="line-clamp-2">{report.address || 'No address'}</span>
                      </div>

                      <div className="flex justify-between items-center text-xs">
                        <span className="text-slate-400">
                           {(() => {
                             if (!report.timestamp) return 'Unknown time';
                             const d = new Date(report.timestamp);
                             if (isNaN(d.getTime())) return String(report.timestamp);
                             return format(d, 'MMM d, h:mm a');
                           })()}
                        </span>
                        <span className="font-medium px-2 py-1 bg-slate-100 rounded text-slate-700">
                           {report.status || 'Pending'}
                        </span>
                      </div>
                    </div>
                  </div>
                </Popup>
              </CircleMarker>
            );
          })}
        </MapContainer>

        {/* Legend */}
        <div className="absolute bottom-6 left-6 z-[400] bg-white p-4 rounded-xl shadow-lg border border-slate-100 pointer-events-auto">
          <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3">Priority Map</h4>
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-red-500 ring-2 ring-white shadow-sm"></div>
              <span className="text-sm font-medium text-slate-700">High (Damage, Tree)</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-orange-500 ring-2 ring-white shadow-sm"></div>
              <span className="text-sm font-medium text-slate-700">Medium Priority</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-green-500 ring-2 ring-white shadow-sm"></div>
              <span className="text-sm font-medium text-slate-700">Low (Resolved)</span>
            </div>
          </div>
          <div className="mt-3 pt-3 border-t border-slate-100 text-xs text-slate-400">
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
