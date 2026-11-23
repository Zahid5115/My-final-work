import React, { useCallback, useEffect, useState } from 'react';
import { KeyRound, ShieldCheck, UserCircle2 } from 'lucide-react';
import { apiRequest } from '../../services/api';
import { ToastBanner, type ToastMessage } from '../components/ToastBanner';
import { useAdminAuth } from '../hooks/useAdminAuth';
import type { ActivityLogEntity } from '../../types/platform';

export const ProfileAdminPage: React.FC = () => {
  const { user, refreshAuth, hasPermission } = useAdminAuth();
  const [fullName, setFullName] = useState(user?.fullName || '');
  const [phone, setPhone] = useState(user?.phone || '');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [logs, setLogs] = useState<ActivityLogEntity[]>([]);
  const [toast, setToast] = useState<ToastMessage | null>(null);

  const loadLogs = useCallback(async () => {
    if (!hasPermission('audit.view')) return;
    try {
      const res = await apiRequest<{ items: ActivityLogEntity[] }>('/api/admin/activity-logs');
      setLogs(res.items);
    } catch {
      // Non-blocking audit fetch
    }
  }, [hasPermission]);

  useEffect(() => {
    setFullName(user?.fullName || '');
    setPhone(user?.phone || '');
    void loadLogs();
  }, [user, loadLogs]);

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiRequest('/api/admin/profile', {
        method: 'PATCH',
        body: JSON.stringify({ fullName, phone })
      });
      await refreshAuth();
      setToast({ type: 'success', text: 'Profile updated.' });
    } catch (err) {
      setToast({ type: 'error', text: err instanceof Error ? err.message : 'Profile update failed.' });
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiRequest('/api/admin/auth/change-password', {
        method: 'POST',
        body: JSON.stringify({ currentPassword, newPassword })
      });
      setCurrentPassword('');
      setNewPassword('');
      setToast({ type: 'success', text: 'Password updated successfully.' });
    } catch (err) {
      setToast({ type: 'error', text: err instanceof Error ? err.message : 'Password change failed.' });
    }
  };

  return (
    <div className="space-y-6">
      <ToastBanner toast={toast} onDismiss={() => setToast(null)} />

      <div>
        <h2 className="font-display text-2xl font-bold">My Profile, Security &amp; Audit Logs</h2>
        <p className="text-xs text-[#052E16]/70 dark:text-lime-200/75">
          Manage your administrator contact profile, update credentials, and review recent audit activity.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <form
          onSubmit={handleSaveProfile}
          className="rounded-xl border border-emerald-950/12 bg-white p-6 shadow-xs dark:border-lime-300/15 dark:bg-[#072716] space-y-4 text-xs"
        >
          <div className="flex items-center gap-2 font-display text-base font-bold">
            <UserCircle2 className="h-5 w-5 text-emerald-700 dark:text-lime-300" />
            Administrator Details
          </div>
          <div>
            <label className="block font-semibold">Email (Read-only)</label>
            <input
              disabled
              value={user?.email || ''}
              className="mt-1 w-full rounded-lg border border-emerald-950/10 bg-slate-100 px-3 py-2 opacity-80 dark:border-lime-300/15 dark:bg-[#03170C]"
            />
          </div>
          <div>
            <label className="block font-semibold">Assigned Role</label>
            <input
              disabled
              value={user?.role || ''}
              className="mt-1 w-full rounded-lg border border-emerald-950/10 bg-slate-100 px-3 py-2 font-bold opacity-80 dark:border-lime-300/15 dark:bg-[#03170C]"
            />
          </div>
          <div>
            <label className="block font-semibold">Full Name</label>
            <input
              required
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              className="mt-1 w-full rounded-lg border border-emerald-950/15 bg-[#F6FAF1] px-3 py-2 dark:border-lime-300/20 dark:bg-[#03170C]"
            />
          </div>
          <div>
            <label className="block font-semibold">Phone</label>
            <input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className="mt-1 w-full rounded-lg border border-emerald-950/15 bg-[#F6FAF1] px-3 py-2 dark:border-lime-300/20 dark:bg-[#03170C]"
            />
          </div>
          <button
            type="submit"
            className="rounded-lg bg-[#052E16] px-4 py-2 font-bold text-[#BEF264] dark:bg-lime-400 dark:text-[#052E16] cursor-pointer"
          >
            Save Profile
          </button>
        </form>

        <form
          onSubmit={handleChangePassword}
          className="rounded-xl border border-emerald-950/12 bg-white p-6 shadow-xs dark:border-lime-300/15 dark:bg-[#072716] space-y-4 text-xs"
        >
          <div className="flex items-center gap-2 font-display text-base font-bold">
            <KeyRound className="h-5 w-5 text-emerald-700 dark:text-lime-300" />
            Change Password
          </div>
          <div>
            <label className="block font-semibold">Current Password</label>
            <input
              required
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              className="mt-1 w-full rounded-lg border border-emerald-950/15 bg-[#F6FAF1] px-3 py-2 dark:border-lime-300/20 dark:bg-[#03170C]"
            />
          </div>
          <div>
            <label className="block font-semibold">New Password (minimum 10 characters)</label>
            <input
              required
              minLength={10}
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className="mt-1 w-full rounded-lg border border-emerald-950/15 bg-[#F6FAF1] px-3 py-2 dark:border-lime-300/20 dark:bg-[#03170C]"
            />
          </div>
          <button
            type="submit"
            className="rounded-lg bg-[#052E16] px-4 py-2 font-bold text-[#BEF264] dark:bg-lime-400 dark:text-[#052E16] cursor-pointer"
          >
            Update Password
          </button>
        </form>
      </div>

      {hasPermission('audit.view') && (
        <div className="overflow-hidden rounded-xl border border-emerald-950/12 bg-white shadow-xs dark:border-lime-300/15 dark:bg-[#072716]">
          <div className="flex items-center gap-2 border-b border-emerald-950/10 px-5 py-3 dark:border-lime-300/15">
            <ShieldCheck className="h-4 w-4 text-emerald-700 dark:text-lime-300" />
            <h3 className="font-display text-base font-bold">Immutable Admin Activity Audit Log</h3>
          </div>
          <div className="max-h-96 overflow-y-auto divide-y divide-emerald-950/10 dark:divide-lime-300/10 text-xs">
            {logs.length === 0 ? (
              <p className="py-8 text-center text-[#052E16]/60 dark:text-lime-200/60">No audit entries logged yet.</p>
            ) : (
              logs.map((l) => (
                <div key={l.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-2.5">
                  <div>
                    <span className="font-semibold">{l.summary}</span>
                    <div className="text-[11px] text-[#052E16]/65 dark:text-lime-200/65">
                      {l.actorEmail} ({l.actorRole}) · <span className="font-mono">{l.action}</span>
                    </div>
                  </div>
                  <span className="font-mono-tabular text-[11px] text-[#052E16]/60 dark:text-lime-200/60">
                    {new Date(l.createdAt).toLocaleString()}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
};
