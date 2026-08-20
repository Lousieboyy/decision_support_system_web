import { useEffect, useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { fetchAllReports, getImageUrl, claimReport } from '../api/reportsApi';
import { useAuth } from '../context/AuthContext';
import { ReportDetailModal } from '../components/ReportDetailModal';
import { AUTHORITIES } from '../utils/authorities';
import { getReportPriority, priorityRank, PRIORITY_TONE } from '../utils/reportPriority';
import { format, formatDistanceToNowStrict, isWithinInterval, parseISO, startOfDay, endOfDay, subDays } from 'date-fns';
import jsPDF from 'jspdf';
import {
  Search, Filter, RefreshCw, Image as ImageIcon, MapPin,
  ChevronDown, ChevronUp, ChevronLeft, ChevronRight, Calendar, SlidersHorizontal, X, Building2, Download, FileText,
  Check, Loader2,
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
      {auth?.abbr || department.slice(0, 8)}
    </span>
  );
}

// A crew name (or team name when the whole team shares the pool) plus who,
// if anyone, has claimed it — the thing an authority actually needs to judge
// dispatch health, versus a department tag that's always their own dept.
function TeamCrewCell({ report }) {
  return (
    <div className="flex flex-col gap-1 items-start">
      <span className="text-xs font-semibold" style={{ color: '#201f1b' }}>
        {report.assigned_crew || report.assigned_team || '—'}
      </span>
      {report.assigned_worker ? (
        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full" style={{ color: '#3d4d34', background: 'rgba(74,93,63,0.10)', border: '1px solid rgba(74,93,63,0.20)' }}>
          {report.assigned_worker}
        </span>
      ) : report.in_pool ? (
        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full" style={{ color: '#b45309', background: 'rgba(180,83,9,0.10)', border: '1px solid rgba(180,83,9,0.25)' }}>
          Unclaimed
        </span>
      ) : null}
    </div>
  );
}

// Crew work is shared — start-maintenance and complete-task both accept any
// crew member, not just whoever claimed it first (see _require_crew_member
// in main.py). A worker's queue can now include a teammate's claimed job,
// so this makes it obvious at a glance whether a row is theirs or one
// they're free to jump in and help with.
function WorkerCell({ report, myUsername }) {
  if (!report.assigned_worker) {
    return (
      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full inline-block" style={{ color: '#b45309', background: 'rgba(180,83,9,0.10)', border: '1px solid rgba(180,83,9,0.25)' }}>
        Unclaimed
      </span>
    );
  }
  const isMine = report.assigned_worker === myUsername;
  return (
    <span
      className="text-[10px] font-bold px-1.5 py-0.5 rounded-full inline-block"
      style={isMine
        ? { color: '#3d4d34', background: 'rgba(74,93,63,0.10)', border: '1px solid rgba(74,93,63,0.20)' }
        : { color: '#4b473d', background: 'var(--cream-200)', border: '1px solid rgba(31,30,26,0.10)' }}
      title={isMine ? 'Your job' : `${report.assigned_worker}'s job — you're on the same crew, you can help`}
    >
      {isMine ? 'You' : report.assigned_worker}
    </span>
  );
}

// Relative age reads faster than a timestamp when the question is "has this
// been sitting too long" — the thing a worker or authority actually scans
// for. Tone escalates the same way a worker would triage by eye.
function reportAge(timestamp) {
  if (!timestamp) return { text: '-', tone: null, full: '' };
  const d = new Date(timestamp);
  if (isNaN(d.getTime())) return { text: String(timestamp), tone: null, full: '' };
  const days = (Date.now() - d.getTime()) / 86400000;
  return {
    text: formatDistanceToNowStrict(d, { addSuffix: true }),
    tone: days >= 5 ? 'high' : days >= 2 ? 'medium' : null,
    full: format(d, 'MMM d, yyyy HH:mm'),
  };
}

const PAGE_SIZE_OPTIONS = [10, 25, 50];

const DATE_PRESETS = [
  { label: 'All Time', value: 'all' },
  { label: 'Today', value: 'today' },
  { label: 'Last 7 days', value: '7d' },
  { label: 'Last 30 days', value: '30d' },
];

