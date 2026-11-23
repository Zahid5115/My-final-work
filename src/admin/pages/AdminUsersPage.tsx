import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Mail,
  Search,
  Shield,
  ShieldCheck,
  UserCheck,
  UserPlus,
  Users,
  X
} from 'lucide-react';
import { apiRequest } from '../../services/api';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { StatusBadge } from '../components/StatusBadge';
import { ToastBanner, type ToastMessage } from '../components/ToastBanner';
import { useAdminAuth } from '../hooks/useAdminAuth';
import type {
  AdminRoleName,
  AdminUserProfile,
  PermissionKey,
  RolePermissionConfig
} from '../../types/platform';

const ROLE_SUMMARIES: Record<AdminRoleName, string> = {
  'Super Admin': 'Full system authority, admin invitations, RBAC management, and platform settings.',
  Admin: 'Full operational oversight across work orders, vendors, clients, and content.',
  'Operations Manager': 'Work orders, urgent dispatch, QC verification, and client/bid operations.',
  'Vendor Manager': 'Vendor onboarding, compliance approvals, bid review, and dispatch assignment.',
  'Support Manager': 'Client communications, public messages, bid inquiries, and review moderation.'
};

export const AdminUsersPage: React.FC = () => {
  const { user, authStatus } = useAdminAuth();
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const [tab, setTab] = useState<'directory' | 'rbac'>('directory');

  const [adminUsers, setAdminUsers] = useState<AdminUserProfile[]>([]);
  const [roles, setRoles] = useState<RolePermissionConfig[]>([]);
  const [allPermKeys, setAllPermKeys] = useState<PermissionKey[]>([]);
  const [backendMode, setBackendMode] = useState<'supabase' | 'local'>(
    authStatus?.authMode === 'supabase' ? 'supabase' : 'local'
  );

  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState<string>('ALL');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');

  // Invite / Create modal
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteName, setInviteName] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [invitePhone, setInvitePhone] = useState('');
  const [inviteRole, setInviteRole] = useState<AdminRoleName>('Operations Manager');
  const [inviteMode, setInviteMode] = useState<'password' | 'email'>('password');
  const [invitePassword, setInvitePassword] = useState('');
  const [submittingInvite, setSubmittingInvite] = useState(false);

  // Confirm dialog state for sensitive role / status changes
  const [pendingAction, setPendingAction] = useState<{
    target: AdminUserProfile;
    title: string;
    description: string;
    confirmLabel: string;
    destructive: boolean;
    payload: { role?: AdminRoleName; accountStatus?: 'active' | 'suspended' };
  } | null>(null);
  const [processingAction, setProcessingAction] = useState(false);

  const loadUsersAndRoles = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiRequest<{
        items: AdminUserProfile[];
        roles: RolePermissionConfig[];
        allPermissionKeys: PermissionKey[];
        authMode?: 'supabase' | 'local';
      }>('/api/admin/users');
      setAdminUsers(res.items);
      setRoles(res.roles);
      setAllPermKeys(res.allPermissionKeys);
      if (res.authMode) {
        setBackendMode(res.authMode);
      }
    } catch (err) {
      setToast({
        type: 'error',
        text: err instanceof Error ? err.message : 'Unable to load administrator directory.'
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadUsersAndRoles();
  }, [loadUsersAndRoles]);

  const filteredUsers = useMemo(() => {
    const q = search.trim().toLowerCase();
    return adminUsers.filter((u) => {
      if (roleFilter !== 'ALL' && u.role !== roleFilter) return false;
      if (statusFilter !== 'ALL' && u.accountStatus !== statusFilter) return false;
      if (
        q &&
        !u.fullName.toLowerCase().includes(q) &&
        !u.email.toLowerCase().includes(q) &&
        !u.role.toLowerCase().includes(q)
      ) {
        return false;
      }
      return true;
    });
  }, [adminUsers, search, roleFilter, statusFilter]);

  const stats = useMemo(() => {
    return {
      total: adminUsers.length,
      active: adminUsers.filter((u) => u.accountStatus === 'active').length,
      invited: adminUsers.filter((u) => u.accountStatus === 'invited').length,
      suspended: adminUsers.filter((u) => u.accountStatus === 'suspended').length
    };
  }, [adminUsers]);

  const handleCreateAdminUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmittingInvite(true);
    try {
      const res = await apiRequest<{ item: AdminUserProfile }>('/api/admin/users', {
        method: 'POST',
        body: JSON.stringify({
          fullName: inviteName,
          email: inviteEmail,
          phone: invitePhone,
          role: inviteRole,
          inviteMode,
          password: inviteMode === 'password' ? invitePassword : ''
        })
      });
      setToast({
        type: 'success',
        text:
          inviteMode === 'email'
            ? `Invitation sent to ${res.item.email} (${res.item.role}).`
            : `Administrator account created for ${res.item.email} (${res.item.role}).`
      });
      setInviteOpen(false);
      setInviteName('');
      setInviteEmail('');
      setInvitePhone('');
      setInvitePassword('');
      await loadUsersAndRoles();
    } catch (err) {
      setToast({
        type: 'error',
        text: err instanceof Error ? err.message : 'Failed to create administrator account.'
      });
    } finally {
      setSubmittingInvite(false);
    }
  };

  const executeUpdateUser = async (
    id: string,
    payload: { role?: AdminRoleName; accountStatus?: 'active' | 'suspended' }
  ) => {
    setProcessingAction(true);
    try {
      await apiRequest(`/api/admin/users/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(payload)
      });
      setToast({ type: 'success', text: 'Administrator privileges updated on server.' });
      setPendingAction(null);
      await loadUsersAndRoles();
    } catch (err) {
      setToast({
        type: 'error',
        text: err instanceof Error ? err.message : 'Unable to update administrator.'
      });
    } finally {
      setProcessingAction(false);
    }
  };

  const requestRoleChange = (target: AdminUserProfile, nextRole: AdminRoleName) => {
    if (nextRole === target.role) return;
    if (nextRole === 'Super Admin' || target.role === 'Super Admin') {
      setPendingAction({
        target,
        title: `Confirm Role Change for ${target.fullName}`,
        description: `Change ${target.email} from ${target.role} to ${nextRole}? Super Admin holds unrestricted system-wide authority.`,
        confirmLabel: `Assign ${nextRole}`,
        destructive: target.role === 'Super Admin',
        payload: { role: nextRole }
      });
      return;
    }
    void executeUpdateUser(target.id, { role: nextRole });
  };

  const requestStatusToggle = (target: AdminUserProfile) => {
    const nextStatus = target.accountStatus === 'active' ? 'suspended' : 'active';
    setPendingAction({
      target,
      title:
        nextStatus === 'suspended'
          ? `Suspend ${target.fullName}?`
          : `Reactivate ${target.fullName}?`,
      description:
        nextStatus === 'suspended'
          ? `Suspending ${target.email} immediately revokes Admin Portal access across protected server endpoints.`
          : `Reactivating ${target.email} restores Admin Portal access under role ${target.role}.`,
      confirmLabel: nextStatus === 'suspended' ? 'Suspend Access' : 'Reactivate Account',
      destructive: nextStatus === 'suspended',
      payload: { accountStatus: nextStatus }
    });
  };

  const toggleRolePermission = async (roleObj: RolePermissionConfig, perm: PermissionKey) => {
    if (roleObj.role === 'Super Admin') return;
    const has = roleObj.permissions.includes(perm);
    const nextPerms = has
      ? roleObj.permissions.filter((p) => p !== perm)
      : [...roleObj.permissions, perm];
    try {
      await apiRequest(`/api/admin/roles/${encodeURIComponent(roleObj.role)}`, {
        method: 'PUT',
        body: JSON.stringify({ permissions: nextPerms })
      });
      setToast({ type: 'success', text: `Saved permissions for ${roleObj.role}.` });
      await loadUsersAndRoles();
    } catch (err) {
      setToast({
        type: 'error',
        text: err instanceof Error ? err.message : 'Unable to update role permissions.'
      });
    }
  };

  return (
    <div className="space-y-6">
      <ToastBanner toast={toast} onDismiss={() => setToast(null)} />

      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="font-display text-2xl font-bold text-[#052E16] dark:text-lime-50">
            Admin User Management
          </h2>
          <p className="text-xs text-[#052E16]/75 dark:text-lime-200/75">
            Invite team administrators, assign server-enforced roles, suspend accounts, and manage RBAC permissions.
          </p>
        </div>

        <button
          type="button"
          onClick={() => setInviteOpen(true)}
          className="inline-flex items-center justify-center gap-2 rounded-lg bg-[#052E16] px-4 py-2.5 text-xs font-bold text-[#BEF264] hover:bg-[#094724] dark:bg-lime-400 dark:text-[#052E16] cursor-pointer"
        >
          <UserPlus className="h-4 w-4" aria-hidden="true" />
          Invite / Add Administrator
        </button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-xl border border-emerald-950/12 bg-white p-4 shadow-xs dark:border-lime-300/15 dark:bg-[#072716]">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-[#052E16]/65 dark:text-lime-200/70">
            Total Admins
          </p>
          <p className="mt-1 font-mono-tabular text-2xl font-bold">{stats.total}</p>
        </div>
        <div className="rounded-xl border border-emerald-950/12 bg-white p-4 shadow-xs dark:border-lime-300/15 dark:bg-[#072716]">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-emerald-700 dark:text-lime-300">
            Active
          </p>
          <p className="mt-1 font-mono-tabular text-2xl font-bold">{stats.active}</p>
        </div>
        <div className="rounded-xl border border-emerald-950/12 bg-white p-4 shadow-xs dark:border-lime-300/15 dark:bg-[#072716]">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-300">
            Invited
          </p>
          <p className="mt-1 font-mono-tabular text-2xl font-bold">{stats.invited}</p>
        </div>
        <div className="rounded-xl border border-emerald-950/12 bg-white p-4 shadow-xs dark:border-lime-300/15 dark:bg-[#072716]">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-red-700 dark:text-red-300">
            Suspended
          </p>
          <p className="mt-1 font-mono-tabular text-2xl font-bold">{stats.suspended}</p>
        </div>
      </div>

      {/* View Switcher */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setTab('directory')}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-xs font-bold cursor-pointer ${
              tab === 'directory'
                ? 'bg-[#052E16] text-[#BEF264] dark:bg-lime-400 dark:text-[#052E16]'
                : 'border border-emerald-950/15 bg-white text-[#052E16] dark:border-lime-300/20 dark:bg-[#072716] dark:text-lime-100'
            }`}
          >
            <Users className="h-3.5 w-3.5" aria-hidden="true" />
            Administrators ({adminUsers.length})
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
            <Shield className="h-3.5 w-3.5" aria-hidden="true" />
            Role Permissions Matrix
          </button>
        </div>

        <span className="font-mono-tabular text-[11px] font-semibold text-emerald-800 dark:text-lime-300">
          Auth Backend: {backendMode === 'supabase' ? 'Supabase Auth + PostgreSQL RLS' : 'Local Server Session'}
        </span>
      </div>

      {loading ? (
        <div className="rounded-xl border border-emerald-950/12 bg-white py-14 text-center text-xs font-semibold opacity-75 dark:border-lime-300/15 dark:bg-[#072716]">
          Loading administrator accounts and RBAC policies...
        </div>
      ) : tab === 'directory' ? (
        <div className="space-y-4">
          {/* Filters */}
          <div className="flex flex-col gap-3 rounded-xl border border-emerald-950/12 bg-white p-4 shadow-xs dark:border-lime-300/15 dark:bg-[#072716] sm:flex-row sm:items-center">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#052E16]/50 dark:text-lime-200/50" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by administrator name or email..."
                className="w-full rounded-lg border border-emerald-950/15 bg-[#F6FAF1] py-2 pl-9 pr-3 text-xs text-[#052E16] dark:border-lime-300/20 dark:bg-[#03170C] dark:text-lime-100"
              />
            </div>

            <div className="flex flex-wrap gap-2">
              <select
                aria-label="Filter by role"
                value={roleFilter}
                onChange={(e) => setRoleFilter(e.target.value)}
                className="rounded-lg border border-emerald-950/15 bg-[#F6FAF1] px-3 py-2 text-xs font-semibold dark:border-lime-300/20 dark:bg-[#03170C]"
              >
                <option value="ALL">All Roles</option>
                {roles.map((r) => (
                  <option key={r.role} value={r.role}>
                    {r.role}
                  </option>
                ))}
              </select>

              <select
                aria-label="Filter by account status"
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="rounded-lg border border-emerald-950/15 bg-[#F6FAF1] px-3 py-2 text-xs font-semibold dark:border-lime-300/20 dark:bg-[#03170C]"
              >
                <option value="ALL">All Statuses</option>
                <option value="active">Active</option>
                <option value="invited">Invited</option>
                <option value="suspended">Suspended</option>
              </select>
            </div>
          </div>

          {/* Directory Table */}
          <div className="overflow-x-auto rounded-xl border border-emerald-950/12 bg-white shadow-xs dark:border-lime-300/15 dark:bg-[#072716]">
            {filteredUsers.length === 0 ? (
              <div className="py-12 text-center text-xs text-[#052E16]/70 dark:text-lime-200/70">
                No administrators match the current filters.
              </div>
            ) : (
              <table className="w-full text-left text-xs">
                <thead className="bg-[#F6FAF1] text-[11px] font-bold uppercase dark:bg-[#052312]">
                  <tr>
                    <th className="px-4 py-3">Administrator</th>
                    <th className="px-4 py-3">Assigned Role</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Last Sign-In</th>
                    <th className="px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-emerald-950/10 dark:divide-lime-300/10">
                  {filteredUsers.map((admin) => {
                    const isSelf = admin.id === user?.id;
                    return (
                      <tr key={admin.id}>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2.5">
                            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#052E16] font-display text-xs font-bold text-[#BEF264] dark:bg-lime-400 dark:text-[#052E16]">
                              {admin.fullName.charAt(0).toUpperCase()}
                            </span>
                            <div>
                              <div className="flex items-center gap-1.5 font-bold">
                                <span>{admin.fullName}</span>
                                {isSelf && (
                                  <span className="rounded bg-lime-200 px-1.5 py-0.5 text-[10px] font-bold text-[#052E16]">
                                    You
                                  </span>
                                )}
                              </div>
                              <div className="text-[11px] text-[#052E16]/70 dark:text-lime-200/70">
                                {admin.email}
                              </div>
                            </div>
                          </div>
                        </td>

                        <td className="px-4 py-3">
                          <select
                            aria-label={`Role for ${admin.fullName}`}
                            value={admin.role}
                            onChange={(e) =>
                              requestRoleChange(admin, e.target.value as AdminRoleName)
                            }
                            className="rounded-md border border-emerald-950/15 bg-[#F6FAF1] px-2.5 py-1.5 text-[11px] font-semibold dark:border-lime-300/20 dark:bg-[#03170C]"
                          >
                            {roles.map((r) => (
                              <option key={r.role} value={r.role}>
                                {r.role}
                              </option>
                            ))}
                          </select>
                        </td>

                        <td className="px-4 py-3">
                          <StatusBadge value={admin.accountStatus} />
                        </td>

                        <td className="px-4 py-3 font-mono-tabular text-[11px] text-[#052E16]/75 dark:text-lime-200/75">
                          {admin.lastLoginAt
                            ? new Date(admin.lastLoginAt).toLocaleString()
                            : 'Never signed in'}
                        </td>

                        <td className="px-4 py-3 text-right">
                          {isSelf ? (
                            <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700 dark:text-lime-300">
                              <UserCheck className="h-3.5 w-3.5" aria-hidden="true" />
                              Active Session
                            </span>
                          ) : (
                            <button
                              type="button"
                              onClick={() => requestStatusToggle(admin)}
                              className={`rounded-md border px-2.5 py-1 text-[11px] font-semibold cursor-pointer ${
                                admin.accountStatus === 'active'
                                  ? 'border-red-300 text-red-700 hover:bg-red-50 dark:border-red-500/40 dark:text-red-300 dark:hover:bg-red-500/10'
                                  : 'border-emerald-950/20 text-[#052E16] hover:bg-lime-100 dark:border-lime-300/30 dark:text-lime-200 dark:hover:bg-white/10'
                              }`}
                            >
                              {admin.accountStatus === 'active' ? 'Suspend' : 'Reactivate'}
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="rounded-xl border border-emerald-950/12 bg-white p-4 text-xs shadow-xs dark:border-lime-300/15 dark:bg-[#072716]">
            <p className="font-semibold text-[#052E16] dark:text-lime-100">
              Server-Enforced Role Permissions
            </p>
            <p className="mt-1 opacity-75">
              Changes made below update backend route authorization immediately (and PostgreSQL Row Level Security policies when Supabase is active). Super Admin permanently retains all permissions.
            </p>
          </div>

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
        </div>
      )}

      {/* Invite / Create Administrator Modal */}
      {inviteOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="invite-admin-title"
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
        >
          <div className="fixed inset-0 bg-emerald-950/60" onClick={() => setInviteOpen(false)} />
          <form
            onSubmit={handleCreateAdminUser}
            className="relative z-10 w-full max-w-lg rounded-xl border border-emerald-950/15 bg-white p-6 shadow-2xl dark:border-lime-300/20 dark:bg-[#072716]"
          >
            <div className="flex items-center justify-between border-b border-emerald-950/10 pb-3 dark:border-lime-300/15">
              <div className="flex items-center gap-2">
                <ShieldCheck className="h-5 w-5 text-emerald-700 dark:text-lime-300" />
                <h3 id="invite-admin-title" className="font-display text-lg font-bold">
                  Invite / Add Administrator
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setInviteOpen(false)}
                aria-label="Close modal"
                className="rounded p-1 hover:bg-black/5 cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-4 space-y-3.5 text-xs">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="block font-semibold">Full Name *</label>
                  <input
                    required
                    value={inviteName}
                    onChange={(e) => setInviteName(e.target.value)}
                    placeholder="Alex Morgan"
                    className="mt-1 w-full rounded-lg border border-emerald-950/15 bg-[#F6FAF1] px-3 py-2 dark:border-lime-300/20 dark:bg-[#03170C]"
                  />
                </div>
                <div>
                  <label className="block font-semibold">Phone (Optional)</label>
                  <input
                    value={invitePhone}
                    onChange={(e) => setInvitePhone(e.target.value)}
                    placeholder="(800) 555-0194"
                    className="mt-1 w-full rounded-lg border border-emerald-950/15 bg-[#F6FAF1] px-3 py-2 dark:border-lime-300/20 dark:bg-[#03170C]"
                  />
                </div>
              </div>

              <div>
                <label className="block font-semibold">Work Email Address *</label>
                <input
                  required
                  type="email"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  placeholder="operations@smokerslawncareservice.com"
                  className="mt-1 w-full rounded-lg border border-emerald-950/15 bg-[#F6FAF1] px-3 py-2 dark:border-lime-300/20 dark:bg-[#03170C]"
                />
              </div>

              <div>
                <label className="block font-semibold">Administrator Role *</label>
                <select
                  value={inviteRole}
                  onChange={(e) => setInviteRole(e.target.value as AdminRoleName)}
                  className="mt-1 w-full rounded-lg border border-emerald-950/15 bg-[#F6FAF1] px-3 py-2 font-semibold dark:border-lime-300/20 dark:bg-[#03170C]"
                >
                  {roles.map((r) => (
                    <option key={r.role} value={r.role}>
                      {r.role}
                    </option>
                  ))}
                </select>
                <p className="mt-1 text-[11px] text-[#052E16]/70 dark:text-lime-200/70">
                  {ROLE_SUMMARIES[inviteRole]}
                </p>
              </div>

              {backendMode === 'supabase' && (
                <div>
                  <span className="block font-semibold">Onboarding Method</span>
                  <div className="mt-1.5 grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setInviteMode('password')}
                      className={`rounded-lg border px-3 py-2 text-left font-semibold cursor-pointer ${
                        inviteMode === 'password'
                          ? 'border-[#052E16] bg-[#BEF264]/40 text-[#052E16] dark:border-lime-400 dark:text-lime-100'
                          : 'border-emerald-950/15 dark:border-lime-300/20'
                      }`}
                    >
                      Set Initial Password
                    </button>
                    <button
                      type="button"
                      onClick={() => setInviteMode('email')}
                      className={`flex items-center gap-1.5 rounded-lg border px-3 py-2 text-left font-semibold cursor-pointer ${
                        inviteMode === 'email'
                          ? 'border-[#052E16] bg-[#BEF264]/40 text-[#052E16] dark:border-lime-400 dark:text-lime-100'
                          : 'border-emerald-950/15 dark:border-lime-300/20'
                      }`}
                    >
                      <Mail className="h-3.5 w-3.5" />
                      Send Email Invite
                    </button>
                  </div>
                </div>
              )}

              {inviteMode === 'password' && (
                <div>
                  <label className="block font-semibold">Initial Password (min 10 characters) *</label>
                  <input
                    required
                    minLength={10}
                    type="password"
                    value={invitePassword}
                    onChange={(e) => setInvitePassword(e.target.value)}
                    placeholder="At least 10 characters"
                    className="mt-1 w-full rounded-lg border border-emerald-950/15 bg-[#F6FAF1] px-3 py-2 dark:border-lime-300/20 dark:bg-[#03170C]"
                  />
                </div>
              )}
            </div>

            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setInviteOpen(false)}
                className="rounded-lg border border-emerald-950/15 px-4 py-2 text-xs font-semibold cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submittingInvite}
                className="rounded-lg bg-[#052E16] px-4 py-2 text-xs font-bold text-[#BEF264] dark:bg-lime-400 dark:text-[#052E16] cursor-pointer disabled:opacity-60"
              >
                {submittingInvite
                  ? 'Provisioning...'
                  : inviteMode === 'email'
                  ? 'Send Invite & Assign Role'
                  : 'Create Admin Account'}
              </button>
            </div>
          </form>
        </div>
      )}

      <ConfirmDialog
        open={Boolean(pendingAction)}
        title={pendingAction?.title || ''}
        description={pendingAction?.description || ''}
        confirmLabel={pendingAction?.confirmLabel}
        destructive={pendingAction?.destructive}
        loading={processingAction}
        onCancel={() => setPendingAction(null)}
        onConfirm={() => {
          if (pendingAction) {
            void executeUpdateUser(pendingAction.target.id, pendingAction.payload);
          }
        }}
      />
    </div>
  );
};
