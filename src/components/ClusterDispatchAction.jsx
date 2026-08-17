import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Send, Loader2, X, CheckCircle2, AlertTriangle, ArrowRight } from 'lucide-react';
import { fetchTeams, fetchCrews, dispatchToTeam } from '../api/reportsApi';

// Best-guess default team for a cluster's category, so the picker opens
// with a sensible choice already made instead of a blank dropdown. This is
// only ever a starting point — the person dispatching can change it before
// confirming, and the backend enforces the real permission boundary
// regardless of what's selected here.
const CATEGORY_TEAM_HINT = {
  'Road Damage': 'MBMB',
  'Street Lighting': 'MBMB',
  Vandalism: 'MBMB',
  'Other Infrastructure': 'MBMB',
  'Drainage System': 'JKR',
  'Waste Management': 'SWCorp',
};
const SYSTEMIC_TEAM_HINT = {
  'Drainage & Road Decay': 'JKR',
  'Darkness & Vandalism Zone': 'MBMB',
  'Waste-Induced Drainage Blockages': 'SWCorp',
};

const OPEN_STATUSES = ['Pending', 'In Review'];

/**
 * Turns a Today's Priorities / hotspot recommendation into an actual
 * dispatch, instead of leaving "send this to JKR/MBMB" as something the
 * reader has to go do manually in the Reports table.
 *
 * Deliberately not one-click-no-confirmation: a cluster is an algorithmic
 * grouping (proximity + category), not a verified judgment call, so a crew
 * only gets sent after a person looks at the team/crew choice and confirms.
 * Only dispatches reports still Pending/In Review — anything already being
 * worked keeps its existing assignment untouched.
 */
export function ClusterDispatchAction({ item, onDispatched }) {
  const [open, setOpen] = useState(false);
  const [teams, setTeams] = useState(null);
  const [teamsError, setTeamsError] = useState(null);
  const [crews, setCrews] = useState([]);
  const [selectedTeam, setSelectedTeam] = useState('');
  const [selectedCrew, setSelectedCrew] = useState('');
  const [note, setNote] = useState(item.recommendation || '');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);

  const eligible = item.items.filter((r) => OPEN_STATUSES.includes(r.status));

  useEffect(() => {
    if (!open || teams) return;
    fetchTeams()
      .then((list) => {
        setTeams(list);
        const hint = SYSTEMIC_TEAM_HINT[item.category] || CATEGORY_TEAM_HINT[item.category];
        const match = hint && list.find((t) => t.name === hint);
        if (match) setSelectedTeam(String(match.id));
      })
      .catch((e) => setTeamsError(e.message || 'Failed to load teams'));
  }, [open, teams, item.category]);

  useEffect(() => {
    if (!selectedTeam) {
      setCrews([]);
      setSelectedCrew('');
      return;
    }
    fetchCrews(Number(selectedTeam))
      .then(setCrews)
      .catch(() => setCrews([]));
  }, [selectedTeam]);

  const handleConfirm = async () => {
    if (!selectedTeam || eligible.length === 0) return;
    setBusy(true);
    const outcomes = await Promise.allSettled(
      eligible.map((r) =>
        dispatchToTeam(r.id, Number(selectedTeam), null, note, selectedCrew ? Number(selectedCrew) : null)
      )
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
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold shrink-0 whitespace-nowrap"
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
            <div className="flex gap-2 flex-wrap">
              <select
                value={selectedTeam}
                onChange={(e) => setSelectedTeam(e.target.value)}
                className="flex-1 min-w-[120px] rounded-lg px-2 py-1.5 text-xs"
                style={{ background: 'var(--cream-100)', border: '1px solid rgba(31,30,26,0.12)' }}
              >
                <option value="">Select team…</option>
                {teams.map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
              <select
                value={selectedCrew}
                onChange={(e) => setSelectedCrew(e.target.value)}
                disabled={!selectedTeam || crews.length === 0}
                className="flex-1 min-w-[120px] rounded-lg px-2 py-1.5 text-xs disabled:opacity-50"
                style={{ background: 'var(--cream-100)', border: '1px solid rgba(31,30,26,0.12)' }}
              >
                <option value="">Whole team pool</option>
                {crews.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
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
              className="px-3 py-1.5 rounded-lg text-xs font-semibold"
              style={{ color: '#4b473d' }}
            >
              Cancel
            </button>
            <button
              onClick={handleConfirm}
              disabled={!selectedTeam || busy}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold disabled:opacity-50"
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
