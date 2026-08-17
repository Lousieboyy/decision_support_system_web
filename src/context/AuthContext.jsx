import { createContext, useContext, useState, useCallback } from 'react';
import { fetchStaff, createStaff, requestStaffAccount, setStaffStatus, deleteStaff, fetchTeams } from '../api/reportsApi';
import { AUTHORITIES } from '../utils/authorities';

const AuthContext = createContext();

const ACCOUNTS_KEY = 'smart_city_accounts';
const AUDIT_LOG_KEY = 'smart_city_audit_log';
const NOTIF_KEY = 'smart_city_notifications';

const DEMO_ACCOUNTS = [
  { username: 'admin',  password: 'password', role: 'admin',            status: 'active', displayName: 'System Admin'     },
  { username: 'mbmb',   password: 'password', role: 'authority_mbmb',   status: 'active', displayName: 'MBMB Authority'   },
  { username: 'mphtj',  password: 'password', role: 'authority_mphtj',  status: 'active', displayName: 'MPHTJ Authority'  },
  { username: 'jkr',    password: 'password', role: 'authority_jkr',    status: 'active', displayName: 'JKR Authority'    },
  { username: 'swcorp', password: 'password', role: 'authority_swcorp', status: 'active', displayName: 'SWCorp Authority' },
  { username: 'worker1',password: 'password', role: 'worker_mbmb',      status: 'active', displayName: 'Ali (MBMB Field)' },
  { username: 'worker2',password: 'password', role: 'worker_jkr',       status: 'active', displayName: 'Kumar (JKR Field)'},
];

function getAccounts() {
  const raw = localStorage.getItem(ACCOUNTS_KEY);
  if (!raw) {
    localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(DEMO_ACCOUNTS));
    return DEMO_ACCOUNTS;
  }
  return JSON.parse(raw);
}

function saveAccounts(accounts) {
  localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(accounts));
}

// ---- Audit Log helpers ----
export function getAuditLog() {
  try { return JSON.parse(localStorage.getItem(AUDIT_LOG_KEY) || '[]'); } catch { return []; }
}

function pushAuditLog(entry) {
  const log = getAuditLog();
  log.unshift({ ...entry, timestamp: new Date().toISOString(), id: Date.now() });
  localStorage.setItem(AUDIT_LOG_KEY, JSON.stringify(log.slice(0, 200)));
}

// ---- Notification helpers ----
export function getNotifications() {
  try { return JSON.parse(localStorage.getItem(NOTIF_KEY) || '[]'); } catch { return []; }
}

function pushNotification(notif) {
  const notifs = getNotifications();
  notifs.unshift({ ...notif, id: Date.now(), timestamp: new Date().toISOString(), read: false });
  localStorage.setItem(NOTIF_KEY, JSON.stringify(notifs.slice(0, 50)));
}

export function markAllNotificationsRead() {
  const notifs = getNotifications().map(n => ({ ...n, read: true }));
  localStorage.setItem(NOTIF_KEY, JSON.stringify(notifs));
}

