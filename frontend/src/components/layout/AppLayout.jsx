import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation, useMatch, useNavigate } from 'react-router-dom';
import {
  Activity,
  Bell,
  ChevronDown,
  Clock3,
  FolderKanban,
  LayoutDashboard,
  LogOut,
  Menu,
  RefreshCw,
  Rocket,
  Settings as SettingsIcon,
  ShieldAlert,
  X,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext.jsx';
import { useSocket } from '../../context/SocketContext.jsx';
import { api } from '../../lib/api.js';
import { EVENT_TYPE_LABEL } from '../../lib/constants.js';
import { cx, initials, timeAgo } from '../../lib/format.js';
import { EventIcon } from '../EventIcon.jsx';
import { Badge, RoleBadge } from '../ui/Badge.jsx';

const NAV_ITEMS = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/projects', label: 'Projects', icon: FolderKanban },
  { to: '/deployments', label: 'Deployments', icon: Rocket },
  { to: '/incidents', label: 'Incidents', icon: ShieldAlert },
  { to: '/timeline', label: 'Timeline', icon: Clock3 },
  { to: '/settings', label: 'Settings', icon: SettingsIcon },
];

/** Live/reconnecting indicator driven by the Socket.IO connection state. */
function ConnectionPill() {
  const { connected } = useSocket();
  return (
    <span
      className={cx(
        'inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-[11px] font-medium',
        connected
          ? 'border-success/35 bg-success/10 text-success'
          : 'border-warning/35 bg-warning/10 text-warning'
      )}
      title={
        connected
          ? 'Realtime updates are connected'
          : 'Realtime connection is down - data still loads from the API'
      }
    >
      <span
        className={cx('h-1.5 w-1.5 rounded-full', connected ? 'pulse-dot bg-success' : 'bg-warning')}
        aria-hidden="true"
      />
      {connected ? 'Live' : 'Reconnecting'}
    </span>
  );
}

