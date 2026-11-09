import { useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { api } from '../api';

// 3-dot (kebab) menu ke andar wala link. Active route highlight + unread badge.
function MenuLink({ to, end, badge, onPick, children }) {
  return (
    <NavLink
      to={to}
      end={end}
      onClick={onPick}
      className={({ isActive }) =>
        `flex items-center justify-between gap-2 rounded-lg px-3 py-2.5 text-sm font-medium transition ${
          isActive
            ? 'bg-gradient-to-br from-brand to-lemon text-white shadow-md shadow-lemon/30'
            : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
        }`
      }
    >
      <span>{children}</span>
      {badge ? (
        <span className="flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-brand px-1 text-[10px] font-bold text-white">
          {badge > 99 ? '99+' : badge}
        </span>
      ) : null}
    </NavLink>
  );
}

export default function Layout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [unread, setUnread] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);
  const buttonRef = useRef(null);

  const isStaff = user.role === 'admin' || user.role === 'owner';

  // Route badalne par menu khud band ho jaye.
  useEffect(() => {
    setMenuOpen(false);
  }, [location.pathname]);

  // Bahar click / Escape se menu band karo (desktop + mobile dono).
  useEffect(() => {
    if (!menuOpen) return;
    function onPointerDown(e) {
      if (menuRef.current && menuRef.current.contains(e.target)) return;
      if (buttonRef.current && buttonRef.current.contains(e.target)) return;
      setMenuOpen(false);
    }
    function onKey(e) {
      if (e.key === 'Escape') setMenuOpen(false);
    }
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('touchstart', onPointerDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('touchstart', onPointerDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  useEffect(() => {
    async function fetchUnread() {
      try {
        const { conversations } = await api.conversations();
        setUnread(conversations.reduce((sum, c) => sum + (c.unread || 0), 0));
      } catch {
        setUnread(0);
      }
    }
    fetchUnread();
    const t = setInterval(fetchUnread, 15000);
    return () => clearInterval(t);
  }, []);

  function signOut() {
    logout();
    navigate('/login');
  }

  return (
    <div className="flex h-full flex-col bg-cloud">
      {/* Slim top bar - menu ab yahan 3-dot button ke andar hai */}
      <header className="relative z-40 flex h-14 shrink-0 items-center justify-between gap-3 border-b border-slate-200 bg-white px-3 md:px-4">
        <div className="flex min-w-0 items-center gap-2.5">
          <img
            src="/wolf-logo.png"
            alt="ZEUS Bots"
            className="h-9 w-9 shrink-0 rounded-lg object-contain"
          />
          <div className="min-w-0">
            <p className="truncate bg-gradient-to-br from-brand to-lemon bg-clip-text text-base font-bold leading-tight text-transparent">
              ZEUS Bots
            </p>
            <p className="truncate text-[11px] leading-tight text-slate-400">
              {user.name} · <span className="uppercase">{user.role}</span>
            </p>
          </div>
        </div>

        <div className="relative">
          <button
            ref={buttonRef}
            type="button"
            onClick={() => setMenuOpen((o) => !o)}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            aria-label="Menu kholo/band karo"
            title="Menu"
            className={`relative rounded-lg border px-3 py-1.5 text-lg leading-none transition ${
              menuOpen
                ? 'border-brand bg-brand-soft text-brand'
                : 'border-slate-200 text-slate-600 hover:bg-slate-100'
            }`}
          >
            ⋮
            {unread > 0 && !menuOpen && (
              <span className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full bg-brand ring-2 ring-white" />
            )}
          </button>

          {menuOpen && (
            <div
              ref={menuRef}
              role="menu"
              className="absolute right-0 top-[calc(100%+0.5rem)] w-60 rounded-xl border border-slate-200 bg-white p-2 shadow-2xl shadow-slate-300/60"
            >
              <p className="px-3 pb-1 pt-1 text-[10px] font-semibold uppercase tracking-widest text-slate-400">
                Menu
              </p>
              <div className="space-y-1">
                {isStaff ? (
                  <>
                    <MenuLink to="/inbox" badge={unread} onPick={() => setMenuOpen(false)}>
                      Inbox
                    </MenuLink>
                    <MenuLink to="/channels" onPick={() => setMenuOpen(false)}>
                      Channels
                    </MenuLink>
                    <MenuLink to="/agents" onPick={() => setMenuOpen(false)}>
                      Agents
                    </MenuLink>
                  </>
                ) : (
                  <MenuLink to="/my-chats" badge={unread} onPick={() => setMenuOpen(false)}>
                    My Chats
                  </MenuLink>
                )}
              </div>
              <div className="mt-2 border-t border-slate-100 pt-2">
                <button
                  type="button"
                  onClick={signOut}
                  className="w-full rounded-lg bg-slate-100 py-2 text-sm font-medium text-slate-600 transition hover:bg-brand hover:text-white"
                >
                  Logout
                </button>
              </div>
            </div>
          )}
        </div>
      </header>

      <main className="min-h-0 flex-1 overflow-hidden bg-cloud">
        <Outlet />
      </main>
    </div>
  );
}
