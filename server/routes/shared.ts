import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { NextFunction, Request, Response } from 'express';
import multer from 'multer';
import type { AdminRoleName, AdminUserProfile, PermissionKey } from '../../src/types/platform.ts';
import { ALL_PERMISSION_KEYS } from '../../src/types/platform.ts';
import {
  parseCookieHeader,
  resolveSafeFilePath,
  verifyMutationOrigin,
  verifySessionToken
} from '../security.ts';
import {
  DEFAULT_ROLES,
  UPLOADS_ROOT,
  getDbState,
  getPermissionsForRole
} from '../store.ts';
import {
  getSupabaseAdminClient,
  isProductionEnvironment
} from '../supabaseAdmin.ts';
import type { SupabaseAdminClient } from '../supabaseRepo.ts';

export interface AuthenticatedRequest extends Request {
  adminUser?: AdminUserProfile;
  sessionJti?: string;
}

export const SESSION_COOKIE_NAME = 'slc_admin_session';

const ALLOWED_IMAGE_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const ALLOWED_DOC_MIMES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
  'text/plain'
]);

function makeMulterUploader(allowedMimes: Set<string>) {
  return multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024, files: 4 },
    fileFilter: (_req, file, cb) => {
      if (allowedMimes.has(file.mimetype)) {
        cb(null, true);
      } else {
        cb(new Error('Unsupported file type. Allowed: JPG, PNG, WEBP, PDF, TXT.'));
      }
    }
  });
}

export const uploadImageMiddleware = makeMulterUploader(ALLOWED_IMAGE_MIMES);
export const uploadAttachmentMiddleware = makeMulterUploader(ALLOWED_DOC_MIMES);

// In-process async mutex to serialize concurrent first-admin bootstrap requests
let bootstrapLockChain: Promise<void> = Promise.resolve();
export async function runWithBootstrapLock<T>(task: () => Promise<T>): Promise<T> {
  const prev = bootstrapLockChain;
  let release!: () => void;
  bootstrapLockChain = new Promise<void>((resolve) => {
    release = resolve;
  });
  await prev;
  try {
    return await task();
  } finally {
    release();
  }
}

