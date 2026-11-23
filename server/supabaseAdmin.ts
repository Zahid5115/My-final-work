import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let cachedSupabaseAdmin: SupabaseClient | null = null;

export function normalizeSupabaseUrl(raw: string | undefined): string | null {
  if (!raw) return null;
  let cleaned = raw.trim().replace(/^['"]+|['"]+$/g, '').trim();
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

function cleanSecretValue(raw: string | undefined): string {
  return raw ? raw.trim().replace(/^['"]+|['"]+$/g, '').trim() : '';
}

export function getSupabaseConfigDiagnostics(): {
  urlConfigured: boolean;
  urlValid: boolean;
  serviceKeyConfigured: boolean;
  anonKeyConfigured: boolean;
} {
  const rawUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const normalized = normalizeSupabaseUrl(rawUrl);
  const serviceKey = cleanSecretValue(process.env.SUPABASE_SERVICE_ROLE_KEY);
  const anonKey = cleanSecretValue(process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY);

  return {
    urlConfigured: Boolean(cleanSecretValue(rawUrl)),
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
  const url = normalizeSupabaseUrl(process.env.SUPABASE_URL);
  const serviceKey = cleanSecretValue(process.env.SUPABASE_SERVICE_ROLE_KEY);
  return Boolean(url && serviceKey);
}

export function assertProductionPersistence(): void {
  if (isProductionEnvironment() && !isServerSupabaseConfigured()) {
    throw new Error(
      'Production database configuration error: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required in production. Local JSON persistence (data/platform-db.json) is disabled in production.'
    );
  }
}

export function getSupabaseAdminClient(): SupabaseClient | null {
  const url = normalizeSupabaseUrl(process.env.SUPABASE_URL);
  const serviceKey = cleanSecretValue(process.env.SUPABASE_SERVICE_ROLE_KEY);
  if (!url || !serviceKey) return null;

  if (!cachedSupabaseAdmin) {
    try {
      cachedSupabaseAdmin = createClient(url, serviceKey, {
        auth: {
          autoRefreshToken: false,
          persistSession: false
        }
      });
    } catch {
      return null;
    }
  }
  return cachedSupabaseAdmin;
}

export function getSupabaseAnonClient(): SupabaseClient | null {
  const url = normalizeSupabaseUrl(process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL);
  const anonKey = cleanSecretValue(process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY);
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
