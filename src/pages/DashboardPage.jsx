import { useEffect, useState, useMemo } from 'react';
import { fetchStats, fetchTimeline, fetchReports } from '../api/reportsApi';
import {
  PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend,
  AreaChart, Area, XAxis, YAxis, CartesianGrid,
} from 'recharts';
import { RefreshCw, MapPin, CheckCircle2, Clock, AlertTriangle, TrendingUp, Building2 } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { useAuth } from '../context/AuthContext';
import { AUTHORITIES } from '../utils/authorities';

const COLORS = ['#147460', '#3b82f6', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4'];

// Get the dept id from a role string
function getDeptId(role) {
  if (!role) return null;
  if (role.startsWith('authority_')) return role.split('_').slice(1).join('_');
  if (role.startsWith('worker_')) return role.split('_').slice(1).join('_');
  return null;
}

// Check if a report belongs to a specific dept
function reportMatchesDept(report, deptId) {
  if (!deptId) return true;
  const assigned = (report.assigned_department || '').toLowerCase();
  const authority = AUTHORITIES.find(a => a.id === deptId);
  if (!authority) return assigned.includes(deptId);
  // Match by abbr or name keywords
  return (
    assigned.includes(authority.abbr.toLowerCase()) ||
    assigned.includes(authority.id.toLowerCase()) ||
    authority.name.split(' ').some(w => w.length > 3 && assigned.includes(w.toLowerCase()))
  );
}

// Department tag component
function DeptTag({ department }) {
  if (!department) return null;
  const auth = AUTHORITIES.find(a =>
    department.toLowerCase().includes(a.abbr.toLowerCase()) ||
    department.toLowerCase().includes(a.id.toLowerCase())
  );
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold border ${
      auth ? 'bg-teal-50 border-teal-200 text-teal-800' : 'bg-slate-100 border-slate-200 text-slate-600'
    }`}>
      <Building2 size={10} />
      {auth?.abbr || department.slice(0, 10)}
    </span>
  );
}

export function DashboardPage() {
  const { role } = useAuth();
  const [stats, setStats] = useState(null);
  const [timeline, setTimeline] = useState([]);
  const [recentReports, setRecentReports] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lastRefreshed, setLastRefreshed] = useState(null);

  const deptId = getDeptId(role);

  const loadAll = async () => {
    try {
      setLoading(true);
      const [statsData, timelineData, reportsData] = await Promise.all([
        fetchStats(),
        fetchTimeline(),
        fetchReports('admin'), // always fetch all for dashboard display
      ]);
      setStats(statsData);
      setTimeline(timelineData);
      // Sort by timestamp desc, take last 20
      const sorted = [...reportsData].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp)).slice(0, 20);
      setRecentReports(sorted);
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
      date: (() => {
        try { return format(parseISO(d.date), 'MMM d'); } catch { return d.date; }
      })(),
      count: d.count,
    }));
  }, [timeline]);

  const resolutionRate = stats
    ? Math.round((stats.resolved / (stats.total || 1)) * 100)
    : 0;

  // My dept reports (if not admin)
  const myReports = useMemo(() => {
    if (!deptId) return recentReports;
    return recentReports.filter(r => reportMatchesDept(r, deptId));
  }, [recentReports, deptId]);

  if (error) {
    return (
      <div className="p-8">
        <div className="bg-red-50 text-red-600 p-4 rounded-xl flex items-center gap-3">
          <AlertTriangle size={20} />
          <div>
            <h3 className="font-bold">Failed to load statistics</h3>
            <p className="text-sm">{error}</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-8 pb-20">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-slate-900 mb-1">Overview Dashboard</h1>
          <p className="text-slate-500">
            Real-time statistics for city issue reports — visible to all roles.
            {lastRefreshed && (
              <span className="ml-2 text-xs text-slate-400">
                Last updated: {format(lastRefreshed, 'HH:mm:ss')}
              </span>
            )}
          </p>
        </div>
        <button
          onClick={loadAll}
          disabled={loading}
          className="flex items-center gap-2 bg-white px-4 py-2 rounded-lg border border-slate-200 shadow-sm text-sm font-medium text-slate-600 hover:text-primary-600 hover:border-primary-200 transition-colors disabled:opacity-50"
        >
          <RefreshCw size={16} className={loading ? 'animate-spin text-primary-500' : ''} />
          Refresh
        </button>
      </div>

      {/* Role banner for non-admins */}
      {role !== 'admin' && deptId && (
        <div className="mb-6 flex items-center gap-3 p-4 bg-teal-50 border border-teal-200 rounded-2xl">
          <Building2 size={18} className="text-teal-600 shrink-0" />
          <div>
            <p className="font-semibold text-teal-900 text-sm">
              You are viewing <strong>all city reports</strong>.
              Reports assigned to your department ({AUTHORITIES.find(a => a.id === deptId)?.abbr || deptId.toUpperCase()}) are highlighted with a tag.
            </p>
          </div>
        </div>
      )}

      {!stats && loading ? (
        /* Skeleton */
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm animate-pulse h-[116px]" />
            ))}
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 bg-white rounded-2xl border border-slate-100 shadow-sm animate-pulse h-[340px]" />
            <div className="bg-white rounded-2xl border border-slate-100 shadow-sm animate-pulse h-[340px]" />
          </div>
        </div>
      ) : stats ? (
        <>
          {/* Stat Cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
            <StatCard
              title="Total Reports"
              value={stats.total}
              icon={<MapPin className="text-blue-500" size={24} />}
              bgColor="bg-blue-50"
            />
            <StatCard
              title="Pending"
              value={stats.pending}
              icon={<AlertTriangle className="text-orange-500" size={24} />}
              bgColor="bg-orange-50"
            />
            <StatCard
              title="Active Work"
              value={(stats.in_review || 0) + (stats.in_process || 0) + (stats.in_maintenance || 0)}
              icon={<Clock className="text-purple-500" size={24} />}
              bgColor="bg-purple-50"
            />
            <StatCard
              title="Resolved"
              value={stats.resolved}
              icon={<CheckCircle2 className="text-green-500" size={24} />}
              bgColor="bg-green-50"
              subtitle={`${resolutionRate}% resolution rate`}
            />
          </div>

          {/* Charts Row */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
            {/* Timeline Trend */}
            <div className="lg:col-span-2 bg-white p-6 rounded-2xl border border-slate-100 shadow-sm">
              <div className="flex items-center gap-2 mb-6">
                <TrendingUp size={20} className="text-primary-500" />
                <h2 className="text-lg font-bold text-slate-800">Reports Over Time</h2>
              </div>
              <div className="h-[260px]">
                {timelineChartData.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={timelineChartData} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
                      <defs>
                        <linearGradient id="colorCount" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#147460" stopOpacity={0.2} />
                          <stop offset="95%" stopColor="#147460" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                      <XAxis dataKey="date" axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: '#94a3b8' }} interval="preserveStartEnd" />
                      <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: '#94a3b8' }} allowDecimals={false} />
                      <Tooltip
                        contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)', fontSize: '13px' }}
                        formatter={(val) => [`${val} report${val !== 1 ? 's' : ''}`, 'Count']}
                      />
                      <Area
                        type="monotone"
                        dataKey="count"
                        stroke="#147460"
                        strokeWidth={2.5}
                        fill="url(#colorCount)"
                        dot={{ r: 3, fill: '#147460', strokeWidth: 0 }}
                        activeDot={{ r: 5, fill: '#147460', stroke: '#fff', strokeWidth: 2 }}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="flex h-full items-center justify-center text-slate-400 text-sm">
                    Not enough data yet to show a trend.
                  </div>
                )}
              </div>
            </div>

            {/* Donut chart */}
            <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm">
              <h2 className="text-lg font-bold text-slate-800 mb-6">Reports by Category</h2>
              <div className="h-[260px]">
                {chartData.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={chartData} cx="50%" cy="45%" innerRadius={55} outerRadius={90} paddingAngle={4} dataKey="value">
                        {chartData.map((_, index) => (
                          <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }} />
                      <Legend verticalAlign="bottom" height={36} iconType="circle" iconSize={8} formatter={(value) => <span style={{ fontSize: 12, color: '#64748b' }}>{value}</span>} />
                    </PieChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="flex h-full items-center justify-center text-slate-400 text-sm">No category data available</div>
                )}
              </div>
            </div>
          </div>

          {/* Status Breakdown Bar */}
          <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm mb-6">
            <h2 className="text-lg font-bold text-slate-800 mb-4">Status Breakdown</h2>
            <div className="space-y-3">
              {[
                { label: 'Pending',      value: stats.pending || 0,       color: 'bg-orange-400', textColor: 'text-orange-700', bg: 'bg-orange-50' },
                { label: 'In Review',    value: stats.in_review || 0,     color: 'bg-amber-400',  textColor: 'text-amber-700',  bg: 'bg-amber-50'  },
                { label: 'In Process',   value: stats.in_process || 0,    color: 'bg-blue-400',   textColor: 'text-blue-700',   bg: 'bg-blue-50'   },
                { label: 'In Maint.',    value: stats.in_maintenance || 0,color: 'bg-purple-400', textColor: 'text-purple-700', bg: 'bg-purple-50' },
                { label: 'Resolved',     value: stats.resolved || 0,      color: 'bg-green-400',  textColor: 'text-green-700',  bg: 'bg-green-50'  },
              ].map(({ label, value, color, textColor, bg }) => {
                const pct = stats.total ? Math.round((value / stats.total) * 100) : 0;
                return (
                  <div key={label} className="flex items-center gap-4">
                    <span className={`w-24 text-xs font-bold ${textColor}`}>{label}</span>
                    <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
                      <div className={`h-full rounded-full ${color} transition-all duration-700`} style={{ width: `${pct}%` }} />
                    </div>
                    <span className={`w-14 text-right text-xs font-semibold px-2 py-0.5 rounded-full ${bg} ${textColor}`}>
                      {value} ({pct}%)
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Recent Issues — visible to all, with dept tags */}
          <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold text-slate-800">Recent Reports</h2>
              <span className="text-xs text-slate-400 font-medium">All roles can view · Tags show assigned dept.</span>
            </div>

            {recentReports.length === 0 ? (
              <div className="flex items-center justify-center py-12 text-slate-400 text-sm">
                No reports found.
              </div>
            ) : (
              <div className="space-y-2">
                {recentReports.map(report => {
                  const isMyDept = deptId ? reportMatchesDept(report, deptId) : false;
                  const statusStyles = {
                    'Pending':        'bg-orange-100 text-orange-800',
                    'In Review':      'bg-amber-100  text-amber-800',
                    'In Process':     'bg-blue-100   text-blue-800',
                    'In Maintenance': 'bg-purple-100 text-purple-800',
                    'Resolved':       'bg-green-100  text-green-800',
                  };
                  const statusCls = statusStyles[report.status] || 'bg-slate-100 text-slate-700';

                  return (
                    <div
                      key={report.id}
                      className={`flex items-center gap-4 p-3 rounded-xl border transition-colors ${
                        isMyDept
                          ? 'border-teal-200 bg-teal-50/60 ring-1 ring-teal-200'
                          : 'border-slate-100 bg-white hover:bg-slate-50'
                      }`}
                    >
                      <span className="text-xs font-mono text-slate-400 w-12 shrink-0">#{report.id}</span>
                      <span className="text-sm font-semibold text-slate-800 flex-1 truncate">{report.categories || 'Uncategorized'}</span>
                      <span className="text-xs text-slate-500 truncate max-w-[160px] hidden md:block">{report.address || 'Unknown location'}</span>
                      {report.assigned_department && <DeptTag department={report.assigned_department} />}
                      {isMyDept && deptId && (
                        <span className="text-[10px] font-bold text-teal-700 bg-teal-100 border border-teal-200 px-2 py-0.5 rounded-full shrink-0">
                          YOUR DEPT
                        </span>
                      )}
                      <span className={`px-2.5 py-0.5 text-xs font-bold rounded-lg shrink-0 ${statusCls}`}>
                        {report.status || 'Pending'}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </>
      ) : null}
    </div>
  );
}

function StatCard({ title, value, icon, bgColor, subtitle }) {
  return (
    <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm flex items-start gap-4">
      <div className={`p-4 rounded-xl ${bgColor} shrink-0`}>
        {icon}
      </div>
      <div>
        <p className="text-sm font-medium text-slate-500 mb-1">{title}</p>
        <p className="text-3xl font-bold text-slate-800">{value ?? '-'}</p>
        {subtitle && <p className="text-xs text-slate-400 mt-1">{subtitle}</p>}
      </div>
    </div>
  );
}
