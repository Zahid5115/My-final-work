import crypto from 'node:crypto';
import fs from 'node:fs';
import type express from 'express';
import type { ReviewPublicationStatus } from '../../src/types/platform.ts';
import { PRIORITY_LEVELS } from '../../src/types/platform.ts';
import { isEmailServiceConfigured } from '../email.ts';
import {
  isSafeMediaUrl,
  isValidEmail,
  resolveSafeFilePath,
  rowsToCsv,
  sanitizeText
} from '../security.ts';
import {
  UPLOADS_ROOT,
  appendActivityLog,
  getDbState,
  saveDbState
} from '../store.ts';
import { getSupabaseAdminClient, isProductionEnvironment } from '../supabaseAdmin.ts';
import {
  DEFAULT_NOTIFICATION_EVENTS,
  getSupabaseBusinessSettings,
  getSupabaseNotificationPrefs,
  getVendorNameMap,
  isUuid,
  mapActivityLogRow,
  mapBidRequestRow,
  mapClientRow,
  mapCoverageRow,
  mapDispatchRow,
  mapGalleryRow,
  mapMessageRow,
  mapNotificationRow,
  mapReviewRow,
  mapServiceRow,
  mapSettingsRow,
  mapVendorRow,
  mapWorkOrderRow
} from '../supabaseRepo.ts';
import {
  type AuthenticatedRequest,
  computeDateCutoff,
  insertSupabaseAuditLog,
  persistUploadedFile,
  requireAdmin,
  requirePermission,
  uploadImageMiddleware
} from './shared.ts';

