import { useEffect, useState, useCallback } from 'react';
import {
  Users, AlertTriangle, Clock, TrendingDown, TrendingUp, Send,
  CheckCircle2, RefreshCw, Inbox, X,
} from 'lucide-react';
import {
  fetchTeamWorkload, fetchTeamWorkers, fetchTransfers,
  approveTransfer, denyTransfer,
} from '../api/reportsApi';

// One place decides what a team's colour means; the backend hands us the
// derived status so the panel and the app never drift apart on thresholds.
const STATUS_STYLE = {
  bottleneck: { label: 'Bottleneck', color: '#f87171', bg: 'rgba(248,113,113,0.12)', border: 'rgba(248,113,113,0.35)' },
  strained:   { label: 'Strained',   color: '#fbbf24', bg: 'rgba(251,191,36,0.12)', border: 'rgba(251,191,36,0.35)' },
  healthy:    { label: 'Healthy',    color: '#4ade80', bg: 'rgba(74,222,128,0.12)', border: 'rgba(74,222,128,0.30)' },
};

function Metric({ icon, label, value, hint, alert }) {
  return (
    <div className="rounded-xl p-3" style={{ background: 'rgba(255,255,255,0.04)' }}>
      <div className="flex items-center gap-1.5 mb-1" style={{ color: alert ? '#fbbf24' : '#94a3b8' }}>
        {icon}
        <span className="text-[11px] font-semibold uppercase tracking-wide">{label}</span>
      </div>
      <p className="text-xl font-bold" style={{ color: alert ? '#fbbf24' : '#f1f5f9' }}>{value}</p>
      {hint && <p className="text-[11px] mt-0.5" style={{ color: '#64748b' }}>{hint}</p>}
    </div>
  );
}

