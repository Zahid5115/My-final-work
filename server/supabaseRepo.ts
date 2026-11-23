import crypto from 'node:crypto';
import type {
  ActivityLogEntity,
  BidRequestEntity,
  BidRequestStatus,
  BusinessSettingsEntity,
  ClientPropertyRecord,
  ClientRecord,
  ClientType,
  ContactMessageEntity,
  CoverageRegionEntity,
  DispatchRequestEntity,
  DispatchStatus,
  GalleryCaseEntity,
  ManagedServiceEntity,
  MessageStatus,
  NotificationEntity,
  NotificationPreferenceEntity,
  PriorityLevel,
  PublicBootstrapData,
  ReviewEntity,
  ReviewPublicationStatus,
  VendorApplicationStatus,
  VendorBidEntity,
  VendorBidStatus,
  VendorDocumentRecord,
  VendorRecord,
  WorkOrderAttachment,
  WorkOrderEntity,
  WorkOrderNote,
  WorkOrderStatus,
  WorkOrderTimelineEvent
} from '../src/types/platform.ts';
import { GOOGLE_PROFILE_INFO } from '../src/data/servicesData.ts';
import type { getSupabaseAdminClient } from './supabaseAdmin.ts';

export type SupabaseAdminClient = NonNullable<ReturnType<typeof getSupabaseAdminClient>>;

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID_REGEX.test(value.trim());
}

function asStringArray(val: unknown): string[] {
  if (Array.isArray(val)) return val.map((v) => String(v));
  return [];
}

function asNullableNumber(val: unknown): number | null {
  if (val === null || val === undefined || val === '') return null;
  const n = Number(val);
  return Number.isFinite(n) ? n : null;
}

export function mapServiceRow(row: Record<string, unknown>): ManagedServiceEntity {
  return {
    id: String(row.id),
    serviceNumber: String(row.service_number ?? ''),
    slug: String(row.slug ?? ''),
    title: String(row.title ?? ''),
    subtitle: String(row.subtitle ?? ''),
    category: String(row.category ?? ''),
    pricingModel: String(row.pricing_model ?? 'Per Work Order / Scope'),
    basePrice: Number(row.base_price ?? 0),
    turnaround: String(row.turnaround ?? ''),
    items: asStringArray(row.items),
    complianceNote: String(row.compliance_note ?? ''),
    imageUrl: String(row.image_url ?? ''),
    isVisible: Boolean(row.is_visible),
    sortOrder: Number(row.sort_order ?? 0),
    isArchived: Boolean(row.is_archived),
    isDemo: Boolean(row.is_demo),
    updatedAt: String(row.updated_at ?? row.created_at ?? new Date().toISOString())
  };
}

export function mapGalleryRow(row: Record<string, unknown>): GalleryCaseEntity {
  return {
    id: String(row.id),
    slug: String(row.slug ?? ''),
    title: String(row.title ?? ''),
    location: String(row.location ?? ''),
    workOrderId: String(row.work_order_code ?? ''),
    scopeSummary: String(row.scope_summary ?? ''),
    turnaroundHours: Number(row.turnaround_hours ?? 36),
    beforeImage: String(row.before_image_url ?? ''),
    afterImage: String(row.after_image_url ?? ''),
    beforeAlt: String(row.before_alt ?? ''),
    afterAlt: String(row.after_alt ?? ''),
    isPublished: Boolean(row.is_published),
    sortOrder: Number(row.sort_order ?? 0),
    isDemo: Boolean(row.is_demo),
    updatedAt: String(row.updated_at ?? row.created_at ?? new Date().toISOString())
  };
}

export function mapCoverageRow(row: Record<string, unknown>): CoverageRegionEntity {
  return {
    id: String(row.id),
    region: String(row.region_name ?? ''),
    hubCity: String(row.hub_city ?? ''),
    states: asStringArray(row.states),
    counties: asStringArray(row.counties),
    activeCounties: Number(row.active_counties ?? 0),
    avgDispatchHours: Number(row.avg_dispatch_hours ?? 24),
    hudStandard: String(row.hud_standard ?? ''),
    lat: asNullableNumber(row.lat),
    lng: asNullableNumber(row.lng),
    isHeadquarters: Boolean(row.is_headquarters),
    coverageStatus: (row.coverage_status as 'Active' | 'Expanding' | 'Paused') || 'Active',
    isPublished: Boolean(row.is_published),
    isDemo: Boolean(row.is_demo),
    updatedAt: String(row.updated_at ?? row.created_at ?? new Date().toISOString())
  };
}

