import { useEffect, useState, useMemo } from 'react';
import { fetchStats, fetchTimeline } from '../api/reportsApi';
import {
  PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend,
  AreaChart, Area, XAxis, YAxis, CartesianGrid,
} from 'recharts';
import { RefreshCw, MapPin, CheckCircle2, Clock, AlertTriangle, TrendingUp } from 'lucide-react';
import { format, parseISO } from 'date-fns';

const COLORS = ['#147460', '#3b82f6', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4'];

export function DashboardPage() {
  const [stats, setStats] = useState(null);
  const [timeline, setTimeline] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lastRefreshed, setLastRefreshed] = useState(null);

  const loadAll = async () => {
    try {
      setLoading(true);
      const [statsData, timelineData] = await Promise.all([
        fetchStats(),
        fetchTimeline(),
      ]);
      setStats(statsData);
      setTimeline(timelineData);
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
            Real-time statistics for city issue reports.
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

          {/* Charts Row 1: Trend + Pie */}
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
                      <XAxis
                        dataKey="date"
                        axisLine={false}
                        tickLine={false}
                        tick={{ fontSize: 11, fill: '#94a3b8' }}
                        interval="preserveStartEnd"
                      />
                      <YAxis
                        axisLine={false}
                        tickLine={false}
                        tick={{ fontSize: 11, fill: '#94a3b8' }}
                        allowDecimals={false}
                      />
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
                      <Pie
                        data={chartData}
                        cx="50%"
                        cy="45%"
                        innerRadius={55}
                        outerRadius={90}
                        paddingAngle={4}
                        dataKey="value"
                      >
                        {chartData.map((_, index) => (
                          <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip
                        contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                      />
                      <Legend
                        verticalAlign="bottom"
                        height={36}
                        iconType="circle"
                        iconSize={8}
                        formatter={(value) => <span style={{ fontSize: 12, color: '#64748b' }}>{value}</span>}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="flex h-full items-center justify-center text-slate-400 text-sm">No category data available</div>
                )}
              </div>
            </div>
          </div>

          {/* Status Breakdown Bar */}
          <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm">
            <h2 className="text-lg font-bold text-slate-800 mb-4">Status Breakdown</h2>
            <div className="space-y-3">
              {[
                { label: 'Pending', value: stats.pending || 0, color: 'bg-orange-400', textColor: 'text-orange-700', bg: 'bg-orange-50' },
                { label: 'In Review', value: stats.in_review || 0, color: 'bg-amber-400', textColor: 'text-amber-700', bg: 'bg-amber-50' },
                { label: 'In Process', value: stats.in_process || 0, color: 'bg-blue-400', textColor: 'text-blue-700', bg: 'bg-blue-50' },
                { label: 'In Maint.', value: stats.in_maintenance || 0, color: 'bg-purple-400', textColor: 'text-purple-700', bg: 'bg-purple-50' },
                { label: 'Resolved', value: stats.resolved || 0, color: 'bg-green-400', textColor: 'text-green-700', bg: 'bg-green-50' },
              ].map(({ label, value, color, textColor, bg }) => {
                const pct = stats.total ? Math.round((value / stats.total) * 100) : 0;
                return (
                  <div key={label} className="flex items-center gap-4">
                    <span className={`w-24 text-xs font-bold ${textColor}`}>{label}</span>
                    <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full ${color} transition-all duration-700`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <span className={`w-14 text-right text-xs font-semibold px-2 py-0.5 rounded-full ${bg} ${textColor}`}>
                      {value} ({pct}%)
                    </span>
                  </div>
                );
              })}
            </div>
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