// "Open" groups everything still awaiting a decision or in progress — the
// list an admin or authority actually has to act on today. Resolved and
// Rejected tickets are history, not a queue, so they live behind the "All"
// tab instead of mixing into the default view.
const OPEN_STATUSES = ['Pending', 'In Review', 'In Process', 'In Maintenance'];
const STATUS_TABS = ['Open', 'Pending', 'In Review', 'In Process', 'In Maintenance', 'Resolved', 'Rejected', 'All'];

// Pending/Rejected are decisions an admin makes before a report ever reaches
// a worker or authority — showing those tabs to either role is dead weight,
// not oversight. Each role's tab list is just the statuses they can act on
// (see ReportDetailModal's role-based action panels) plus Resolved as their
// completed history.
const WORKER_TABS = ['In Process', 'In Maintenance', 'Resolved'];
const AUTHORITY_TABS = ['In Review', 'In Process', 'In Maintenance', 'Resolved'];

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

  const deptId = getDeptId(currentRole, user?.username);
  const isWorker = currentRole === 'worker' || currentRole?.startsWith('worker_');
  const isAuthority = currentRole === 'authority' || currentRole?.startsWith('authority_');
  // Drives which status tabs and table columns show — see WORKER_TABS/
  // AUTHORITY_TABS above for why each role only sees its own statuses.
  const viewMode = isWorker ? 'worker' : isAuthority ? 'authority' : 'admin';
  const visibleTabs = viewMode === 'worker' ? WORKER_TABS : viewMode === 'authority' ? AUTHORITY_TABS : STATUS_TABS;

  // Filters
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState(() => (viewMode === 'admin' ? 'Open' : visibleTabs[0]));
  const [datePreset, setDatePreset] = useState('all');
  const [minConfidence, setMinConfidence] = useState(0);
  const [showFilters, setShowFilters] = useState(false);
  const [myDeptOnly, setMyDeptOnly] = useState(true);

  // Compute status counts for the tabs
  const statusCounts = useMemo(() => {
    const counts = { All: 0, Open: 0, Pending: 0, 'In Review': 0, 'In Process': 0, 'In Maintenance': 0, Resolved: 0, Rejected: 0 };
    let visibleReports = reports;
    if (myDeptOnly && deptId) {
      visibleReports = reports.filter(r => reportMatchesDept(r, deptId));
    }
    visibleReports.forEach(r => {
      const s = r.status || 'Pending';
      counts.All++;
      if (counts[s] !== undefined) counts[s]++;
      if (OPEN_STATUSES.includes(s)) counts.Open++;
    });
    return counts;
  }, [reports, myDeptOnly, deptId]);

  // Selected report for modal
  const [selectedReport, setSelectedReport] = useState(null);

  // Sorting — a worker's default view leads with what's most critical, not
  // most recent; everyone else keeps the existing upvotes-first default.
  const [sortField, setSortField] = useState(isWorker ? 'priority' : 'upvotes');
  const [sortOrder, setSortOrder] = useState('desc');

  // Pagination
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const loadReports = async () => {
    try {
      setLoading(true);
      const data = await fetchAllReports(currentRole);
      setReports(Array.isArray(data) ? data : []);
      setError(null);
    } catch (err) {
      setError(err.message);
      setReports([]);
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

  // Accept a pool job right from the row — the list previously gave no way
  // to tell which "In Process" rows were actually unclaimed without opening
  // each one in the modal, even though the accept action itself already
  // existed there. Race-safe on the backend: if a teammate claims first,
  // this still succeeds and just reflects who actually got it.
  const [acceptingId, setAcceptingId] = useState(null);
  const [acceptError, setAcceptError] = useState(null);
  const handleAccept = async (report) => {
    setAcceptingId(report.id);
    setAcceptError(null);
    try {
      const updated = await claimReport(report.id);
      handleUpdate(report.id, updated);
    } catch (err) {
      setAcceptError({ id: report.id, message: err.message || 'Failed to accept task' });
    } finally {
      setAcceptingId(null);
    }
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
    datePreset !== 'all',
    minConfidence > 0,
    myDeptOnly,
  ].filter(Boolean).length;

  // Column visibility by role — the same "only what you'd act on" logic as
  // the status tabs above. Admin verifies (needs the photo + AI confidence),
  // authority dispatches (needs crew/claim status + citizen pressure),
  // worker executes (needs location + priority + the action button, nothing
  // it can't use). Worker still gets this column — crew work is shared, so
  // their queue can include a teammate's claimed job, and they need to tell
  // "mine" from "theirs, I can help" at a glance.
  const showImageCol = viewMode === 'admin';
  const showAiCol = viewMode === 'admin';
  const showAssignedCol = true;
  const showUpvotesCol = viewMode !== 'worker';
  const colCount = 6 // ID, Category, Location, Status, Priority, Reported At
    + (showImageCol ? 1 : 0)
    + (showAiCol ? 1 : 0)
    + (showAssignedCol ? 1 : 0)
    + (showUpvotesCol ? 1 : 0);

  const processedReports = useMemo(() => {
    let result = [...reports];

    // Status filter
    if (statusFilter === 'Open') {
      result = result.filter(r => OPEN_STATUSES.includes(r.status || 'Pending'));
    } else if (statusFilter !== 'All') {
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
      } else if (sortField === 'priority') {
        valA = priorityRank(getReportPriority(a.status, a.categories));
        valB = priorityRank(getReportPriority(b.status, b.categories));
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
    let cls = 'bg-stone-100 text-stone-600';
    if (status === 'Pending')        cls = 'bg-amber-500/10 border border-amber-500/25 text-amber-700';
    if (status === 'In Review')      cls = 'bg-blue-500/10 border border-blue-500/25 text-blue-700';
    if (status === 'In Process')     cls = 'bg-indigo-500/10 border border-indigo-500/25 text-indigo-700';
    if (status === 'In Maintenance') cls = 'bg-purple-500/10 border border-purple-500/25 text-purple-700';
    if (status === 'Resolved')       cls = 'bg-emerald-500/10 border border-emerald-500/25 text-emerald-700 font-extrabold';
    if (status === 'Rejected')       cls = 'bg-red-500/10 border border-red-500/25 text-red-700 line-through';
    return <span className={`px-2.5 py-1 text-xs font-bold rounded-lg ${cls}`}>{status || 'Pending'}</span>;
  };

  const SortIcon = ({ field }) => {
    if (sortField !== field) return <ChevronDown size={14} className="text-[#8a8477] opacity-0 group-hover:opacity-100" />;
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
          <h1 className="page-header-title">Report Queue</h1>
          <div className="page-header-sub mt-1">
            {deptId ? (
              <span className="flex items-center gap-2 flex-wrap">
                <span className="font-semibold text-[#3d4d34]">{user?.displayName}</span>
                <span className="text-[#8a8477]">|</span>
                <span>{AUTHORITIES.find(a => a.id === deptId)?.abbr || deptId.toUpperCase()} Department</span>
                <span className="text-[#8a8477]">|</span>
                <span>
                  {viewMode === 'worker'
                    ? 'Your active jobs and completed history.'
                    : 'Reports awaiting dispatch, plus what your teams are working.'}
                </span>
              </span>
            ) : (
              <span>Opens on what still needs a decision. Resolved and Rejected history lives under the Resolved / Rejected / All tabs.</span>
            )}
            {(currentRole === 'admin' || currentRole === 'authority' || currentRole?.startsWith('authority_')) && (
              <span className="ml-2">
                Looking for patterns across the city instead of a single ticket?{' '}
                <Link to="/" className="font-semibold" style={{ color: '#3d4d34' }}>See Analytics →</Link>
              </span>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {/* Search */}
          <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#8a8477]" />
            <input
              type="text"
              placeholder="Search ID, category, location..."
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              className="pl-9 pr-4 py-2 w-60 rounded-lg text-sm focus:ring-2 focus:ring-[#4a5d3f]/20" style={{ background: 'var(--cream-200)', border: '1px solid rgba(31,30,26,0.10)', color: '#201f1b' }}
            />
          </div>

          {/* Status filter dropdown removed in favor of status tab bar below */}

          {/* Advanced filters toggle */}
          <button
            onClick={() => setShowFilters(v => !v)}
            className={`relative flex items-center gap-2 px-3 py-2 rounded-lg border text-sm font-medium transition-colors
              ${showFilters
                ? 'bg-[#4a5d3f] border-[#4a5d3f] text-white'
                : 'bg-white border-[#1f1e1a]/10 text-[#4b473d] hover:bg-[#4a5d3f]/5'}`}
          >
            <SlidersHorizontal size={16} />
            Filters
            {activeFilterCount > 0 && (
              <span className="absolute -top-1.5 -right-1.5 w-4 h-4 bg-[#d97757] text-white text-[10px] font-bold rounded-full flex items-center justify-center">
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
                  ? 'bg-[#4a5d3f] border-[#4a5d3f] text-white shadow-md shadow-[#4a5d3f]/10'
                  : 'bg-white border-[#1f1e1a]/10 text-[#4b473d] hover:bg-[#4a5d3f]/5'
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
            className="p-2.5 rounded-lg border transition-colors" style={{ background: 'var(--cream-200)', border: '1px solid rgba(31,30,26,0.10)', color: '#8a8477' }}
            title="Refresh"
          >
            <RefreshCw size={18} className={loading ? 'animate-spin text-[#8a8477]' : ''} />
          </button>
        </div>
      </div>

      {/* Advanced Filters Panel */}
      {showFilters && (
        <div className="mb-6 p-5 rounded-2xl flex flex-wrap gap-6 items-end" style={{ background: '#ffffff', border: '1px solid rgba(31,30,26,0.08)', boxShadow: '0 8px 32px rgba(31,30,26,0.06)' }}>
          {/* Date Range Preset */}
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider mb-2 flex items-center gap-1" style={{ color: '#8a8477' }}>
              <Calendar size={12} /> Date Range
            </label>
            <div className="flex gap-2">
              {DATE_PRESETS.map(p => (
                <button
                  key={p.value}
                  onClick={() => setDatePreset(p.value)}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors
                    ${datePreset === p.value
                      ? 'bg-[#4a5d3f] text-white border-[#4a5d3f]'
                      : 'bg-white text-[#4b473d] border-[#1f1e1a]/10 hover:border-[#4a5d3f]/30'}`}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          {/* Min Confidence — only admin sees the AI Prediction column this filters */}
          {viewMode === 'admin' && (
            <div className="min-w-[220px]">
              <label className="block text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: '#8a8477' }}>
                Min AI Confidence: <span style={{ color: '#4b473d' }}>{minConfidence}%</span>
              </label>
              <input
                type="range"
                min={0}
                max={100}
                step={5}
                value={minConfidence}
                onChange={e => setMinConfidence(Number(e.target.value))}
                className="w-full accent-[#4a5d3f]"
              />
              <div className="flex justify-between text-xs text-[#8a8477] mt-1">
                <span>0%</span><span>50%</span><span>100%</span>
              </div>
            </div>
          )}

          {/* Reset */}
          {activeFilterCount > 0 && (
            <button
              onClick={() => { setDatePreset('all'); setMinConfidence(0); }}
              className="flex items-center gap-1 px-3 py-2 rounded-lg text-sm font-medium border transition-colors" style={{ color: '#201f1b', borderColor: 'rgba(31,30,26,0.15)', background: 'var(--cream-200)' }}
            >
              <X size={14} /> Reset Filters
            </button>
          )}
        </div>
      )}

      {/* Status Tabs Bar & Sort Selector */}
      <div className="mb-6 flex flex-wrap items-center justify-between border-b pb-4 gap-4" style={{ borderColor: 'rgba(31,30,26,0.08)' }}>
        <div className="flex flex-wrap gap-2">
          {visibleTabs.map(tab => {
            const isActive = statusFilter === tab;
            const count = statusCounts[tab];
            return (
              <button
                key={tab}
                onClick={() => setStatusFilter(tab)}
                className={`px-4 py-2 text-xs font-bold rounded-lg border transition-all duration-150 flex items-center gap-2 cursor-pointer
                  ${isActive
                    ? 'bg-[#4a5d3f] text-white border-[#4a5d3f] shadow-lg shadow-[#4a5d3f]/10 font-extrabold'
                    : 'bg-white border-[#1f1e1a]/8 text-[#8a8477] hover:text-[#4b473d] hover:border-[#1f1e1a]/15'}`}
              >
                <span>{tab}</span>
                <span className={`px-1.5 py-0.5 text-[9px] rounded font-extrabold ${isActive ? 'bg-white/20 text-white' : 'bg-[#1f1e1a]/8 text-[#8a8477]'}`}>
                  {count}
                </span>
              </button>
            );
          })}
        </div>

        {/* Quick Sort Selector */}
        <div className="flex items-center gap-2">
          <span className="text-xs text-[#8a8477] font-semibold uppercase tracking-wider">Sort By:</span>
          <div className="bg-white border border-[#1f1e1a]/8 p-0.5 rounded-lg flex">
            <button
              onClick={() => { setSortField('priority'); setSortOrder('desc'); }}
              className={`px-3 py-1.5 rounded-md text-[11px] font-bold transition-all cursor-pointer ${
                sortField === 'priority'
                  ? 'bg-[#4a5d3f] text-white font-extrabold shadow-sm'
                  : 'text-[#8a8477] hover:text-[#4b473d]'
              }`}
            >
              Priority
            </button>
            <button
              onClick={() => { setSortField('timestamp'); setSortOrder('desc'); }}
              className={`px-3 py-1.5 rounded-md text-[11px] font-bold transition-all cursor-pointer ${
                sortField === 'timestamp'
                  ? 'bg-[#4a5d3f] text-white font-extrabold shadow-sm'
                  : 'text-[#8a8477] hover:text-[#4b473d]'
              }`}
            >
              Date (Newest)
            </button>
            {/* A worker executes what's already been dispatched — community upvote
                pressure was already weighed by the admin/authority who routed it
                here, so sorting by it again adds noise, not value. */}
            {viewMode !== 'worker' && (
              <button
                onClick={() => { setSortField('upvotes'); setSortOrder('desc'); }}
                className={`px-3 py-1.5 rounded-md text-[11px] font-bold transition-all cursor-pointer ${
                  sortField === 'upvotes'
                    ? 'bg-[#4a5d3f] text-white font-extrabold shadow-sm'
                    : 'text-[#8a8477] hover:text-[#4b473d]'
                }`}
              >
                Upvotes (Criticality)
              </button>
            )}
          </div>
        </div>
      </div>

      {error ? (
        <div className="rounded-xl p-4 border flex items-center" style={{ background: '#ffffff', borderColor: 'rgba(31,30,26,0.08)', color: '#201f1b' }}>
          Failed to load reports: {error}
        </div>
      ) : (
        <div className="rounded-2xl overflow-hidden" style={{ background: '#ffffff', border: '1px solid rgba(31,30,26,0.08)', boxShadow: '0 8px 32px rgba(31,30,26,0.06)' }}>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm whitespace-nowrap">
              <thead className="text-xs font-bold tracking-wider uppercase" style={{ background: 'var(--cream-200)', borderBottom: '1px solid rgba(31,30,26,0.07)', color: '#8a8477' }}>
                <tr>
                  <th className="px-6 py-4 cursor-pointer group transition-colors" onClick={() => toggleSort('id')}>
                    <div className="flex items-center gap-1">ID <SortIcon field="id" /></div>
                  </th>
                  {showImageCol && <th className="px-6 py-4">Image</th>}
                  <th className="px-6 py-4 cursor-pointer group" onClick={() => toggleSort('categories')}>
                    <div className="flex items-center gap-1">Category <SortIcon field="categories" /></div>
                  </th>
                  <th className="px-6 py-4">Location</th>
                  {showAiCol && (
                    <th className="px-6 py-4 cursor-pointer group" onClick={() => toggleSort('ai_prediction')}>
                      <div className="flex items-center gap-1">AI Prediction <SortIcon field="ai_prediction" /></div>
                    </th>
                  )}
                  {showAssignedCol && (
                    <th className="px-6 py-4">
                      {viewMode === 'authority' ? 'Team & Crew' : viewMode === 'worker' ? 'Worker' : 'Assigned To'}
                    </th>
                  )}
                  <th className="px-6 py-4 cursor-pointer group" onClick={() => toggleSort('status')}>
                    <div className="flex items-center gap-1">Status <SortIcon field="status" /></div>
                  </th>
                  <th className="px-6 py-4 cursor-pointer group" onClick={() => toggleSort('priority')}>
                    <div className="flex items-center gap-1">Priority <SortIcon field="priority" /></div>
                  </th>
                  {showUpvotesCol && (
                    <th className="px-6 py-4 cursor-pointer group" onClick={() => toggleSort('upvotes')}>
                      <div className="flex items-center gap-1">Upvotes <SortIcon field="upvotes" /></div>
                    </th>
                  )}
                  <th className="px-6 py-4 cursor-pointer group" onClick={() => toggleSort('timestamp')}>
                    <div className="flex items-center gap-1">Reported <SortIcon field="timestamp" /></div>
                  </th>
                </tr>
              </thead>
              <tbody style={{ borderColor: 'rgba(31,30,26,0.06)' }} className="divide-y">
                {loading && reports.length === 0 ? (
                  <tr>
                    <td colSpan={colCount} className="px-6 py-12 text-center" style={{ color: '#8a8477' }}>
                      <div className="flex flex-col items-center justify-center">
                        <div className="w-8 h-8 border-4 border-[#1f1e1a]/10 border-t-[#4a5d3f] rounded-full animate-spin mb-4" />
                        Loading reports...
                      </div>
                    </td>
                  </tr>
                ) : paginatedReports.length === 0 ? (
                  <tr>
                    <td colSpan={colCount} className="px-6 py-12 text-center font-medium" style={{ color: '#8a8477' }}>
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
                        isMyDept ? 'hover:bg-[#4a5d3f]/8' : 'hover:bg-[#4a5d3f]/5'
                      }`}
                    >
                      <td className="px-6 py-4 font-mono" style={{ color: '#8a8477' }}>#{report.id}</td>
                      {showImageCol && (
                        <td className="px-6 py-4">
                          {report.image_path ? (
                            <div className="w-10 h-10 rounded-lg overflow-hidden" style={{ border: '1px solid rgba(31,30,26,0.10)' }}>
                              <img
                                src={getImageUrl(report.image_path)}
                                alt="thumbnail"
                                className="w-full h-full object-cover"
                                onError={e => e.target.style.display = 'none'}
                              />
                            </div>
                          ) : (
                            <div className="w-10 h-10 rounded-lg flex items-center justify-center" style={{ background: 'var(--cream-200)', border: '1px solid rgba(31,30,26,0.10)' }}>
                              <ImageIcon size={16} style={{ color: '#8a8477' }} />
                            </div>
                          )}
                        </td>
                      )}
                      <td className="px-6 py-4">
                        <p className="font-bold" style={{ color: '#201f1b' }}>{report.categories || '-'}</p>
                        {viewMode === 'admin' && isMyDept && deptId && (
                          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full mt-1 inline-block" style={{ color: '#3d4d34', background: 'rgba(74,93,63,0.10)', border: '1px solid rgba(74,93,63,0.20)' }}>
                            YOUR DEPT
                          </span>
                        )}
                      </td>
                      <td className="px-6 py-4 text-stone-600 max-w-[180px] truncate">
                        <div className="flex items-center gap-1.5">
                          <MapPin size={14} style={{ color: '#8a8477' }} className="shrink-0" />
                          <span className="truncate" style={{ color: '#4b473d' }}>{report.address || 'Unknown'}</span>
                        </div>
                      </td>
                      {showAiCol && (
                        <td className="px-6 py-4">
                          {report.ai_prediction ? (
                            <div>
                              <p className="font-semibold" style={{ color: '#201f1b' }}>{report.ai_prediction}</p>
                              <div className="flex items-center gap-2 mt-1">
                                <div className="w-16 h-1.5 rounded-full overflow-hidden" style={{ background: 'rgba(31,30,26,0.08)' }}>
                                  <div className="h-full bg-[#4a5d3f] rounded-full" style={{ width: report.confidence || '0%' }} />
                                </div>
                                <span className="text-xs" style={{ color: '#8a8477' }}>{report.confidence}</span>
                              </div>
                            </div>
                          ) : <span className="text-[#8a8477]">-</span>}
                        </td>
                      )}
                      {showAssignedCol && (
                        <td className="px-6 py-4">
                          {viewMode === 'authority'
                            ? <TeamCrewCell report={report} />
                            : viewMode === 'worker'
                              ? <WorkerCell report={report} myUsername={user?.username} />
                              : <DeptTag department={report.assigned_department} />}
                        </td>
                      )}
                      <td className="px-6 py-4">
                        <StatusBadge status={report.status} />
                        {isWorker && report.in_pool && (
                          <div className="mt-1.5 flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                            <button
                              onClick={() => handleAccept(report)}
                              disabled={acceptingId === report.id}
                              className="flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-bold disabled:opacity-50"
                              style={{ background: '#3d4d34', color: '#fff' }}
                              title="Nobody has claimed this yet — accept it to make it yours"
                            >
                              {acceptingId === report.id
                                ? <Loader2 size={10} className="animate-spin" />
                                : <Check size={10} />}
                              Accept
                            </button>
                            {acceptError?.id === report.id && (
                              <span className="text-[9px] text-red-700">{acceptError.message}</span>
                            )}
                          </div>
                        )}
                      </td>
                      <td className="px-6 py-4">
                        {(() => {
                          const p = getReportPriority(report.status, report.categories);
                          const tone = PRIORITY_TONE[p] || PRIORITY_TONE.Medium;
                          return (
                            <span
                              className="px-2 py-0.5 text-xs font-bold rounded-lg border"
                              style={{ color: tone.color, background: tone.bg, borderColor: tone.border }}
                            >
                              {p}
                            </span>
                          );
                        })()}
                      </td>
                      {showUpvotesCol && (
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-1.5 font-bold">
                            <span className={report.upvotes > 0 ? "text-amber-600" : "text-[#8a8477]"}>
                              {report.upvotes || 0}
                            </span>
                          </div>
                        </td>
                      )}
                      <td className="px-6 py-4 text-sm" style={{ color: '#8a8477' }}>
                        {viewMode === 'admin' ? (
                          (() => {
                            if (!report.timestamp) return '-';
                            const d = new Date(report.timestamp);
                            if (isNaN(d.getTime())) return String(report.timestamp);
                            return format(d, 'MMM d, yyyy HH:mm');
                          })()
                        ) : (() => {
                          const age = reportAge(report.timestamp);
                          return (
                            <span
                              title={age.full}
                              className={age.tone === 'high' ? 'text-red-700 font-bold' : age.tone === 'medium' ? 'text-amber-700 font-semibold' : ''}
                            >
                              {age.text}
                            </span>
                          );
                        })()}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Pagination Footer */}
          <div className="px-6 py-4 flex flex-wrap items-center justify-between gap-4" style={{ borderTop: '1px solid rgba(31,30,26,0.07)', background: 'var(--cream-100)' }}>
            <div className="flex items-center gap-3 text-xs font-medium" style={{ color: '#8a8477' }}>
              <span>
                Showing{' '}
                <span className="font-bold" style={{ color: '#201f1b' }}>
                  {processedReports.length === 0 ? 0 : (currentPage - 1) * pageSize + 1}–{Math.min(currentPage * pageSize, processedReports.length)}
                </span>{' '}
                of <span className="font-bold" style={{ color: '#201f1b' }}>{processedReports.length}</span> results
                {processedReports.length !== reports.length && (
                  <span className="ml-1 text-[#8a8477]">({reports.length} total city-wide)</span>
                )}
              </span>

              <select
                value={pageSize}
                onChange={e => { setPageSize(Number(e.target.value)); setCurrentPage(1); }}
                className="ml-2 rounded-lg px-2 py-1 text-xs font-medium focus:ring-2 focus:ring-[#4a5d3f]/20 cursor-pointer" style={{ background: 'var(--cream-200)', border: '1px solid rgba(31,30,26,0.10)', color: '#201f1b' }}
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
                className="px-2 py-1.5 rounded-lg text-xs font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed" style={{ border: '1px solid rgba(31,30,26,0.09)', background: '#ffffff', color: '#8a8477' }}
              >
                «
              </button>
              <button
                onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                disabled={currentPage === 1}
                className="p-1.5 rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed" style={{ border: '1px solid rgba(31,30,26,0.09)', background: '#ffffff', color: '#8a8477' }}
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
                        ? 'bg-[#4a5d3f] text-white border-[#4a5d3f] shadow-sm'
                        : 'bg-white text-[#4b473d] border-[#1f1e1a]/10 hover:bg-[#4a5d3f]/5'}`}
                  >
                    {page}
                  </button>
                );
              })}

              <button
                onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                disabled={currentPage === totalPages}
                className="p-1.5 rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed" style={{ border: '1px solid rgba(31,30,26,0.09)', background: '#ffffff', color: '#8a8477' }}
              >
                <ChevronRight size={16} />
              </button>
              <button
                onClick={() => setCurrentPage(totalPages)}
                disabled={currentPage === totalPages}
                className="px-2 py-1.5 rounded-lg text-xs font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed" style={{ border: '1px solid rgba(31,30,26,0.09)', background: '#ffffff', color: '#8a8477' }}
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
