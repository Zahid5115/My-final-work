import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import express, { type NextFunction, type Request, type Response } from 'express';
import multer from 'multer';
import type {
  AdminRoleName,
  AdminUserProfile,
  BidRequestStatus,
  ClientType,
  DispatchStatus,
  MessageStatus,
  PermissionKey,
  PriorityLevel,
  ReviewPublicationStatus,
  VendorApplicationStatus,
  VendorBidStatus,
  WorkOrderStatus
} from '../src/types/platform.ts';
import {
  ALL_PERMISSION_KEYS,
  BID_REQUEST_STATUSES,
  CLIENT_TYPES,
  DISPATCH_STATUSES,
  PRIORITY_LEVELS,
  VENDOR_APPLICATION_STATUSES,
  WORK_ORDER_STATUSES
} from '../src/types/platform.ts';
import { isEmailServiceConfigured, sendTransactionalEmail } from './email.ts';
import {
  createRateLimiter,
  hashPassword,
  isSafeMediaUrl,
  isValidEmail,
  parseCookieHeader,
  resolveSafeFilePath,
  rowsToCsv,
  sanitizeText,
  signSessionToken,
  verifyMutationOrigin,
  verifyPassword,
  verifySessionToken
} from './security.ts';
import {
  DEFAULT_ROLES,
  UPLOADS_ROOT,
  appendActivityLog,
  appendNotification,
  appendWorkOrderTimeline,
  getDbState,
  getPermissionsForRole,
  saveDbState
} from './store.ts';
import {
  getSupabaseAdminClient,
  getSupabaseAnonClient,
  getSupabaseConfigDiagnostics
} from './supabaseAdmin.ts';

type SupabaseAdminClient = NonNullable<ReturnType<typeof getSupabaseAdminClient>>;

