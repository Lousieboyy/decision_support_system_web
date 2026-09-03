import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Send, Loader2, X, CheckCircle2, AlertTriangle, ArrowRight } from 'lucide-react';
import { fetchTeams, fetchCrews, dispatchToTeam } from '../api/reportsApi';
import { canonicalizeCategory } from '../utils/analyticsMetrics';

// Best-guess default team for a report's own category, so each picker row
// opens with a sensible choice already made instead of a blank dropdown.
// This is only ever a starting point — the person dispatching can change
// it before confirming, and the backend enforces the real permission
// boundary regardless of what's selected here.
//
// MBMB is the local council, so it's the default for every local-scale
// category — including Drainage System (local drains/culverts), not just
// roads/lighting/vandalism. Waste Management defaults to SWCorp, the
// waste-management regulator. JKR isn't defaulted to anywhere anymore —
// it's still a selectable team for the rare state/federal-grade escalation,
// just no longer the first guess for a routine local drainage complaint.
const CATEGORY_TEAM_HINT = {
  'Road Damage': 'MBMB',
  'Street Lighting': 'MBMB',
  Vandalism: 'MBMB',
  'Other Infrastructure': 'MBMB',
  'Drainage System': 'MBMB',
  'Waste Management': 'SWCorp',
};

const OPEN_STATUSES = ['Pending', 'In Review'];

// A systemic advisory's items array deliberately mixes categories (e.g. a
// "Drainage & Road Decay" cluster holds both Road Damage and Drainage
// System reports) — that's the whole point of the cluster. Each report
// still belongs to exactly one department though, so this reads it off
// per-report instead of guessing one department for the whole cluster.
const deptForReport = (r) =>
  CATEGORY_TEAM_HINT[canonicalizeCategory(r.categories || r.ai_prediction)] || 'Other';

/**
 * Turns an Active Hotspots recommendation into an actual dispatch, instead
 * of leaving "send this to JKR/MBMB" as something the reader has to go do
 * manually in the Reports table.
 *
 * Deliberately not one-click-no-confirmation: a cluster is an algorithmic
 * grouping (proximity + category), not a verified judgment call, so a crew
 * only gets sent after a person looks at the team/crew choice and confirms.
 * Only dispatches reports still Pending/In Review — anything already being
 * worked keeps its existing assignment untouched.
 *
 * A cluster can span more than one department (any systemic advisory does,
 * by definition). Rather than forcing the whole cluster through one team
 * dropdown, reports are grouped by their own natural department and each
 * group gets its own team/crew picker — one Confirm still sends everything
 * in a single action, just routed to the right "hands" per report.
 */
