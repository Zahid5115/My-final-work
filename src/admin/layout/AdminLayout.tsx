import React, { useCallback, useEffect, useState } from 'react';
import { Link, Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  BarChart3,
  Bell,
  Briefcase,
  Building2,
  Check,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  ExternalLink,
  FileSpreadsheet,
  Globe2,
  Images,
  LayoutDashboard,
  LogOut,
  Mail,
  Menu,
  Moon,
  Settings,
  ShieldAlert,
  ShieldCheck,
  Star,
  Sun,
  UserCircle2,
  Users,
  Wrench,
  X
} from 'lucide-react';
import { useAdminAuth } from '../hooks/useAdminAuth';
import { apiRequest } from '../../services/api';
import type { NotificationEntity, PermissionKey } from '../../types/platform';

interface NavItem {
  label: string;
  to: string;
  icon: React.ComponentType<{ className?: string }>;
  permission?: PermissionKey;
}

const ADMIN_NAV_ITEMS: NavItem[] = [
  { label: 'Dashboard', to: '/admin/dashboard', icon: LayoutDashboard, permission: 'dashboard.view' },
  { label: 'Work Orders', to: '/admin/work-orders', icon: ClipboardList, permission: 'work_orders.read' },
  { label: 'Urgent Dispatch', to: '/admin/dispatch', icon: ShieldAlert, permission: 'dispatch.read' },
  { label: 'Bid Requests', to: '/admin/bid-requests', icon: FileSpreadsheet, permission: 'bid_requests.read' },
  { label: 'Vendors & Bids', to: '/admin/vendors', icon: Briefcase, permission: 'vendors.read' },
  { label: 'Clients', to: '/admin/clients', icon: Building2, permission: 'clients.read' },
  { label: 'Services', to: '/admin/services', icon: Wrench, permission: 'services.manage' },
  { label: 'Gallery', to: '/admin/gallery', icon: Images, permission: 'gallery.manage' },
  { label: 'Coverage', to: '/admin/coverage', icon: Globe2, permission: 'coverage.manage' },
  { label: 'Reviews', to: '/admin/reviews', icon: Star, permission: 'reviews.manage' },
  { label: 'Messages', to: '/admin/messages', icon: Mail, permission: 'messages.manage' },
  { label: 'Reports', to: '/admin/reports', icon: BarChart3, permission: 'reports.view' },
  { label: 'Admin Users', to: '/admin/users', icon: Users, permission: 'admin_users.manage' },
  { label: 'Settings & RBAC', to: '/admin/settings', icon: Settings },
  { label: 'My Profile', to: '/admin/profile', icon: UserCircle2 }
];

export const ProtectedAdminRoute: React.FC<{
  requiredPermission?: PermissionKey;
  children: React.ReactNode;
}> = ({ requiredPermission, children }) => {
  const { user, loading, hasPermission } = useAdminAuth();

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#F6FAF1] dark:bg-[#03170C]">
        <div className="space-y-3 text-center">
          <div className="mx-auto h-9 w-9 animate-spin rounded-full border-2 border-[#052E16] border-t-transparent dark:border-lime-400 dark:border-t-transparent" />
          <p className="text-xs font-semibold text-[#052E16]/75 dark:text-lime-200/80">
            Verifying administrator session...
          </p>
        </div>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/admin/login" replace />;
  }

  if (requiredPermission && !hasPermission(requiredPermission)) {
    return (
      <div className="mx-auto max-w-lg rounded-2xl border border-red-200 bg-white p-8 text-center shadow-sm dark:border-red-500/30 dark:bg-[#072716]">
        <ShieldCheck className="mx-auto h-10 w-10 text-red-700 dark:text-red-300" />
        <h2 className="mt-3 font-display text-xl font-bold text-[#052E16] dark:text-lime-50">
          Access Restricted
        </h2>
        <p className="mt-2 text-sm text-[#052E16]/75 dark:text-lime-100/75">
          Your role (<strong>{user.role}</strong>) does not have permission for this module (
          <code className="font-mono">{requiredPermission}</code>).
        </p>
      </div>
    );
  }

  return <>{children}</>;
};

