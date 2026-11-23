import crypto from 'node:crypto';
import express from 'express';
import type {
  BidRequestStatus,
  DispatchStatus,
  MessageStatus,
  PriorityLevel,
  VendorApplicationStatus,
  VendorBidStatus
} from '../../src/types/platform.ts';
import { createRateLimiter, isValidEmail, sanitizeText } from '../security.ts';
import {
  appendActivityLog,
  appendNotification,
  appendWorkOrderTimeline,
  getDbState,
  saveDbState
} from '../store.ts';
import { getSupabaseAdminClient } from '../supabaseAdmin.ts';
import {
  getPublicBootstrapFromSupabase,
  insertSupabaseNotification,
  insertSupabaseWorkOrderTimeline,
  isUuid
} from '../supabaseRepo.ts';
import { insertSupabaseAuditLog } from './shared.ts';

function toLocalPublicBootstrap() {
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
      .filter(
        (w) =>
          !w.isArchived &&
          ['Open Bid', 'Dispatched', 'In Progress', 'QC Verified'].includes(w.status)
      )
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

export function registerPublicRoutes(router: express.Router): void {
  const publicSubmitLimiter = createRateLimiter(25, 15 * 60 * 1000);

  router.get('/public/bootstrap', async (_req, res, next) => {
    try {
      const sb = getSupabaseAdminClient();
      if (sb) {
        const data = await getPublicBootstrapFromSupabase(sb);
        res.json(data);
        return;
      }
      res.json(toLocalPublicBootstrap());
    } catch (err) {
      next(err);
    }
  });

  router.post('/public/bid-requests', publicSubmitLimiter, async (req, res, next) => {
    try {
      const name = sanitizeText(req.body?.name, 120);
      const email = sanitizeText(req.body?.email, 254).toLowerCase();
      const phone = sanitizeText(req.body?.phone, 40);
      const propertyAddress = sanitizeText(req.body?.propertyAddress, 240);
      const city = sanitizeText(req.body?.city, 80);
      const stateCode = sanitizeText(req.body?.state, 40);
      const zipCode = sanitizeText(req.body?.zipCode, 20);
      const requestedServices =
        sanitizeText(req.body?.serviceScope || req.body?.requestedServices, 180) ||
        'Property Preservation';
      const notes = sanitizeText(req.body?.notes, 2000);
      const est = req.body?.estimatorData;

      if (!name || !isValidEmail(email) || phone.length < 7 || !propertyAddress) {
        res.status(400).json({
          error: 'Please provide your name, valid email, phone number, and property address.'
        });
        return;
      }

      const estimatorData =
        est &&
        typeof est === 'object' &&
        typeof est.lowEstimate === 'number' &&
        typeof est.highEstimate === 'number'
          ? {
              categoryLabel: sanitizeText(est.categoryLabel, 120),
              lowEstimate: Number(est.lowEstimate),
              highEstimate: Number(est.highEstimate),
              summary: sanitizeText(est.summary, 300)
            }
          : null;

      const requestCode = `EST-${Math.floor(100000 + Math.random() * 899999)}`;
      const now = new Date().toISOString();
      const sb = getSupabaseAdminClient();

      if (sb) {
        const { data: inserted, error } = await sb
          .from('bid_requests')
          .insert({
            request_code: requestCode,
            contact_name: name,
            email,
            phone,
            property_address: propertyAddress,
            city,
            state: stateCode,
            zip_code: zipCode,
            requested_services: requestedServices,
            notes,
            estimator_data: estimatorData,
            status: 'New',
            internal_notes: '',
            is_archived: false
          })
          .select('id, request_code, created_at')
          .single();

        if (error || !inserted) {
          res.status(500).json({ error: error?.message || 'Unable to save bid request.' });
          return;
        }

        await insertSupabaseNotification(sb, {
          eventType: 'new_bid_request',
          title: `New Bid Request ${requestCode}`,
          message: `${name} requested ${requestedServices} at ${propertyAddress}.`,
          entityType: 'bid_request',
          entityId: inserted.id
        });
        await insertSupabaseAuditLog(sb, {
          actorId: null,
          actorEmail: email,
          actorRole: 'Public Visitor',
          action: 'bid_request_submitted',
          entityType: 'bid_request',
          entityId: inserted.id,
          summary: `Public bid request ${requestCode} submitted for ${propertyAddress}.`
        });

        res.status(201).json({
          requestCode: inserted.request_code,
          id: inserted.id,
          createdAt: inserted.created_at
        });
        return;
      }

      const db = getDbState();
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
        estimatorData,
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
    } catch (err) {
      next(err);
    }
  });

  router.post('/public/dispatch-requests', publicSubmitLimiter, async (req, res, next) => {
    try {
      const contactName = sanitizeText(req.body?.name || req.body?.contactName, 120);
      const phone = sanitizeText(req.body?.phone, 40);
      const email = sanitizeText(req.body?.email, 254).toLowerCase();
      const propertyAddress = sanitizeText(
        req.body?.propertyLocation || req.body?.propertyAddress,
        240
      );
      const city = sanitizeText(req.body?.city, 80);
      const stateCode = sanitizeText(req.body?.state, 40);
      const zipCode = sanitizeText(req.body?.zipCode, 20);
      const emergencyType =
        sanitizeText(req.body?.topic || req.body?.emergencyType, 160) ||
        'Emergency Board-Up / Securing';
      const description = sanitizeText(req.body?.message || req.body?.description, 2000);

      if (!contactName || phone.length < 7 || !propertyAddress) {
        res.status(400).json({
          error: 'Please enter your name, callback phone number, and property location.'
        });
        return;
      }

      const dispatchCode = `URG-${Math.floor(100000 + Math.random() * 899999)}`;
      const now = new Date().toISOString();
      const initialTimeline = [
        {
          id: crypto.randomUUID(),
          actorName: contactName,
          description: `Urgent dispatch request ${dispatchCode} created via live dispatch widget.`,
          createdAt: now
        }
      ];

      const sb = getSupabaseAdminClient();
      if (sb) {
        const { data: inserted, error } = await sb
          .from('dispatch_requests')
          .insert({
            dispatch_code: dispatchCode,
            contact_name: contactName,
            phone,
            email,
            property_address: propertyAddress,
            city,
            state: stateCode,
            zip_code: zipCode,
            emergency_type: emergencyType,
            description,
            priority: 'Urgent',
            status: 'New',
            internal_notes: '',
            timeline: initialTimeline
          })
          .select('id, dispatch_code, submitted_at')
          .single();

        if (error || !inserted) {
          res.status(500).json({ error: error?.message || 'Unable to save dispatch request.' });
          return;
        }

        await insertSupabaseNotification(sb, {
          eventType: 'new_dispatch_request',
          title: `Urgent Dispatch ${dispatchCode}`,
          message: `${emergencyType} reported at ${propertyAddress} (${phone}).`,
          entityType: 'dispatch',
          entityId: inserted.id
        });
        await insertSupabaseAuditLog(sb, {
          actorId: null,
          actorEmail: email || phone,
          actorRole: 'Public Visitor',
          action: 'dispatch_submitted',
          entityType: 'dispatch',
          entityId: inserted.id,
          summary: `Urgent dispatch ${dispatchCode} logged for ${propertyAddress}.`
        });

        res.status(201).json({
          dispatchCode: inserted.dispatch_code,
          id: inserted.id,
          submittedDate: inserted.submitted_at
        });
        return;
      }

      const db = getDbState();
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
        timeline: initialTimeline,
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
    } catch (err) {
      next(err);
    }
  });

  router.post('/public/vendor-applications', publicSubmitLimiter, async (req, res, next) => {
    try {
      const companyName = sanitizeText(req.body?.companyName, 140);
      const contactPerson = sanitizeText(
        req.body?.contactName || req.body?.contactPerson,
        120
      );
      const email = sanitizeText(req.body?.email, 254).toLowerCase();
      const phone = sanitizeText(req.body?.phone, 40);
      const coverageAreas = sanitizeText(
        req.body?.statesCovered || req.body?.coverageAreas,
        240
      );
      const trades = Array.isArray(req.body?.trades)
        ? req.body.trades.map((t: unknown) => sanitizeText(t, 80)).filter(Boolean)
        : [];
      const hasInsurance = Boolean(req.body?.hasInsurance);

      if (!companyName || !contactPerson || !isValidEmail(email) || phone.length < 7) {
        res.status(400).json({
          error: 'Please provide your LLC/Company name, contact name, valid email, and phone number.'
        });
        return;
      }
      if (trades.length === 0) {
        res.status(400).json({ error: 'Please select at least one primary field service trade.' });
        return;
      }

      const vendorCode = `VND-${Math.floor(10000 + Math.random() * 89999)}`;
      const insuranceInfo = hasInsurance
        ? 'Applicant attested GL & ABC# compliance (Pending Verification)'
        : 'Not attested';

      const sb = getSupabaseAdminClient();
      if (sb) {
        const { data: inserted, error } = await sb
          .from('vendors')
          .insert({
            vendor_code: vendorCode,
            company_name: companyName,
            contact_person: contactPerson,
            email,
            phone,
            service_categories: trades,
            coverage_areas: coverageAreas,
            insurance_info: insuranceInfo,
            application_status: 'Pending',
            account_status: 'pending',
            is_demo: false
          })
          .select('id, vendor_code')
          .single();

        if (error || !inserted) {
          res.status(500).json({ error: error?.message || 'Unable to save vendor application.' });
          return;
        }

        await insertSupabaseNotification(sb, {
          eventType: 'new_vendor_application',
          title: `New Vendor Application ${vendorCode}`,
          message: `${companyName} (${contactPerson}) applied for ${trades.join(', ')}.`,
          entityType: 'vendor',
          entityId: inserted.id
        });
        await insertSupabaseAuditLog(sb, {
          actorId: null,
          actorEmail: email,
          actorRole: 'Vendor Applicant',
          action: 'vendor_application_submitted',
          entityType: 'vendor',
          entityId: inserted.id,
          summary: `Vendor application ${vendorCode} submitted by ${companyName}.`
        });

        res.status(201).json({ vendorCode: inserted.vendor_code, id: inserted.id });
        return;
      }

      const db = getDbState();
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
        insuranceInfo,
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
    } catch (err) {
      next(err);
    }
  });

  router.post('/public/vendor-bids', publicSubmitLimiter, async (req, res, next) => {
    try {
      const workOrderIdentifier = sanitizeText(
        req.body?.workOrderId || req.body?.workOrderCode,
        80
      );
      const proposedPrice = Number(req.body?.proposedPrice ?? req.body?.bidAmount);
      const aspenGroveAbc = sanitizeText(req.body?.vendorCode || req.body?.aspenGroveAbc, 60);
      const vendorName =
        sanitizeText(req.body?.vendorName, 120) ||
        (aspenGroveAbc ? `Field Vendor (${aspenGroveAbc})` : 'Portal Vendor Applicant');
      const estimatedCompletionTime =
        sanitizeText(req.body?.estimatedCompletionTime, 80) || '48 Hours';
      const bidNotes = sanitizeText(req.body?.bidNotes, 1000);

      if (!workOrderIdentifier || !Number.isFinite(proposedPrice) || proposedPrice < 25) {
        res.status(400).json({
          error: 'Please select a valid work order and enter a bid of at least $25.'
        });
        return;
      }

      const bidCode = `BID-${Math.floor(10000 + Math.random() * 89999)}`;
      const roundedPrice = Math.round(proposedPrice * 100) / 100;
      const sb = getSupabaseAdminClient();

      if (sb) {
        const woQuery = sb
          .from('work_orders')
          .select('id, work_order_code')
          .eq('is_archived', false);
        const { data: wo } = isUuid(workOrderIdentifier)
          ? await woQuery.eq('id', workOrderIdentifier).maybeSingle()
          : await woQuery.eq('work_order_code', workOrderIdentifier).maybeSingle();

        if (!wo) {
          res.status(404).json({ error: 'Referenced work order was not found or is closed.' });
          return;
        }

        let matchedVendor: { id: string; company_name: string } | null = null;
        if (aspenGroveAbc) {
          const { data: v } = await sb
            .from('vendors')
            .select('id, company_name')
            .ilike('aspen_grove_abc', aspenGroveAbc)
            .maybeSingle();
          matchedVendor = v;
        }

        const resolvedVendorName = matchedVendor?.company_name ?? vendorName;
        const { data: inserted, error } = await sb
          .from('vendor_bids')
          .insert({
            bid_code: bidCode,
            work_order_id: wo.id,
            vendor_id: matchedVendor?.id ?? null,
            vendor_name: resolvedVendorName,
            aspen_grove_abc: aspenGroveAbc,
            proposed_price: roundedPrice,
            estimated_completion_time: estimatedCompletionTime,
            bid_notes: bidNotes,
            attachments: [],
            status: 'Submitted',
            clarification_note: ''
          })
          .select('id, bid_code')
          .single();

        if (error || !inserted) {
          res.status(500).json({ error: error?.message || 'Unable to submit vendor bid.' });
          return;
        }

        await insertSupabaseWorkOrderTimeline(
          sb,
          wo.id,
          resolvedVendorName,
          'bid_submitted',
          `Vendor bid ${bidCode} submitted for $${roundedPrice.toLocaleString()}.`
        );
        await insertSupabaseNotification(sb, {
          eventType: 'new_vendor_bid',
          title: `New Vendor Bid ${bidCode}`,
          message: `${resolvedVendorName} bid $${roundedPrice.toLocaleString()} on ${wo.work_order_code}.`,
          entityType: 'work_order',
          entityId: wo.id
        });

        res.status(201).json({
          bidCode: inserted.bid_code,
          id: inserted.id,
          workOrderCode: wo.work_order_code
        });
        return;
      }

      const db = getDbState();
      const wo = db.workOrders.find(
        (w) =>
          !w.isArchived &&
          (w.id === workOrderIdentifier || w.workOrderCode === workOrderIdentifier)
      );
      if (!wo) {
        res.status(404).json({ error: 'Referenced work order was not found or is closed.' });
        return;
      }

      const matchedVendor = aspenGroveAbc
        ? db.vendors.find((v) => v.aspenGroveAbc.toLowerCase() === aspenGroveAbc.toLowerCase())
        : undefined;

      const now = new Date().toISOString();
      const record = {
        id: crypto.randomUUID(),
        bidCode,
        workOrderId: wo.id,
        workOrderCode: wo.workOrderCode,
        vendorId: matchedVendor?.id ?? null,
        vendorName: matchedVendor?.companyName ?? vendorName,
        aspenGroveAbc,
        proposedPrice: roundedPrice,
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
    } catch (err) {
      next(err);
    }
  });

  router.post('/public/messages', publicSubmitLimiter, async (req, res, next) => {
    try {
      const senderName = sanitizeText(req.body?.name || req.body?.senderName, 120);
      const senderEmail = sanitizeText(req.body?.email || req.body?.senderEmail, 254).toLowerCase();
      const senderPhone = sanitizeText(req.body?.phone || req.body?.senderPhone, 40);
      const subject = sanitizeText(req.body?.subject, 160) || 'General Inquiry';
      const body = sanitizeText(req.body?.body || req.body?.message, 3000);
      const source = sanitizeText(req.body?.source, 60) || 'Contact Form';

      if (!senderName || (!senderEmail && !senderPhone) || !body) {
        res.status(400).json({ error: 'Please include your name, email or phone, and message.' });
        return;
      }

      const sb = getSupabaseAdminClient();
      if (sb) {
        const { data: inserted, error } = await sb
          .from('messages')
          .insert({
            sender_name: senderName,
            sender_email: senderEmail,
            sender_phone: senderPhone,
            subject,
            body,
            source,
            status: 'Unread',
            internal_notes: ''
          })
          .select('id')
          .single();

        if (error || !inserted) {
          res.status(500).json({ error: error?.message || 'Unable to submit message.' });
          return;
        }

        await insertSupabaseNotification(sb, {
          eventType: 'new_message',
          title: 'New Contact Message',
          message: `${senderName}: ${subject}`,
          entityType: 'message',
          entityId: inserted.id
        });
        res.status(201).json({ id: inserted.id });
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
        source,
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
        title: 'New Contact Message',
        message: `${senderName}: ${subject}`,
        entityType: 'message',
        entityId: record.id
      });
      saveDbState(db);

      res.status(201).json({ id: record.id });
    } catch (err) {
      next(err);
    }
  });
}