export function mapReviewRow(row: Record<string, unknown>): ReviewEntity {
  return {
    id: String(row.id),
    reviewer: String(row.reviewer_name ?? ''),
    organization: String(row.organization ?? ''),
    role: String(row.role ?? ''),
    rating: Number(row.rating ?? 5),
    comment: String(row.comment ?? ''),
    serviceTag: String(row.service_tag ?? ''),
    dateLabel: String(row.review_date_label ?? ''),
    isVerifiedCustomer: Boolean(row.is_verified_customer),
    publicationStatus: (row.publication_status as ReviewPublicationStatus) || 'Published',
    sortOrder: Number(row.sort_order ?? 0),
    isDemo: Boolean(row.is_demo),
    createdAt: String(row.created_at ?? new Date().toISOString())
  };
}

export function mapSettingsRow(row: Record<string, unknown> | null | undefined): BusinessSettingsEntity {
  if (!row) {
    return {
      businessName: GOOGLE_PROFILE_INFO.businessName,
      phone: '(217) 394-6440',
      email: GOOGLE_PROFILE_INFO.email,
      address: GOOGLE_PROFILE_INFO.address,
      hours: GOOGLE_PROFILE_INFO.hours,
      logoUrl: '',
      defaultWoPriority: 'Normal',
      defaultSlaHours: 48,
      autoNotifyUrgent: true,
      coverageRadiusNote: '38 U.S. States · 1,099+ Active Counties',
      googleProfileUrl: GOOGLE_PROFILE_INFO.googleMapsProfileUrl,
      googleRating: GOOGLE_PROFILE_INFO.rating,
      googleReviewCount: GOOGLE_PROFILE_INFO.reviewCount,
      updatedAt: new Date().toISOString()
    };
  }
  return {
    businessName: String(row.business_name ?? GOOGLE_PROFILE_INFO.businessName),
    phone: String(row.phone ?? '(217) 394-6440'),
    email: String(row.email ?? GOOGLE_PROFILE_INFO.email),
    address: String(row.address ?? GOOGLE_PROFILE_INFO.address),
    hours: String(row.hours ?? GOOGLE_PROFILE_INFO.hours),
    logoUrl: String(row.logo_url ?? ''),
    defaultWoPriority: (row.default_wo_priority as PriorityLevel) || 'Normal',
    defaultSlaHours: Number(row.default_sla_hours ?? 48),
    autoNotifyUrgent: row.auto_notify_urgent !== false,
    coverageRadiusNote: String(row.coverage_radius_note ?? '38 U.S. States · 1,099+ Active Counties'),
    googleProfileUrl: String(row.google_profile_url ?? GOOGLE_PROFILE_INFO.googleMapsProfileUrl),
    googleRating: Number(row.google_rating ?? 4.9),
    googleReviewCount: Number(row.google_review_count ?? 284),
    updatedAt: String(row.updated_at ?? new Date().toISOString())
  };
}

export function mapClientRow(row: Record<string, unknown>): ClientRecord {
  return {
    id: String(row.id),
    clientCode: String(row.client_code ?? ''),
    companyName: String(row.company_name ?? ''),
    contactName: String(row.contact_name ?? ''),
    email: String(row.email ?? ''),
    phone: String(row.phone ?? ''),
    clientType: (row.client_type as ClientType) || 'Property Manager',
    address: String(row.address ?? ''),
    notes: String(row.notes ?? ''),
    accountStatus: (row.account_status as 'active' | 'archived') || 'active',
    isDemo: Boolean(row.is_demo),
    createdAt: String(row.created_at ?? new Date().toISOString()),
    updatedAt: String(row.updated_at ?? row.created_at ?? new Date().toISOString())
  };
}

export function mapClientPropertyRow(row: Record<string, unknown>): ClientPropertyRecord {
  return {
    id: String(row.id),
    clientId: String(row.client_id),
    address: String(row.address ?? ''),
    city: String(row.city ?? ''),
    state: String(row.state ?? ''),
    zipCode: String(row.zip_code ?? ''),
    county: String(row.county ?? ''),
    lat: asNullableNumber(row.lat),
    lng: asNullableNumber(row.lng),
    occupancyStatus: String(row.occupancy_status ?? 'Vacant'),
    lockboxCode: String(row.lockbox_code ?? ''),
    notes: String(row.notes ?? ''),
    createdAt: String(row.created_at ?? new Date().toISOString())
  };
}

