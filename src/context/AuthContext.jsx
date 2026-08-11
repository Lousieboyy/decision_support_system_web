import { createContext, useContext, useState, useCallback } from 'react';

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
      const API_URL = import.meta.env.VITE_API_URL || "/api";
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

  const requestAccount = useCallback((username, password, role, displayName) => {
    const accounts = getAccounts();
    if (accounts.find(a => a.username.toLowerCase().trim() === username.toLowerCase().trim())) {
      return { ok: false, error: 'Username already exists.' };
    }
    const newAccount = { username, password, role, displayName, status: 'pending' };
    saveAccounts([...accounts, newAccount]);
    pushAuditLog({ actor: username, action: 'REGISTER_REQUEST', detail: `"${displayName}" requested account (${role})` });
    return { ok: true };
  }, []);

  const getPendingRequests = useCallback(() => {
    return getAccounts().filter(a => a.status === 'pending');
  }, []);

  const resolveRequest = useCallback((username, decision) => {
    const accounts = getAccounts();
    const acc = accounts.find(a => a.username === username);
    const updated = accounts.map(a => a.username === username ? { ...a, status: decision } : a);
    saveAccounts(updated);
    const actor = user?.username || 'admin';
    pushAuditLog({ actor, action: decision === 'active' ? 'APPROVE_ACCOUNT' : 'REJECT_ACCOUNT', detail: `"${acc?.displayName || username}" was ${decision === 'active' ? 'approved' : 'rejected'}` });
    if (decision === 'active') {
      pushNotification({ type: 'account', title: 'Account Approved', body: `"${acc?.displayName || username}" is now active` });
    }
  }, [user]);

  const getAllAccounts = useCallback(() => getAccounts(), []);

  const deleteAccount = useCallback((username) => {
    const acc = getAccounts().find(a => a.username === username);
    saveAccounts(getAccounts().filter(a => a.username !== username));
    pushAuditLog({ actor: user?.username || 'admin', action: 'DELETE_ACCOUNT', detail: `Deleted account "${acc?.displayName || username}"` });
  }, [user]);

  const createAccount = useCallback((username, password, role, displayName) => {
    const accounts = getAccounts();
    if (accounts.find(a => a.username.toLowerCase().trim() === username.toLowerCase().trim())) {
      return { ok: false, error: 'Username already exists.' };
    }
    saveAccounts([...accounts, { username, password, role, displayName, status: 'active' }]);
    pushAuditLog({ actor: user?.username || 'admin', action: 'CREATE_ACCOUNT', detail: `Created account "${displayName}" (${role})` });
    return { ok: true };
  }, [user]);

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
