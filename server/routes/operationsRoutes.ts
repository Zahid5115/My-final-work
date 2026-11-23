import crypto from 'node:crypto';
import type express from 'express';
import type {
  BidRequestStatus,
  ClientType,
  DispatchStatus,
  PriorityLevel,
  VendorApplicationStatus,
  VendorBidStatus,
  WorkOrderStatus
} from '../../src/types/platform.ts';
import {
  BID_REQUEST_STATUSES,
  CLIENT_TYPES,
  DISPATCH_STATUSES,
  PRIORITY_LEVELS,
  VENDOR_APPLICATION_STATUSES,
  WORK_ORDER_STATUSES
} from '../../src/types/platform.ts';
import { isValidEmail, sanitizeText } from '../security.ts';
import {
  appendActivityLog,
  appendNotification,
  appendWorkOrderTimeline,
  getDbState,
  saveDbState
} from '../store.ts';
import { getSupabaseAdminClient } from '../supabaseAdmin.ts';
import {
  getProfileNameMap,
  getSupabaseBusinessSettings,
  getVendorNameMap,
  getWorkOrderCodeMap,
  insertSupabaseNotification,
  insertSupabaseWorkOrderTimeline,
  isUuid,
  mapActivityLogRow,
  mapBidRequestRow,
  mapClientPropertyRow,
  mapClientRow,
  mapDispatchRow,
  mapMessageRow,
  mapVendorBidRow,
  mapVendorDocRow,
  mapVendorRow,
  mapWorkOrderAttachmentRow,
  mapWorkOrderNoteRow,
  mapWorkOrderRow,
  mapWorkOrderTimelineRow
} from '../supabaseRepo.ts';
import {
  type AuthenticatedRequest,
  computeDateCutoff,
  insertSupabaseAuditLog,
  persistUploadedFile,
  requireAdmin,
  requirePermission,
  uploadAttachmentMiddleware
} from './shared.ts';

