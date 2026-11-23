import { createClient, type SupabaseClient } from '@supabase/supabase-js';

function normalizeSupabaseUrl(raw: string | undefined): string {
  if (!raw) return '';
  let cleaned = raw.trim().replace(/^['"]+|['"]+$/g, '').trim();
  if (!cleaned) return '';

  if (/^[a-z0-9-]+\.supabase\.(co|in|net)$/i.test(cleaned)) {
    cleaned = `https://${cleaned}`;
  }

  try {
    const parsed = new URL(cleaned);
    if ((parsed.protocol === 'https:' || parsed.protocol === 'http:') && parsed.hostname) {
      return cleaned;
    }
  } catch {
    return '';
  }
  return '';
}

const rawUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const supabaseUrl = normalizeSupabaseUrl(rawUrl);
const supabaseAnonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined)
  ?.trim()
  .replace(/^['"]+|['"]+$/g, '') ?? '';

export const isBrowserSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);
export const isBrowserSupabaseUrlInvalid = Boolean(rawUrl?.trim() && !supabaseUrl);

let browserClient: SupabaseClient | null = null;

export function getSupabaseBrowserClient(): SupabaseClient | null {
  if (!isBrowserSupabaseConfigured) return null;
  if (!browserClient) {
    try {
      browserClient = createClient(supabaseUrl, supabaseAnonKey, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true
        }
      });
    } catch {
      return null;
    }
  }
  return browserClient;
}
