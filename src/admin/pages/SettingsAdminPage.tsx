import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Shield, Users, X } from 'lucide-react';
import { apiRequest } from '../../services/api';
import { StatusBadge } from '../components/StatusBadge';
import { ToastBanner, type ToastMessage } from '../components/ToastBanner';
import { useAdminAuth } from '../hooks/useAdminAuth';
import {
  PRIORITY_LEVELS,
  type AdminRoleName,
  type AdminUserProfile,
  type BusinessSettingsEntity,
  type NotificationPreferenceEntity,
  type PermissionKey,
  type PriorityLevel,
  type RolePermissionConfig
} from '../../types/platform';

export const SettingsAdminPage: React.FC = () => {
  const { hasPermission, user } = useAdminAuth();
  const [tab, setTab] = useState<'business' | 'notifications' | 'users' | 'rbac'>('business');
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<ToastMessage | null>(null);

  const [settings, setSettings] = useState<BusinessSettingsEntity | null>(null);
  const [notifPrefs, setNotifPrefs] = useState<NotificationPreferenceEntity>({ emailEnabled: false, events: {} });
  const [emailConfigured, setEmailConfigured] = useState(false);

  const [adminUsers, setAdminUsers] = useState<AdminUserProfile[]>([]);
  const [roles, setRoles] = useState<RolePermissionConfig[]>([]);
  const [allPermKeys, setAllPermKeys] = useState<PermissionKey[]>([]);
  const [inviteOpen, setInviteOpen] = useState(false);

  // Invite form
  const [inviteName, setInviteName] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<AdminRoleName>('Operations Manager');
  const [invitePassword, setInvitePassword] = useState('');

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const sRes = await apiRequest<{
        businessSettings: BusinessSettingsEntity;
        notificationPreferences: NotificationPreferenceEntity;
        emailServiceConfigured: boolean;
      }>('/api/admin/settings');
      setSettings(sRes.businessSettings);
      setNotifPrefs(sRes.notificationPreferences);
      setEmailConfigured(sRes.emailServiceConfigured);

      if (hasPermission('admin_users.manage')) {
        const uRes = await apiRequest<{
          items: AdminUserProfile[];
          roles: RolePermissionConfig[];
          allPermissionKeys: PermissionKey[];
        }>('/api/admin/users');
        setAdminUsers(uRes.items);
        setRoles(uRes.roles);
        setAllPermKeys(uRes.allPermissionKeys);
      }
    } catch (err) {
      setToast({ type: 'error', text: err instanceof Error ? err.message : 'Failed to load settings.' });
    } finally {
      setLoading(false);
    }
  }, [hasPermission]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const handleSaveBusiness = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!settings) return;
    try {
      const res = await apiRequest<{ businessSettings: BusinessSettingsEntity }>('/api/admin/settings', {
        method: 'PUT',
        body: JSON.stringify(settings)
      });
      setSettings(res.businessSettings);
      setToast({ type: 'success', text: 'Business settings saved.' });
    } catch (err) {
      setToast({ type: 'error', text: err instanceof Error ? err.message : 'Save failed.' });
    }
  };

  const handleSaveNotifs = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiRequest('/api/admin/notification-preferences', {
        method: 'PUT',
        body: JSON.stringify(notifPrefs)
      });
      setToast({ type: 'success', text: 'Notification preferences saved.' });
    } catch (err) {
      setToast({ type: 'error', text: err instanceof Error ? err.message : 'Save failed.' });
    }
  };

  const handleCreateAdminUser = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiRequest('/api/admin/users', {
        method: 'POST',
        body: JSON.stringify({
          fullName: inviteName,
          email: inviteEmail,
          role: inviteRole,
          password: invitePassword
        })
      });
      setToast({ type: 'success', text: `Created admin account ${inviteEmail}.` });
      setInviteOpen(false);
      setInviteName('');
      setInviteEmail('');
      setInvitePassword('');
      await loadAll();
    } catch (err) {
      setToast({ type: 'error', text: err instanceof Error ? err.message : 'Create user failed.' });
    }
  };

  const handleUpdateUser = async (id: string, payload: { role?: AdminRoleName; accountStatus?: 'active' | 'suspended' }) => {
    try {
      await apiRequest(`/api/admin/users/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(payload)
      });
      setToast({ type: 'success', text: 'Administrator updated.' });
      await loadAll();
    } catch (err) {
      setToast({ type: 'error', text: err instanceof Error ? err.message : 'Update failed.' });
    }
  };

  const toggleRolePermission = async (roleObj: RolePermissionConfig, perm: PermissionKey) => {
    if (roleObj.role === 'Super Admin') return;
    const has = roleObj.permissions.includes(perm);
    const nextPerms = has ? roleObj.permissions.filter((p) => p !== perm) : [...roleObj.permissions, perm];
    try {
      await apiRequest(`/api/admin/roles/${encodeURIComponent(roleObj.role)}`, {
        method: 'PUT',
        body: JSON.stringify({ permissions: nextPerms })
      });
      setToast({ type: 'success', text: `Updated ${roleObj.role} permissions.` });
      await loadAll();
    } catch (err) {
      setToast({ type: 'error', text: err instanceof Error ? err.message : 'Permission update failed.' });
    }
  };

  if (loading || !settings) {
    return <div className="py-12 text-center text-xs">Loading platform settings...</div>;
  }

  return (
    <div className="space-y-5">
      <ToastBanner toast={toast} onDismiss={() => setToast(null)} />

      <div>
        <h2 className="font-display text-2xl font-bold">Platform Settings &amp; RBAC Security</h2>
        <p className="text-xs text-[#052E16]/70 dark:text-lime-200/75">
          Configure company SLA defaults, notification preferences, administrator accounts, and role permissions.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setTab('business')}
          className={`rounded-lg px-3.5 py-2 text-xs font-bold cursor-pointer ${
            tab === 'business'
              ? 'bg-[#052E16] text-[#BEF264] dark:bg-lime-400 dark:text-[#052E16]'
              : 'border border-emerald-950/15 bg-white text-[#052E16] dark:border-lime-300/20 dark:bg-[#072716] dark:text-lime-100'
          }`}
        >
          Business &amp; SLA
        </button>
        <button
          type="button"
          onClick={() => setTab('notifications')}
          className={`rounded-lg px-3.5 py-2 text-xs font-bold cursor-pointer ${
            tab === 'notifications'
              ? 'bg-[#052E16] text-[#BEF264] dark:bg-lime-400 dark:text-[#052E16]'
              : 'border border-emerald-950/15 bg-white text-[#052E16] dark:border-lime-300/20 dark:bg-[#072716] dark:text-lime-100'
          }`}
        >
          Notifications
        </button>
        {hasPermission('admin_users.manage') && (
          <>
            <button
              type="button"
              onClick={() => setTab('users')}
              className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-xs font-bold cursor-pointer ${
                tab === 'users'
                  ? 'bg-[#052E16] text-[#BEF264] dark:bg-lime-400 dark:text-[#052E16]'
                  : 'border border-emerald-950/15 bg-white text-[#052E16] dark:border-lime-300/20 dark:bg-[#072716] dark:text-lime-100'
              }`}
            >
              <Users className="h-3.5 w-3.5" /> Admin Users
            </button>
            <button
              type="button"
              onClick={() => setTab('rbac')}
              className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-xs font-bold cursor-pointer ${
                tab === 'rbac'
                  ? 'bg-[#052E16] text-[#BEF264] dark:bg-lime-400 dark:text-[#052E16]'
                  : 'border border-emerald-950/15 bg-white text-[#052E16] dark:border-lime-300/20 dark:bg-[#072716] dark:text-lime-100'
              }`}
            >
              <Shield className="h-3.5 w-3.5" /> Role Permissions
            </button>
          </>
        )}
      </div>

      {tab === 'business' && (
        <form
          onSubmit={handleSaveBusiness}
          className="rounded-xl border border-emerald-950/12 bg-white p-6 shadow-xs dark:border-lime-300/15 dark:bg-[#072716]"
        >
          <div className="grid grid-cols-1 gap-4 text-xs sm:grid-cols-2">
            <div>
              <label className="block font-semibold">Legal Business Name</label>
              <input
                value={settings.businessName}
                onChange={(e) => setSettings({ ...settings, businessName: e.target.value })}
                disabled={!hasPermission('settings.manage')}
                className="mt-1 w-full rounded-lg border border-emerald-950/15 bg-[#F6FAF1] px-3 py-2 dark:border-lime-300/20 dark:bg-[#03170C]"
              />
            </div>
            <div>
              <label className="block font-semibold">Dispatch Phone</label>
              <input
                value={settings.phone}
                onChange={(e) => setSettings({ ...settings, phone: e.target.value })}
                disabled={!hasPermission('settings.manage')}
                className="mt-1 w-full rounded-lg border border-emerald-950/15 bg-[#F6FAF1] px-3 py-2 dark:border-lime-300/20 dark:bg-[#03170C]"
              />
            </div>
            <div>
              <label className="block font-semibold">Dispatch Email</label>
              <input
                type="email"
                value={settings.email}
                onChange={(e) => setSettings({ ...settings, email: e.target.value })}
                disabled={!hasPermission('settings.manage')}
                className="mt-1 w-full rounded-lg border border-emerald-950/15 bg-[#F6FAF1] px-3 py-2 dark:border-lime-300/20 dark:bg-[#03170C]"
              />
            </div>
            <div>
              <label className="block font-semibold">Operating Hours</label>
              <input
                value={settings.hours}
                onChange={(e) => setSettings({ ...settings, hours: e.target.value })}
                disabled={!hasPermission('settings.manage')}
                className="mt-1 w-full rounded-lg border border-emerald-950/15 bg-[#F6FAF1] px-3 py-2 dark:border-lime-300/20 dark:bg-[#03170C]"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="block font-semibold">Headquarters Address</label>
              <input
                value={settings.address}
                onChange={(e) => setSettings({ ...settings, address: e.target.value })}
                disabled={!hasPermission('settings.manage')}
                className="mt-1 w-full rounded-lg border border-emerald-950/15 bg-[#F6FAF1] px-3 py-2 dark:border-lime-300/20 dark:bg-[#03170C]"
              />
            </div>
            <div>
              <label className="block font-semibold">Default Work Order Priority</label>
              <select
                value={settings.defaultWoPriority}
                onChange={(e) => setSettings({ ...settings, defaultWoPriority: e.target.value as PriorityLevel })}
                disabled={!hasPermission('settings.manage')}
                className="mt-1 w-full rounded-lg border border-emerald-950/15 bg-[#F6FAF1] px-3 py-2 dark:border-lime-300/20 dark:bg-[#03170C]"
              >
                {PRIORITY_LEVELS.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block font-semibold">Default SLA Window (Hours)</label>
              <input
                type="number"
                min={4}
                value={settings.defaultSlaHours}
                onChange={(e) => setSettings({ ...settings, defaultSlaHours: Number(e.target.value) || 48 })}
                disabled={!hasPermission('settings.manage')}
                className="mt-1 w-full rounded-lg border border-emerald-950/15 bg-[#F6FAF1] px-3 py-2 dark:border-lime-300/20 dark:bg-[#03170C]"
              />
            </div>
          </div>

          {hasPermission('settings.manage') && (
            <button
              type="submit"
              className="mt-5 rounded-lg bg-[#052E16] px-4 py-2 text-xs font-bold text-[#BEF264] dark:bg-lime-400 dark:text-[#052E16] cursor-pointer"
            >
              Save Business Settings
            </button>
          )}
        </form>
      )}

      {tab === 'notifications' && (
        <form
          onSubmit={handleSaveNotifs}
          className="rounded-xl border border-emerald-950/12 bg-white p-6 shadow-xs dark:border-lime-300/15 dark:bg-[#072716] space-y-4 text-xs"
        >
          <div className="rounded-lg bg-[#F6FAF1] p-3 dark:bg-[#03170C]">
            <p className="font-semibold">
              Email Delivery Status:{' '}
              {emailConfigured ? 'Resend API Configured' : 'Not Configured (in-app alerts active; configure RESEND_API_KEY for email alerts)'}
            </p>
          </div>
          <label className="flex items-center gap-2 font-semibold">
            <input
              type="checkbox"
              checked={notifPrefs.emailEnabled}
              onChange={(e) => setNotifPrefs({ ...notifPrefs, emailEnabled: e.target.checked })}
            />
            Enable Email Notifications for My Account
          </label>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {Object.entries(notifPrefs.events).map(([key, enabled]) => (
              <label key={key} className="flex items-center gap-2 rounded-lg border border-emerald-950/10 p-2.5 dark:border-lime-300/15">
                <input
                  type="checkbox"
                  checked={enabled}
                  onChange={(e) =>
                    setNotifPrefs({
                      ...notifPrefs,
                      events: { ...notifPrefs.events, [key]: e.target.checked }
                    })
                  }
                />
                <span className="font-mono text-[11px]">{key}</span>
              </label>
            ))}
          </div>
          <button
            type="submit"
            className="rounded-lg bg-[#052E16] px-4 py-2 text-xs font-bold text-[#BEF264] dark:bg-lime-400 dark:text-[#052E16] cursor-pointer"
          >
            Save Preferences
          </button>
        </form>
      )}

      {tab === 'users' && hasPermission('admin_users.manage') && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Link
              to="/admin/users"
              className="text-xs font-semibold text-emerald-800 underline hover:text-[#052E16] dark:text-lime-300"
            >
              Open Full Admin User Management Page &rarr;
            </Link>
            <button
              type="button"
              onClick={() => setInviteOpen(true)}
              className="inline-flex items-center gap-2 rounded-lg bg-[#052E16] px-4 py-2 text-xs font-bold text-[#BEF264] dark:bg-lime-400 dark:text-[#052E16] cursor-pointer"
            >
              <Plus className="h-4 w-4" /> Add Administrator
            </button>
          </div>
          <div className="overflow-hidden rounded-xl border border-emerald-950/12 bg-white shadow-xs dark:border-lime-300/15 dark:bg-[#072716]">
            <table className="w-full text-left text-xs">
              <thead className="bg-[#F6FAF1] text-[11px] font-bold uppercase dark:bg-[#052312]">
                <tr>
                  <th className="px-4 py-3">Administrator</th>
                  <th className="px-4 py-3">Role</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-emerald-950/10 dark:divide-lime-300/10">
                {adminUsers.map((u) => (
                  <tr key={u.id}>
                    <td className="px-4 py-3">
                      <div className="font-bold">{u.fullName}</div>
                      <div className="text-[11px] text-[#052E16]/70 dark:text-lime-200/70">{u.email}</div>
                    </td>
                    <td className="px-4 py-3">
                      <select
                        value={u.role}
                        onChange={(e) => void handleUpdateUser(u.id, { role: e.target.value as AdminRoleName })}
                        className="rounded-md border border-emerald-950/15 bg-[#F6FAF1] px-2 py-1 text-[11px] font-semibold dark:border-lime-300/20 dark:bg-[#03170C]"
                      >
                        {roles.map((r) => (
                          <option key={r.role} value={r.role}>
                            {r.role}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge value={u.accountStatus} />
                    </td>
                    <td className="px-4 py-3 text-right">
                      {u.id !== user?.id && (
                        <button
                          type="button"
                          onClick={() =>
                            void handleUpdateUser(u.id, {
                              accountStatus: u.accountStatus === 'active' ? 'suspended' : 'active'
                            })
                          }
                          className="rounded-md border border-emerald-950/15 px-2.5 py-1 text-[11px] font-semibold hover:bg-lime-100 dark:border-lime-300/20 cursor-pointer"
                        >
                          {u.accountStatus === 'active' ? 'Suspend' : 'Reactivate'}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'rbac' && hasPermission('admin_users.manage') && (
        <div className="overflow-x-auto rounded-xl border border-emerald-950/12 bg-white shadow-xs dark:border-lime-300/15 dark:bg-[#072716]">
          <table className="w-full text-left text-xs">
            <thead className="bg-[#F6FAF1] text-[11px] font-bold uppercase dark:bg-[#052312]">
              <tr>
                <th className="px-4 py-3">Permission Key</th>
                {roles.map((r) => (
                  <th key={r.role} className="px-3 py-3 text-center">
                    {r.role}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-emerald-950/10 dark:divide-lime-300/10">
              {allPermKeys.map((perm) => (
                <tr key={perm}>
                  <td className="px-4 py-2 font-mono text-[11px] font-semibold">{perm}</td>
                  {roles.map((r) => {
                    const checked = r.role === 'Super Admin' || r.permissions.includes(perm);
                    return (
                      <td key={r.role} className="px-3 py-2 text-center">
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={r.role === 'Super Admin'}
                          onChange={() => void toggleRolePermission(r, perm)}
                          aria-label={`${r.role} ${perm}`}
                        />
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {inviteOpen && (
        <div role="dialog" aria-modal="true" className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="fixed inset-0 bg-emerald-950/60" onClick={() => setInviteOpen(false)} />
          <form
            onSubmit={handleCreateAdminUser}
            className="relative z-10 w-full max-w-md rounded-xl border border-emerald-950/15 bg-white p-6 shadow-2xl dark:border-lime-300/20 dark:bg-[#072716]"
          >
            <div className="flex items-center justify-between">
              <h3 className="font-display text-lg font-bold">Add Administrator Account</h3>
              <button type="button" onClick={() => setInviteOpen(false)} className="rounded p-1 cursor-pointer">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="mt-4 space-y-3 text-xs">
              <div>
                <label className="block font-semibold">Full Name *</label>
                <input
                  required
                  value={inviteName}
                  onChange={(e) => setInviteName(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-emerald-950/15 bg-[#F6FAF1] px-3 py-2 dark:border-lime-300/20 dark:bg-[#03170C]"
                />
              </div>
              <div>
                <label className="block font-semibold">Email *</label>
                <input
                  required
                  type="email"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-emerald-950/15 bg-[#F6FAF1] px-3 py-2 dark:border-lime-300/20 dark:bg-[#03170C]"
                />
              </div>
              <div>
                <label className="block font-semibold">Role *</label>
                <select
                  value={inviteRole}
                  onChange={(e) => setInviteRole(e.target.value as AdminRoleName)}
                  className="mt-1 w-full rounded-lg border border-emerald-950/15 bg-[#F6FAF1] px-3 py-2 dark:border-lime-300/20 dark:bg-[#03170C]"
                >
                  {roles.map((r) => (
                    <option key={r.role} value={r.role}>
                      {r.role}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block font-semibold">Initial Password (10+ characters) *</label>
                <input
                  required
                  minLength={10}
                  type="password"
                  value={invitePassword}
                  onChange={(e) => setInvitePassword(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-emerald-950/15 bg-[#F6FAF1] px-3 py-2 dark:border-lime-300/20 dark:bg-[#03170C]"
                />
              </div>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setInviteOpen(false)}
                className="rounded-lg border border-emerald-950/15 px-4 py-2 text-xs font-semibold cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="rounded-lg bg-[#052E16] px-4 py-2 text-xs font-bold text-[#BEF264] dark:bg-lime-400 dark:text-[#052E16] cursor-pointer"
              >
                Create Account
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