function UserMenu() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    function onDocClick(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  async function handleLogout() {
    setOpen(false);
    await logout();
    navigate('/login', { replace: true });
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex cursor-pointer items-center gap-2 rounded-lg border border-edge bg-surface-2 py-1 pl-1 pr-2 text-sm text-fg transition-colors hover:border-edge-strong"
      >
        <span className="flex h-7 w-7 items-center justify-center rounded-md bg-primary-600/25 text-xs font-semibold text-primary-300">
          {initials(user?.name)}
        </span>
        <span className="hidden max-w-[140px] truncate sm:block">{user?.name}</span>
        <ChevronDown size={14} className="text-faint" aria-hidden="true" />
      </button>

      {open && (
        <div
          role="menu"
          className="route-in absolute right-0 top-full z-[750] mt-2 w-64 rounded-xl border border-edge bg-surface p-2 shadow-2xl shadow-black/50"
        >
          <div className="border-b border-edge px-3 py-2.5">
            <p className="truncate text-sm font-medium text-fg">{user?.name}</p>
            <p className="truncate text-xs text-faint">{user?.email}</p>
            <div className="mt-2">{user?.role && <RoleBadge role={user.role} />}</div>
          </div>
          <NavLink
            to="/settings"
            role="menuitem"
            onClick={() => setOpen(false)}
            className="mt-1 flex cursor-pointer items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-muted transition-colors hover:bg-surface-2 hover:text-fg"
          >
            <SettingsIcon size={15} aria-hidden="true" />
            Settings
          </NavLink>
          <button
            type="button"
            role="menuitem"
            onClick={handleLogout}
            className="flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-muted transition-colors hover:bg-danger/10 hover:text-danger"
          >
            <LogOut size={15} aria-hidden="true" />
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * Global project selector. Reflects the current project from the URL and
 * shows its environments as context chips on wide screens.
 */
function ProjectSwitcher() {
  const [projects, setProjects] = useState([]);
  const match = useMatch('/projects/:projectId');
  const navigate = useNavigate();
  const currentId = match?.params?.projectId || '';

  useEffect(() => {
    let cancelled = false;
    api
      .get('/projects', { params: { limit: 100 } })
      .then((data) => {
        if (!cancelled) setProjects(data.items || []);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const current = useMemo(
    () => projects.find((p) => p._id === currentId) || null,
    [projects, currentId]
  );

  if (projects.length === 0) return null;

  return (
    <div className="flex items-center gap-2">
      <label htmlFor="global-project-switcher" className="sr-only">
        Current project
      </label>
      <select
        id="global-project-switcher"
        value={currentId}
        onChange={(e) => {
          if (e.target.value) navigate(`/projects/${e.target.value}`);
        }}
        className="h-8 max-w-[190px] cursor-pointer appearance-none truncate rounded-lg border border-edge bg-surface-2 pr-7 pl-2.5 text-xs text-muted transition-colors hover:border-edge-strong hover:text-fg"
        style={{
          backgroundImage:
            "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%23a2a8c8' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")",
          backgroundRepeat: 'no-repeat',
          backgroundPosition: 'right 8px center',
        }}
      >
        <option value="">All projects</option>
        {projects.map((p) => (
          <option key={p._id} value={p._id}>
            {p.name}
          </option>
        ))}
      </select>
      {current?.environments?.length > 0 && (
        <div className="hidden items-center gap-1 xl:flex">
          {current.environments.slice(0, 3).map((env) => (
            <Badge key={env} tone="neutral">
              {env}
            </Badge>
          ))}
          {current.environments.length > 3 && (
            <span className="text-[11px] text-faint">+{current.environments.length - 3}</span>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Recent activity feed in the header, backed by real event data from the
 * dashboard endpoint. It is a snapshot, refreshed on open or via the refresh
 * control - not a fake unread counter.
 */
function NotificationsMenu() {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState(null);
  const [loading, setLoading] = useState(false);
  const ref = useRef(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.get('/dashboard');
      setItems(data.recentActivity || []);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) load();
  }, [open, load]);

  useEffect(() => {
    if (!open) return undefined;
    function onDocClick(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-label="Recent activity"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className={cx(
          'cursor-pointer rounded-lg border p-1.5 transition-colors',
          open
            ? 'border-primary-400/50 bg-surface-2 text-fg'
            : 'border-edge bg-surface-2 text-muted hover:border-edge-strong hover:text-fg'
        )}
      >
        <Bell size={16} />
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Recent activity"
          className="route-in absolute right-0 top-full z-[750] mt-2 w-80 rounded-xl border border-edge bg-surface shadow-2xl shadow-black/50"
        >
          <div className="flex items-center justify-between border-b border-edge px-4 py-2.5">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted">Recent activity</p>
            <button
              type="button"
              onClick={load}
              disabled={loading}
              aria-label="Refresh activity"
              className="cursor-pointer rounded-md p-1 text-faint transition-colors hover:bg-surface-2 hover:text-fg disabled:opacity-40"
            >
              <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
            </button>
          </div>
          <div className="max-h-80 overflow-y-auto p-2">
            {loading && !items && (
              <p className="px-3 py-6 text-center text-xs text-faint">Loading…</p>
            )}
            {items && items.length === 0 && (
              <p className="px-3 py-6 text-center text-xs text-faint">
                No recent events across your projects.
              </p>
            )}
            {items &&
              items.map((event) => {
                const incident =
                  event.incidentId && typeof event.incidentId === 'object' ? event.incidentId : null;
                const to = incident
                  ? `/incidents/${incident._id}`
                  : typeof event.incidentId === 'string'
                    ? `/incidents/${event.incidentId}`
                    : '/timeline';
                return (
                  <Link
                    key={event._id}
                    to={to}
                    onClick={() => setOpen(false)}
                    className="flex cursor-pointer items-start gap-3 rounded-lg px-3 py-2.5 transition-colors hover:bg-surface-2"
                  >
                    <EventIcon type={event.eventType} size={13} />
                    <span className="min-w-0 flex-1">
                      <span className="block text-xs font-medium text-fg">
                        {EVENT_TYPE_LABEL[event.eventType] || event.eventType}
                        {incident ? ` · ${incident.title}` : ''}
                      </span>
                      <span className="mt-0.5 block text-[11px] text-faint">
                        {timeAgo(event.occurredAt)}
                        {event.actor?.name ? ` · ${event.actor.name}` : ''}
                      </span>
                    </span>
                  </Link>
                );
              })}
          </div>
        </div>
      )}
    </div>
  );
}

function SidebarContent({ onNavigate = null }) {
  const { user } = useAuth();
  return (
    <>
      <div className="flex h-14 shrink-0 items-center gap-2.5 border-b border-edge px-4">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary-600 text-white shadow-md shadow-primary-700/40">
          <Activity size={16} aria-hidden="true" />
        </span>
        <span className="text-base font-semibold tracking-tight text-fg">BuildTrace</span>
      </div>

      <nav aria-label="Primary" className="flex-1 space-y-1 overflow-y-auto px-3 py-4">
        {NAV_ITEMS.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            onClick={onNavigate}
            className={({ isActive }) =>
              cx(
                'flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors',
                isActive
                  ? 'bg-primary-500/15 font-medium text-fg'
                  : 'text-muted hover:bg-surface-2 hover:text-fg'
              )
            }
          >
            {({ isActive }) => (
              <>
                <Icon size={17} className={isActive ? 'text-primary-300' : 'text-faint'} aria-hidden="true" />
                {label}
              </>
            )}
          </NavLink>
        ))}
      </nav>

      <div className="shrink-0 border-t border-edge px-4 py-4">
        <div className="flex items-center gap-3">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-surface-3 text-xs font-semibold text-muted">
            {initials(user?.name)}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-fg">{user?.name}</p>
            <p className="truncate text-xs text-faint">{user?.email}</p>
          </div>
        </div>
        {user?.role && (
          <div className="mt-3">
            <RoleBadge role={user.role} />
          </div>
        )}
      </div>
    </>
  );
}

/**
 * Application shell: fixed sidebar on desktop, slide-in drawer on mobile, a
 * sticky header with connection status + user menu, and the routed content.
 */
export function AppLayout() {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const location = useLocation();

  useEffect(() => {
    setDrawerOpen(false);
  }, [location.pathname]);

  return (
    <div className="flex min-h-dvh bg-canvas">
      <aside className="hidden w-60 shrink-0 flex-col border-r border-edge bg-surface lg:flex">
        <SidebarContent />
      </aside>

      {drawerOpen && (
        <div className="fixed inset-0 z-[800] lg:hidden">
          <div
            className="fixed inset-0 bg-black/70 backdrop-blur-sm"
            aria-hidden="true"
            onClick={() => setDrawerOpen(false)}
          />
          <aside className="route-in relative z-10 flex h-full w-64 flex-col border-r border-edge bg-surface">
            <button
              type="button"
              onClick={() => setDrawerOpen(false)}
              aria-label="Close navigation"
              className="absolute right-3 top-3.5 cursor-pointer rounded-md p-1 text-faint transition-colors hover:bg-surface-2 hover:text-fg"
            >
              <X size={17} />
            </button>
            <SidebarContent onNavigate={() => setDrawerOpen(false)} />
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-[700] flex h-14 shrink-0 items-center justify-between gap-3 border-b border-edge bg-canvas/85 px-4 backdrop-blur sm:px-6">
          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={() => setDrawerOpen(true)}
              aria-label="Open navigation"
              className="cursor-pointer rounded-md p-1.5 text-muted transition-colors hover:bg-surface-2 hover:text-fg lg:hidden"
            >
              <Menu size={18} />
            </button>
            <span className="flex items-center gap-2 lg:hidden">
              <span className="flex h-6 w-6 items-center justify-center rounded-md bg-primary-600 text-white">
                <Activity size={13} aria-hidden="true" />
              </span>
              <span className="text-sm font-semibold tracking-tight text-fg">BuildTrace</span>
            </span>
            <span className="hidden lg:block">
              <ProjectSwitcher />
            </span>
          </div>
          <div className="flex items-center gap-3">
            <NotificationsMenu />
            <ConnectionPill />
            <UserMenu />
          </div>
        </header>

        <main
          key={location.pathname}
          className="route-in mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6 lg:px-8"
        >
          <Outlet />
        </main>
      </div>
    </div>
  );
}
