import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import { AUTHORITIES } from '../utils/authorities';
import {
  Users, Shield, Building2, Wrench, CheckCircle2, XCircle,
  Trash2, Plus, AlertTriangle, Clock, RefreshCw, UserCheck, UserX,
} from 'lucide-react';

const ROLE_COLORS = {
  admin: 'bg-purple-100 text-purple-800 border-purple-200',
  authority: 'bg-amber-100 text-amber-800 border-amber-200',
  worker: 'bg-blue-100 text-blue-800 border-blue-200',
};

function parseRole(role) {
  if (role === 'admin') return { type: 'admin', dept: null };
  if (role?.startsWith('authority_')) return { type: 'authority', dept: role.split('_').slice(1).join('_') };
  if (role?.startsWith('worker_')) return { type: 'worker', dept: role.split('_').slice(1).join('_') };
  return { type: 'unknown', dept: null };
}

function RoleBadge({ role }) {
  const { type, dept } = parseRole(role);
  const cls = ROLE_COLORS[type] || 'bg-slate-100 text-slate-700 border-slate-200';
  const icon = type === 'admin' ? <Shield size={11} /> : type === 'authority' ? <Building2 size={11} /> : <Wrench size={11} />;
  const deptAbbr = dept ? AUTHORITIES.find(a => a.id === dept)?.abbr || dept.toUpperCase() : null;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold border ${cls}`}>
      {icon}
      {type.charAt(0).toUpperCase() + type.slice(1)}
      {deptAbbr && <span className="opacity-70">· {deptAbbr}</span>}
    </span>
  );
}

export function UserManagementPage() {
  const { getPendingRequests, getAllAccounts, resolveRequest, deleteAccount, createAccount } = useAuth();

  const [tab, setTab] = useState('pending'); // pending | all | create
  const [accounts, setAccounts] = useState([]);
  const [pending, setPending] = useState([]);
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
    setRefreshKey(k => k + 1);
  }, [getPendingRequests, getAllAccounts]);

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
          <h1 className="text-3xl font-bold tracking-tight text-slate-900 mb-1">User Management</h1>
          <p className="text-slate-500">Manage accounts, approve requests, and control access.</p>
        </div>
        <button
          onClick={refresh}
          className="flex items-center gap-2 bg-white px-4 py-2 rounded-lg border border-slate-200 shadow-sm text-sm font-medium text-slate-600 hover:text-primary-600 hover:border-primary-200 transition-colors"
        >
          <RefreshCw size={15} /> Refresh
        </button>
      </div>

      {/* Pending notification banner */}
      {pending.length > 0 && (
        <div className="mb-6 flex items-center gap-3 p-4 bg-amber-50 border border-amber-200 rounded-2xl">
          <Clock size={20} className="text-amber-500 shrink-0" />
          <div>
            <p className="font-bold text-amber-800">
              {pending.length} pending registration{pending.length > 1 ? 's' : ''} awaiting review
            </p>
            <p className="text-sm text-amber-600">Approve or reject them in the "Pending Requests" tab.</p>
          </div>
          <button
            onClick={() => setTab('pending')}
            className="ml-auto px-4 py-2 bg-amber-500 text-white text-sm font-bold rounded-xl hover:bg-amber-600 transition-colors"
          >
            Review Now
          </button>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 mb-6 bg-slate-100 p-1 rounded-xl w-fit">
        {[
          { id: 'pending', label: `Pending Requests (${pending.length})`, icon: <Clock size={15} /> },
          { id: 'all', label: `All Accounts (${activeAccounts.length})`, icon: <Users size={15} /> },
          { id: 'create', label: 'Create Account', icon: <Plus size={15} /> },
        ].map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all ${
              tab === t.id
                ? 'bg-white text-primary-700 shadow-sm'
                : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      {/* PENDING REQUESTS TAB */}
      {tab === 'pending' && (
        <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
          {pending.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-slate-400">
              <CheckCircle2 size={40} className="mb-3 opacity-40" />
              <p className="font-medium">No pending requests</p>
              <p className="text-sm">All registration requests have been reviewed.</p>
            </div>
          ) : (
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-slate-500 border-b border-slate-200 uppercase text-xs font-bold tracking-wider">
                <tr>
                  <th className="px-6 py-4">Username</th>
                  <th className="px-6 py-4">Display Name</th>
                  <th className="px-6 py-4">Requested Role</th>
                  <th className="px-6 py-4">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {pending.map(acc => (
                  <tr key={acc.username} className="hover:bg-slate-50 transition-colors">
                    <td className="px-6 py-4 font-mono text-slate-700 font-medium">{acc.username}</td>
                    <td className="px-6 py-4 text-slate-800 font-semibold">{acc.displayName}</td>
                    <td className="px-6 py-4"><RoleBadge role={acc.role} /></td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => handleResolve(acc.username, 'active')}
                          className="flex items-center gap-1.5 px-4 py-2 bg-green-500 text-white text-xs font-bold rounded-xl hover:bg-green-600 transition-colors"
                        >
                          <UserCheck size={13} /> Approve
                        </button>
                        <button
                          onClick={() => handleResolve(acc.username, 'rejected')}
                          className="flex items-center gap-1.5 px-4 py-2 bg-red-500 text-white text-xs font-bold rounded-xl hover:bg-red-600 transition-colors"
                        >
                          <UserX size={13} /> Reject
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
        <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-slate-500 border-b border-slate-200 uppercase text-xs font-bold tracking-wider">
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
                <tr key={acc.username} className="hover:bg-slate-50 transition-colors">
                  <td className="px-6 py-4 font-mono text-slate-700 font-medium">{acc.username}</td>
                  <td className="px-6 py-4 text-slate-800 font-semibold">{acc.displayName}</td>
                  <td className="px-6 py-4"><RoleBadge role={acc.role} /></td>
                  <td className="px-6 py-4">
                    <span className={`px-2.5 py-1 rounded-full text-xs font-bold ${
                      acc.status === 'active' ? 'bg-green-100 text-green-800' :
                      acc.status === 'pending' ? 'bg-amber-100 text-amber-800' :
                      'bg-red-100 text-red-800'
                    }`}>
                      {acc.status === 'active' ? '✓ Active' : acc.status === 'pending' ? '⏳ Pending' : '✗ Rejected'}
                    </span>
                  </td>
                  <td className="px-6 py-4">
                    {acc.status === 'pending' && (
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => handleResolve(acc.username, 'active')}
                          className="flex items-center gap-1 px-3 py-1.5 bg-green-100 text-green-700 text-xs font-bold rounded-lg hover:bg-green-200 transition-colors"
                        >
                          <CheckCircle2 size={12} /> Approve
                        </button>
                        <button
                          onClick={() => handleResolve(acc.username, 'rejected')}
                          className="flex items-center gap-1 px-3 py-1.5 bg-red-100 text-red-700 text-xs font-bold rounded-lg hover:bg-red-200 transition-colors"
                        >
                          <XCircle size={12} /> Reject
                        </button>
                      </div>
                    )}
                    {acc.status !== 'pending' && acc.username !== 'admin' && (
                      <button
                        onClick={() => handleDelete(acc.username)}
                        className="flex items-center gap-1 px-3 py-1.5 text-red-500 hover:bg-red-50 text-xs font-medium rounded-lg transition-colors"
                      >
                        <Trash2 size={12} /> Delete
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
          <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-6">
            <h2 className="text-lg font-bold text-slate-900 mb-1 flex items-center gap-2">
              <Plus size={18} className="text-primary-500" /> Create New Account
            </h2>
            <p className="text-sm text-slate-500 mb-6">Accounts created here are immediately active.</p>

            {createError && (
              <div className="flex items-center gap-2 mb-4 p-3 bg-red-50 border border-red-200 text-red-700 rounded-xl text-sm font-medium">
                <AlertTriangle size={15} /> {createError}
              </div>
            )}
            {createSuccess && (
              <div className="flex items-center gap-2 mb-4 p-3 bg-green-50 border border-green-200 text-green-700 rounded-xl text-sm font-medium">
                <CheckCircle2 size={15} /> {createSuccess}
              </div>
            )}

            <form onSubmit={handleCreate} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-600 uppercase tracking-wider mb-1.5">Display Name</label>
                <input
                  type="text"
                  placeholder="e.g. Ahmad bin Razak"
                  value={newDisplayName}
                  onChange={e => setNewDisplayName(e.target.value)}
                  className="w-full px-4 py-2.5 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-primary-500 focus:border-transparent outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-600 uppercase tracking-wider mb-1.5">Username</label>
                <input
                  type="text"
                  placeholder="e.g. ahmad_mbmb"
                  value={newUsername}
                  onChange={e => setNewUsername(e.target.value)}
                  className="w-full px-4 py-2.5 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-primary-500 focus:border-transparent outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-600 uppercase tracking-wider mb-1.5">Password</label>
                <input
                  type="password"
                  placeholder="••••••••"
                  value={newPassword}
                  onChange={e => setNewPassword(e.target.value)}
                  className="w-full px-4 py-2.5 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-primary-500 focus:border-transparent outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-600 uppercase tracking-wider mb-1.5">Role Type</label>
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
                          ? r.id === 'admin' ? 'bg-purple-500 text-white border-purple-500'
                          : r.id === 'authority' ? 'bg-amber-500 text-white border-amber-500'
                          : 'bg-blue-500 text-white border-blue-500'
                          : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300'
                      }`}
                    >
                      {r.icon} {r.label}
                    </button>
                  ))}
                </div>
              </div>

              {newRoleType !== 'admin' && (
                <div>
                  <label className="block text-xs font-bold text-slate-600 uppercase tracking-wider mb-1.5">Department</label>
                  <select
                    value={newDept}
                    onChange={e => setNewDept(e.target.value)}
                    className="w-full px-4 py-2.5 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-primary-500 focus:border-transparent outline-none appearance-none bg-white cursor-pointer"
                  >
                    {AUTHORITIES.map(a => (
                      <option key={a.id} value={a.id}>{a.abbr} — {a.name}</option>
                    ))}
                  </select>
                </div>
              )}

              <button
                type="submit"
                className="w-full py-3 bg-primary-500 text-white font-bold text-sm rounded-xl hover:bg-primary-600 transition-colors shadow-sm flex items-center justify-center gap-2"
              >
                <Plus size={16} /> Create Account
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
