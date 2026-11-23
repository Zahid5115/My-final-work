import crypto from 'node:crypto';
import path from 'node:path';
import type { NextFunction, Request, Response } from 'express';

// Ephemeral in-memory fallback when SESSION_SECRET env var is unset
const EPHEMERAL_SECRET = crypto.randomBytes(32).toString('hex');

function getSigningSecret(): string {
  const envSecret = cleanEnvValue(process.env.SESSION_SECRET);
  return envSecret && envSecret.length >= 16 ? envSecret : EPHEMERAL_SECRET;
}

export function cleanEnvValue(raw: string | undefined): string {
  if (!raw) return '';
  const trimmed = raw.trim();
  const wrapped = trimmed.match(/^(['"])([\s\S]*)\1$/);
  return (wrapped ? wrapped[2] : trimmed).trim();
}

export function getBootstrapConfig(): {
  secret: string;
  secretConfigured: boolean;
  allowedEmails: string[];
  emailAllowlistConfigured: boolean;
} {
  const secret = cleanEnvValue(process.env.ADMIN_BOOTSTRAP_SECRET);
  const rawEmail = cleanEnvValue(process.env.ADMIN_BOOTSTRAP_EMAIL);
  const allowedEmails = rawEmail
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  return {
    secret,
    secretConfigured: Boolean(secret),
    allowedEmails,
    emailAllowlistConfigured: allowedEmails.length > 0
  };
}

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

export function verifyPassword(password: string, storedHash: string): boolean {
  const parts = storedHash.split(':');
  if (parts.length !== 2) return false;
  const [salt, keyHex] = parts;
  if (!salt || !keyHex) return false;
  try {
    const keyBuf = Buffer.from(keyHex, 'hex');
    const derivedBuf = crypto.scryptSync(password, salt, 64);
    if (keyBuf.length !== derivedBuf.length) return false;
    return crypto.timingSafeEqual(keyBuf, derivedBuf);
  } catch {
    return false;
  }
}

export interface SessionTokenPayload {
  sub: string;
  email: string;
  jti: string;
  iat: number;
  exp: number;
}

export function signSessionToken(userId: string, email: string, ttlSeconds = 60 * 60 * 12): string {
  const now = Math.floor(Date.now() / 1000);
  const payload: SessionTokenPayload = {
    sub: userId,
    email,
    jti: crypto.randomUUID(),
    iat: now,
    exp: now + ttlSeconds
  };
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const sig = crypto
    .createHmac('sha256', getSigningSecret())
    .update(encoded)
    .digest('base64url');
  return `${encoded}.${sig}`;
}

export function verifySessionToken(token: string): SessionTokenPayload | null {
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [encoded, sig] = parts;
  if (!encoded || !sig) return null;
  const expectedSig = crypto
    .createHmac('sha256', getSigningSecret())
    .update(encoded)
    .digest('base64url');
  const sigBuf = Buffer.from(sig);
  const expBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    return null;
  }
  try {
    const decoded = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as SessionTokenPayload;
    if (!decoded.sub || !decoded.exp || decoded.exp < Math.floor(Date.now() / 1000)) {
      return null;
    }
    return decoded;
  } catch {
    return null;
  }
}

export function sanitizeText(value: unknown, maxLen = 2000): string {
  if (typeof value !== 'string') return '';
  return value.replace(/\0/g, '').trim().slice(0, maxLen);
}

export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim()) && email.length <= 254;
}

export function isSafeMediaUrl(url: string): boolean {
  const trimmed = url.trim();
  if (!trimmed) return true;
  if (trimmed.startsWith('/') && !trimmed.startsWith('//')) return true;
  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
}

export function resolveSafeFilePath(baseDir: string, ...segments: string[]): string | null {
  const resolvedBase = path.resolve(baseDir);
  const cleanedSegments = segments.map((s) => path.basename(s));
  const resolvedTarget = path.resolve(resolvedBase, ...cleanedSegments);
  if (!resolvedTarget.startsWith(resolvedBase + path.sep)) {
    return null;
  }
  return resolvedTarget;
}

export function parseCookieHeader(cookieHeader: string | undefined): Record<string, string> {
  const result: Record<string, string> = {};
  if (!cookieHeader) return result;
  for (const part of cookieHeader.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const val = part.slice(idx + 1).trim();
    if (key) {
      try {
        result[key] = decodeURIComponent(val);
      } catch {
        result[key] = val;
      }
    }
  }
  return result;
}

export function verifyMutationOrigin(req: Request): boolean {
  // Custom header verification or same-host origin check for cookie-authenticated mutations
  const xRequestedWith = req.headers['x-requested-with'];
  const headerVal = Array.isArray(xRequestedWith) ? xRequestedWith[0] : xRequestedWith;
  if (typeof headerVal === 'string' && headerVal.toLowerCase() === 'xmlhttprequest') return true;
  const origin = req.headers.origin;
  const host = (req.headers['x-forwarded-host'] as string | undefined) || req.headers.host;
  if (origin && host) {
    try {
      const parsedOrigin = new URL(origin);
      return parsedOrigin.host === host;
    } catch {
      return false;
    }
  }
  return false;
}

export function securityHeadersMiddleware(req: Request, res: Response, next: NextFunction): void {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(self)');
  if (req.secure || req.headers['x-forwarded-proto'] === 'https') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  next();
}

export function createRateLimiter(maxRequests: number, windowMs: number) {
  const hits = new Map<string, { count: number; resetAt: number }>();

  return (req: Request, res: Response, next: NextFunction): void => {
    const forwarded = req.headers['x-forwarded-for'];
    const ip = (Array.isArray(forwarded) ? forwarded[0] : forwarded?.split(',')[0])?.trim() || req.ip || 'unknown';
    const key = `${ip}:${req.baseUrl}${req.path}`;
    const now = Date.now();
    const existing = hits.get(key);

    if (!existing || existing.resetAt <= now) {
      hits.set(key, { count: 1, resetAt: now + windowMs });
      if (hits.size > 5000) {
        for (const [k, v] of hits.entries()) {
          if (v.resetAt <= now) hits.delete(k);
        }
      }
      next();
      return;
    }

    if (existing.count >= maxRequests) {
      const retryAfter = Math.max(1, Math.ceil((existing.resetAt - now) / 1000));
      res.setHeader('Retry-After', String(retryAfter));
      res.status(429).json({
        error: 'Too many requests. Please wait a moment before trying again.'
      });
      return;
    }

    existing.count += 1;
    next();
  };
}

export function csvEscape(value: unknown): string {
  const raw = value == null ? '' : String(value);
  // Neutralize spreadsheet formula injection
  const safe = /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;
  return `"${safe.replace(/"/g, '""')}"`;
}

export function rowsToCsv(headers: string[], rows: Array<Array<unknown>>): string {
  const headerLine = headers.map(csvEscape).join(',');
  const dataLines = rows.map((row) => row.map(csvEscape).join(','));
  return [headerLine, ...dataLines].join('\r\n');
}
