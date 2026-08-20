import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import { AUTHORITIES } from '../utils/authorities';
import {
  Users, Shield, Building2, Wrench, CheckCircle2, XCircle,
  Trash2, Plus, AlertTriangle, Clock, RefreshCw, UserCheck, UserX, Activity,
} from 'lucide-react';

const ROLE_COLORS = {
  admin: 'bg-[#3d4d34] text-white border-[#3d4d34]',
  authority: 'bg-[#4a5d3f]/10 text-[#3d4d34] border-[#4a5d3f]/25',
  worker: 'bg-stone-100 text-stone-700 border-stone-200',
};

// Two shapes reach this function: backend-served accounts, where role is
// plain ('authority' / 'worker') and the department lives in a separate
// `agency` field (main.py's _serialize_staff); and the local demo-account
// fallback, which bakes the department into the role string itself
// ('authority_mbmb'). Handling only the second shape is what made every
// real account except admin show up as "Unknown".
function parseRole(role, agency) {
  if (role === 'admin') return { type: 'admin', dept: null };
  if (role === 'authority') return { type: 'authority', dept: agency };
  if (role?.startsWith('authority_')) return { type: 'authority', dept: role.split('_').slice(1).join('_') };
  if (role === 'worker') return { type: 'worker', dept: agency };
  if (role?.startsWith('worker_')) return { type: 'worker', dept: role.split('_').slice(1).join('_') };
  return { type: 'unknown', dept: null };
}

