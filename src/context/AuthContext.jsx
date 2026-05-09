import { createContext, useContext, useState, useCallback } from 'react';

const AuthContext = createContext();

const ACCOUNTS_KEY = 'smart_city_accounts';

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

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => {
    const saved = localStorage.getItem('smart_city_session');
    return saved ? JSON.parse(saved) : null;
  });

  const role = user?.role ?? null;

  const login = useCallback((username, password) => {
    const accounts = getAccounts();
    const found = accounts.find(
      a => a.username.toLowerCase() === username.toLowerCase() && a.password === password
    );
    if (!found) return { ok: false, error: 'Invalid username or password.' };
    if (found.status === 'pending') return { ok: false, error: 'Your account is awaiting admin approval.' };
    if (found.status === 'rejected') return { ok: false, error: 'Your account request was rejected.' };

    const session = { username: found.username, role: found.role, displayName: found.displayName };
    localStorage.setItem('smart_city_session', JSON.stringify(session));
    setUser(session);
    return { ok: true };
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem('smart_city_session');
    setUser(null);
  }, []);

  // User requests an account — goes into pending queue
  const requestAccount = useCallback((username, password, role, displayName) => {
    const accounts = getAccounts();
    if (accounts.find(a => a.username.toLowerCase() === username.toLowerCase())) {
      return { ok: false, error: 'Username already exists.' };
    }
    const newAccount = { username, password, role, displayName, status: 'pending' };
    saveAccounts([...accounts, newAccount]);
    return { ok: true };
  }, []);

  // Admin: get all pending registrations
  const getPendingRequests = useCallback(() => {
    return getAccounts().filter(a => a.status === 'pending');
  }, []);

  // Admin: approve or reject
  const resolveRequest = useCallback((username, decision) => {
    const accounts = getAccounts();
    const updated = accounts.map(a =>
      a.username === username ? { ...a, status: decision } : a
    );
    saveAccounts(updated);
  }, []);

  // Admin: get all accounts
  const getAllAccounts = useCallback(() => getAccounts(), []);

  // Admin: delete account
  const deleteAccount = useCallback((username) => {
    const accounts = getAccounts().filter(a => a.username !== username);
    saveAccounts(accounts);
  }, []);

  // Admin: add account directly
  const createAccount = useCallback((username, password, role, displayName) => {
    const accounts = getAccounts();
    if (accounts.find(a => a.username.toLowerCase() === username.toLowerCase())) {
      return { ok: false, error: 'Username already exists.' };
    }
    saveAccounts([...accounts, { username, password, role, displayName, status: 'active' }]);
    return { ok: true };
  }, []);

  return (
    <AuthContext.Provider value={{
      user, role,
      login, logout,
      requestAccount,
      getPendingRequests, resolveRequest,
      getAllAccounts, deleteAccount, createAccount,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
