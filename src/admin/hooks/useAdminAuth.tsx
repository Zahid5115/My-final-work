import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { getSupabaseBrowserClient, isBrowserSupabaseConfigured } from '../../lib/supabase/client';
import {
  ApiError,
  apiRequest,
  setInMemoryAuthToken,
  setUnauthorizedHandler
} from '../../services/api';
import type { AdminUserProfile, PermissionKey } from '../../types/platform';

interface AuthStatusResponse {
  needsFirstAdminSetup: boolean;
  authMode: 'supabase' | 'local' | 'unconfigured';
  emailConfigured: boolean;
  bootstrapConfigured: boolean;
  requiresBootstrapSecret: boolean;
  requiresBootstrapEmail: boolean;
  supabaseUrlInvalid?: boolean;
  anonKeyConfigured?: boolean;
  supabaseWarning?: string;
  productionConfigError?: string;
}

interface AdminAuthContextValue {
  user: AdminUserProfile | null;
  loading: boolean;
  authStatus: AuthStatusResponse | null;
  refreshAuth: () => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  setupFirstAdmin: (params: {
    fullName: string;
    email: string;
    password: string;
    bootstrapSecret?: string;
  }) => Promise<void>;
  logout: () => Promise<void>;
  hasPermission: (perm: PermissionKey) => boolean;
}

const AdminAuthContext = createContext<AdminAuthContextValue | null>(null);

export const AdminAuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<AdminUserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [authStatus, setAuthStatus] = useState<AuthStatusResponse | null>(null);

  const handleUnauthorized = useCallback(() => {
    setInMemoryAuthToken(null);
    setUser(null);
  }, []);

  const refreshAuth = useCallback(async () => {
    setLoading(true);
    try {
      const status = await apiRequest<AuthStatusResponse>('/api/admin/auth/status', {
        skipUnauthorizedCallback: true
      });
      setAuthStatus(status);

      // If browser Supabase is active, sync Supabase session token into memory
      if (isBrowserSupabaseConfigured) {
        const sb = getSupabaseBrowserClient();
        const sessionRes = sb ? await sb.auth.getSession() : null;
        const accessToken = sessionRes?.data.session?.access_token ?? null;
        if (accessToken) {
          setInMemoryAuthToken(accessToken);
        }
      }

      try {
        const me = await apiRequest<{ user: AdminUserProfile }>('/api/admin/auth/me', {
          skipUnauthorizedCallback: true
        });
        setUser(me.user);
      } catch (err) {
        if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
          setUser(null);
          setInMemoryAuthToken(null);
        }
      }
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(handleUnauthorized);
    void refreshAuth();

    let unsubscribe: (() => void) | undefined;
    if (isBrowserSupabaseConfigured) {
      const sb = getSupabaseBrowserClient();
      if (sb) {
        const { data } = sb.auth.onAuthStateChange((event, session) => {
          if (event === 'SIGNED_OUT') {
            setInMemoryAuthToken(null);
            setUser(null);
          } else if (session?.access_token) {
            setInMemoryAuthToken(session.access_token);
          }
        });
        unsubscribe = () => data.subscription.unsubscribe();
      }
    }

    return () => {
      setUnauthorizedHandler(null);
      unsubscribe?.();
    };
  }, [handleUnauthorized, refreshAuth]);

  const login = useCallback(
    async (email: string, password: string) => {
      const normalizedEmail = email.trim().toLowerCase();

      if (isBrowserSupabaseConfigured && authStatus?.authMode === 'supabase') {
        const sb = getSupabaseBrowserClient();
        if (!sb) throw new Error('Supabase client is not initialized.');
        const { data, error } = await sb.auth.signInWithPassword({
          email: normalizedEmail,
          password
        });
        if (error || !data.session?.access_token) {
          throw new Error(error?.message || 'Invalid email or password.');
        }

        setInMemoryAuthToken(data.session.access_token);
        try {
          const sessionRes = await apiRequest<{ user: AdminUserProfile }>('/api/admin/auth/session', {
            method: 'POST',
            skipUnauthorizedCallback: true
          });
          setUser(sessionRes.user);
          return;
        } catch (err) {
          await sb.auth.signOut();
          setInMemoryAuthToken(null);
          setUser(null);
          throw err;
        }
      }

      const res = await apiRequest<{ token: string; user: AdminUserProfile }>('/api/admin/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email: normalizedEmail, password }),
        skipUnauthorizedCallback: true
      });
      setInMemoryAuthToken(res.token);
      setUser(res.user);
    },
    [authStatus?.authMode]
  );

  const setupFirstAdmin = useCallback(
    async (params: {
      fullName: string;
      email: string;
      password: string;
      bootstrapSecret?: string;
    }) => {
      const res = await apiRequest<{
        token?: string;
        user?: AdminUserProfile;
        setupComplete?: boolean;
        authMode?: 'supabase' | 'local';
      }>('/api/admin/auth/setup-first-admin', {
        method: 'POST',
        body: JSON.stringify({
          ...params,
          email: params.email.trim().toLowerCase(),
          bootstrapSecret: params.bootstrapSecret?.trim()
        }),
        skipUnauthorizedCallback: true
      });

      if (res.authMode === 'supabase') {
        await login(params.email, params.password);
      } else if (res.token && res.user) {
        setInMemoryAuthToken(res.token);
        setUser(res.user);
      }
      await refreshAuth();
    },
    [login, refreshAuth]
  );

  const logout = useCallback(async () => {
    try {
      await apiRequest('/api/admin/auth/logout', {
        method: 'POST',
        skipUnauthorizedCallback: true
      });
    } catch {
      // Ignore logout network error
    }
    if (isBrowserSupabaseConfigured) {
      const sb = getSupabaseBrowserClient();
      await sb?.auth.signOut();
    }
    setInMemoryAuthToken(null);
    setUser(null);
  }, []);

  const hasPermission = useCallback(
    (perm: PermissionKey) => {
      if (!user) return false;
      if (user.role === 'Super Admin') return true;
      return user.permissions.includes(perm);
    },
    [user]
  );

  return (
    <AdminAuthContext.Provider
      value={{
        user,
        loading,
        authStatus,
        refreshAuth,
        login,
        setupFirstAdmin,
        logout,
        hasPermission
      }}
    >
      {children}
    </AdminAuthContext.Provider>
  );
};

export function useAdminAuth(): AdminAuthContextValue {
  const ctx = useContext(AdminAuthContext);
  if (!ctx) {
    throw new Error('useAdminAuth must be used inside AdminAuthProvider');
  }
  return ctx;
}
