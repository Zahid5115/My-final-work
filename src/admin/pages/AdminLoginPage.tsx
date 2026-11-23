import React, { useEffect, useState } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import {
  ArrowLeft,
  CheckCircle2,
  KeyRound,
  Lock,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  UserPlus
} from 'lucide-react';
import { useAdminAuth } from '../hooks/useAdminAuth';
import {
  getSupabaseBrowserClient,
  isBrowserSupabaseConfigured,
  isBrowserSupabaseUrlInvalid
} from '../../lib/supabase/client';
import { apiRequest } from '../../services/api';

export const AdminLoginPage: React.FC<{ mode?: 'login' | 'setup' | 'forgot' | 'reset' }> = ({
  mode = 'login'
}) => {
  const { user, loading, authStatus, authStatusError, refreshAuth, login, setupFirstAdmin } =
    useAdminAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [bootstrapSecret, setBootstrapSecret] = useState('');
  const [resetToken, setResetToken] = useState(searchParams.get('token') || '');
  const [supabaseRecoveryReady, setSupabaseRecoveryReady] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [rechecking, setRechecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [infoMessage, setInfoMessage] = useState<string | null>(null);

  useEffect(() => {
    if (mode !== 'reset' || !isBrowserSupabaseConfigured) return;
    const sb = getSupabaseBrowserClient();
    if (!sb) return;

    void sb.auth.getSession().then(({ data }) => {
      if (data.session) {
        setSupabaseRecoveryReady(true);
      }
    });

    const { data: listener } = sb.auth.onAuthStateChange((event, session) => {
      if ((event === 'PASSWORD_RECOVERY' || event === 'SIGNED_IN') && session) {
        setSupabaseRecoveryReady(true);
      }
    });
    return () => listener.subscription.unsubscribe();
  }, [mode]);

  if (!loading && user && (mode === 'login' || mode === 'setup')) {
    return <Navigate to="/admin/dashboard" replace />;
  }

  const isSetupLocked = mode === 'setup' && Boolean(authStatus && !authStatus.needsFirstAdminSetup);
  const isFirstRunSetup =
    (mode === 'setup' || mode === 'login') && Boolean(authStatus?.needsFirstAdminSetup);

  const handleRecheckStatus = async () => {
    setRechecking(true);
    setError(null);
    await refreshAuth();
    setRechecking(false);
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await login(email, password);
      navigate('/admin/dashboard', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to sign in.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleFirstSetup = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password.length < 10) {
      setError('Password must be at least 10 characters.');
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }
    if (!bootstrapSecret.trim()) {
      setError('Server Bootstrap Secret is required.');
      return;
    }
    setSubmitting(true);
    try {
      await setupFirstAdmin({
        fullName,
        email,
        password,
        bootstrapSecret
      });
      navigate('/admin/dashboard', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to initialize Super Admin.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setInfoMessage(null);
    setSubmitting(true);
    try {
      const res = await apiRequest<{ message: string; emailSent: boolean }>(
        '/api/admin/auth/forgot-password',
        {
          method: 'POST',
          body: JSON.stringify({ email }),
          skipUnauthorizedCallback: true
        }
      );
      setInfoMessage(res.message);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to process request.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setInfoMessage(null);
    if (password.length < 10) {
      setError('New password must be at least 10 characters.');
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }
    setSubmitting(true);
    try {
      if (authStatus?.authMode === 'supabase') {
        const sb = getSupabaseBrowserClient();
        if (!sb) {
          throw new Error(
            'Supabase client credentials (VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY) are required to complete email password recovery.'
          );
        }
        const { error: updErr } = await sb.auth.updateUser({ password });
        if (updErr) {
          throw new Error(updErr.message || 'Recovery session expired. Request a new password reset link.');
        }
        await refreshAuth();
        setInfoMessage('Password updated in Supabase. You can now sign in to the Admin Portal.');
        return;
      }

      const res = await apiRequest<{ message: string }>('/api/admin/auth/reset-password', {
        method: 'POST',
        body: JSON.stringify({ token: resetToken, newPassword: password }),
        skipUnauthorizedCallback: true
      });
      setInfoMessage(res.message);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to reset password.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-screen flex-col justify-center bg-[#052E16] px-4 py-12 text-lime-50 dark:bg-[#021209]">
      <div className="mx-auto w-full max-w-lg">
        <div className="mb-6 flex items-center justify-between">
          <Link
            to="/"
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-lime-300 hover:underline"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Back to Public Site
          </Link>
          <span className="font-mono-tabular text-[11px] font-semibold text-lime-200/75">
            {authStatus?.authMode === 'supabase'
              ? 'Supabase Auth + RLS'
              : authStatus?.authMode === 'unconfigured'
              ? 'Supabase Required (Production)'
              : authStatus?.authMode === 'local'
              ? 'Local Dev Mode'
              : authStatusError
              ? 'API Unreachable'
              : 'Checking Backend...'}
          </span>
        </div>

        <div className="rounded-2xl border border-lime-300/20 bg-white p-6 text-[#052E16] shadow-2xl dark:bg-[#072716] dark:text-lime-50 sm:p-8">
          <div className="flex items-center gap-3 border-b border-emerald-950/10 pb-4 dark:border-lime-300/15">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#BEF264] text-[#052E16]">
              {isSetupLocked ? (
                <ShieldCheck className="h-5 w-5" />
              ) : isFirstRunSetup ? (
                <UserPlus className="h-5 w-5" />
              ) : mode === 'forgot' || mode === 'reset' ? (
                <KeyRound className="h-5 w-5" />
              ) : (
                <Lock className="h-5 w-5" />
              )}
            </span>
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-emerald-800 dark:text-lime-300">
                Smoker&apos;s Lawn Care Service LLC
              </p>
              <h1 className="font-display text-xl font-bold">
                {isSetupLocked
                  ? 'Initial Setup Permanently Locked'
                  : isFirstRunSetup
                  ? 'First-Time Super Admin Setup'
                  : mode === 'forgot'
                  ? 'Forgot Admin Password'
                  : mode === 'reset'
                  ? 'Reset Admin Password'
                  : 'Admin Operations Login'}
              </h1>
            </div>
          </div>

          {(authStatus?.supabaseUrlInvalid || isBrowserSupabaseUrlInvalid) && (
            <div className="mt-4 rounded-xl border border-amber-300 bg-amber-50 p-3.5 text-xs text-amber-950 dark:border-amber-400/30 dark:bg-amber-950/30 dark:text-amber-100">
              <p className="font-bold">Supabase URL Secret Format Notice</p>
              <p className="mt-1 leading-relaxed opacity-90">
                Your <code className="font-mono">SUPABASE_URL</code> or{' '}
                <code className="font-mono">VITE_SUPABASE_URL</code> secret is not a valid{' '}
                <code className="font-mono">https://...</code> URL (example:{' '}
                <code className="font-mono">https://your-project-ref.supabase.co</code>). The portal is running safely in Local Server Mode until updated.
              </p>
            </div>
          )}

          {authStatus?.productionConfigError && (
            <div className="mt-4 rounded-xl border border-red-300 bg-red-50 p-3.5 text-xs text-red-950 dark:border-red-400/30 dark:bg-red-950/30 dark:text-red-100">
              <p className="font-bold">Production Database Configuration Required</p>
              <p className="mt-1 leading-relaxed opacity-90">{authStatus.productionConfigError}</p>
            </div>
          )}

          {authStatusError && (
            <div className="mt-4 rounded-xl border border-red-300 bg-red-50 p-3.5 text-xs text-red-950 dark:border-red-400/30 dark:bg-red-950/30 dark:text-red-100">
              <p className="font-bold">Backend API Connection Issue</p>
              <p className="mt-1 leading-relaxed opacity-90">
                Could not reach <code className="font-mono">/api/admin/auth/status</code> ({authStatusError}). If deployed on Vercel, ensure <code className="font-mono">api/index.js</code> and <code className="font-mono">SUPABASE_URL</code> / <code className="font-mono">SUPABASE_SERVICE_ROLE_KEY</code> environment variables are deployed.
              </p>
            </div>
          )}

          {authStatus?.supabaseWarning && (
            <div className="mt-4 rounded-xl border border-amber-300 bg-amber-50 p-3.5 text-xs text-amber-950 dark:border-amber-400/30 dark:bg-amber-950/30 dark:text-amber-100">
              <p className="font-bold">Supabase Notice</p>
              <p className="mt-1 leading-relaxed opacity-90">{authStatus.supabaseWarning}</p>
            </div>
          )}

          {loading ? (
            <div className="py-12 text-center text-xs font-semibold opacity-75">
              Checking authentication and setup status...
            </div>
          ) : isSetupLocked ? (
            <div className="mt-5 space-y-4">
              <div className="rounded-xl border border-emerald-950/15 bg-[#F6FAF1] p-4 text-xs leading-relaxed dark:border-lime-300/20 dark:bg-[#041A0E]">
                <p className="flex items-center gap-2 font-bold text-[#052E16] dark:text-lime-200">
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-700 dark:text-lime-300" />
                  Super Admin Already Established
                </p>
                <p className="mt-1.5 opacity-80">
                  This one-time setup route is permanently disabled. To add more administrators, sign in as a Super Admin and open <strong>Admin Users</strong>.
                </p>
              </div>
              <Link
                to="/admin/login"
                className="flex w-full items-center justify-center gap-2 rounded-lg bg-[#052E16] px-5 py-3 text-sm font-semibold text-[#BEF264] hover:bg-[#094724] dark:bg-lime-400 dark:text-[#052E16]"
              >
                <Lock className="h-4 w-4" />
                Go to Admin Login
              </Link>
            </div>
          ) : isFirstRunSetup && !authStatus?.bootstrapConfigured ? (
            <div className="mt-5 space-y-4 text-xs">
              <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-amber-950 dark:border-amber-400/30 dark:bg-amber-950/30 dark:text-amber-100">
                <p className="flex items-center gap-2 font-bold">
                  <ShieldAlert className="h-4 w-4 shrink-0" />
                  Setup Protected: Owner Secret Required
                </p>
                <p className="mt-1 leading-relaxed opacity-90">
                  Random website visitors cannot claim administrator access. Before creating your first <strong>Super Admin</strong> account, set a one-time setup secret on the server.
                </p>
              </div>

              <div className="space-y-3 rounded-xl border border-emerald-950/12 bg-[#F6FAF1] p-4 dark:border-lime-300/15 dark:bg-[#041A0E]">
                <p className="font-bold text-[#052E16] dark:text-lime-200">
                  How to Unlock First Super Admin Setup
                </p>
                <ol className="list-decimal space-y-2 pl-4 leading-relaxed opacity-90">
                  <li>
                    Open <strong>Settings &rarr; Secrets</strong> in Google AI Studio (or your server <code className="font-mono">.env</code> file).
                  </li>
                  <li>
                    Add <code className="rounded bg-black/5 px-1.5 py-0.5 font-mono font-semibold dark:bg-white/10">ADMIN_BOOTSTRAP_SECRET</code> with a private setup passphrase you choose.
                  </li>
                  <li>
                    <em>(Recommended)</em> Add <code className="rounded bg-black/5 px-1.5 py-0.5 font-mono font-semibold dark:bg-white/10">ADMIN_BOOTSTRAP_EMAIL</code> set to your personal/work email so only your email is accepted.
                  </li>
                  <li>
                    <em>(For Supabase Cloud DB &amp; Auth)</em> Also set <code className="font-mono">SUPABASE_URL</code>, <code className="font-mono">SUPABASE_SERVICE_ROLE_KEY</code>, <code className="font-mono">VITE_SUPABASE_URL</code>, and <code className="font-mono">VITE_SUPABASE_ANON_KEY</code>, then run all 4 SQL migrations in <code className="font-mono">supabase/migrations/</code>.
                  </li>
                  <li>
                    Save secrets and click <strong>Re-check Setup Status</strong> below (or run <code className="font-mono">npm run bootstrap:admin</code> in the server terminal).
                  </li>
                </ol>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-emerald-950/10 px-3 py-2 text-[11px] dark:border-lime-300/15">
                <span className="font-semibold">Backend Status:</span>
                <span className="font-mono-tabular">
                  {authStatus?.authMode === 'supabase'
                    ? 'Supabase Auth + Database Connected'
                    : 'Local Server Store (Supabase keys not set)'}
                </span>
              </div>

              <button
                type="button"
                onClick={() => void handleRecheckStatus()}
                disabled={rechecking}
                className="flex w-full items-center justify-center gap-2 rounded-lg bg-[#052E16] px-5 py-3 text-sm font-semibold text-[#BEF264] hover:bg-[#094724] dark:bg-lime-400 dark:text-[#052E16] cursor-pointer disabled:opacity-60"
              >
                <RefreshCw className={`h-4 w-4 ${rechecking ? 'animate-spin' : ''}`} />
                {rechecking ? 'Checking Server Config...' : 'Re-check Setup Status'}
              </button>
            </div>
          ) : isFirstRunSetup ? (
            <form onSubmit={handleFirstSetup} className="mt-5 space-y-4">
              <div className="rounded-lg border border-emerald-950/15 bg-[#F6FAF1] p-3 text-xs leading-relaxed dark:border-lime-300/20 dark:bg-[#041A0E]">
                <p className="font-semibold text-[#052E16] dark:text-lime-200">
                  Protected First-Admin Registration
                </p>
                <p className="mt-1 opacity-80">
                  No administrator exists yet. Verify your <strong>Server Bootstrap Secret</strong> below to establish the initial <strong>Super Admin</strong> account. Once created, this setup workflow locks permanently.
                </p>
                {authStatus?.requiresBootstrapEmail && (
                  <p className="mt-1.5 font-semibold text-emerald-800 dark:text-lime-300">
                    Owner Email Lock Active: email must match ADMIN_BOOTSTRAP_EMAIL.
                  </p>
                )}
              </div>

              <div>
                <label htmlFor="setup-name" className="block text-xs font-semibold">
                  Full Name *
                </label>
                <input
                  id="setup-name"
                  type="text"
                  required
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="Operations Director"
                  className="mt-1 w-full rounded-lg border border-emerald-950/20 bg-white px-3 py-2 text-sm text-[#052E16] dark:border-lime-300/25 dark:bg-[#041A0E] dark:text-lime-100"
                />
              </div>

              <div>
                <label htmlFor="setup-email" className="block text-xs font-semibold">
                  Owner Email Address *
                </label>
                <input
                  id="setup-email"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@smokerslawncareservice.com"
                  className="mt-1 w-full rounded-lg border border-emerald-950/20 bg-white px-3 py-2 text-sm text-[#052E16] dark:border-lime-300/25 dark:bg-[#041A0E] dark:text-lime-100"
                />
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label htmlFor="setup-password" className="block text-xs font-semibold">
                    Password (10+ chars) *
                  </label>
                  <input
                    id="setup-password"
                    type="password"
                    required
                    minLength={10}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-emerald-950/20 bg-white px-3 py-2 text-sm text-[#052E16] dark:border-lime-300/25 dark:bg-[#041A0E] dark:text-lime-100"
                  />
                </div>

                <div>
                  <label htmlFor="setup-confirm" className="block text-xs font-semibold">
                    Confirm Password *
                  </label>
                  <input
                    id="setup-confirm"
                    type="password"
                    required
                    minLength={10}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-emerald-950/20 bg-white px-3 py-2 text-sm text-[#052E16] dark:border-lime-300/25 dark:bg-[#041A0E] dark:text-lime-100"
                  />
                </div>
              </div>

              <div>
                <label htmlFor="setup-secret" className="block text-xs font-semibold">
                  Server Bootstrap Secret (ADMIN_BOOTSTRAP_SECRET) *
                </label>
                <input
                  id="setup-secret"
                  type="password"
                  required
                  value={bootstrapSecret}
                  onChange={(e) => setBootstrapSecret(e.target.value)}
                  placeholder="Enter the secret configured in server Secrets"
                  className="mt-1 w-full rounded-lg border border-emerald-950/20 bg-white px-3 py-2 text-sm text-[#052E16] dark:border-lime-300/25 dark:bg-[#041A0E] dark:text-lime-100"
                />
              </div>

              {error && (
                <p role="alert" className="text-xs font-semibold text-red-700 dark:text-orange-300">
                  {error}
                </p>
              )}

              <button
                type="submit"
                disabled={submitting}
                className="flex w-full items-center justify-center gap-2 rounded-lg bg-[#052E16] px-5 py-3 text-sm font-semibold text-[#BEF264] hover:bg-[#094724] dark:bg-lime-400 dark:text-[#052E16] cursor-pointer disabled:opacity-60"
              >
                <ShieldCheck className="h-4 w-4" />
                {submitting ? 'Verifying & Creating Super Admin...' : 'Create First Super Admin'}
              </button>
            </form>
          ) : mode === 'forgot' ? (
            <form onSubmit={handleForgotPassword} className="mt-5 space-y-4">
              <p className="text-xs leading-relaxed opacity-80">
                Enter your administrator email address. If an account matches and a server email
                provider is configured, a time-limited reset link will be dispatched.
              </p>
              <div>
                <label htmlFor="forgot-email" className="block text-xs font-semibold">
                  Administrator Email *
                </label>
                <input
                  id="forgot-email"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-emerald-950/20 bg-white px-3 py-2 text-sm text-[#052E16] dark:border-lime-300/25 dark:bg-[#041A0E] dark:text-lime-100"
                />
              </div>

              {error && (
                <p role="alert" className="text-xs font-semibold text-red-700 dark:text-orange-300">
                  {error}
                </p>
              )}
              {infoMessage && (
                <p role="status" className="rounded-lg bg-lime-100 p-3 text-xs font-semibold text-[#052E16]">
                  {infoMessage}
                </p>
              )}

              <button
                type="submit"
                disabled={submitting}
                className="w-full rounded-lg bg-[#052E16] px-5 py-3 text-sm font-semibold text-[#BEF264] dark:bg-lime-400 dark:text-[#052E16] cursor-pointer"
              >
                {submitting ? 'Submitting...' : 'Request Password Reset'}
              </button>

              <div className="flex justify-between text-xs font-semibold">
                <Link to="/admin/login" className="underline">
                  Return to Login
                </Link>
                <Link to="/admin/reset-password" className="underline">
                  Have a reset token?
                </Link>
              </div>
            </form>
          ) : mode === 'reset' ? (
            <form onSubmit={handleResetPassword} className="mt-5 space-y-4">
              {authStatus?.authMode === 'supabase' ? (
                <div className="rounded-lg border border-emerald-950/15 bg-[#F6FAF1] p-3 text-xs leading-relaxed dark:border-lime-300/20 dark:bg-[#041A0E]">
                  {supabaseRecoveryReady ? (
                    <p className="font-semibold text-emerald-800 dark:text-lime-300">
                      Supabase recovery session verified. Choose your new administrator password below.
                    </p>
                  ) : (
                    <p className="opacity-85">
                      Open the recovery link sent to your email address to activate your Supabase reset session, or{' '}
                      <Link to="/admin/forgot-password" className="font-semibold underline">
                        request a new reset link
                      </Link>
                      .
                    </p>
                  )}
                </div>
              ) : (
                <div>
                  <label htmlFor="reset-token" className="block text-xs font-semibold">
                    Reset Token *
                  </label>
                  <input
                    id="reset-token"
                    type="text"
                    required
                    value={resetToken}
                    onChange={(e) => setResetToken(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-emerald-950/20 bg-white px-3 py-2 font-mono-tabular text-sm text-[#052E16] dark:border-lime-300/25 dark:bg-[#041A0E] dark:text-lime-100"
                  />
                </div>
              )}
              <div>
                <label htmlFor="reset-pass" className="block text-xs font-semibold">
                  New Password (min 10 chars) *
                </label>
                <input
                  id="reset-pass"
                  type="password"
                  required
                  minLength={10}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-emerald-950/20 bg-white px-3 py-2 text-sm text-[#052E16] dark:border-lime-300/25 dark:bg-[#041A0E] dark:text-lime-100"
                />
              </div>
              <div>
                <label htmlFor="reset-confirm" className="block text-xs font-semibold">
                  Confirm New Password *
                </label>
                <input
                  id="reset-confirm"
                  type="password"
                  required
                  minLength={10}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-emerald-950/20 bg-white px-3 py-2 text-sm text-[#052E16] dark:border-lime-300/25 dark:bg-[#041A0E] dark:text-lime-100"
                />
              </div>

              {error && (
                <p role="alert" className="text-xs font-semibold text-red-700 dark:text-orange-300">
                  {error}
                </p>
              )}
              {infoMessage && (
                <p role="status" className="rounded-lg bg-lime-100 p-3 text-xs font-semibold text-[#052E16]">
                  {infoMessage}
                </p>
              )}

              <button
                type="submit"
                disabled={submitting}
                className="w-full rounded-lg bg-[#052E16] px-5 py-3 text-sm font-semibold text-[#BEF264] dark:bg-lime-400 dark:text-[#052E16] cursor-pointer"
              >
                {submitting ? 'Updating...' : 'Update Password'}
              </button>

              <Link to="/admin/login" className="block text-center text-xs font-semibold underline">
                Return to Login
              </Link>
            </form>
          ) : (
            <form onSubmit={handleLogin} className="mt-5 space-y-4">
              <div>
                <label htmlFor="login-email" className="block text-xs font-semibold">
                  Administrator Email *
                </label>
                <input
                  id="login-email"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@smokerslawncareservice.com"
                  className="mt-1 w-full rounded-lg border border-emerald-950/20 bg-white px-3 py-2 text-sm text-[#052E16] dark:border-lime-300/25 dark:bg-[#041A0E] dark:text-lime-100"
                />
              </div>

              <div>
                <div className="flex items-center justify-between">
                  <label htmlFor="login-password" className="block text-xs font-semibold">
                    Password *
                  </label>
                  <Link
                    to="/admin/forgot-password"
                    className="text-[11px] font-semibold text-emerald-800 hover:underline dark:text-lime-300"
                  >
                    Forgot password?
                  </Link>
                </div>
                <input
                  id="login-password"
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-emerald-950/20 bg-white px-3 py-2 text-sm text-[#052E16] dark:border-lime-300/25 dark:bg-[#041A0E] dark:text-lime-100"
                />
              </div>

              {error && (
                <p role="alert" className="text-xs font-semibold text-red-700 dark:text-orange-300">
                  {error}
                </p>
              )}

              <button
                type="submit"
                disabled={submitting}
                className="w-full rounded-lg bg-[#052E16] px-5 py-3 text-sm font-semibold text-[#BEF264] hover:bg-[#094724] dark:bg-lime-400 dark:text-[#052E16] cursor-pointer disabled:opacity-60"
              >
                {submitting ? 'Signing In...' : 'Sign In to Admin Portal'}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};