export function mapVendorRow(row: Record<string, unknown>): VendorRecord {
  return {
    id: String(row.id),
    vendorCode: String(row.vendor_code ?? ''),
    companyName: String(row.company_name ?? ''),
    contactPerson: String(row.contact_person ?? ''),
    email: String(row.email ?? ''),
    phone: String(row.phone ?? ''),
    address: String(row.address ?? ''),
    city: String(row.city ?? ''),
    state: String(row.state ?? ''),
    zipCode: String(row.zip_code ?? ''),
    serviceCategories: asStringArray(row.service_categories),
    coverageAreas: String(row.coverage_areas ?? ''),
    counties: asStringArray(row.counties),
    licenseInfo: String(row.license_info ?? ''),
    insuranceInfo: String(row.insurance_info ?? ''),
    aspenGroveAbc: String(row.aspen_grove_abc ?? ''),
    applicationStatus: (row.application_status as VendorApplicationStatus) || 'Pending',
    accountStatus: (row.account_status as 'pending' | 'active' | 'suspended') || 'pending',
    rating: asNullableNumber(row.rating),
    completedWorkOrders: Number(row.completed_work_orders ?? 0),
    notes: String(row.notes ?? ''),
    isDemo: Boolean(row.is_demo),
    registrationDate: String(row.registration_date ?? row.created_at ?? new Date().toISOString()),
    updatedAt: String(row.updated_at ?? row.created_at ?? new Date().toISOString())
  };
}

export function mapVendorDocRow(row: Record<string, unknown>): VendorDocumentRecord {
  return {
    id: String(row.id),
    vendorId: String(row.vendor_id),
    docType: String(row.doc_type ?? ''),
    fileName: String(row.file_name ?? ''),
    storageBucket: String(row.storage_bucket ?? 'vendor-documents'),
    storagePath: String(row.storage_path ?? ''),
    mimeType: String(row.mime_type ?? ''),
    fileSize: Number(row.file_size ?? 0),
    verified: Boolean(row.verified),
    expiresAt: row.expires_at ? String(row.expires_at) : null,
    createdAt: String(row.created_at ?? new Date().toISOString())
  };
}

export function mapWorkOrderRow(
  row: Record<string, unknown>,
  vendorNames: Map<string, string>
): WorkOrderEntity {
  const vendorId = row.assigned_vendor_id ? String(row.assigned_vendor_id) : null;
  return {
    id: String(row.id),
    workOrderCode: String(row.work_order_code ?? ''),
    clientId: row.client_id ? String(row.client_id) : null,
    clientName: String(row.client_name ?? ''),
    clientType: (row.client_type as ClientType) || 'Property Manager',
    propertyAddress: String(row.property_address ?? ''),
    city: String(row.city ?? ''),
    state: String(row.state ?? ''),
    zipCode: String(row.zip_code ?? ''),
    county: String(row.county ?? ''),
    lat: asNullableNumber(row.lat),
    lng: asNullableNumber(row.lng),
    serviceCategory: String(row.service_category ?? ''),
    serviceDescription: String(row.service_description ?? ''),
    priority: (row.priority as PriorityLevel) || 'Normal',
    estimatedBudget: Number(row.estimated_budget ?? 0),
    approvedBudget: asNullableNumber(row.approved_budget),
    assignedVendorId: vendorId,
    assignedVendorName: vendorId ? vendorNames.get(vendorId) ?? '' : '',
    createdDate: String(row.created_at ?? new Date().toISOString()),
    scheduledDate: row.scheduled_date ? String(row.scheduled_date) : null,
    slaDeadline: row.sla_deadline ? String(row.sla_deadline) : null,
    completionDate: row.completion_date ? String(row.completion_date) : null,
    status: (row.status as WorkOrderStatus) || 'New',
    qcNotes: String(row.qc_notes ?? ''),
    isArchived: Boolean(row.is_archived),
    isDemo: Boolean(row.is_demo),
    updatedAt: String(row.updated_at ?? row.created_at ?? new Date().toISOString())
  };
}

export function mapWorkOrderNoteRow(row: Record<string, unknown>): WorkOrderNote {
  return {
    id: String(row.id),
    workOrderId: String(row.work_order_id),
    authorName: String(row.author_name ?? 'Admin'),
    isInternal: row.is_internal !== false,
    body: String(row.body ?? ''),
    createdAt: String(row.created_at ?? new Date().toISOString())
  };
}

