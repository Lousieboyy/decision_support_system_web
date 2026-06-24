import { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { AUTHORITIES } from '../utils/authorities';
import {
  Shield, Building2, Wrench, MapPin, Sparkles, BarChart3, Users,
  Mail, Lock, LogIn, AlertCircle, CheckCircle2, UserPlus, Send,
} from 'lucide-react';

export function LoginPage() {
  const { login, requestAccount } = useAuth();

  const [mode, setMode] = useState('login'); // 'login' | 'request'

  // Login fields
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  // Request-access fields
  const [reqUsername, setReqUsername] = useState('');
  const [reqPassword, setReqPassword] = useState('');
  const [reqDisplayName, setReqDisplayName] = useState('');
  const [reqRoleType, setReqRoleType] = useState('authority');
  const [reqDept, setReqDept] = useState('mbmb');

  const [error, setError]   = useState('');
  const [success, setSuccess] = useState('');

  const handleLogin = async (e) => {
    e.preventDefault();
    setError(''); setSuccess('');
    if (!username || !password) { setError('Please fill in all fields.'); return; }
    try {
      const result = await login(username, password);
      if (!result.ok) setError(result.error);
    } catch (err) {
      setError('An error occurred during login. Please try again.');
    }
  };

  const handleRequest = (e) => {
    e.preventDefault();
    setError(''); setSuccess('');
    if (!reqUsername || !reqPassword || !reqDisplayName) {
      setError('Please fill in all fields.'); return;
    }
    const finalRole = reqRoleType === 'authority' ? `authority_${reqDept}` : `worker_${reqDept}`;
    const displayName = reqDisplayName || `${reqRoleType === 'authority' ? 'Authority' : 'Worker'} (${reqDept.toUpperCase()})`;
    const result = requestAccount(reqUsername, reqPassword, finalRole, displayName);
    if (!result.ok) { setError(result.error); return; }
    setSuccess('Request sent! An admin will review and approve your access.');
    setMode('login');
    setReqUsername(''); setReqPassword(''); setReqDisplayName('');
  };

  const features = [
    { icon: <MapPin size={18} />, label: 'Live Map Tracking' },
    { icon: <Sparkles size={18} />, label: 'AI-Powered Analysis' },
    { icon: <BarChart3 size={18} />, label: 'Real-time Analytics' },
    { icon: <Users size={18} />, label: 'Multi-Agency Workflow' },
  ];

  return (
    <div className="login-page">
      <div className="login-container">
        {/* Left branding panel */}
        <div className="login-brand">
          <div className="login-brand-inner">
            <div className="login-logo">
              <div className="login-logo-icon">
                <svg width="28" height="28" viewBox="0 0 32 32" fill="none">
                  <path d="M16 2L28 9V23L16 30L4 23V9L16 2Z" stroke="currentColor" strokeWidth="2" fill="currentColor" fillOpacity="0.15"/>
                  <path d="M16 8L22 11.5V18.5L16 22L10 18.5V11.5L16 8Z" fill="currentColor"/>
                </svg>
              </div>
              <div>
                <h1 className="login-brand-title" style={{ fontSize: '1.05rem', lineHeight: '1.2' }}>DECISION SUPPORT SYSTEM</h1>
                <p className="login-brand-sub" style={{ fontSize: '0.65rem' }}>FOR INFRASTRUCTURE COMPLAINT REPORTS</p>
              </div>
            </div>

            <div className="login-hero-text">
              <h2>Empowering urban management through intelligent reporting</h2>
              <p>
                A secure platform connecting citizens, authorities, and field workers 
                to resolve city issues faster and smarter.
              </p>
            </div>

            <div className="login-features">
              {features.map((f, i) => (
                <div key={i} className="login-feature" style={{ animationDelay: `${i * 0.1}s` }}>
                  <div className="login-feature-icon">{f.icon}</div>
                  <span>{f.label}</span>
                </div>
              ))}
            </div>

            <div className="login-brand-footer">
              <p>© 2026 Decision Support System · Secure Access</p>
            </div>
          </div>
        </div>

        {/* Right form panel */}
        <div className="login-form-panel">
          <div className="login-form-inner">
            {/* Tab toggle */}
            <div className="login-tab-bar">
              <button
                className={`login-tab ${mode === 'login' ? 'active' : ''}`}
                onClick={() => { setMode('login'); setError(''); setSuccess(''); }}
              >
                <LogIn size={15} /> Sign In
              </button>
              <button
                className={`login-tab ${mode === 'request' ? 'active' : ''}`}
                onClick={() => { setMode('request'); setError(''); setSuccess(''); }}
              >
                <UserPlus size={15} /> Request Access
              </button>
            </div>

            <div className="login-form-header">
              <h2>{mode === 'login' ? 'Welcome back' : 'Request Account Access'}</h2>
              <p>{mode === 'login'
                ? 'Enter your credentials to access the portal.'
                : 'Submit a request — an admin will review and activate your account.'
              }</p>
            </div>

            {error && (
              <div className="login-alert login-alert-error">
                <AlertCircle size={15} /> {error}
              </div>
            )}
            {success && (
              <div className="login-alert login-alert-success">
                <CheckCircle2 size={15} /> {success}
              </div>
            )}

            {mode === 'login' ? (
              <form onSubmit={handleLogin} className="auth-form">
                <div className="input-group">
                  <label>Username</label>
                  <div className="input-wrapper">
                    <Mail size={16} className="input-icon" />
                    <input
                      type="text"
                      placeholder="e.g. admin"
                      value={username}
                      onChange={e => setUsername(e.target.value)}
                    />
                  </div>
                </div>

                <div className="input-group">
                  <label>Password</label>
                  <div className="input-wrapper">
                    <Lock size={16} className="input-icon" />
                    <input
                      type="password"
                      placeholder="••••••••"
                      value={password}
                      onChange={e => setPassword(e.target.value)}
                    />
                  </div>
                </div>

                <button type="submit" className="submit-btn">
                  <LogIn size={17} /> Sign In to Portal
                </button>

                <p className="login-hint">
                  Demo — <strong>admin</strong> / <strong>mbmb</strong> / <strong>worker1</strong> (password: <strong>password</strong>)<br />
                  <em>Or log in with your newly created account.</em>
                </p>
              </form>
            ) : (
              <form onSubmit={handleRequest} className="auth-form">
                <div className="input-group">
                  <label>Full Name / Display Name</label>
                  <div className="input-wrapper">
                    <Users size={16} className="input-icon" />
                    <input
                      type="text"
                      placeholder="e.g. Ahmad bin Razak"
                      value={reqDisplayName}
                      onChange={e => setReqDisplayName(e.target.value)}
                    />
                  </div>
                </div>

                <div className="input-group">
                  <label>Desired Username</label>
                  <div className="input-wrapper">
                    <Mail size={16} className="input-icon" />
                    <input
                      type="text"
                      placeholder="e.g. ahmad_mbmb"
                      value={reqUsername}
                      onChange={e => setReqUsername(e.target.value)}
                    />
                  </div>
                </div>

                <div className="input-group">
                  <label>Password</label>
                  <div className="input-wrapper">
                    <Lock size={16} className="input-icon" />
                    <input
                      type="password"
                      placeholder="••••••••"
                      value={reqPassword}
                      onChange={e => setReqPassword(e.target.value)}
                    />
                  </div>
                </div>

                <div className="input-group">
                  <label>Role Type</label>
                  <div className="role-selector">
                    <button
                      type="button"
                      className={`role-btn ${reqRoleType === 'authority' ? 'active authority' : ''}`}
                      onClick={() => setReqRoleType('authority')}
                    >
                      <Building2 size={14} /> Authority
                    </button>
                    <button
                      type="button"
                      className={`role-btn ${reqRoleType === 'worker' ? 'active worker' : ''}`}
                      onClick={() => setReqRoleType('worker')}
                    >
                      <Wrench size={14} /> Worker
                    </button>
                  </div>
                </div>

                <div className="input-group animate-slide-down">
                  <label>Department</label>
                  <select
                    className="custom-select"
                    value={reqDept}
                    onChange={e => setReqDept(e.target.value)}
                  >
                    {AUTHORITIES.filter(a => ['mbmb', 'jkr', 'swcorp'].includes(a.id)).map(a => (
                      <option key={a.id} value={a.id}>{a.abbr} — {a.name}</option>
                    ))}
                  </select>
                </div>

                <button type="submit" className="submit-btn">
                  <Send size={16} /> Submit Request to Admin
                </button>

                <p className="login-hint">
                  Your request will be reviewed by the system admin before you can log in.
                </p>
              </form>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
