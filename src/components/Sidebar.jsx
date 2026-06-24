import { NavLink } from "react-router-dom";
import { LayoutDashboard, Map as MapIcon, ClipboardList, LogOut, Users, Bell, X, CheckCircle2, RefreshCw, BarChart3 } from "lucide-react";
import { useAuth, getNotifications, markAllNotificationsRead, clearNotifications } from "../context/AuthContext";
import { AUTHORITIES } from '../utils/authorities';
import { useState, useEffect, useRef } from "react";
import { formatDistanceToNow, parseISO } from "date-fns";

export function Sidebar({ isOpen, setIsOpen }) {
  const { user, role, logout, getPendingRequests } = useAuth();
  const [notifOpen, setNotifOpen] = useState(false);
  const [notifs, setNotifs] = useState([]);
  const bellRef = useRef(null);

  const pendingCount = role === 'admin' ? getPendingRequests().length : 0;

  // Refresh notifs every 15s
  useEffect(() => {
    const refresh = () => setNotifs(getNotifications());
    refresh();
    const id = setInterval(refresh, 15000);
    return () => clearInterval(id);
  }, []);

  const unreadCount = notifs.filter(n => !n.read).length;

  const handleBellClick = () => {
    setNotifOpen(v => !v);
    if (!notifOpen) {
      markAllNotificationsRead();
      setTimeout(() => setNotifs(getNotifications()), 50);
    }
  };

  const handleClearAll = () => {
    clearNotifications();
    setNotifs([]);
  };

  const navItems = [
    { name: "Overview", path: "/", icon: <LayoutDashboard size={18} /> },
    { name: "Map View", path: "/map", icon: <MapIcon size={18} /> },
    { name: "Reports", path: "/reports", icon: <ClipboardList size={18} /> },
    ...(role === 'admin' || role === 'authority' || role?.startsWith('authority_')
        ? [{ name: "Analytics", path: "/analytics", icon: <BarChart3 size={18} /> }]
        : []),
    ...(role === 'admin' ? [{ name: "Users", path: "/users", icon: <Users size={18} />, badge: pendingCount }] : []),
  ];

  const getRoleDisplay = () => {
    if (role === 'admin') return { title: user?.displayName || 'Admin User', desc: 'System Administrator', abbr: 'AD', color: 'bg-zinc-500/20 text-zinc-300' };
    
    // Handle both formats: "authority_mbmb" (demo) and "authority" (backend)
    if (role === 'authority' || role?.startsWith('authority_')) {
      let deptId = null;
      if (role?.startsWith('authority_')) {
        deptId = role.split('_').slice(1).join('_');
      }
      const dept = deptId ? AUTHORITIES.find(a => a.id === deptId) : null;
      return { 
        title: user?.displayName || `${dept?.abbr || 'Local'} Authority`, 
        desc: dept ? dept.name : 'Local Authority', 
        abbr: dept ? dept.abbr.substring(0, 2) : 'LA', 
        color: dept?.avatarColor || 'bg-zinc-700/20 text-zinc-300 border-zinc-700/30' 
      };
    }
    
    // Handle both formats: "worker_mbmb" (demo) and "worker" (backend)
    if (role === 'worker' || role?.startsWith('worker_')) {
      let deptId = null;
      if (role?.startsWith('worker_')) {
        deptId = role.split('_').slice(1).join('_');
      }
      const dept = deptId ? AUTHORITIES.find(a => a.id === deptId) : null;
      return { 
        title: user?.displayName || `Worker${dept ? ` (${dept.abbr})` : ''}`, 
        desc: dept ? dept.name : 'Field Operator', 
        abbr: 'WK', 
        color: dept?.avatarColor || 'bg-zinc-700/40 text-zinc-200 border-zinc-650/40' 
      };
    }
    
    // Fallback for citizen role
    if (role === 'citizen') {
      return { title: user?.displayName || 'Citizen', desc: 'Report Submitter', abbr: 'CT', color: 'bg-zinc-800 text-zinc-200 border-zinc-700' };
    }
    
    return { title: 'User', desc: 'Guest', abbr: 'U', color: 'bg-zinc-900/60 text-zinc-400 border-zinc-800/40' };
  };

  const display = getRoleDisplay();

  return (
    <>
      <div className={`sidebar ${isOpen ? 'open' : ''}`}>
        {/* Logo */}
        <div className="sidebar-logo">
          <div className="sidebar-logo-icon">D</div>
          <div>
            <div className="sidebar-logo-title">DSS Portal</div>
            <div className="sidebar-logo-sub">Infrastructure Reports</div>
          </div>
          {/* Notification Bell */}
          <button ref={bellRef} className="notif-bell-btn" onClick={handleBellClick} title="Notifications">
            <Bell size={16} />
            {unreadCount > 0 && <span className="notif-bell-dot" />}
          </button>
          
          {/* Mobile Close Button */}
          <button 
            className="md:hidden ml-2 p-1.5 text-slate-400 hover:text-white hover:bg-white/10 rounded-lg transition-colors"
            onClick={() => setIsOpen(false)}
          >
            <X size={20} />
          </button>
        </div>

        {/* Nav */}
        <nav className="sidebar-nav">
          {navItems.map((item) => (
            <NavLink
              key={item.path}
              to={item.path}
              end={item.path === '/'}
              onClick={() => setIsOpen(false)}
              className={({ isActive }) =>
                `sidebar-nav-item${isActive ? ' active' : ''}`
              }
            >
              <span className="sidebar-nav-icon">{item.icon}</span>
              <span style={{ flex: 1 }}>{item.name}</span>
              {item.badge > 0 && <span className="nav-badge">{item.badge}</span>}
            </NavLink>
          ))}
        </nav>

        {/* Footer */}
        <div className="sidebar-footer">
          <div className="sidebar-user-card">
            <div className={`sidebar-user-avatar ${display.color}`}>{display.abbr}</div>
            <div style={{ minWidth: 0 }}>
              <div className="sidebar-user-name" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{display.title}</div>
              <div className="sidebar-user-role" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{display.desc}</div>
            </div>
          </div>
          <button onClick={logout} className="sidebar-logout-btn">
            <LogOut size={14} /> Logout
          </button>
        </div>
      </div>

      {/* Notification Dropdown */}
      {notifOpen && (
        <>
          <div className="fixed inset-0 z-[190]" onClick={() => setNotifOpen(false)} />
          <div className="notif-dropdown">
            <div className="notif-header">
              <span className="notif-title">Notifications {notifs.length > 0 && <span style={{ color: '#94a3b8', fontWeight: 500 }}>({notifs.length})</span>}</span>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                {notifs.length > 0 && <button className="notif-clear" onClick={handleClearAll}>Clear all</button>}
                <button onClick={() => setNotifOpen(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8', display: 'flex' }}><X size={16} /></button>
              </div>
            </div>
            {notifs.length === 0 ? (
              <div className="notif-empty">No notifications yet.<br /><span style={{ fontSize: '0.75rem' }}>Status changes and approvals appear here.</span></div>
            ) : (
              <div style={{ maxHeight: 340, overflowY: 'auto' }}>
                {notifs.map(n => (
                  <div key={n.id} className={`notif-item${n.read ? '' : ' unread'}`}>
                    <div className="notif-item-icon" style={{ background: n.type === 'status' ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.12)', color: '#ffffff' }}>
                      {n.type === 'status' ? <RefreshCw size={14} /> : <CheckCircle2 size={14} />}
                    </div>
                    <div>
                      <div className="notif-item-text"><strong>{n.title}</strong><br />{n.body}</div>
                      <div className="notif-item-time">
                        {(() => { try { return formatDistanceToNow(parseISO(n.timestamp), { addSuffix: true }); } catch { return ''; } })()}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </>
  );
}
