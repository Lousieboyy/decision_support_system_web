import { useEffect, useState, useMemo } from 'react';
import { fetchReports, getImageUrl } from '../api/reportsApi';
import { useAuth } from '../context/AuthContext';
import { ReportDetailModal } from '../components/ReportDetailModal';
import { AUTHORITIES } from '../utils/authorities';
import { format, isWithinInterval, parseISO, startOfDay, endOfDay, subDays } from 'date-fns';
import jsPDF from 'jspdf';
import {
  Search, Filter, RefreshCw, Image as ImageIcon, MapPin,
  ChevronDown, ChevronUp, ChevronLeft, ChevronRight, Calendar, SlidersHorizontal, X, Building2, Download, FileText
} from 'lucide-react';

// Get dept id from role
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

// Check if a report belongs to a dept
function reportMatchesDept(report, deptId) {
  if (!deptId) return true;
  const assigned = (report.assigned_department || '').toLowerCase();
  const authority = AUTHORITIES.find(a => a.id === deptId);
  if (!authority) return assigned.includes(deptId);
  return (
    assigned.includes(authority.abbr.toLowerCase()) ||
    assigned.includes(authority.id.toLowerCase()) ||
    assigned.includes(authority.name.toLowerCase())
  );
}

// Dept tag
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
      {auth?.abbr || department.slice(0, 8)}
    </span>
  );
}

const PAGE_SIZE_OPTIONS = [10, 25, 50];

const DATE_PRESETS = [
  { label: 'All Time', value: 'all' },
  { label: 'Today', value: 'today' },
  { label: 'Last 7 days', value: '7d' },
  { label: 'Last 30 days', value: '30d' },
];

const STATUS_TABS = ['All', 'Pending', 'In Review', 'In Process', 'In Maintenance', 'Resolved', 'Rejected'];

function parseConfidence(conf) {
  if (!conf) return 0;
  return parseFloat(conf.replace('%', '')) || 0;
}

