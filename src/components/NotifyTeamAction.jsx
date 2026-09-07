import { useState, useEffect } from 'react';
import { Bell, Loader2, X, CheckCircle2, AlertTriangle } from 'lucide-react';
import { fetchTeams, sendTeamNotification } from '../api/reportsApi';

/**
 * Flags a location for a team to check, without touching any report.
 *
 * Predictive Hotspots (recurring failures and systemic advisories) is built
 * entirely from reports already marked Resolved, so ClusterDispatchAction's
 * "send this to a team" doesn't apply here — there's no open work to
 * reassign. This is the equivalent action for that read-only context: a
 * standalone advisory that reaches the team's own notification feed.
 */
export function NotifyTeamAction({ title, body = '', address, latitude, longitude, defaultTeamName }) {
  const [open, setOpen] = useState(false);
  const [teams, setTeams] = useState(null);
  const [teamsError, setTeamsError] = useState(null);
  const [agencyId, setAgencyId] = useState('');
  const [note, setNote] = useState(body);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);

  useEffect(() => {
    if (!open || teams) return;
    fetchTeams()
      .then((list) => {
        setTeams(list);
        const match = defaultTeamName && list.find((t) => t.name === defaultTeamName);
        if (match) setAgencyId(String(match.id));
      })
      .catch((e) => setTeamsError(e.message || 'Failed to load teams'));
  }, [open, teams, defaultTeamName]);

  const handleSend = async () => {
    if (!agencyId) return;
    setBusy(true);
    try {
      await sendTeamNotification({ agencyId: Number(agencyId), title, body: note, address, latitude, longitude });
      setResult({ ok: true });
    } catch (e) {
      setResult({ ok: false, error: e.message || 'Failed to send' });
    }
    setBusy(false);
  };

  const close = () => {
    setOpen(false);
    setResult(null);
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold shrink-0 whitespace-nowrap transition-opacity hover:opacity-80"
        style={{ background: '#1d4ed8', color: '#fff' }}
      >
        <Bell size={12} /> Notify Team
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
          {result.ok ? (
            <CheckCircle2 size={16} className="text-[#15803d] shrink-0 mt-0.5" />
          ) : (
            <AlertTriangle size={16} className="text-amber-600 shrink-0 mt-0.5" />
          )}
          <div className="flex-1">
            <p className="font-semibold text-[#201f1b]">
              {result.ok ? 'Team notified — it will show in their notifications.' : `Failed to notify: ${result.error}`}
            </p>
          </div>
          <button onClick={close} className="text-[#8a8477] hover:text-[#201f1b] shrink-0">
            <X size={14} />
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-[#201f1b]">Notify a team to check this</span>
            <button onClick={close} className="text-[#8a8477] hover:text-[#201f1b]">
              <X size={14} />
            </button>
          </div>

          {teamsError ? (
            <p className="text-[11px] text-red-700">{teamsError}</p>
          ) : !teams ? (
            <p className="text-[11px] text-[#8a8477] flex items-center gap-1.5">
              <Loader2 size={12} className="animate-spin" /> Loading teams…
            </p>
          ) : (
            <select
              value={agencyId}
              onChange={(e) => setAgencyId(e.target.value)}
              className="w-full rounded-lg pl-2 pr-6 py-1.5 text-xs custom-select"
              style={{ backgroundColor: 'var(--cream-100)', border: '1px solid rgba(31,30,26,0.12)' }}
            >
              <option value="">Select team…</option>
              {teams.map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
          )}

          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            className="w-full rounded-lg px-2 py-1.5 text-xs resize-none"
            style={{ background: 'var(--cream-100)', border: '1px solid rgba(31,30,26,0.12)' }}
            placeholder="Note for the team (optional)"
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
              onClick={handleSend}
              disabled={!agencyId || busy}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold disabled:opacity-50 transition-opacity hover:opacity-80"
              style={{ background: '#1d4ed8', color: '#fff' }}
            >
              {busy ? <Loader2 size={12} className="animate-spin" /> : <Bell size={12} />}
              Send
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
