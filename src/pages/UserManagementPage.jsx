import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import { AUTHORITIES } from '../utils/authorities';
import {
  Users, Shield, Building2, Wrench, CheckCircle2, XCircle,
  Trash2, Plus, AlertTriangle, Clock, RefreshCw, UserCheck, UserX, Activity,
} from 'lucide-react';

const ROLE_COLORS = {
  admin: 'bg-zinc-800 text-zinc-200 border-zinc-700',
  authority: 'bg-zinc-700/20 text-zinc-300 border-zinc-700/30',
  worker: 'bg-zinc-700/40 text-zinc-200 border-zinc-650/40',
};

function parseRole(role) {
  if (role === 'admin') return { type: 'admin', dept: null };
  if (role?.startsWith('authority_')) return { type: 'authority', dept: role.split('_').slice(1).join('_') };
  if (role?.startsWith('worker_')) return { type: 'worker', dept: role.split('_').slice(1).join('_') };
  return { type: 'unknown', dept: null };
}

function RoleBadge({ role }) {
  const { type, dept } = parseRole(role);
  const authority = dept ? AUTHORITIES.find(a => a.id === dept) : null;
  
  const cls = (type === 'authority' || type === 'worker') && authority?.color 
    ? authority.color 
    : ROLE_COLORS[type] || 'bg-slate-100 text-slate-700 border-slate-200';
    
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

  const refresh = useCallback(() => {
    setPending(getPendingRequests());
    setAccounts(getAllAccounts());
    if (getAuditLog) setAuditLog(getAuditLog());
    setRefreshKey(k => k + 1);
  }, [getPendingRequests, getAllAccounts, getAuditLog]);

  useEffect(() => { refresh(); }, [refresh]);

  const handleResolve = (username, decision) => {
    resolveRequest(username, decision);
    refresh();
  };

  const handleDelete = (username) => {
    if (!window.confirm(`Delete account "${username}"? This cannot be undone.`)) return;
    deleteAccount(username);
    refresh();
  };

  const handleCreate = (e) => {
    e.preventDefault();
    setCreateError(''); setCreateSuccess('');
    if (!newUsername || !newPassword || !newDisplayName) {
      setCreateError('Please fill in all fields.'); return;
    }
    const finalRole = newRoleType === 'admin' ? 'admin'
      : newRoleType === 'authority' ? `authority_${newDept}`
      : `worker_${newDept}`;
    const result = createAccount(newUsername, newPassword, finalRole, newDisplayName);
    if (!result.ok) { setCreateError(result.error); return; }
    setCreateSuccess(`Account "${newUsername}" created successfully.`);
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
          className="flex items-center gap-2 px-4 py-2 rounded-lg border text-sm font-semibold transition-colors" style={{ background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.10)', color: 'rgba(203,213,225,0.85)' }}
        >
          <RefreshCw size={15} /> Refresh
        </button>
      </div>

      {/* Pending notification banner */}
      {pending.length > 0 && (
        <div className="mb-6 flex items-center gap-3 p-4 rounded-2xl" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}>
          <div>
            <p className="font-bold text-white">
              {pending.length} pending registration{pending.length > 1 ? 's' : ''} awaiting review
            </p>
            <p className="text-sm text-slate-400">Approve or reject them in the "Pending Requests" tab.</p>
          </div>
          <button
            onClick={() => setTab('pending')}
            className="ml-auto px-4 py-2 bg-white text-black text-sm font-bold rounded-xl hover:bg-zinc-200 transition-colors border border-white"
          >
            Review Now
          </button>
        </div>
      )}

      {/* Tabs */}
      <div className="flex flex-wrap gap-2 mb-6 border-b border-white/5 pb-3">
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
                : 'hover:text-slate-300'
            }`} style={tab === t.id ? { background: 'rgba(255,255,255,0.12)', border: '1px solid rgba(255,255,255,0.18)' } : { color: 'rgba(148,163,184,0.7)' }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* PENDING REQUESTS TAB */}
      {tab === 'pending' && (
        <div className="rounded-2xl overflow-hidden" style={{ background: 'rgba(255,255,255,0.055)', backdropFilter: 'blur(20px)', border: '1px solid rgba(255,255,255,0.09)' }}>
          {pending.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-slate-400">
              <CheckCircle2 size={40} className="mb-3 opacity-40" />
              <p className="font-medium">No pending requests</p>
              <p className="text-sm">All registration requests have been reviewed.</p>
            </div>
          ) : (
            <table className="w-full text-left text-sm">
              <thead className="text-xs font-bold tracking-wider uppercase" style={{ background: 'rgba(255,255,255,0.04)', borderBottom: '1px solid rgba(255,255,255,0.07)', color: 'rgba(148,163,184,0.65)' }}>
                <tr>
                  <th className="px-6 py-4">Username</th>
                  <th className="px-6 py-4">Display Name</th>
                  <th className="px-6 py-4">Requested Role</th>
                  <th className="px-6 py-4">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {pending.map(acc => (
                   <tr key={acc.username} className="transition-colors hover:bg-white/5">
                     <td className="px-6 py-4 font-mono font-medium" style={{ color: 'rgba(148,163,184,0.8)' }}>{acc.username}</td>
                     <td className="px-6 py-4 font-semibold" style={{ color: '#e2e8f0' }}>{acc.displayName}</td>
                    <td className="px-6 py-4"><RoleBadge role={acc.role} /></td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => handleResolve(acc.username, 'active')}
                          className="flex items-center gap-1.5 px-4 py-2 bg-white text-black text-xs font-bold rounded-xl hover:bg-zinc-200 transition-colors border border-white"
                        >
                          Approve
                        </button>
                        <button
                          onClick={() => handleResolve(acc.username, 'rejected')}
                          className="flex items-center gap-1.5 px-4 py-2 bg-zinc-800 text-zinc-300 text-xs font-bold rounded-xl hover:bg-zinc-700 transition-colors border border-zinc-700"
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
        <div className="rounded-2xl overflow-hidden" style={{ background: 'rgba(255,255,255,0.055)', backdropFilter: 'blur(20px)', border: '1px solid rgba(255,255,255,0.09)' }}>
          <table className="w-full text-left text-sm">
            <thead className="text-xs font-bold tracking-wider uppercase" style={{ background: 'rgba(255,255,255,0.04)', borderBottom: '1px solid rgba(255,255,255,0.07)', color: 'rgba(148,163,184,0.65)' }}>
              <tr>
                <th className="px-6 py-4">Username</th>
                <th className="px-6 py-4">Display Name</th>
                <th className="px-6 py-4">Role</th>
                <th className="px-6 py-4">Status</th>
                <th className="px-6 py-4">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {accounts.map(acc => (
                <tr key={acc.username} className="transition-colors hover:bg-white/5">
                  <td className="px-6 py-4 font-mono font-medium" style={{ color: 'rgba(148,163,184,0.8)' }}>{acc.username}</td>
                  <td className="px-6 py-4 font-semibold" style={{ color: '#e2e8f0' }}>{acc.displayName}</td>
                  <td className="px-6 py-4"><RoleBadge role={acc.role} /></td>
                  <td className="px-6 py-4">
                    <span className={`px-2.5 py-1 rounded-full text-xs font-bold ${
                      acc.status === 'active'  ? 'bg-white text-black border border-white'  :
                     acc.status === 'pending' ? 'bg-zinc-800/40 border border-zinc-700/30 text-zinc-350'  :
                     'bg-transparent border border-zinc-850 text-zinc-500 line-through'
                    }`}>
                      {acc.status === 'active' ? 'Active' : acc.status === 'pending' ? 'Pending' : 'Rejected'}
                    </span>
                  </td>
                  <td className="px-6 py-4">
                    {acc.status === 'pending' && (
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => handleResolve(acc.username, 'active')}
                          className="flex items-center gap-1 px-3 py-1.5 bg-white text-black text-xs font-bold rounded-lg hover:bg-zinc-200 transition-colors border border-white"
                        >
                          Approve
                        </button>
                        <button
                          onClick={() => handleResolve(acc.username, 'rejected')}
                          className="flex items-center gap-1 px-3 py-1.5 bg-zinc-800 text-zinc-300 text-xs font-bold rounded-lg hover:bg-zinc-700 transition-colors border border-zinc-700"
                        >
                          Reject
                        </button>
                      </div>
                    )}
                    {acc.status !== 'pending' && acc.username !== 'admin' && (
                      <button
                        onClick={() => handleDelete(acc.username)}
                        className="flex items-center gap-1 px-3 py-1.5 text-zinc-400 hover:bg-white/5 text-xs font-medium rounded-lg transition-colors border border-transparent"
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
          <div className="rounded-2xl p-6" style={{ background: 'rgba(255,255,255,0.055)', backdropFilter: 'blur(20px)', border: '1px solid rgba(255,255,255,0.09)' }}>
            <h2 className="text-lg font-bold mb-1" style={{ color: '#f1f5f9' }}>
              Create New Account
            </h2>
            <p className="text-sm mb-6" style={{ color: 'rgba(148,163,184,0.6)' }}>Accounts created here are immediately active.</p>

            {createError && (
              <div className="flex items-center gap-2 mb-4 p-3 rounded-xl text-sm font-medium" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', color: '#cbd5e1' }}>
                {createError}
              </div>
            )}
            {createSuccess && (
              <div className="flex items-center gap-2 mb-4 p-3 rounded-xl text-sm font-medium" style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.15)', color: '#ffffff' }}>
                {createSuccess}
              </div>
            )}

            <form onSubmit={handleCreate} className="space-y-4">
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider mb-1.5" style={{ color: 'rgba(148,163,184,0.75)' }}>Display Name</label>
                <input
                  type="text"
                  placeholder="e.g. Ahmad bin Razak"
                  value={newDisplayName}
                  onChange={e => setNewDisplayName(e.target.value)}
                  className="w-full px-4 py-2.5 rounded-xl text-sm outline-none" style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.10)', color: '#f1f5f9' }}
                />
              </div>

              <div>
                <label className="block text-xs font-bold uppercase tracking-wider mb-1.5" style={{ color: 'rgba(148,163,184,0.75)' }}>Username</label>
                <input
                  type="text"
                  placeholder="e.g. ahmad_mbmb"
                  value={newUsername}
                  onChange={e => setNewUsername(e.target.value)}
                  className="w-full px-4 py-2.5 rounded-xl text-sm outline-none" style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.10)', color: '#f1f5f9' }}
                />
              </div>

              <div>
                <label className="block text-xs font-bold uppercase tracking-wider mb-1.5" style={{ color: 'rgba(148,163,184,0.75)' }}>Password</label>
                <input
                  type="password"
                  placeholder="••••••••"
                  value={newPassword}
                  onChange={e => setNewPassword(e.target.value)}
                  className="w-full px-4 py-2.5 rounded-xl text-sm outline-none" style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.10)', color: '#f1f5f9' }}
                />
              </div>

              <div>
                <label className="block text-xs font-bold uppercase tracking-wider mb-1.5" style={{ color: 'rgba(148,163,184,0.75)' }}>Role Type</label>
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
                          ? r.id === 'admin' ? 'bg-white text-black border-white'
                          : r.id === 'authority' ? 'bg-zinc-200 text-black border-zinc-200'
                          : 'bg-zinc-400 text-black border-zinc-400'
                          : 'bg-white/6 text-slate-300 border-white/10 hover:border-white/20'
                      }`}
                    >
                      {r.icon} {r.label}
                    </button>
                  ))}
                </div>
              </div>

              {newRoleType !== 'admin' && (
                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider mb-1.5" style={{ color: 'rgba(148,163,184,0.75)' }}>Department</label>
                  <select
                    value={newDept}
                    onChange={e => setNewDept(e.target.value)}
                    className="w-full px-4 py-2.5 rounded-xl text-sm outline-none appearance-none cursor-pointer" style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.10)', color: '#f1f5f9' }}
                  >
                    {AUTHORITIES.filter(a => ['mbmb', 'jkr', 'swcorp'].includes(a.id)).map(a => (
                      <option key={a.id} value={a.id}>{a.abbr} — {a.name}</option>
                    ))}
                  </select>
                </div>
              )}

              <button
                type="submit"
                className="w-full py-3 bg-white text-black font-bold text-sm rounded-xl hover:bg-slate-200 transition-colors shadow-sm flex items-center justify-center gap-2"
              >
                <Plus size={16} /> Create Account
              </button>
            </form>
          </div>
        </div>
      )}

      {/* AUDIT LOG TAB */}
      {tab === 'audit' && (
        <div className="rounded-2xl overflow-hidden" style={{ background: 'rgba(255,255,255,0.055)', backdropFilter: 'blur(20px)', border: '1px solid rgba(255,255,255,0.09)' }}>
          {auditLog.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-slate-400">
              <Activity size={40} className="mb-3 opacity-40" />
              <p className="font-medium">No activity recorded yet</p>
            </div>
          ) : (
            <table className="w-full text-left text-sm">
              <thead className="text-xs font-bold tracking-wider uppercase" style={{ background: 'rgba(255,255,255,0.04)', borderBottom: '1px solid rgba(255,255,255,0.07)', color: 'rgba(148,163,184,0.65)' }}>
                <tr>
                  <th className="px-6 py-4">Time</th>
                  <th className="px-6 py-4">Actor</th>
                  <th className="px-6 py-4">Action</th>
                  <th className="px-6 py-4">Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {auditLog.map(log => (
                   <tr key={log.id} className="transition-colors hover:bg-white/5">
                     <td className="px-6 py-4 text-xs" style={{ color: 'rgba(148,163,184,0.6)' }}>
                      {new Date(log.timestamp).toLocaleString()}
                    </td>
                     <td className="px-6 py-4 font-mono font-medium" style={{ color: 'rgba(148,163,184,0.8)' }}>{log.actor}</td>
                    <td className="px-6 py-4">
                       <span className="px-2 py-1 rounded-md text-xs font-bold uppercase" style={{ background: 'rgba(255,255,255,0.08)', color: 'rgba(148,163,184,0.8)' }}>
                        {log.action}
                      </span>
                    </td>
                     <td className="px-6 py-4" style={{ color: '#e2e8f0' }}>{log.detail}</td>
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