function RoleBadge({ role, agency }) {
  const { type, dept } = parseRole(role, agency);
  // dept may be a short id ('mbmb', from the demo format) or a full agency
  // name (from the backend), so match against whichever field actually fits.
  const authority = dept ? AUTHORITIES.find(a => a.id === dept || a.name === dept || a.abbr === dept) : null;

  const cls = (type === 'authority' || type === 'worker') && authority?.color
    ? authority.color
    : ROLE_COLORS[type] || 'bg-stone-100 text-stone-700 border-stone-200';

  const deptAbbr = authority ? authority.abbr : dept ? dept.toUpperCase() : null;

  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold border ${cls}`}>
      {type.charAt(0).toUpperCase() + type.slice(1)}
      {deptAbbr && <span className="opacity-70">· {deptAbbr}</span>}
    </span>
  );
}

export function UserManagementPage() {
  const { getPendingRequests, getAllAccounts, resolveRequest, deleteAccount, createAccount, getAuditLog } = useAuth();

  const [tab, setTab] = useState('pending'); // pending | all | create | audit
  const [accounts, setAccounts] = useState([]);
  const [pending, setPending] = useState([]);
  const [auditLog, setAuditLog] = useState([]);
  const [refreshKey, setRefreshKey] = useState(0);

  // Create form
  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newDisplayName, setNewDisplayName] = useState('');
  const [newRoleType, setNewRoleType] = useState('authority');
  const [newDept, setNewDept] = useState('mbmb');
  const [createError, setCreateError] = useState('');
  const [createSuccess, setCreateSuccess] = useState('');

  // Accounts now come from the server, so these are async. The audit log is
  // still browser-local: it records actions taken in THIS browser only, which
  // is why it is labelled as such in the UI.
  const [loadError, setLoadError] = useState('');

  const refresh = useCallback(async () => {
    try {
      const [pendingRows, allRows] = await Promise.all([
        getPendingRequests(),
        getAllAccounts(),
      ]);
      setPending(pendingRows);
      setAccounts(allRows);
      setLoadError('');
    } catch (err) {
      setLoadError(err.message || 'Could not load accounts from the server.');
    }
    if (getAuditLog) setAuditLog(getAuditLog());
    setRefreshKey(k => k + 1);
  }, [getPendingRequests, getAllAccounts, getAuditLog]);

  useEffect(() => { refresh(); }, [refresh]);

  const handleResolve = async (staffId, decision) => {
    const result = await resolveRequest(staffId, decision);
    if (result && !result.ok) setLoadError(result.error);
    refresh();
  };

  const handleDelete = async (staffId, username) => {
    if (!window.confirm(`Delete account "${username}"? This cannot be undone.`)) return;
    const result = await deleteAccount(staffId);
    if (result && !result.ok) setLoadError(result.error);
    refresh();
  };

  const handleCreate = async (e) => {
    e.preventDefault();
    setCreateError(''); setCreateSuccess('');
    if (!newUsername || !newPassword || !newDisplayName) {
      setCreateError('Please fill in all fields.'); return;
    }
    const finalRole = newRoleType === 'admin' ? 'admin'
      : newRoleType === 'authority' ? `authority_${newDept}`
      : `worker_${newDept}`;
    const result = await createAccount(newUsername, newPassword, finalRole, newDisplayName);
    if (!result.ok) { setCreateError(result.error); return; }
    setCreateSuccess(`Account "${newUsername}" created on the server.`);
    setNewUsername(''); setNewPassword(''); setNewDisplayName('');
    refresh();
  };

  const activeAccounts = accounts.filter(a => a.status === 'active');

  return (
    <div className="p-8 pb-20">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="page-header-title">User Management</h1>
          <p className="page-header-sub">Manage accounts, approve requests, and review system activity.</p>
        </div>
        <button
          onClick={refresh}
          className="export-btn"
        >
          <RefreshCw size={15} /> Refresh
        </button>
      </div>

      {/* Pending notification banner */}
      {pending.length > 0 && (
        <div className="mb-6 flex items-center gap-3 p-4 rounded-2xl" style={{ background: '#ffffff', border: '1px solid rgba(31,30,26,0.08)', boxShadow: '0 8px 32px rgba(31,30,26,0.06)' }}>
          <div>
            <p className="font-bold" style={{ color: '#201f1b' }}>
              {pending.length} pending registration{pending.length > 1 ? 's' : ''} awaiting review
            </p>
            <p className="text-sm text-[#8a8477]">Approve or reject them in the "Pending Requests" tab.</p>
          </div>
          <button
            onClick={() => setTab('pending')}
            className="ml-auto px-4 py-2 bg-[#4a5d3f] text-white text-sm font-bold rounded-xl hover:bg-[#3d4d34] transition-colors border border-[#4a5d3f]"
          >
            Review Now
          </button>
        </div>
      )}

      {/* Tabs */}
      <div className="flex flex-wrap gap-2 mb-6 border-b border-[#1f1e1a]/8 pb-3">
        {[
          { id: 'pending', label: `Pending Requests (${pending.length})` },
          { id: 'all', label: `All Accounts (${accounts.length})` },
          { id: 'create', label: 'Create Account' },
          { id: 'audit', label: 'Audit Log' },
        ].map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all ${
              tab === t.id
                ? 'text-white shadow-sm'
                : 'hover:text-[#201f1b]'
            }`} style={tab === t.id ? { background: '#4a5d3f', border: '1px solid #4a5d3f' } : { color: '#8a8477' }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* PENDING REQUESTS TAB */}
      {tab === 'pending' && (
        <div className="rounded-2xl overflow-hidden" style={{ background: '#ffffff', border: '1px solid rgba(31,30,26,0.08)', boxShadow: '0 8px 32px rgba(31,30,26,0.06)' }}>
          {pending.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-[#8a8477]">
              <CheckCircle2 size={40} className="mb-3 opacity-40" />
              <p className="font-medium">No pending requests</p>
              <p className="text-sm">All registration requests have been reviewed.</p>
            </div>
          ) : (
            <table className="w-full text-left text-sm">
              <thead className="text-xs font-bold tracking-wider uppercase" style={{ background: 'var(--cream-200)', borderBottom: '1px solid rgba(31,30,26,0.07)', color: '#8a8477' }}>
                <tr>
                  <th className="px-6 py-4">Username</th>
                  <th className="px-6 py-4">Display Name</th>
                  <th className="px-6 py-4">Requested Role</th>
                  <th className="px-6 py-4">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {pending.map(acc => (
                   <tr key={acc.id} className="transition-colors hover:bg-[#4a5d3f]/5">
                     <td className="px-6 py-4 font-mono font-medium" style={{ color: '#8a8477' }}>{acc.username}</td>
                     <td className="px-6 py-4 font-semibold" style={{ color: '#201f1b' }}>{acc.agency || '—'}</td>
                    <td className="px-6 py-4"><RoleBadge role={acc.role} agency={acc.agency} /></td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => handleResolve(acc.id, 'active')}
                          className="flex items-center gap-1.5 px-4 py-2 bg-[#4a5d3f] text-white text-xs font-bold rounded-xl hover:bg-[#3d4d34] transition-colors border border-[#4a5d3f]"
                        >
                          Approve
                        </button>
                        <button
                          onClick={() => handleResolve(acc.id, 'rejected')}
                          className="flex items-center gap-1.5 px-4 py-2 bg-red-500/10 text-red-700 text-xs font-bold rounded-xl hover:bg-red-500/20 transition-colors border border-red-500/25"
                        >
                          Reject
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* ALL ACCOUNTS TAB */}
      {tab === 'all' && (
        <div className="rounded-2xl overflow-hidden" style={{ background: '#ffffff', border: '1px solid rgba(31,30,26,0.08)', boxShadow: '0 8px 32px rgba(31,30,26,0.06)' }}>
          <table className="w-full text-left text-sm">
            <thead className="text-xs font-bold tracking-wider uppercase" style={{ background: 'var(--cream-200)', borderBottom: '1px solid rgba(31,30,26,0.07)', color: '#8a8477' }}>
              <tr>
                <th className="px-6 py-4">Username</th>
                <th className="px-6 py-4">Display Name</th>
                <th className="px-6 py-4">Role</th>
                <th className="px-6 py-4">Status</th>
                <th className="px-6 py-4">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {accounts.map(acc => (
                <tr key={acc.id} className="transition-colors hover:bg-[#4a5d3f]/5">
                  <td className="px-6 py-4 font-mono font-medium" style={{ color: '#8a8477' }}>{acc.username}</td>
                  <td className="px-6 py-4 font-semibold" style={{ color: '#201f1b' }}>{acc.agency || '—'}</td>
                  <td className="px-6 py-4"><RoleBadge role={acc.role} agency={acc.agency} /></td>
                  <td className="px-6 py-4">
                    <span className={`px-2.5 py-1 rounded-full text-xs font-bold ${
                      acc.status === 'active'  ? 'bg-emerald-500/10 border border-emerald-500/30 text-emerald-700'  :
                     acc.status === 'pending' ? 'bg-amber-500/10 border border-amber-500/30 text-amber-700'  :
                     'bg-red-500/5 border border-red-500/20 text-red-700 line-through'
                    }`}>
                      {acc.status === 'active' ? 'Active' : acc.status === 'pending' ? 'Pending' : 'Rejected'}
                    </span>
                  </td>
                  <td className="px-6 py-4">
                    {acc.status === 'pending' && (
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => handleResolve(acc.id, 'active')}
                          className="flex items-center gap-1 px-3 py-1.5 bg-[#4a5d3f] text-white text-xs font-bold rounded-lg hover:bg-[#3d4d34] transition-colors border border-[#4a5d3f]"
                        >
                          Approve
                        </button>
                        <button
                          onClick={() => handleResolve(acc.id, 'rejected')}
                          className="flex items-center gap-1 px-3 py-1.5 bg-red-500/10 text-red-700 text-xs font-bold rounded-lg hover:bg-red-500/20 transition-colors border border-red-500/25"
                        >
                          Reject
                        </button>
                      </div>
                    )}
                    {acc.status !== 'pending' && acc.username !== 'admin' && (
                      <button
                        onClick={() => handleDelete(acc.id, acc.username)}
                        className="flex items-center gap-1 px-3 py-1.5 text-[#8a8477] hover:bg-red-500/5 hover:text-red-700 text-xs font-medium rounded-lg transition-colors border border-transparent"
                      >
                        Delete
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* CREATE ACCOUNT TAB */}
      {tab === 'create' && (
        <div className="max-w-lg">
          <div className="rounded-2xl p-6" style={{ background: '#ffffff', border: '1px solid rgba(31,30,26,0.08)', boxShadow: '0 8px 32px rgba(31,30,26,0.06)' }}>
            <h2 className="text-lg font-bold mb-1" style={{ color: '#201f1b' }}>
              Create New Account
            </h2>
            <p className="text-sm mb-6" style={{ color: '#8a8477' }}>Accounts created here are immediately active.</p>

            {createError && (
              <div className="flex items-center gap-2 mb-4 p-3 rounded-xl text-sm font-medium" style={{ background: 'rgba(185,28,28,0.08)', border: '1px solid rgba(185,28,28,0.25)', color: '#b91c1c' }}>
                {createError}
              </div>
            )}
            {createSuccess && (
              <div className="flex items-center gap-2 mb-4 p-3 rounded-xl text-sm font-medium" style={{ background: 'rgba(4,120,87,0.08)', border: '1px solid rgba(4,120,87,0.25)', color: '#047857' }}>
                {createSuccess}
              </div>
            )}

            <form onSubmit={handleCreate} className="space-y-4">
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider mb-1.5" style={{ color: '#8a8477' }}>Display Name</label>
                <input
                  type="text"
                  placeholder="e.g. Ahmad bin Razak"
                  value={newDisplayName}
                  onChange={e => setNewDisplayName(e.target.value)}
                  className="w-full px-4 py-2.5 rounded-xl text-sm outline-none focus:border-[#4a5d3f]/50 focus:ring-4 focus:ring-[#4a5d3f]/10" style={{ background: 'var(--cream-200)', border: '1px solid rgba(31,30,26,0.10)', color: '#201f1b' }}
                />
              </div>

              <div>
                <label className="block text-xs font-bold uppercase tracking-wider mb-1.5" style={{ color: '#8a8477' }}>Username</label>
                <input
                  type="text"
                  placeholder="e.g. ahmad_mbmb"
                  value={newUsername}
                  onChange={e => setNewUsername(e.target.value)}
                  className="w-full px-4 py-2.5 rounded-xl text-sm outline-none focus:border-[#4a5d3f]/50 focus:ring-4 focus:ring-[#4a5d3f]/10" style={{ background: 'var(--cream-200)', border: '1px solid rgba(31,30,26,0.10)', color: '#201f1b' }}
                />
              </div>

              <div>
                <label className="block text-xs font-bold uppercase tracking-wider mb-1.5" style={{ color: '#8a8477' }}>Password</label>
                <input
                  type="password"
                  placeholder="••••••••"
                  value={newPassword}
                  onChange={e => setNewPassword(e.target.value)}
                  className="w-full px-4 py-2.5 rounded-xl text-sm outline-none focus:border-[#4a5d3f]/50 focus:ring-4 focus:ring-[#4a5d3f]/10" style={{ background: 'var(--cream-200)', border: '1px solid rgba(31,30,26,0.10)', color: '#201f1b' }}
                />
              </div>

              <div>
                <label className="block text-xs font-bold uppercase tracking-wider mb-1.5" style={{ color: '#8a8477' }}>Role Type</label>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { id: 'admin', label: 'Admin', icon: <Shield size={13} /> },
                    { id: 'authority', label: 'Authority', icon: <Building2 size={13} /> },
                    { id: 'worker', label: 'Worker', icon: <Wrench size={13} /> },
                  ].map(r => (
                    <button
                      key={r.id}
                      type="button"
                      onClick={() => setNewRoleType(r.id)}
                      className={`flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl text-sm font-bold border transition-all ${
                        newRoleType === r.id
                          ? r.id === 'admin' ? 'bg-[#3d4d34] text-white border-[#3d4d34]'
                          : r.id === 'authority' ? 'bg-[#4a5d3f] text-white border-[#4a5d3f]'
                          : 'bg-[#d97757] text-white border-[#d97757]'
                          : 'bg-[#f5f1e6] text-[#4b473d] border-[#1f1e1a]/10 hover:border-[#1f1e1a]/20'
                      }`}
                    >
                      {r.icon} {r.label}
                    </button>
                  ))}
                </div>
              </div>

              {newRoleType !== 'admin' && (
                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider mb-1.5" style={{ color: '#8a8477' }}>Department</label>
                  <select
                    value={newDept}
                    onChange={e => setNewDept(e.target.value)}
                    className="w-full px-4 py-2.5 rounded-xl text-sm outline-none appearance-none cursor-pointer" style={{ background: 'var(--cream-200)', border: '1px solid rgba(31,30,26,0.10)', color: '#201f1b' }}
                  >
                    {AUTHORITIES.filter(a => ['mbmb', 'jkr', 'swcorp'].includes(a.id)).map(a => (
                      <option key={a.id} value={a.id}>{a.abbr} — {a.name}</option>
                    ))}
                  </select>
                </div>
              )}

              <button
                type="submit"
                className="w-full py-3 bg-[#4a5d3f] text-white font-bold text-sm rounded-xl hover:bg-[#3d4d34] transition-colors shadow-sm flex items-center justify-center gap-2"
              >
                <Plus size={16} /> Create Account
              </button>
            </form>
          </div>
        </div>
      )}

      {/* AUDIT LOG TAB */}
      {tab === 'audit' && (
        <div className="rounded-2xl overflow-hidden" style={{ background: '#ffffff', border: '1px solid rgba(31,30,26,0.08)', boxShadow: '0 8px 32px rgba(31,30,26,0.06)' }}>
          {auditLog.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-[#8a8477]">
              <Activity size={40} className="mb-3 opacity-40" />
              <p className="font-medium">No activity recorded yet</p>
            </div>
          ) : (
            <table className="w-full text-left text-sm">
              <thead className="text-xs font-bold tracking-wider uppercase" style={{ background: 'var(--cream-200)', borderBottom: '1px solid rgba(31,30,26,0.07)', color: '#8a8477' }}>
                <tr>
                  <th className="px-6 py-4">Time</th>
                  <th className="px-6 py-4">Actor</th>
                  <th className="px-6 py-4">Action</th>
                  <th className="px-6 py-4">Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {auditLog.map(log => (
                   <tr key={log.id} className="transition-colors hover:bg-[#4a5d3f]/5">
                     <td className="px-6 py-4 text-xs" style={{ color: '#8a8477' }}>
                      {new Date(log.timestamp).toLocaleString()}
                    </td>
                     <td className="px-6 py-4 font-mono font-medium" style={{ color: '#8a8477' }}>{log.actor}</td>
                    <td className="px-6 py-4">
                       <span className="px-2 py-1 rounded-md text-xs font-bold uppercase" style={{ background: 'rgba(74,93,63,0.10)', color: '#3d4d34' }}>
                        {log.action}
                      </span>
                    </td>
                     <td className="px-6 py-4" style={{ color: '#201f1b' }}>{log.detail}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}