export function ReportsPage() {
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  
  // Role
  const { role: currentRole, user } = useAuth();

  // Filters
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('All');
  const [datePreset, setDatePreset] = useState('all');
  const [minConfidence, setMinConfidence] = useState(0);
  const [showFilters, setShowFilters] = useState(false);
  const [myDeptOnly, setMyDeptOnly] = useState(true);

  const deptId = getDeptId(currentRole, user?.username);

  // Compute status counts for the tabs
  const statusCounts = useMemo(() => {
    const counts = { All: 0, Pending: 0, 'In Review': 0, 'In Process': 0, 'In Maintenance': 0, Resolved: 0, Rejected: 0 };
    let visibleReports = reports;
    if (myDeptOnly && deptId) {
      visibleReports = reports.filter(r => reportMatchesDept(r, deptId));
    }
    visibleReports.forEach(r => {
      const s = r.status || 'Pending';
      counts.All++;
      if (counts[s] !== undefined) counts[s]++;
    });
    return counts;
  }, [reports, myDeptOnly, deptId]);

  // Selected report for modal
  const [selectedReport, setSelectedReport] = useState(null);

  // Sorting
  const [sortField, setSortField] = useState('upvotes');
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
    myDeptOnly,
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
      let valA = a[sortField];
      let valB = b[sortField];
      
      if (sortField === 'timestamp') {
        valA = valA ? new Date(valA).getTime() : 0;
        valB = valB ? new Date(valB).getTime() : 0;
      } else if (sortField === 'upvotes' || sortField === 'id') {
        valA = Number(valA) || 0;
        valB = Number(valB) || 0;
      } else {
        valA = String(valA ?? '').toLowerCase();
        valB = String(valB ?? '').toLowerCase();
      }
      
      if (valA < valB) return sortOrder === 'asc' ? -1 : 1;
      if (valA > valB) return sortOrder === 'asc' ? 1 : -1;
      return 0;
    });

    // "My Dept Only" toggle — show only reports assigned to user's dept
    if (myDeptOnly && deptId) {
      result = result.filter(r => reportMatchesDept(r, deptId));
    }

    return result;
  }, [reports, statusFilter, datePreset, minConfidence, searchTerm, sortField, sortOrder, currentRole, myDeptOnly, deptId]);

  const totalPages = Math.max(1, Math.ceil(processedReports.length / pageSize));
  const paginatedReports = processedReports.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  const StatusBadge = ({ status }) => {
    let cls = 'bg-slate-800 text-slate-300';
    if (status === 'Pending')        cls = 'bg-amber-500/15 border border-amber-500/30 text-amber-300';
    if (status === 'In Review')      cls = 'bg-blue-500/15 border border-blue-500/30 text-blue-300';
    if (status === 'In Process')     cls = 'bg-indigo-500/15 border border-indigo-500/30 text-indigo-300';
    if (status === 'In Maintenance') cls = 'bg-purple-500/15 border border-purple-500/30 text-purple-300';
    if (status === 'Resolved')       cls = 'bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 font-extrabold';
    if (status === 'Rejected')       cls = 'bg-red-500/15 border border-red-500/30 text-red-400 line-through';
    return <span className={`px-2.5 py-1 text-xs font-bold rounded-lg ${cls}`}>{status || 'Pending'}</span>;
  };

  const SortIcon = ({ field }) => {
    if (sortField !== field) return <ChevronDown size={14} className="text-slate-300 opacity-0 group-hover:opacity-100" />;
    return sortOrder === 'asc'
      ? <ChevronUp size={14} className="text-primary-500" />
      : <ChevronDown size={14} className="text-primary-500" />;
  };

  const handleExportCSV = () => {
    const headers = ['ID', 'Category', 'Location', 'AI Prediction', 'Confidence', 'Assigned Dept', 'Status', 'Reported At'];
    const rows = processedReports.map(r => [
      r.id,
      r.categories || '',
      r.address || '',
      r.ai_prediction || '',
      r.confidence || '',
      r.assigned_department || '',
      r.status || 'Pending',
      r.timestamp ? new Date(r.timestamp).toLocaleString() : '',
    ]);
    const csv = [headers, ...rows].map(row => row.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `smart_city_reports_${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleExportPDF = () => {
    const doc = new jsPDF();
    doc.setFontSize(16);
    doc.text('Smart City Reports', 14, 20);
    doc.setFontSize(10);
    
    let y = 30;
    processedReports.forEach(r => {
      if (y > 270) {
        doc.addPage();
        y = 20;
      }
      const dateStr = r.timestamp ? new Date(r.timestamp).toLocaleString() : 'Unknown';
      doc.setFont(undefined, 'bold');
      doc.text(`ID: #${r.id} | Status: ${r.status || 'Pending'}`, 14, y);
      doc.setFont(undefined, 'normal');
      doc.text(`Dept: ${r.assigned_department || 'Unassigned'} | Date: ${dateStr}`, 90, y);
      y += 6;
      doc.text(`Location: ${r.address || 'Unknown'}`, 14, y);
      y += 6;
      doc.text(`Category: ${r.categories || 'N/A'} | AI: ${r.ai_prediction || 'None'} (${r.confidence || '0%'})`, 14, y);
      y += 10;
    });
    
    doc.save(`smart_city_reports_${new Date().toISOString().slice(0,10)}.pdf`);
  };

  return (
    <div className="p-8 pb-20">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-start justify-between gap-4 mb-6">
        <div>
          <h1 className="page-header-title">Reports Management</h1>
          <div className="page-header-sub mt-1">
            {deptId ? (
              <span className="flex items-center gap-2">
                <span className="font-semibold" style={{ color: 'rgba(148,163,184,0.9)' }}>{user?.displayName}</span>
                <span style={{ color: 'rgba(255,255,255,0.15)' }}>|</span>
                <span>{AUTHORITIES.find(a => a.id === deptId)?.abbr || deptId.toUpperCase()} Department</span>
              </span>
            ) : 'All city reports — every role can view. Dept tags show admin assignment.'}
          </div>
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
              className="pl-9 pr-4 py-2 w-60 rounded-lg text-sm focus:ring-2 focus:ring-white/20" style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.10)', color: '#f1f5f9' }}
            />
          </div>

          {/* Status filter dropdown removed in favor of status tab bar below */}

          {/* Advanced filters toggle */}
          <button
            onClick={() => setShowFilters(v => !v)}
            className={`relative flex items-center gap-2 px-3 py-2 rounded-lg border text-sm font-medium transition-colors
              ${showFilters
                ? 'bg-white/10 border-white/20 text-white'
                : 'bg-white/6 border-white/10 text-slate-300 hover:bg-white/10'}`}
          >
            <SlidersHorizontal size={16} />
            Filters
            {activeFilterCount > 0 && (
              <span className="absolute -top-1.5 -right-1.5 w-4 h-4 bg-slate-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center">
                {activeFilterCount}
              </span>
            )}
          </button>

          {/* My Dept toggle — only shown to non-admin users */}
          {deptId && (
            <button
              onClick={() => setMyDeptOnly(v => !v)}
              className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-sm font-semibold transition-colors ${
                myDeptOnly
                  ? 'bg-white border-white text-black shadow-md shadow-white/10'
                  : 'bg-white/6 border-white/10 text-slate-300 hover:bg-white/10'
              }`}
            >
              My Dept Only
            </button>
          )}

          {/* Export CSV & PDF */}
          <div className="flex items-center gap-2">
            <button onClick={handleExportCSV} className="export-btn" title="Export filtered results as CSV">
              <Download size={15} /> CSV
            </button>
            <button onClick={handleExportPDF} className="export-btn" title="Export filtered results as PDF">
              <FileText size={15} /> PDF
            </button>
          </div>

          {/* Refresh */}
          <button
            onClick={loadReports}
            className="p-2.5 rounded-lg border transition-colors" style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.10)', color: 'rgba(148,163,184,0.7)' }}
            title="Refresh"
          >
            <RefreshCw size={18} className={loading ? 'animate-spin text-slate-400' : ''} />
          </button>
        </div>
      </div>

      {/* Advanced Filters Panel */}
      {showFilters && (
        <div className="mb-6 p-5 rounded-2xl flex flex-wrap gap-6 items-end" style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.09)', backdropFilter: 'blur(16px)' }}>
          {/* Date Range Preset */}
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider mb-2 flex items-center gap-1" style={{ color: 'rgba(148,163,184,0.75)' }}>
              <Calendar size={12} /> Date Range
            </label>
            <div className="flex gap-2">
              {DATE_PRESETS.map(p => (
                <button
                  key={p.value}
                  onClick={() => setDatePreset(p.value)}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors
                    ${datePreset === p.value
                      ? 'bg-white text-black border-white'
                      : 'bg-white/6 text-slate-300 border-white/10 hover:border-white/20'}`}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          {/* Min Confidence */}
          <div className="min-w-[220px]">
            <label className="block text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'rgba(148,163,184,0.75)' }}>
              Min AI Confidence: <span style={{ color: '#cbd5e1' }}>{minConfidence}%</span>
            </label>
            <input
              type="range"
              min={0}
              max={100}
              step={5}
              value={minConfidence}
              onChange={e => setMinConfidence(Number(e.target.value))}
              className="w-full accent-slate-400"
            />
            <div className="flex justify-between text-xs text-slate-400 mt-1">
              <span>0%</span><span>50%</span><span>100%</span>
            </div>
          </div>

          {/* Reset */}
          {activeFilterCount > 0 && (
            <button
              onClick={() => { setStatusFilter('All'); setDatePreset('all'); setMinConfidence(0); }}
              className="flex items-center gap-1 px-3 py-2 rounded-lg text-sm font-medium border transition-colors" style={{ color: '#ffffff', borderColor: 'rgba(255,255,255,0.15)', background: 'rgba(255,255,255,0.06)' }}
            >
              <X size={14} /> Reset Filters
            </button>
          )}
        </div>
      )}

      {/* Status Tabs Bar & Sort Selector */}
      <div className="mb-6 flex flex-wrap items-center justify-between border-b pb-4 gap-4" style={{ borderColor: 'rgba(255,255,255,0.08)' }}>
        <div className="flex flex-wrap gap-2">
          {STATUS_TABS.map(tab => {
            const isActive = statusFilter === tab;
            const count = statusCounts[tab];
            return (
              <button
                key={tab}
                onClick={() => setStatusFilter(tab)}
                className={`px-4 py-2 text-xs font-bold rounded-lg border transition-all duration-150 flex items-center gap-2 cursor-pointer
                  ${isActive 
                    ? 'bg-white text-black border-white shadow-lg shadow-white/5 font-extrabold' 
                    : 'bg-white/4 border-white/8 text-slate-400 hover:text-slate-200 hover:border-white/15'}`}
              >
                <span>{tab}</span>
                <span className={`px-1.5 py-0.5 text-[9px] rounded font-extrabold ${isActive ? 'bg-black text-white' : 'bg-white/10 text-slate-400'}`}>
                  {count}
                </span>
              </button>
            );
          })}
        </div>

        {/* Quick Sort Selector */}
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-400 font-semibold uppercase tracking-wider">Sort By:</span>
          <div className="bg-white/5 border border-white/8 p-0.5 rounded-lg flex">
            <button
              onClick={() => { setSortField('timestamp'); setSortOrder('desc'); }}
              className={`px-3 py-1.5 rounded-md text-[11px] font-bold transition-all cursor-pointer ${
                sortField === 'timestamp' 
                  ? 'bg-white text-black font-extrabold shadow-sm' 
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Date (Newest)
            </button>
            <button
              onClick={() => { setSortField('upvotes'); setSortOrder('desc'); }}
              className={`px-3 py-1.5 rounded-md text-[11px] font-bold transition-all cursor-pointer ${
                sortField === 'upvotes' 
                  ? 'bg-white text-black font-extrabold shadow-sm' 
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Upvotes (Criticality)
            </button>
          </div>
        </div>
      </div>

      {error ? (
        <div className="rounded-xl p-4 border flex items-center" style={{ background: 'rgba(255,255,255,0.03)', borderColor: 'rgba(255,255,255,0.08)', color: '#cbd5e1' }}>
          Failed to load reports: {error}
        </div>
      ) : (
        <div className="rounded-2xl overflow-hidden" style={{ background: 'rgba(255,255,255,0.055)', backdropFilter: 'blur(20px)', border: '1px solid rgba(255,255,255,0.09)' }}>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm whitespace-nowrap">
              <thead className="text-xs font-bold tracking-wider uppercase" style={{ background: 'rgba(255,255,255,0.04)', borderBottom: '1px solid rgba(255,255,255,0.07)', color: 'rgba(148,163,184,0.65)' }}>
                <tr>
                  <th className="px-6 py-4 cursor-pointer group transition-colors" onClick={() => toggleSort('id')}>
                    <div className="flex items-center gap-1">ID <SortIcon field="id" /></div>
                  </th>
                  <th className="px-6 py-4">Image</th>
                  <th className="px-6 py-4 cursor-pointer group" onClick={() => toggleSort('categories')}>
                    <div className="flex items-center gap-1">Category <SortIcon field="categories" /></div>
                  </th>
                  <th className="px-6 py-4">Location</th>
                  <th className="px-6 py-4 cursor-pointer group" onClick={() => toggleSort('ai_prediction')}>
                    <div className="flex items-center gap-1">AI Prediction <SortIcon field="ai_prediction" /></div>
                  </th>
                  <th className="px-6 py-4">Assigned To</th>
                  <th className="px-6 py-4 cursor-pointer group" onClick={() => toggleSort('status')}>
                    <div className="flex items-center gap-1">Status <SortIcon field="status" /></div>
                  </th>
                  <th className="px-6 py-4 cursor-pointer group" onClick={() => toggleSort('upvotes')}>
                    <div className="flex items-center gap-1">Upvotes <SortIcon field="upvotes" /></div>
                  </th>
                  <th className="px-6 py-4 cursor-pointer group" onClick={() => toggleSort('timestamp')}>
                    <div className="flex items-center gap-1">Reported At <SortIcon field="timestamp" /></div>
                  </th>
                </tr>
              </thead>
              <tbody style={{ borderColor: 'rgba(255,255,255,0.05)' }} className="divide-y">
                {loading && reports.length === 0 ? (
                  <tr>
                    <td colSpan="9" className="px-6 py-12 text-center" style={{ color: 'rgba(148,163,184,0.6)' }}>
                      <div className="flex flex-col items-center justify-center">
                        <div className="w-8 h-8 border-4 border-slate-400 border-t-transparent rounded-full animate-spin mb-4" />
                        Loading reports...
                      </div>
                    </td>
                  </tr>
                ) : paginatedReports.length === 0 ? (
                  <tr>
                    <td colSpan="9" className="px-6 py-12 text-center font-medium" style={{ color: 'rgba(148,163,184,0.55)' }}>
                      No reports found matching your criteria.
                    </td>
                  </tr>
                ) : paginatedReports.map(report => {
                  const isMyDept = deptId ? reportMatchesDept(report, deptId) : false;
                  return (
                    <tr
                      key={report.id}
                      onClick={() => setSelectedReport(report)}
                      className={`cursor-pointer transition-colors group ${
                        isMyDept ? 'hover:bg-white/8' : 'hover:bg-white/5'
                      }`}
                    >
                      <td className="px-6 py-4 font-mono" style={{ color: 'rgba(148,163,184,0.55)' }}>#{report.id}</td>
                      <td className="px-6 py-4">
                        {report.image_path ? (
                          <div className="w-10 h-10 rounded-lg overflow-hidden" style={{ border: '1px solid rgba(255,255,255,0.10)' }}>
                            <img
                              src={getImageUrl(report.image_path)}
                              alt="thumbnail"
                              className="w-full h-full object-cover"
                              onError={e => e.target.style.display = 'none'}
                            />
                          </div>
                        ) : (
                          <div className="w-10 h-10 rounded-lg flex items-center justify-center" style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.10)' }}>
                            <ImageIcon size={16} style={{ color: 'rgba(148,163,184,0.5)' }} />
                          </div>
                        )}
                      </td>
                      <td className="px-6 py-4">
                        <p className="font-bold" style={{ color: '#e2e8f0' }}>{report.categories || '-'}</p>
                        {isMyDept && deptId && (
                          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full mt-1 inline-block" style={{ color: '#cbd5e1', background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.15)' }}>
                            YOUR DEPT
                          </span>
                        )}
                      </td>
                      <td className="px-6 py-4 text-slate-600 max-w-[180px] truncate">
                        <div className="flex items-center gap-1.5">
                          <MapPin size={14} style={{ color: 'rgba(148,163,184,0.5)' }} className="shrink-0" />
                          <span className="truncate" style={{ color: 'rgba(148,163,184,0.75)' }}>{report.address || 'Unknown'}</span>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        {report.ai_prediction ? (
                          <div>
                            <p className="font-semibold" style={{ color: '#e2e8f0' }}>{report.ai_prediction}</p>
                            <div className="flex items-center gap-2 mt-1">
                              <div className="w-16 h-1.5 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.08)' }}>
                                <div className="h-full bg-slate-400 rounded-full" style={{ width: report.confidence || '0%' }} />
                              </div>
                              <span className="text-xs" style={{ color: 'rgba(148,163,184,0.65)' }}>{report.confidence}</span>
                            </div>
                          </div>
                        ) : <span className="text-slate-400">-</span>}
                      </td>
                      <td className="px-6 py-4">
                        <DeptTag department={report.assigned_department} />
                      </td>
                      <td className="px-6 py-4">
                        <StatusBadge status={report.status} />
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-1.5 font-bold">
                          <span className={report.upvotes > 0 ? "text-amber-400" : "text-slate-500"}>
                            {report.upvotes || 0}
                          </span>
                        </div>
                      </td>
                      <td className="px-6 py-4 text-sm" style={{ color: 'rgba(148,163,184,0.65)' }}>
                        {(() => {
                          if (!report.timestamp) return '-';
                          const d = new Date(report.timestamp);
                          if (isNaN(d.getTime())) return String(report.timestamp);
                          return format(d, 'MMM d, yyyy HH:mm');
                        })()}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Pagination Footer */}
          <div className="px-6 py-4 flex flex-wrap items-center justify-between gap-4" style={{ borderTop: '1px solid rgba(255,255,255,0.06)', background: 'rgba(255,255,255,0.025)' }}>
            <div className="flex items-center gap-3 text-xs font-medium" style={{ color: 'rgba(148,163,184,0.6)' }}>
              <span>
                Showing{' '}
                <span className="font-bold" style={{ color: '#e2e8f0' }}>
                  {processedReports.length === 0 ? 0 : (currentPage - 1) * pageSize + 1}–{Math.min(currentPage * pageSize, processedReports.length)}
                </span>{' '}
                of <span className="font-bold" style={{ color: '#e2e8f0' }}>{processedReports.length}</span> results
                {processedReports.length !== reports.length && (
                  <span className="ml-1 text-slate-400">({reports.length} total city-wide)</span>
                )}
              </span>

              <select
                value={pageSize}
                onChange={e => { setPageSize(Number(e.target.value)); setCurrentPage(1); }}
                className="ml-2 rounded-lg px-2 py-1 text-xs font-medium focus:ring-2 focus:ring-white/20 cursor-pointer" style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.10)', color: '#e2e8f0' }}
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
                className="px-2 py-1.5 rounded-lg text-xs font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed" style={{ border: '1px solid rgba(255,255,255,0.09)', background: 'rgba(255,255,255,0.05)', color: 'rgba(148,163,184,0.7)' }}
              >
                «
              </button>
              <button
                onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                disabled={currentPage === 1}
                className="p-1.5 rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed" style={{ border: '1px solid rgba(255,255,255,0.09)', background: 'rgba(255,255,255,0.05)', color: 'rgba(148,163,184,0.7)' }}
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
                        ? 'bg-white text-black border-white shadow-sm shadow-white/10'
                        : 'bg-white/6 text-slate-300 border-white/10 hover:bg-white/10'}`}
                  >
                    {page}
                  </button>
                );
              })}

              <button
                onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                disabled={currentPage === totalPages}
                className="p-1.5 rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed" style={{ border: '1px solid rgba(255,255,255,0.09)', background: 'rgba(255,255,255,0.05)', color: 'rgba(148,163,184,0.7)' }}
              >
                <ChevronRight size={16} />
              </button>
              <button
                onClick={() => setCurrentPage(totalPages)}
                disabled={currentPage === totalPages}
                className="px-2 py-1.5 rounded-lg text-xs font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed" style={{ border: '1px solid rgba(255,255,255,0.09)', background: 'rgba(255,255,255,0.05)', color: 'rgba(148,163,184,0.7)' }}
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