export function mapWorkOrderAttachmentRow(
  row: Record<string, unknown>,
  profileNames: Map<string, string>
): WorkOrderAttachment {
  const uploaderId = row.uploaded_by ? String(row.uploaded_by) : '';
  return {
    id: String(row.id),
    workOrderId: String(row.work_order_id),
    kind: (row.kind as 'document' | 'before_photo' | 'after_photo') || 'document',
    fileName: String(row.file_name ?? ''),
    storageBucket: String(row.storage_bucket ?? 'work-order-attachments'),
    storagePath: String(row.storage_path ?? ''),
    mimeType: String(row.mime_type ?? ''),
    fileSize: Number(row.file_size ?? 0),
    uploadedBy: (uploaderId && profileNames.get(uploaderId)) || 'Admin',
    createdAt: String(row.created_at ?? new Date().toISOString())
  };
}

export function mapWorkOrderTimelineRow(row: Record<string, unknown>): WorkOrderTimelineEvent {
  return {
    id: String(row.id),
    workOrderId: String(row.work_order_id),
    actorName: String(row.actor_name ?? 'System'),
    eventType: String(row.event_type ?? 'update'),
    description: String(row.description ?? ''),
    createdAt: String(row.created_at ?? new Date().toISOString())
  };
}

export function mapBidRequestRow(row: Record<string, unknown>): BidRequestEntity {
  return {
    id: String(row.id),
    requestCode: String(row.request_code ?? ''),
    contactName: String(row.contact_name ?? ''),
    email: String(row.email ?? ''),
    phone: String(row.phone ?? ''),
    propertyAddress: String(row.property_address ?? ''),
    city: String(row.city ?? ''),
    state: String(row.state ?? ''),
    zipCode: String(row.zip_code ?? ''),
    requestedServices: String(row.requested_services ?? ''),
    notes: String(row.notes ?? ''),
    estimatorData: (row.estimator_data as BidRequestEntity['estimatorData']) ?? null,
    status: (row.status as BidRequestStatus) || 'New',
    internalNotes: String(row.internal_notes ?? ''),
    convertedWorkOrderId: row.converted_work_order_id ? String(row.converted_work_order_id) : null,
    isArchived: Boolean(row.is_archived),
    createdAt: String(row.created_at ?? new Date().toISOString()),
    updatedAt: String(row.updated_at ?? row.created_at ?? new Date().toISOString())
  };
}

export function mapVendorBidRow(
  row: Record<string, unknown>,
  woCodeMap: Map<string, string>
): VendorBidEntity {
  const woId = String(row.work_order_id ?? '');
  return {
    id: String(row.id),
    bidCode: String(row.bid_code ?? ''),
    workOrderId: woId,
    workOrderCode: woCodeMap.get(woId) ?? '',
    vendorId: row.vendor_id ? String(row.vendor_id) : null,
    vendorName: String(row.vendor_name ?? ''),
    aspenGroveAbc: String(row.aspen_grove_abc ?? ''),
    proposedPrice: Number(row.proposed_price ?? 0),
    estimatedCompletionTime: String(row.estimated_completion_time ?? '48 Hours'),
    bidNotes: String(row.bid_notes ?? ''),
    attachments: asStringArray(row.attachments),
    status: (row.status as VendorBidStatus) || 'Submitted',
    clarificationNote: String(row.clarification_note ?? ''),
    submittedDate: String(row.submitted_at ?? new Date().toISOString()),
    updatedAt: String(row.updated_at ?? row.submitted_at ?? new Date().toISOString())
  };
}

export function mapDispatchRow(
  row: Record<string, unknown>,
  vendorNames: Map<string, string>
): DispatchRequestEntity {
  const vendorId = row.assigned_vendor_id ? String(row.assigned_vendor_id) : null;
  const rawTimeline = Array.isArray(row.timeline) ? row.timeline : [];
  return {
    id: String(row.id),
    dispatchCode: String(row.dispatch_code ?? ''),
    contactName: String(row.contact_name ?? ''),
    phone: String(row.phone ?? ''),
    email: String(row.email ?? ''),
    propertyAddress: String(row.property_address ?? ''),
    city: String(row.city ?? ''),
    state: String(row.state ?? ''),
    zipCode: String(row.zip_code ?? ''),
    emergencyType: String(row.emergency_type ?? ''),
    description: String(row.description ?? ''),
    priority: (row.priority as PriorityLevel) || 'Urgent',
    status: (row.status as DispatchStatus) || 'New',
    assignedVendorId: vendorId,
    assignedVendorName: vendorId ? vendorNames.get(vendorId) ?? '' : '',
    internalNotes: String(row.internal_notes ?? ''),
    timeline: rawTimeline.map((t: Record<string, unknown>) => ({
      id: String(t.id ?? crypto.randomUUID()),
      actorName: String(t.actorName ?? 'System'),
      description: String(t.description ?? ''),
      createdAt: String(t.createdAt ?? new Date().toISOString())
    })),
    submittedDate: String(row.submitted_at ?? new Date().toISOString()),
    updatedAt: String(row.updated_at ?? row.submitted_at ?? new Date().toISOString())
  };
}