export function clearNotifications() {
  localStorage.setItem(NOTIF_KEY, JSON.stringify([]));
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => {
    const saved = localStorage.getItem('smart_city_session');
    return saved ? JSON.parse(saved) : null;
  });

  const role = user?.role ?? null;

  const login = useCallback(async (username, password) => {
    try {
      const envUrl = import.meta.env.VITE_API_URL;
      const API_URL = envUrl === '/api'
        ? envUrl // dev: relative path routed through the Vite proxy in vite.config.js
        : (envUrl && envUrl.trim() !== '')
          ? envUrl.replace(/\/api\/?$/, '').replace(/\/$/, '')
          : 'https://smart-city-citizen-app-git-main-lousieboyys-projects.vercel.app';
      // Try to authenticate with the FastAPI backend first
      const backendResponse = await fetch(`${API_URL}/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      
      if (backendResponse.ok) {
        const backendData = await backendResponse.json();
        // Save token for API requests
        localStorage.setItem('smart_city_jwt_token', backendData.token);
        // Save session info
        const session = {
          username: backendData.username,
          role: backendData.role,
          displayName: backendData.username,
          user_id: backendData.user_id,
        };
        localStorage.setItem('smart_city_session', JSON.stringify(session));
        setUser(session);
        pushAuditLog({ actor: username, action: 'LOGIN', detail: `User "${username}" logged in (backend auth)` });
        return { ok: true };
      } else if (backendResponse.status === 401) {
        return { ok: false, error: 'Invalid username or password.' };
      } else {
        return { ok: false, error: 'Login service unavailable. Please try again.' };
      }
    } catch (err) {
      // Fallback: if backend is unreachable, try local demo accounts
      console.warn('[Auth] Backend unreachable, falling back to demo accounts:', err);
      const accounts = getAccounts();
      const found = accounts.find(
        a => a.username.toLowerCase().trim() === username.toLowerCase().trim() && a.password === password
      );
      if (!found) return { ok: false, error: 'Invalid username or password.' };
      if (found.status === 'pending') return { ok: false, error: 'Your account is awaiting admin approval.' };
      if (found.status === 'rejected') return { ok: false, error: 'Your account request was rejected.' };

      const session = { username: found.username, role: found.role, displayName: found.displayName };
      localStorage.setItem('smart_city_session', JSON.stringify(session));
      setUser(session);
      pushAuditLog({ actor: found.username, action: 'LOGIN', detail: `User "${found.displayName}" logged in (demo)` });
      return { ok: true };
    }
  }, []);

  const logout = useCallback(() => {
    if (user) pushAuditLog({ actor: user.username, action: 'LOGOUT', detail: `User "${user.displayName}" logged out` });
    localStorage.removeItem('smart_city_session');
    localStorage.removeItem('smart_city_jwt_token');
    setUser(null);
  }, [user]);

  // ── Staff accounts ────────────────────────────────────────────────────────
  // These call the server. They used to read and write browser localStorage, so
  // an account "created" by one admin existed only in that admin's browser,
  // was invisible to every colleague, and could never actually sign in because
  // login authenticates against the database.
  //
  // The UI works in combined roles like "authority_mbmb"; the server stores a
  // role and an agency id separately, so the two are translated here.

  const splitRole = useCallback(async (combinedRole) => {
    const [base, ...rest] = String(combinedRole || 'worker').split('_');
    const deptId = rest.join('_');
    if (!deptId) return { role: base, agency_id: null };

    const abbr = (AUTHORITIES.find(a => a.id === deptId)?.abbr || deptId).toLowerCase();
    try {
      const teams = await fetchTeams();
      const match = teams.find(t => String(t.name).toLowerCase() === abbr);
      return { role: base, agency_id: match ? match.id : null };
    } catch {
      // A missing team should not block account creation; it can be set later.
      return { role: base, agency_id: null };
    }
  }, []);

  const requestAccount = useCallback(async (username, password, role, displayName) => {
    try {
      const { role: baseRole, agency_id } = await splitRole(role);
      await requestStaffAccount({ username, password, role: baseRole, agency_id });
      pushAuditLog({ actor: username, action: 'REGISTER_REQUEST', detail: `"${displayName}" requested account (${role})` });
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message || 'Could not submit the request.' };
    }
  }, [splitRole]);

  const getPendingRequests = useCallback(async () => {
    try {
      return await fetchStaff('pending');
    } catch {
      return [];
    }
  }, []);

  const getAllAccounts = useCallback(async () => {
    try {
      return await fetchStaff('all');
    } catch {
      return [];
    }
  }, []);

  const resolveRequest = useCallback(async (staffId, decision) => {
    try {
      const updated = await setStaffStatus(staffId, decision);
      const actor = user?.username || 'admin';
      pushAuditLog({
        actor,
        action: decision === 'active' ? 'APPROVE_ACCOUNT' : 'REJECT_ACCOUNT',
        detail: `"${updated.username}" was ${decision === 'active' ? 'approved' : 'rejected'}`,
      });
      if (decision === 'active') {
        pushNotification({ type: 'account', title: 'Account Approved', body: `"${updated.username}" is now active` });
      }
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message || 'Could not update the account.' };
    }
  }, [user]);

  const deleteAccount = useCallback(async (staffId) => {
    try {
      const result = await deleteStaff(staffId);
      pushAuditLog({ actor: user?.username || 'admin', action: 'DELETE_ACCOUNT', detail: `Deleted staff account #${staffId}` });
      return { ok: true, ...result };
    } catch (err) {
      return { ok: false, error: err.message || 'Could not delete the account.' };
    }
  }, [user]);

  const createAccount = useCallback(async (username, password, role, displayName) => {
    try {
      const { role: baseRole, agency_id } = await splitRole(role);
      await createStaff({ username, password, role: baseRole, agency_id, status: 'active' });
      pushAuditLog({ actor: user?.username || 'admin', action: 'CREATE_ACCOUNT', detail: `Created account "${displayName}" (${role})` });
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message || 'Could not create the account.' };
    }
  }, [user, splitRole]);

  // Log a status change from anywhere in the app
  const logStatusChange = useCallback((reportId, oldStatus, newStatus, actor) => {
    pushAuditLog({ actor: actor || user?.username || 'system', action: 'STATUS_CHANGE', detail: `Report #${reportId}: "${oldStatus}" → "${newStatus}"` });
    pushNotification({ type: 'status', title: `Report #${reportId} Updated`, body: `Status changed to "${newStatus}"` });
  }, [user]);

  return (
    <AuthContext.Provider value={{
      user, role,
      login, logout,
      requestAccount,
      getPendingRequests, resolveRequest,
      getAllAccounts, deleteAccount, createAccount,
      logStatusChange,
      getAuditLog,
      getNotifications,
      markAllNotificationsRead,
      clearNotifications,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}

// Helper to get the current JWT token for API requests
export function getAuthToken() {
  return localStorage.getItem('smart_city_jwt_token');
}