async function ensureSupabaseSystemRoles(
  sb: SupabaseAdminClient
): Promise<Array<{ id: string; name: AdminRoleName; description: string }>> {
  const { data: existingRoles } = await sb
    .from('admin_roles')
    .select('id, name, description');

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

async function insertSupabaseAuditLog(
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

interface AuthenticatedRequest extends Request {
  adminUser?: AdminUserProfile;
  sessionJti?: string;
}

const SESSION_COOKIE_NAME = 'slc_admin_session';

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

const uploadImageMiddleware = makeMulterUploader(ALLOWED_IMAGE_MIMES);
const uploadAttachmentMiddleware = makeMulterUploader(ALLOWED_DOC_MIMES);

async function persistUploadedFile(
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
    if (!error) {
      if (bucket === 'gallery') {
        const { data } = sb.storage.from(bucket).getPublicUrl(safeName);
        return { storagePath: safeName, publicUrl: data.publicUrl };
      }
      return { storagePath: safeName };
    }
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

function setSessionCookie(req: Request, res: Response, token: string): void {
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

function clearSessionCookie(req: Request, res: Response): void {
  const isHttps = req.secure || req.headers['x-forwarded-proto'] === 'https';
  const parts = [
    `${SESSION_COOKIE_NAME}=`,
    'Path=/',
    'HttpOnly',
    'Max-Age=0'
  ];
  if (isHttps) {
    parts.push('Secure', 'SameSite=None', 'Partitioned');
  } else {
    parts.push('SameSite=Lax');
  }
  res.setHeader('Set-Cookie', parts.join('; '));
}

async function resolveAdminFromRequest(
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

  // Enforce Origin/X-Requested-With check on cookie-authenticated mutating requests
  if (usedCookie && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method.toUpperCase())) {
    if (!verifyMutationOrigin(req)) {
      return null;
    }
  }

  // 1. Try Supabase JWT verification if configured
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
  }

  // 2. Local HMAC-SHA256 session token verification
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

async function requireAdmin(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
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

function requirePermission(perm: PermissionKey) {
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

function toPublicBootstrap() {
  const state = getDbState();
  return {
    services: state.services
      .filter((s) => s.isVisible && !s.isArchived)
      .sort((a, b) => a.sortOrder - b.sortOrder),
    galleryCases: state.galleryCases
      .filter((g) => g.isPublished)
      .sort((a, b) => a.sortOrder - b.sortOrder),
    coverageRegions: state.coverageRegions.filter((r) => r.isPublished),
    reviews: state.reviews
      .filter((r) => r.publicationStatus === 'Published')
      .sort((a, b) => a.sortOrder - b.sortOrder),
    publicWorkOrders: state.workOrders
      .filter((w) => !w.isArchived && ['Open Bid', 'Dispatched', 'In Progress', 'QC Verified'].includes(w.status))
      .map((w) => ({
        id: w.id,
        workOrderCode: w.workOrderCode,
        clientType: w.clientType,
        serviceType: w.serviceDescription,
        cityState: `${w.city}, ${w.state}`,
        county: w.county,
        status: w.status,
        slaDue: w.slaDeadline
          ? `SLA: ${new Date(w.slaDeadline).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
          : 'Standard SLA',
        estimatedBudget: w.estimatedBudget,
        coordinates: w.lat != null && w.lng != null ? { lat: w.lat, lng: w.lng } : null
      })),
    businessSettings: state.businessSettings
  };
}

function computeDateCutoff(range: string, fromStr?: string, toStr?: string): { start: number; end: number } {
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

export function createApiRouter(): express.Router {
  const router = express.Router();
  const authLimiter = createRateLimiter(15, 15 * 60 * 1000);
  const publicSubmitLimiter = createRateLimiter(25, 15 * 60 * 1000);

  // ===========================================================================
  // 1. PUBLIC ENDPOINTS (Zero PII Exposed)
  // ===========================================================================
  router.get('/public/bootstrap', (_req, res) => {
    res.json(toPublicBootstrap());
  });

  router.post('/public/bid-requests', publicSubmitLimiter, (req, res) => {
    const name = sanitizeText(req.body?.name, 120);
    const email = sanitizeText(req.body?.email, 254).toLowerCase();
    const phone = sanitizeText(req.body?.phone, 40);
    const propertyAddress = sanitizeText(req.body?.propertyAddress, 240);
    const city = sanitizeText(req.body?.city, 80);
    const stateCode = sanitizeText(req.body?.state, 40);
    const zipCode = sanitizeText(req.body?.zipCode, 20);
    const requestedServices = sanitizeText(req.body?.serviceScope || req.body?.requestedServices, 180) || 'Property Preservation';
    const notes = sanitizeText(req.body?.notes, 2000);
    const est = req.body?.estimatorData;

    if (!name || !isValidEmail(email) || phone.length < 7 || !propertyAddress) {
      res.status(400).json({ error: 'Please provide your name, valid email, phone number, and property address.' });
      return;
    }

    const db = getDbState();
    const requestCode = `EST-${Math.floor(100000 + Math.random() * 899999)}`;
    const now = new Date().toISOString();
    const record = {
      id: crypto.randomUUID(),
      requestCode,
      contactName: name,
      email,
      phone,
      propertyAddress,
      city,
      state: stateCode,
      zipCode,
      requestedServices,
      notes,
      estimatorData:
        est && typeof est === 'object' && typeof est.lowEstimate === 'number' && typeof est.highEstimate === 'number'
          ? {
              categoryLabel: sanitizeText(est.categoryLabel, 120),
              lowEstimate: Number(est.lowEstimate),
              highEstimate: Number(est.highEstimate),
              summary: sanitizeText(est.summary, 300)
            }
          : null,
      status: 'New' as BidRequestStatus,
      internalNotes: '',
      convertedWorkOrderId: null,
      isArchived: false,
      createdAt: now,
      updatedAt: now
    };

    db.bidRequests.unshift(record);
    appendNotification(db, {
      eventType: 'new_bid_request',
      title: `New Bid Request ${requestCode}`,
      message: `${name} requested ${requestedServices} at ${propertyAddress}.`,
      entityType: 'bid_request',
      entityId: record.id
    });
    appendActivityLog(db, {
      actorId: null,
      actorEmail: email,
      actorRole: 'Public Visitor',
      action: 'bid_request_submitted',
      entityType: 'bid_request',
      entityId: record.id,
      summary: `Public bid request ${requestCode} submitted for ${propertyAddress}.`
    });
    saveDbState(db);

    res.status(201).json({ requestCode, id: record.id, createdAt: now });
  });

  router.post('/public/dispatch-requests', publicSubmitLimiter, (req, res) => {
    const contactName = sanitizeText(req.body?.name || req.body?.contactName, 120);
    const phone = sanitizeText(req.body?.phone, 40);
    const email = sanitizeText(req.body?.email, 254).toLowerCase();
    const propertyAddress = sanitizeText(req.body?.propertyLocation || req.body?.propertyAddress, 240);
    const city = sanitizeText(req.body?.city, 80);
    const stateCode = sanitizeText(req.body?.state, 40);
    const zipCode = sanitizeText(req.body?.zipCode, 20);
    const emergencyType = sanitizeText(req.body?.topic || req.body?.emergencyType, 160) || 'Emergency Board-Up / Securing';
    const description = sanitizeText(req.body?.message || req.body?.description, 2000);

    if (!contactName || phone.length < 7 || !propertyAddress) {
      res.status(400).json({ error: 'Please enter your name, callback phone number, and property location.' });
      return;
    }

    const db = getDbState();
    const dispatchCode = `URG-${Math.floor(100000 + Math.random() * 899999)}`;
    const now = new Date().toISOString();
    const record = {
      id: crypto.randomUUID(),
      dispatchCode,
      contactName,
      phone,
      email,
      propertyAddress,
      city,
      state: stateCode,
      zipCode,
      emergencyType,
      description,
      priority: 'Urgent' as PriorityLevel,
      status: 'New' as DispatchStatus,
      assignedVendorId: null,
      assignedVendorName: '',
      internalNotes: '',
      timeline: [
        {
          id: crypto.randomUUID(),
          actorName: contactName,
          description: `Urgent dispatch request ${dispatchCode} created via live dispatch widget.`,
          createdAt: now
        }
      ],
      submittedDate: now,
      updatedAt: now
    };

    db.dispatchRequests.unshift(record);
    appendNotification(db, {
      eventType: 'new_dispatch_request',
      title: `Urgent Dispatch ${dispatchCode}`,
      message: `${emergencyType} reported at ${propertyAddress} (${phone}).`,
      entityType: 'dispatch',
      entityId: record.id
    });
    appendActivityLog(db, {
      actorId: null,
      actorEmail: email || phone,
      actorRole: 'Public Visitor',
      action: 'dispatch_submitted',
      entityType: 'dispatch',
      entityId: record.id,
      summary: `Urgent dispatch ${dispatchCode} logged for ${propertyAddress}.`
    });
    saveDbState(db);

    res.status(201).json({ dispatchCode, id: record.id, submittedDate: now });
  });

  router.post('/public/vendor-applications', publicSubmitLimiter, (req, res) => {
    const companyName = sanitizeText(req.body?.companyName, 140);
    const contactPerson = sanitizeText(req.body?.contactName || req.body?.contactPerson, 120);
    const email = sanitizeText(req.body?.email, 254).toLowerCase();
    const phone = sanitizeText(req.body?.phone, 40);
    const coverageAreas = sanitizeText(req.body?.statesCovered || req.body?.coverageAreas, 240);
    const trades = Array.isArray(req.body?.trades)
      ? req.body.trades.map((t: unknown) => sanitizeText(t, 80)).filter(Boolean)
      : [];
    const hasInsurance = Boolean(req.body?.hasInsurance);

    if (!companyName || !contactPerson || !isValidEmail(email) || phone.length < 7) {
      res.status(400).json({ error: 'Please provide your LLC/Company name, contact name, valid email, and phone number.' });
      return;
    }
    if (trades.length === 0) {
      res.status(400).json({ error: 'Please select at least one primary field service trade.' });
      return;
    }

    const db = getDbState();
    const vendorCode = `VND-${Math.floor(10000 + Math.random() * 89999)}`;
    const now = new Date().toISOString();
    const record = {
      id: crypto.randomUUID(),
      vendorCode,
      companyName,
      contactPerson,
      email,
      phone,
      address: '',
      city: '',
      state: '',
      zipCode: '',
      serviceCategories: trades,
      coverageAreas,
      counties: [],
      licenseInfo: '',
      insuranceInfo: hasInsurance ? 'Applicant attested GL & ABC# compliance (Pending Verification)' : 'Not attested',
      aspenGroveAbc: '',
      applicationStatus: 'Pending' as VendorApplicationStatus,
      accountStatus: 'pending' as const,
      rating: null,
      completedWorkOrders: 0,
      notes: '',
      isDemo: false,
      registrationDate: now,
      updatedAt: now
    };

    db.vendors.unshift(record);
    appendNotification(db, {
      eventType: 'new_vendor_application',
      title: `New Vendor Application ${vendorCode}`,
      message: `${companyName} (${contactPerson}) applied for ${trades.join(', ')}.`,
      entityType: 'vendor',
      entityId: record.id
    });
    appendActivityLog(db, {
      actorId: null,
      actorEmail: email,
      actorRole: 'Vendor Applicant',
      action: 'vendor_application_submitted',
      entityType: 'vendor',
      entityId: record.id,
      summary: `Vendor application ${vendorCode} submitted by ${companyName}.`
    });
    saveDbState(db);

    res.status(201).json({ vendorCode, id: record.id });
  });

  router.post('/public/vendor-bids', publicSubmitLimiter, (req, res) => {
    const workOrderIdentifier = sanitizeText(req.body?.workOrderId || req.body?.workOrderCode, 80);
    const proposedPrice = Number(req.body?.proposedPrice ?? req.body?.bidAmount);
    const aspenGroveAbc = sanitizeText(req.body?.vendorCode || req.body?.aspenGroveAbc, 60);
    const vendorName = sanitizeText(req.body?.vendorName, 120) || (aspenGroveAbc ? `Field Vendor (${aspenGroveAbc})` : 'Portal Vendor Applicant');
    const estimatedCompletionTime = sanitizeText(req.body?.estimatedCompletionTime, 80) || '48 Hours';
    const bidNotes = sanitizeText(req.body?.bidNotes, 1000);

    if (!workOrderIdentifier || !Number.isFinite(proposedPrice) || proposedPrice < 25) {
      res.status(400).json({ error: 'Please select a valid work order and enter a bid of at least $25.' });
      return;
    }

    const db = getDbState();
    const wo = db.workOrders.find(
      (w) => !w.isArchived && (w.id === workOrderIdentifier || w.workOrderCode === workOrderIdentifier)
    );
    if (!wo) {
      res.status(404).json({ error: 'Referenced work order was not found or is closed.' });
      return;
    }

    const matchedVendor = aspenGroveAbc
      ? db.vendors.find((v) => v.aspenGroveAbc.toLowerCase() === aspenGroveAbc.toLowerCase())
      : undefined;

    const bidCode = `BID-${Math.floor(10000 + Math.random() * 89999)}`;
    const now = new Date().toISOString();
    const record = {
      id: crypto.randomUUID(),
      bidCode,
      workOrderId: wo.id,
      workOrderCode: wo.workOrderCode,
      vendorId: matchedVendor?.id ?? null,
      vendorName: matchedVendor?.companyName ?? vendorName,
      aspenGroveAbc,
      proposedPrice: Math.round(proposedPrice * 100) / 100,
      estimatedCompletionTime,
      bidNotes,
      attachments: [],
      status: 'Submitted' as VendorBidStatus,
      clarificationNote: '',
      submittedDate: now,
      updatedAt: now
    };

    db.vendorBids.unshift(record);
    appendWorkOrderTimeline(
      db,
      wo.id,
      record.vendorName,
      'bid_submitted',
      `Vendor bid ${bidCode} submitted for $${record.proposedPrice.toLocaleString()}.`
    );
    appendNotification(db, {
      eventType: 'new_vendor_bid',
      title: `New Vendor Bid ${bidCode}`,
      message: `${record.vendorName} bid $${record.proposedPrice.toLocaleString()} on ${wo.workOrderCode}.`,
      entityType: 'work_order',
      entityId: wo.id
    });
    saveDbState(db);

    res.status(201).json({ bidCode, id: record.id, workOrderCode: wo.workOrderCode });
  });

  router.post('/public/messages', publicSubmitLimiter, (req, res) => {
    const senderName = sanitizeText(req.body?.name || req.body?.senderName, 120);
    const senderEmail = sanitizeText(req.body?.email || req.body?.senderEmail, 254).toLowerCase();
    const senderPhone = sanitizeText(req.body?.phone || req.body?.senderPhone, 40);
    const subject = sanitizeText(req.body?.subject, 160) || 'General Inquiry';
    const body = sanitizeText(req.body?.body || req.body?.message, 3000);

    if (!senderName || (!senderEmail && !senderPhone) || !body) {
      res.status(400).json({ error: 'Please include your name, email or phone, and message.' });
      return;
    }

    const db = getDbState();
    const now = new Date().toISOString();
    const record = {
      id: crypto.randomUUID(),
      senderName,
      senderEmail,
      senderPhone,
      subject,
      body,
      source: sanitizeText(req.body?.source, 60) || 'Contact Form',
      status: 'Unread' as MessageStatus,
      internalNotes: '',
      linkedClientId: null,
      linkedBidRequestId: null,
      linkedWorkOrderId: null,
      linkedDispatchId: null,
      createdAt: now,
      updatedAt: now
    };

    db.messages.unshift(record);
    appendNotification(db, {
      eventType: 'new_message',
      title: `New Contact Message`,
      message: `${senderName}: ${subject}`,
      entityType: 'message',
      entityId: record.id
    });
    saveDbState(db);

    res.status(201).json({ id: record.id });
  });

  // ===========================================================================
  // 2. ADMIN AUTHENTICATION & CONTROLLED FIRST-ADMIN BOOTSTRAP
  // ===========================================================================
  router.get('/admin/auth/status', async (_req, res) => {
    const bootstrapConfigured = Boolean(process.env.ADMIN_BOOTSTRAP_SECRET?.trim());
    const requiresBootstrapEmail = Boolean(process.env.ADMIN_BOOTSTRAP_EMAIL?.trim());
    const diag = getSupabaseConfigDiagnostics();
    const supabaseUrlInvalid = diag.urlConfigured && !diag.urlValid;

    const sb = getSupabaseAdminClient();
    if (sb) {
      try {
        const { count, error } = await sb
          .from('profiles')
          .select('id', { count: 'exact', head: true })
          .eq('is_admin', true);

        if (error) {
          res.json({
            needsFirstAdminSetup: true,
            authMode: 'supabase',
            emailConfigured: true,
            bootstrapConfigured,
            requiresBootstrapSecret: true,
            requiresBootstrapEmail,
            supabaseUrlInvalid,
            supabaseWarning: `Supabase profiles table check returned: ${error.message}`
          });
          return;
        }

        res.json({
          needsFirstAdminSetup: (count ?? 0) === 0,
          authMode: 'supabase',
          emailConfigured: true,
          bootstrapConfigured,
          requiresBootstrapSecret: true,
          requiresBootstrapEmail,
          supabaseUrlInvalid
        });
        return;
      } catch (err) {
        res.json({
          needsFirstAdminSetup: true,
          authMode: 'supabase',
          emailConfigured: true,
          bootstrapConfigured,
          requiresBootstrapSecret: true,
          requiresBootstrapEmail,
          supabaseUrlInvalid,
          supabaseWarning: err instanceof Error ? err.message : 'Unable to reach Supabase.'
        });
        return;
      }
    }

    const db = getDbState();
    res.json({
      needsFirstAdminSetup: db.admins.length === 0,
      authMode: 'local',
      emailConfigured: isEmailServiceConfigured(),
      bootstrapConfigured,
      requiresBootstrapSecret: true,
      requiresBootstrapEmail,
      supabaseUrlInvalid
    });
  });

  router.post('/admin/auth/setup-first-admin', authLimiter, async (req, res) => {
    const fullName = sanitizeText(req.body?.fullName, 120);
    const email = sanitizeText(req.body?.email, 254).toLowerCase();
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    const bootstrapSecret = sanitizeText(req.body?.bootstrapSecret, 200);

    // Mandatory server-side owner secret: prevents random visitors from claiming Super Admin
    const requiredBootstrapSecret = process.env.ADMIN_BOOTSTRAP_SECRET?.trim();
    if (!requiredBootstrapSecret) {
      res.status(403).json({
        error:
          'First-admin setup is locked until ADMIN_BOOTSTRAP_SECRET is configured on the server by the project owner.'
      });
      return;
    }

    const providedBuf = Buffer.from(bootstrapSecret);
    const expectedBuf = Buffer.from(requiredBootstrapSecret);
    if (providedBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(providedBuf, expectedBuf)) {
      res.status(403).json({ error: 'Invalid server setup secret.' });
      return;
    }

    const allowedOwnerEmail = process.env.ADMIN_BOOTSTRAP_EMAIL?.trim().toLowerCase();
    if (allowedOwnerEmail && email !== allowedOwnerEmail) {
      res.status(403).json({
        error: 'This email address is not authorized by ADMIN_BOOTSTRAP_EMAIL to claim the initial Super Admin.'
      });
      return;
    }

    if (!fullName || !isValidEmail(email) || password.length < 10) {
      res.status(400).json({
        error: 'Provide a full name, valid email address, and password of at least 10 characters.'
      });
      return;
    }

    const sb = getSupabaseAdminClient();
    if (sb) {
      const { count, error: countErr } = await sb
        .from('profiles')
        .select('id', { count: 'exact', head: true })
        .eq('is_admin', true);

      if (countErr) {
        res.status(500).json({
          error: 'Unable to verify Supabase admin table. Confirm migrations 001–003 have been executed.'
        });
        return;
      }

      if ((count ?? 0) > 0) {
        res.status(409).json({
          error: 'First administrator has already been established. This one-time setup is permanently locked.'
        });
        return;
      }

      const roles = await ensureSupabaseSystemRoles(sb);
      const superRole = roles.find((r) => r.name === 'Super Admin');
      if (!superRole) {
        res.status(500).json({ error: 'Super Admin role record is missing in admin_roles.' });
        return;
      }

      const { data: createdAuth, error: authErr } = await sb.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { full_name: fullName }
      });
      if (authErr || !createdAuth.user) {
        res.status(400).json({ error: authErr?.message || 'Unable to create Supabase admin user.' });
        return;
      }

      const now = new Date().toISOString();
      const { error: upsertErr } = await sb.from('profiles').upsert({
        id: createdAuth.user.id,
        email,
        full_name: fullName,
        role_id: superRole.id,
        is_admin: true,
        account_status: 'active',
        last_login_at: now
      });

      if (upsertErr) {
        await sb.auth.admin.deleteUser(createdAuth.user.id);
        res.status(500).json({
          error: `Failed to assign Super Admin profile in Supabase: ${upsertErr.message}`
        });
        return;
      }

      await insertSupabaseAuditLog(sb, {
        actorId: createdAuth.user.id,
        actorEmail: email,
        actorRole: 'Super Admin',
        action: 'first_admin_claimed',
        entityType: 'admin_user',
        entityId: createdAuth.user.id,
        summary: `Initial Super Admin account established for ${email}.`
      });

      res.status(201).json({
        setupComplete: true,
        authMode: 'supabase',
        message: 'First Super Admin account created and verified in Supabase. Setup is now permanently locked.'
      });
      return;
    }

    const db = getDbState();
    if (db.admins.length > 0) {
      res.status(409).json({
        error: 'First administrator has already been established. This one-time setup is permanently locked.'
      });
      return;
    }

    const now = new Date().toISOString();
    const adminId = crypto.randomUUID();
    db.admins.push({
      id: adminId,
      email,
      fullName,
      phone: '',
      avatarUrl: '',
      role: 'Super Admin',
      accountStatus: 'active',
      passwordHash: hashPassword(password),
      lastLoginAt: now,
      createdAt: now,
      updatedAt: now
    });

    appendActivityLog(db, {
      actorId: adminId,
      actorEmail: email,
      actorRole: 'Super Admin',
      action: 'first_admin_claimed',
      entityType: 'admin_user',
      entityId: adminId,
      summary: `Initial Super Admin account claimed for ${email}.`
    });
    saveDbState(db);

    const token = signSessionToken(adminId, email);
    setSessionCookie(req, res, token);

    res.status(201).json({
      setupComplete: true,
      authMode: 'local',
      token,
      user: {
        id: adminId,
        email,
        fullName,
        phone: '',
        avatarUrl: '',
        role: 'Super Admin',
        accountStatus: 'active',
        permissions: getPermissionsForRole(db, 'Super Admin'),
        lastLoginAt: now,
        createdAt: now
      }
    });
  });

  router.post('/admin/auth/login', authLimiter, async (req, res) => {
    const email = sanitizeText(req.body?.email, 254).toLowerCase();
    const password = typeof req.body?.password === 'string' ? req.body.password : '';

    if (!isValidEmail(email) || !password) {
      res.status(400).json({ error: 'Email and password are required.' });
      return;
    }

    const sb = getSupabaseAdminClient();
    if (sb) {
      const sbAnon = getSupabaseAnonClient();
      if (!sbAnon) {
        res.status(500).json({
          error:
            'Supabase server mode is enabled, but VITE_SUPABASE_ANON_KEY (or SUPABASE_ANON_KEY) is not configured for password sign-in.'
        });
        return;
      }

      const { data: signInData, error: signInErr } = await sbAnon.auth.signInWithPassword({
        email,
        password
      });
      if (signInErr || !signInData.session?.access_token || !signInData.user) {
        res.status(401).json({ error: 'Invalid email or password.' });
        return;
      }

      const { data: profile } = await sb
        .from('profiles')
        .select('id, email, full_name, phone, avatar_url, is_admin, account_status, created_at, admin_roles(id, name)')
        .eq('id', signInData.user.id)
        .single();

      if (!profile || !profile.is_admin) {
        res.status(403).json({ error: 'This account does not have administrator privileges.' });
        return;
      }
      if (profile.account_status !== 'active') {
        res.status(403).json({ error: 'This administrator account is currently suspended or inactive.' });
        return;
      }

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

      const now = new Date().toISOString();
      await sb.from('profiles').update({ last_login_at: now }).eq('id', profile.id);
      await insertSupabaseAuditLog(sb, {
        actorId: profile.id,
        actorEmail: profile.email,
        actorRole: roleName,
        action: 'admin_login',
        entityType: 'admin_user',
        entityId: profile.id,
        summary: `${profile.full_name} (${roleName}) signed in.`
      });

      res.json({
        token: signInData.session.access_token,
        user: {
          id: profile.id,
          email: profile.email,
          fullName: profile.full_name,
          phone: profile.phone ?? '',
          avatarUrl: profile.avatar_url ?? '',
          role: roleName,
          accountStatus: profile.account_status,
          permissions,
          lastLoginAt: now,
          createdAt: profile.created_at
        }
      });
      return;
    }

    const db = getDbState();
    const admin = db.admins.find((a) => a.email.toLowerCase() === email);
    if (!admin || !verifyPassword(password, admin.passwordHash)) {
      res.status(401).json({ error: 'Invalid email or password.' });
      return;
    }

    if (admin.accountStatus !== 'active') {
      res.status(403).json({ error: 'This administrator account is currently suspended or inactive.' });
      return;
    }

    const now = new Date().toISOString();
    admin.lastLoginAt = now;
    admin.updatedAt = now;
    appendActivityLog(db, {
      actorId: admin.id,
      actorEmail: admin.email,
      actorRole: admin.role,
      action: 'admin_login',
      entityType: 'admin_user',
      entityId: admin.id,
      summary: `${admin.fullName} (${admin.role}) signed in.`
    });
    saveDbState(db);

    const token = signSessionToken(admin.id, admin.email);
    setSessionCookie(req, res, token);

    res.json({
      token,
      user: {
        id: admin.id,
        email: admin.email,
        fullName: admin.fullName,
        phone: admin.phone,
        avatarUrl: admin.avatarUrl,
        role: admin.role,
        accountStatus: admin.accountStatus,
        permissions: getPermissionsForRole(db, admin.role),
        lastLoginAt: admin.lastLoginAt,
        createdAt: admin.createdAt
      }
    });
  });

  router.post('/admin/auth/logout', async (req: AuthenticatedRequest, res) => {
    const resolved = await resolveAdminFromRequest(req);
    if (resolved?.jti) {
      const db = getDbState();
      db.revokedJtis.push(resolved.jti);
      if (db.revokedJtis.length > 5000) {
        db.revokedJtis.splice(0, db.revokedJtis.length - 5000);
      }
      saveDbState(db);
    }
    clearSessionCookie(req, res);
    res.json({ ok: true });
  });

  router.get('/admin/auth/me', requireAdmin, (req: AuthenticatedRequest, res) => {
    res.json({ user: req.adminUser });
  });

  router.post('/admin/auth/forgot-password', authLimiter, async (req, res) => {
    const email = sanitizeText(req.body?.email, 254).toLowerCase();
    if (!isValidEmail(email)) {
      res.status(400).json({ error: 'Please enter a valid email address.' });
      return;
    }

    const baseUrl = process.env.APP_URL?.trim() || `${req.protocol}://${req.get('host')}`;
    const sb = getSupabaseAdminClient();
    if (sb) {
      const sbAnon = getSupabaseAnonClient();
      if (sbAnon) {
        await sbAnon.auth.resetPasswordForEmail(email, {
          redirectTo: `${baseUrl.replace(/\/$/, '')}/admin/reset-password`
        });
        res.json({
          message: 'If an administrator account matches that email, Supabase has sent a password reset link.',
          emailSent: true
        });
        return;
      }
      res.json({
        message: 'Supabase anon key is not configured for self-service reset emails.',
        emailSent: false
      });
      return;
    }

    const db = getDbState();
    const admin = db.admins.find((a) => a.email.toLowerCase() === email);
    if (!admin) {
      // Do not reveal account existence
      res.json({
        message: 'If an administrator account matches that email, reset instructions have been processed.',
        emailSent: false
      });
      return;
    }

    const rawToken = crypto.randomBytes(24).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();

    db.passwordResets.push({
      id: crypto.randomUUID(),
      adminId: admin.id,
      tokenHash,
      expiresAt,
      used: false,
      createdAt: new Date().toISOString()
    });
    saveDbState(db);

    const resetUrl = `${baseUrl.replace(/\/$/, '')}/admin/reset-password?token=${rawToken}`;

    const mailResult = await sendTransactionalEmail({
      to: admin.email,
      subject: "Smoker's Lawn Care Admin — Password Reset",
      text: `Use this link within 30 minutes to reset your Admin Portal password:\n\n${resetUrl}`
    });

    if (mailResult.sent) {
      res.json({
        message: 'Password reset link has been sent to your administrator email address.',
        emailSent: true
      });
      return;
    }

    res.json({
      message:
        'No transactional email provider (RESEND_API_KEY) is configured on this server, so no email was sent.',
      emailSent: false,
      emailReason: mailResult.reason
    });
  });

  router.post('/admin/auth/reset-password', authLimiter, (req, res) => {
    const token = sanitizeText(req.body?.token, 200);
    const newPassword = typeof req.body?.newPassword === 'string' ? req.body.newPassword : '';
    if (!token || newPassword.length < 10) {
      res.status(400).json({ error: 'Valid reset token and new password (10+ characters) are required.' });
      return;
    }

    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const db = getDbState();
    const record = db.passwordResets.find(
      (r) => r.tokenHash === tokenHash && !r.used && new Date(r.expiresAt).getTime() > Date.now()
    );

    if (!record) {
      res.status(400).json({ error: 'Reset token is invalid or has expired.' });
      return;
    }

    const admin = db.admins.find((a) => a.id === record.adminId);
    if (!admin) {
      res.status(404).json({ error: 'Administrator account not found.' });
      return;
    }

    record.used = true;
    admin.passwordHash = hashPassword(newPassword);
    admin.updatedAt = new Date().toISOString();
    appendActivityLog(db, {
      actorId: admin.id,
      actorEmail: admin.email,
      actorRole: admin.role,
      action: 'password_reset_completed',
      entityType: 'admin_user',
      entityId: admin.id,
      summary: `Password reset completed for ${admin.email}.`
    });
    saveDbState(db);

    res.json({ ok: true, message: 'Password updated. You can now sign in.' });
  });

  router.post('/admin/auth/change-password', requireAdmin, (req: AuthenticatedRequest, res) => {
    const currentPassword = typeof req.body?.currentPassword === 'string' ? req.body.currentPassword : '';
    const newPassword = typeof req.body?.newPassword === 'string' ? req.body.newPassword : '';

    if (!currentPassword || newPassword.length < 10) {
      res.status(400).json({ error: 'Current password and new password (10+ characters) are required.' });
      return;
    }

    const db = getDbState();
    const admin = db.admins.find((a) => a.id === req.adminUser!.id);
    if (!admin || !verifyPassword(currentPassword, admin.passwordHash)) {
      res.status(401).json({ error: 'Current password is incorrect.' });
      return;
    }

    admin.passwordHash = hashPassword(newPassword);
    admin.updatedAt = new Date().toISOString();
    appendActivityLog(db, {
      actorId: admin.id,
      actorEmail: admin.email,
      actorRole: admin.role,
      action: 'password_changed',
      entityType: 'admin_user',
      entityId: admin.id,
      summary: `Administrator ${admin.email} changed their password.`
    });
    saveDbState(db);
    res.json({ ok: true });
  });

  // ===========================================================================
  // 3. PROTECTED ADMIN DASHBOARD & ANALYTICS
  // ===========================================================================
  router.get('/admin/dashboard', requireAdmin, requirePermission('dashboard.view'), (req, res) => {
    const range = sanitizeText(req.query.range, 20) || '30d';
    const fromStr = sanitizeText(req.query.from, 40);
    const toStr = sanitizeText(req.query.to, 40);
    const { start, end } = computeDateCutoff(range, fromStr, toStr);

    const db = getDbState();
    const inRange = (iso: string) => {
      const ts = new Date(iso).getTime();
      return ts >= start && ts <= end;
    };

    const allWOs = db.workOrders.filter((w) => !w.isArchived);
    const filteredWOs = range === 'all' ? allWOs : allWOs.filter((w) => inRange(w.createdDate));
    const filteredBids = range === 'all' ? db.bidRequests : db.bidRequests.filter((b) => inRange(b.createdAt));
    const filteredDispatch = range === 'all' ? db.dispatchRequests : db.dispatchRequests.filter((d) => inRange(d.submittedDate));

    const nowMs = Date.now();
    const upcomingCutoff = nowMs + 48 * 3600 * 1000;
    const closedStatuses = new Set<WorkOrderStatus>(['Completed', 'Cancelled', 'QC Verified']);

    const overdueWOs = allWOs.filter(
      (w) => w.slaDeadline && new Date(w.slaDeadline).getTime() < nowMs && !closedStatuses.has(w.status)
    );
    const upcomingSlaWOs = allWOs
      .filter(
        (w) =>
          w.slaDeadline &&
          new Date(w.slaDeadline).getTime() >= nowMs &&
          new Date(w.slaDeadline).getTime() <= upcomingCutoff &&
          !closedStatuses.has(w.status)
      )
      .sort((a, b) => new Date(a.slaDeadline!).getTime() - new Date(b.slaDeadline!).getTime());

    const statusCounts: Record<string, number> = {};
    const categoryCounts: Record<string, number> = {};
    const monthlyCounts: Record<string, { month: string; count: number; value: number }> = {};

    for (const wo of filteredWOs) {
      statusCounts[wo.status] = (statusCounts[wo.status] || 0) + 1;
      categoryCounts[wo.serviceCategory] = (categoryCounts[wo.serviceCategory] || 0) + 1;
      const d = new Date(wo.createdDate);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      const label = d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
      if (!monthlyCounts[key]) {
        monthlyCounts[key] = { month: label, count: 0, value: 0 };
      }
      monthlyCounts[key].count += 1;
      monthlyCounts[key].value += wo.approvedBudget ?? wo.estimatedBudget;
    }

    const totalEstimatedValue = filteredWOs.reduce((sum, w) => sum + (w.approvedBudget ?? w.estimatedBudget), 0);

    const vendorPerformance = db.vendors
      .filter((v) => v.applicationStatus === 'Approved')
      .map((v) => {
        const assigned = allWOs.filter((w) => w.assignedVendorId === v.id);
        return {
          id: v.id,
          companyName: v.companyName,
          completedWorkOrders: v.completedWorkOrders + assigned.filter((w) => closedStatuses.has(w.status)).length,
          activeAssigned: assigned.filter((w) => !closedStatuses.has(w.status)).length,
          rating: v.rating
        };
      })
      .sort((a, b) => b.completedWorkOrders - a.completedWorkOrders)
      .slice(0, 6);

    res.json({
      metrics: {
        totalWorkOrders: filteredWOs.length,
        openWorkOrders: filteredWOs.filter((w) => ['Open Bid', 'Bid Review', 'Approved', 'Dispatched', 'Scheduled'].includes(w.status)).length,
        newWorkOrders: filteredWOs.filter((w) => w.status === 'New').length,
        inProgressWorkOrders: filteredWOs.filter((w) => w.status === 'In Progress').length,
        completedWorkOrders: filteredWOs.filter((w) => w.status === 'Completed').length,
        qcVerifiedWorkOrders: filteredWOs.filter((w) => w.status === 'QC Verified').length,
        urgentDispatchRequests: filteredDispatch.filter((d) => !['Resolved', 'Closed'].includes(d.status)).length,
        pendingBidRequests: filteredBids.filter((b) => ['New', 'Pending Review', 'Estimating'].includes(b.status) && !b.isArchived).length,
        totalVendors: db.vendors.length,
        pendingVendorApplications: db.vendors.filter((v) => v.applicationStatus === 'Pending' || v.applicationStatus === 'Under Review').length,
        activeClients: db.clients.filter((c) => c.accountStatus === 'active').length,
        totalEstimatedValue,
        upcomingSlaDeadlines: upcomingSlaWOs.length,
        overdueWorkOrders: overdueWOs.length
      },
      charts: {
        statusDistribution: Object.entries(statusCounts).map(([status, count]) => ({ status, count })),
        monthlyWorkOrders: Object.entries(monthlyCounts)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([, val]) => val),
        categoryBreakdown: Object.entries(categoryCounts).map(([category, count]) => ({ category, count })),
        vendorPerformance
      },
      lists: {
        recentActivity: db.activityLogs.slice(0, 8),
        recentBidRequests: db.bidRequests.filter((b) => !b.isArchived).slice(0, 5),
        recentDispatchRequests: db.dispatchRequests.slice(0, 5),
        upcomingSlaDeadlines: upcomingSlaWOs.slice(0, 6),
        overdueWorkOrders: overdueWOs.slice(0, 6),
        recentClients: db.clients.filter((c) => c.accountStatus === 'active').slice(0, 5)
      }
    });
  });

  // ===========================================================================
  // 4. WORK ORDER MANAGEMENT
  // ===========================================================================
  router.get('/admin/work-orders', requireAdmin, requirePermission('work_orders.read'), (req, res) => {
    const db = getDbState();
    const status = sanitizeText(req.query.status, 40);
    const priority = sanitizeText(req.query.priority, 20);
    const q = sanitizeText(req.query.q, 120).toLowerCase();
    const includeArchived = req.query.archived === 'true';

    const items = db.workOrders.filter((w) => {
      if (!includeArchived && w.isArchived) return false;
      if (status && status !== 'All' && w.status !== status) return false;
      if (priority && priority !== 'All' && w.priority !== priority) return false;
      if (q) {
        const hay = `${w.workOrderCode} ${w.clientName} ${w.propertyAddress} ${w.city} ${w.state} ${w.serviceDescription} ${w.assignedVendorName}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });

    res.json({ items });
  });

  router.post('/admin/work-orders', requireAdmin, requirePermission('work_orders.write'), (req: AuthenticatedRequest, res) => {
    const clientId = sanitizeText(req.body?.clientId, 80) || null;
    const propertyAddress = sanitizeText(req.body?.propertyAddress, 240);
    const city = sanitizeText(req.body?.city, 80);
    const stateCode = sanitizeText(req.body?.state, 40);
    const serviceCategory = sanitizeText(req.body?.serviceCategory, 140);
    const serviceDescription = sanitizeText(req.body?.serviceDescription, 2000);
    const clientTypeRaw = sanitizeText(req.body?.clientType, 60) as ClientType;
    const priorityRaw = sanitizeText(req.body?.priority, 20) as PriorityLevel;
    const statusRaw = sanitizeText(req.body?.status, 40) as WorkOrderStatus;

    if (!propertyAddress || !city || !stateCode || !serviceCategory || !serviceDescription) {
      res.status(400).json({ error: 'Property address, city, state, service category, and description are required.' });
      return;
    }

    const db = getDbState();
    const linkedClient = clientId ? db.clients.find((c) => c.id === clientId) : undefined;
    const vendorId = sanitizeText(req.body?.assignedVendorId, 80) || null;
    const linkedVendor = vendorId ? db.vendors.find((v) => v.id === vendorId) : undefined;

    const now = new Date().toISOString();
    const code = `SLC-${new Date().getFullYear().toString().slice(-2)}-${Math.floor(4200 + Math.random() * 5700)}`;
    const id = crypto.randomUUID();
    const wo = {
      id,
      workOrderCode: code,
      clientId: linkedClient?.id ?? null,
      clientName: linkedClient?.companyName || linkedClient?.contactName || sanitizeText(req.body?.clientName, 140) || 'Direct Client',
      clientType: CLIENT_TYPES.includes(clientTypeRaw) ? clientTypeRaw : 'Property Manager',
      propertyAddress,
      city,
      state: stateCode,
      zipCode: sanitizeText(req.body?.zipCode, 20),
      county: sanitizeText(req.body?.county, 80),
      lat: req.body?.lat != null && req.body.lat !== '' ? Number(req.body.lat) : null,
      lng: req.body?.lng != null && req.body.lng !== '' ? Number(req.body.lng) : null,
      serviceCategory,
      serviceDescription,
      priority: PRIORITY_LEVELS.includes(priorityRaw) ? priorityRaw : db.businessSettings.defaultWoPriority,
      estimatedBudget: Number(req.body?.estimatedBudget) || 0,
      approvedBudget: req.body?.approvedBudget != null && req.body.approvedBudget !== '' ? Number(req.body.approvedBudget) : null,
      assignedVendorId: linkedVendor?.id ?? null,
      assignedVendorName: linkedVendor?.companyName ?? '',
      createdDate: now,
      scheduledDate: sanitizeText(req.body?.scheduledDate, 40) || null,
      slaDeadline:
        sanitizeText(req.body?.slaDeadline, 40) ||
        new Date(Date.now() + db.businessSettings.defaultSlaHours * 3600 * 1000).toISOString(),
      completionDate: null,
      status: WORK_ORDER_STATUSES.includes(statusRaw) ? statusRaw : (linkedVendor ? 'Dispatched' : 'New'),
      qcNotes: '',
      isArchived: false,
      isDemo: false,
      updatedAt: now
    };

    db.workOrders.unshift(wo);
    appendWorkOrderTimeline(db, wo.id, req.adminUser!.fullName, 'created', `Work order ${code} created (${wo.status}).`);
    appendNotification(db, {
      eventType: 'new_work_order',
      title: `Work Order ${code} Created`,
      message: `${wo.serviceCategory} at ${wo.propertyAddress}, ${wo.city}, ${wo.state}.`,
      entityType: 'work_order',
      entityId: wo.id
    });
    appendActivityLog(db, {
      actorId: req.adminUser!.id,
      actorEmail: req.adminUser!.email,
      actorRole: req.adminUser!.role,
      action: 'work_order_created',
      entityType: 'work_order',
      entityId: wo.id,
      summary: `Created work order ${code} for ${wo.propertyAddress}.`
    });
    saveDbState(db);

    res.status(201).json({ item: wo });
  });

  router.get('/admin/work-orders/:id', requireAdmin, requirePermission('work_orders.read'), (req, res) => {
    const db = getDbState();
    const wo = db.workOrders.find((w) => w.id === req.params.id || w.workOrderCode === req.params.id);
    if (!wo) {
      res.status(404).json({ error: 'Work order not found.' });
      return;
    }

    const client = wo.clientId ? db.clients.find((c) => c.id === wo.clientId) ?? null : null;
    const vendor = wo.assignedVendorId ? db.vendors.find((v) => v.id === wo.assignedVendorId) ?? null : null;
    const notes = db.workOrderNotes.filter((n) => n.workOrderId === wo.id);
    const attachments = db.workOrderAttachments.filter((a) => a.workOrderId === wo.id);
    const timeline = db.workOrderTimeline.filter((t) => t.workOrderId === wo.id);
    const bids = db.vendorBids.filter((b) => b.workOrderId === wo.id);
    const activity = db.activityLogs.filter((l) => l.entityType === 'work_order' && l.entityId === wo.id);

    res.json({ item: wo, client, vendor, notes, attachments, timeline, bids, activity });
  });

  router.patch('/admin/work-orders/:id', requireAdmin, requirePermission('work_orders.write'), (req: AuthenticatedRequest, res) => {
    const db = getDbState();
    const wo = db.workOrders.find((w) => w.id === req.params.id);
    if (!wo) {
      res.status(404).json({ error: 'Work order not found.' });
      return;
    }

    const prevStatus = wo.status;
    if (req.body?.clientName !== undefined) wo.clientName = sanitizeText(req.body.clientName, 140);
    if (req.body?.clientId !== undefined) {
      const cid = sanitizeText(req.body.clientId, 80) || null;
      wo.clientId = cid;
      if (cid) {
        const c = db.clients.find((cl) => cl.id === cid);
        if (c) {
          wo.clientName = c.companyName || c.contactName;
          wo.clientType = c.clientType;
        }
      }
    }
    if (req.body?.clientType && CLIENT_TYPES.includes(req.body.clientType)) wo.clientType = req.body.clientType;
    if (req.body?.propertyAddress !== undefined) wo.propertyAddress = sanitizeText(req.body.propertyAddress, 240);
    if (req.body?.city !== undefined) wo.city = sanitizeText(req.body.city, 80);
    if (req.body?.state !== undefined) wo.state = sanitizeText(req.body.state, 40);
    if (req.body?.zipCode !== undefined) wo.zipCode = sanitizeText(req.body.zipCode, 20);
    if (req.body?.county !== undefined) wo.county = sanitizeText(req.body.county, 80);
    if (req.body?.serviceCategory !== undefined) wo.serviceCategory = sanitizeText(req.body.serviceCategory, 140);
    if (req.body?.serviceDescription !== undefined) wo.serviceDescription = sanitizeText(req.body.serviceDescription, 2000);
    if (req.body?.priority && PRIORITY_LEVELS.includes(req.body.priority)) wo.priority = req.body.priority;
    if (req.body?.estimatedBudget !== undefined) wo.estimatedBudget = Number(req.body.estimatedBudget) || 0;
    if (req.body?.approvedBudget !== undefined) {
      wo.approvedBudget = req.body.approvedBudget === null || req.body.approvedBudget === '' ? null : Number(req.body.approvedBudget);
    }
    if (req.body?.scheduledDate !== undefined) wo.scheduledDate = req.body.scheduledDate || null;
    if (req.body?.slaDeadline !== undefined) wo.slaDeadline = req.body.slaDeadline || null;
    if (req.body?.status && WORK_ORDER_STATUSES.includes(req.body.status)) {
      wo.status = req.body.status;
      if (wo.status === 'Completed' || wo.status === 'QC Verified') {
        wo.completionDate = wo.completionDate || new Date().toISOString();
      }
    }
    if (req.body?.assignedVendorId !== undefined) {
      const vid = sanitizeText(req.body.assignedVendorId, 80) || null;
      wo.assignedVendorId = vid;
      const v = vid ? db.vendors.find((vnd) => vnd.id === vid) : undefined;
      wo.assignedVendorName = v ? v.companyName : '';
    }
    if (req.body?.isArchived !== undefined) wo.isArchived = Boolean(req.body.isArchived);
    wo.updatedAt = new Date().toISOString();

    if (wo.status !== prevStatus) {
      appendWorkOrderTimeline(
        db,
        wo.id,
        req.adminUser!.fullName,
        'status_changed',
        `Status changed from ${prevStatus} to ${wo.status}.`
      );
      if (wo.status === 'Submitted for QC' || wo.status === 'Completed') {
        appendNotification(db, {
          eventType: wo.status === 'Completed' ? 'work_order_completed' : 'work_order_qc_submitted',
          title: `${wo.workOrderCode}: ${wo.status}`,
          message: `${wo.serviceCategory} at ${wo.propertyAddress} is now ${wo.status}.`,
          entityType: 'work_order',
          entityId: wo.id
        });
      }
    }

    appendActivityLog(db, {
      actorId: req.adminUser!.id,
      actorEmail: req.adminUser!.email,
      actorRole: req.adminUser!.role,
      action: 'work_order_updated',
      entityType: 'work_order',
      entityId: wo.id,
      summary: `Updated work order ${wo.workOrderCode} (${wo.status}).`
    });
    saveDbState(db);

    res.json({ item: wo });
  });

  router.post('/admin/work-orders/:id/qc', requireAdmin, requirePermission('work_orders.qc'), (req: AuthenticatedRequest, res) => {
    const decision = sanitizeText(req.body?.decision, 20);
    const qcNotes = sanitizeText(req.body?.qcNotes, 2000);
    if (!['approve', 'reject'].includes(decision)) {
      res.status(400).json({ error: 'QC decision must be approve or reject.' });
      return;
    }

    const db = getDbState();
    const wo = db.workOrders.find((w) => w.id === req.params.id);
    if (!wo) {
      res.status(404).json({ error: 'Work order not found.' });
      return;
    }

    wo.status = decision === 'approve' ? 'QC Verified' : 'QC Rejected';
    wo.qcNotes = qcNotes;
    if (decision === 'approve') {
      wo.completionDate = wo.completionDate || new Date().toISOString();
    }
    wo.updatedAt = new Date().toISOString();

    appendWorkOrderTimeline(
      db,
      wo.id,
      req.adminUser!.fullName,
      decision === 'approve' ? 'qc_approved' : 'qc_rejected',
      `QC ${decision === 'approve' ? 'Approved (QC Verified)' : 'Rejected'}${qcNotes ? `: ${qcNotes}` : '.'}`
    );
    if (decision === 'reject') {
      appendNotification(db, {
        eventType: 'qc_rejected',
        title: `QC Rejected: ${wo.workOrderCode}`,
        message: qcNotes || 'Corrections required on work order.',
        entityType: 'work_order',
        entityId: wo.id
      });
    }
    appendActivityLog(db, {
      actorId: req.adminUser!.id,
      actorEmail: req.adminUser!.email,
      actorRole: req.adminUser!.role,
      action: `work_order_qc_${decision}`,
      entityType: 'work_order',
      entityId: wo.id,
      summary: `QC ${decision} on ${wo.workOrderCode}.`
    });
    saveDbState(db);
    res.json({ item: wo });
  });

  router.post('/admin/work-orders/:id/notes', requireAdmin, requirePermission('work_orders.write'), (req: AuthenticatedRequest, res) => {
    const body = sanitizeText(req.body?.body, 2500);
    const isInternal = req.body?.isInternal !== false;
    if (!body) {
      res.status(400).json({ error: 'Note text is required.' });
      return;
    }

    const db = getDbState();
    const wo = db.workOrders.find((w) => w.id === req.params.id);
    if (!wo) {
      res.status(404).json({ error: 'Work order not found.' });
      return;
    }

    const note = {
      id: crypto.randomUUID(),
      workOrderId: wo.id,
      authorName: req.adminUser!.fullName,
      isInternal,
      body,
      createdAt: new Date().toISOString()
    };
    db.workOrderNotes.unshift(note);
    appendWorkOrderTimeline(
      db,
      wo.id,
      req.adminUser!.fullName,
      'note_added',
      `Added ${isInternal ? 'internal' : 'client-visible'} note.`
    );
    saveDbState(db);
    res.status(201).json({ item: note });
  });

  router.post(
    '/admin/work-orders/:id/attachments',
    requireAdmin,
    requirePermission('work_orders.write'),
    uploadAttachmentMiddleware.single('file'),
    async (req: AuthenticatedRequest, res) => {
      try {
        const db = getDbState();
        const wo = db.workOrders.find((w) => w.id === req.params.id);
        if (!wo) {
          res.status(404).json({ error: 'Work order not found.' });
          return;
        }
        if (!req.file) {
          res.status(400).json({ error: 'File is required.' });
          return;
        }
        const kindRaw = sanitizeText(req.body?.kind, 30);
        const kind = ['document', 'before_photo', 'after_photo'].includes(kindRaw)
          ? (kindRaw as 'document' | 'before_photo' | 'after_photo')
          : 'document';

        const { storagePath } = await persistUploadedFile('work-order-attachments', req.file);
        const attachment = {
          id: crypto.randomUUID(),
          workOrderId: wo.id,
          kind,
          fileName: sanitizeText(req.file.originalname, 180),
          storageBucket: 'work-order-attachments',
          storagePath,
          mimeType: req.file.mimetype,
          fileSize: req.file.size,
          uploadedBy: req.adminUser!.fullName,
          createdAt: new Date().toISOString()
        };

        db.workOrderAttachments.unshift(attachment);
        appendWorkOrderTimeline(
          db,
          wo.id,
          req.adminUser!.fullName,
          'attachment_uploaded',
          `Uploaded ${kind.replace('_', ' ')}: ${attachment.fileName}.`
        );
        saveDbState(db);
        res.status(201).json({ item: attachment });
      } catch (err) {
        res.status(400).json({ error: err instanceof Error ? err.message : 'Upload failed.' });
      }
    }
  );

  router.delete('/admin/work-orders/:id', requireAdmin, requirePermission('work_orders.delete'), (req: AuthenticatedRequest, res) => {
    const db = getDbState();
    const idx = db.workOrders.findIndex((w) => w.id === req.params.id);
    if (idx === -1) {
      res.status(404).json({ error: 'Work order not found.' });
      return;
    }
    const [removed] = db.workOrders.splice(idx, 1);
    appendActivityLog(db, {
      actorId: req.adminUser!.id,
      actorEmail: req.adminUser!.email,
      actorRole: req.adminUser!.role,
      action: 'work_order_deleted',
      entityType: 'work_order',
      entityId: removed.id,
      summary: `Permanently deleted work order ${removed.workOrderCode}.`
    });
    saveDbState(db);
    res.json({ ok: true });
  });

  // ===========================================================================
  // 5. VENDOR MANAGEMENT
  // ===========================================================================
  router.get('/admin/vendors', requireAdmin, requirePermission('vendors.read'), (req, res) => {
    const db = getDbState();
    const status = sanitizeText(req.query.status, 40);
    const q = sanitizeText(req.query.q, 120).toLowerCase();

    const items = db.vendors.filter((v) => {
      if (status && status !== 'All' && v.applicationStatus !== status) return false;
      if (q) {
        const hay = `${v.vendorCode} ${v.companyName} ${v.contactPerson} ${v.email} ${v.coverageAreas} ${v.aspenGroveAbc}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
    res.json({ items });
  });

  router.post('/admin/vendors', requireAdmin, requirePermission('vendors.write'), (req: AuthenticatedRequest, res) => {
    const companyName = sanitizeText(req.body?.companyName, 140);
    const contactPerson = sanitizeText(req.body?.contactPerson, 120);
    const email = sanitizeText(req.body?.email, 254).toLowerCase();
    const phone = sanitizeText(req.body?.phone, 40);
    if (!companyName || !contactPerson || !isValidEmail(email) || !phone) {
      res.status(400).json({ error: 'Company name, contact person, valid email, and phone are required.' });
      return;
    }

    const db = getDbState();
    const now = new Date().toISOString();
    const appStatus = VENDOR_APPLICATION_STATUSES.includes(req.body?.applicationStatus)
      ? (req.body.applicationStatus as VendorApplicationStatus)
      : 'Approved';

    const vendor = {
      id: crypto.randomUUID(),
      vendorCode: `VND-${Math.floor(10000 + Math.random() * 89999)}`,
      companyName,
      contactPerson,
      email,
      phone,
      address: sanitizeText(req.body?.address, 200),
      city: sanitizeText(req.body?.city, 80),
      state: sanitizeText(req.body?.state, 40),
      zipCode: sanitizeText(req.body?.zipCode, 20),
      serviceCategories: Array.isArray(req.body?.serviceCategories)
        ? req.body.serviceCategories.map((s: unknown) => sanitizeText(s, 80)).filter(Boolean)
        : [],
      coverageAreas: sanitizeText(req.body?.coverageAreas, 200),
      counties: Array.isArray(req.body?.counties)
        ? req.body.counties.map((c: unknown) => sanitizeText(c, 80)).filter(Boolean)
        : [],
      licenseInfo: sanitizeText(req.body?.licenseInfo, 160),
      insuranceInfo: sanitizeText(req.body?.insuranceInfo, 160),
      aspenGroveAbc: sanitizeText(req.body?.aspenGroveAbc, 60),
      applicationStatus: appStatus,
      accountStatus:
        appStatus === 'Approved' ? ('active' as const) : appStatus === 'Suspended' ? ('suspended' as const) : ('pending' as const),
      rating: null,
      completedWorkOrders: 0,
      notes: sanitizeText(req.body?.notes, 2000),
      isDemo: false,
      registrationDate: now,
      updatedAt: now
    };

    db.vendors.unshift(vendor);
    appendActivityLog(db, {
      actorId: req.adminUser!.id,
      actorEmail: req.adminUser!.email,
      actorRole: req.adminUser!.role,
      action: 'vendor_created',
      entityType: 'vendor',
      entityId: vendor.id,
      summary: `Created vendor ${vendor.companyName} (${vendor.vendorCode}).`
    });
    saveDbState(db);
    res.status(201).json({ item: vendor });
  });

  router.get('/admin/vendors/:id', requireAdmin, requirePermission('vendors.read'), (req, res) => {
    const db = getDbState();
    const vendor = db.vendors.find((v) => v.id === req.params.id || v.vendorCode === req.params.id);
    if (!vendor) {
      res.status(404).json({ error: 'Vendor not found.' });
      return;
    }

    const workOrders = db.workOrders.filter((w) => w.assignedVendorId === vendor.id);
    const bids = db.vendorBids.filter((b) => b.vendorId === vendor.id || b.vendorName === vendor.companyName);
    const documents = db.vendorDocuments.filter((d) => d.vendorId === vendor.id);
    const activity = db.activityLogs.filter((l) => l.entityType === 'vendor' && l.entityId === vendor.id);

    res.json({ item: vendor, workOrders, bids, documents, activity });
  });

  router.patch('/admin/vendors/:id', requireAdmin, requirePermission('vendors.write'), (req: AuthenticatedRequest, res) => {
    const db = getDbState();
    const vendor = db.vendors.find((v) => v.id === req.params.id);
    if (!vendor) {
      res.status(404).json({ error: 'Vendor not found.' });
      return;
    }

    if (req.body?.companyName !== undefined) vendor.companyName = sanitizeText(req.body.companyName, 140);
    if (req.body?.contactPerson !== undefined) vendor.contactPerson = sanitizeText(req.body.contactPerson, 120);
    if (req.body?.email !== undefined && isValidEmail(req.body.email)) vendor.email = sanitizeText(req.body.email, 254).toLowerCase();
    if (req.body?.phone !== undefined) vendor.phone = sanitizeText(req.body.phone, 40);
    if (req.body?.address !== undefined) vendor.address = sanitizeText(req.body.address, 200);
    if (req.body?.city !== undefined) vendor.city = sanitizeText(req.body.city, 80);
    if (req.body?.state !== undefined) vendor.state = sanitizeText(req.body.state, 40);
    if (req.body?.zipCode !== undefined) vendor.zipCode = sanitizeText(req.body.zipCode, 20);
    if (Array.isArray(req.body?.serviceCategories)) {
      vendor.serviceCategories = req.body.serviceCategories.map((s: unknown) => sanitizeText(s, 80)).filter(Boolean);
    }
    if (req.body?.coverageAreas !== undefined) vendor.coverageAreas = sanitizeText(req.body.coverageAreas, 200);
    if (Array.isArray(req.body?.counties)) {
      vendor.counties = req.body.counties.map((c: unknown) => sanitizeText(c, 80)).filter(Boolean);
    }
    if (req.body?.licenseInfo !== undefined) vendor.licenseInfo = sanitizeText(req.body.licenseInfo, 160);
    if (req.body?.insuranceInfo !== undefined) vendor.insuranceInfo = sanitizeText(req.body.insuranceInfo, 160);
    if (req.body?.aspenGroveAbc !== undefined) vendor.aspenGroveAbc = sanitizeText(req.body.aspenGroveAbc, 60);
    if (req.body?.notes !== undefined) vendor.notes = sanitizeText(req.body.notes, 2000);
    vendor.updatedAt = new Date().toISOString();

    appendActivityLog(db, {
      actorId: req.adminUser!.id,
      actorEmail: req.adminUser!.email,
      actorRole: req.adminUser!.role,
      action: 'vendor_updated',
      entityType: 'vendor',
      entityId: vendor.id,
      summary: `Updated profile for vendor ${vendor.companyName}.`
    });
    saveDbState(db);
    res.json({ item: vendor });
  });

  router.post('/admin/vendors/:id/status', requireAdmin, requirePermission('vendors.approve'), (req: AuthenticatedRequest, res) => {
    const status = sanitizeText(req.body?.applicationStatus, 40) as VendorApplicationStatus;
    if (!VENDOR_APPLICATION_STATUSES.includes(status)) {
      res.status(400).json({ error: 'Invalid vendor status.' });
      return;
    }

    const db = getDbState();
    const vendor = db.vendors.find((v) => v.id === req.params.id);
    if (!vendor) {
      res.status(404).json({ error: 'Vendor not found.' });
      return;
    }

    vendor.applicationStatus = status;
    vendor.accountStatus = status === 'Approved' ? 'active' : status === 'Suspended' || status === 'Rejected' ? 'suspended' : 'pending';
    vendor.updatedAt = new Date().toISOString();

    appendActivityLog(db, {
      actorId: req.adminUser!.id,
      actorEmail: req.adminUser!.email,
      actorRole: req.adminUser!.role,
      action: 'vendor_status_changed',
      entityType: 'vendor',
      entityId: vendor.id,
      summary: `Set vendor ${vendor.companyName} status to ${status}.`
    });
    saveDbState(db);
    res.json({ item: vendor });
  });

  router.post(
    '/admin/vendors/:id/documents',
    requireAdmin,
    requirePermission('vendors.write'),
    uploadAttachmentMiddleware.single('file'),
    async (req: AuthenticatedRequest, res) => {
      try {
        const db = getDbState();
        const vendor = db.vendors.find((v) => v.id === req.params.id);
        if (!vendor) {
          res.status(404).json({ error: 'Vendor not found.' });
          return;
        }
        if (!req.file) {
          res.status(400).json({ error: 'Document file is required.' });
          return;
        }
        const { storagePath } = await persistUploadedFile('vendor-documents', req.file);
        const doc = {
          id: crypto.randomUUID(),
          vendorId: vendor.id,
          docType: sanitizeText(req.body?.docType, 80) || 'Compliance Document',
          fileName: sanitizeText(req.file.originalname, 180),
          storageBucket: 'vendor-documents',
          storagePath,
          mimeType: req.file.mimetype,
          fileSize: req.file.size,
          verified: true,
          expiresAt: sanitizeText(req.body?.expiresAt, 30) || null,
          createdAt: new Date().toISOString()
        };
        db.vendorDocuments.unshift(doc);
        appendActivityLog(db, {
          actorId: req.adminUser!.id,
          actorEmail: req.adminUser!.email,
          actorRole: req.adminUser!.role,
          action: 'vendor_document_uploaded',
          entityType: 'vendor',
          entityId: vendor.id,
          summary: `Uploaded ${doc.docType} (${doc.fileName}) for ${vendor.companyName}.`
        });
        saveDbState(db);
        res.status(201).json({ item: doc });
      } catch (err) {
        res.status(400).json({ error: err instanceof Error ? err.message : 'Upload failed.' });
      }
    }
  );

  // ===========================================================================
  // 6. CLIENT MANAGEMENT
  // ===========================================================================
  router.get('/admin/clients', requireAdmin, requirePermission('clients.read'), (req, res) => {
    const db = getDbState();
    const status = sanitizeText(req.query.status, 30);
    const clientType = sanitizeText(req.query.clientType, 60);
    const q = sanitizeText(req.query.q, 120).toLowerCase();

    const items = db.clients.filter((c) => {
      if (status && status !== 'All' && c.accountStatus !== status) return false;
      if (clientType && clientType !== 'All' && c.clientType !== clientType) return false;
      if (q) {
        const hay = `${c.clientCode} ${c.companyName} ${c.contactName} ${c.email} ${c.phone}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
    res.json({ items });
  });

  router.post('/admin/clients', requireAdmin, requirePermission('clients.write'), (req: AuthenticatedRequest, res) => {
    const contactName = sanitizeText(req.body?.contactName, 120);
    const email = sanitizeText(req.body?.email, 254).toLowerCase();
    const phone = sanitizeText(req.body?.phone, 40);
    const clientType = sanitizeText(req.body?.clientType, 60) as ClientType;

    if (!contactName || !isValidEmail(email) || !phone) {
      res.status(400).json({ error: 'Contact name, valid email, and phone are required.' });
      return;
    }

    const db = getDbState();
    const now = new Date().toISOString();
    const client = {
      id: crypto.randomUUID(),
      clientCode: `CLI-${Math.floor(1100 + Math.random() * 8800)}`,
      companyName: sanitizeText(req.body?.companyName, 140),
      contactName,
      email,
      phone,
      clientType: CLIENT_TYPES.includes(clientType) ? clientType : 'Property Manager',
      address: sanitizeText(req.body?.address, 240),
      notes: sanitizeText(req.body?.notes, 2000),
      accountStatus: 'active' as const,
      isDemo: false,
      createdAt: now,
      updatedAt: now
    };
    db.clients.unshift(client);
    appendActivityLog(db, {
      actorId: req.adminUser!.id,
      actorEmail: req.adminUser!.email,
      actorRole: req.adminUser!.role,
      action: 'client_created',
      entityType: 'client',
      entityId: client.id,
      summary: `Created client ${client.companyName || client.contactName} (${client.clientCode}).`
    });
    saveDbState(db);
    res.status(201).json({ item: client });
  });

  router.get('/admin/clients/:id', requireAdmin, requirePermission('clients.read'), (req, res) => {
    const db = getDbState();
    const client = db.clients.find((c) => c.id === req.params.id || c.clientCode === req.params.id);
    if (!client) {
      res.status(404).json({ error: 'Client not found.' });
      return;
    }

    const workOrders = db.workOrders.filter((w) => w.clientId === client.id);
    const bidRequests = db.bidRequests.filter((b) => b.email.toLowerCase() === client.email.toLowerCase());
    const messages = db.messages.filter(
      (m) => m.linkedClientId === client.id || m.senderEmail.toLowerCase() === client.email.toLowerCase()
    );
    const properties = db.clientProperties.filter((p) => p.clientId === client.id);

    res.json({ item: client, workOrders, bidRequests, messages, properties });
  });

  router.patch('/admin/clients/:id', requireAdmin, requirePermission('clients.write'), (req: AuthenticatedRequest, res) => {
    const db = getDbState();
    const client = db.clients.find((c) => c.id === req.params.id);
    if (!client) {
      res.status(404).json({ error: 'Client not found.' });
      return;
    }

    if (req.body?.companyName !== undefined) client.companyName = sanitizeText(req.body.companyName, 140);
    if (req.body?.contactName !== undefined) client.contactName = sanitizeText(req.body.contactName, 120);
    if (req.body?.email && isValidEmail(req.body.email)) client.email = sanitizeText(req.body.email, 254).toLowerCase();
    if (req.body?.phone !== undefined) client.phone = sanitizeText(req.body.phone, 40);
    if (req.body?.clientType && CLIENT_TYPES.includes(req.body.clientType)) client.clientType = req.body.clientType;
    if (req.body?.address !== undefined) client.address = sanitizeText(req.body.address, 240);
    if (req.body?.notes !== undefined) client.notes = sanitizeText(req.body.notes, 2000);
    if (req.body?.accountStatus && ['active', 'archived'].includes(req.body.accountStatus)) {
      client.accountStatus = req.body.accountStatus;
    }
    client.updatedAt = new Date().toISOString();

    appendActivityLog(db, {
      actorId: req.adminUser!.id,
      actorEmail: req.adminUser!.email,
      actorRole: req.adminUser!.role,
      action: 'client_updated',
      entityType: 'client',
      entityId: client.id,
      summary: `Updated client ${client.companyName || client.contactName} (${client.accountStatus}).`
    });
    saveDbState(db);
    res.json({ item: client });
  });

  router.post('/admin/clients/:id/properties', requireAdmin, requirePermission('clients.write'), (req: AuthenticatedRequest, res) => {
    const address = sanitizeText(req.body?.address, 240);
    if (!address) {
      res.status(400).json({ error: 'Property address is required.' });
      return;
    }
    const db = getDbState();
    const client = db.clients.find((c) => c.id === req.params.id);
    if (!client) {
      res.status(404).json({ error: 'Client not found.' });
      return;
    }

    const prop = {
      id: crypto.randomUUID(),
      clientId: client.id,
      address,
      city: sanitizeText(req.body?.city, 80),
      state: sanitizeText(req.body?.state, 40),
      zipCode: sanitizeText(req.body?.zipCode, 20),
      county: sanitizeText(req.body?.county, 80),
      lat: req.body?.lat != null && req.body.lat !== '' ? Number(req.body.lat) : null,
      lng: req.body?.lng != null && req.body.lng !== '' ? Number(req.body.lng) : null,
      occupancyStatus: sanitizeText(req.body?.occupancyStatus, 40) || 'Vacant',
      lockboxCode: sanitizeText(req.body?.lockboxCode, 40),
      notes: sanitizeText(req.body?.notes, 500),
      createdAt: new Date().toISOString()
    };
    db.clientProperties.unshift(prop);
    saveDbState(db);
    res.status(201).json({ item: prop });
  });

  // ===========================================================================
  // 7. BID REQUESTS & VENDOR BIDS MANAGEMENT
  // ===========================================================================
  router.get('/admin/bid-requests', requireAdmin, requirePermission('bid_requests.read'), (req, res) => {
    const db = getDbState();
    const status = sanitizeText(req.query.status, 40);
    const q = sanitizeText(req.query.q, 120).toLowerCase();
    const items = db.bidRequests.filter((b) => {
      if (status && status !== 'All' && b.status !== status) return false;
      if (q) {
        const hay = `${b.requestCode} ${b.contactName} ${b.email} ${b.propertyAddress} ${b.requestedServices}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
    res.json({ items });
  });

  router.get('/admin/bid-requests/:id', requireAdmin, requirePermission('bid_requests.read'), (req, res) => {
    const db = getDbState();
    const item = db.bidRequests.find((b) => b.id === req.params.id || b.requestCode === req.params.id);
    if (!item) {
      res.status(404).json({ error: 'Bid request not found.' });
      return;
    }
    const activity = db.activityLogs.filter((l) => l.entityType === 'bid_request' && l.entityId === item.id);
    res.json({ item, activity });
  });

  router.patch('/admin/bid-requests/:id', requireAdmin, requirePermission('bid_requests.write'), (req: AuthenticatedRequest, res) => {
    const db = getDbState();
    const item = db.bidRequests.find((b) => b.id === req.params.id);
    if (!item) {
      res.status(404).json({ error: 'Bid request not found.' });
      return;
    }
    if (req.body?.status && BID_REQUEST_STATUSES.includes(req.body.status)) {
      item.status = req.body.status;
      if (req.body.status === 'Archived') item.isArchived = true;
    }
    if (req.body?.internalNotes !== undefined) item.internalNotes = sanitizeText(req.body.internalNotes, 2000);
    if (req.body?.isArchived !== undefined) item.isArchived = Boolean(req.body.isArchived);
    item.updatedAt = new Date().toISOString();

    appendActivityLog(db, {
      actorId: req.adminUser!.id,
      actorEmail: req.adminUser!.email,
      actorRole: req.adminUser!.role,
      action: 'bid_request_updated',
      entityType: 'bid_request',
      entityId: item.id,
      summary: `Updated bid request ${item.requestCode} status to ${item.status}.`
    });
    saveDbState(db);
    res.json({ item });
  });

  router.post('/admin/bid-requests/:id/convert', requireAdmin, requirePermission('bid_requests.convert'), (req: AuthenticatedRequest, res) => {
    const db = getDbState();
    const bidReq = db.bidRequests.find((b) => b.id === req.params.id);
    if (!bidReq) {
      res.status(404).json({ error: 'Bid request not found.' });
      return;
    }
    if (bidReq.convertedWorkOrderId) {
      res.status(409).json({ error: 'Bid request has already been converted to a Work Order.' });
      return;
    }

    // Find or create client record
    let client = db.clients.find((c) => c.email.toLowerCase() === bidReq.email.toLowerCase());
    const now = new Date().toISOString();
    if (!client) {
      client = {
        id: crypto.randomUUID(),
        clientCode: `CLI-${Math.floor(1100 + Math.random() * 8800)}`,
        companyName: '',
        contactName: bidReq.contactName,
        email: bidReq.email,
        phone: bidReq.phone,
        clientType: 'Property Manager',
        address: bidReq.propertyAddress,
        notes: `Created automatically from bid request ${bidReq.requestCode}.`,
        accountStatus: 'active',
        isDemo: false,
        createdAt: now,
        updatedAt: now
      };
      db.clients.unshift(client);
    }

    const code = `SLC-${new Date().getFullYear().toString().slice(-2)}-${Math.floor(4200 + Math.random() * 5700)}`;
    const estimatedBudget =
      Number(req.body?.estimatedBudget) ||
      (bidReq.estimatorData ? Math.round((bidReq.estimatorData.lowEstimate + bidReq.estimatorData.highEstimate) / 2) : 350);
    const woId = crypto.randomUUID();
    const parts = bidReq.propertyAddress.split(',').map((s) => s.trim());

    const wo = {
      id: woId,
      workOrderCode: code,
      clientId: client.id,
      clientName: client.companyName || client.contactName,
      clientType: client.clientType,
      propertyAddress: parts[0] || bidReq.propertyAddress,
      city: bidReq.city || parts[1] || 'Indianapolis',
      state: bidReq.state || parts[2]?.slice(0, 2) || 'IN',
      zipCode: bidReq.zipCode || '',
      county: sanitizeText(req.body?.county, 80),
      lat: null,
      lng: null,
      serviceCategory: bidReq.requestedServices,
      serviceDescription: bidReq.notes || bidReq.requestedServices,
      priority: (PRIORITY_LEVELS.includes(req.body?.priority) ? req.body.priority : 'Normal') as PriorityLevel,
      estimatedBudget,
      approvedBudget: null,
      assignedVendorId: null,
      assignedVendorName: '',
      createdDate: now,
      scheduledDate: null,
      slaDeadline: new Date(Date.now() + db.businessSettings.defaultSlaHours * 3600 * 1000).toISOString(),
      completionDate: null,
      status: 'Open Bid' as WorkOrderStatus,
      qcNotes: '',
      isArchived: false,
      isDemo: false,
      updatedAt: now
    };

    db.workOrders.unshift(wo);
    bidReq.status = 'Converted';
    bidReq.convertedWorkOrderId = wo.id;
    bidReq.updatedAt = now;

    appendWorkOrderTimeline(
      db,
      wo.id,
      req.adminUser!.fullName,
      'converted_from_bid',
      `Work order ${code} converted from customer bid request ${bidReq.requestCode}.`
    );
    appendActivityLog(db, {
      actorId: req.adminUser!.id,
      actorEmail: req.adminUser!.email,
      actorRole: req.adminUser!.role,
      action: 'bid_request_converted',
      entityType: 'bid_request',
      entityId: bidReq.id,
      summary: `Converted bid request ${bidReq.requestCode} into Work Order ${code}.`
    });
    saveDbState(db);

    res.status(201).json({ bidRequest: bidReq, workOrder: wo });
  });

  router.get('/admin/vendor-bids', requireAdmin, requirePermission('vendor_bids.read'), (req, res) => {
    const db = getDbState();
    const workOrderId = sanitizeText(req.query.workOrderId, 80);
    const status = sanitizeText(req.query.status, 40);
    const items = db.vendorBids.filter((b) => {
      if (workOrderId && b.workOrderId !== workOrderId) return false;
      if (status && status !== 'All' && b.status !== status) return false;
      return true;
    });
    res.json({ items });
  });

  router.post('/admin/vendor-bids/:id/decide', requireAdmin, requirePermission('vendor_bids.decide'), (req: AuthenticatedRequest, res) => {
    const decision = sanitizeText(req.body?.decision, 30);
    const note = sanitizeText(req.body?.clarificationNote, 1000);
    if (!['accept', 'reject', 'clarify'].includes(decision)) {
      res.status(400).json({ error: 'Decision must be accept, reject, or clarify.' });
      return;
    }

    const db = getDbState();
    const bid = db.vendorBids.find((b) => b.id === req.params.id);
    if (!bid) {
      res.status(404).json({ error: 'Vendor bid not found.' });
      return;
    }

    const now = new Date().toISOString();
    if (decision === 'accept') {
      bid.status = 'Accepted';
      const wo = db.workOrders.find((w) => w.id === bid.workOrderId);
      if (wo) {
        wo.assignedVendorId = bid.vendorId;
        wo.assignedVendorName = bid.vendorName;
        wo.approvedBudget = bid.proposedPrice;
        wo.status = 'Dispatched';
        wo.updatedAt = now;
        appendWorkOrderTimeline(
          db,
          wo.id,
          req.adminUser!.fullName,
          'bid_accepted',
          `Accepted bid ${bid.bidCode} ($${bid.proposedPrice}) from ${bid.vendorName} and dispatched order.`
        );
      }
      // Reject competing submitted bids on same WO
      for (const other of db.vendorBids) {
        if (other.workOrderId === bid.workOrderId && other.id !== bid.id && (other.status === 'Submitted' || other.status === 'Under Review')) {
          other.status = 'Rejected';
          other.updatedAt = now;
        }
      }
    } else if (decision === 'reject') {
      bid.status = 'Rejected';
    } else {
      bid.status = 'Under Review';
      bid.clarificationNote = note;
    }
    bid.updatedAt = now;

    appendActivityLog(db, {
      actorId: req.adminUser!.id,
      actorEmail: req.adminUser!.email,
      actorRole: req.adminUser!.role,
      action: `vendor_bid_${decision}`,
      entityType: 'vendor_bid',
      entityId: bid.id,
      summary: `Vendor bid ${bid.bidCode} marked ${bid.status}.`
    });
    saveDbState(db);
    res.json({ item: bid });
  });

  // ===========================================================================
  // 8. URGENT DISPATCH MANAGEMENT
  // ===========================================================================
  router.get('/admin/dispatch', requireAdmin, requirePermission('dispatch.read'), (req, res) => {
    const db = getDbState();
    const status = sanitizeText(req.query.status, 40);
    const priority = sanitizeText(req.query.priority, 20);
    const q = sanitizeText(req.query.q, 120).toLowerCase();

    const items = db.dispatchRequests.filter((d) => {
      if (status && status !== 'All' && d.status !== status) return false;
      if (priority && priority !== 'All' && d.priority !== priority) return false;
      if (q) {
        const hay = `${d.dispatchCode} ${d.contactName} ${d.phone} ${d.propertyAddress} ${d.emergencyType}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
    res.json({ items });
  });

  router.patch('/admin/dispatch/:id', requireAdmin, requirePermission('dispatch.write'), (req: AuthenticatedRequest, res) => {
    const db = getDbState();
    const item = db.dispatchRequests.find((d) => d.id === req.params.id);
    if (!item) {
      res.status(404).json({ error: 'Dispatch request not found.' });
      return;
    }

    const now = new Date().toISOString();
    const prevStatus = item.status;

    if (req.body?.status && DISPATCH_STATUSES.includes(req.body.status)) item.status = req.body.status;
    if (req.body?.priority && PRIORITY_LEVELS.includes(req.body.priority)) item.priority = req.body.priority;
    if (req.body?.internalNotes !== undefined) item.internalNotes = sanitizeText(req.body.internalNotes, 2000);
    if (req.body?.assignedVendorId !== undefined) {
      const vid = sanitizeText(req.body.assignedVendorId, 80) || null;
      item.assignedVendorId = vid;
      const v = vid ? db.vendors.find((vnd) => vnd.id === vid) : undefined;
      item.assignedVendorName = v ? v.companyName : '';
      if (v && item.status === 'New') item.status = 'Assigned';
      item.timeline.unshift({
        id: crypto.randomUUID(),
        actorName: req.adminUser!.fullName,
        description: v ? `Assigned emergency dispatch to ${v.companyName}.` : 'Cleared vendor assignment.',
        createdAt: now
      });
    }
    if (item.status !== prevStatus) {
      item.timeline.unshift({
        id: crypto.randomUUID(),
        actorName: req.adminUser!.fullName,
        description: `Status updated from ${prevStatus} to ${item.status}.`,
        createdAt: now
      });
    }
    item.updatedAt = now;

    appendActivityLog(db, {
      actorId: req.adminUser!.id,
      actorEmail: req.adminUser!.email,
      actorRole: req.adminUser!.role,
      action: 'dispatch_updated',
      entityType: 'dispatch',
      entityId: item.id,
      summary: `Updated dispatch ${item.dispatchCode} (${item.status}).`
    });
    saveDbState(db);
    res.json({ item });
  });

  // ===========================================================================
  // 9. SERVICES, GALLERY, COVERAGE & REVIEWS CMS
  // ===========================================================================
  router.get('/admin/services', requireAdmin, requirePermission('services.manage'), (_req, res) => {
    const db = getDbState();
    res.json({ items: [...db.services].sort((a, b) => a.sortOrder - b.sortOrder) });
  });

  router.post('/admin/services', requireAdmin, requirePermission('services.manage'), (req: AuthenticatedRequest, res) => {
    const title = sanitizeText(req.body?.title, 140);
    const subtitle = sanitizeText(req.body?.subtitle, 500);
    if (!title || !subtitle) {
      res.status(400).json({ error: 'Service title and description are required.' });
      return;
    }

    const db = getDbState();
    const now = new Date().toISOString();
    const nextNum = `${String(db.services.length + 1).padStart(2, '0')}.`;
    const service = {
      id: crypto.randomUUID(),
      serviceNumber: sanitizeText(req.body?.serviceNumber, 12) || nextNum,
      slug: `${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${Date.now().toString().slice(-4)}`,
      title,
      subtitle,
      category: sanitizeText(req.body?.category, 140) || title,
      pricingModel: sanitizeText(req.body?.pricingModel, 80) || 'Per Work Order',
      basePrice: Number(req.body?.basePrice) || 0,
      turnaround: sanitizeText(req.body?.turnaround, 80) || '48 hr SLA',
      items: Array.isArray(req.body?.items)
        ? req.body.items.map((i: unknown) => sanitizeText(i, 200)).filter(Boolean)
        : [],
      complianceNote: sanitizeText(req.body?.complianceNote, 240),
      imageUrl: isSafeMediaUrl(sanitizeText(req.body?.imageUrl, 500)) ? sanitizeText(req.body?.imageUrl, 500) : '',
      isVisible: req.body?.isVisible !== false,
      sortOrder: db.services.length + 1,
      isArchived: false,
      isDemo: false,
      updatedAt: now
    };
    db.services.push(service);
    appendActivityLog(db, {
      actorId: req.adminUser!.id,
      actorEmail: req.adminUser!.email,
      actorRole: req.adminUser!.role,
      action: 'service_created',
      entityType: 'service',
      entityId: service.id,
      summary: `Created service "${service.title}".`
    });
    saveDbState(db);
    res.status(201).json({ item: service });
  });

  router.patch('/admin/services/:id', requireAdmin, requirePermission('services.manage'), (req: AuthenticatedRequest, res) => {
    const db = getDbState();
    const svc = db.services.find((s) => s.id === req.params.id);
    if (!svc) {
      res.status(404).json({ error: 'Service not found.' });
      return;
    }

    if (req.body?.serviceNumber !== undefined) svc.serviceNumber = sanitizeText(req.body.serviceNumber, 12);
    if (req.body?.title !== undefined) svc.title = sanitizeText(req.body.title, 140);
    if (req.body?.subtitle !== undefined) svc.subtitle = sanitizeText(req.body.subtitle, 500);
    if (req.body?.category !== undefined) svc.category = sanitizeText(req.body.category, 140);
    if (req.body?.pricingModel !== undefined) svc.pricingModel = sanitizeText(req.body.pricingModel, 80);
    if (req.body?.basePrice !== undefined) svc.basePrice = Number(req.body.basePrice) || 0;
    if (req.body?.turnaround !== undefined) svc.turnaround = sanitizeText(req.body.turnaround, 80);
    if (Array.isArray(req.body?.items)) svc.items = req.body.items.map((i: unknown) => sanitizeText(i, 200)).filter(Boolean);
    if (req.body?.complianceNote !== undefined) svc.complianceNote = sanitizeText(req.body.complianceNote, 240);
    if (req.body?.imageUrl !== undefined) {
      const url = sanitizeText(req.body.imageUrl, 500);
      if (isSafeMediaUrl(url)) svc.imageUrl = url;
    }
    if (req.body?.isVisible !== undefined) svc.isVisible = Boolean(req.body.isVisible);
    if (req.body?.isArchived !== undefined) svc.isArchived = Boolean(req.body.isArchived);
    if (req.body?.sortOrder !== undefined) svc.sortOrder = Number(req.body.sortOrder) || svc.sortOrder;
    svc.updatedAt = new Date().toISOString();

    appendActivityLog(db, {
      actorId: req.adminUser!.id,
      actorEmail: req.adminUser!.email,
      actorRole: req.adminUser!.role,
      action: 'service_updated',
      entityType: 'service',
      entityId: svc.id,
      summary: `Updated service "${svc.title}".`
    });
    saveDbState(db);
    res.json({ item: svc });
  });

  router.delete('/admin/services/:id', requireAdmin, requirePermission('services.manage'), (req: AuthenticatedRequest, res) => {
    const db = getDbState();
    const idx = db.services.findIndex((s) => s.id === req.params.id);
    if (idx === -1) {
      res.status(404).json({ error: 'Service not found.' });
      return;
    }
    const [removed] = db.services.splice(idx, 1);
    appendActivityLog(db, {
      actorId: req.adminUser!.id,
      actorEmail: req.adminUser!.email,
      actorRole: req.adminUser!.role,
      action: 'service_deleted',
      entityType: 'service',
      entityId: removed.id,
      summary: `Removed service "${removed.title}".`
    });
    saveDbState(db);
    res.json({ ok: true });
  });

  // Gallery
  router.get('/admin/gallery', requireAdmin, requirePermission('gallery.manage'), (_req, res) => {
    const db = getDbState();
    res.json({ items: [...db.galleryCases].sort((a, b) => a.sortOrder - b.sortOrder) });
  });

  router.post(
    '/admin/gallery/upload',
    requireAdmin,
    requirePermission('gallery.manage'),
    uploadImageMiddleware.single('file'),
    async (req, res) => {
      try {
        if (!req.file) {
          res.status(400).json({ error: 'Image file is required.' });
          return;
        }
        const { publicUrl, storagePath } = await persistUploadedFile('gallery', req.file);
        res.status(201).json({ url: publicUrl || `/uploads/gallery/${storagePath}` });
      } catch (err) {
        res.status(400).json({ error: err instanceof Error ? err.message : 'Image upload failed.' });
      }
    }
  );

  router.post('/admin/gallery', requireAdmin, requirePermission('gallery.manage'), (req: AuthenticatedRequest, res) => {
    const title = sanitizeText(req.body?.title, 160);
    const location = sanitizeText(req.body?.location, 120);
    const beforeImage = sanitizeText(req.body?.beforeImage, 500);
    const afterImage = sanitizeText(req.body?.afterImage, 500);

    if (!title || !location || !beforeImage || !afterImage || !isSafeMediaUrl(beforeImage) || !isSafeMediaUrl(afterImage)) {
      res.status(400).json({ error: 'Title, location, and valid before/after image URLs are required.' });
      return;
    }

    const db = getDbState();
    const item = {
      id: crypto.randomUUID(),
      slug: `${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${Date.now().toString().slice(-4)}`,
      title,
      location,
      workOrderId: sanitizeText(req.body?.workOrderId, 60) || `WO-${Math.floor(88000 + Math.random() * 9999)}`,
      scopeSummary: sanitizeText(req.body?.scopeSummary, 600),
      turnaroundHours: Math.max(1, Number(req.body?.turnaroundHours) || 36),
      beforeImage,
      afterImage,
      beforeAlt: sanitizeText(req.body?.beforeAlt, 240) || `Before photo for ${title}`,
      afterAlt: sanitizeText(req.body?.afterAlt, 240) || `After photo for ${title}`,
      isPublished: req.body?.isPublished !== false,
      sortOrder: db.galleryCases.length + 1,
      isDemo: false,
      updatedAt: new Date().toISOString()
    };

    db.galleryCases.push(item);
    appendActivityLog(db, {
      actorId: req.adminUser!.id,
      actorEmail: req.adminUser!.email,
      actorRole: req.adminUser!.role,
      action: 'gallery_case_created',
      entityType: 'gallery',
      entityId: item.id,
      summary: `Added gallery case "${item.title}".`
    });
    saveDbState(db);
    res.status(201).json({ item });
  });

  router.patch('/admin/gallery/:id', requireAdmin, requirePermission('gallery.manage'), (req: AuthenticatedRequest, res) => {
    const db = getDbState();
    const item = db.galleryCases.find((g) => g.id === req.params.id);
    if (!item) {
      res.status(404).json({ error: 'Gallery case not found.' });
      return;
    }
    if (req.body?.title !== undefined) item.title = sanitizeText(req.body.title, 160);
    if (req.body?.location !== undefined) item.location = sanitizeText(req.body.location, 120);
    if (req.body?.workOrderId !== undefined) item.workOrderId = sanitizeText(req.body.workOrderId, 60);
    if (req.body?.scopeSummary !== undefined) item.scopeSummary = sanitizeText(req.body.scopeSummary, 600);
    if (req.body?.turnaroundHours !== undefined) item.turnaroundHours = Math.max(1, Number(req.body.turnaroundHours) || item.turnaroundHours);
    if (req.body?.beforeImage && isSafeMediaUrl(req.body.beforeImage)) item.beforeImage = sanitizeText(req.body.beforeImage, 500);
    if (req.body?.afterImage && isSafeMediaUrl(req.body.afterImage)) item.afterImage = sanitizeText(req.body.afterImage, 500);
    if (req.body?.beforeAlt !== undefined) item.beforeAlt = sanitizeText(req.body.beforeAlt, 240);
    if (req.body?.afterAlt !== undefined) item.afterAlt = sanitizeText(req.body.afterAlt, 240);
    if (req.body?.isPublished !== undefined) item.isPublished = Boolean(req.body.isPublished);
    if (req.body?.sortOrder !== undefined) item.sortOrder = Number(req.body.sortOrder) || item.sortOrder;
    item.updatedAt = new Date().toISOString();

    appendActivityLog(db, {
      actorId: req.adminUser!.id,
      actorEmail: req.adminUser!.email,
      actorRole: req.adminUser!.role,
      action: 'gallery_case_updated',
      entityType: 'gallery',
      entityId: item.id,
      summary: `Updated gallery case "${item.title}" (published: ${item.isPublished}).`
    });
    saveDbState(db);
    res.json({ item });
  });

  router.delete('/admin/gallery/:id', requireAdmin, requirePermission('gallery.manage'), (req: AuthenticatedRequest, res) => {
    const db = getDbState();
    const idx = db.galleryCases.findIndex((g) => g.id === req.params.id);
    if (idx === -1) {
      res.status(404).json({ error: 'Gallery case not found.' });
      return;
    }
    const [removed] = db.galleryCases.splice(idx, 1);
    appendActivityLog(db, {
      actorId: req.adminUser!.id,
      actorEmail: req.adminUser!.email,
      actorRole: req.adminUser!.role,
      action: 'gallery_case_deleted',
      entityType: 'gallery',
      entityId: removed.id,
      summary: `Deleted gallery case "${removed.title}".`
    });
    saveDbState(db);
    res.json({ ok: true });
  });

  // Coverage Regions
  router.get('/admin/coverage', requireAdmin, requirePermission('coverage.manage'), (_req, res) => {
    res.json({ items: getDbState().coverageRegions });
  });

  router.post('/admin/coverage', requireAdmin, requirePermission('coverage.manage'), (req: AuthenticatedRequest, res) => {
    const region = sanitizeText(req.body?.region, 140);
    const hubCity = sanitizeText(req.body?.hubCity, 120);
    if (!region || !hubCity) {
      res.status(400).json({ error: 'Region name and hub city are required.' });
      return;
    }

    const db = getDbState();
    const item = {
      id: crypto.randomUUID(),
      region,
      hubCity,
      states: Array.isArray(req.body?.states)
        ? req.body.states.map((s: unknown) => sanitizeText(s, 10)).filter(Boolean)
        : [],
      counties: Array.isArray(req.body?.counties)
        ? req.body.counties.map((c: unknown) => sanitizeText(c, 80)).filter(Boolean)
        : [],
      activeCounties: Math.max(0, Number(req.body?.activeCounties) || 0),
      avgDispatchHours: Math.max(1, Number(req.body?.avgDispatchHours) || 24),
      hudStandard: sanitizeText(req.body?.hudStandard, 240),
      lat: req.body?.lat !== undefined && req.body?.lat !== '' ? Number(req.body.lat) : null,
      lng: req.body?.lng !== undefined && req.body?.lng !== '' ? Number(req.body.lng) : null,
      isHeadquarters: Boolean(req.body?.isHeadquarters),
      coverageStatus: (['Active', 'Expanding', 'Paused'].includes(req.body?.coverageStatus) ? req.body.coverageStatus : 'Active') as 'Active' | 'Expanding' | 'Paused',
      isPublished: req.body?.isPublished !== false,
      isDemo: false,
      updatedAt: new Date().toISOString()
    };

    db.coverageRegions.push(item);
    appendActivityLog(db, {
      actorId: req.adminUser!.id,
      actorEmail: req.adminUser!.email,
      actorRole: req.adminUser!.role,
      action: 'coverage_region_created',
      entityType: 'coverage',
      entityId: item.id,
      summary: `Added coverage region "${item.region}".`
    });
    saveDbState(db);
    res.status(201).json({ item });
  });

  router.patch('/admin/coverage/:id', requireAdmin, requirePermission('coverage.manage'), (req: AuthenticatedRequest, res) => {
    const db = getDbState();
    const item = db.coverageRegions.find((r) => r.id === req.params.id);
    if (!item) {
      res.status(404).json({ error: 'Coverage region not found.' });
      return;
    }

    if (req.body?.region !== undefined) item.region = sanitizeText(req.body.region, 140);
    if (req.body?.hubCity !== undefined) item.hubCity = sanitizeText(req.body.hubCity, 120);
    if (Array.isArray(req.body?.states)) item.states = req.body.states.map((s: unknown) => sanitizeText(s, 10)).filter(Boolean);
    if (Array.isArray(req.body?.counties)) item.counties = req.body.counties.map((c: unknown) => sanitizeText(c, 80)).filter(Boolean);
    if (req.body?.activeCounties !== undefined) item.activeCounties = Math.max(0, Number(req.body.activeCounties) || 0);
    if (req.body?.avgDispatchHours !== undefined) item.avgDispatchHours = Math.max(1, Number(req.body.avgDispatchHours) || 24);
    if (req.body?.hudStandard !== undefined) item.hudStandard = sanitizeText(req.body.hudStandard, 240);
    if (req.body?.lat !== undefined) item.lat = req.body.lat === null || req.body.lat === '' ? null : Number(req.body.lat);
    if (req.body?.lng !== undefined) item.lng = req.body.lng === null || req.body.lng === '' ? null : Number(req.body.lng);
    if (req.body?.isHeadquarters !== undefined) item.isHeadquarters = Boolean(req.body.isHeadquarters);
    if (['Active', 'Expanding', 'Paused'].includes(req.body?.coverageStatus)) item.coverageStatus = req.body.coverageStatus;
    if (req.body?.isPublished !== undefined) item.isPublished = Boolean(req.body.isPublished);
    item.updatedAt = new Date().toISOString();

    appendActivityLog(db, {
      actorId: req.adminUser!.id,
      actorEmail: req.adminUser!.email,
      actorRole: req.adminUser!.role,
      action: 'coverage_region_updated',
      entityType: 'coverage',
      entityId: item.id,
      summary: `Updated coverage region "${item.region}".`
    });
    saveDbState(db);
    res.json({ item });
  });

  router.delete('/admin/coverage/:id', requireAdmin, requirePermission('coverage.manage'), (req: AuthenticatedRequest, res) => {
    const db = getDbState();
    const idx = db.coverageRegions.findIndex((r) => r.id === req.params.id);
    if (idx === -1) {
      res.status(404).json({ error: 'Coverage region not found.' });
      return;
    }
    const [removed] = db.coverageRegions.splice(idx, 1);
    appendActivityLog(db, {
      actorId: req.adminUser!.id,
      actorEmail: req.adminUser!.email,
      actorRole: req.adminUser!.role,
      action: 'coverage_region_deleted',
      entityType: 'coverage',
      entityId: removed.id,
      summary: `Removed coverage region "${removed.region}".`
    });
    saveDbState(db);
    res.json({ ok: true });
  });

  // Reviews
  router.get('/admin/reviews', requireAdmin, requirePermission('reviews.manage'), (_req, res) => {
    const items = [...getDbState().reviews].sort((a, b) => a.sortOrder - b.sortOrder);
    res.json({ items });
  });

  router.post('/admin/reviews', requireAdmin, requirePermission('reviews.manage'), (req: AuthenticatedRequest, res) => {
    const reviewer = sanitizeText(req.body?.reviewer, 120);
    const comment = sanitizeText(req.body?.comment, 2000);
    if (!reviewer || !comment) {
      res.status(400).json({ error: 'Reviewer name and comment are required.' });
      return;
    }

    const db = getDbState();
    const statusRaw = sanitizeText(req.body?.publicationStatus, 30) as ReviewPublicationStatus;
    const item = {
      id: crypto.randomUUID(),
      reviewer,
      organization: sanitizeText(req.body?.organization, 140),
      role: sanitizeText(req.body?.role, 120),
      rating: Math.min(5, Math.max(1, Number(req.body?.rating) || 5)),
      comment,
      serviceTag: sanitizeText(req.body?.serviceTag, 140),
      dateLabel: sanitizeText(req.body?.dateLabel, 60) || 'Recently',
      // Manual entries cannot falsely claim third-party verification
      isVerifiedCustomer: false,
      publicationStatus: (['Pending', 'Approved', 'Published', 'Hidden'].includes(statusRaw) ? statusRaw : 'Published') as ReviewPublicationStatus,
      sortOrder: db.reviews.length + 1,
      isDemo: false,
      createdAt: new Date().toISOString()
    };

    db.reviews.push(item);
    appendActivityLog(db, {
      actorId: req.adminUser!.id,
      actorEmail: req.adminUser!.email,
      actorRole: req.adminUser!.role,
      action: 'review_created',
      entityType: 'review',
      entityId: item.id,
      summary: `Added manual review entry for ${item.reviewer}.`
    });
    saveDbState(db);
    res.status(201).json({ item });
  });

  router.patch('/admin/reviews/:id', requireAdmin, requirePermission('reviews.manage'), (req: AuthenticatedRequest, res) => {
    const db = getDbState();
    const item = db.reviews.find((r) => r.id === req.params.id);
    if (!item) {
      res.status(404).json({ error: 'Review not found.' });
      return;
    }

    if (req.body?.reviewer !== undefined) item.reviewer = sanitizeText(req.body.reviewer, 120);
    if (req.body?.organization !== undefined) item.organization = sanitizeText(req.body.organization, 140);
    if (req.body?.role !== undefined) item.role = sanitizeText(req.body.role, 120);
    if (req.body?.rating !== undefined) item.rating = Math.min(5, Math.max(1, Number(req.body.rating) || 5));
    if (req.body?.comment !== undefined) item.comment = sanitizeText(req.body.comment, 2000);
    if (req.body?.serviceTag !== undefined) item.serviceTag = sanitizeText(req.body.serviceTag, 140);
    if (req.body?.dateLabel !== undefined) item.dateLabel = sanitizeText(req.body.dateLabel, 60);
    if (['Pending', 'Approved', 'Published', 'Hidden'].includes(req.body?.publicationStatus)) {
      item.publicationStatus = req.body.publicationStatus;
    }
    if (req.body?.sortOrder !== undefined) item.sortOrder = Number(req.body.sortOrder) || item.sortOrder;

    appendActivityLog(db, {
      actorId: req.adminUser!.id,
      actorEmail: req.adminUser!.email,
      actorRole: req.adminUser!.role,
      action: 'review_updated',
      entityType: 'review',
      entityId: item.id,
      summary: `Updated review for ${item.reviewer} (${item.publicationStatus}).`
    });
    saveDbState(db);
    res.json({ item });
  });

  router.delete('/admin/reviews/:id', requireAdmin, requirePermission('reviews.manage'), (req: AuthenticatedRequest, res) => {
    const db = getDbState();
    const idx = db.reviews.findIndex((r) => r.id === req.params.id);
    if (idx === -1) {
      res.status(404).json({ error: 'Review not found.' });
      return;
    }
    const [removed] = db.reviews.splice(idx, 1);
    appendActivityLog(db, {
      actorId: req.adminUser!.id,
      actorEmail: req.adminUser!.email,
      actorRole: req.adminUser!.role,
      action: 'review_deleted',
      entityType: 'review',
      entityId: removed.id,
      summary: `Deleted review for ${removed.reviewer}.`
    });
    saveDbState(db);
    res.json({ ok: true });
  });

  // ===========================================================================
  // 10. MESSAGES, REPORTS, NOTIFICATIONS, AUDIT LOGS & SETTINGS
  // ===========================================================================
  router.get('/admin/messages', requireAdmin, requirePermission('messages.manage'), (req, res) => {
    const db = getDbState();
    const status = sanitizeText(req.query.status, 30);
    const q = sanitizeText(req.query.q, 120).toLowerCase();
    const items = db.messages.filter((m) => {
      if (status && status !== 'All' && m.status !== status) return false;
      if (q) {
        const hay = `${m.senderName} ${m.senderEmail} ${m.senderPhone} ${m.subject} ${m.body}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
    res.json({ items });
  });

  router.patch('/admin/messages/:id', requireAdmin, requirePermission('messages.manage'), (req: AuthenticatedRequest, res) => {
    const db = getDbState();
    const msg = db.messages.find((m) => m.id === req.params.id);
    if (!msg) {
      res.status(404).json({ error: 'Message not found.' });
      return;
    }

    if (['Unread', 'Read', 'Responded', 'Archived'].includes(req.body?.status)) msg.status = req.body.status;
    if (req.body?.internalNotes !== undefined) msg.internalNotes = sanitizeText(req.body.internalNotes, 2000);
    if (req.body?.linkedClientId !== undefined) msg.linkedClientId = req.body.linkedClientId || null;
    if (req.body?.linkedBidRequestId !== undefined) msg.linkedBidRequestId = req.body.linkedBidRequestId || null;
    if (req.body?.linkedWorkOrderId !== undefined) msg.linkedWorkOrderId = req.body.linkedWorkOrderId || null;
    if (req.body?.linkedDispatchId !== undefined) msg.linkedDispatchId = req.body.linkedDispatchId || null;
    msg.updatedAt = new Date().toISOString();

    saveDbState(db);
    res.json({ item: msg });
  });

  router.get('/admin/reports', requireAdmin, requirePermission('reports.view'), (req, res) => {
    const range = sanitizeText(req.query.range, 20) || 'all';
    const fromStr = sanitizeText(req.query.from, 40);
    const toStr = sanitizeText(req.query.to, 40);
    const { start, end } = range === 'all' ? { start: 0, end: Date.now() + 86400000 } : computeDateCutoff(range, fromStr, toStr);
    const inRange = (iso: string) => {
      const ts = new Date(iso).getTime();
      return ts >= start && ts <= end;
    };

    const db = getDbState();
    const workOrders = db.workOrders.filter((w) => !w.isArchived && inRange(w.createdDate));
    const bids = db.bidRequests.filter((b) => inRange(b.createdAt));
    const dispatches = db.dispatchRequests.filter((d) => inRange(d.submittedDate));

    const totalCompleted = workOrders.filter((w) => w.status === 'Completed' || w.status === 'QC Verified').length;
    const slaMet = workOrders.filter((w) => {
      if (!w.completionDate || !w.slaDeadline) return false;
      return new Date(w.completionDate).getTime() <= new Date(w.slaDeadline).getTime();
    }).length;

    const serviceMap: Record<string, { category: string; count: number; totalBudget: number }> = {};
    for (const wo of workOrders) {
      if (!serviceMap[wo.serviceCategory]) {
        serviceMap[wo.serviceCategory] = { category: wo.serviceCategory, count: 0, totalBudget: 0 };
      }
      serviceMap[wo.serviceCategory].count += 1;
      serviceMap[wo.serviceCategory].totalBudget += wo.approvedBudget ?? wo.estimatedBudget;
    }

    res.json({
      summary: {
        workOrdersCount: workOrders.length,
        completionRate: workOrders.length ? Math.round((totalCompleted / workOrders.length) * 100) : 0,
        slaComplianceCount: slaMet,
        bidRequestsCount: bids.length,
        bidConversionRate: bids.length ? Math.round((bids.filter((b) => b.status === 'Converted').length / bids.length) * 100) : 0,
        dispatchesCount: dispatches.length,
        resolvedDispatches: dispatches.filter((d) => d.status === 'Resolved' || d.status === 'Closed').length,
        totalJobValue: workOrders.reduce((s, w) => s + (w.approvedBudget ?? w.estimatedBudget), 0),
        activeClientsCount: db.clients.filter((c) => c.accountStatus === 'active').length,
        approvedVendorsCount: db.vendors.filter((v) => v.applicationStatus === 'Approved').length
      },
      serviceReport: Object.values(serviceMap),
      vendorReport: db.vendors.map((v) => ({
        id: v.id,
        vendorCode: v.vendorCode,
        companyName: v.companyName,
        applicationStatus: v.applicationStatus,
        completedWorkOrders: v.completedWorkOrders,
        assignedActive: workOrders.filter((w) => w.assignedVendorId === v.id).length,
        rating: v.rating
      })),
      clientReport: db.clients.map((c) => ({
        id: c.id,
        clientCode: c.clientCode,
        name: c.companyName || c.contactName,
        clientType: c.clientType,
        workOrdersCount: workOrders.filter((w) => w.clientId === c.id).length,
        totalBudget: workOrders.filter((w) => w.clientId === c.id).reduce((s, w) => s + (w.approvedBudget ?? w.estimatedBudget), 0)
      }))
    });
  });

  router.get('/admin/reports/export', requireAdmin, requirePermission('reports.export'), (req, res) => {
    const type = sanitizeText(req.query.type, 40) || 'work-orders';
    const db = getDbState();
    let csv = '';

    if (type === 'vendors') {
      csv = rowsToCsv(
        ['Vendor Code', 'Company Name', 'Contact', 'Email', 'Phone', 'Coverage', 'Status', 'Completed WOs', 'Rating'],
        db.vendors.map((v) => [
          v.vendorCode,
          v.companyName,
          v.contactPerson,
          v.email,
          v.phone,
          v.coverageAreas,
          v.applicationStatus,
          v.completedWorkOrders,
          v.rating ?? 'N/A'
        ])
      );
    } else if (type === 'bid-requests') {
      csv = rowsToCsv(
        ['Request Code', 'Contact', 'Email', 'Phone', 'Address', 'Services', 'Status', 'Created'],
        db.bidRequests.map((b) => [
          b.requestCode,
          b.contactName,
          b.email,
          b.phone,
          b.propertyAddress,
          b.requestedServices,
          b.status,
          b.createdAt
        ])
      );
    } else if (type === 'dispatch') {
      csv = rowsToCsv(
        ['Dispatch Code', 'Contact', 'Phone', 'Address', 'Emergency Type', 'Priority', 'Status', 'Assigned Vendor', 'Submitted'],
        db.dispatchRequests.map((d) => [
          d.dispatchCode,
          d.contactName,
          d.phone,
          d.propertyAddress,
          d.emergencyType,
          d.priority,
          d.status,
          d.assignedVendorName || 'Unassigned',
          d.submittedDate
        ])
      );
    } else {
      csv = rowsToCsv(
        ['Work Order Code', 'Client', 'Client Type', 'Address', 'City', 'State', 'Category', 'Priority', 'Status', 'Estimated Budget', 'Approved Budget', 'Assigned Vendor', 'SLA Deadline', 'Demo'],
        db.workOrders.map((w) => [
          w.workOrderCode,
          w.clientName,
          w.clientType,
          w.propertyAddress,
          w.city,
          w.state,
          w.serviceCategory,
          w.priority,
          w.status,
          w.estimatedBudget,
          w.approvedBudget ?? '',
          w.assignedVendorName || 'Unassigned',
          w.slaDeadline ?? '',
          w.isDemo ? 'Yes' : 'No'
        ])
      );
    }

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="slc-${type}-report.csv"`);
    res.send(csv);
  });

  router.get('/admin/notifications', requireAdmin, (_req, res) => {
    const db = getDbState();
    res.json({
      items: db.notifications.slice(0, 60),
      unreadCount: db.notifications.filter((n) => !n.isRead).length
    });
  });

  router.patch('/admin/notifications/:id/read', requireAdmin, (req, res) => {
    const db = getDbState();
    const n = db.notifications.find((item) => item.id === req.params.id);
    if (n) {
      n.isRead = true;
      saveDbState(db);
    }
    res.json({ ok: true });
  });

  router.post('/admin/notifications/read-all', requireAdmin, (_req, res) => {
    const db = getDbState();
    for (const n of db.notifications) n.isRead = true;
    saveDbState(db);
    res.json({ ok: true });
  });

  router.get('/admin/activity-logs', requireAdmin, requirePermission('audit.view'), (req, res) => {
    const db = getDbState();
    const entityType = sanitizeText(req.query.entityType, 40);
    const items = db.activityLogs.filter((l) => !entityType || entityType === 'All' || l.entityType === entityType);
    res.json({ items: items.slice(0, 250) });
  });

  router.get('/admin/settings', requireAdmin, (req: AuthenticatedRequest, res) => {
    const db = getDbState();
    const prefs = db.notificationPreferences[req.adminUser!.id] ?? {
      emailEnabled: false,
      events: {
        new_bid_request: true,
        new_vendor_application: true,
        new_vendor_bid: true,
        new_dispatch_request: true,
        new_work_order: true,
        qc_rejected: true,
        work_order_completed: true
      }
    };
    res.json({
      businessSettings: db.businessSettings,
      notificationPreferences: prefs,
      emailServiceConfigured: isEmailServiceConfigured()
    });
  });

  router.put('/admin/settings', requireAdmin, requirePermission('settings.manage'), (req: AuthenticatedRequest, res) => {
    const db = getDbState();
    const s = db.businessSettings;
    if (req.body?.businessName !== undefined) s.businessName = sanitizeText(req.body.businessName, 160);
    if (req.body?.phone !== undefined) s.phone = sanitizeText(req.body.phone, 40);
    if (req.body?.email !== undefined && isValidEmail(req.body.email)) s.email = sanitizeText(req.body.email, 254);
    if (req.body?.address !== undefined) s.address = sanitizeText(req.body.address, 240);
    if (req.body?.hours !== undefined) s.hours = sanitizeText(req.body.hours, 160);
    if (req.body?.logoUrl !== undefined && isSafeMediaUrl(req.body.logoUrl)) s.logoUrl = sanitizeText(req.body.logoUrl, 500);
    if (PRIORITY_LEVELS.includes(req.body?.defaultWoPriority)) s.defaultWoPriority = req.body.defaultWoPriority;
    if (req.body?.defaultSlaHours !== undefined) s.defaultSlaHours = Math.max(4, Number(req.body.defaultSlaHours) || 48);
    if (req.body?.autoNotifyUrgent !== undefined) s.autoNotifyUrgent = Boolean(req.body.autoNotifyUrgent);
    if (req.body?.coverageRadiusNote !== undefined) s.coverageRadiusNote = sanitizeText(req.body.coverageRadiusNote, 160);
    s.updatedAt = new Date().toISOString();

    appendActivityLog(db, {
      actorId: req.adminUser!.id,
      actorEmail: req.adminUser!.email,
      actorRole: req.adminUser!.role,
      action: 'settings_updated',
      entityType: 'settings',
      entityId: 'business_settings',
      summary: `Updated business & SLA settings.`
    });
    saveDbState(db);
    res.json({ businessSettings: s });
  });

  router.put('/admin/notification-preferences', requireAdmin, (req: AuthenticatedRequest, res) => {
    const db = getDbState();
    db.notificationPreferences[req.adminUser!.id] = {
      emailEnabled: Boolean(req.body?.emailEnabled),
      events: typeof req.body?.events === 'object' && req.body.events ? req.body.events : {}
    };
    saveDbState(db);
    res.json({ notificationPreferences: db.notificationPreferences[req.adminUser!.id] });
  });

  // ===========================================================================
  // 11. SUPER ADMIN USER & RBAC ROLE MANAGEMENT
  // ===========================================================================
  router.get('/admin/users', requireAdmin, requirePermission('admin_users.manage'), async (_req, res) => {
    const sb = getSupabaseAdminClient();
    if (sb) {
      const roles = await ensureSupabaseSystemRoles(sb);
      const { data: permRows } = await sb
        .from('role_permissions')
        .select('role_id, permission_key, allowed')
        .eq('allowed', true);

      const permsByRoleId = new Map<string, PermissionKey[]>();
      for (const p of permRows ?? []) {
        const list = permsByRoleId.get(p.role_id) ?? [];
        list.push(p.permission_key as PermissionKey);
        permsByRoleId.set(p.role_id, list);
      }

      const roleConfigs = DEFAULT_ROLES.map((def) => {
        const dbRole = roles.find((r) => r.name === def.role);
        return {
          role: def.role,
          description: dbRole?.description || def.description,
          permissions:
            def.role === 'Super Admin'
              ? [...ALL_PERMISSION_KEYS]
              : dbRole
              ? permsByRoleId.get(dbRole.id) ?? def.permissions
              : def.permissions
        };
      });

      const { data: profileRows, error: profErr } = await sb
        .from('profiles')
        .select('id, email, full_name, phone, avatar_url, account_status, last_login_at, created_at, admin_roles(id, name)')
        .eq('is_admin', true)
        .order('created_at', { ascending: true });

      if (profErr) {
        res.status(500).json({ error: `Unable to load administrators: ${profErr.message}` });
        return;
      }

      const items = (profileRows ?? []).map((p) => {
        const roleRel = p.admin_roles as unknown as { id: string; name: AdminRoleName } | null;
        const roleName: AdminRoleName = roleRel?.name ?? 'Admin';
        const perms =
          roleName === 'Super Admin'
            ? [...ALL_PERMISSION_KEYS]
            : roleRel?.id
            ? permsByRoleId.get(roleRel.id) ?? []
            : [];
        return {
          id: p.id,
          email: p.email,
          fullName: p.full_name,
          phone: p.phone ?? '',
          avatarUrl: p.avatar_url ?? '',
          role: roleName,
          accountStatus: p.account_status as 'active' | 'suspended' | 'invited',
          permissions: perms,
          lastLoginAt: p.last_login_at,
          createdAt: p.created_at
        };
      });

      res.json({ items, roles: roleConfigs, allPermissionKeys: ALL_PERMISSION_KEYS, authMode: 'supabase' });
      return;
    }

    const db = getDbState();
    const users = db.admins.map((a) => ({
      id: a.id,
      email: a.email,
      fullName: a.fullName,
      phone: a.phone,
      avatarUrl: a.avatarUrl,
      role: a.role,
      accountStatus: a.accountStatus,
      permissions: getPermissionsForRole(db, a.role),
      lastLoginAt: a.lastLoginAt,
      createdAt: a.createdAt
    }));
    res.json({ items: users, roles: db.roles, allPermissionKeys: ALL_PERMISSION_KEYS, authMode: 'local' });
  });

  router.post('/admin/users', requireAdmin, requirePermission('admin_users.manage'), async (req: AuthenticatedRequest, res) => {
    const fullName = sanitizeText(req.body?.fullName, 120);
    const email = sanitizeText(req.body?.email, 254).toLowerCase();
    const phone = sanitizeText(req.body?.phone, 40);
    const role = sanitizeText(req.body?.role, 40) as AdminRoleName;
    const inviteMode = req.body?.inviteMode === 'email' ? 'email' : 'password';
    const password = typeof req.body?.password === 'string' ? req.body.password : '';

    const validRole = DEFAULT_ROLES.some((r) => r.role === role);
    if (!fullName || !isValidEmail(email) || !validRole) {
      res.status(400).json({ error: 'Full name, valid email address, and valid administrator role are required.' });
      return;
    }

    const sb = getSupabaseAdminClient();
    if (sb) {
      if (inviteMode === 'password' && password.length < 10) {
        res.status(400).json({ error: 'Initial password must be at least 10 characters when creating directly.' });
        return;
      }

      const { data: existingProfile } = await sb
        .from('profiles')
        .select('id, is_admin')
        .eq('email', email)
        .maybeSingle();

      if (existingProfile?.is_admin) {
        res.status(409).json({ error: 'An administrator with that email already exists.' });
        return;
      }

      const roles = await ensureSupabaseSystemRoles(sb);
      const roleRow = roles.find((r) => r.name === role);
      if (!roleRow) {
        res.status(400).json({ error: 'Selected role could not be resolved.' });
        return;
      }

      const baseUrl = process.env.APP_URL?.trim() || `${req.protocol}://${req.get('host')}`;
      let userId = existingProfile?.id ?? '';
      let accountStatus: 'active' | 'invited' = 'active';

      if (!userId) {
        if (inviteMode === 'email') {
          const { data: invited, error: inviteErr } = await sb.auth.admin.inviteUserByEmail(email, {
            data: { full_name: fullName },
            redirectTo: `${baseUrl.replace(/\/$/, '')}/admin/reset-password`
          });
          if (inviteErr || !invited.user) {
            res.status(400).json({ error: inviteErr?.message || 'Unable to send Supabase invitation email.' });
            return;
          }
          userId = invited.user.id;
          accountStatus = 'invited';
        } else {
          const { data: created, error: createErr } = await sb.auth.admin.createUser({
            email,
            password,
            email_confirm: true,
            user_metadata: { full_name: fullName }
          });
          if (createErr || !created.user) {
            res.status(400).json({ error: createErr?.message || 'Unable to create Supabase user.' });
            return;
          }
          userId = created.user.id;
          accountStatus = 'active';
        }
      }

      const { error: upsertErr } = await sb.from('profiles').upsert({
        id: userId,
        email,
        full_name: fullName,
        phone,
        role_id: roleRow.id,
        is_admin: true,
        account_status: accountStatus
      });

      if (upsertErr) {
        res.status(500).json({ error: `Unable to save administrator profile: ${upsertErr.message}` });
        return;
      }

      await insertSupabaseAuditLog(sb, {
        actorId: req.adminUser!.id,
        actorEmail: req.adminUser!.email,
        actorRole: req.adminUser!.role,
        action: inviteMode === 'email' ? 'admin_user_invited' : 'admin_user_created',
        entityType: 'admin_user',
        entityId: userId,
        summary: `${inviteMode === 'email' ? 'Invited' : 'Created'} admin ${email} with role ${role}.`
      });

      const { data: permRows } = await sb
        .from('role_permissions')
        .select('permission_key')
        .eq('role_id', roleRow.id)
        .eq('allowed', true);

      res.status(201).json({
        item: {
          id: userId,
          email,
          fullName,
          phone,
          avatarUrl: '',
          role,
          accountStatus,
          permissions:
            role === 'Super Admin'
              ? [...ALL_PERMISSION_KEYS]
              : (permRows ?? []).map((p) => p.permission_key as PermissionKey),
          lastLoginAt: null,
          createdAt: new Date().toISOString()
        }
      });
      return;
    }

    if (password.length < 10) {
      res.status(400).json({ error: 'Initial password (10+ characters) is required in local server mode.' });
      return;
    }

    const db = getDbState();
    if (db.admins.some((a) => a.email.toLowerCase() === email)) {
      res.status(409).json({ error: 'An administrator with that email already exists.' });
      return;
    }

    const now = new Date().toISOString();
    const newAdmin = {
      id: crypto.randomUUID(),
      email,
      fullName,
      phone,
      avatarUrl: '',
      role,
      accountStatus: 'active' as const,
      passwordHash: hashPassword(password),
      lastLoginAt: null,
      createdAt: now,
      updatedAt: now
    };
    db.admins.push(newAdmin);
    appendActivityLog(db, {
      actorId: req.adminUser!.id,
      actorEmail: req.adminUser!.email,
      actorRole: req.adminUser!.role,
      action: 'admin_user_invited',
      entityType: 'admin_user',
      entityId: newAdmin.id,
      summary: `Created admin account ${email} with role ${role}.`
    });
    saveDbState(db);

    res.status(201).json({
      item: {
        id: newAdmin.id,
        email: newAdmin.email,
        fullName: newAdmin.fullName,
        phone: newAdmin.phone,
        avatarUrl: newAdmin.avatarUrl,
        role: newAdmin.role,
        accountStatus: newAdmin.accountStatus,
        permissions: getPermissionsForRole(db, newAdmin.role),
        lastLoginAt: newAdmin.lastLoginAt,
        createdAt: newAdmin.createdAt
      }
    });
  });

  router.patch('/admin/users/:id', requireAdmin, requirePermission('admin_users.manage'), async (req: AuthenticatedRequest, res) => {
    const targetId = req.params.id;
    const requestedRole = req.body?.role ? (sanitizeText(req.body.role, 40) as AdminRoleName) : undefined;
    const requestedStatus = ['active', 'suspended'].includes(req.body?.accountStatus)
      ? (req.body.accountStatus as 'active' | 'suspended')
      : undefined;

    if (targetId === req.adminUser!.id && requestedStatus === 'suspended') {
      res.status(400).json({ error: 'You cannot suspend your own active administrator session.' });
      return;
    }

    const sb = getSupabaseAdminClient();
    if (sb) {
      const { data: target, error: findErr } = await sb
        .from('profiles')
        .select('id, email, full_name, phone, avatar_url, account_status, last_login_at, created_at, is_admin, admin_roles(id, name)')
        .eq('id', targetId)
        .eq('is_admin', true)
        .single();

      if (findErr || !target) {
        res.status(404).json({ error: 'Administrator not found.' });
        return;
      }

      const currentRoleRel = target.admin_roles as unknown as { id: string; name: AdminRoleName } | null;
      const currentRoleName: AdminRoleName = currentRoleRel?.name ?? 'Admin';
      const roles = await ensureSupabaseSystemRoles(sb);

      const willLeaveSuperAdmin =
        currentRoleName === 'Super Admin' &&
        ((requestedRole && requestedRole !== 'Super Admin') || requestedStatus === 'suspended');

      if (willLeaveSuperAdmin) {
        const superRole = roles.find((r) => r.name === 'Super Admin');
        const { count: activeSupers } = await sb
          .from('profiles')
          .select('id', { count: 'exact', head: true })
          .eq('is_admin', true)
          .eq('account_status', 'active')
          .eq('role_id', superRole?.id ?? '');
        if ((activeSupers ?? 0) <= 1) {
          res.status(400).json({ error: 'At least one active Super Admin must remain.' });
          return;
        }
      }

      const updates: Record<string, unknown> = {};
      let nextRoleName: AdminRoleName = currentRoleName;
      let nextRoleId = currentRoleRel?.id ?? '';

      if (requestedRole) {
        const nextRoleObj = roles.find((r) => r.name === requestedRole);
        if (!nextRoleObj) {
          res.status(400).json({ error: 'Invalid administrator role.' });
          return;
        }
        updates.role_id = nextRoleObj.id;
        nextRoleName = nextRoleObj.name;
        nextRoleId = nextRoleObj.id;
      }
      if (requestedStatus) {
        updates.account_status = requestedStatus;
      }
      if (req.body?.fullName !== undefined) {
        const cleaned = sanitizeText(req.body.fullName, 120);
        if (cleaned) updates.full_name = cleaned;
      }
      if (req.body?.phone !== undefined) {
        updates.phone = sanitizeText(req.body.phone, 40);
      }

      const { data: updated, error: updErr } = await sb
        .from('profiles')
        .update(updates)
        .eq('id', targetId)
        .select('id, email, full_name, phone, avatar_url, account_status, last_login_at, created_at')
        .single();

      if (updErr || !updated) {
        res.status(500).json({ error: updErr?.message || 'Unable to update administrator.' });
        return;
      }

      await insertSupabaseAuditLog(sb, {
        actorId: req.adminUser!.id,
        actorEmail: req.adminUser!.email,
        actorRole: req.adminUser!.role,
        action: 'admin_user_updated',
        entityType: 'admin_user',
        entityId: targetId,
        summary: `Updated admin ${updated.email} (role: ${nextRoleName}, status: ${updated.account_status}).`
      });

      let permissions: PermissionKey[] = [...ALL_PERMISSION_KEYS];
      if (nextRoleName !== 'Super Admin' && nextRoleId) {
        const { data: permRows } = await sb
          .from('role_permissions')
          .select('permission_key')
          .eq('role_id', nextRoleId)
          .eq('allowed', true);
        permissions = (permRows ?? []).map((p) => p.permission_key as PermissionKey);
      }

      res.json({
        item: {
          id: updated.id,
          email: updated.email,
          fullName: updated.full_name,
          phone: updated.phone ?? '',
          avatarUrl: updated.avatar_url ?? '',
          role: nextRoleName,
          accountStatus: updated.account_status,
          permissions,
          lastLoginAt: updated.last_login_at,
          createdAt: updated.created_at
        }
      });
      return;
    }

    const db = getDbState();
    const target = db.admins.find((a) => a.id === targetId);
    if (!target) {
      res.status(404).json({ error: 'Administrator not found.' });
      return;
    }

    if (requestedRole && db.roles.some((r) => r.role === requestedRole)) {
      if (target.role === 'Super Admin' && requestedRole !== 'Super Admin') {
        const superCount = db.admins.filter((a) => a.role === 'Super Admin' && a.accountStatus === 'active').length;
        if (superCount <= 1) {
          res.status(400).json({ error: 'At least one active Super Admin must remain.' });
          return;
        }
      }
      target.role = requestedRole;
    }
    if (requestedStatus) {
      if (target.role === 'Super Admin' && requestedStatus === 'suspended') {
        const superCount = db.admins.filter((a) => a.role === 'Super Admin' && a.accountStatus === 'active').length;
        if (superCount <= 1) {
          res.status(400).json({ error: 'At least one active Super Admin must remain active.' });
          return;
        }
      }
      target.accountStatus = requestedStatus;
    }
    if (req.body?.fullName !== undefined) target.fullName = sanitizeText(req.body.fullName, 120) || target.fullName;
    if (req.body?.phone !== undefined) target.phone = sanitizeText(req.body.phone, 40);
    target.updatedAt = new Date().toISOString();

    appendActivityLog(db, {
      actorId: req.adminUser!.id,
      actorEmail: req.adminUser!.email,
      actorRole: req.adminUser!.role,
      action: 'admin_user_updated',
      entityType: 'admin_user',
      entityId: target.id,
      summary: `Updated admin ${target.email} (role: ${target.role}, status: ${target.accountStatus}).`
    });
    saveDbState(db);

    res.json({
      item: {
        id: target.id,
        email: target.email,
        fullName: target.fullName,
        phone: target.phone,
        avatarUrl: target.avatarUrl,
        role: target.role,
        accountStatus: target.accountStatus,
        permissions: getPermissionsForRole(db, target.role),
        lastLoginAt: target.lastLoginAt,
        createdAt: target.createdAt
      }
    });
  });

  router.put('/admin/roles/:roleName', requireAdmin, requirePermission('admin_users.manage'), async (req: AuthenticatedRequest, res) => {
    const roleName = sanitizeText(req.params.roleName, 40) as AdminRoleName;
    if (roleName === 'Super Admin') {
      res.status(400).json({ error: 'Super Admin retains all platform permissions.' });
      return;
    }

    const requestedPerms: PermissionKey[] = Array.isArray(req.body?.permissions)
      ? req.body.permissions.filter((p: unknown): p is PermissionKey => ALL_PERMISSION_KEYS.includes(p as PermissionKey))
      : [];

    const sb = getSupabaseAdminClient();
    if (sb) {
      const roles = await ensureSupabaseSystemRoles(sb);
      const roleRow = roles.find((r) => r.name === roleName);
      if (!roleRow) {
        res.status(404).json({ error: 'Role not found.' });
        return;
      }

      await sb.from('role_permissions').delete().eq('role_id', roleRow.id);
      if (requestedPerms.length > 0) {
        const { error: insErr } = await sb.from('role_permissions').insert(
          requestedPerms.map((perm) => ({
            role_id: roleRow.id,
            permission_key: perm,
            allowed: true
          }))
        );
        if (insErr) {
          res.status(500).json({ error: `Failed to save role permissions: ${insErr.message}` });
          return;
        }
      }

      await insertSupabaseAuditLog(sb, {
        actorId: req.adminUser!.id,
        actorEmail: req.adminUser!.email,
        actorRole: req.adminUser!.role,
        action: 'role_permissions_updated',
        entityType: 'admin_role',
        entityId: roleName,
        summary: `Updated permissions for role ${roleName} (${requestedPerms.length} granted).`
      });

      res.json({
        item: {
          role: roleName,
          description: roleRow.description,
          permissions: requestedPerms
        }
      });
      return;
    }

    const db = getDbState();
    const role = db.roles.find((r) => r.role === roleName);
    if (!role) {
      res.status(404).json({ error: 'Role not found.' });
      return;
    }

    role.permissions = requestedPerms;
    appendActivityLog(db, {
      actorId: req.adminUser!.id,
      actorEmail: req.adminUser!.email,
      actorRole: req.adminUser!.role,
      action: 'role_permissions_updated',
      entityType: 'admin_role',
      entityId: role.role,
      summary: `Updated permissions for role ${role.role} (${requestedPerms.length} granted).`
    });
    saveDbState(db);
    res.json({ item: role });
  });

  // Protected Profile Self-Update (does NOT allow changing role or permissions)
  router.patch('/admin/profile', requireAdmin, async (req: AuthenticatedRequest, res) => {
    const nextName = req.body?.fullName !== undefined ? sanitizeText(req.body.fullName, 120) : undefined;
    const nextPhone = req.body?.phone !== undefined ? sanitizeText(req.body.phone, 40) : undefined;

    const sb = getSupabaseAdminClient();
    if (sb) {
      const updates: Record<string, string> = {};
      if (nextName) updates.full_name = nextName;
      if (nextPhone !== undefined) updates.phone = nextPhone;
      const { error } = await sb.from('profiles').update(updates).eq('id', req.adminUser!.id);
      if (error) {
        res.status(500).json({ error: error.message });
        return;
      }
      res.json({
        user: {
          ...req.adminUser!,
          fullName: nextName || req.adminUser!.fullName,
          phone: nextPhone !== undefined ? nextPhone : req.adminUser!.phone
        }
      });
      return;
    }

    const db = getDbState();
    const admin = db.admins.find((a) => a.id === req.adminUser!.id);
    if (!admin) {
      res.status(404).json({ error: 'Profile not found.' });
      return;
    }
    if (nextName) admin.fullName = nextName;
    if (nextPhone !== undefined) admin.phone = nextPhone;
    admin.updatedAt = new Date().toISOString();
    saveDbState(db);
    res.json({
      user: {
        ...req.adminUser!,
        fullName: admin.fullName,
        phone: admin.phone
      }
    });
  });

  // ===========================================================================
  // 12. SECURE PRIVATE FILE ACCESS (Authenticated Admin Only + Path Confinement)
  // ===========================================================================
  router.get('/admin/files/:bucket/:filename', requireAdmin, (req, res) => {
    const bucket = sanitizeText(req.params.bucket, 40);
    const filename = sanitizeText(req.params.filename, 180);
    if (!['work-order-attachments', 'vendor-documents', 'dispatch-attachments', 'gallery'].includes(bucket)) {
      res.status(400).json({ error: 'Invalid bucket.' });
      return;
    }
    const safePath = resolveSafeFilePath(UPLOADS_ROOT, bucket, filename);
    if (!safePath || !fs.existsSync(safePath)) {
      res.status(404).json({ error: 'File not found.' });
      return;
    }
    res.sendFile(safePath);
  });

  router.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const message = err instanceof Error ? err.message : 'Internal server error.';
    if (!res.headersSent) {
      res.status(500).json({ error: message });
    }
  });

  return router;
}
