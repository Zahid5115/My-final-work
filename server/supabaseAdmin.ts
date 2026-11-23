import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { cleanEnvValue } from './security.ts';

let cachedSupabaseAdmin: SupabaseClient | null = null;
let cachedSupabaseKey = '';

export function normalizeSupabaseUrl(raw: string | undefined): string | null {
  let cleaned = cleanEnvValue(raw);
  if (!cleaned) return null;

  // Support bare Supabase project hostname if user omitted https://
  if (/^[a-z0-9-]+\.supabase\.(co|in|net)$/i.test(cleaned)) {
    cleaned = `https://${cleaned}`;
  }

  try {
    const parsed = new URL(cleaned);
    if ((parsed.protocol === 'https:' || parsed.protocol === 'http:') && parsed.hostname) {
      return cleaned;
    }
  } catch {
    return null;
  }
  return null;
}

function getRawServerSupabaseUrl(): string | undefined {
  return process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
}

export function getSupabaseConfigDiagnostics(): {
  urlConfigured: boolean;
  urlValid: boolean;
  serviceKeyConfigured: boolean;
  anonKeyConfigured: boolean;
} {
  const rawUrl = getRawServerSupabaseUrl();
  const normalized = normalizeSupabaseUrl(rawUrl);
  const serviceKey = cleanEnvValue(process.env.SUPABASE_SERVICE_ROLE_KEY);
  const anonKey = cleanEnvValue(process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY);

  return {
    urlConfigured: Boolean(cleanEnvValue(rawUrl)),
    urlValid: Boolean(normalized),
    serviceKeyConfigured: Boolean(serviceKey),
    anonKeyConfigured: Boolean(anonKey)
  };
}

export function isProductionEnvironment(): boolean {
  return (
    process.env.NODE_ENV === 'production' ||
    process.env.VERCEL === '1' ||
    Boolean(process.env.VERCEL_ENV)
  );
}

export function isServerSupabaseConfigured(): boolean {
  const url = normalizeSupabaseUrl(getRawServerSupabaseUrl());
  const serviceKey = cleanEnvValue(process.env.SUPABASE_SERVICE_ROLE_KEY);
  return Boolean(url && serviceKey);
}

export function assertProductionPersistence(): boolean {
  if (isProductionEnvironment() && !isServerSupabaseConfigured()) {
    console.warn(
      '[Smokers Lawn Care] Production persistence warning: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are not configured yet. Local JSON persistence (data/platform-db.json) is disabled in production; API endpoints will fail closed (503) until Supabase credentials are provided.'
    );
    return false;
  }
  return true;
}

export function getSupabaseAdminClient(): SupabaseClient | null {
  const url = normalizeSupabaseUrl(getRawServerSupabaseUrl());
  const serviceKey = cleanEnvValue(process.env.SUPABASE_SERVICE_ROLE_KEY);
  if (!url || !serviceKey) return null;

  const cacheKey = `${url}|${serviceKey}`;
  if (!cachedSupabaseAdmin || cachedSupabaseKey !== cacheKey) {
    try {
      cachedSupabaseAdmin = createClient(url, serviceKey, {
        auth: {
          autoRefreshToken: false,
          persistSession: false
        }
      });
      cachedSupabaseKey = cacheKey;
    } catch {
      return null;
    }
  }
  return cachedSupabaseAdmin;
}

export function getSupabaseAnonClient(): SupabaseClient | null {
  const url = normalizeSupabaseUrl(getRawServerSupabaseUrl());
  const anonKey = cleanEnvValue(process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY);
  if (!url || !anonKey) return null;

  try {
    return createClient(url, anonKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    });
  } catch {
    return null;
  }
}