export const AdminLayout: React.FC<{
  isDark: boolean;
  onToggleTheme: () => void;
}> = ({ isDark, onToggleTheme }) => {
  const { user, logout, hasPermission } = useAdminAuth();
  const location = useLocation();
  const navigate = useNavigate();

  const [collapsed, setCollapsed] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [notifications, setNotifications] = useState<NotificationEntity[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);

  const loadNotifications = useCallback(async () => {
    try {
      const data = await apiRequest<{ items: NotificationEntity[]; unreadCount: number }>(
        '/api/admin/notifications',
        { skipUnauthorizedCallback: true }
      );
      setNotifications(data.items);
      setUnreadCount(data.unreadCount);
    } catch {
      // Non-blocking notification fetch
    }
  }, []);

  useEffect(() => {
    void loadNotifications();
    const timer = window.setInterval(() => {
      void loadNotifications();
    }, 30000);
    return () => window.clearInterval(timer);
  }, [loadNotifications]);

  useEffect(() => {
    setMobileNavOpen(false);
    setProfileOpen(false);
    setNotifOpen(false);
  }, [location.pathname]);

  const handleMarkRead = async (id: string) => {
    await apiRequest(`/api/admin/notifications/${id}/read`, { method: 'PATCH' });
    await loadNotifications();
  };

  const handleMarkAllRead = async () => {
    await apiRequest('/api/admin/notifications/read-all', { method: 'POST' });
    await loadNotifications();
  };

  const handleLogout = async () => {
    await logout();
    navigate('/admin/login', { replace: true });
  };

  const visibleNavItems = ADMIN_NAV_ITEMS.filter(
    (item) => !item.permission || hasPermission(item.permission)
  );

  const currentNav = visibleNavItems.find((item) => location.pathname.startsWith(item.to));

  return (
    <div className="flex min-h-screen bg-[#F6FAF1] text-[#052E16] dark:bg-[#03170C] dark:text-lime-50">
      {/* Desktop Collapsible Sidebar */}
      <aside
        className={`hidden lg:flex flex-col shrink-0 border-r border-emerald-950/12 bg-[#052E16] text-lime-50 dark:border-lime-300/15 dark:bg-[#021209] transition-all duration-200 ${
          collapsed ? 'w-[72px]' : 'w-64'
        }`}
      >
        <div className="flex h-16 items-center justify-between border-b border-lime-300/15 px-4">
          {!collapsed && (
            <Link to="/admin/dashboard" className="font-display text-sm font-bold tracking-tight text-[#BEF264] truncate">
              Smoker&apos;s Admin
            </Link>
          )}
          <button
            type="button"
            onClick={() => setCollapsed((c) => !c)}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-lime-200 hover:bg-white/10 cursor-pointer"
          >
            {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
          </button>
        </div>

        <nav aria-label="Admin Navigation" className="flex-1 overflow-y-auto px-2.5 py-4 space-y-1">
          {visibleNavItems.map((item) => {
            const Icon = item.icon;
            const active = location.pathname === item.to || location.pathname.startsWith(`${item.to}/`);
            return (
              <Link
                key={item.to}
                to={item.to}
                title={collapsed ? item.label : undefined}
                className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-xs font-semibold transition-colors ${
                  active
                    ? 'bg-[#BEF264] text-[#052E16]'
                    : 'text-lime-100/80 hover:bg-white/10 hover:text-white'
                }`}
              >
                <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                {!collapsed && <span className="truncate">{item.label}</span>}
              </Link>
            );
          })}
        </nav>

        <div className="border-t border-lime-300/15 p-3">
          <Link
            to="/"
            className="flex items-center justify-center gap-2 rounded-lg border border-lime-300/25 px-3 py-2 text-xs font-semibold text-lime-200 hover:bg-white/10"
          >
            <ExternalLink className="h-3.5 w-3.5 shrink-0" />
            {!collapsed && <span>Public Website</span>}
          </Link>
        </div>
      </aside>

      {/* Mobile Navigation Drawer */}
      {mobileNavOpen && (
        <div className="fixed inset-0 z-50 flex lg:hidden">
          <div className="fixed inset-0 bg-emerald-950/65" onClick={() => setMobileNavOpen(false)} />
          <aside className="relative z-10 flex w-72 max-w-[85vw] flex-col bg-[#052E16] text-lime-50 shadow-2xl">
            <div className="flex h-16 items-center justify-between border-b border-lime-300/15 px-4">
              <span className="font-display text-sm font-bold text-[#BEF264]">
                Smoker&apos;s Admin Portal
              </span>
              <button
                type="button"
                onClick={() => setMobileNavOpen(false)}
                aria-label="Close navigation drawer"
                className="rounded-lg p-1.5 text-lime-200 hover:bg-white/10 cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <nav className="flex-1 overflow-y-auto p-3 space-y-1">
              {visibleNavItems.map((item) => {
                const Icon = item.icon;
                const active = location.pathname === item.to || location.pathname.startsWith(`${item.to}/`);
                return (
                  <Link
                    key={item.to}
                    to={item.to}
                    className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-xs font-semibold ${
                      active ? 'bg-[#BEF264] text-[#052E16]' : 'text-lime-100/85 hover:bg-white/10'
                    }`}
                  >
                    <Icon className="h-4 w-4 shrink-0" />
                    <span>{item.label}</span>
                  </Link>
                );
              })}
            </nav>
            <div className="border-t border-lime-300/15 p-3">
              <Link
                to="/"
                className="flex items-center justify-center gap-2 rounded-lg border border-lime-300/25 px-3 py-2 text-xs font-semibold text-lime-200"
              >
                <ExternalLink className="h-3.5 w-3.5" />
                <span>View Public Website</span>
              </Link>
            </div>
          </aside>
        </div>
      )}

      {/* Main Content Shell */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-16 items-center justify-between gap-3 border-b border-emerald-950/12 bg-white/95 px-4 backdrop-blur-md dark:border-lime-300/15 dark:bg-[#052312]/95 sm:px-6">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileNavOpen(true)}
              aria-label="Open admin menu"
              className="inline-flex lg:hidden h-9 w-9 items-center justify-center rounded-lg border border-emerald-950/15 bg-[#F6FAF1] text-[#052E16] dark:border-lime-300/20 dark:bg-[#072716] dark:text-lime-100 cursor-pointer"
            >
              <Menu className="h-4 w-4" />
            </button>
            <div className="min-w-0">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-emerald-800 dark:text-lime-300">
                Operations Management
              </p>
              <h1 className="font-display text-base sm:text-lg font-bold truncate text-[#052E16] dark:text-lime-50">
                {currentNav?.label ?? 'Admin Portal'}
              </h1>
            </div>
          </div>

          <div className="flex items-center gap-2 sm:gap-3 shrink-0">
            {/* Theme Toggle */}
            <button
              type="button"
              onClick={onToggleTheme}
              aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
              className="flex h-9 w-9 items-center justify-center rounded-lg border border-emerald-950/15 bg-lime-100 text-[#052E16] hover:bg-lime-200 dark:border-lime-400/40 dark:bg-lime-400 dark:text-[#052E16] cursor-pointer"
            >
              {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </button>

            {/* Notification Bell Popover */}
            <div className="relative">
              <button
                type="button"
                onClick={() => {
                  setNotifOpen((o) => !o);
                  setProfileOpen(false);
                }}
                aria-label="Open Notification Center"
                className="relative flex h-9 w-9 items-center justify-center rounded-lg border border-emerald-950/15 bg-white text-[#052E16] hover:bg-lime-100 dark:border-lime-300/20 dark:bg-[#072716] dark:text-lime-100 cursor-pointer"
              >
                <Bell className="h-4 w-4" />
                {unreadCount > 0 && (
                  <span className="absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-orange-600 px-1 font-mono-tabular text-[10px] font-bold text-white">
                    {unreadCount > 9 ? '9+' : unreadCount}
                  </span>
                )}
              </button>

              {notifOpen && (
                <div className="absolute right-0 mt-2 w-80 max-w-[90vw] rounded-xl border border-emerald-950/15 bg-white p-3 shadow-xl dark:border-lime-300/25 dark:bg-[#072716]">
                  <div className="flex items-center justify-between border-b border-emerald-950/10 pb-2 dark:border-lime-300/15">
                    <span className="text-xs font-bold text-[#052E16] dark:text-lime-50">
                      Notifications ({unreadCount} unread)
                    </span>
                    {unreadCount > 0 && (
                      <button
                        type="button"
                        onClick={handleMarkAllRead}
                        className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-800 hover:underline dark:text-lime-300 cursor-pointer"
                      >
                        <Check className="h-3 w-3" />
                        Mark all read
                      </button>
                    )}
                  </div>
                  <div className="mt-2 max-h-72 overflow-y-auto divide-y divide-emerald-950/10 dark:divide-lime-300/10">
                    {notifications.length === 0 ? (
                      <p className="py-6 text-center text-xs text-[#052E16]/60 dark:text-lime-200/60">
                        No notifications yet.
                      </p>
                    ) : (
                      notifications.slice(0, 10).map((n) => (
                        <div
                          key={n.id}
                          className={`py-2.5 text-xs ${n.isRead ? 'opacity-65' : 'font-semibold'}`}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <p className="text-[#052E16] dark:text-lime-50">{n.title}</p>
                            {!n.isRead && (
                              <button
                                type="button"
                                onClick={() => handleMarkRead(n.id)}
                                className="shrink-0 text-[10px] text-emerald-700 hover:underline dark:text-lime-300 cursor-pointer"
                              >
                                Read
                              </button>
                            )}
                          </div>
                          <p className="mt-0.5 text-[11px] font-normal text-[#052E16]/75 dark:text-lime-200/75">
                            {n.message}
                          </p>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Profile Dropdown */}
            <div className="relative">
              <button
                type="button"
                onClick={() => {
                  setProfileOpen((o) => !o);
                  setNotifOpen(false);
                }}
                className="flex items-center gap-2 rounded-lg border border-emerald-950/15 bg-[#F6FAF1] px-2.5 py-1.5 text-left hover:bg-lime-100 dark:border-lime-300/20 dark:bg-[#072716] dark:hover:bg-[#0D3D23] cursor-pointer"
              >
                <span className="flex h-7 w-7 items-center justify-center rounded-md bg-[#052E16] font-display text-xs font-bold text-[#BEF264] dark:bg-lime-400 dark:text-[#052E16]">
                  {user?.fullName?.charAt(0).toUpperCase() || 'A'}
                </span>
                <div className="hidden sm:block">
                  <p className="text-xs font-bold leading-none text-[#052E16] dark:text-lime-50">
                    {user?.fullName}
                  </p>
                  <p className="mt-0.5 text-[10px] font-medium text-emerald-800 dark:text-lime-300">
                    {user?.role}
                  </p>
                </div>
              </button>

              {profileOpen && (
                <div className="absolute right-0 mt-2 w-56 rounded-xl border border-emerald-950/15 bg-white p-2 shadow-xl dark:border-lime-300/25 dark:bg-[#072716]">
                  <div className="border-b border-emerald-950/10 px-2.5 py-2 dark:border-lime-300/15">
                    <p className="text-xs font-bold truncate text-[#052E16] dark:text-lime-50">
                      {user?.email}
                    </p>
                    <p className="text-[11px] text-emerald-800 dark:text-lime-300">{user?.role}</p>
                  </div>
                  <div className="mt-1 space-y-0.5">
                    <Link
                      to="/admin/profile"
                      className="flex items-center gap-2 rounded-lg px-2.5 py-2 text-xs font-semibold text-[#052E16] hover:bg-lime-100 dark:text-lime-100 dark:hover:bg-white/10"
                    >
                      <Users className="h-3.5 w-3.5" />
                      My Profile &amp; Security
                    </Link>
                    <Link
                      to="/admin/settings"
                      className="flex items-center gap-2 rounded-lg px-2.5 py-2 text-xs font-semibold text-[#052E16] hover:bg-lime-100 dark:text-lime-100 dark:hover:bg-white/10"
                    >
                      <Settings className="h-3.5 w-3.5" />
                      Platform Settings
                    </Link>
                    <button
                      type="button"
                      onClick={handleLogout}
                      className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-xs font-semibold text-red-700 hover:bg-red-50 dark:text-red-300 dark:hover:bg-red-500/15 cursor-pointer"
                    >
                      <LogOut className="h-3.5 w-3.5" />
                      Sign Out
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </header>

        <main className="flex-1 p-4 sm:p-6 lg:p-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
};