export async function persistUploadedFile(
  bucket: 'gallery' | 'work-order-attachments' | 'vendor-documents' | 'dispatch-attachments',
  file: Express.Multer.File
): Promise<{ storagePath: string; publicUrl?: string }> {
  const ext = path.extname(file.originalname).toLowerCase().replace(/[^a-z0-9.]/g, '') || '.bin';
  const safeName = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}${ext}`;

  const sb = getSupabaseAdminClient();
  if (sb) {
    const { error } = await sb.storage.from(bucket).upload(safeName, file.buffer, {
      contentType: file.mimetype,
      upsert: false
    });
    if (error) {
      throw new Error(`Supabase Storage upload failed: ${error.message}`);
    }
    if (bucket === 'gallery') {
      const { data } = sb.storage.from(bucket).getPublicUrl(safeName);
      return { storagePath: safeName, publicUrl: data.publicUrl };
    }
    return { storagePath: safeName };
  }

  if (isProductionEnvironment()) {
    throw new Error('File storage requires Supabase in production; local disk uploads are disabled.');
  }

  const destPath = resolveSafeFilePath(UPLOADS_ROOT, bucket, safeName);
  if (!destPath) {
    throw new Error('Invalid destination path');
  }
  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  fs.writeFileSync(destPath, file.buffer);
  return {
    storagePath: safeName,
    publicUrl: bucket === 'gallery' ? `/uploads/gallery/${safeName}` : undefined
  };
}

export async function ensureSupabaseSystemRoles(
  sb: SupabaseAdminClient
): Promise<Array<{ id: string; name: AdminRoleName; description: string }>> {
  const { data: existingRoles } = await sb.from('admin_roles').select('id, name, description');
  const byName = new Map<string, { id: string; name: AdminRoleName; description: string }>();
  for (const row of existingRoles ?? []) {
    byName.set(row.name, {
      id: row.id,
      name: row.name as AdminRoleName,
      description: row.description ?? ''
    });
  }

  for (const def of DEFAULT_ROLES) {
    if (!byName.has(def.role)) {
      const { data: inserted } = await sb
        .from('admin_roles')
        .upsert(
          { name: def.role, description: def.description, is_system: true },
          { onConflict: 'name' }
        )
        .select('id, name, description')
        .single();
      if (inserted) {
        byName.set(def.role, {
          id: inserted.id,
          name: inserted.name as AdminRoleName,
          description: inserted.description ?? def.description
        });
        if (def.permissions.length > 0) {
          await sb.from('role_permissions').upsert(
            def.permissions.map((perm) => ({
              role_id: inserted.id,
              permission_key: perm,
              allowed: true
            })),
            { onConflict: 'role_id,permission_key' }
          );
        }
      }
    }
  }

  return Array.from(byName.values());
}

export async function insertSupabaseAuditLog(
  sb: SupabaseAdminClient,
  entry: {
    actorId: string | null;
    actorEmail: string;
    actorRole: string;
    action: string;
    entityType: string;
    entityId: string;
    summary: string;
  }
): Promise<void> {
  try {
    await sb.from('admin_activity_logs').insert({
      actor_id: entry.actorId,
      actor_email: entry.actorEmail,
      actor_role: entry.actorRole,
      action: entry.action,
      entity_type: entry.entityType,
      entity_id: entry.entityId,
      summary: entry.summary
    });
  } catch {
    // Audit logging should not crash primary flow if schema is still initializing
  }
}

export function setSessionCookie(req: Request, res: Response, token: string): void {
  const isHttps = req.secure || req.headers['x-forwarded-proto'] === 'https';
  const parts = [
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    `Max-Age=${60 * 60 * 12}`
  ];
  if (isHttps) {
    parts.push('Secure', 'SameSite=None', 'Partitioned');
  } else {
    parts.push('SameSite=Lax');
  }
  res.setHeader('Set-Cookie', parts.join('; '));
}

export function clearSessionCookie(req: Request, res: Response): void {
  const isHttps = req.secure || req.headers['x-forwarded-proto'] === 'https';
  const parts = [`${SESSION_COOKIE_NAME}=`, 'Path=/', 'HttpOnly', 'Max-Age=0'];
  if (isHttps) {
    parts.push('Secure', 'SameSite=None', 'Partitioned');
  } else {
    parts.push('SameSite=Lax');
  }
  res.setHeader('Set-Cookie', parts.join('; '));
}

export async function resolveAdminFromRequest(
  req: AuthenticatedRequest
): Promise<{ user: AdminUserProfile; jti?: string } | null> {
  const authHeader = req.headers.authorization;
  let token = '';
  let usedCookie = false;

  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.slice(7).trim();
  } else {
    const cookies = parseCookieHeader(req.headers.cookie);
    if (cookies[SESSION_COOKIE_NAME]) {
      token = cookies[SESSION_COOKIE_NAME];
      usedCookie = true;
    }
  }

  if (!token) return null;

  if (usedCookie && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method.toUpperCase())) {
    if (!verifyMutationOrigin(req)) {
      return null;
    }
  }

  const sb = getSupabaseAdminClient();
  if (sb && token.split('.').length === 3) {
    const { data: userData, error } = await sb.auth.getUser(token);
    if (!error && userData?.user) {
      const { data: profile } = await sb
        .from('profiles')
        .select('id, email, full_name, phone, avatar_url, is_admin, account_status, last_login_at, created_at, admin_roles(id, name)')
        .eq('id', userData.user.id)
        .single();

      if (profile && profile.is_admin && profile.account_status === 'active') {
        const roleRel = profile.admin_roles as unknown as { id: string; name: AdminRoleName } | null;
        const roleName: AdminRoleName = roleRel?.name ?? 'Admin';
        let permissions: PermissionKey[] = [];
        if (roleName === 'Super Admin') {
          permissions = [...ALL_PERMISSION_KEYS];
        } else if (roleRel?.id) {
          const { data: perms } = await sb
            .from('role_permissions')
            .select('permission_key, allowed')
            .eq('role_id', roleRel.id)
            .eq('allowed', true);
          permissions = (perms ?? []).map((p) => p.permission_key as PermissionKey);
        }
        return {
          user: {
            id: profile.id,
            email: profile.email,
            fullName: profile.full_name,
            phone: profile.phone ?? '',
            avatarUrl: profile.avatar_url ?? '',
            role: roleName,
            accountStatus: profile.account_status,
            permissions,
            lastLoginAt: profile.last_login_at,
            createdAt: profile.created_at
          }
        };
      }
    }
    return null;
  }

  if (sb || isProductionEnvironment()) {
    return null;
  }

  const payload = verifySessionToken(token);
  if (!payload) return null;

  const state = getDbState();
  if (state.revokedJtis.includes(payload.jti)) return null;

  const admin = state.admins.find((a) => a.id === payload.sub);
  if (!admin || admin.accountStatus !== 'active') return null;

  return {
    jti: payload.jti,
    user: {
      id: admin.id,
      email: admin.email,
      fullName: admin.fullName,
      phone: admin.phone,
      avatarUrl: admin.avatarUrl,
      role: admin.role,
      accountStatus: admin.accountStatus,
      permissions: getPermissionsForRole(state, admin.role),
      lastLoginAt: admin.lastLoginAt,
      createdAt: admin.createdAt
    }
  };
}

export async function requireAdmin(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const resolved = await resolveAdminFromRequest(req);
    if (!resolved) {
      res.status(401).json({ error: 'Authentication required. Please sign in to the Admin Portal.' });
      return;
    }
    req.adminUser = resolved.user;
    req.sessionJti = resolved.jti;
    next();
  } catch (err) {
    next(err);
  }
}

export function requirePermission(perm: PermissionKey) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    const user = req.adminUser;
    if (!user) {
      res.status(401).json({ error: 'Authentication required.' });
      return;
    }
    if (user.role !== 'Super Admin' && !user.permissions.includes(perm)) {
      res.status(403).json({ error: `Insufficient permissions (${perm}).` });
      return;
    }
    next();
  };
}

export function computeDateCutoff(
  range: string,
  fromStr?: string,
  toStr?: string
): { start: number; end: number } {
  const now = Date.now();
  if (range === 'today') {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return { start: d.getTime(), end: now };
  }
  if (range === '7d') return { start: now - 7 * 86400 * 1000, end: now };
  if (range === '30d') return { start: now - 30 * 86400 * 1000, end: now };
  if (range === '90d') return { start: now - 90 * 86400 * 1000, end: now };
  if (range === 'custom' && fromStr) {
    const start = new Date(fromStr).getTime();
    const end = toStr ? new Date(toStr).getTime() + 86399999 : now;
    if (!Number.isNaN(start)) {
      return { start, end: Number.isNaN(end) ? now : end };
    }
  }
  return { start: 0, end: now + 365 * 86400 * 1000 };
}
