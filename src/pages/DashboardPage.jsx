import { useEffect, useState, useMemo } from 'react';
import { fetchStats, fetchTimeline, fetchReports } from '../api/reportsApi';
import {
  PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend,
  AreaChart, Area, XAxis, YAxis, CartesianGrid,
  BarChart, Bar, LabelList,
} from 'recharts';
import { RefreshCw, MapPin, CheckCircle2, Clock, AlertTriangle, TrendingUp, Building2, Activity, Download, AlertCircle } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { useAuth } from '../context/AuthContext';
import { AUTHORITIES } from '../utils/authorities';

const COLORS = ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#0ea5e9'];

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

function DeptTag({ department }) {
  if (!department) return null;
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

function StatCard({ title, value, icon, iconColor, bgColor, borderColor, subtitle }) {
  return (
    <div className="bg-white/5 backdrop-blur-xl border border-white/8 rounded-2xl p-5 flex items-center gap-4 hover:border-white/20 transition-all duration-300">
      <div className={`p-3.5 rounded-xl border ${bgColor} ${iconColor} ${borderColor} flex items-center justify-center shrink-0`}>
        {icon}
      </div>
      <div className="min-w-0 flex-1 text-left">
        <div className="text-xs font-bold text-slate-400 uppercase tracking-wider truncate">{title}</div>
        <div className="text-2xl font-black text-slate-100 mt-1">{value ?? '-'}</div>
        {subtitle && <div className="text-[10px] text-slate-400 font-medium mt-0.5 truncate">{subtitle}</div>}
      </div>
    </div>
  );
}

export function DashboardPage() {
  const { role, user } = useAuth();
  const [stats, setStats] = useState(null);
  const [timeline, setTimeline] = useState([]);
  const [recentReports, setRecentReports] = useState([]);
  const [loading, setLoading] = useState(true);
  const [slaMetrics, setSlaMetrics] = useState({ avgDays: 0, bottlenecks: 0 });
  const [error, setError] = useState(null);
  const [lastRefreshed, setLastRefreshed] = useState(null);

  const deptId = getDeptId(role, user?.username);

  const loadAll = async () => {
    try {
      setLoading(true);
      const [statsData, timelineData, reportsData] = await Promise.all([
        fetchStats(),
        fetchTimeline(),
        fetchReports('admin'),
      ]);
      
      let finalStats = statsData;
      let finalTimeline = timelineData;
      let finalReports = reportsData;

      if (role !== 'admin' && deptId) {
        finalReports = reportsData.filter(r => reportMatchesDept(r, deptId));
        
        finalStats = {
          total: finalReports.length,
          pending: finalReports.filter(r => r.status === 'Pending').length,
          in_review: finalReports.filter(r => r.status === 'In Review').length,
          in_process: finalReports.filter(r => r.status === 'In Process').length,
          in_maintenance: finalReports.filter(r => r.status === 'In Maintenance').length,
          resolved: finalReports.filter(r => r.status === 'Resolved').length,
          rejected: finalReports.filter(r => r.status === 'Rejected').length,
          categories: finalReports.reduce((acc, r) => {
             const cat = r.categories || 'Unknown';
             acc[cat] = (acc[cat] || 0) + 1;
             return acc;
          }, {})
        };
        
        const tMap = {};
        finalReports.forEach(r => {
           if (!r.timestamp) return;
           const d = r.timestamp.split('T')[0];
           tMap[d] = (tMap[d] || 0) + 1;
        });
        finalTimeline = Object.entries(tMap).map(([date, count]) => ({ date, count })).sort((a,b) => a.date.localeCompare(b.date));
      }
      
      setStats(finalStats);
      setTimeline(finalTimeline);
      const sorted = [...finalReports].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp)).slice(0, 20);
      setRecentReports(sorted);
      
      const resolvedReports = finalReports.filter(r => r.status === 'Resolved' && r.resolved_at && r.timestamp);
      let totalHours = 0;
      resolvedReports.forEach(r => {
        const start = new Date(r.timestamp);
        const end = new Date(r.resolved_at);
        if (!isNaN(start) && !isNaN(end)) totalHours += (end - start) / (1000 * 60 * 60);
      });
      const avgDays = resolvedReports.length ? (totalHours / resolvedReports.length / 24).toFixed(1) : 0;

      const threeDaysAgo = new Date();
      threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);
      const bottlenecks = finalReports.filter(r => r.status !== 'Resolved' && new Date(r.timestamp) < threeDaysAgo).length;

      setSlaMetrics({ avgDays, bottlenecks });
      setError(null);
      setLastRefreshed(new Date());
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAll();
    const interval = setInterval(loadAll, 30000);
    return () => clearInterval(interval);
  }, []);

  const chartData = useMemo(() => {
    if (!stats || !stats.categories) return [];
    return Object.entries(stats.categories).map(([name, value]) => ({ name, value }));
  }, [stats]);

  const timelineChartData = useMemo(() => {
    return timeline.map(d => ({
      date: (() => { try { return format(parseISO(d.date), 'MMM d'); } catch { return d.date; } })(),
      count: d.count,
    }));
  }, [timeline]);

  // Department performance chart data
  const deptPerformanceData = useMemo(() => {
    if (!recentReports.length) return [];
    const map = {};
    AUTHORITIES.forEach(a => { map[a.id] = { name: a.abbr, assigned: 0, resolved: 0 }; });
    recentReports.forEach(r => {
      const dept = AUTHORITIES.find(a =>
        (r.assigned_department || '').toLowerCase().includes(a.abbr.toLowerCase()) ||
        (r.assigned_department || '').toLowerCase().includes(a.id.toLowerCase())
      );
      if (dept) {
        map[dept.id].assigned++;
        if (r.status === 'Resolved') map[dept.id].resolved++;
      }
    });
    return Object.values(map).filter(d => d.assigned > 0).sort((a, b) => b.assigned - a.assigned).slice(0, 7);
  }, [recentReports]);

  const resolutionRate = stats ? Math.round((stats.resolved / (stats.total || 1)) * 100) : 0;
  const myReports = useMemo(() => {
    if (!deptId) return recentReports;
    return recentReports.filter(r => reportMatchesDept(r, deptId));
  }, [recentReports, deptId]);


  if (error) {
    return (
      <div className="p-8">
        <div className="p-4 rounded-xl flex items-center gap-3 border" style={{ background: 'rgba(255,255,255,0.03)', borderColor: 'rgba(255,255,255,0.08)', color: '#e2e8f0' }}>
          <AlertTriangle size={20} className="text-zinc-400" />
          <div><h3 className="font-bold">Failed to load statistics</h3><p className="text-sm" style={{ color: 'rgba(148,163,184,0.7)' }}>{error}</p></div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-8 pb-20">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="page-header-title">Overview Dashboard</h1>
          <div className="page-header-sub mt-1">
            {deptId ? (
              <span className="flex items-center gap-2">
                <span className="font-semibold text-slate-200">{user?.displayName}</span>
                <span className="text-slate-300">|</span>
                <span>{AUTHORITIES.find(a => a.id === deptId)?.abbr || deptId.toUpperCase()} Department</span>
                {lastRefreshed && <span className="ml-2 text-xs text-slate-400">· Last updated: {format(lastRefreshed, 'HH:mm:ss')}</span>}
              </span>
            ) : (
              <span>
                Real-time statistics for city issue reports
                {lastRefreshed && <span className="ml-2 text-xs text-slate-400">· Last updated: {format(lastRefreshed, 'HH:mm:ss')}</span>}
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-3">

          <button
            onClick={loadAll}
            disabled={loading}
            className="flex items-center gap-2 px-4 py-2 rounded-lg border text-sm font-semibold transition-colors disabled:opacity-50" style={{ background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.10)', color: 'rgba(203,213,225,0.85)' }}
          >
            <RefreshCw size={15} className={loading ? 'animate-spin text-slate-400' : ''} />
            Refresh
          </button>
        </div>
      </div>

      <div id="dashboard-content">

      {!stats && loading ? (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
            {[...Array(4)].map((_, i) => <div key={i} className="rounded-2xl border border-white/8 animate-pulse h-[100px]" style={{ background: 'rgba(255,255,255,0.05)' }} />)}
          </div>
        </div>
      ) : stats ? (
        <>
          {/* SLA Alerts */}
          {(slaMetrics.bottlenecks > 0 || slaMetrics.avgDays > 0) && (
            <div className="flex flex-col md:flex-row gap-5 mb-6">
              <div className="flex-1 rounded-2xl p-5 flex items-center gap-4" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}>
                <div className="p-3 rounded-full" style={{ background: 'rgba(255,255,255,0.05)', color: '#f1f5f9' }}>
                  <AlertCircle size={28} />
                </div>
                <div>
                  <h3 className="text-sm font-bold uppercase tracking-wider mb-0.5" style={{ color: '#f1f5f9' }}>Bottleneck Alert</h3>
                  <p className="text-sm font-medium" style={{ color: '#94a3b8' }}>{slaMetrics.bottlenecks} report(s) have been stuck for over 3 days.</p>
                </div>
              </div>
              <div className="flex-1 rounded-2xl p-5 flex items-center gap-4" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}>
                <div className="p-3 rounded-full" style={{ background: 'rgba(255,255,255,0.05)', color: '#f1f5f9' }}>
                  <Clock size={28} />
                </div>
                <div>
                  <h3 className="text-sm font-bold uppercase tracking-wider mb-0.5" style={{ color: '#f1f5f9' }}>SLA Performance</h3>
                  <p className="text-sm font-medium" style={{ color: '#94a3b8' }}>Average resolution time is {slaMetrics.avgDays} days.</p>
                </div>
              </div>
            </div>
          )}

          {/* Stat Cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5 mb-6">
            <StatCard
              title="Total Reports"
              value={stats.total}
              icon={<MapPin size={22} />}
              iconColor="text-zinc-300"
              bgColor="bg-zinc-800/10"
              borderColor="border-zinc-800/20"
              subtitle="All-time submissions"
            />
            <StatCard
              title="Pending"
              value={stats.pending}
              icon={<AlertTriangle size={22} />}
              iconColor="text-amber-400"
              bgColor="bg-amber-500/10"
              borderColor="border-amber-500/20"
              subtitle="Awaiting admin review"
            />
            <StatCard
              title="Active Work"
              value={(stats.in_review || 0) + (stats.in_process || 0) + (stats.in_maintenance || 0)}
              icon={<Activity size={22} />}
              iconColor="text-blue-400"
              bgColor="bg-blue-500/10"
              borderColor="border-blue-500/20"
              subtitle="In review / process / maint."
            />
            <StatCard
              title="Resolved"
              value={stats.resolved}
              icon={<CheckCircle2 size={22} />}
              iconColor="text-emerald-400"
              bgColor="bg-emerald-500/10"
              borderColor="border-emerald-500/20"
              subtitle={`${resolutionRate}% resolution rate`}
            />
          </div>

          {/* Charts Row */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 mb-5">
            {/* Timeline */}
            <div className="content-card lg:col-span-2">
              <div className="content-card-header">
                <div className="content-card-title">Reports Over Time</div>
              </div>
              <div className="p-5">
                <div className="h-[240px]">
                  {timelineChartData.length > 0 ? (
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={timelineChartData} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
                        <defs>
                          <linearGradient id="colorCount" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#6366f1" stopOpacity={0.25} />
                            <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(255,255,255,0.06)" />
                        <XAxis dataKey="date" axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: '#cbd5e1' }} interval="preserveStartEnd" />
                        <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: '#cbd5e1' }} allowDecimals={false} />
                        <Tooltip contentStyle={{ borderRadius: '12px', border: '1px solid rgba(255,255,255,0.10)', background: 'rgba(10,10,10,0.95)', color: '#e2e8f0', fontSize: '13px', backdropFilter: 'blur(16px)' }} itemStyle={{ color: '#e2e8f0' }} labelStyle={{ color: '#94a3b8' }} formatter={(val) => [`${val} report${val !== 1 ? 's' : ''}`, 'Count']} />
                        <Area type="monotone" dataKey="count" stroke="#6366f1" strokeWidth={2.5} fill="url(#colorCount)" dot={{ r: 3, fill: '#6366f1', strokeWidth: 0 }} activeDot={{ r: 5, fill: '#6366f1', stroke: '#ffffff', strokeWidth: 2 }} />
                      </AreaChart>
                    </ResponsiveContainer>
                  ) : (
                    <div className="flex h-full items-center justify-center text-slate-400 text-sm">Not enough data yet.</div>
                  )}
                </div>
              </div>
            </div>

            {/* Donut */}
            <div className="content-card">
              <div className="content-card-header">
                <div className="content-card-title">By Category</div>
              </div>
              <div className="p-5">
                <div className="h-[240px]">
                  {chartData.length > 0 ? (
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie data={chartData} cx="50%" cy="45%" innerRadius={55} outerRadius={88} paddingAngle={4} dataKey="value">
                          {chartData.map((_, index) => <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />)}
                        </Pie>
                        <Tooltip contentStyle={{ borderRadius: '12px', border: '1px solid rgba(255,255,255,0.10)', background: 'rgba(10,10,10,0.95)', color: '#e2e8f0', backdropFilter: 'blur(16px)' }} itemStyle={{ color: '#e2e8f0' }} labelStyle={{ color: '#94a3b8' }} />
                        <Legend verticalAlign="bottom" height={36} iconType="circle" iconSize={8} formatter={(value) => <span style={{ fontSize: 11, color: '#ffffff', fontWeight: 500 }}>{value}</span>} />
                      </PieChart>
                    </ResponsiveContainer>
                  ) : (
                    <div className="flex h-full items-center justify-center text-slate-400 text-sm">No category data.</div>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Status Breakdown */}
          <div className="content-card mb-5">
            <div className="content-card-header">
              <div className="content-card-title">Status Breakdown</div>
            </div>
            <div className="p-5 space-y-3">
              {[
                { label: 'Pending',      value: stats.pending || 0,       color: '#f59e0b', bg: 'rgba(245,158,11,0.12)', text: '#fbbf24' },
                { label: 'In Review',    value: stats.in_review || 0,     color: '#3b82f6', bg: 'rgba(59,130,246,0.12)', text: '#60a5fa' },
                { label: 'In Process',   value: stats.in_process || 0,    color: '#6366f1', bg: 'rgba(99,102,241,0.12)', text: '#818cf8' },
                { label: 'In Maint.',    value: stats.in_maintenance || 0,color: '#a855f7', bg: 'rgba(168,85,247,0.12)', text: '#c084fc' },
                { label: 'Resolved',     value: stats.resolved || 0,      color: '#10b981', bg: 'rgba(16,185,129,0.12)', text: '#34d399' },
                { label: 'Rejected',     value: stats.rejected || 0,      color: '#ef4444', bg: 'rgba(239,68,68,0.12)', text: '#f87171' },
              ].map(({ label, value, color, bg, text }) => {
                const pct = stats.total ? Math.round((value / stats.total) * 100) : 0;
                return (
                  <div key={label} className="flex items-center gap-4 text-left">
                    <span className="w-24 text-xs font-bold" style={{ color: text }}>{label}</span>
                    <div className="flex-1 h-2 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.07)' }}>
                      <div className="h-full rounded-full transition-all duration-700" style={{ width: `${pct}%`, background: color }} />
                    </div>
                    <span className="w-16 text-right text-xs font-semibold px-2 py-0.5 rounded-full" style={{ background: bg, color: text }}>
                      {value} ({pct}%)
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Department Performance Chart — Admin only */}
          {role === 'admin' && deptPerformanceData.length > 0 && (
            <div className="content-card mb-5">
              <div className="content-card-header">
                <div className="content-card-title">Department Performance</div>
                <span className="text-xs text-slate-400 font-medium">Based on recent 20 reports</span>
              </div>
              <div className="p-5">
                <div className="h-[200px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={deptPerformanceData} layout="vertical" margin={{ top: 0, right: 50, left: 0, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="rgba(255,255,255,0.06)" />
                      <XAxis type="number" axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: '#cbd5e1' }} allowDecimals={false} />
                      <YAxis dataKey="name" type="category" axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: '#ffffff', fontWeight: 600 }} width={45} />
                      <Tooltip contentStyle={{ borderRadius: '12px', border: '1px solid rgba(255,255,255,0.10)', background: 'rgba(10,10,10,0.95)', color: '#e2e8f0', backdropFilter: 'blur(16px)' }} itemStyle={{ color: '#e2e8f0' }} labelStyle={{ color: '#94a3b8' }} />
                      <Bar dataKey="assigned" name="Assigned" fill="#6366f1" radius={[0, 4, 4, 0]} barSize={12}>
                        <LabelList dataKey="assigned" position="right" style={{ fontSize: 11, fill: '#818cf8', fontWeight: 700 }} />
                      </Bar>
                      <Bar dataKey="resolved" name="Resolved" fill="#10b981" radius={[0, 4, 4, 0]} barSize={12}>
                        <LabelList dataKey="resolved" position="right" style={{ fontSize: 11, fill: '#34d399', fontWeight: 700 }} />
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <div className="flex items-center gap-4 mt-3 text-xs text-slate-350">
                  <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm inline-block" style={{ background: '#6366f1' }} /> Assigned</span>
                  <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm inline-block" style={{ background: '#10b981' }} /> Resolved</span>
                </div>
              </div>
            </div>
          )}

          {/* Recent Reports */}
          <div className="content-card">
            <div className="content-card-header">
              <div className="content-card-title">Recent Reports</div>
              <span className="text-xs text-slate-400 font-medium">Showing 20 most recent reports · Tags show assigned dept.</span>
            </div>
            {recentReports.length === 0 ? (
              <div className="flex items-center justify-center py-12 text-sm" style={{ color: 'rgba(148,163,184,0.5)' }}>No reports found.</div>
            ) : (
              <div className="divide-y" style={{ borderColor: 'rgba(255,255,255,0.05)' }}>
                {recentReports.map(report => {
                  const isMyDept = deptId ? reportMatchesDept(report, deptId) : false;
                  const statusStyles = {
                    'Pending':        'bg-amber-500/15 border border-amber-500/30 text-amber-300',
                    'In Review':      'bg-blue-500/15 border border-blue-500/30 text-blue-300',
                    'In Process':     'bg-indigo-500/15 border border-indigo-500/30 text-indigo-300',
                    'In Maintenance': 'bg-purple-500/15 border border-purple-500/30 text-purple-300',
                    'Resolved':       'bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 font-extrabold',
                    'Rejected':       'bg-red-500/15 border border-red-500/30 text-red-400 line-through',
                  };
                  const statusCls = statusStyles[report.status] || 'bg-slate-100 text-slate-700';
                  return (
                    <div
                      key={report.id}
                      className={`flex items-center gap-4 px-5 py-3 transition-colors ${
                        isMyDept ? 'hover:bg-white/5' : 'hover:bg-white/5'
                      }`}
                    >
                      <span className="text-xs font-mono w-12 shrink-0" style={{ color: 'rgba(148,163,184,0.5)' }}>#{report.id}</span>
                      <span className="text-sm font-semibold flex-1 truncate" style={{ color: '#e2e8f0' }}>{report.categories || 'Uncategorized'}</span>
                      <span className="text-xs truncate max-w-[160px] hidden md:block" style={{ color: 'rgba(148,163,184,0.65)' }}>{report.address || 'Unknown'}</span>
                      {report.assigned_department && <DeptTag department={report.assigned_department} />}
                      {isMyDept && deptId && (
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0" style={{ color: '#a5b4fc', background: 'rgba(79,70,229,0.18)', border: '1px solid rgba(79,70,229,0.3)' }}>YOUR DEPT</span>
                      )}
                      <span className={`px-2.5 py-0.5 text-xs font-bold rounded-lg shrink-0 ${statusCls}`}>{report.status || 'Pending'}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </>
      ) : null}
      </div>
    </div>
  );
}