export function registerCmsAndSystemRoutes(router: express.Router): void {
  // ===========================================================================
  // 9. SERVICES, GALLERY, COVERAGE & REVIEWS CMS
  // ===========================================================================
  router.get('/admin/services', requireAdmin, requirePermission('services.manage'), async (_req, res, next) => {
    try {
      const sb = getSupabaseAdminClient();
      if (sb) {
        const { data, error } = await sb.from('services').select('*').order('sort_order', { ascending: true });
        if (error) {
          res.status(500).json({ error: error.message });
          return;
        }
        res.json({ items: (data ?? []).map((r) => mapServiceRow(r as Record<string, unknown>)) });
        return;
      }

      const db = getDbState();
      res.json({ items: [...db.services].sort((a, b) => a.sortOrder - b.sortOrder) });
    } catch (err) {
      next(err);
    }
  });

  router.post('/admin/services', requireAdmin, requirePermission('services.manage'), async (req: AuthenticatedRequest, res, next) => {
    try {
      const title = sanitizeText(req.body?.title, 140);
      const subtitle = sanitizeText(req.body?.subtitle, 500);
      if (!title || !subtitle) {
        res.status(400).json({ error: 'Service title and description are required.' });
        return;
      }

      const slug = `${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${Date.now().toString().slice(-4)}`;
      const itemsList = Array.isArray(req.body?.items)
        ? req.body.items.map((i: unknown) => sanitizeText(i, 200)).filter(Boolean)
        : [];
      const rawImageUrl = sanitizeText(req.body?.imageUrl, 500);
      const safeImageUrl = isSafeMediaUrl(rawImageUrl) ? rawImageUrl : '';

      const sb = getSupabaseAdminClient();
      if (sb) {
        const { count } = await sb.from('services').select('id', { count: 'exact', head: true });
        const sortOrder = (count ?? 0) + 1;
        const nextNum = `${String(sortOrder).padStart(2, '0')}.`;

        const { data: inserted, error: insErr } = await sb
          .from('services')
          .insert({
            service_number: sanitizeText(req.body?.serviceNumber, 12) || nextNum,
            slug,
            title,
            subtitle,
            category: sanitizeText(req.body?.category, 140) || title,
            pricing_model: sanitizeText(req.body?.pricingModel, 80) || 'Per Work Order',
            base_price: Number(req.body?.basePrice) || 0,
            turnaround: sanitizeText(req.body?.turnaround, 80) || '48 hr SLA',
            items: itemsList,
            compliance_note: sanitizeText(req.body?.complianceNote, 240),
            image_url: safeImageUrl,
            is_visible: req.body?.isVisible !== false,
            sort_order: sortOrder,
            is_archived: false,
            is_demo: false
          })
          .select('*')
          .single();

        if (insErr || !inserted) {
          res.status(500).json({ error: insErr?.message || 'Unable to create service.' });
          return;
        }

        const service = mapServiceRow(inserted as Record<string, unknown>);
        await insertSupabaseAuditLog(sb, {
          actorId: req.adminUser!.id,
          actorEmail: req.adminUser!.email,
          actorRole: req.adminUser!.role,
          action: 'service_created',
          entityType: 'service',
          entityId: service.id,
          summary: `Created service "${service.title}".`
        });
        res.status(201).json({ item: service });
        return;
      }

      const db = getDbState();
      const now = new Date().toISOString();
      const nextNum = `${String(db.services.length + 1).padStart(2, '0')}.`;
      const service = {
        id: crypto.randomUUID(),
        serviceNumber: sanitizeText(req.body?.serviceNumber, 12) || nextNum,
        slug,
        title,
        subtitle,
        category: sanitizeText(req.body?.category, 140) || title,
        pricingModel: sanitizeText(req.body?.pricingModel, 80) || 'Per Work Order',
        basePrice: Number(req.body?.basePrice) || 0,
        turnaround: sanitizeText(req.body?.turnaround, 80) || '48 hr SLA',
        items: itemsList,
        complianceNote: sanitizeText(req.body?.complianceNote, 240),
        imageUrl: safeImageUrl,
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
    } catch (err) {
      next(err);
    }
  });

  router.patch('/admin/services/:id', requireAdmin, requirePermission('services.manage'), async (req: AuthenticatedRequest, res, next) => {
    try {
      const sb = getSupabaseAdminClient();
      if (sb) {
        if (!isUuid(req.params.id)) {
          res.status(404).json({ error: 'Service not found.' });
          return;
        }
        const updates: Record<string, unknown> = {};
        if (req.body?.serviceNumber !== undefined) updates.service_number = sanitizeText(req.body.serviceNumber, 12);
        if (req.body?.title !== undefined) updates.title = sanitizeText(req.body.title, 140);
        if (req.body?.subtitle !== undefined) updates.subtitle = sanitizeText(req.body.subtitle, 500);
        if (req.body?.category !== undefined) updates.category = sanitizeText(req.body.category, 140);
        if (req.body?.pricingModel !== undefined) updates.pricing_model = sanitizeText(req.body.pricingModel, 80);
        if (req.body?.basePrice !== undefined) updates.base_price = Number(req.body.basePrice) || 0;
        if (req.body?.turnaround !== undefined) updates.turnaround = sanitizeText(req.body.turnaround, 80);
        if (Array.isArray(req.body?.items)) updates.items = req.body.items.map((i: unknown) => sanitizeText(i, 200)).filter(Boolean);
        if (req.body?.complianceNote !== undefined) updates.compliance_note = sanitizeText(req.body.complianceNote, 240);
        if (req.body?.imageUrl !== undefined) {
          const url = sanitizeText(req.body.imageUrl, 500);
          if (isSafeMediaUrl(url)) updates.image_url = url;
        }
        if (req.body?.isVisible !== undefined) updates.is_visible = Boolean(req.body.isVisible);
        if (req.body?.isArchived !== undefined) updates.is_archived = Boolean(req.body.isArchived);
        if (req.body?.sortOrder !== undefined) updates.sort_order = Number(req.body.sortOrder) || 0;

        const { data: updated, error: updErr } = await sb
          .from('services')
          .update(updates)
          .eq('id', req.params.id)
          .select('*')
          .maybeSingle();

        if (updErr) {
          res.status(500).json({ error: updErr.message });
          return;
        }
        if (!updated) {
          res.status(404).json({ error: 'Service not found.' });
          return;
        }

        const svc = mapServiceRow(updated as Record<string, unknown>);
        await insertSupabaseAuditLog(sb, {
          actorId: req.adminUser!.id,
          actorEmail: req.adminUser!.email,
          actorRole: req.adminUser!.role,
          action: 'service_updated',
          entityType: 'service',
          entityId: svc.id,
          summary: `Updated service "${svc.title}".`
        });
        res.json({ item: svc });
        return;
      }

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
    } catch (err) {
      next(err);
    }
  });

  router.delete('/admin/services/:id', requireAdmin, requirePermission('services.manage'), async (req: AuthenticatedRequest, res, next) => {
    try {
      const sb = getSupabaseAdminClient();
      if (sb) {
        if (!isUuid(req.params.id)) {
          res.status(404).json({ error: 'Service not found.' });
          return;
        }
        const { data: existing } = await sb.from('services').select('id, title').eq('id', req.params.id).maybeSingle();
        if (!existing) {
          res.status(404).json({ error: 'Service not found.' });
          return;
        }
        const { error: delErr } = await sb.from('services').delete().eq('id', req.params.id);
        if (delErr) {
          res.status(500).json({ error: delErr.message });
          return;
        }
        await insertSupabaseAuditLog(sb, {
          actorId: req.adminUser!.id,
          actorEmail: req.adminUser!.email,
          actorRole: req.adminUser!.role,
          action: 'service_deleted',
          entityType: 'service',
          entityId: existing.id,
          summary: `Removed service "${existing.title}".`
        });
        res.json({ ok: true });
        return;
      }

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
    } catch (err) {
      next(err);
    }
  });

  // Gallery
  router.get('/admin/gallery', requireAdmin, requirePermission('gallery.manage'), async (_req, res, next) => {
    try {
      const sb = getSupabaseAdminClient();
      if (sb) {
        const { data, error } = await sb.from('gallery_cases').select('*').order('sort_order', { ascending: true });
        if (error) {
          res.status(500).json({ error: error.message });
          return;
        }
        res.json({ items: (data ?? []).map((r) => mapGalleryRow(r as Record<string, unknown>)) });
        return;
      }

      const db = getDbState();
      res.json({ items: [...db.galleryCases].sort((a, b) => a.sortOrder - b.sortOrder) });
    } catch (err) {
      next(err);
    }
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

  router.post('/admin/gallery', requireAdmin, requirePermission('gallery.manage'), async (req: AuthenticatedRequest, res, next) => {
    try {
      const title = sanitizeText(req.body?.title, 160);
      const location = sanitizeText(req.body?.location, 120);
      const beforeImage = sanitizeText(req.body?.beforeImage, 500);
      const afterImage = sanitizeText(req.body?.afterImage, 500);

      if (!title || !location || !beforeImage || !afterImage || !isSafeMediaUrl(beforeImage) || !isSafeMediaUrl(afterImage)) {
        res.status(400).json({ error: 'Title, location, and valid before/after image URLs are required.' });
        return;
      }

      const slug = `${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${Date.now().toString().slice(-4)}`;
      const workOrderId = sanitizeText(req.body?.workOrderId, 60) || `WO-${Math.floor(88000 + Math.random() * 9999)}`;
      const scopeSummary = sanitizeText(req.body?.scopeSummary, 600);
      const turnaroundHours = Math.max(1, Number(req.body?.turnaroundHours) || 36);
      const beforeAlt = sanitizeText(req.body?.beforeAlt, 240) || `Before photo for ${title}`;
      const afterAlt = sanitizeText(req.body?.afterAlt, 240) || `After photo for ${title}`;
      const isPublished = req.body?.isPublished !== false;

      const sb = getSupabaseAdminClient();
      if (sb) {
        const { count } = await sb.from('gallery_cases').select('id', { count: 'exact', head: true });
        const { data: inserted, error: insErr } = await sb
          .from('gallery_cases')
          .insert({
            slug,
            title,
            location,
            work_order_code: workOrderId,
            scope_summary: scopeSummary,
            turnaround_hours: turnaroundHours,
            before_image_url: beforeImage,
            after_image_url: afterImage,
            before_alt: beforeAlt,
            after_alt: afterAlt,
            is_published: isPublished,
            sort_order: (count ?? 0) + 1,
            is_demo: false
          })
          .select('*')
          .single();

        if (insErr || !inserted) {
          res.status(500).json({ error: insErr?.message || 'Unable to create gallery case.' });
          return;
        }
        const item = mapGalleryRow(inserted as Record<string, unknown>);
        await insertSupabaseAuditLog(sb, {
          actorId: req.adminUser!.id,
          actorEmail: req.adminUser!.email,
          actorRole: req.adminUser!.role,
          action: 'gallery_case_created',
          entityType: 'gallery',
          entityId: item.id,
          summary: `Added gallery case "${item.title}".`
        });
        res.status(201).json({ item });
        return;
      }

      const db = getDbState();
      const item = {
        id: crypto.randomUUID(),
        slug,
        title,
        location,
        workOrderId,
        scopeSummary,
        turnaroundHours,
        beforeImage,
        afterImage,
        beforeAlt,
        afterAlt,
        isPublished,
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
    } catch (err) {
      next(err);
    }
  });

  router.patch('/admin/gallery/:id', requireAdmin, requirePermission('gallery.manage'), async (req: AuthenticatedRequest, res, next) => {
    try {
      const sb = getSupabaseAdminClient();
      if (sb) {
        if (!isUuid(req.params.id)) {
          res.status(404).json({ error: 'Gallery case not found.' });
          return;
        }
        const updates: Record<string, unknown> = {};
        if (req.body?.title !== undefined) updates.title = sanitizeText(req.body.title, 160);
        if (req.body?.location !== undefined) updates.location = sanitizeText(req.body.location, 120);
        if (req.body?.workOrderId !== undefined) updates.work_order_code = sanitizeText(req.body.workOrderId, 60);
        if (req.body?.scopeSummary !== undefined) updates.scope_summary = sanitizeText(req.body.scopeSummary, 600);
        if (req.body?.turnaroundHours !== undefined) updates.turnaround_hours = Math.max(1, Number(req.body.turnaroundHours) || 36);
        if (req.body?.beforeImage && isSafeMediaUrl(req.body.beforeImage)) updates.before_image_url = sanitizeText(req.body.beforeImage, 500);
        if (req.body?.afterImage && isSafeMediaUrl(req.body.afterImage)) updates.after_image_url = sanitizeText(req.body.afterImage, 500);
        if (req.body?.beforeAlt !== undefined) updates.before_alt = sanitizeText(req.body.beforeAlt, 240);
        if (req.body?.afterAlt !== undefined) updates.after_alt = sanitizeText(req.body.afterAlt, 240);
        if (req.body?.isPublished !== undefined) updates.is_published = Boolean(req.body.isPublished);
        if (req.body?.sortOrder !== undefined) updates.sort_order = Number(req.body.sortOrder) || 0;

        const { data: updated, error: updErr } = await sb
          .from('gallery_cases')
          .update(updates)
          .eq('id', req.params.id)
          .select('*')
          .maybeSingle();

        if (updErr) {
          res.status(500).json({ error: updErr.message });
          return;
        }
        if (!updated) {
          res.status(404).json({ error: 'Gallery case not found.' });
          return;
        }

        const item = mapGalleryRow(updated as Record<string, unknown>);
        await insertSupabaseAuditLog(sb, {
          actorId: req.adminUser!.id,
          actorEmail: req.adminUser!.email,
          actorRole: req.adminUser!.role,
          action: 'gallery_case_updated',
          entityType: 'gallery',
          entityId: item.id,
          summary: `Updated gallery case "${item.title}" (published: ${item.isPublished}).`
        });
        res.json({ item });
        return;
      }

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
    } catch (err) {
      next(err);
    }
  });

  router.delete('/admin/gallery/:id', requireAdmin, requirePermission('gallery.manage'), async (req: AuthenticatedRequest, res, next) => {
    try {
      const sb = getSupabaseAdminClient();
      if (sb) {
        if (!isUuid(req.params.id)) {
          res.status(404).json({ error: 'Gallery case not found.' });
          return;
        }
        const { data: existing } = await sb.from('gallery_cases').select('id, title').eq('id', req.params.id).maybeSingle();
        if (!existing) {
          res.status(404).json({ error: 'Gallery case not found.' });
          return;
        }
        const { error: delErr } = await sb.from('gallery_cases').delete().eq('id', req.params.id);
        if (delErr) {
          res.status(500).json({ error: delErr.message });
          return;
        }
        await insertSupabaseAuditLog(sb, {
          actorId: req.adminUser!.id,
          actorEmail: req.adminUser!.email,
          actorRole: req.adminUser!.role,
          action: 'gallery_case_deleted',
          entityType: 'gallery',
          entityId: existing.id,
          summary: `Deleted gallery case "${existing.title}".`
        });
        res.json({ ok: true });
        return;
      }

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
    } catch (err) {
      next(err);
    }
  });

  // Coverage Regions
  router.get('/admin/coverage', requireAdmin, requirePermission('coverage.manage'), async (_req, res, next) => {
    try {
      const sb = getSupabaseAdminClient();
      if (sb) {
        const { data, error } = await sb
          .from('coverage_regions')
          .select('*')
          .order('is_headquarters', { ascending: false });
        if (error) {
          res.status(500).json({ error: error.message });
          return;
        }
        res.json({ items: (data ?? []).map((r) => mapCoverageRow(r as Record<string, unknown>)) });
        return;
      }

      res.json({ items: getDbState().coverageRegions });
    } catch (err) {
      next(err);
    }
  });

  router.post('/admin/coverage', requireAdmin, requirePermission('coverage.manage'), async (req: AuthenticatedRequest, res, next) => {
    try {
      const region = sanitizeText(req.body?.region, 140);
      const hubCity = sanitizeText(req.body?.hubCity, 120);
      if (!region || !hubCity) {
        res.status(400).json({ error: 'Region name and hub city are required.' });
        return;
      }

      const states = Array.isArray(req.body?.states)
        ? req.body.states.map((s: unknown) => sanitizeText(s, 10)).filter(Boolean)
        : [];
      const counties = Array.isArray(req.body?.counties)
        ? req.body.counties.map((c: unknown) => sanitizeText(c, 80)).filter(Boolean)
        : [];
      const activeCounties = Math.max(0, Number(req.body?.activeCounties) || 0);
      const avgDispatchHours = Math.max(1, Number(req.body?.avgDispatchHours) || 24);
      const hudStandard = sanitizeText(req.body?.hudStandard, 240);
      const lat = req.body?.lat !== undefined && req.body?.lat !== '' ? Number(req.body.lat) : null;
      const lng = req.body?.lng !== undefined && req.body?.lng !== '' ? Number(req.body.lng) : null;
      const isHeadquarters = Boolean(req.body?.isHeadquarters);
      const coverageStatus = (['Active', 'Expanding', 'Paused'].includes(req.body?.coverageStatus) ? req.body.coverageStatus : 'Active') as 'Active' | 'Expanding' | 'Paused';
      const isPublished = req.body?.isPublished !== false;

      const sb = getSupabaseAdminClient();
      if (sb) {
        const { data: inserted, error: insErr } = await sb
          .from('coverage_regions')
          .insert({
            region_name: region,
            hub_city: hubCity,
            states,
            counties,
            active_counties: activeCounties,
            avg_dispatch_hours: avgDispatchHours,
            hud_standard: hudStandard,
            lat,
            lng,
            is_headquarters: isHeadquarters,
            coverage_status: coverageStatus,
            is_published: isPublished,
            is_demo: false
          })
          .select('*')
          .single();

        if (insErr || !inserted) {
          res.status(500).json({ error: insErr?.message || 'Unable to create coverage region.' });
          return;
        }
        const item = mapCoverageRow(inserted as Record<string, unknown>);
        await insertSupabaseAuditLog(sb, {
          actorId: req.adminUser!.id,
          actorEmail: req.adminUser!.email,
          actorRole: req.adminUser!.role,
          action: 'coverage_region_created',
          entityType: 'coverage',
          entityId: item.id,
          summary: `Added coverage region "${item.region}".`
        });
        res.status(201).json({ item });
        return;
      }

      const db = getDbState();
      const item = {
        id: crypto.randomUUID(),
        region,
        hubCity,
        states,
        counties,
        activeCounties,
        avgDispatchHours,
        hudStandard,
        lat,
        lng,
        isHeadquarters,
        coverageStatus,
        isPublished,
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
    } catch (err) {
      next(err);
    }
  });

  router.patch('/admin/coverage/:id', requireAdmin, requirePermission('coverage.manage'), async (req: AuthenticatedRequest, res, next) => {
    try {
      const sb = getSupabaseAdminClient();
      if (sb) {
        if (!isUuid(req.params.id)) {
          res.status(404).json({ error: 'Coverage region not found.' });
          return;
        }
        const updates: Record<string, unknown> = {};
        if (req.body?.region !== undefined) updates.region_name = sanitizeText(req.body.region, 140);
        if (req.body?.hubCity !== undefined) updates.hub_city = sanitizeText(req.body.hubCity, 120);
        if (Array.isArray(req.body?.states)) updates.states = req.body.states.map((s: unknown) => sanitizeText(s, 10)).filter(Boolean);
        if (Array.isArray(req.body?.counties)) updates.counties = req.body.counties.map((c: unknown) => sanitizeText(c, 80)).filter(Boolean);
        if (req.body?.activeCounties !== undefined) updates.active_counties = Math.max(0, Number(req.body.activeCounties) || 0);
        if (req.body?.avgDispatchHours !== undefined) updates.avg_dispatch_hours = Math.max(1, Number(req.body.avgDispatchHours) || 24);
        if (req.body?.hudStandard !== undefined) updates.hud_standard = sanitizeText(req.body.hudStandard, 240);
        if (req.body?.lat !== undefined) updates.lat = req.body.lat === null || req.body.lat === '' ? null : Number(req.body.lat);
        if (req.body?.lng !== undefined) updates.lng = req.body.lng === null || req.body.lng === '' ? null : Number(req.body.lng);
        if (req.body?.isHeadquarters !== undefined) updates.is_headquarters = Boolean(req.body.isHeadquarters);
        if (['Active', 'Expanding', 'Paused'].includes(req.body?.coverageStatus)) updates.coverage_status = req.body.coverageStatus;
        if (req.body?.isPublished !== undefined) updates.is_published = Boolean(req.body.isPublished);

        const { data: updated, error: updErr } = await sb
          .from('coverage_regions')
          .update(updates)
          .eq('id', req.params.id)
          .select('*')
          .maybeSingle();

        if (updErr) {
          res.status(500).json({ error: updErr.message });
          return;
        }
        if (!updated) {
          res.status(404).json({ error: 'Coverage region not found.' });
          return;
        }

        const item = mapCoverageRow(updated as Record<string, unknown>);
        await insertSupabaseAuditLog(sb, {
          actorId: req.adminUser!.id,
          actorEmail: req.adminUser!.email,
          actorRole: req.adminUser!.role,
          action: 'coverage_region_updated',
          entityType: 'coverage',
          entityId: item.id,
          summary: `Updated coverage region "${item.region}".`
        });
        res.json({ item });
        return;
      }

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
    } catch (err) {
      next(err);
    }
  });

  router.delete('/admin/coverage/:id', requireAdmin, requirePermission('coverage.manage'), async (req: AuthenticatedRequest, res, next) => {
    try {
      const sb = getSupabaseAdminClient();
      if (sb) {
        if (!isUuid(req.params.id)) {
          res.status(404).json({ error: 'Coverage region not found.' });
          return;
        }
        const { data: existing } = await sb.from('coverage_regions').select('id, region_name').eq('id', req.params.id).maybeSingle();
        if (!existing) {
          res.status(404).json({ error: 'Coverage region not found.' });
          return;
        }
        const { error: delErr } = await sb.from('coverage_regions').delete().eq('id', req.params.id);
        if (delErr) {
          res.status(500).json({ error: delErr.message });
          return;
        }
        await insertSupabaseAuditLog(sb, {
          actorId: req.adminUser!.id,
          actorEmail: req.adminUser!.email,
          actorRole: req.adminUser!.role,
          action: 'coverage_region_deleted',
          entityType: 'coverage',
          entityId: existing.id,
          summary: `Removed coverage region "${existing.region_name}".`
        });
        res.json({ ok: true });
        return;
      }

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
    } catch (err) {
      next(err);
    }
  });

  // Reviews
  router.get('/admin/reviews', requireAdmin, requirePermission('reviews.manage'), async (_req, res, next) => {
    try {
      const sb = getSupabaseAdminClient();
      if (sb) {
        const { data, error } = await sb.from('reviews').select('*').order('sort_order', { ascending: true });
        if (error) {
          res.status(500).json({ error: error.message });
          return;
        }
        res.json({ items: (data ?? []).map((r) => mapReviewRow(r as Record<string, unknown>)) });
        return;
      }

      const items = [...getDbState().reviews].sort((a, b) => a.sortOrder - b.sortOrder);
      res.json({ items });
    } catch (err) {
      next(err);
    }
  });

  router.post('/admin/reviews', requireAdmin, requirePermission('reviews.manage'), async (req: AuthenticatedRequest, res, next) => {
    try {
      const reviewer = sanitizeText(req.body?.reviewer, 120);
      const comment = sanitizeText(req.body?.comment, 2000);
      if (!reviewer || !comment) {
        res.status(400).json({ error: 'Reviewer name and comment are required.' });
        return;
      }

      const statusRaw = sanitizeText(req.body?.publicationStatus, 30) as ReviewPublicationStatus;
      const publicationStatus = (['Pending', 'Approved', 'Published', 'Hidden'].includes(statusRaw) ? statusRaw : 'Published') as ReviewPublicationStatus;

      const sb = getSupabaseAdminClient();
      if (sb) {
        const { count } = await sb.from('reviews').select('id', { count: 'exact', head: true });
        const { data: inserted, error: insErr } = await sb
          .from('reviews')
          .insert({
            reviewer_name: reviewer,
            organization: sanitizeText(req.body?.organization, 140),
            role: sanitizeText(req.body?.role, 120),
            rating: Math.min(5, Math.max(1, Number(req.body?.rating) || 5)),
            comment,
            service_tag: sanitizeText(req.body?.serviceTag, 140),
            review_date_label: sanitizeText(req.body?.dateLabel, 60) || 'Recently',
            is_verified_customer: false,
            publication_status: publicationStatus,
            sort_order: (count ?? 0) + 1,
            is_demo: false
          })
          .select('*')
          .single();

        if (insErr || !inserted) {
          res.status(500).json({ error: insErr?.message || 'Unable to create review.' });
          return;
        }
        const item = mapReviewRow(inserted as Record<string, unknown>);
        await insertSupabaseAuditLog(sb, {
          actorId: req.adminUser!.id,
          actorEmail: req.adminUser!.email,
          actorRole: req.adminUser!.role,
          action: 'review_created',
          entityType: 'review',
          entityId: item.id,
          summary: `Added manual review entry for ${item.reviewer}.`
        });
        res.status(201).json({ item });
        return;
      }

      const db = getDbState();
      const item = {
        id: crypto.randomUUID(),
        reviewer,
        organization: sanitizeText(req.body?.organization, 140),
        role: sanitizeText(req.body?.role, 120),
        rating: Math.min(5, Math.max(1, Number(req.body?.rating) || 5)),
        comment,
        serviceTag: sanitizeText(req.body?.serviceTag, 140),
        dateLabel: sanitizeText(req.body?.dateLabel, 60) || 'Recently',
        isVerifiedCustomer: false,
        publicationStatus,
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
    } catch (err) {
      next(err);
    }
  });

  router.patch('/admin/reviews/:id', requireAdmin, requirePermission('reviews.manage'), async (req: AuthenticatedRequest, res, next) => {
    try {
      const sb = getSupabaseAdminClient();
      if (sb) {
        if (!isUuid(req.params.id)) {
          res.status(404).json({ error: 'Review not found.' });
          return;
        }
        const updates: Record<string, unknown> = {};
        if (req.body?.reviewer !== undefined) updates.reviewer_name = sanitizeText(req.body.reviewer, 120);
        if (req.body?.organization !== undefined) updates.organization = sanitizeText(req.body.organization, 140);
        if (req.body?.role !== undefined) updates.role = sanitizeText(req.body.role, 120);
        if (req.body?.rating !== undefined) updates.rating = Math.min(5, Math.max(1, Number(req.body.rating) || 5));
        if (req.body?.comment !== undefined) updates.comment = sanitizeText(req.body.comment, 2000);
        if (req.body?.serviceTag !== undefined) updates.service_tag = sanitizeText(req.body.serviceTag, 140);
        if (req.body?.dateLabel !== undefined) updates.review_date_label = sanitizeText(req.body.dateLabel, 60);
        if (['Pending', 'Approved', 'Published', 'Hidden'].includes(req.body?.publicationStatus)) {
          updates.publication_status = req.body.publicationStatus;
        }
        if (req.body?.sortOrder !== undefined) updates.sort_order = Number(req.body.sortOrder) || 0;

        const { data: updated, error: updErr } = await sb
          .from('reviews')
          .update(updates)
          .eq('id', req.params.id)
          .select('*')
          .maybeSingle();

        if (updErr) {
          res.status(500).json({ error: updErr.message });
          return;
        }
        if (!updated) {
          res.status(404).json({ error: 'Review not found.' });
          return;
        }

        const item = mapReviewRow(updated as Record<string, unknown>);
        await insertSupabaseAuditLog(sb, {
          actorId: req.adminUser!.id,
          actorEmail: req.adminUser!.email,
          actorRole: req.adminUser!.role,
          action: 'review_updated',
          entityType: 'review',
          entityId: item.id,
          summary: `Updated review for ${item.reviewer} (${item.publicationStatus}).`
        });
        res.json({ item });
        return;
      }

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
    } catch (err) {
      next(err);
    }
  });

  router.delete('/admin/reviews/:id', requireAdmin, requirePermission('reviews.manage'), async (req: AuthenticatedRequest, res, next) => {
    try {
      const sb = getSupabaseAdminClient();
      if (sb) {
        if (!isUuid(req.params.id)) {
          res.status(404).json({ error: 'Review not found.' });
          return;
        }
        const { data: existing } = await sb.from('reviews').select('id, reviewer_name').eq('id', req.params.id).maybeSingle();
        if (!existing) {
          res.status(404).json({ error: 'Review not found.' });
          return;
        }
        const { error: delErr } = await sb.from('reviews').delete().eq('id', req.params.id);
        if (delErr) {
          res.status(500).json({ error: delErr.message });
          return;
        }
        await insertSupabaseAuditLog(sb, {
          actorId: req.adminUser!.id,
          actorEmail: req.adminUser!.email,
          actorRole: req.adminUser!.role,
          action: 'review_deleted',
          entityType: 'review',
          entityId: existing.id,
          summary: `Deleted review for ${existing.reviewer_name}.`
        });
        res.json({ ok: true });
        return;
      }

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
    } catch (err) {
      next(err);
    }
  });

  // ===========================================================================
  // 10. MESSAGES, REPORTS, NOTIFICATIONS, AUDIT LOGS & SETTINGS
  // ===========================================================================
  router.get('/admin/messages', requireAdmin, requirePermission('messages.manage'), async (req, res, next) => {
    try {
      const status = sanitizeText(req.query.status, 30);
      const q = sanitizeText(req.query.q, 120).toLowerCase();

      const sb = getSupabaseAdminClient();
      let allItems;
      if (sb) {
        const { data, error } = await sb
          .from('messages')
          .select('*')
          .order('created_at', { ascending: false });
        if (error) {
          res.status(500).json({ error: error.message });
          return;
        }
        allItems = (data ?? []).map((r) => mapMessageRow(r as Record<string, unknown>));
      } else {
        allItems = getDbState().messages;
      }

      const items = allItems.filter((m) => {
        if (status && status !== 'All' && m.status !== status) return false;
        if (q) {
          const hay = `${m.senderName} ${m.senderEmail} ${m.senderPhone} ${m.subject} ${m.body}`.toLowerCase();
          if (!hay.includes(q)) return false;
        }
        return true;
      });
      res.json({ items });
    } catch (err) {
      next(err);
    }
  });

  router.patch('/admin/messages/:id', requireAdmin, requirePermission('messages.manage'), async (req: AuthenticatedRequest, res, next) => {
    try {
      const sb = getSupabaseAdminClient();
      if (sb) {
        if (!isUuid(req.params.id)) {
          res.status(404).json({ error: 'Message not found.' });
          return;
        }
        const updates: Record<string, unknown> = {};
        if (['Unread', 'Read', 'Responded', 'Archived'].includes(req.body?.status)) updates.status = req.body.status;
        if (req.body?.internalNotes !== undefined) updates.internal_notes = sanitizeText(req.body.internalNotes, 2000);
        if (req.body?.linkedClientId !== undefined) updates.linked_client_id = req.body.linkedClientId || null;
        if (req.body?.linkedBidRequestId !== undefined) updates.linked_bid_request_id = req.body.linkedBidRequestId || null;
        if (req.body?.linkedWorkOrderId !== undefined) updates.linked_work_order_id = req.body.linkedWorkOrderId || null;
        if (req.body?.linkedDispatchId !== undefined) updates.linked_dispatch_id = req.body.linkedDispatchId || null;

        const { data: updated, error: updErr } = await sb
          .from('messages')
          .update(updates)
          .eq('id', req.params.id)
          .select('*')
          .maybeSingle();

        if (updErr) {
          res.status(500).json({ error: updErr.message });
          return;
        }
        if (!updated) {
          res.status(404).json({ error: 'Message not found.' });
          return;
        }
        res.json({ item: mapMessageRow(updated as Record<string, unknown>) });
        return;
      }

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
    } catch (err) {
      next(err);
    }
  });

  router.get('/admin/reports', requireAdmin, requirePermission('reports.view'), async (req, res, next) => {
    try {
      const range = sanitizeText(req.query.range, 20) || 'all';
      const fromStr = sanitizeText(req.query.from, 40);
      const toStr = sanitizeText(req.query.to, 40);
      const { start, end } = range === 'all' ? { start: 0, end: Date.now() + 86400000 } : computeDateCutoff(range, fromStr, toStr);
      const inRange = (iso: string) => {
        const ts = new Date(iso).getTime();
        return ts >= start && ts <= end;
      };

      const sb = getSupabaseAdminClient();
      let allWorkOrders;
      let allBids;
      let allDispatches;
      let vendors;
      let clients;

      if (sb) {
        const [woRes, bidRes, dispRes, vndRes, cliRes] = await Promise.all([
          sb.from('work_orders').select('*').eq('is_archived', false),
          sb.from('bid_requests').select('*'),
          sb.from('dispatch_requests').select('*'),
          sb.from('vendors').select('*'),
          sb.from('clients').select('*')
        ]);
        const firstErr = woRes.error || bidRes.error || dispRes.error || vndRes.error || cliRes.error;
        if (firstErr) {
          res.status(500).json({ error: firstErr.message });
          return;
        }
        vendors = (vndRes.data ?? []).map((r) => mapVendorRow(r as Record<string, unknown>));
        const vendorNames = new Map(vendors.map((v) => [v.id, v.companyName]));
        allWorkOrders = (woRes.data ?? []).map((r) => mapWorkOrderRow(r as Record<string, unknown>, vendorNames));
        allBids = (bidRes.data ?? []).map((r) => mapBidRequestRow(r as Record<string, unknown>));
        allDispatches = (dispRes.data ?? []).map((r) => mapDispatchRow(r as Record<string, unknown>, vendorNames));
        clients = (cliRes.data ?? []).map((r) => mapClientRow(r as Record<string, unknown>));
      } else {
        const db = getDbState();
        allWorkOrders = db.workOrders.filter((w) => !w.isArchived);
        allBids = db.bidRequests;
        allDispatches = db.dispatchRequests;
        vendors = db.vendors;
        clients = db.clients;
      }

      const workOrders = allWorkOrders.filter((w) => inRange(w.createdDate));
      const bids = allBids.filter((b) => inRange(b.createdAt));
      const dispatches = allDispatches.filter((d) => inRange(d.submittedDate));

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
          activeClientsCount: clients.filter((c) => c.accountStatus === 'active').length,
          approvedVendorsCount: vendors.filter((v) => v.applicationStatus === 'Approved').length
        },
        serviceReport: Object.values(serviceMap),
        vendorReport: vendors.map((v) => ({
          id: v.id,
          vendorCode: v.vendorCode,
          companyName: v.companyName,
          applicationStatus: v.applicationStatus,
          completedWorkOrders: v.completedWorkOrders,
          assignedActive: workOrders.filter((w) => w.assignedVendorId === v.id).length,
          rating: v.rating
        })),
        clientReport: clients.map((c) => ({
          id: c.id,
          clientCode: c.clientCode,
          name: c.companyName || c.contactName,
          clientType: c.clientType,
          workOrdersCount: workOrders.filter((w) => w.clientId === c.id).length,
          totalBudget: workOrders.filter((w) => w.clientId === c.id).reduce((s, w) => s + (w.approvedBudget ?? w.estimatedBudget), 0)
        }))
      });
    } catch (err) {
      next(err);
    }
  });

  router.get('/admin/reports/export', requireAdmin, requirePermission('reports.export'), async (req, res, next) => {
    try {
      const type = sanitizeText(req.query.type, 40) || 'work-orders';
      const sb = getSupabaseAdminClient();
      let csv = '';

      if (type === 'vendors') {
        const vendors = sb
          ? ((await sb.from('vendors').select('*').order('registration_date', { ascending: false })).data ?? []).map((r) =>
              mapVendorRow(r as Record<string, unknown>)
            )
          : getDbState().vendors;
        csv = rowsToCsv(
          ['Vendor Code', 'Company Name', 'Contact', 'Email', 'Phone', 'Coverage', 'Status', 'Completed WOs', 'Rating'],
          vendors.map((v) => [
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
        const bids = sb
          ? ((await sb.from('bid_requests').select('*').order('created_at', { ascending: false })).data ?? []).map((r) =>
              mapBidRequestRow(r as Record<string, unknown>)
            )
          : getDbState().bidRequests;
        csv = rowsToCsv(
          ['Request Code', 'Contact', 'Email', 'Phone', 'Address', 'Services', 'Status', 'Created'],
          bids.map((b) => [
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
        const dispatches = sb
          ? await (async () => {
              const [dRes, vNames] = await Promise.all([
                sb.from('dispatch_requests').select('*').order('submitted_at', { ascending: false }),
                getVendorNameMap(sb)
              ]);
              return (dRes.data ?? []).map((r) => mapDispatchRow(r as Record<string, unknown>, vNames));
            })()
          : getDbState().dispatchRequests;
        csv = rowsToCsv(
          ['Dispatch Code', 'Contact', 'Phone', 'Address', 'Emergency Type', 'Priority', 'Status', 'Assigned Vendor', 'Submitted'],
          dispatches.map((d) => [
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
        const workOrders = sb
          ? await (async () => {
              const [wRes, vNames] = await Promise.all([
                sb.from('work_orders').select('*').order('created_at', { ascending: false }),
                getVendorNameMap(sb)
              ]);
              return (wRes.data ?? []).map((r) => mapWorkOrderRow(r as Record<string, unknown>, vNames));
            })()
          : getDbState().workOrders;
        csv = rowsToCsv(
          ['Work Order Code', 'Client', 'Client Type', 'Address', 'City', 'State', 'Category', 'Priority', 'Status', 'Estimated Budget', 'Approved Budget', 'Assigned Vendor', 'SLA Deadline', 'Demo'],
          workOrders.map((w) => [
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
    } catch (err) {
      next(err);
    }
  });

  router.get('/admin/notifications', requireAdmin, async (_req, res, next) => {
    try {
      const sb = getSupabaseAdminClient();
      if (sb) {
        const [itemsRes, countRes] = await Promise.all([
          sb.from('notifications').select('*').order('created_at', { ascending: false }).limit(60),
          sb.from('notifications').select('id', { count: 'exact', head: true }).eq('is_read', false)
        ]);
        if (itemsRes.error) {
          res.status(500).json({ error: itemsRes.error.message });
          return;
        }
        res.json({
          items: (itemsRes.data ?? []).map((r) => mapNotificationRow(r as Record<string, unknown>)),
          unreadCount: countRes.count ?? 0
        });
        return;
      }

      const db = getDbState();
      res.json({
        items: db.notifications.slice(0, 60),
        unreadCount: db.notifications.filter((n) => !n.isRead).length
      });
    } catch (err) {
      next(err);
    }
  });

  router.patch('/admin/notifications/:id/read', requireAdmin, async (req, res, next) => {
    try {
      const sb = getSupabaseAdminClient();
      if (sb) {
        if (isUuid(req.params.id)) {
          await sb.from('notifications').update({ is_read: true }).eq('id', req.params.id);
        }
        res.json({ ok: true });
        return;
      }

      const db = getDbState();
      const n = db.notifications.find((item) => item.id === req.params.id);
      if (n) {
        n.isRead = true;
        saveDbState(db);
      }
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  router.post('/admin/notifications/read-all', requireAdmin, async (_req, res, next) => {
    try {
      const sb = getSupabaseAdminClient();
      if (sb) {
        await sb.from('notifications').update({ is_read: true }).eq('is_read', false);
        res.json({ ok: true });
        return;
      }

      const db = getDbState();
      for (const n of db.notifications) n.isRead = true;
      saveDbState(db);
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  router.get('/admin/activity-logs', requireAdmin, requirePermission('audit.view'), async (req, res, next) => {
    try {
      const entityType = sanitizeText(req.query.entityType, 40);

      const sb = getSupabaseAdminClient();
      if (sb) {
        let query = sb.from('admin_activity_logs').select('*').order('created_at', { ascending: false }).limit(250);
        if (entityType && entityType !== 'All') {
          query = query.eq('entity_type', entityType);
        }
        const { data, error } = await query;
        if (error) {
          res.status(500).json({ error: error.message });
          return;
        }
        res.json({ items: (data ?? []).map((r) => mapActivityLogRow(r as Record<string, unknown>)) });
        return;
      }

      const db = getDbState();
      const items = db.activityLogs.filter((l) => !entityType || entityType === 'All' || l.entityType === entityType);
      res.json({ items: items.slice(0, 250) });
    } catch (err) {
      next(err);
    }
  });

  router.get('/admin/settings', requireAdmin, async (req: AuthenticatedRequest, res, next) => {
    try {
      const sb = getSupabaseAdminClient();
      if (sb) {
        const [businessSettings, notificationPreferences] = await Promise.all([
          getSupabaseBusinessSettings(sb),
          getSupabaseNotificationPrefs(sb, req.adminUser!.id)
        ]);
        res.json({
          businessSettings,
          notificationPreferences,
          emailServiceConfigured: isEmailServiceConfigured()
        });
        return;
      }

      const db = getDbState();
      const prefs = db.notificationPreferences[req.adminUser!.id] ?? {
        emailEnabled: false,
        events: { ...DEFAULT_NOTIFICATION_EVENTS }
      };
      res.json({
        businessSettings: db.businessSettings,
        notificationPreferences: prefs,
        emailServiceConfigured: isEmailServiceConfigured()
      });
    } catch (err) {
      next(err);
    }
  });

  router.put('/admin/settings', requireAdmin, requirePermission('settings.manage'), async (req: AuthenticatedRequest, res, next) => {
    try {
      const sb = getSupabaseAdminClient();
      if (sb) {
        const current = await getSupabaseBusinessSettings(sb);
        const payload = {
          id: 1,
          business_name: req.body?.businessName !== undefined ? sanitizeText(req.body.businessName, 160) : current.businessName,
          phone: req.body?.phone !== undefined ? sanitizeText(req.body.phone, 40) : current.phone,
          email: req.body?.email !== undefined && isValidEmail(req.body.email) ? sanitizeText(req.body.email, 254) : current.email,
          address: req.body?.address !== undefined ? sanitizeText(req.body.address, 240) : current.address,
          hours: req.body?.hours !== undefined ? sanitizeText(req.body.hours, 160) : current.hours,
          logo_url: req.body?.logoUrl !== undefined && isSafeMediaUrl(req.body.logoUrl) ? sanitizeText(req.body.logoUrl, 500) : current.logoUrl,
          default_wo_priority: PRIORITY_LEVELS.includes(req.body?.defaultWoPriority) ? req.body.defaultWoPriority : current.defaultWoPriority,
          default_sla_hours: req.body?.defaultSlaHours !== undefined ? Math.max(4, Number(req.body.defaultSlaHours) || 48) : current.defaultSlaHours,
          auto_notify_urgent: req.body?.autoNotifyUrgent !== undefined ? Boolean(req.body.autoNotifyUrgent) : current.autoNotifyUrgent,
          coverage_radius_note: req.body?.coverageRadiusNote !== undefined ? sanitizeText(req.body.coverageRadiusNote, 160) : current.coverageRadiusNote
        };

        const { data: savedRow, error: updErr } = await sb
          .from('business_settings')
          .upsert(payload, { onConflict: 'id' })
          .select('*')
          .single();

        if (updErr || !savedRow) {
          res.status(500).json({ error: updErr?.message || 'Unable to save business settings.' });
          return;
        }

        await insertSupabaseAuditLog(sb, {
          actorId: req.adminUser!.id,
          actorEmail: req.adminUser!.email,
          actorRole: req.adminUser!.role,
          action: 'settings_updated',
          entityType: 'settings',
          entityId: 'business_settings',
          summary: 'Updated business & SLA settings.'
        });
        res.json({ businessSettings: mapSettingsRow(savedRow as Record<string, unknown>) });
        return;
      }

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
        summary: 'Updated business & SLA settings.'
      });
      saveDbState(db);
      res.json({ businessSettings: s });
    } catch (err) {
      next(err);
    }
  });

  router.put('/admin/notification-preferences', requireAdmin, async (req: AuthenticatedRequest, res, next) => {
    try {
      const emailEnabled = Boolean(req.body?.emailEnabled);
      const events = typeof req.body?.events === 'object' && req.body.events ? req.body.events : {};

      const sb = getSupabaseAdminClient();
      if (sb) {
        const { error: upsertErr } = await sb.from('notification_preferences').upsert(
          {
            profile_id: req.adminUser!.id,
            email_enabled: emailEnabled,
            events_config: events
          },
          { onConflict: 'profile_id' }
        );
        if (upsertErr) {
          res.status(500).json({ error: upsertErr.message });
          return;
        }
        res.json({ notificationPreferences: { emailEnabled, events } });
        return;
      }

      const db = getDbState();
      db.notificationPreferences[req.adminUser!.id] = { emailEnabled, events };
      saveDbState(db);
      res.json({ notificationPreferences: db.notificationPreferences[req.adminUser!.id] });
    } catch (err) {
      next(err);
    }
  });

  // ===========================================================================
  // 12. SECURE PRIVATE FILE ACCESS (Supabase Storage or Local Dev Uploads)
  // ===========================================================================
  router.get('/admin/files/:bucket/:filename', requireAdmin, async (req, res, next) => {
    try {
      const bucket = sanitizeText(req.params.bucket, 40);
      const filename = sanitizeText(req.params.filename, 180);
      if (!['work-order-attachments', 'vendor-documents', 'dispatch-attachments', 'gallery'].includes(bucket)) {
        res.status(400).json({ error: 'Invalid bucket.' });
        return;
      }
      if (!/^[a-zA-Z0-9._-]+$/.test(filename)) {
        res.status(400).json({ error: 'Invalid filename.' });
        return;
      }

      const sb = getSupabaseAdminClient();
      if (sb) {
        const { data, error } = await sb.storage.from(bucket).download(filename);
        if (error || !data) {
          res.status(404).json({ error: 'File not found in storage.' });
          return;
        }
        const buf = Buffer.from(await data.arrayBuffer());
        res.setHeader('Content-Type', data.type || 'application/octet-stream');
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.send(buf);
        return;
      }

      if (isProductionEnvironment()) {
        res.status(503).json({ error: 'Supabase Storage is required in production.' });
        return;
      }

      const safePath = resolveSafeFilePath(UPLOADS_ROOT, bucket, filename);
      if (!safePath || !fs.existsSync(safePath)) {
        res.status(404).json({ error: 'File not found.' });
        return;
      }
      res.sendFile(safePath);
    } catch (err) {
      next(err);
    }
  });
}