export function ClusterDispatchAction({ item, onDispatched }) {
  const [open, setOpen] = useState(false);
  const [teams, setTeams] = useState(null);
  const [teamsError, setTeamsError] = useState(null);
  const [teamByGroup, setTeamByGroup] = useState({});
  const [crewByGroup, setCrewByGroup] = useState({});
  const [crewsByGroup, setCrewsByGroup] = useState({});
  const [note, setNote] = useState(item.recommendation || '');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);

  const eligible = item.items.filter((r) => OPEN_STATUSES.includes(r.status));

  const groups = eligible
    .reduce((acc, r) => {
      const dept = deptForReport(r);
      let group = acc.find((g) => g.dept === dept);
      if (!group) {
        group = { dept, reports: [] };
        acc.push(group);
      }
      group.reports.push(r);
      return acc;
    }, [])
    .sort((a, b) => b.reports.length - a.reports.length);

  // groups is derived fresh from item.items every render but is stable for
  // the lifetime of one open popup — the list above keys each card by
  // item.id, so switching clusters remounts this component instead of
  // reusing it. Safe to read here without listing it as a dependency.
  useEffect(() => {
    if (!open || teams) return;
    fetchTeams()
      .then((list) => {
        setTeams(list);
        const defaults = {};
        groups.forEach((g) => {
          const match = list.find((t) => t.name === g.dept);
          if (match) defaults[g.dept] = String(match.id);
        });
        setTeamByGroup(defaults);
        Object.entries(defaults).forEach(([dept, teamId]) => {
          fetchCrews(Number(teamId))
            .then((crewList) => setCrewsByGroup((prev) => ({ ...prev, [dept]: crewList })))
            .catch(() => {});
        });
      })
      .catch((e) => setTeamsError(e.message || 'Failed to load teams'));
  }, [open, teams]);

  const setTeamForGroup = (dept, teamId) => {
    setTeamByGroup((prev) => ({ ...prev, [dept]: teamId }));
    setCrewByGroup((prev) => ({ ...prev, [dept]: '' }));
    if (!teamId) return;
    fetchCrews(Number(teamId))
      .then((crewList) => setCrewsByGroup((prev) => ({ ...prev, [dept]: crewList })))
      .catch(() => setCrewsByGroup((prev) => ({ ...prev, [dept]: [] })));
  };

  const allAssigned = groups.length > 0 && groups.every((g) => teamByGroup[g.dept]);

  const handleConfirm = async () => {
    if (!allAssigned || eligible.length === 0) return;
    setBusy(true);
    const outcomes = await Promise.allSettled(
      eligible.map((r) => {
        const dept = deptForReport(r);
        const teamId = teamByGroup[dept];
        const crewId = crewByGroup[dept];
        return dispatchToTeam(r.id, Number(teamId), null, note, crewId ? Number(crewId) : null);
      })
    );
    const failed = outcomes
      .map((o, i) => ({ o, report: eligible[i] }))
      .filter((x) => x.o.status === 'rejected')
      .map((x) => ({ id: x.report.id, error: x.o.reason?.message || 'Failed' }));
    setResult({ ok: eligible.length - failed.length, failed });
    setBusy(false);
    if (failed.length < eligible.length) onDispatched?.();
  };

  const close = () => {
    setOpen(false);
    setResult(null);
    setTeamsError(null);
  };

  if (eligible.length === 0) {
    // Everything in the cluster has already moved past Pending/In Review —
    // show what actually happened to it instead of a dead-end label. Pulled
    // from the same report data the page already has, so it's as fresh as
    // the last refresh (after a dispatch, that means the dispatch itself).
    const counts = item.items.reduce((acc, r) => {
      const key =
        r.status === 'In Process'
          ? (r.assigned_worker_id ? 'claimed' : 'unclaimed in pool')
          : r.status === 'In Maintenance' ? 'work in progress'
          : r.status === 'Resolved' ? 'resolved'
          : r.status === 'Rejected' ? 'rejected'
          : (r.status || 'pending').toLowerCase();
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {});
    const summary = Object.entries(counts).map(([k, n]) => `${n} ${k}`).join(', ');

    return (
      <div className="flex items-center gap-2 flex-wrap text-[10px]">
        <span className="font-semibold text-[#8a8477]">{summary}</span>
        <Link
          to="/teams"
          className="flex items-center gap-0.5 font-bold"
          style={{ color: '#3d4d34' }}
        >
          Track in Teams <ArrowRight size={10} />
        </Link>
      </div>
    );
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold shrink-0 whitespace-nowrap transition-opacity hover:opacity-80"
        style={{ background: '#3d4d34', color: '#fff' }}
      >
        <Send size={12} /> Dispatch
      </button>
    );
  }

  return (
    <div
      className="mt-2 p-3 rounded-lg border w-full text-left"
      style={{ background: '#ffffff', borderColor: 'rgba(31,30,26,0.10)' }}
    >
      {result ? (
        <div className="flex items-start gap-2 text-xs">
          {result.failed.length === 0 ? (
            <CheckCircle2 size={16} className="text-[#15803d] shrink-0 mt-0.5" />
          ) : (
            <AlertTriangle size={16} className="text-amber-600 shrink-0 mt-0.5" />
          )}
          <div className="flex-1">
            <p className="font-semibold text-[#201f1b]">
              Dispatched {result.ok} of {eligible.length} report{eligible.length === 1 ? '' : 's'}.
            </p>
            {result.failed.length > 0 && (
              <p className="text-[#8a8477] mt-1">
                {result.failed.length} failed — {result.failed.map((f) => `#${f.id}: ${f.error}`).join('; ')}
              </p>
            )}
          </div>
          <button onClick={close} className="text-[#8a8477] hover:text-[#201f1b] shrink-0">
            <X size={14} />
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-[#201f1b]">
              Dispatch {eligible.length} of {item.items.length} report{item.items.length === 1 ? '' : 's'}
            </span>
            <button onClick={close} className="text-[#8a8477] hover:text-[#201f1b]">
              <X size={14} />
            </button>
          </div>
          {item.items.length > eligible.length && (
            <p className="text-[10px] text-[#8a8477]">
              {item.items.length - eligible.length} already in progress — left untouched.
            </p>
          )}

          {teamsError ? (
            <p className="text-[11px] text-red-700">{teamsError}</p>
          ) : !teams ? (
            <p className="text-[11px] text-[#8a8477] flex items-center gap-1.5">
              <Loader2 size={12} className="animate-spin" /> Loading teams…
            </p>
          ) : (
            <div className="space-y-1.5">
              {groups.length > 1 && (
                <p className="text-[10px] text-[#8a8477]">
                  Spans {groups.length} departments — each gets its own team below, dispatched together in one Confirm.
                </p>
              )}
              {groups.map((g) => (
                <div key={g.dept} className="flex gap-2 flex-wrap items-center">
                  {groups.length > 1 && (
                    <span className="text-[10px] font-bold text-[#4b473d] shrink-0">
                      {g.dept} · {g.reports.length}
                    </span>
                  )}
                  <select
                    value={teamByGroup[g.dept] || ''}
                    onChange={(e) => setTeamForGroup(g.dept, e.target.value)}
                    className="flex-1 min-w-[120px] rounded-lg px-2 py-1.5 text-xs"
                    style={{ background: 'var(--cream-100)', border: '1px solid rgba(31,30,26,0.12)' }}
                  >
                    <option value="">Select team…</option>
                    {teams.map((t) => (
                      <option key={t.id} value={t.id}>{t.name}</option>
                    ))}
                  </select>
                  <select
                    value={crewByGroup[g.dept] || ''}
                    onChange={(e) => setCrewByGroup((prev) => ({ ...prev, [g.dept]: e.target.value }))}
                    disabled={!teamByGroup[g.dept] || (crewsByGroup[g.dept] || []).length === 0}
                    className="flex-1 min-w-[120px] rounded-lg px-2 py-1.5 text-xs disabled:opacity-50"
                    style={{ background: 'var(--cream-100)', border: '1px solid rgba(31,30,26,0.12)' }}
                  >
                    <option value="">Whole team pool</option>
                    {(crewsByGroup[g.dept] || []).map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
          )}

          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            className="w-full rounded-lg px-2 py-1.5 text-xs resize-none"
            style={{ background: 'var(--cream-100)', border: '1px solid rgba(31,30,26,0.12)' }}
            placeholder="Note to the crew (optional)"
          />

          <div className="flex justify-end gap-2">
            <button
              onClick={close}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors hover:bg-[#f5f1e6]"
              style={{ color: '#4b473d' }}
            >
              Cancel
            </button>
            <button
              onClick={handleConfirm}
              disabled={!allAssigned || busy}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold disabled:opacity-50 transition-opacity hover:opacity-80"
              style={{ background: '#3d4d34', color: '#fff' }}
            >
              {busy ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />}
              Confirm Dispatch
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
