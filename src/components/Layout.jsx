import { Outlet } from "react-router-dom";
import { Sidebar } from "./Sidebar";
import { useState } from "react";
import { Menu } from "lucide-react";

export function Layout() {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <div className="flex h-screen overflow-hidden bg-[#f5f1e6]">
      <Sidebar isOpen={sidebarOpen} setIsOpen={setSidebarOpen} />

      {/* Sidebar Overlay for mobile */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/40 z-40 md:hidden transition-opacity"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <main className="flex-1 overflow-y-auto w-full flex flex-col">
        {/* Mobile Header with Hamburger Menu */}
        <div className="md:hidden flex items-center justify-between px-4 py-3 sticky top-0 z-30" style={{ background: 'rgba(61,77,52,0.96)', backdropFilter: 'blur(20px)', borderBottom: '1px solid rgba(255,255,255,0.08)', boxShadow: '0 4px 16px rgba(31,30,26,0.15)' }}>
          <div className="flex items-center gap-3">
            <button
              onClick={() => setSidebarOpen(true)}
              className="p-2 -ml-2 text-white/80 hover:bg-white/10 rounded-lg transition-colors"
            >
              <Menu size={20} />
            </button>
            <div className="font-bold text-white">DSS Portal</div>
          </div>
        </div>

        <div className="mx-auto max-w-7xl w-full flex-1">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
