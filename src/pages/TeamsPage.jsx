import { useEffect, useState, useCallback } from 'react';
import {
  Users, AlertTriangle, Clock, TrendingDown, TrendingUp, Send,
  CheckCircle2, RefreshCw, Inbox, X, Plus, UserMinus, Coffee, Power,
} from 'lucide-react';
import {
  fetchTeamWorkload, fetchTeamWorkers, fetchTransfers,
  approveTransfer, denyTransfer,
  fetchCrews, fetchCrewWorkload, createCrew, updateCrew,
  addCrewMember, removeCrewMember, setStaffLeave,
} from '../api/reportsApi';
import { useAuth } from '../context/AuthContext';

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

const CREW_STATUS_STYLE = {
  bottleneck: '#f87171',
  strained: '#fbbf24',
  healthy: '#4ade80',
};

// Crew management for the authority's own team: create crews, move workers
// between them, take a crew or a single worker offline. Only rendered for
// team.is_mine — the backend rejects managing another agency's crews anyway,
// so there's no point showing controls that would just 403.
function CrewManager({ teamId, roster, onChanged }) {
  const [crews, setCrews] = useState([]);
  const [workload, setWorkload] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(null);
  const [newCrewName, setNewCrewName] = useState('');
  const [addTarget, setAddTarget] = useState({}); // crewId -> staffId being added

  const load = useCallback(async () => {
    try {
      setError(null);
      const [crewList, wl] = await Promise.all([
        fetchCrews(teamId),
        fetchCrewWorkload(teamId).catch(() => null),
      ]);
      setCrews(crewList);
      const byId = {};
      (wl?.crews || []).forEach(c => { byId[c.id ?? 'unassigned'] = c; });
      setWorkload(byId);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [teamId]);

  useEffect(() => { load(); }, [load]);

  const run = async (key, fn) => {
    setBusy(key);
    setError(null);
    try {
      await fn();
      await load();
      onChanged?.();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(null);
    }
  };

  const handleCreateCrew = () => {
    const name = newCrewName.trim();
    if (!name) return;
    run('create', async () => {
      await createCrew(teamId, name);
      setNewCrewName('');
    });
  };

  const unassigned = roster.filter(w => !w.crew_id);

  if (loading) {
    return <p className="text-xs" style={{ color: '#64748b' }}>Loading crews...</p>;
  }

  return (
    <div className="space-y-3">
      {error && (
        <div className="rounded-lg px-3 py-2 text-xs" style={{ background: 'rgba(248,113,113,0.12)', color: '#fca5a5' }}>
          {error}
        </div>
      )}

      {crews.map(crew => {
        const stats = workload[crew.id];
        const tone = stats ? CREW_STATUS_STYLE[stats.derived_status] : '#94a3b8';
        return (
          <div key={crew.id} className="rounded-xl overflow-hidden" style={{ background: 'rgba(255,255,255,0.04)', border: `1px solid ${crew.status === 'disabled' ? 'rgba(248,113,113,0.3)' : 'rgba(255,255,255,0.08)'}` }}>
            <div className="flex items-center justify-between px-3 py-2" style={{ background: 'rgba(255,255,255,0.03)' }}>
              <div className="flex items-center gap-2">
                <span className="text-sm font-bold" style={{ color: '#f1f5f9' }}>{crew.name}</span>
                {stats && (
                  <span className="text-[10px] font-bold uppercase" style={{ color: tone }}>{stats.derived_status}</span>
                )}
                {crew.status === 'disabled' && (
                  <span className="text-[10px] font-bold px-1.5 py-0.5 rounded" style={{ background: 'rgba(248,113,113,0.15)', color: '#fca5a5' }}>DISABLED</span>
                )}
              </div>
              <button
                onClick={() => run(`toggle-${crew.id}`, () => updateCrew(crew.id, { status: crew.status === 'disabled' ? 'active' : 'disabled' }))}
                disabled={busy === `toggle-${crew.id}`}
                title={crew.status === 'disabled' ? 'Re-enable this crew' : 'Disable this crew (e.g. whole crew on leave)'}
                className="flex items-center gap-1 text-[11px] font-semibold cursor-pointer disabled:opacity-50"
                style={{ color: crew.status === 'disabled' ? '#4ade80' : '#fca5a5' }}
              >
                <Power size={12} /> {crew.status === 'disabled' ? 'Enable' : 'Disable'}
              </button>
            </div>

            {stats && (
              <div className="px-3 py-2 text-[11px] flex flex-wrap gap-x-3 gap-y-1" style={{ color: '#94a3b8', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                <span>{stats.open_count} open · {stats.unclaimed_count} unclaimed</span>
                <span>{stats.load_per_worker != null ? `${stats.load_per_worker} per worker` : 'no active workers'}</span>
                {stats.on_leave_count > 0 && <span style={{ color: '#fbbf24' }}>{stats.on_leave_count} on leave</span>}
                {stats.sla_breached_count > 0 && <span style={{ color: '#f87171' }}>{stats.sla_breached_count} past SLA</span>}
              </div>
            )}

            <div className="p-3 space-y-1.5">
              {crew.members.length === 0 && (
                <p className="text-xs" style={{ color: '#64748b' }}>No members yet.</p>
              )}
              {crew.members.map(m => (
                <div key={m.id} className="flex items-center justify-between text-sm py-1 px-2 rounded-lg"
                  style={{ background: 'rgba(255,255,255,0.03)', opacity: m.on_leave ? 0.45 : 1 }}>
                  <div className="flex items-center gap-2">
                    <span style={{ color: m.on_leave ? '#64748b' : '#e2e8f0', textDecoration: m.on_leave ? 'line-through' : 'none' }}>{m.username}</span>
                    <span className="text-[11px]" style={{ color: m.active_jobs >= 5 ? '#fbbf24' : '#64748b' }}>{m.active_jobs} active</span>
                    {m.on_leave && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded" style={{ background: 'rgba(251,191,36,0.15)', color: '#fbbf24' }}>ON LEAVE</span>}
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => run(`leave-${m.id}`, () => setStaffLeave(m.id, !m.on_leave))}
                      disabled={busy === `leave-${m.id}`}
                      title={m.on_leave ? 'Mark back from leave' : 'Mark on leave'}
                      className="cursor-pointer disabled:opacity-50"
                      style={{ color: m.on_leave ? '#4ade80' : '#94a3b8' }}
                    >
                      <Coffee size={13} />
                    </button>
                    <button
                      onClick={() => run(`rm-${m.id}`, () => removeCrewMember(crew.id, m.id))}
                      disabled={busy === `rm-${m.id}`}
                      title="Remove from crew"
                      className="cursor-pointer disabled:opacity-50"
                      style={{ color: '#fca5a5' }}
                    >
                      <UserMinus size={13} />
                    </button>
                  </div>
                </div>
              ))}

              <div className="flex items-center gap-2 pt-1">
                <select
                  value={addTarget[crew.id] || ''}
                  onChange={e => setAddTarget(prev => ({ ...prev, [crew.id]: e.target.value }))}
                  className="flex-1 px-2 py-1.5 rounded-lg text-xs"
                  style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', color: '#f1f5f9' }}
                >
                  <option value="">Add worker...</option>
                  {roster.filter(w => w.crew_id !== crew.id).map(w => (
                    <option key={w.id} value={w.id}>
                      {w.username}
                      {w.crew_id ? ' (on another crew)' : ''}
                      {w.on_leave ? ' — on leave' : ''}
                    </option>
                  ))}
                </select>
                <button
                  onClick={() => {
                    const staffId = addTarget[crew.id];
                    if (!staffId) return;
                    run(`add-${crew.id}`, async () => {
                      await addCrewMember(crew.id, Number(staffId));
                      setAddTarget(prev => ({ ...prev, [crew.id]: '' }));
                    });
                  }}
                  disabled={!addTarget[crew.id] || busy === `add-${crew.id}`}
                  className="p-1.5 rounded-lg cursor-pointer disabled:opacity-30"
                  style={{ background: 'rgba(255,255,255,0.08)', color: '#e2e8f0' }}
                >
                  <Plus size={14} />
                </button>
              </div>
            </div>
          </div>
        );
      })}

      {unassigned.length > 0 && (
        <div className="rounded-xl p-3" style={{ background: 'rgba(255,255,255,0.02)', border: '1px dashed rgba(255,255,255,0.1)' }}>
          <p className="text-[11px] font-semibold mb-1.5" style={{ color: '#64748b' }}>
            Not on a crew — visible in the general pool
          </p>
          <div className="flex flex-wrap gap-1.5">
            {unassigned.map(w => (
              <span key={w.id} className="text-xs px-2 py-1 rounded-lg"
                style={{
                  background: 'rgba(255,255,255,0.05)',
                  color: w.on_leave ? '#64748b' : '#cbd5e1',
                  opacity: w.on_leave ? 0.45 : 1,
                  textDecoration: w.on_leave ? 'line-through' : 'none',
                }}>
                {w.username}{w.on_leave ? ' · on leave' : ''}
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="flex items-center gap-2">
        <input
          value={newCrewName}
          onChange={e => setNewCrewName(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleCreateCrew()}
          placeholder="New crew name, e.g. Team C"
          className="flex-1 px-3 py-2 rounded-xl text-sm"
          style={{ background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.12)', color: '#f1f5f9' }}
        />
        <button
          onClick={handleCreateCrew}
          disabled={!newCrewName.trim() || busy === 'create'}
          className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-bold cursor-pointer disabled:opacity-50"
          style={{ background: '#f1f5f9', color: '#0f172a' }}
        >
          <Plus size={14} /> Crew
        </button>
      </div>
    </div>
  );
}

export function TeamsPage() {
  const { role } = useAuth();
  // Admin can manage every agency's crews, not just team.is_mine — that flag
  // is only meaningful for an authority tied to one agency; admin isn't tied
  // to any (team.is_mine can be true for admin by seed-data coincidence on
  // one agency, which would otherwise wrongly hide every other agency's
  // crew management from them).
  const isAdmin = role === 'admin';
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

  const reloadRoster = useCallback(async (teamId) => {
    try {
      const roster = await fetchTeamWorkers(teamId);
      setRosters(prev => ({ ...prev, [teamId]: roster }));
    } catch {
      // Keep whatever roster is already cached rather than blanking it on a
      // transient failure.
    }
  }, []);

  // An authority only handles their own department by default — the
  // cross-department comparison grid is an admin ("just monitor") view.
  // As soon as that one card's id is known, expand it straight away so
  // the crew-grouped member list is visible without an extra click.
  useEffect(() => {
    if (isAdmin || expanded) return;
    const mine = (data.teams || []).find(t => t.is_mine);
    if (mine) {
      setExpanded(mine.id);
      reloadRoster(mine.id);
    }
  }, [isAdmin, data.teams, expanded, reloadRoster]);

  const toggleRoster = async (teamId) => {
    if (expanded === teamId) return setExpanded(null);
    setExpanded(teamId);
    if (!rosters[teamId]) await reloadRoster(teamId);
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

  // `teams` stays the FULL list — the transfer "Send to..." picker below
  // still needs every agency as a possible destination regardless of who's
  // allowed to see the comparison grid. Only the rendered cards are scoped:
  // an authority handles their own department by default and doesn't see
  // the others; admin is the "just monitor everything" role.
  const teams = data.teams || [];
  const visibleTeams = isAdmin ? teams : teams.filter(t => t.is_mine);
  const worstFirst = [...visibleTeams].sort((a, b) => {
    const rank = { bottleneck: 0, strained: 1, healthy: 2 };
    return rank[a.status] - rank[b.status];
  });

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: '#f1f5f9' }}>
            {isAdmin ? 'Teams' : (visibleTeams[0]?.name ? `${visibleTeams[0].name} Team` : 'Your Team')}
          </h1>
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
                  {!isAdmin && team.is_mine && (
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
                <div className="px-5 pb-5 space-y-4">
                  {/* Every card rendered here already passed the visibility
                      filter above (admin sees all, an authority only their
                      own), so whoever is looking at it is always allowed to
                      manage it — no read-only fallback needed. */}
                  {(rosters[team.id] || []).length === 0 ? (
                    <p className="text-xs" style={{ color: '#64748b' }}>
                      No workers on this team{team.open_count > 0 ? ' — work here has nobody to pick it up.' : '.'}
                    </p>
                  ) : (
                    <CrewManager
                      teamId={team.id}
                      roster={rosters[team.id] || []}
                      onChanged={() => reloadRoster(team.id)}
                    />
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
