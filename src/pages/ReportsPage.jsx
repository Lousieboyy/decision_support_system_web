import { useEffect, useState, useMemo } from 'react';
import { fetchReports, getImageUrl } from '../api/reportsApi';
import { useAuth } from '../context/AuthContext';
import { ReportDetailModal } from '../components/ReportDetailModal';
import { format, isWithinInterval, parseISO, startOfDay, endOfDay, subDays } from 'date-fns';
import {
  Search, Filter, RefreshCw, Image as ImageIcon, MapPin,
  ChevronDown, ChevronUp, ChevronLeft, ChevronRight, Calendar, SlidersHorizontal, X,
} from 'lucide-react';

const PAGE_SIZE_OPTIONS = [10, 25, 50];

const DATE_PRESETS = [
  { label: 'All Time', value: 'all' },
  { label: 'Today', value: 'today' },
  { label: 'Last 7 days', value: '7d' },
  { label: 'Last 30 days', value: '30d' },
];

function parseConfidence(conf) {
  if (!conf) return 0;
  return parseFloat(conf.replace('%', '')) || 0;
}

export function ReportsPage() {
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  
  // Role
  const { role: currentRole } = useAuth();

  // Filters
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('All');
  const [datePreset, setDatePreset] = useState('all');
  const [minConfidence, setMinConfidence] = useState(0);
  const [showFilters, setShowFilters] = useState(false);

  // Selected report for modal
  const [selectedReport, setSelectedReport] = useState(null);

  // Sorting
  const [sortField, setSortField] = useState('timestamp');
  const [sortOrder, setSortOrder] = useState('desc');

  // Pagination
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const loadReports = async () => {
    try {
      setLoading(true);
      const data = await fetchReports(currentRole);
      setReports(data);
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadReports(); }, [currentRole]);

  // Reset to page 1 whenever filters change
  useEffect(() => { setCurrentPage(1); }, [searchTerm, statusFilter, datePreset, minConfidence, sortField, sortOrder]);

  const handleUpdate = (id, partial) => {
    setReports(prev => prev.map(r => r.id === id ? { ...r, ...partial } : r));
  };

  const toggleSort = (field) => {
    if (sortField === field) {
      setSortOrder(s => s === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortOrder('desc');
    }
  };

  const activeFilterCount = [
    statusFilter !== 'All',
    datePreset !== 'all',
    minConfidence > 0,
  ].filter(Boolean).length;

  const processedReports = useMemo(() => {
    let result = [...reports];

    // Status filter
    if (statusFilter !== 'All') {
      result = result.filter(r => {
        const s = r.status || 'Pending';
        return s === statusFilter;
      });
    }

    // Date preset filter
    if (datePreset !== 'all') {
      const now = new Date();
      const rangeStart = datePreset === 'today'
        ? startOfDay(now)
        : startOfDay(subDays(now, parseInt(datePreset)));
      const rangeEnd = endOfDay(now);
      result = result.filter(r => {
        if (!r.timestamp) return false;
        try {
          const d = parseISO(r.timestamp);
          return isWithinInterval(d, { start: rangeStart, end: rangeEnd });
        } catch { return false; }
      });
    }

    // Confidence threshold filter
    if (minConfidence > 0) {
      result = result.filter(r => parseConfidence(r.confidence) >= minConfidence);
    }

    // Search
    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      result = result.filter(r =>
        (r.categories || '').toLowerCase().includes(term) ||
        (r.address || '').toLowerCase().includes(term) ||
        (r.ai_prediction || '').toLowerCase().includes(term) ||
        String(r.id).includes(term)
      );
    }

    // Sort
    result.sort((a, b) => {
      let valA = a[sortField] ?? '';
      let valB = b[sortField] ?? '';
      if (sortField === 'timestamp') {
        valA = new Date(valA).getTime();
        valB = new Date(valB).getTime();
      }
      if (valA < valB) return sortOrder === 'asc' ? -1 : 1;
      if (valA > valB) return sortOrder === 'asc' ? 1 : -1;
      return 0;
    });

    // Role-based overall filtering
    if (currentRole?.startsWith('authority')) {
      const deptId = currentRole.split('_')[1]; // e.g. 'mbmb' or 'samb'
      result = result.filter(r => {
        if (r.status === 'Pending') return false;
        if (!deptId) return true; // generic authority sees all non-pending
        // We need to check if the assigned_department matches the deptName from AUTHORITIES list, or the id itself
        // e.g. 'Majlis Bandaraya Melaka Bersejarah' includes 'Melaka' or we just do a simple check.
        // But assigned_department stores the name. Let's do a case-insensitive includes for 'mbmb' or 'samb', 
        // or check against hardcoded strings.
        const assigned = (r.assigned_department || '').toLowerCase();
        if (deptId === 'mbmb' && (assigned.includes('mbmb') || assigned.includes('bersejarah'))) return true;
        if (deptId === 'samb' && (assigned.includes('samb') || assigned.includes('air'))) return true;
        return false;
      });
    } else if (currentRole?.startsWith('worker')) {
      const deptId = currentRole.split('_')[1];
      result = result.filter(r => {
        if (!r.status || r.status === 'Pending' || r.status === 'In Review') return false;
        if (!deptId) return true; // generic worker sees all non-pending/in-review
        const assigned = (r.assigned_department || '').toLowerCase();
        if (deptId === 'mbmb' && (assigned.includes('mbmb') || assigned.includes('bersejarah'))) return true;
        if (deptId === 'samb' && (assigned.includes('samb') || assigned.includes('air'))) return true;
        
        // For other departments, do a simple includes match on abbreviation
        const deptAbbr = deptId.toLowerCase();
        if (assigned.includes(deptAbbr)) return true;
        
        // Special case fallback mapping
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
  }, [reports, statusFilter, datePreset, minConfidence, searchTerm, sortField, sortOrder, currentRole]);

  const totalPages = Math.max(1, Math.ceil(processedReports.length / pageSize));
  const paginatedReports = processedReports.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  const StatusBadge = ({ status }) => {
    let cls = 'bg-slate-100 text-slate-700';
    if (status === 'Pending')        cls = 'bg-orange-100 text-orange-800';
    if (status === 'In Review')      cls = 'bg-amber-100 text-amber-800';
    if (status === 'In Process')     cls = 'bg-blue-100 text-blue-800';
    if (status === 'In Maintenance') cls = 'bg-purple-100 text-purple-800';
    if (status === 'Resolved')       cls = 'bg-green-100 text-green-800';
    return <span className={`px-2.5 py-1 text-xs font-bold rounded-lg ${cls}`}>{status || 'Pending'}</span>;
  };

  const SortIcon = ({ field }) => {
    if (sortField !== field) return <ChevronDown size={14} className="text-slate-300 opacity-0 group-hover:opacity-100" />;
    return sortOrder === 'asc'
      ? <ChevronUp size={14} className="text-primary-500" />
      : <ChevronDown size={14} className="text-primary-500" />;
  };

  return (
    <div className="p-8 pb-20">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-start justify-between gap-4 mb-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-slate-900 mb-1">Reports Management</h1>
          <p className="text-slate-500 mb-3">View, track, and update citizen issues.</p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {/* Search */}
          <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Search ID, category, location..."
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              className="pl-9 pr-4 py-2 w-60 bg-white border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 shadow-sm"
            />
          </div>

          {/* Status filter */}
          <div className="relative">
            <Filter size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <select
              value={statusFilter}
              onChange={e => setStatusFilter(e.target.value)}
              className="pl-9 pr-8 py-2 bg-white border border-slate-200 rounded-lg text-sm font-medium focus:ring-2 focus:ring-primary-500 appearance-none shadow-sm cursor-pointer"
            >
              <option value="All">All Statuses</option>
              <option value="Pending">Pending</option>
              <option value="In Review">In Review</option>
              <option value="In Process">In Process</option>
              <option value="In Maintenance">In Maintenance</option>
              <option value="Resolved">Resolved</option>
            </select>
          </div>

          {/* Advanced filters toggle */}
          <button
            onClick={() => setShowFilters(v => !v)}
            className={`relative flex items-center gap-2 px-3 py-2 rounded-lg border text-sm font-medium shadow-sm transition-colors
              ${showFilters ? 'bg-primary-50 border-primary-200 text-primary-700' : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'}`}
          >
            <SlidersHorizontal size={16} />
            Filters
            {activeFilterCount > 0 && (
              <span className="absolute -top-1.5 -right-1.5 w-4 h-4 bg-primary-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center">
                {activeFilterCount}
              </span>
            )}
          </button>

          {/* Refresh */}
          <button
            onClick={loadReports}
            className="p-2.5 bg-white border border-slate-200 rounded-lg text-slate-500 hover:text-primary-500 hover:bg-slate-50 shadow-sm transition-colors"
            title="Refresh"
          >
            <RefreshCw size={18} className={loading ? 'animate-spin text-primary-500' : ''} />
          </button>
        </div>
      </div>

      {/* Advanced Filters Panel */}
      {showFilters && (
        <div className="mb-6 p-5 bg-white border border-slate-200 rounded-2xl shadow-sm flex flex-wrap gap-6 items-end">
          {/* Date Range Preset */}
          <div>
            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2 flex items-center gap-1">
              <Calendar size={12} /> Date Range
            </label>
            <div className="flex gap-2">
              {DATE_PRESETS.map(p => (
                <button
                  key={p.value}
                  onClick={() => setDatePreset(p.value)}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors
                    ${datePreset === p.value
                      ? 'bg-primary-500 text-white border-primary-500'
                      : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300'}`}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          {/* Min Confidence */}
          <div className="min-w-[220px]">
            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
              Min AI Confidence: <span className="text-primary-600">{minConfidence}%</span>
            </label>
            <input
              type="range"
              min={0}
              max={100}
              step={5}
              value={minConfidence}
              onChange={e => setMinConfidence(Number(e.target.value))}
              className="w-full accent-primary-500"
            />
            <div className="flex justify-between text-xs text-slate-400 mt-1">
              <span>0%</span><span>50%</span><span>100%</span>
            </div>
          </div>

          {/* Reset */}
          {activeFilterCount > 0 && (
            <button
              onClick={() => { setStatusFilter('All'); setDatePreset('all'); setMinConfidence(0); }}
              className="flex items-center gap-1 px-3 py-2 rounded-lg text-sm font-medium text-red-500 border border-red-200 bg-red-50 hover:bg-red-100 transition-colors"
            >
              <X size={14} /> Reset Filters
            </button>
          )}
        </div>
      )}

      {error ? (
        <div className="bg-red-50 text-red-600 p-4 rounded-xl border border-red-100">
          Failed to load reports: {error}
        </div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm whitespace-nowrap">
              <thead className="bg-slate-50 text-slate-500 border-b border-slate-200 uppercase text-xs font-bold tracking-wider">
                <tr>
                  <th className="px-6 py-4 cursor-pointer group hover:bg-slate-100 transition-colors" onClick={() => toggleSort('id')}>
                    <div className="flex items-center gap-1">ID <SortIcon field="id" /></div>
                  </th>
                  <th className="px-6 py-4">Image</th>
                  <th className="px-6 py-4 cursor-pointer group hover:bg-slate-100" onClick={() => toggleSort('categories')}>
                    <div className="flex items-center gap-1">Category <SortIcon field="categories" /></div>
                  </th>
                  <th className="px-6 py-4">Location</th>
                  <th className="px-6 py-4 cursor-pointer group hover:bg-slate-100" onClick={() => toggleSort('ai_prediction')}>
                    <div className="flex items-center gap-1">AI Prediction <SortIcon field="ai_prediction" /></div>
                  </th>
                  <th className="px-6 py-4 cursor-pointer group hover:bg-slate-100" onClick={() => toggleSort('status')}>
                    <div className="flex items-center gap-1">Status <SortIcon field="status" /></div>
                  </th>
                  <th className="px-6 py-4 cursor-pointer group hover:bg-slate-100" onClick={() => toggleSort('timestamp')}>
                    <div className="flex items-center gap-1">Reported At <SortIcon field="timestamp" /></div>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {loading && reports.length === 0 ? (
                  <tr>
                    <td colSpan="7" className="px-6 py-12 text-center text-slate-500">
                      <div className="flex flex-col items-center justify-center">
                        <div className="w-8 h-8 border-4 border-primary-500 border-t-transparent rounded-full animate-spin mb-4" />
                        Loading reports...
                      </div>
                    </td>
                  </tr>
                ) : paginatedReports.length === 0 ? (
                  <tr>
                    <td colSpan="7" className="px-6 py-12 text-center text-slate-500 font-medium">
                      No reports found matching your criteria.
                    </td>
                  </tr>
                ) : paginatedReports.map(report => (
                  <tr
                    key={report.id}
                    onClick={() => setSelectedReport(report)}
                    className="hover:bg-slate-50 cursor-pointer transition-colors group"
                  >
                    <td className="px-6 py-4 text-slate-500 font-mono">#{report.id}</td>
                    <td className="px-6 py-4">
                      {report.image_path ? (
                        <div className="w-10 h-10 rounded-lg overflow-hidden border border-slate-200">
                          <img
                            src={getImageUrl(report.image_path)}
                            alt="thumbnail"
                            className="w-full h-full object-cover"
                            onError={e => e.target.style.display = 'none'}
                          />
                        </div>
                      ) : (
                        <div className="w-10 h-10 rounded-lg bg-slate-100 flex items-center justify-center border border-slate-200">
                          <ImageIcon size={16} className="text-slate-400" />
                        </div>
                      )}
                    </td>
                    <td className="px-6 py-4 font-bold text-slate-800">{report.categories || '-'}</td>
                    <td className="px-6 py-4 text-slate-600 max-w-[200px] truncate">
                      <div className="flex items-center gap-1.5">
                        <MapPin size={14} className="text-slate-400 shrink-0" />
                        <span className="truncate">{report.address || 'Unknown'}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      {report.ai_prediction ? (
                        <div>
                          <p className="font-semibold text-slate-800">{report.ai_prediction}</p>
                          <div className="flex items-center gap-2 mt-1">
                            <div className="w-16 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                              <div
                                className="h-full bg-primary-500 rounded-full"
                                style={{ width: report.confidence || '0%' }}
                              />
                            </div>
                            <span className="text-xs text-slate-500">{report.confidence}</span>
                          </div>
                        </div>
                      ) : <span className="text-slate-400">-</span>}
                    </td>
                    <td className="px-6 py-4">
                      <StatusBadge status={report.status} />
                    </td>
                    <td className="px-6 py-4 text-slate-600 text-sm">
                      {(() => {
                        if (!report.timestamp) return '-';
                        const d = new Date(report.timestamp);
                        if (isNaN(d.getTime())) return String(report.timestamp);
                        return format(d, 'MMM d, yyyy HH:mm');
                      })()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination Footer */}
          <div className="border-t border-slate-200 bg-slate-50 px-6 py-4 flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3 text-xs text-slate-500 font-medium">
              <span>
                Showing{' '}
                <span className="font-bold text-slate-700">
                  {processedReports.length === 0 ? 0 : (currentPage - 1) * pageSize + 1}–{Math.min(currentPage * pageSize, processedReports.length)}
                </span>{' '}
                of <span className="font-bold text-slate-700">{processedReports.length}</span> results
                {processedReports.length !== reports.length && (
                  <span className="ml-1 text-slate-400">({reports.length} total)</span>
                )}
              </span>

              <select
                value={pageSize}
                onChange={e => { setPageSize(Number(e.target.value)); setCurrentPage(1); }}
                className="ml-2 bg-white border border-slate-200 rounded-lg px-2 py-1 text-xs font-medium focus:ring-2 focus:ring-primary-500 cursor-pointer"
              >
                {PAGE_SIZE_OPTIONS.map(s => (
                  <option key={s} value={s}>{s} / page</option>
                ))}
              </select>
            </div>

            <div className="flex items-center gap-1">
              <button
                onClick={() => setCurrentPage(1)}
                disabled={currentPage === 1}
                className="px-2 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-medium text-slate-500 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                «
              </button>
              <button
                onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                disabled={currentPage === 1}
                className="p-1.5 rounded-lg border border-slate-200 bg-white text-slate-500 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                <ChevronLeft size={16} />
              </button>

              {/* Page number buttons */}
              {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                let page;
                if (totalPages <= 5) {
                  page = i + 1;
                } else if (currentPage <= 3) {
                  page = i + 1;
                } else if (currentPage >= totalPages - 2) {
                  page = totalPages - 4 + i;
                } else {
                  page = currentPage - 2 + i;
                }
                return (
                  <button
                    key={page}
                    onClick={() => setCurrentPage(page)}
                    className={`w-8 h-8 rounded-lg text-xs font-bold border transition-colors
                      ${currentPage === page
                        ? 'bg-primary-500 text-white border-primary-500 shadow-sm'
                        : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'}`}
                  >
                    {page}
                  </button>
                );
              })}

              <button
                onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                disabled={currentPage === totalPages}
                className="p-1.5 rounded-lg border border-slate-200 bg-white text-slate-500 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                <ChevronRight size={16} />
              </button>
              <button
                onClick={() => setCurrentPage(totalPages)}
                disabled={currentPage === totalPages}
                className="px-2 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-medium text-slate-500 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                »
              </button>
            </div>
          </div>
        </div>
      )}

      <ReportDetailModal
        report={selectedReport}
        onClose={() => setSelectedReport(null)}
        onUpdate={handleUpdate}
        currentRole={currentRole}
      />
    </div>
  );
}
