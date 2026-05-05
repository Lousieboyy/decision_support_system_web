import { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { Shield, Building2, Wrench, MapPin, Zap, BarChart3, Users, Mail, Lock, UserPlus, LogIn, AlertCircle, CheckCircle2 } from 'lucide-react';
import { AUTHORITIES } from '../utils/authorities';

export function LoginPage() {
  const { login } = useAuth();
  
  const [isLogin, setIsLogin] = useState(true);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  
  // Signup specific state
  const [roleType, setRoleType] = useState('authority'); // admin, authority, worker
  const [department, setDepartment] = useState('mbmb');
  
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Pre-populate some demo accounts if empty
  useEffect(() => {
    const existing = localStorage.getItem('smart_city_accounts');
    if (!existing) {
      const demoAccounts = [
        { username: 'admin', password: 'password', role: 'admin' },
        { username: 'mbmb', password: 'password', role: 'authority_mbmb' },
        { username: 'worker', password: 'password', role: 'worker_mbmb' }
      ];
      localStorage.setItem('smart_city_accounts', JSON.stringify(demoAccounts));
    }
  }, []);

  const handleSubmit = (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    
    if (!username || !password) {
      setError('Please fill in all fields');
      return;
    }

    const accounts = JSON.parse(localStorage.getItem('smart_city_accounts') || '[]');

    if (isLogin) {
      const user = accounts.find(a => a.username.toLowerCase() === username.toLowerCase() && a.password === password);
      if (user) {
        login(user.role);
      } else {
        setError('Invalid username or password');
      }
    } else {
      // Signup
      const exists = accounts.find(a => a.username.toLowerCase() === username.toLowerCase());
      if (exists) {
        setError('Username already exists');
        return;
      }
      
      let finalRole = roleType;
      if (roleType !== 'admin') {
        finalRole = `${roleType}_${department}`;
      }
      
      const newUser = { username, password, role: finalRole };
      localStorage.setItem('smart_city_accounts', JSON.stringify([...accounts, newUser]));
      
      setSuccess('Account created successfully! You can now log in.');
      setIsLogin(true);
      setPassword('');
    }
  };

  const features = [
    { icon: <MapPin size={18} />, label: 'Live Map Tracking' },
    { icon: <Zap size={18} />, label: 'AI-Powered Analysis' },
    { icon: <BarChart3 size={18} />, label: 'Real-time Analytics' },
    { icon: <Users size={18} />, label: 'Multi-Agency Workflow' },
  ];

  return (
    <div className="login-page">
      {/* Animated Background */}
      <div className="login-bg">
        <div className="login-bg-orb login-bg-orb-1" />
        <div className="login-bg-orb login-bg-orb-2" />
        <div className="login-bg-orb login-bg-orb-3" />
        <div className="login-bg-grid" />
      </div>

      <div className="login-container">
        {/* Left Panel — Branding */}
        <div className="login-brand">
          <div className="login-brand-inner">
            <div className="login-logo">
              <div className="login-logo-icon">
                <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
                  <path d="M16 2L28 9V23L16 30L4 23V9L16 2Z" stroke="currentColor" strokeWidth="2" fill="currentColor" fillOpacity="0.15"/>
                  <path d="M16 8L22 11.5V18.5L16 22L10 18.5V11.5L16 8Z" fill="currentColor"/>
                </svg>
              </div>
              <div>
                <h1 className="login-brand-title">Smart City</h1>
                <p className="login-brand-sub">Melaka Decision Support</p>
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
              <p>© 2026 Smart City Melaka · Secure Access</p>
            </div>
          </div>
        </div>

        {/* Right Panel — Auth Form */}
        <div className="login-form-panel">
          <div className="login-form-inner">
            <div className="login-form-header">
              <h2>{isLogin ? 'Welcome back' : 'Create Account'}</h2>
              <p>{isLogin ? 'Enter your credentials to access the portal' : 'Register your secure departmental access'}</p>
            </div>

            {error && (
              <div className="flex items-center gap-2 p-3 mb-4 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm font-medium animate-pulse">
                <AlertCircle size={16} />
                {error}
              </div>
            )}
            
            {success && (
              <div className="flex items-center gap-2 p-3 mb-4 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-sm font-medium">
                <CheckCircle2 size={16} />
                {success}
              </div>
            )}

            <form onSubmit={handleSubmit} className="auth-form space-y-4">
              <div className="input-group">
                <label>Username / ID</label>
                <div className="input-wrapper">
                  <Mail size={18} className="input-icon" />
                  <input 
                    type="text" 
                    placeholder="e.g. mbmb_admin" 
                    value={username}
                    onChange={e => setUsername(e.target.value)}
                  />
                </div>
              </div>

              <div className="input-group">
                <label>Password</label>
                <div className="input-wrapper">
                  <Lock size={18} className="input-icon" />
                  <input 
                    type="password" 
                    placeholder="••••••••" 
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                  />
                </div>
              </div>

              {!isLogin && (
                <>
                  <div className="input-group">
                    <label>Role Type</label>
                    <div className="role-selector">
                      <button type="button" className={`role-btn ${roleType === 'admin' ? 'active admin' : ''}`} onClick={() => setRoleType('admin')}>
                        <Shield size={16} /> Admin
                      </button>
                      <button type="button" className={`role-btn ${roleType === 'authority' ? 'active authority' : ''}`} onClick={() => setRoleType('authority')}>
                        <Building2 size={16} /> Authority
                      </button>
                      <button type="button" className={`role-btn ${roleType === 'worker' ? 'active worker' : ''}`} onClick={() => setRoleType('worker')}>
                        <Wrench size={16} /> Worker
                      </button>
                    </div>
                  </div>

                  {roleType !== 'admin' && (
                    <div className="input-group animate-slide-down">
                      <label>Select Department</label>
                      <select 
                        className="custom-select"
                        value={department}
                        onChange={e => setDepartment(e.target.value)}
                      >
                        {AUTHORITIES.map(a => (
                          <option key={a.id} value={a.id}>{a.abbr} — {a.name}</option>
                        ))}
                      </select>
                    </div>
                  )}
                </>
              )}

              <button type="submit" className="submit-btn mt-6">
                {isLogin ? (
                  <><LogIn size={18} /> Sign In to Portal</>
                ) : (
                  <><UserPlus size={18} /> Register Account</>
                )}
              </button>
            </form>

            <div className="auth-toggle">
              <p>
                {isLogin ? "Don't have an account?" : "Already have an account?"}
                <button type="button" onClick={() => { setIsLogin(!isLogin); setError(''); setSuccess(''); }}>
                  {isLogin ? 'Register here' : 'Sign in'}
                </button>
              </p>
            </div>

            {isLogin && (
              <p className="login-disclaimer" style={{ marginTop: '2rem' }}>
                For demo purposes, you can use: <br/>
                <span className="text-white font-medium">username:</span> admin / mbmb / worker <br/>
                <span className="text-white font-medium">password:</span> password
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
