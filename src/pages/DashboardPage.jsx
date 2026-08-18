import { useEffect, useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { fetchStats, fetchTimeline, fetchAllReports, fetchTeamWorkload, fetchTransfers } from '../api/reportsApi';
import {
  PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend,
  AreaChart, Area, XAxis, YAxis, CartesianGrid,
  BarChart, Bar, LabelList,
} from 'recharts';
import { RefreshCw, MapPin, CheckCircle2, Clock, AlertTriangle, TrendingUp, Building2, Activity, Download, AlertCircle, Users, HardHat, Inbox } from 'lucide-react';
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
      auth?.color || 'bg-stone-100 border-stone-200 text-stone-600'
    }`}>
      <Building2 size={10} />
      {auth?.abbr || department.slice(0, 10)}
    </span>
  );
}

function StatCard({ title, value, icon, iconColor, bgColor, borderColor, subtitle }) {
  return (
    <div className="bg-white border border-[#1f1e1a]/8 shadow-[0_8px_32px_rgba(31,30,26,0.06)] rounded-2xl p-5 flex items-center gap-4 hover:border-[#1f1e1a]/15 transition-all duration-300">
      <div className={`p-3.5 rounded-xl border ${bgColor} ${iconColor} ${borderColor} flex items-center justify-center shrink-0`}>
        {icon}
      </div>
      <div className="min-w-0 flex-1 text-left">
        <div className="text-xs font-bold text-[#8a8477] uppercase tracking-wider truncate">{title}</div>
        <div className="text-2xl font-black text-[#201f1b] mt-1">{value ?? '-'}</div>
        {subtitle && <div className="text-[10px] text-[#8a8477] font-medium mt-0.5 truncate">{subtitle}</div>}
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
  const [teamLoad, setTeamLoad] = useState([]);
  const [pendingTransfers, setPendingTransfers] = useState(0);

  const deptId = getDeptId(role, user?.username);
  const canSeeTeams = role === 'admin' || role === 'authority' || role?.startsWith('authority_');
  const isWorker = role === 'worker' || role?.startsWith('worker_');
  const [allReports, setAllReports] = useState([]);

  // Team load + release requests. Workers are refused these endpoints by the
  // backend, so failures are swallowed rather than breaking the dashboard.
  useEffect(() => {
    if (!canSeeTeams) return undefined;
    let cancelled = false;
    (async () => {
      const [workload, transfers] = await Promise.all([
        fetchTeamWorkload().catch(() => null),
        fetchTransfers('pending').catch(() => []),
      ]);
      if (cancelled) return;
      setTeamLoad(workload?.teams || []);
      setPendingTransfers(transfers?.length || 0);
    })();
    return () => { cancelled = true; };
  }, [canSeeTeams, lastRefreshed]);

  const loadAll = async () => {
    try {
      setLoading(true);
      const [statsData, timelineData, reportsData] = await Promise.all([
        fetchStats().catch(() => null),
        fetchTimeline().catch(() => []),
        fetchAllReports('admin').catch(() => []),
      ]);

      const validReports = Array.isArray(reportsData) ? reportsData : [];
      let finalReports = validReports;
      let finalStats = (statsData && typeof statsData === 'object' && !statsData.detail) ? statsData : {
        total: validReports.length,
        pending: validReports.filter(r => r.status === 'Pending').length,
        in_review: validReports.filter(r => r.status === 'In Review').length,
        in_process: validReports.filter(r => r.status === 'In Process').length,
        in_maintenance: validReports.filter(r => r.status === 'In Maintenance').length,
        resolved: validReports.filter(r => r.status === 'Resolved').length,
        rejected: validReports.filter(r => r.status === 'Rejected').length,
        categories: {}
      };
      let finalTimeline = Array.isArray(timelineData) ? timelineData : [];

      if (role !== 'admin' && deptId) {
        finalReports = validReports.filter(r => reportMatchesDept(r, deptId));
        
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
      setAllReports(finalReports);
      const sorted = [...finalReports].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp)).slice(0, 20);
      setRecentReports(sorted);

      // A worker's SLA numbers should be about their own jobs, not the whole
      // department's — "3 dept reports are stuck" isn't actionable to a
      // worker who only owns one of them, but "1 of your jobs is stuck" is.
      const myUsername = (user?.username || '').toLowerCase();
      const slaBase = isWorker
        ? finalReports.filter(r => (r.assigned_worker || '').toLowerCase() === myUsername)
        : finalReports;

      const resolvedReports = slaBase.filter(r => r.status === 'Resolved' && r.resolved_at && r.timestamp);
      let totalHours = 0;
      resolvedReports.forEach(r => {
        const start = new Date(r.timestamp);
        const end = new Date(r.resolved_at);
        if (!isNaN(start) && !isNaN(end)) totalHours += (end - start) / (1000 * 60 * 60);
      });
      const avgDays = resolvedReports.length ? (totalHours / resolvedReports.length / 24).toFixed(1) : 0;

      const threeDaysAgo = new Date();
      threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);
      const bottlenecks = slaBase.filter(r => r.status !== 'Resolved' && new Date(r.timestamp) < threeDaysAgo).length;

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

  // Jobs actually claimed by this worker — from the full dept list, not the
  // top-20 slice, so "My Resolved" isn't silently capped once history grows.
  const myJobs = useMemo(() => {
    if (!isWorker) return [];
    const myUsername = (user?.username || '').toLowerCase();
    return allReports.filter(r => (r.assigned_worker || '').toLowerCase() === myUsername);
  }, [allReports, isWorker, user]);

  // There's no "who am I" endpoint that returns a worker's own crew — GET
  // /agencies/{id}/crews is authority/admin-only (main.py: _require_agency_
  // owner). Every report already carries assigned_crew though, so the most
  // recent one of the worker's own jobs tells us the same thing without a
  // new backend route.
  const myCrew = useMemo(() => {
    if (!isWorker) return null;
    const withCrew = [...myJobs]
      .filter(r => r.assigned_crew)
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    return withCrew[0]?.assigned_crew || null;
  }, [myJobs, isWorker]);

  const myStats = useMemo(() => {
    if (!isWorker) return null;
    const active = myJobs.filter(r => ['In Process', 'In Maintenance'].includes(r.status)).length;
    const resolved = myJobs.filter(r => r.status === 'Resolved').length;
    const unclaimedInPool = allReports.filter(r => r.in_pool).length;
    return { active, resolved, unclaimedInPool };
  }, [myJobs, allReports, isWorker]);


  if (error) {
    return (
      <div className="p-8">
        <div className="p-4 rounded-xl flex items-center gap-3 border" style={{ background: '#ffffff', borderColor: 'rgba(31,30,26,0.08)', color: '#201f1b' }}>
          <AlertTriangle size={20} className="text-[#c1613f]" />
          <div><h3 className="font-bold">Failed to load statistics</h3><p className="text-sm" style={{ color: 'rgba(75,71,61,0.75)' }}>{error}</p></div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-8 pb-20">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="page-header-title">{isWorker ? 'My Workflow' : 'Overview Dashboard'}</h1>
          <div className="page-header-sub mt-1">
            {deptId ? (
              <span className="flex items-center gap-2">
                <span className="font-semibold text-[#3d4d34]">{user?.displayName}</span>
                <span className="text-[#8a8477]">|</span>
                <span>{AUTHORITIES.find(a => a.id === deptId)?.abbr || deptId.toUpperCase()} Department</span>
                {isWorker && (
                  <>
                    <span className="text-[#8a8477]">|</span>
                    <span>{myCrew ? `${myCrew} Crew` : 'General pool'}</span>
                  </>
                )}
                {lastRefreshed && <span className="ml-2 text-xs text-[#8a8477]">· Last updated: {format(lastRefreshed, 'HH:mm:ss')}</span>}
              </span>
            ) : (
              <span>
                Real-time statistics for city issue reports
                {lastRefreshed && <span className="ml-2 text-xs text-[#8a8477]">· Last updated: {format(lastRefreshed, 'HH:mm:ss')}</span>}
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-3">

          <button
            onClick={loadAll}
            disabled={loading}
            className="flex items-center gap-2 px-4 py-2 rounded-lg border text-sm font-semibold transition-colors disabled:opacity-50" style={{ background: 'rgba(74,93,63,0.07)', border: '1px solid rgba(74,93,63,0.18)', color: '#3d4d34' }}
          >
            <RefreshCw size={15} className={loading ? 'animate-spin text-[#8a8477]' : ''} />
            Refresh
          </button>
        </div>
      </div>

      <div id="dashboard-content">

      {!stats && loading ? (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
            {[...Array(4)].map((_, i) => <div key={i} className="rounded-2xl border border-[#1f1e1a]/8 animate-pulse h-[100px]" style={{ background: '#ffffff' }} />)}
          </div>
        </div>
      ) : stats ? (
        <>
          {/* SLA Alerts */}
          {(slaMetrics.bottlenecks > 0 || slaMetrics.avgDays > 0) && (
            <div className="flex flex-col md:flex-row gap-5 mb-6">
              <div className="flex-1 rounded-2xl p-5 flex items-center gap-4" style={{ background: '#ffffff', border: '1px solid rgba(31,30,26,0.08)', boxShadow: '0 8px 32px rgba(31,30,26,0.06)' }}>
                <div className="p-3 rounded-full" style={{ background: 'rgba(217,119,87,0.12)', color: '#c1613f' }}>
                  <AlertCircle size={28} />
                </div>
                <div>
                  <h3 className="text-sm font-bold uppercase tracking-wider mb-0.5" style={{ color: '#201f1b' }}>Bottleneck Alert</h3>
                  <p className="text-sm font-medium" style={{ color: '#8a8477' }}>
                    {isWorker
                      ? `${slaMetrics.bottlenecks} of your job(s) have been stuck for over 3 days.`
                      : `${slaMetrics.bottlenecks} report(s) have been stuck for over 3 days.`}
                  </p>
                </div>
              </div>
              <div className="flex-1 rounded-2xl p-5 flex items-center gap-4" style={{ background: '#ffffff', border: '1px solid rgba(31,30,26,0.08)', boxShadow: '0 8px 32px rgba(31,30,26,0.06)' }}>
                <div className="p-3 rounded-full" style={{ background: 'rgba(74,93,63,0.10)', color: '#3d4d34' }}>
                  <Clock size={28} />
                </div>
                <div>
                  <h3 className="text-sm font-bold uppercase tracking-wider mb-0.5" style={{ color: '#201f1b' }}>{isWorker ? 'Your Completion Speed' : 'SLA Performance'}</h3>
                  <p className="text-sm font-medium" style={{ color: '#8a8477' }}>
                    {isWorker
                      ? `You resolve jobs in ${slaMetrics.avgDays} days on average.`
                      : `Average resolution time is ${slaMetrics.avgDays} days.`}
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Team load strip — who is drowning, and who can take work */}
          {canSeeTeams && teamLoad.length > 0 && (
            <div className="rounded-2xl p-5 mb-6" style={{ background: '#ffffff', border: '1px solid rgba(31,30,26,0.08)', boxShadow: '0 8px 32px rgba(31,30,26,0.06)' }}>
              <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
                <h3 className="text-sm font-bold uppercase tracking-wider" style={{ color: '#201f1b' }}>Team Load</h3>
                <Link to="/teams" className="text-xs font-semibold" style={{ color: '#3d4d34' }}>
                  {pendingTransfers > 0
                    ? `${pendingTransfers} release request${pendingTransfers === 1 ? '' : 's'} waiting →`
                    : 'Manage teams →'}
                </Link>
              </div>
              <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}>
                {teamLoad.map(t => {
                  const tone = t.status === 'bottleneck' ? '#dc2626'
                    : t.status === 'strained' ? '#c1613f' : '#15803d';
                  return (
                    <div key={t.id} className="rounded-xl p-4" style={{ background: 'var(--cream-100)', borderLeft: `3px solid ${tone}` }}>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-sm font-bold" style={{ color: '#201f1b' }}>{t.name}</span>
                        <span className="text-[10px] font-bold uppercase" style={{ color: tone }}>{t.status}</span>
                      </div>
                      <p className="text-xs" style={{ color: '#4b473d' }}>
                        {t.open_count} open · {t.unclaimed_count} unclaimed
                      </p>
                      <p className="text-xs" style={{ color: '#8a8477' }}>
                        {t.load_per_worker != null
                          ? `${t.load_per_worker} per worker (${t.worker_count})`
                          : `no workers assigned`}
                        {t.sla_breached_count > 0 && ` · ${t.sla_breached_count} past SLA`}
                      </p>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Stat Cards — a worker's own output, not the department's totals */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5 mb-6">
            {isWorker ? (
              <>
                <StatCard
                  title="My Active Jobs"
                  value={myStats.active}
                  icon={<Activity size={22} />}
                  iconColor="text-blue-600"
                  bgColor="bg-blue-500/10"
                  borderColor="border-blue-500/25"
                  subtitle="In process / maintenance"
                />
                <StatCard
                  title="Waiting In Pool"
                  value={myStats.unclaimedInPool}
                  icon={<Inbox size={22} />}
                  iconColor="text-amber-600"
                  bgColor="bg-amber-500/10"
                  borderColor="border-amber-500/25"
                  subtitle="Nobody's claimed these yet"
                />
                <StatCard
                  title="My Resolved"
                  value={myStats.resolved}
                  icon={<CheckCircle2 size={22} />}
                  iconColor="text-emerald-600"
                  bgColor="bg-emerald-500/10"
                  borderColor="border-emerald-500/25"
                  subtitle="Completed by you"
                />
                <StatCard
                  title="My Total Jobs"
                  value={myJobs.length}
                  icon={<HardHat size={22} />}
                  iconColor="text-[#4a5d3f]"
                  bgColor="bg-[#4a5d3f]/10"
                  borderColor="border-[#4a5d3f]/20"
                  subtitle="Ever assigned to you"
                />
              </>
            ) : (
              <>
                <StatCard
                  title="Total Reports"
                  value={stats.total}
                  icon={<MapPin size={22} />}
                  iconColor="text-[#4a5d3f]"
                  bgColor="bg-[#4a5d3f]/10"
                  borderColor="border-[#4a5d3f]/20"
                  subtitle="All-time submissions"
                />
                <StatCard
                  title="Pending"
                  value={stats.pending}
                  icon={<AlertTriangle size={22} />}
                  iconColor="text-amber-600"
                  bgColor="bg-amber-500/10"
                  borderColor="border-amber-500/25"
                  subtitle="Awaiting admin review"
                />
                <StatCard
                  title="Active Work"
                  value={(stats.in_review || 0) + (stats.in_process || 0) + (stats.in_maintenance || 0)}
                  icon={<Activity size={22} />}
                  iconColor="text-blue-600"
                  bgColor="bg-blue-500/10"
                  borderColor="border-blue-500/25"
                  subtitle="In review / process / maint."
                />
                <StatCard
                  title="Resolved"
                  value={stats.resolved}
                  icon={<CheckCircle2 size={22} />}
                  iconColor="text-emerald-600"
                  bgColor="bg-emerald-500/10"
                  borderColor="border-emerald-500/25"
                  subtitle={`${resolutionRate}% resolution rate`}
                />
              </>
            )}
          </div>

          {/* Charts Row + Status Breakdown — city/dept-wide trend data a
              worker doesn't act on. Their own numbers are already in the
              stat cards above. */}
          {!isWorker && (
          <>
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
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(31,30,26,0.08)" />
                        <XAxis dataKey="date" axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: '#8a8477' }} interval="preserveStartEnd" />
                        <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: '#8a8477' }} allowDecimals={false} />
                        <Tooltip contentStyle={{ borderRadius: '12px', border: '1px solid rgba(31,30,26,0.10)', background: '#ffffff', color: '#201f1b', fontSize: '13px', backdropFilter: 'blur(16px)' }} itemStyle={{ color: '#201f1b' }} labelStyle={{ color: '#8a8477' }} formatter={(val) => [`${val} report${val !== 1 ? 's' : ''}`, 'Count']} />
                        <Area type="monotone" dataKey="count" stroke="#4a5d3f" strokeWidth={2.5} fill="url(#colorCount)" dot={{ r: 3, fill: '#4a5d3f', strokeWidth: 0 }} activeDot={{ r: 5, fill: '#4a5d3f', stroke: '#ffffff', strokeWidth: 2 }} />
                      </AreaChart>
                    </ResponsiveContainer>
                  ) : (
                    <div className="flex h-full items-center justify-center text-[#8a8477] text-sm">Not enough data yet.</div>
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
                        <Tooltip contentStyle={{ borderRadius: '12px', border: '1px solid rgba(31,30,26,0.10)', background: '#ffffff', color: '#201f1b', backdropFilter: 'blur(16px)' }} itemStyle={{ color: '#201f1b' }} labelStyle={{ color: '#8a8477' }} />
                        <Legend verticalAlign="bottom" height={36} iconType="circle" iconSize={8} formatter={(value) => <span style={{ fontSize: 11, color: '#201f1b', fontWeight: 500 }}>{value}</span>} />
                      </PieChart>
                    </ResponsiveContainer>
                  ) : (
                    <div className="flex h-full items-center justify-center text-[#8a8477] text-sm">No category data.</div>
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
                { label: 'Pending',      value: stats.pending || 0,       color: '#d97757', bg: 'rgba(217,119,87,0.12)', text: '#b45309' },
                { label: 'In Review',    value: stats.in_review || 0,     color: '#3b82f6', bg: 'rgba(59,130,246,0.12)', text: '#1d4ed8' },
                { label: 'In Process',   value: stats.in_process || 0,    color: '#6366f1', bg: 'rgba(99,102,241,0.12)', text: '#4338ca' },
                { label: 'In Maint.',    value: stats.in_maintenance || 0,color: '#a855f7', bg: 'rgba(168,85,247,0.12)', text: '#7e22ce' },
                { label: 'Resolved',     value: stats.resolved || 0,      color: '#4a5d3f', bg: 'rgba(74,93,63,0.12)', text: '#3d4d34' },
                { label: 'Rejected',     value: stats.rejected || 0,      color: '#ef4444', bg: 'rgba(239,68,68,0.12)', text: '#b91c1c' },
              ].map(({ label, value, color, bg, text }) => {
                const pct = stats.total ? Math.round((value / stats.total) * 100) : 0;
                return (
                  <div key={label} className="flex items-center gap-4 text-left">
                    <span className="w-24 text-xs font-bold" style={{ color: text }}>{label}</span>
                    <div className="flex-1 h-2 rounded-full overflow-hidden" style={{ background: 'rgba(31,30,26,0.07)' }}>
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
          </>
          )}

          {/* Department Performance Chart — Admin only */}
          {role === 'admin' && deptPerformanceData.length > 0 && (
            <div className="content-card mb-5">
              <div className="content-card-header">
                <div className="content-card-title">Department Performance</div>
                <span className="text-xs text-[#8a8477] font-medium">Based on recent 20 reports</span>
              </div>
              <div className="p-5">
                <div className="h-[200px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={deptPerformanceData} layout="vertical" margin={{ top: 0, right: 50, left: 0, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="rgba(31,30,26,0.08)" />
                      <XAxis type="number" axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: '#8a8477' }} allowDecimals={false} />
                      <YAxis dataKey="name" type="category" axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: '#201f1b', fontWeight: 600 }} width={45} />
                      <Tooltip contentStyle={{ borderRadius: '12px', border: '1px solid rgba(31,30,26,0.10)', background: '#ffffff', color: '#201f1b', backdropFilter: 'blur(16px)' }} itemStyle={{ color: '#201f1b' }} labelStyle={{ color: '#8a8477' }} />
                      <Bar dataKey="assigned" name="Assigned" fill="#6366f1" radius={[0, 4, 4, 0]} barSize={12}>
                        <LabelList dataKey="assigned" position="right" style={{ fontSize: 11, fill: '#4338ca', fontWeight: 700 }} />
                      </Bar>
                      <Bar dataKey="resolved" name="Resolved" fill="#4a5d3f" radius={[0, 4, 4, 0]} barSize={12}>
                        <LabelList dataKey="resolved" position="right" style={{ fontSize: 11, fill: '#3d4d34', fontWeight: 700 }} />
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <div className="flex items-center gap-4 mt-3 text-xs text-[#8a8477]">
                  <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm inline-block" style={{ background: '#6366f1' }} /> Assigned</span>
                  <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm inline-block" style={{ background: '#4a5d3f' }} /> Resolved</span>
                </div>
              </div>
            </div>
          )}

          {/* My Jobs (worker) / Recent Reports (admin, authority) */}
          <div className="content-card">
            <div className="content-card-header">
              <div className="content-card-title">{isWorker ? 'My Jobs' : 'Recent Reports'}</div>
              <span className="text-xs text-[#8a8477] font-medium">
                {isWorker
                  ? 'Everything currently claimed by you, most recent first.'
                  : 'Showing 20 most recent reports · Tags show assigned dept.'}
              </span>
            </div>
            {(isWorker ? myJobs : recentReports).length === 0 ? (
              <div className="flex items-center justify-center py-12 text-sm" style={{ color: 'rgba(138,132,119,0.85)' }}>
                {isWorker ? "You haven't claimed any jobs yet." : 'No reports found.'}
              </div>
            ) : (
              <div className="divide-y" style={{ borderColor: 'rgba(31,30,26,0.06)' }}>
                {(isWorker
                  ? [...myJobs].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp)).slice(0, 20)
                  : recentReports
                ).map(report => {
                  const isMyDept = deptId ? reportMatchesDept(report, deptId) : false;
                  const statusStyles = {
                    'Pending':        'bg-amber-500/10 border border-amber-500/30 text-amber-700',
                    'In Review':      'bg-blue-500/10 border border-blue-500/30 text-blue-700',
                    'In Process':     'bg-indigo-500/10 border border-indigo-500/30 text-indigo-700',
                    'In Maintenance': 'bg-purple-500/10 border border-purple-500/30 text-purple-700',
                    'Resolved':       'bg-emerald-500/10 border border-emerald-500/30 text-emerald-700 font-extrabold',
                    'Rejected':       'bg-red-500/10 border border-red-500/30 text-red-700 line-through',
                  };
                  const statusCls = statusStyles[report.status] || 'bg-stone-100 text-stone-700';
                  return (
                    <div
                      key={report.id}
                      className={`flex items-center gap-4 px-5 py-3 transition-colors ${
                        isMyDept ? 'hover:bg-[#4a5d3f]/5' : 'hover:bg-[#4a5d3f]/5'
                      }`}
                    >
                      <span className="text-xs font-mono w-12 shrink-0" style={{ color: 'rgba(138,132,119,0.85)' }}>#{report.id}</span>
                      <span className="text-sm font-semibold flex-1 truncate" style={{ color: '#201f1b' }}>{report.categories || 'Uncategorized'}</span>
                      <span className="text-xs truncate max-w-[160px] hidden md:block" style={{ color: 'rgba(75,71,61,0.75)' }}>{report.address || 'Unknown'}</span>
                      {!isWorker && report.assigned_department && <DeptTag department={report.assigned_department} />}
                      {!isWorker && isMyDept && deptId && (
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0" style={{ color: '#4338ca', background: 'rgba(79,70,229,0.12)', border: '1px solid rgba(79,70,229,0.25)' }}>YOUR DEPT</span>
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
