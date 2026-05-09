import { NavLink } from "react-router-dom";
import { LayoutDashboard, Map as MapIcon, ClipboardList, LogOut, Users, Bell } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { AUTHORITIES } from '../utils/authorities';

export function Sidebar() {
  const { user, role, logout, getPendingRequests } = useAuth();

  const pendingCount = role === 'admin' ? getPendingRequests().length : 0;

  const navItems = [
    { name: "Overview", path: "/", icon: <LayoutDashboard size={20} /> },
    { name: "Map View", path: "/map", icon: <MapIcon size={20} /> },
    { name: "Reports", path: "/reports", icon: <ClipboardList size={20} /> },
    ...(role === 'admin' ? [{ name: "Users", path: "/users", icon: <Users size={20} />, badge: pendingCount }] : []),
  ];

  const getRoleDisplay = () => {
    if (role === 'admin') return { title: user?.displayName || 'Admin User', desc: 'System Administrator', abbr: 'AD', color: 'bg-purple-100 text-purple-700' };

    if (role?.startsWith('authority_')) {
      const deptId = role.split('_').slice(1).join('_');
      const dept = AUTHORITIES.find(a => a.id === deptId);
      return {
        title: user?.displayName || `${dept?.abbr || 'Local'} Authority`,
        desc: dept ? dept.name : 'Local Authority',
        abbr: dept ? dept.abbr.substring(0, 2) : 'LA',
        color: 'bg-amber-100 text-amber-700',
      };
    }

    if (role?.startsWith('worker_')) {
      const deptId = role.split('_').slice(1).join('_');
      const dept = AUTHORITIES.find(a => a.id === deptId);
      return {
        title: user?.displayName || `Worker (${dept?.abbr || 'Field'})`,
        desc: dept ? dept.name : 'Field Operator',
        abbr: 'WK',
        color: 'bg-blue-100 text-blue-700',
      };
    }

    return { title: 'User', desc: 'Guest', abbr: 'U', color: 'bg-slate-100 text-slate-600' };
  };

  const display = getRoleDisplay();

  return (
    <div className="w-64 h-screen bg-white border-r border-gray-200 flex flex-col pt-6 flex-shrink-0 z-10 shadow-sm">
      <div className="px-6 mb-8 flex items-center gap-3">
        <div className="w-8 h-8 rounded-lg bg-primary-500 flex items-center justify-center text-white font-bold text-xl shadow-md shadow-primary-500/30">
          S
        </div>
        <div>
          <h1 className="font-bold text-primary-900 leading-tight">Smart City</h1>
          <p className="text-xs text-slate-500 font-medium">Melaka Portal</p>
        </div>
      </div>

      <nav className="flex-1 px-4 space-y-1">
        {navItems.map((item) => (
          <NavLink
            key={item.path}
            to={item.path}
            end={item.path === '/'}
            className={({ isActive }) =>
              `flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200 font-medium ${
                isActive
                  ? "bg-primary-50 text-primary-600 shadow-sm"
                  : "text-slate-600 hover:bg-slate-50 hover:text-primary-500"
              }`
            }
          >
            {item.icon}
            <span className="flex-1">{item.name}</span>
            {item.badge > 0 && (
              <span className="w-5 h-5 bg-amber-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center">
                {item.badge}
              </span>
            )}
          </NavLink>
        ))}
      </nav>

      <div className="px-6 py-6 border-t border-slate-100 mt-auto space-y-4">
        <div className="flex items-center gap-3">
          <div className={`w-10 h-10 rounded-full flex items-center justify-center font-bold text-sm ${display.color}`}>
            {display.abbr}
          </div>
          <div className="min-w-0">
            <p className="font-semibold text-sm text-slate-800 truncate">{display.title}</p>
            <p className="text-xs text-slate-500 truncate">{display.desc}</p>
          </div>
        </div>
        <button
          onClick={logout}
          className="w-full flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium text-red-600 bg-red-50 hover:bg-red-100 rounded-xl transition-colors"
        >
          <LogOut size={16} /> Logout
        </button>
      </div>
    </div>
  );
}