export function registerOperationsRoutes(router: express.Router): void {
  // ===========================================================================
  // 3. PROTECTED ADMIN DASHBOARD & ANALYTICS
  // ===========================================================================
  router.get('/admin/dashboard', requireAdmin, requirePermission('dashboard.view'), async (req, res, next) => {
    try {
      const range = sanitizeText(req.query.range, 20) || '30d';
      const fromStr = sanitizeText(req.query.from, 40);
      const toStr = sanitizeText(req.query.to, 40);
      const { start, end } = computeDateCutoff(range, fromStr, toStr);
      const inRange = (iso: string) => {
        const ts = new Date(iso).getTime();
        return ts >= start && ts <= end;
      };

      const sb = getSupabaseAdminClient();
      let allWOs;
      let bidRequests;
      let dispatchRequests;
      let vendors;
      let clients;
      let activityLogs;

      if (sb) {
        const [woRes, bidRes, dispRes, vndRes, cliRes, actRes] = await Promise.all([
          sb.from('work_orders').select('*').eq('is_archived', false).order('created_at', { ascending: false }),
          sb.from('bid_requests').select('*').order('created_at', { ascending: false }),
          sb.from('dispatch_requests').select('*').order('submitted_at', { ascending: false }),
          sb.from('vendors').select('*').order('registration_date', { ascending: false }),
          sb.from('clients').select('*').order('created_at', { ascending: false }),
          sb.from('admin_activity_logs').select('*').order('created_at', { ascending: false }).limit(8)
        ]);
        const firstErr = woRes.error || bidRes.error || dispRes.error || vndRes.error || cliRes.error || actRes.error;
        if (firstErr) {
          res.status(500).json({ error: `Unable to load dashboard metrics: ${firstErr.message}` });
          return;
        }
        vendors = (vndRes.data ?? []).map((r) => mapVendorRow(r as Record<string, unknown>));
        const vendorNames = new Map(vendors.map((v) => [v.id, v.companyName]));
        allWOs = (woRes.data ?? []).map((r) => mapWorkOrderRow(r as Record<string, unknown>, vendorNames));
        bidRequests = (bidRes.data ?? []).map((r) => mapBidRequestRow(r as Record<string, unknown>));
        dispatchRequests = (dispRes.data ?? []).map((r) => mapDispatchRow(r as Record<string, unknown>, vendorNames));
        clients = (cliRes.data ?? []).map((r) => mapClientRow(r as Record<string, unknown>));
        activityLogs = (actRes.data ?? []).map((r) => mapActivityLogRow(r as Record<string, unknown>));
      } else {
        const db = getDbState();
        allWOs = db.workOrders.filter((w) => !w.isArchived);
        bidRequests = db.bidRequests;
        dispatchRequests = db.dispatchRequests;
        vendors = db.vendors;
        clients = db.clients;
        activityLogs = db.activityLogs.slice(0, 8);
      }

      const filteredWOs = range === 'all' ? allWOs : allWOs.filter((w) => inRange(w.createdDate));
      const filteredBids = range === 'all' ? bidRequests : bidRequests.filter((b) => inRange(b.createdAt));
      const filteredDispatch = range === 'all' ? dispatchRequests : dispatchRequests.filter((d) => inRange(d.submittedDate));

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

      const vendorPerformance = vendors
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
          totalVendors: vendors.length,
          pendingVendorApplications: vendors.filter((v) => v.applicationStatus === 'Pending' || v.applicationStatus === 'Under Review').length,
          activeClients: clients.filter((c) => c.accountStatus === 'active').length,
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
          recentActivity: activityLogs,
          recentBidRequests: bidRequests.filter((b) => !b.isArchived).slice(0, 5),
          recentDispatchRequests: dispatchRequests.slice(0, 5),
          upcomingSlaDeadlines: upcomingSlaWOs.slice(0, 6),
          overdueWorkOrders: overdueWOs.slice(0, 6),
          recentClients: clients.filter((c) => c.accountStatus === 'active').slice(0, 5)
        }
      });
    } catch (err) {
      next(err);
    }
  });

  // ===========================================================================
  // 4. WORK ORDER MANAGEMENT
  // ===========================================================================
  router.get('/admin/work-orders', requireAdmin, requirePermission('work_orders.read'), async (req, res, next) => {
    try {
      const status = sanitizeText(req.query.status, 40);
      const priority = sanitizeText(req.query.priority, 20);
      const q = sanitizeText(req.query.q, 120).toLowerCase();
      const includeArchived = req.query.archived === 'true';

      const sb = getSupabaseAdminClient();
      let allItems;
      if (sb) {
        let query = sb.from('work_orders').select('*').order('created_at', { ascending: false });
        if (!includeArchived) query = query.eq('is_archived', false);
        const [woRes, vendorNames] = await Promise.all([query, getVendorNameMap(sb)]);
        if (woRes.error) {
          res.status(500).json({ error: `Failed to load work orders: ${woRes.error.message}` });
          return;
        }
        allItems = (woRes.data ?? []).map((r) => mapWorkOrderRow(r as Record<string, unknown>, vendorNames));
      } else {
        allItems = getDbState().workOrders;
      }

      const items = allItems.filter((w) => {
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
    } catch (err) {
      next(err);
    }
  });

  router.post('/admin/work-orders', requireAdmin, requirePermission('work_orders.write'), async (req: AuthenticatedRequest, res, next) => {
    try {
      const clientId = sanitizeText(req.body?.clientId, 80) || null;
      const propertyAddress = sanitizeText(req.body?.propertyAddress, 240);
      const city = sanitizeText(req.body?.city, 80);
      const stateCode = sanitizeText(req.body?.state, 40);
      const serviceCategory = sanitizeText(req.body?.serviceCategory, 140);
      const serviceDescription = sanitizeText(req.body?.serviceDescription, 2000);
      const clientTypeRaw = sanitizeText(req.body?.clientType, 60) as ClientType;
      const priorityRaw = sanitizeText(req.body?.priority, 20) as PriorityLevel;
      const statusRaw = sanitizeText(req.body?.status, 40) as WorkOrderStatus;
      const vendorId = sanitizeText(req.body?.assignedVendorId, 80) || null;
      const code = `SLC-${new Date().getFullYear().toString().slice(-2)}-${Math.floor(4200 + Math.random() * 5700)}`;

      if (!propertyAddress || !city || !stateCode || !serviceCategory || !serviceDescription) {
        res.status(400).json({ error: 'Property address, city, state, service category, and description are required.' });
        return;
      }

      const sb = getSupabaseAdminClient();
      if (sb) {
        const settings = await getSupabaseBusinessSettings(sb);
        let linkedClient: Record<string, unknown> | null = null;
        if (clientId && isUuid(clientId)) {
          const { data } = await sb.from('clients').select('*').eq('id', clientId).maybeSingle();
          linkedClient = (data as Record<string, unknown> | null) ?? null;
        }
        let linkedVendor: Record<string, unknown> | null = null;
        if (vendorId && isUuid(vendorId)) {
          const { data } = await sb.from('vendors').select('id, company_name').eq('id', vendorId).maybeSingle();
          linkedVendor = (data as Record<string, unknown> | null) ?? null;
        }

        const resolvedClientType: ClientType = CLIENT_TYPES.includes(clientTypeRaw)
          ? clientTypeRaw
          : ((linkedClient?.client_type as ClientType) || 'Property Manager');
        const resolvedPriority: PriorityLevel = PRIORITY_LEVELS.includes(priorityRaw)
          ? priorityRaw
          : settings.defaultWoPriority;
        const resolvedStatus: WorkOrderStatus = WORK_ORDER_STATUSES.includes(statusRaw)
          ? statusRaw
          : linkedVendor
          ? 'Dispatched'
          : 'New';
        const slaDeadline =
          sanitizeText(req.body?.slaDeadline, 40) ||
          new Date(Date.now() + settings.defaultSlaHours * 3600 * 1000).toISOString();

        const { data: inserted, error: insErr } = await sb
          .from('work_orders')
          .insert({
            work_order_code: code,
            client_id: linkedClient ? String(linkedClient.id) : null,
            client_name:
              (linkedClient?.company_name as string) ||
              (linkedClient?.contact_name as string) ||
              sanitizeText(req.body?.clientName, 140) ||
              'Direct Client',
            client_type: resolvedClientType,
            property_address: propertyAddress,
            city,
            state: stateCode,
            zip_code: sanitizeText(req.body?.zipCode, 20),
            county: sanitizeText(req.body?.county, 80),
            lat: req.body?.lat != null && req.body.lat !== '' ? Number(req.body.lat) : null,
            lng: req.body?.lng != null && req.body.lng !== '' ? Number(req.body.lng) : null,
            service_category: serviceCategory,
            service_description: serviceDescription,
            priority: resolvedPriority,
            estimated_budget: Number(req.body?.estimatedBudget) || 0,
            approved_budget:
              req.body?.approvedBudget != null && req.body.approvedBudget !== ''
                ? Number(req.body.approvedBudget)
                : null,
            assigned_vendor_id: linkedVendor ? String(linkedVendor.id) : null,
            scheduled_date: sanitizeText(req.body?.scheduledDate, 40) || null,
            sla_deadline: slaDeadline,
            status: resolvedStatus,
            qc_notes: '',
            is_archived: false,
            is_demo: false
          })
          .select('*')
          .single();

        if (insErr || !inserted) {
          res.status(500).json({ error: `Failed to create work order: ${insErr?.message || 'Unknown error'}` });
          return;
        }

        const vendorNames = new Map<string, string>();
        if (linkedVendor) vendorNames.set(String(linkedVendor.id), String(linkedVendor.company_name));
        const wo = mapWorkOrderRow(inserted as Record<string, unknown>, vendorNames);

        await Promise.all([
          insertSupabaseWorkOrderTimeline(
            sb,
            wo.id,
            req.adminUser!.fullName,
            'created',
            `Work order ${code} created (${wo.status}).`
          ),
          insertSupabaseNotification(sb, {
            eventType: 'new_work_order',
            title: `Work Order ${code} Created`,
            message: `${wo.serviceCategory} at ${wo.propertyAddress}, ${wo.city}, ${wo.state}.`,
            entityType: 'work_order',
            entityId: wo.id
          }),
          insertSupabaseAuditLog(sb, {
            actorId: req.adminUser!.id,
            actorEmail: req.adminUser!.email,
            actorRole: req.adminUser!.role,
            action: 'work_order_created',
            entityType: 'work_order',
            entityId: wo.id,
            summary: `Created work order ${code} for ${wo.propertyAddress}.`
          })
        ]);

        res.status(201).json({ item: wo });
        return;
      }

      const db = getDbState();
      const linkedClient = clientId ? db.clients.find((c) => c.id === clientId) : undefined;
      const linkedVendor = vendorId ? db.vendors.find((v) => v.id === vendorId) : undefined;

      const now = new Date().toISOString();
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
    } catch (err) {
      next(err);
    }
  });

  router.get('/admin/work-orders/:id', requireAdmin, requirePermission('work_orders.read'), async (req, res, next) => {
    try {
      const sb = getSupabaseAdminClient();
      if (sb) {
        const param = req.params.id;
        let woQuery = sb.from('work_orders').select('*');
        woQuery = isUuid(param) ? woQuery.eq('id', param) : woQuery.eq('work_order_code', param);
        const { data: woRow, error: woErr } = await woQuery.maybeSingle();
        if (woErr) {
          res.status(500).json({ error: `Failed to fetch work order: ${woErr.message}` });
          return;
        }
        if (!woRow) {
          res.status(404).json({ error: 'Work order not found.' });
          return;
        }

        const woId = String(woRow.id);
        const woCode = String(woRow.work_order_code ?? '');
        const [vendorNames, profileNames, clientRes, vendorRes, notesRes, attRes, tlRes, bidsRes, actRes] =
          await Promise.all([
            getVendorNameMap(sb),
            getProfileNameMap(sb),
            woRow.client_id ? sb.from('clients').select('*').eq('id', woRow.client_id).maybeSingle() : Promise.resolve({ data: null }),
            woRow.assigned_vendor_id ? sb.from('vendors').select('*').eq('id', woRow.assigned_vendor_id).maybeSingle() : Promise.resolve({ data: null }),
            sb.from('work_order_notes').select('*').eq('work_order_id', woId).order('created_at', { ascending: false }),
            sb.from('work_order_attachments').select('*').eq('work_order_id', woId).order('created_at', { ascending: false }),
            sb.from('work_order_timeline').select('*').eq('work_order_id', woId).order('created_at', { ascending: false }),
            sb.from('vendor_bids').select('*').eq('work_order_id', woId).order('submitted_at', { ascending: false }),
            sb.from('admin_activity_logs').select('*').eq('entity_type', 'work_order').eq('entity_id', woId).order('created_at', { ascending: false })
          ]);

        const woCodeMap = new Map([[woId, woCode]]);
        res.json({
          item: mapWorkOrderRow(woRow as Record<string, unknown>, vendorNames),
          client: clientRes.data ? mapClientRow(clientRes.data as Record<string, unknown>) : null,
          vendor: vendorRes.data ? mapVendorRow(vendorRes.data as Record<string, unknown>) : null,
          notes: (notesRes.data ?? []).map((r) => mapWorkOrderNoteRow(r as Record<string, unknown>)),
          attachments: (attRes.data ?? []).map((r) => mapWorkOrderAttachmentRow(r as Record<string, unknown>, profileNames)),
          timeline: (tlRes.data ?? []).map((r) => mapWorkOrderTimelineRow(r as Record<string, unknown>)),
          bids: (bidsRes.data ?? []).map((r) => mapVendorBidRow(r as Record<string, unknown>, woCodeMap)),
          activity: (actRes.data ?? []).map((r) => mapActivityLogRow(r as Record<string, unknown>))
        });
        return;
      }

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
    } catch (err) {
      next(err);
    }
  });

  router.patch('/admin/work-orders/:id', requireAdmin, requirePermission('work_orders.write'), async (req: AuthenticatedRequest, res, next) => {
    try {
      const sb = getSupabaseAdminClient();
      if (sb) {
        if (!isUuid(req.params.id)) {
          res.status(404).json({ error: 'Work order not found.' });
          return;
        }
        const { data: existing, error: fetchErr } = await sb
          .from('work_orders')
          .select('*')
          .eq('id', req.params.id)
          .maybeSingle();

        if (fetchErr) {
          res.status(500).json({ error: fetchErr.message });
          return;
        }
        if (!existing) {
          res.status(404).json({ error: 'Work order not found.' });
          return;
        }

        const prevStatus = existing.status as WorkOrderStatus;
        const updates: Record<string, unknown> = {};

        if (req.body?.clientName !== undefined) updates.client_name = sanitizeText(req.body.clientName, 140);
        if (req.body?.clientId !== undefined) {
          const cid = sanitizeText(req.body.clientId, 80) || null;
          updates.client_id = cid && isUuid(cid) ? cid : null;
          if (cid && isUuid(cid)) {
            const { data: c } = await sb.from('clients').select('company_name, contact_name, client_type').eq('id', cid).maybeSingle();
            if (c) {
              updates.client_name = c.company_name || c.contact_name;
              updates.client_type = c.client_type;
            }
          }
        }
        if (req.body?.clientType && CLIENT_TYPES.includes(req.body.clientType)) updates.client_type = req.body.clientType;
        if (req.body?.propertyAddress !== undefined) updates.property_address = sanitizeText(req.body.propertyAddress, 240);
        if (req.body?.city !== undefined) updates.city = sanitizeText(req.body.city, 80);
        if (req.body?.state !== undefined) updates.state = sanitizeText(req.body.state, 40);
        if (req.body?.zipCode !== undefined) updates.zip_code = sanitizeText(req.body.zipCode, 20);
        if (req.body?.county !== undefined) updates.county = sanitizeText(req.body.county, 80);
        if (req.body?.serviceCategory !== undefined) updates.service_category = sanitizeText(req.body.serviceCategory, 140);
        if (req.body?.serviceDescription !== undefined) updates.service_description = sanitizeText(req.body.serviceDescription, 2000);
        if (req.body?.priority && PRIORITY_LEVELS.includes(req.body.priority)) updates.priority = req.body.priority;
        if (req.body?.estimatedBudget !== undefined) updates.estimated_budget = Number(req.body.estimatedBudget) || 0;
        if (req.body?.approvedBudget !== undefined) {
          updates.approved_budget =
            req.body.approvedBudget === null || req.body.approvedBudget === '' ? null : Number(req.body.approvedBudget);
        }
        if (req.body?.scheduledDate !== undefined) updates.scheduled_date = req.body.scheduledDate || null;
        if (req.body?.slaDeadline !== undefined) updates.sla_deadline = req.body.slaDeadline || null;
        if (req.body?.status && WORK_ORDER_STATUSES.includes(req.body.status)) {
          updates.status = req.body.status;
          if (req.body.status === 'Completed' || req.body.status === 'QC Verified') {
            updates.completion_date = existing.completion_date || new Date().toISOString();
          }
        }
        if (req.body?.assignedVendorId !== undefined) {
          const vid = sanitizeText(req.body.assignedVendorId, 80) || null;
          updates.assigned_vendor_id = vid && isUuid(vid) ? vid : null;
        }
        if (req.body?.isArchived !== undefined) updates.is_archived = Boolean(req.body.isArchived);

        const { data: updated, error: updErr } = await sb
          .from('work_orders')
          .update(updates)
          .eq('id', req.params.id)
          .select('*')
          .single();

        if (updErr || !updated) {
          res.status(500).json({ error: updErr?.message || 'Unable to update work order.' });
          return;
        }

        const vendorNames = await getVendorNameMap(sb);
        const wo = mapWorkOrderRow(updated as Record<string, unknown>, vendorNames);

        if (wo.status !== prevStatus) {
          await insertSupabaseWorkOrderTimeline(
            sb,
            wo.id,
            req.adminUser!.fullName,
            'status_changed',
            `Status changed from ${prevStatus} to ${wo.status}.`
          );
          if (wo.status === 'Submitted for QC' || wo.status === 'Completed') {
            await insertSupabaseNotification(sb, {
              eventType: wo.status === 'Completed' ? 'work_order_completed' : 'work_order_qc_submitted',
              title: `${wo.workOrderCode}: ${wo.status}`,
              message: `${wo.serviceCategory} at ${wo.propertyAddress} is now ${wo.status}.`,
              entityType: 'work_order',
              entityId: wo.id
            });
          }
        }

        await insertSupabaseAuditLog(sb, {
          actorId: req.adminUser!.id,
          actorEmail: req.adminUser!.email,
          actorRole: req.adminUser!.role,
          action: 'work_order_updated',
          entityType: 'work_order',
          entityId: wo.id,
          summary: `Updated work order ${wo.workOrderCode} (${wo.status}).`
        });

        res.json({ item: wo });
        return;
      }

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
    } catch (err) {
      next(err);
    }
  });

  router.post('/admin/work-orders/:id/qc', requireAdmin, requirePermission('work_orders.qc'), async (req: AuthenticatedRequest, res, next) => {
    try {
      const decision = sanitizeText(req.body?.decision, 20);
      const qcNotes = sanitizeText(req.body?.qcNotes, 2000);
      if (!['approve', 'reject'].includes(decision)) {
        res.status(400).json({ error: 'QC decision must be approve or reject.' });
        return;
      }

      const sb = getSupabaseAdminClient();
      if (sb) {
        if (!isUuid(req.params.id)) {
          res.status(404).json({ error: 'Work order not found.' });
          return;
        }
        const { data: existing } = await sb.from('work_orders').select('id, completion_date, work_order_code').eq('id', req.params.id).maybeSingle();
        if (!existing) {
          res.status(404).json({ error: 'Work order not found.' });
          return;
        }

        const nextStatus: WorkOrderStatus = decision === 'approve' ? 'QC Verified' : 'QC Rejected';
        const updates: Record<string, unknown> = { status: nextStatus, qc_notes: qcNotes };
        if (decision === 'approve') {
          updates.completion_date = existing.completion_date || new Date().toISOString();
        }

        const { data: updated, error: updErr } = await sb
          .from('work_orders')
          .update(updates)
          .eq('id', req.params.id)
          .select('*')
          .single();
        if (updErr || !updated) {
          res.status(500).json({ error: updErr?.message || 'Unable to record QC decision.' });
          return;
        }

        const vendorNames = await getVendorNameMap(sb);
        const wo = mapWorkOrderRow(updated as Record<string, unknown>, vendorNames);

        await Promise.all([
          insertSupabaseWorkOrderTimeline(
            sb,
            wo.id,
            req.adminUser!.fullName,
            decision === 'approve' ? 'qc_approved' : 'qc_rejected',
            `QC ${decision === 'approve' ? 'Approved (QC Verified)' : 'Rejected'}${qcNotes ? `: ${qcNotes}` : '.'}`
          ),
          decision === 'reject'
            ? insertSupabaseNotification(sb, {
                eventType: 'qc_rejected',
                title: `QC Rejected: ${wo.workOrderCode}`,
                message: qcNotes || 'Corrections required on work order.',
                entityType: 'work_order',
                entityId: wo.id
              })
            : Promise.resolve(),
          insertSupabaseAuditLog(sb, {
            actorId: req.adminUser!.id,
            actorEmail: req.adminUser!.email,
            actorRole: req.adminUser!.role,
            action: `work_order_qc_${decision}`,
            entityType: 'work_order',
            entityId: wo.id,
            summary: `QC ${decision} on ${wo.workOrderCode}.`
          })
        ]);

        res.json({ item: wo });
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
    } catch (err) {
      next(err);
    }
  });

  router.post('/admin/work-orders/:id/notes', requireAdmin, requirePermission('work_orders.write'), async (req: AuthenticatedRequest, res, next) => {
    try {
      const body = sanitizeText(req.body?.body, 2500);
      const isInternal = req.body?.isInternal !== false;
      if (!body) {
        res.status(400).json({ error: 'Note text is required.' });
        return;
      }

      const sb = getSupabaseAdminClient();
      if (sb) {
        if (!isUuid(req.params.id)) {
          res.status(404).json({ error: 'Work order not found.' });
          return;
        }
        const { data: wo } = await sb.from('work_orders').select('id').eq('id', req.params.id).maybeSingle();
        if (!wo) {
          res.status(404).json({ error: 'Work order not found.' });
          return;
        }
        const { data: noteRow, error: noteErr } = await sb
          .from('work_order_notes')
          .insert({
            work_order_id: wo.id,
            author_id: req.adminUser!.id,
            author_name: req.adminUser!.fullName,
            is_internal: isInternal,
            body
          })
          .select('*')
          .single();

        if (noteErr || !noteRow) {
          res.status(500).json({ error: noteErr?.message || 'Unable to save note.' });
          return;
        }

        await insertSupabaseWorkOrderTimeline(
          sb,
          wo.id,
          req.adminUser!.fullName,
          'note_added',
          `Added ${isInternal ? 'internal' : 'client-visible'} note.`
        );
        res.status(201).json({ item: mapWorkOrderNoteRow(noteRow as Record<string, unknown>) });
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
    } catch (err) {
      next(err);
    }
  });

  router.post(
    '/admin/work-orders/:id/attachments',
    requireAdmin,
    requirePermission('work_orders.write'),
    uploadAttachmentMiddleware.single('file'),
    async (req: AuthenticatedRequest, res) => {
      try {
        if (!req.file) {
          res.status(400).json({ error: 'File is required.' });
          return;
        }
        const kindRaw = sanitizeText(req.body?.kind, 30);
        const kind = ['document', 'before_photo', 'after_photo'].includes(kindRaw)
          ? (kindRaw as 'document' | 'before_photo' | 'after_photo')
          : 'document';
        const fileName = sanitizeText(req.file.originalname, 180);

        const sb = getSupabaseAdminClient();
        if (sb) {
          if (!isUuid(req.params.id)) {
            res.status(404).json({ error: 'Work order not found.' });
            return;
          }
          const { data: wo } = await sb.from('work_orders').select('id').eq('id', req.params.id).maybeSingle();
          if (!wo) {
            res.status(404).json({ error: 'Work order not found.' });
            return;
          }

          const { storagePath } = await persistUploadedFile('work-order-attachments', req.file);
          const { data: attRow, error: attErr } = await sb
            .from('work_order_attachments')
            .insert({
              work_order_id: wo.id,
              kind,
              file_name: fileName,
              storage_bucket: 'work-order-attachments',
              storage_path: storagePath,
              mime_type: req.file.mimetype,
              file_size: req.file.size,
              uploaded_by: req.adminUser!.id
            })
            .select('*')
            .single();

          if (attErr || !attRow) {
            res.status(500).json({ error: attErr?.message || 'Unable to record attachment.' });
            return;
          }

          await insertSupabaseWorkOrderTimeline(
            sb,
            wo.id,
            req.adminUser!.fullName,
            'attachment_uploaded',
            `Uploaded ${kind.replace('_', ' ')}: ${fileName}.`
          );

          const profileNames = new Map([[req.adminUser!.id, req.adminUser!.fullName]]);
          res.status(201).json({
            item: mapWorkOrderAttachmentRow(attRow as Record<string, unknown>, profileNames)
          });
          return;
        }

        const db = getDbState();
        const wo = db.workOrders.find((w) => w.id === req.params.id);
        if (!wo) {
          res.status(404).json({ error: 'Work order not found.' });
          return;
        }

        const { storagePath } = await persistUploadedFile('work-order-attachments', req.file);
        const attachment = {
          id: crypto.randomUUID(),
          workOrderId: wo.id,
          kind,
          fileName,
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

  router.delete('/admin/work-orders/:id', requireAdmin, requirePermission('work_orders.delete'), async (req: AuthenticatedRequest, res, next) => {
    try {
      const sb = getSupabaseAdminClient();
      if (sb) {
        if (!isUuid(req.params.id)) {
          res.status(404).json({ error: 'Work order not found.' });
          return;
        }
        const { data: existing } = await sb
          .from('work_orders')
          .select('id, work_order_code')
          .eq('id', req.params.id)
          .maybeSingle();

        if (!existing) {
          res.status(404).json({ error: 'Work order not found.' });
          return;
        }

        const { error: delErr } = await sb.from('work_orders').delete().eq('id', req.params.id);
        if (delErr) {
          res.status(500).json({ error: delErr.message });
          return;
        }

        await insertSupabaseAuditLog(sb, {
          actorId: req.adminUser!.id,
          actorEmail: req.adminUser!.email,
          actorRole: req.adminUser!.role,
          action: 'work_order_deleted',
          entityType: 'work_order',
          entityId: existing.id,
          summary: `Permanently deleted work order ${existing.work_order_code}.`
        });
        res.json({ ok: true });
        return;
      }

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
    } catch (err) {
      next(err);
    }
  });

  // ===========================================================================
  // 5. VENDOR MANAGEMENT
  // ===========================================================================
  router.get('/admin/vendors', requireAdmin, requirePermission('vendors.read'), async (req, res, next) => {
    try {
      const status = sanitizeText(req.query.status, 40);
      const q = sanitizeText(req.query.q, 120).toLowerCase();

      const sb = getSupabaseAdminClient();
      let allItems;
      if (sb) {
        const { data, error } = await sb
          .from('vendors')
          .select('*')
          .order('registration_date', { ascending: false });
        if (error) {
          res.status(500).json({ error: error.message });
          return;
        }
        allItems = (data ?? []).map((r) => mapVendorRow(r as Record<string, unknown>));
      } else {
        allItems = getDbState().vendors;
      }

      const items = allItems.filter((v) => {
        if (status && status !== 'All' && v.applicationStatus !== status) return false;
        if (q) {
          const hay = `${v.vendorCode} ${v.companyName} ${v.contactPerson} ${v.email} ${v.coverageAreas} ${v.aspenGroveAbc}`.toLowerCase();
          if (!hay.includes(q)) return false;
        }
        return true;
      });
      res.json({ items });
    } catch (err) {
      next(err);
    }
  });

  router.post('/admin/vendors', requireAdmin, requirePermission('vendors.write'), async (req: AuthenticatedRequest, res, next) => {
    try {
      const companyName = sanitizeText(req.body?.companyName, 140);
      const contactPerson = sanitizeText(req.body?.contactPerson, 120);
      const email = sanitizeText(req.body?.email, 254).toLowerCase();
      const phone = sanitizeText(req.body?.phone, 40);
      if (!companyName || !contactPerson || !isValidEmail(email) || !phone) {
        res.status(400).json({ error: 'Company name, contact person, valid email, and phone are required.' });
        return;
      }

      const vendorCode = `VND-${Math.floor(10000 + Math.random() * 89999)}`;
      const appStatus = VENDOR_APPLICATION_STATUSES.includes(req.body?.applicationStatus)
        ? (req.body.applicationStatus as VendorApplicationStatus)
        : 'Approved';
      const accountStatus =
        appStatus === 'Approved' ? ('active' as const) : appStatus === 'Suspended' ? ('suspended' as const) : ('pending' as const);
      const serviceCategories = Array.isArray(req.body?.serviceCategories)
        ? req.body.serviceCategories.map((s: unknown) => sanitizeText(s, 80)).filter(Boolean)
        : [];
      const counties = Array.isArray(req.body?.counties)
        ? req.body.counties.map((c: unknown) => sanitizeText(c, 80)).filter(Boolean)
        : [];

      const sb = getSupabaseAdminClient();
      if (sb) {
        const { data: inserted, error: insErr } = await sb
          .from('vendors')
          .insert({
            vendor_code: vendorCode,
            company_name: companyName,
            contact_person: contactPerson,
            email,
            phone,
            address: sanitizeText(req.body?.address, 200),
            city: sanitizeText(req.body?.city, 80),
            state: sanitizeText(req.body?.state, 40),
            zip_code: sanitizeText(req.body?.zipCode, 20),
            service_categories: serviceCategories,
            coverage_areas: sanitizeText(req.body?.coverageAreas, 200),
            counties,
            license_info: sanitizeText(req.body?.licenseInfo, 160),
            insurance_info: sanitizeText(req.body?.insuranceInfo, 160),
            aspen_grove_abc: sanitizeText(req.body?.aspenGroveAbc, 60),
            application_status: appStatus,
            account_status: accountStatus,
            completed_work_orders: 0,
            notes: sanitizeText(req.body?.notes, 2000),
            is_demo: false
          })
          .select('*')
          .single();

        if (insErr || !inserted) {
          res.status(500).json({ error: insErr?.message || 'Unable to create vendor.' });
          return;
        }

        const vendor = mapVendorRow(inserted as Record<string, unknown>);
        await insertSupabaseAuditLog(sb, {
          actorId: req.adminUser!.id,
          actorEmail: req.adminUser!.email,
          actorRole: req.adminUser!.role,
          action: 'vendor_created',
          entityType: 'vendor',
          entityId: vendor.id,
          summary: `Created vendor ${vendor.companyName} (${vendor.vendorCode}).`
        });
        res.status(201).json({ item: vendor });
        return;
      }

      const db = getDbState();
      const now = new Date().toISOString();
      const vendor = {
        id: crypto.randomUUID(),
        vendorCode,
        companyName,
        contactPerson,
        email,
        phone,
        address: sanitizeText(req.body?.address, 200),
        city: sanitizeText(req.body?.city, 80),
        state: sanitizeText(req.body?.state, 40),
        zipCode: sanitizeText(req.body?.zipCode, 20),
        serviceCategories,
        coverageAreas: sanitizeText(req.body?.coverageAreas, 200),
        counties,
        licenseInfo: sanitizeText(req.body?.licenseInfo, 160),
        insuranceInfo: sanitizeText(req.body?.insuranceInfo, 160),
        aspenGroveAbc: sanitizeText(req.body?.aspenGroveAbc, 60),
        applicationStatus: appStatus,
        accountStatus,
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
    } catch (err) {
      next(err);
    }
  });

  router.get('/admin/vendors/:id', requireAdmin, requirePermission('vendors.read'), async (req, res, next) => {
    try {
      const sb = getSupabaseAdminClient();
      if (sb) {
        const param = req.params.id;
        let query = sb.from('vendors').select('*');
        query = isUuid(param) ? query.eq('id', param) : query.eq('vendor_code', param);
        const { data: vendorRow, error: vErr } = await query.maybeSingle();
        if (vErr) {
          res.status(500).json({ error: vErr.message });
          return;
        }
        if (!vendorRow) {
          res.status(404).json({ error: 'Vendor not found.' });
          return;
        }

        const vendor = mapVendorRow(vendorRow as Record<string, unknown>);
        const vendorNames = new Map([[vendor.id, vendor.companyName]]);
        const [woRes, bidRes, docRes, actRes, woCodeMap] = await Promise.all([
          sb.from('work_orders').select('*').eq('assigned_vendor_id', vendor.id).order('created_at', { ascending: false }),
          sb.from('vendor_bids').select('*').eq('vendor_id', vendor.id).order('submitted_at', { ascending: false }),
          sb.from('vendor_documents').select('*').eq('vendor_id', vendor.id).order('created_at', { ascending: false }),
          sb.from('admin_activity_logs').select('*').eq('entity_type', 'vendor').eq('entity_id', vendor.id).order('created_at', { ascending: false }),
          getWorkOrderCodeMap(sb)
        ]);

        res.json({
          item: vendor,
          workOrders: (woRes.data ?? []).map((r) => mapWorkOrderRow(r as Record<string, unknown>, vendorNames)),
          bids: (bidRes.data ?? []).map((r) => mapVendorBidRow(r as Record<string, unknown>, woCodeMap)),
          documents: (docRes.data ?? []).map((r) => mapVendorDocRow(r as Record<string, unknown>)),
          activity: (actRes.data ?? []).map((r) => mapActivityLogRow(r as Record<string, unknown>))
        });
        return;
      }

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
    } catch (err) {
      next(err);
    }
  });

  router.patch('/admin/vendors/:id', requireAdmin, requirePermission('vendors.write'), async (req: AuthenticatedRequest, res, next) => {
    try {
      const sb = getSupabaseAdminClient();
      if (sb) {
        if (!isUuid(req.params.id)) {
          res.status(404).json({ error: 'Vendor not found.' });
          return;
        }
        const updates: Record<string, unknown> = {};
        if (req.body?.companyName !== undefined) updates.company_name = sanitizeText(req.body.companyName, 140);
        if (req.body?.contactPerson !== undefined) updates.contact_person = sanitizeText(req.body.contactPerson, 120);
        if (req.body?.email !== undefined && isValidEmail(req.body.email)) updates.email = sanitizeText(req.body.email, 254).toLowerCase();
        if (req.body?.phone !== undefined) updates.phone = sanitizeText(req.body.phone, 40);
        if (req.body?.address !== undefined) updates.address = sanitizeText(req.body.address, 200);
        if (req.body?.city !== undefined) updates.city = sanitizeText(req.body.city, 80);
        if (req.body?.state !== undefined) updates.state = sanitizeText(req.body.state, 40);
        if (req.body?.zipCode !== undefined) updates.zip_code = sanitizeText(req.body.zipCode, 20);
        if (Array.isArray(req.body?.serviceCategories)) {
          updates.service_categories = req.body.serviceCategories.map((s: unknown) => sanitizeText(s, 80)).filter(Boolean);
        }
        if (req.body?.coverageAreas !== undefined) updates.coverage_areas = sanitizeText(req.body.coverageAreas, 200);
        if (Array.isArray(req.body?.counties)) {
          updates.counties = req.body.counties.map((c: unknown) => sanitizeText(c, 80)).filter(Boolean);
        }
        if (req.body?.licenseInfo !== undefined) updates.license_info = sanitizeText(req.body.licenseInfo, 160);
        if (req.body?.insuranceInfo !== undefined) updates.insurance_info = sanitizeText(req.body.insuranceInfo, 160);
        if (req.body?.aspenGroveAbc !== undefined) updates.aspen_grove_abc = sanitizeText(req.body.aspenGroveAbc, 60);
        if (req.body?.notes !== undefined) updates.notes = sanitizeText(req.body.notes, 2000);

        const { data: updated, error: updErr } = await sb
          .from('vendors')
          .update(updates)
          .eq('id', req.params.id)
          .select('*')
          .maybeSingle();

        if (updErr) {
          res.status(500).json({ error: updErr.message });
          return;
        }
        if (!updated) {
          res.status(404).json({ error: 'Vendor not found.' });
          return;
        }

        const vendor = mapVendorRow(updated as Record<string, unknown>);
        await insertSupabaseAuditLog(sb, {
          actorId: req.adminUser!.id,
          actorEmail: req.adminUser!.email,
          actorRole: req.adminUser!.role,
          action: 'vendor_updated',
          entityType: 'vendor',
          entityId: vendor.id,
          summary: `Updated profile for vendor ${vendor.companyName}.`
        });
        res.json({ item: vendor });
        return;
      }

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
    } catch (err) {
      next(err);
    }
  });

  router.post('/admin/vendors/:id/status', requireAdmin, requirePermission('vendors.approve'), async (req: AuthenticatedRequest, res, next) => {
    try {
      const status = sanitizeText(req.body?.applicationStatus, 40) as VendorApplicationStatus;
      if (!VENDOR_APPLICATION_STATUSES.includes(status)) {
        res.status(400).json({ error: 'Invalid vendor status.' });
        return;
      }

      const nextAccountStatus = status === 'Approved' ? 'active' : status === 'Suspended' || status === 'Rejected' ? 'suspended' : 'pending';

      const sb = getSupabaseAdminClient();
      if (sb) {
        if (!isUuid(req.params.id)) {
          res.status(404).json({ error: 'Vendor not found.' });
          return;
        }
        const { data: updated, error: updErr } = await sb
          .from('vendors')
          .update({ application_status: status, account_status: nextAccountStatus })
          .eq('id', req.params.id)
          .select('*')
          .maybeSingle();

        if (updErr) {
          res.status(500).json({ error: updErr.message });
          return;
        }
        if (!updated) {
          res.status(404).json({ error: 'Vendor not found.' });
          return;
        }

        const vendor = mapVendorRow(updated as Record<string, unknown>);
        await insertSupabaseAuditLog(sb, {
          actorId: req.adminUser!.id,
          actorEmail: req.adminUser!.email,
          actorRole: req.adminUser!.role,
          action: 'vendor_status_changed',
          entityType: 'vendor',
          entityId: vendor.id,
          summary: `Set vendor ${vendor.companyName} status to ${status}.`
        });
        res.json({ item: vendor });
        return;
      }

      const db = getDbState();
      const vendor = db.vendors.find((v) => v.id === req.params.id);
      if (!vendor) {
        res.status(404).json({ error: 'Vendor not found.' });
        return;
      }

      vendor.applicationStatus = status;
      vendor.accountStatus = nextAccountStatus;
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
    } catch (err) {
      next(err);
    }
  });

  router.post(
    '/admin/vendors/:id/documents',
    requireAdmin,
    requirePermission('vendors.write'),
    uploadAttachmentMiddleware.single('file'),
    async (req: AuthenticatedRequest, res) => {
      try {
        if (!req.file) {
          res.status(400).json({ error: 'Document file is required.' });
          return;
        }
        const docType = sanitizeText(req.body?.docType, 80) || 'Compliance Document';
        const fileName = sanitizeText(req.file.originalname, 180);
        const expiresAt = sanitizeText(req.body?.expiresAt, 30) || null;

        const sb = getSupabaseAdminClient();
        if (sb) {
          if (!isUuid(req.params.id)) {
            res.status(404).json({ error: 'Vendor not found.' });
            return;
          }
          const { data: vendor } = await sb.from('vendors').select('id, company_name').eq('id', req.params.id).maybeSingle();
          if (!vendor) {
            res.status(404).json({ error: 'Vendor not found.' });
            return;
          }

          const { storagePath } = await persistUploadedFile('vendor-documents', req.file);
          const { data: docRow, error: docErr } = await sb
            .from('vendor_documents')
            .insert({
              vendor_id: vendor.id,
              doc_type: docType,
              file_name: fileName,
              storage_bucket: 'vendor-documents',
              storage_path: storagePath,
              mime_type: req.file.mimetype,
              file_size: req.file.size,
              verified: true,
              expires_at: expiresAt
            })
            .select('*')
            .single();

          if (docErr || !docRow) {
            res.status(500).json({ error: docErr?.message || 'Failed to save vendor document.' });
            return;
          }

          await insertSupabaseAuditLog(sb, {
            actorId: req.adminUser!.id,
            actorEmail: req.adminUser!.email,
            actorRole: req.adminUser!.role,
            action: 'vendor_document_uploaded',
            entityType: 'vendor',
            entityId: vendor.id,
            summary: `Uploaded ${docType} (${fileName}) for ${vendor.company_name}.`
          });

          res.status(201).json({ item: mapVendorDocRow(docRow as Record<string, unknown>) });
          return;
        }

        const db = getDbState();
        const vendor = db.vendors.find((v) => v.id === req.params.id);
        if (!vendor) {
          res.status(404).json({ error: 'Vendor not found.' });
          return;
        }

        const { storagePath } = await persistUploadedFile('vendor-documents', req.file);
        const doc = {
          id: crypto.randomUUID(),
          vendorId: vendor.id,
          docType,
          fileName,
          storageBucket: 'vendor-documents',
          storagePath,
          mimeType: req.file.mimetype,
          fileSize: req.file.size,
          verified: true,
          expiresAt,
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
  router.get('/admin/clients', requireAdmin, requirePermission('clients.read'), async (req, res, next) => {
    try {
      const status = sanitizeText(req.query.status, 30);
      const clientType = sanitizeText(req.query.clientType, 60);
      const q = sanitizeText(req.query.q, 120).toLowerCase();

      const sb = getSupabaseAdminClient();
      let allItems;
      if (sb) {
        const { data, error } = await sb.from('clients').select('*').order('created_at', { ascending: false });
        if (error) {
          res.status(500).json({ error: error.message });
          return;
        }
        allItems = (data ?? []).map((r) => mapClientRow(r as Record<string, unknown>));
      } else {
        allItems = getDbState().clients;
      }

      const items = allItems.filter((c) => {
        if (status && status !== 'All' && c.accountStatus !== status) return false;
        if (clientType && clientType !== 'All' && c.clientType !== clientType) return false;
        if (q) {
          const hay = `${c.clientCode} ${c.companyName} ${c.contactName} ${c.email} ${c.phone}`.toLowerCase();
          if (!hay.includes(q)) return false;
        }
        return true;
      });
      res.json({ items });
    } catch (err) {
      next(err);
    }
  });

  router.post('/admin/clients', requireAdmin, requirePermission('clients.write'), async (req: AuthenticatedRequest, res, next) => {
    try {
      const contactName = sanitizeText(req.body?.contactName, 120);
      const email = sanitizeText(req.body?.email, 254).toLowerCase();
      const phone = sanitizeText(req.body?.phone, 40);
      const clientType = sanitizeText(req.body?.clientType, 60) as ClientType;

      if (!contactName || !isValidEmail(email) || !phone) {
        res.status(400).json({ error: 'Contact name, valid email, and phone are required.' });
        return;
      }

      const clientCode = `CLI-${Math.floor(1100 + Math.random() * 8800)}`;
      const resolvedClientType = CLIENT_TYPES.includes(clientType) ? clientType : 'Property Manager';

      const sb = getSupabaseAdminClient();
      if (sb) {
        const { data: inserted, error: insErr } = await sb
          .from('clients')
          .insert({
            client_code: clientCode,
            company_name: sanitizeText(req.body?.companyName, 140),
            contact_name: contactName,
            email,
            phone,
            client_type: resolvedClientType,
            address: sanitizeText(req.body?.address, 240),
            notes: sanitizeText(req.body?.notes, 2000),
            account_status: 'active',
            is_demo: false
          })
          .select('*')
          .single();

        if (insErr || !inserted) {
          res.status(500).json({ error: insErr?.message || 'Unable to create client.' });
          return;
        }

        const client = mapClientRow(inserted as Record<string, unknown>);
        await insertSupabaseAuditLog(sb, {
          actorId: req.adminUser!.id,
          actorEmail: req.adminUser!.email,
          actorRole: req.adminUser!.role,
          action: 'client_created',
          entityType: 'client',
          entityId: client.id,
          summary: `Created client ${client.companyName || client.contactName} (${client.clientCode}).`
        });
        res.status(201).json({ item: client });
        return;
      }

      const db = getDbState();
      const now = new Date().toISOString();
      const client = {
        id: crypto.randomUUID(),
        clientCode,
        companyName: sanitizeText(req.body?.companyName, 140),
        contactName,
        email,
        phone,
        clientType: resolvedClientType,
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
    } catch (err) {
      next(err);
    }
  });

  router.get('/admin/clients/:id', requireAdmin, requirePermission('clients.read'), async (req, res, next) => {
    try {
      const sb = getSupabaseAdminClient();
      if (sb) {
        const param = req.params.id;
        let query = sb.from('clients').select('*');
        query = isUuid(param) ? query.eq('id', param) : query.eq('client_code', param);
        const { data: clientRow, error: cliErr } = await query.maybeSingle();
        if (cliErr) {
          res.status(500).json({ error: cliErr.message });
          return;
        }
        if (!clientRow) {
          res.status(404).json({ error: 'Client not found.' });
          return;
        }

        const client = mapClientRow(clientRow as Record<string, unknown>);
        const [woRes, bidRes, msgRes, propRes, vendorNames] = await Promise.all([
          sb.from('work_orders').select('*').eq('client_id', client.id).order('created_at', { ascending: false }),
          sb.from('bid_requests').select('*').ilike('email', client.email).order('created_at', { ascending: false }),
          sb.from('messages').select('*').or(`linked_client_id.eq.${client.id},sender_email.ilike.${client.email}`).order('created_at', { ascending: false }),
          sb.from('client_properties').select('*').eq('client_id', client.id).order('created_at', { ascending: false }),
          getVendorNameMap(sb)
        ]);

        res.json({
          item: client,
          workOrders: (woRes.data ?? []).map((r) => mapWorkOrderRow(r as Record<string, unknown>, vendorNames)),
          bidRequests: (bidRes.data ?? []).map((r) => mapBidRequestRow(r as Record<string, unknown>)),
          messages: (msgRes.data ?? []).map((r) => mapMessageRow(r as Record<string, unknown>)),
          properties: (propRes.data ?? []).map((r) => mapClientPropertyRow(r as Record<string, unknown>))
        });
        return;
      }

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
    } catch (err) {
      next(err);
    }
  });

  router.patch('/admin/clients/:id', requireAdmin, requirePermission('clients.write'), async (req: AuthenticatedRequest, res, next) => {
    try {
      const sb = getSupabaseAdminClient();
      if (sb) {
        if (!isUuid(req.params.id)) {
          res.status(404).json({ error: 'Client not found.' });
          return;
        }
        const updates: Record<string, unknown> = {};
        if (req.body?.companyName !== undefined) updates.company_name = sanitizeText(req.body.companyName, 140);
        if (req.body?.contactName !== undefined) updates.contact_name = sanitizeText(req.body.contactName, 120);
        if (req.body?.email && isValidEmail(req.body.email)) updates.email = sanitizeText(req.body.email, 254).toLowerCase();
        if (req.body?.phone !== undefined) updates.phone = sanitizeText(req.body.phone, 40);
        if (req.body?.clientType && CLIENT_TYPES.includes(req.body.clientType)) updates.client_type = req.body.clientType;
        if (req.body?.address !== undefined) updates.address = sanitizeText(req.body.address, 240);
        if (req.body?.notes !== undefined) updates.notes = sanitizeText(req.body.notes, 2000);
        if (req.body?.accountStatus && ['active', 'archived'].includes(req.body.accountStatus)) {
          updates.account_status = req.body.accountStatus;
        }

        const { data: updated, error: updErr } = await sb
          .from('clients')
          .update(updates)
          .eq('id', req.params.id)
          .select('*')
          .maybeSingle();
        if (updErr) {
          res.status(500).json({ error: updErr.message });
          return;
        }
        if (!updated) {
          res.status(404).json({ error: 'Client not found.' });
          return;
        }

        const client = mapClientRow(updated as Record<string, unknown>);
        await insertSupabaseAuditLog(sb, {
          actorId: req.adminUser!.id,
          actorEmail: req.adminUser!.email,
          actorRole: req.adminUser!.role,
          action: 'client_updated',
          entityType: 'client',
          entityId: client.id,
          summary: `Updated client ${client.companyName || client.contactName} (${client.accountStatus}).`
        });
        res.json({ item: client });
        return;
      }

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
    } catch (err) {
      next(err);
    }
  });

  router.post('/admin/clients/:id/properties', requireAdmin, requirePermission('clients.write'), async (req: AuthenticatedRequest, res, next) => {
    try {
      const address = sanitizeText(req.body?.address, 240);
      if (!address) {
        res.status(400).json({ error: 'Property address is required.' });
        return;
      }

      const sb = getSupabaseAdminClient();
      if (sb) {
        if (!isUuid(req.params.id)) {
          res.status(404).json({ error: 'Client not found.' });
          return;
        }
        const { data: client } = await sb.from('clients').select('id').eq('id', req.params.id).maybeSingle();
        if (!client) {
          res.status(404).json({ error: 'Client not found.' });
          return;
        }

        const { data: propRow, error: propErr } = await sb
          .from('client_properties')
          .insert({
            client_id: client.id,
            address,
            city: sanitizeText(req.body?.city, 80),
            state: sanitizeText(req.body?.state, 40),
            zip_code: sanitizeText(req.body?.zipCode, 20),
            county: sanitizeText(req.body?.county, 80),
            lat: req.body?.lat != null && req.body.lat !== '' ? Number(req.body.lat) : null,
            lng: req.body?.lng != null && req.body.lng !== '' ? Number(req.body.lng) : null,
            occupancy_status: sanitizeText(req.body?.occupancyStatus, 40) || 'Vacant',
            lockbox_code: sanitizeText(req.body?.lockboxCode, 40),
            notes: sanitizeText(req.body?.notes, 500)
          })
          .select('*')
          .single();

        if (propErr || !propRow) {
          res.status(500).json({ error: propErr?.message || 'Unable to save property.' });
          return;
        }
        res.status(201).json({ item: mapClientPropertyRow(propRow as Record<string, unknown>) });
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
    } catch (err) {
      next(err);
    }
  });

  // ===========================================================================
  // 7. BID REQUESTS & VENDOR BIDS MANAGEMENT
  // ===========================================================================
  router.get('/admin/bid-requests', requireAdmin, requirePermission('bid_requests.read'), async (req, res, next) => {
    try {
      const status = sanitizeText(req.query.status, 40);
      const q = sanitizeText(req.query.q, 120).toLowerCase();

      const sb = getSupabaseAdminClient();
      let allItems;
      if (sb) {
        const { data, error } = await sb.from('bid_requests').select('*').order('created_at', { ascending: false });
        if (error) {
          res.status(500).json({ error: error.message });
          return;
        }
        allItems = (data ?? []).map((r) => mapBidRequestRow(r as Record<string, unknown>));
      } else {
        allItems = getDbState().bidRequests;
      }

      const items = allItems.filter((b) => {
        if (status && status !== 'All' && b.status !== status) return false;
        if (q) {
          const hay = `${b.requestCode} ${b.contactName} ${b.email} ${b.propertyAddress} ${b.requestedServices}`.toLowerCase();
          if (!hay.includes(q)) return false;
        }
        return true;
      });
      res.json({ items });
    } catch (err) {
      next(err);
    }
  });

  router.get('/admin/bid-requests/:id', requireAdmin, requirePermission('bid_requests.read'), async (req, res, next) => {
    try {
      const sb = getSupabaseAdminClient();
      if (sb) {
        const param = req.params.id;
        let query = sb.from('bid_requests').select('*');
        query = isUuid(param) ? query.eq('id', param) : query.eq('request_code', param);
        const { data: row, error } = await query.maybeSingle();
        if (error) {
          res.status(500).json({ error: error.message });
          return;
        }
        if (!row) {
          res.status(404).json({ error: 'Bid request not found.' });
          return;
        }
        const item = mapBidRequestRow(row as Record<string, unknown>);
        const { data: actRows } = await sb
          .from('admin_activity_logs')
          .select('*')
          .eq('entity_type', 'bid_request')
          .eq('entity_id', item.id)
          .order('created_at', { ascending: false });
        res.json({
          item,
          activity: (actRows ?? []).map((r) => mapActivityLogRow(r as Record<string, unknown>))
        });
        return;
      }

      const db = getDbState();
      const item = db.bidRequests.find((b) => b.id === req.params.id || b.requestCode === req.params.id);
      if (!item) {
        res.status(404).json({ error: 'Bid request not found.' });
        return;
      }
      const activity = db.activityLogs.filter((l) => l.entityType === 'bid_request' && l.entityId === item.id);
      res.json({ item, activity });
    } catch (err) {
      next(err);
    }
  });

  router.patch('/admin/bid-requests/:id', requireAdmin, requirePermission('bid_requests.write'), async (req: AuthenticatedRequest, res, next) => {
    try {
      const sb = getSupabaseAdminClient();
      if (sb) {
        if (!isUuid(req.params.id)) {
          res.status(404).json({ error: 'Bid request not found.' });
          return;
        }
        const updates: Record<string, unknown> = {};
        if (req.body?.status && BID_REQUEST_STATUSES.includes(req.body.status)) {
          updates.status = req.body.status;
          if (req.body.status === 'Archived') updates.is_archived = true;
        }
        if (req.body?.internalNotes !== undefined) updates.internal_notes = sanitizeText(req.body.internalNotes, 2000);
        if (req.body?.isArchived !== undefined) updates.is_archived = Boolean(req.body.isArchived);

        const { data: updated, error: updErr } = await sb
          .from('bid_requests')
          .update(updates)
          .eq('id', req.params.id)
          .select('*')
          .maybeSingle();

        if (updErr) {
          res.status(500).json({ error: updErr.message });
          return;
        }
        if (!updated) {
          res.status(404).json({ error: 'Bid request not found.' });
          return;
        }

        const item = mapBidRequestRow(updated as Record<string, unknown>);
        await insertSupabaseAuditLog(sb, {
          actorId: req.adminUser!.id,
          actorEmail: req.adminUser!.email,
          actorRole: req.adminUser!.role,
          action: 'bid_request_updated',
          entityType: 'bid_request',
          entityId: item.id,
          summary: `Updated bid request ${item.requestCode} status to ${item.status}.`
        });
        res.json({ item });
        return;
      }

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
    } catch (err) {
      next(err);
    }
  });

  router.post('/admin/bid-requests/:id/convert', requireAdmin, requirePermission('bid_requests.convert'), async (req: AuthenticatedRequest, res, next) => {
    try {
      const sb = getSupabaseAdminClient();
      if (sb) {
        if (!isUuid(req.params.id)) {
          res.status(404).json({ error: 'Bid request not found.' });
          return;
        }
        const { data: bidRow } = await sb.from('bid_requests').select('*').eq('id', req.params.id).maybeSingle();
        if (!bidRow) {
          res.status(404).json({ error: 'Bid request not found.' });
          return;
        }
        const bidReq = mapBidRequestRow(bidRow as Record<string, unknown>);
        if (bidReq.convertedWorkOrderId) {
          res.status(409).json({ error: 'Bid request has already been converted to a Work Order.' });
          return;
        }

        const settings = await getSupabaseBusinessSettings(sb);
        const { data: existingClient } = await sb
          .from('clients')
          .select('*')
          .ilike('email', bidReq.email)
          .limit(1)
          .maybeSingle();

        let client;
        if (existingClient) {
          client = mapClientRow(existingClient as Record<string, unknown>);
        } else {
          const { data: newClientRow, error: cliErr } = await sb
            .from('clients')
            .insert({
              client_code: `CLI-${Math.floor(1100 + Math.random() * 8800)}`,
              company_name: '',
              contact_name: bidReq.contactName,
              email: bidReq.email,
              phone: bidReq.phone,
              client_type: 'Property Manager',
              address: bidReq.propertyAddress,
              notes: `Created automatically from bid request ${bidReq.requestCode}.`,
              account_status: 'active',
              is_demo: false
            })
            .select('*')
            .single();
          if (cliErr || !newClientRow) {
            res.status(500).json({ error: cliErr?.message || 'Unable to create client record.' });
            return;
          }
          client = mapClientRow(newClientRow as Record<string, unknown>);
        }

        const code = `SLC-${new Date().getFullYear().toString().slice(-2)}-${Math.floor(4200 + Math.random() * 5700)}`;
        const estimatedBudget =
          Number(req.body?.estimatedBudget) ||
          (bidReq.estimatorData ? Math.round((bidReq.estimatorData.lowEstimate + bidReq.estimatorData.highEstimate) / 2) : 350);
        const parts = bidReq.propertyAddress.split(',').map((s) => s.trim());

        const { data: woRow, error: woErr } = await sb
          .from('work_orders')
          .insert({
            work_order_code: code,
            client_id: client.id,
            client_name: client.companyName || client.contactName,
            client_type: client.clientType,
            property_address: parts[0] || bidReq.propertyAddress,
            city: bidReq.city || parts[1] || 'Cleveland',
            state: bidReq.state || parts[2]?.slice(0, 2) || 'OH',
            zip_code: bidReq.zipCode || '',
            county: sanitizeText(req.body?.county, 80),
            service_category: bidReq.requestedServices,
            service_description: bidReq.notes || bidReq.requestedServices,
            priority: PRIORITY_LEVELS.includes(req.body?.priority) ? req.body.priority : 'Normal',
            estimated_budget: estimatedBudget,
            sla_deadline: new Date(Date.now() + settings.defaultSlaHours * 3600 * 1000).toISOString(),
            status: 'Open Bid',
            qc_notes: '',
            is_archived: false,
            is_demo: false
          })
          .select('*')
          .single();

        if (woErr || !woRow) {
          res.status(500).json({ error: woErr?.message || 'Unable to create work order.' });
          return;
        }

        const wo = mapWorkOrderRow(woRow as Record<string, unknown>, new Map());

        const { data: updatedBidRow, error: updErr } = await sb
          .from('bid_requests')
          .update({ status: 'Converted', converted_work_order_id: wo.id })
          .eq('id', bidReq.id)
          .select('*')
          .single();

        if (updErr || !updatedBidRow) {
          res.status(500).json({ error: updErr?.message || 'Unable to update bid request.' });
          return;
        }

        await Promise.all([
          insertSupabaseWorkOrderTimeline(
            sb,
            wo.id,
            req.adminUser!.fullName,
            'converted_from_bid',
            `Work order ${code} converted from customer bid request ${bidReq.requestCode}.`
          ),
          insertSupabaseAuditLog(sb, {
            actorId: req.adminUser!.id,
            actorEmail: req.adminUser!.email,
            actorRole: req.adminUser!.role,
            action: 'bid_request_converted',
            entityType: 'bid_request',
            entityId: bidReq.id,
            summary: `Converted bid request ${bidReq.requestCode} into Work Order ${code}.`
          })
        ]);

        res.status(201).json({
          bidRequest: mapBidRequestRow(updatedBidRow as Record<string, unknown>),
          workOrder: wo
        });
        return;
      }

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
        city: bidReq.city || parts[1] || 'Cleveland',
        state: bidReq.state || parts[2]?.slice(0, 2) || 'OH',
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
    } catch (err) {
      next(err);
    }
  });

  router.get('/admin/vendor-bids', requireAdmin, requirePermission('vendor_bids.read'), async (req, res, next) => {
    try {
      const workOrderId = sanitizeText(req.query.workOrderId, 80);
      const status = sanitizeText(req.query.status, 40);

      const sb = getSupabaseAdminClient();
      let allItems;
      if (sb) {
        const [bidRes, woCodeMap] = await Promise.all([
          sb.from('vendor_bids').select('*').order('submitted_at', { ascending: false }),
          getWorkOrderCodeMap(sb)
        ]);
        if (bidRes.error) {
          res.status(500).json({ error: bidRes.error.message });
          return;
        }
        allItems = (bidRes.data ?? []).map((r) => mapVendorBidRow(r as Record<string, unknown>, woCodeMap));
      } else {
        allItems = getDbState().vendorBids;
      }

      const items = allItems.filter((b) => {
        if (workOrderId && b.workOrderId !== workOrderId) return false;
        if (status && status !== 'All' && b.status !== status) return false;
        return true;
      });
      res.json({ items });
    } catch (err) {
      next(err);
    }
  });

  router.post('/admin/vendor-bids/:id/decide', requireAdmin, requirePermission('vendor_bids.decide'), async (req: AuthenticatedRequest, res, next) => {
    try {
      const decision = sanitizeText(req.body?.decision, 30);
      const note = sanitizeText(req.body?.clarificationNote, 1000);
      if (!['accept', 'reject', 'clarify'].includes(decision)) {
        res.status(400).json({ error: 'Decision must be accept, reject, or clarify.' });
        return;
      }

      const sb = getSupabaseAdminClient();
      if (sb) {
        if (!isUuid(req.params.id)) {
          res.status(404).json({ error: 'Vendor bid not found.' });
          return;
        }
        const { data: bidRow } = await sb.from('vendor_bids').select('*').eq('id', req.params.id).maybeSingle();
        if (!bidRow) {
          res.status(404).json({ error: 'Vendor bid not found.' });
          return;
        }

        const updates: Record<string, unknown> = {};
        if (decision === 'accept') {
          updates.status = 'Accepted';
        } else if (decision === 'reject') {
          updates.status = 'Rejected';
        } else {
          updates.status = 'Under Review';
          updates.clarification_note = note;
        }

        const { data: updatedBidRow, error: bidUpdErr } = await sb
          .from('vendor_bids')
          .update(updates)
          .eq('id', req.params.id)
          .select('*')
          .single();
        if (bidUpdErr || !updatedBidRow) {
          res.status(500).json({ error: bidUpdErr?.message || 'Unable to update vendor bid.' });
          return;
        }

        if (decision === 'accept' && bidRow.work_order_id) {
          await Promise.all([
            sb
              .from('work_orders')
              .update({
                assigned_vendor_id: bidRow.vendor_id ?? null,
                approved_budget: bidRow.proposed_price,
                status: 'Dispatched'
              })
              .eq('id', bidRow.work_order_id),
            sb
              .from('vendor_bids')
              .update({ status: 'Rejected' })
              .eq('work_order_id', bidRow.work_order_id)
              .neq('id', bidRow.id)
              .in('status', ['Submitted', 'Under Review']),
            insertSupabaseWorkOrderTimeline(
              sb,
              String(bidRow.work_order_id),
              req.adminUser!.fullName,
              'bid_accepted',
              `Accepted bid ${bidRow.bid_code} ($${Number(bidRow.proposed_price)}) from ${bidRow.vendor_name} and dispatched order.`
            )
          ]);
        }

        const woCodeMap = await getWorkOrderCodeMap(sb);
        const bid = mapVendorBidRow(updatedBidRow as Record<string, unknown>, woCodeMap);

        await insertSupabaseAuditLog(sb, {
          actorId: req.adminUser!.id,
          actorEmail: req.adminUser!.email,
          actorRole: req.adminUser!.role,
          action: `vendor_bid_${decision}`,
          entityType: 'vendor_bid',
          entityId: bid.id,
          summary: `Vendor bid ${bid.bidCode} marked ${bid.status}.`
        });
        res.json({ item: bid });
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
    } catch (err) {
      next(err);
    }
  });

  // ===========================================================================
  // 8. URGENT DISPATCH MANAGEMENT
  // ===========================================================================
  router.get('/admin/dispatch', requireAdmin, requirePermission('dispatch.read'), async (req, res, next) => {
    try {
      const status = sanitizeText(req.query.status, 40);
      const priority = sanitizeText(req.query.priority, 20);
      const q = sanitizeText(req.query.q, 120).toLowerCase();

      const sb = getSupabaseAdminClient();
      let allItems;
      if (sb) {
        const [dispRes, vendorNames] = await Promise.all([
          sb.from('dispatch_requests').select('*').order('submitted_at', { ascending: false }),
          getVendorNameMap(sb)
        ]);
        if (dispRes.error) {
          res.status(500).json({ error: dispRes.error.message });
          return;
        }
        allItems = (dispRes.data ?? []).map((r) => mapDispatchRow(r as Record<string, unknown>, vendorNames));
      } else {
        allItems = getDbState().dispatchRequests;
      }

      const items = allItems.filter((d) => {
        if (status && status !== 'All' && d.status !== status) return false;
        if (priority && priority !== 'All' && d.priority !== priority) return false;
        if (q) {
          const hay = `${d.dispatchCode} ${d.contactName} ${d.phone} ${d.propertyAddress} ${d.emergencyType}`.toLowerCase();
          if (!hay.includes(q)) return false;
        }
        return true;
      });
      res.json({ items });
    } catch (err) {
      next(err);
    }
  });

  router.patch('/admin/dispatch/:id', requireAdmin, requirePermission('dispatch.write'), async (req: AuthenticatedRequest, res, next) => {
    try {
      const sb = getSupabaseAdminClient();
      if (sb) {
        if (!isUuid(req.params.id)) {
          res.status(404).json({ error: 'Dispatch request not found.' });
          return;
        }
        const { data: existing } = await sb.from('dispatch_requests').select('*').eq('id', req.params.id).maybeSingle();
        if (!existing) {
          res.status(404).json({ error: 'Dispatch request not found.' });
          return;
        }

        const now = new Date().toISOString();
        const prevStatus = existing.status as DispatchStatus;
        let nextStatus = prevStatus;
        const timeline = Array.isArray(existing.timeline) ? [...existing.timeline] : [];
        const updates: Record<string, unknown> = {};

        if (req.body?.status && DISPATCH_STATUSES.includes(req.body.status)) {
          nextStatus = req.body.status;
          updates.status = nextStatus;
        }
        if (req.body?.priority && PRIORITY_LEVELS.includes(req.body.priority)) {
          updates.priority = req.body.priority;
        }
        if (req.body?.internalNotes !== undefined) {
          updates.internal_notes = sanitizeText(req.body.internalNotes, 2000);
        }
        if (req.body?.assignedVendorId !== undefined) {
          const vid = sanitizeText(req.body.assignedVendorId, 80) || null;
          updates.assigned_vendor_id = vid && isUuid(vid) ? vid : null;
          let vendorName = '';
          if (vid && isUuid(vid)) {
            const { data: v } = await sb.from('vendors').select('company_name').eq('id', vid).maybeSingle();
            vendorName = v?.company_name ?? '';
          }
          if (vendorName && nextStatus === 'New') {
            nextStatus = 'Assigned';
            updates.status = 'Assigned';
          }
          timeline.unshift({
            id: crypto.randomUUID(),
            actorName: req.adminUser!.fullName,
            description: vendorName ? `Assigned emergency dispatch to ${vendorName}.` : 'Cleared vendor assignment.',
            createdAt: now
          });
        }
        if (nextStatus !== prevStatus) {
          timeline.unshift({
            id: crypto.randomUUID(),
            actorName: req.adminUser!.fullName,
            description: `Status updated from ${prevStatus} to ${nextStatus}.`,
            createdAt: now
          });
        }
        updates.timeline = timeline;

        const { data: updated, error: updErr } = await sb
          .from('dispatch_requests')
          .update(updates)
          .eq('id', req.params.id)
          .select('*')
          .single();
        if (updErr || !updated) {
          res.status(500).json({ error: updErr?.message || 'Unable to update dispatch request.' });
          return;
        }

        const vendorNames = await getVendorNameMap(sb);
        const item = mapDispatchRow(updated as Record<string, unknown>, vendorNames);

        await insertSupabaseAuditLog(sb, {
          actorId: req.adminUser!.id,
          actorEmail: req.adminUser!.email,
          actorRole: req.adminUser!.role,
          action: 'dispatch_updated',
          entityType: 'dispatch',
          entityId: item.id,
          summary: `Updated dispatch ${item.dispatchCode} (${item.status}).`
        });
        res.json({ item });
        return;
      }

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
    } catch (err) {
      next(err);
    }
  });
}