export function mapMessageRow(row: Record<string, unknown>): ContactMessageEntity {
  return {
    id: String(row.id),
    senderName: String(row.sender_name ?? ''),
    senderEmail: String(row.sender_email ?? ''),
    senderPhone: String(row.sender_phone ?? ''),
    subject: String(row.subject ?? ''),
    body: String(row.body ?? ''),
    source: String(row.source ?? 'Contact Form'),
    status: (row.status as MessageStatus) || 'Unread',
    internalNotes: String(row.internal_notes ?? ''),
    linkedClientId: row.linked_client_id ? String(row.linked_client_id) : null,
    linkedBidRequestId: row.linked_bid_request_id ? String(row.linked_bid_request_id) : null,
    linkedWorkOrderId: row.linked_work_order_id ? String(row.linked_work_order_id) : null,
    linkedDispatchId: row.linked_dispatch_id ? String(row.linked_dispatch_id) : null,
    createdAt: String(row.created_at ?? new Date().toISOString()),
    updatedAt: String(row.updated_at ?? row.created_at ?? new Date().toISOString())
  };
}

export function mapNotificationRow(row: Record<string, unknown>): NotificationEntity {
  return {
    id: String(row.id),
    eventType: String(row.event_type ?? ''),
    title: String(row.title ?? ''),
    message: String(row.message ?? ''),
    entityType: String(row.entity_type ?? ''),
    entityId: String(row.entity_id ?? ''),
    isRead: Boolean(row.is_read),
    recipientRole: String(row.recipient_role ?? 'All Admins'),
    createdAt: String(row.created_at ?? new Date().toISOString())
  };
}

export function mapActivityLogRow(row: Record<string, unknown>): ActivityLogEntity {
  return {
    id: String(row.id),
    actorId: row.actor_id ? String(row.actor_id) : null,
    actorEmail: String(row.actor_email ?? ''),
    actorRole: String(row.actor_role ?? ''),
    action: String(row.action ?? ''),
    entityType: String(row.entity_type ?? ''),
    entityId: String(row.entity_id ?? ''),
    summary: String(row.summary ?? ''),
    createdAt: String(row.created_at ?? new Date().toISOString())
  };
}

export async function getVendorNameMap(sb: SupabaseAdminClient): Promise<Map<string, string>> {
  const { data } = await sb.from('vendors').select('id, company_name');
  const map = new Map<string, string>();
  for (const v of data ?? []) {
    map.set(String(v.id), String(v.company_name ?? ''));
  }
  return map;
}

export async function getWorkOrderCodeMap(sb: SupabaseAdminClient): Promise<Map<string, string>> {
  const { data } = await sb.from('work_orders').select('id, work_order_code');
  const map = new Map<string, string>();
  for (const w of data ?? []) {
    map.set(String(w.id), String(w.work_order_code ?? ''));
  }
  return map;
}

export async function getProfileNameMap(sb: SupabaseAdminClient): Promise<Map<string, string>> {
  const { data } = await sb.from('profiles').select('id, full_name');
  const map = new Map<string, string>();
  for (const p of data ?? []) {
    map.set(String(p.id), String(p.full_name ?? 'Admin'));
  }
  return map;
}

export async function insertSupabaseNotification(
  sb: SupabaseAdminClient,
  notif: {
    eventType: string;
    title: string;
    message: string;
    entityType: string;
    entityId: string;
    recipientRole?: string;
  }
): Promise<void> {
  await sb.from('notifications').insert({
    event_type: notif.eventType,
    title: notif.title,
    message: notif.message,
    entity_type: notif.entityType,
    entity_id: notif.entityId,
    is_read: false,
    recipient_role: notif.recipientRole || 'All Admins'
  });
}