export function TeamsPage() {
  const [data, setData] = useState({ teams: [], sla_hours: 48 });
  const [transfers, setTransfers] = useState([]);
  const [rosters, setRosters] = useState({});
  const [expanded, setExpanded] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [decisionTeam, setDecisionTeam] = useState({});

  const load = useCallback(async () => {
    try {
      setError(null);
      const [workload, pending] = await Promise.all([
        fetchTeamWorkload(),
        fetchTransfers('pending').catch(() => []),
      ]);
      setData(workload);
      setTransfers(pending);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const toggleRoster = async (teamId) => {
    if (expanded === teamId) return setExpanded(null);
    setExpanded(teamId);
    if (!rosters[teamId]) {
      try {
        const roster = await fetchTeamWorkers(teamId);
        setRosters(prev => ({ ...prev, [teamId]: roster }));
      } catch {
        setRosters(prev => ({ ...prev, [teamId]: [] }));
      }
    }
  };

  const decide = async (transfer, approve) => {
    setBusyId(transfer.id);
    setError(null);
    try {
      if (approve) {
        const target = decisionTeam[transfer.id] || transfer.to_agency_id;
        if (!target) throw new Error('Pick a destination team for this request.');
        await approveTransfer(transfer.id, Number(target), '');
      } else {
        await denyTransfer(transfer.id, '');
      }
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusyId(null);
    }
  };

  if (loading) {
    return <div className="p-8 text-sm" style={{ color: '#94a3b8' }}>Loading team workload...</div>;
  }

  const teams = data.teams || [];
  const worstFirst = [...teams].sort((a, b) => {
    const rank = { bottleneck: 0, strained: 1, healthy: 2 };
    return rank[a.status] - rank[b.status];
  });

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: '#f1f5f9' }}>Teams</h1>
          <p className="text-sm mt-1" style={{ color: '#94a3b8' }}>
            Where the work is piling up, and who can take it. SLA threshold: {data.sla_hours}h.
          </p>
        </div>
        <button onClick={load} className="flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-semibold cursor-pointer"
          style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)', color: '#e2e8f0' }}>
          <RefreshCw size={15} /> Refresh
        </button>
      </div>

      {error && (
        <div className="rounded-xl px-4 py-3 text-sm flex items-center gap-2"
          style={{ background: 'rgba(248,113,113,0.12)', border: '1px solid rgba(248,113,113,0.35)', color: '#fca5a5' }}>
          <AlertTriangle size={16} /> {error}
        </div>
      )}

      {/* Release / transfer requests waiting on a decision */}
      <div className="rounded-2xl overflow-hidden" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}>
        <div className="flex items-center gap-2 px-5 py-4" style={{ background: 'rgba(255,255,255,0.04)' }}>
          <Inbox size={18} style={{ color: '#f1f5f9' }} />
          <p className="text-sm font-bold" style={{ color: '#f1f5f9' }}>Release requests</p>
          {transfers.length > 0 && (
            <span className="text-xs font-bold px-2 py-0.5 rounded-full" style={{ background: '#fbbf24', color: '#1e293b' }}>
              {transfers.length}
            </span>
          )}
        </div>
        <div className="p-5">
          {transfers.length === 0 ? (
            <p className="text-sm" style={{ color: '#64748b' }}>No teams are asking to hand work over right now.</p>
          ) : (
            <div className="space-y-3">
              {transfers.map(t => (
                <div key={t.id} className="rounded-xl p-4" style={{ background: 'rgba(255,255,255,0.04)' }}>
                  <div className="flex flex-wrap items-center gap-2 mb-2">
                    <span className="text-sm font-bold" style={{ color: '#f1f5f9' }}>Report #{t.report_id}</span>
                    <span className="text-xs px-2 py-0.5 rounded-lg" style={{ background: 'rgba(255,255,255,0.06)', color: '#cbd5e1' }}>
                      {t.report_title || 'Uncategorised'}
                    </span>
                    <span className="text-xs" style={{ color: '#94a3b8' }}>
                      {t.from_team || 'Unassigned'} → {t.to_team || 'any team'}
                    </span>
                  </div>
                  <p className="text-xs mb-3" style={{ color: '#94a3b8' }}>
                    Raised by <strong style={{ color: '#e2e8f0' }}>{t.requested_by}</strong>
                    {t.requested_by_role ? ` (${t.requested_by_role})` : ''}
                    {t.reason ? ` — "${t.reason}"` : ''}
                  </p>
                  <div className="flex flex-wrap items-center gap-2">
                    {!t.to_agency_id && (
                      <select
                        value={decisionTeam[t.id] || ''}
                        onChange={e => setDecisionTeam(prev => ({ ...prev, [t.id]: e.target.value }))}
                        className="px-3 py-2 rounded-xl text-sm"
                        style={{ background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.12)', color: '#f1f5f9' }}
                      >
                        <option value="">Send to...</option>
                        {teams.filter(x => x.id !== t.from_agency_id).map(x => (
                          <option key={x.id} value={x.id}>{x.name} ({x.open_count} open)</option>
                        ))}
                      </select>
                    )}
                    <button onClick={() => decide(t, true)} disabled={busyId === t.id}
                      className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-bold cursor-pointer disabled:opacity-50"
                      style={{ background: '#f1f5f9', color: '#0f172a' }}>
                      <CheckCircle2 size={15} /> Approve
                    </button>
                    <button onClick={() => decide(t, false)} disabled={busyId === t.id}
                      className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-bold cursor-pointer disabled:opacity-50"
                      style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)', color: '#cbd5e1' }}>
                      <X size={15} /> Deny
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Per-team bottleneck cards, worst first */}
      <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))' }}>
        {worstFirst.map(team => {
          const s = STATUS_STYLE[team.status] || STATUS_STYLE.healthy;
          const behind = team.net_7d < 0;
          return (
            <div key={team.id} className="rounded-2xl overflow-hidden"
              style={{ background: 'rgba(255,255,255,0.03)', border: `1px solid ${s.border}` }}>
              <div className="flex items-center justify-between px-5 py-4" style={{ background: s.bg }}>
                <div className="flex items-center gap-2">
                  <p className="text-base font-bold" style={{ color: '#f1f5f9' }}>{team.name}</p>
                  {team.is_mine && (
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full"
                      style={{ background: 'rgba(255,255,255,0.14)', color: '#e2e8f0' }}>YOUR TEAM</span>
                  )}
                </div>
                <span className="text-xs font-bold px-2.5 py-1 rounded-full" style={{ background: s.color, color: '#0f172a' }}>
                  {s.label}
                </span>
              </div>

              <div className="p-4 grid grid-cols-2 gap-3">
                <Metric
                  icon={<Send size={13} />}
                  label="Open work"
                  value={team.open_count}
                  hint={`${team.unclaimed_count} unclaimed · ${team.claimed_count} claimed`}
                  alert={team.unclaimed_count > 0 && team.worker_count === 0}
                />
                <Metric
                  icon={<Users size={13} />}
                  label="Load / worker"
                  value={team.load_per_worker ?? '—'}
                  hint={`${team.worker_count} worker${team.worker_count === 1 ? '' : 's'}`}
                  alert={team.load_per_worker != null && team.load_per_worker >= 5}
                />
                <Metric
                  icon={<Clock size={13} />}
                  label="Oldest unclaimed"
                  value={`${team.oldest_unclaimed_hours}h`}
                  hint={team.sla_breached_count ? `${team.sla_breached_count} past ${team.sla_hours}h SLA` : 'within SLA'}
                  alert={team.sla_breached_count > 0}
                />
                <Metric
                  icon={behind ? <TrendingDown size={13} /> : <TrendingUp size={13} />}
                  label="7-day flow"
                  value={`${team.completed_7d} / ${team.arrived_7d}`}
                  hint={behind ? `falling behind by ${Math.abs(team.net_7d)}` : 'keeping up'}
                  alert={behind}
                />
              </div>

              {team.bounced_count > 0 && (
                <div className="px-4 pb-2">
                  <p className="text-[11px]" style={{ color: '#fbbf24' }}>
                    {team.bounced_count} job{team.bounced_count === 1 ? '' : 's'} released back to the pool at least once.
                  </p>
                </div>
              )}

              <button onClick={() => toggleRoster(team.id)}
                className="w-full px-5 py-3 text-xs font-semibold text-left cursor-pointer"
                style={{ background: 'rgba(255,255,255,0.03)', color: '#94a3b8' }}>
                {expanded === team.id ? 'Hide roster' : 'View roster'}
              </button>

              {expanded === team.id && (
                <div className="px-5 pb-5 space-y-2">
                  {(rosters[team.id] || []).length === 0 ? (
                    <p className="text-xs" style={{ color: '#64748b' }}>
                      No workers on this team{team.open_count > 0 ? ' — work here has nobody to pick it up.' : '.'}
                    </p>
                  ) : (
                    rosters[team.id].map(w => (
                      <div key={w.id} className="flex items-center justify-between text-sm py-1.5 px-3 rounded-lg"
                        style={{ background: 'rgba(255,255,255,0.04)' }}>
                        <span style={{ color: '#e2e8f0' }}>{w.username}</span>
                        <span className="text-xs font-semibold"
                          style={{ color: w.active_jobs >= 5 ? '#fbbf24' : '#94a3b8' }}>
                          {w.active_jobs} active
                        </span>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