export async function insertSupabaseWorkOrderTimeline(
  sb: SupabaseAdminClient,
  workOrderId: string,
  actorName: string,
  eventType: string,
  description: string
): Promise<void> {
  await sb.from('work_order_timeline').insert({
    work_order_id: workOrderId,
    actor_name: actorName,
    event_type: eventType,
    description
  });
}

export async function getSupabaseBusinessSettings(sb: SupabaseAdminClient): Promise<BusinessSettingsEntity> {
  const { data } = await sb.from('business_settings').select('*').eq('id', 1).maybeSingle();
  return mapSettingsRow(data as Record<string, unknown> | null);
}

export async function getPublicBootstrapFromSupabase(sb: SupabaseAdminClient): Promise<PublicBootstrapData> {
  const [svcRes, galRes, covRes, revRes, woRes, settingsRow] = await Promise.all([
    sb
      .from('services')
      .select('*')
      .eq('is_visible', true)
      .eq('is_archived', false)
      .order('sort_order', { ascending: true }),
    sb
      .from('gallery_cases')
      .select('*')
      .eq('is_published', true)
      .order('sort_order', { ascending: true }),
    sb.from('coverage_regions').select('*').eq('is_published', true).order('is_headquarters', { ascending: false }),
    sb
      .from('reviews')
      .select('*')
      .eq('publication_status', 'Published')
      .order('sort_order', { ascending: true }),
    sb
      .from('work_orders')
      .select('*')
      .eq('is_archived', false)
      .in('status', ['Open Bid', 'Dispatched', 'In Progress', 'QC Verified'])
      .order('created_at', { ascending: false }),
    sb.from('business_settings').select('*').eq('id', 1).maybeSingle()
  ]);

  const err = svcRes.error || galRes.error || covRes.error || revRes.error || woRes.error || settingsRow.error;
  if (err) {
    throw new Error(`Supabase query error: ${err.message}`);
  }

  return {
    services: (svcRes.data ?? []).map((r) => mapServiceRow(r as Record<string, unknown>)),
    galleryCases: (galRes.data ?? []).map((r) => mapGalleryRow(r as Record<string, unknown>)),
    coverageRegions: (covRes.data ?? []).map((r) => mapCoverageRow(r as Record<string, unknown>)),
    reviews: (revRes.data ?? []).map((r) => mapReviewRow(r as Record<string, unknown>)),
    publicWorkOrders: (woRes.data ?? []).map((w) => {
      const slaDeadline = w.sla_deadline ? String(w.sla_deadline) : null;
      return {
        id: String(w.id),
        workOrderCode: String(w.work_order_code ?? ''),
        clientType: (w.client_type as ClientType) || 'Property Manager',
        serviceType: String(w.service_description ?? ''),
        cityState: `${String(w.city ?? '')}, ${String(w.state ?? '')}`,
        county: String(w.county ?? ''),
        status: (w.status as WorkOrderStatus) || 'Open Bid',
        slaDue: slaDeadline
          ? `SLA: ${new Date(slaDeadline).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
          : 'Standard SLA',
        estimatedBudget: Number(w.estimated_budget ?? 0),
        coordinates:
          w.lat != null && w.lng != null ? { lat: Number(w.lat), lng: Number(w.lng) } : null
      };
    }),
    businessSettings: mapSettingsRow(settingsRow.data as Record<string, unknown> | null)
  };
}

export const DEFAULT_NOTIFICATION_EVENTS: Record<string, boolean> = {
  new_bid_request: true,
  new_vendor_application: true,
  new_vendor_bid: true,
  new_dispatch_request: true,
  new_work_order: true,
  qc_rejected: true,
  work_order_completed: true
};

export async function getSupabaseNotificationPrefs(
  sb: SupabaseAdminClient,
  profileId: string
): Promise<NotificationPreferenceEntity> {
  const { data } = await sb
    .from('notification_preferences')
    .select('email_enabled, events_config')
    .eq('profile_id', profileId)
    .maybeSingle();

  if (!data) {
    return {
      emailEnabled: false,
      events: { ...DEFAULT_NOTIFICATION_EVENTS }
    };
  }
  return {
    emailEnabled: Boolean(data.email_enabled),
    events:
      data.events_config && typeof data.events_config === 'object'
        ? (data.events_config as Record<string, boolean>)
        : { ...DEFAULT_NOTIFICATION_EVENTS }
  };
}
