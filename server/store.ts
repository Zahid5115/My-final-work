import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type {
  ActivityLogEntity,
  AdminRoleName,
  BidRequestEntity,
  BusinessSettingsEntity,
  ClientPropertyRecord,
  ClientRecord,
  ContactMessageEntity,
  CoverageRegionEntity,
  DispatchRequestEntity,
  GalleryCaseEntity,
  ManagedServiceEntity,
  NotificationEntity,
  NotificationPreferenceEntity,
  PermissionKey,
  ReviewEntity,
  RolePermissionConfig,
  VendorBidEntity,
  VendorDocumentRecord,
  VendorRecord,
  WorkOrderAttachment,
  WorkOrderEntity,
  WorkOrderNote,
  WorkOrderTimelineEvent
} from '../src/types/platform.ts';
import {
  BEFORE_AFTER_CASES,
  CORE_SERVICES,
  COVERAGE_REGIONS,
  GOOGLE_PROFILE_INFO,
  GOOGLE_REVIEWS,
  SAMPLE_WORK_ORDERS
} from '../src/data/servicesData.ts';
import { isProductionEnvironment } from './supabaseAdmin.ts';

export interface StoredAdminUser {
  id: string;
  email: string;
  fullName: string;
  phone: string;
  avatarUrl: string;
  role: AdminRoleName;
  accountStatus: 'active' | 'suspended' | 'invited';
  passwordHash: string;
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PasswordResetTokenRecord {
  id: string;
  adminId: string;
  tokenHash: string;
  expiresAt: string;
  used: boolean;
  createdAt: string;
}

export interface PlatformDbState {
  seededAt: string;
  roles: RolePermissionConfig[];
  admins: StoredAdminUser[];
  passwordResets: PasswordResetTokenRecord[];
  revokedJtis: string[];
  activityLogs: ActivityLogEntity[];
  clients: ClientRecord[];
  clientProperties: ClientPropertyRecord[];
  vendors: VendorRecord[];
  vendorDocuments: VendorDocumentRecord[];
  services: ManagedServiceEntity[];
  workOrders: WorkOrderEntity[];
  workOrderNotes: WorkOrderNote[];
  workOrderAttachments: WorkOrderAttachment[];
  workOrderTimeline: WorkOrderTimelineEvent[];
  bidRequests: BidRequestEntity[];
  vendorBids: VendorBidEntity[];
  dispatchRequests: DispatchRequestEntity[];
  galleryCases: GalleryCaseEntity[];
  coverageRegions: CoverageRegionEntity[];
  reviews: ReviewEntity[];
  messages: ContactMessageEntity[];
  notifications: NotificationEntity[];
  notificationPreferences: Record<string, NotificationPreferenceEntity>;
  businessSettings: BusinessSettingsEntity;
}

const DATA_DIR = path.resolve(process.cwd(), 'data');
const DB_FILE = path.join(DATA_DIR, 'platform-db.json');
export const UPLOADS_ROOT = path.resolve(process.cwd(), 'uploads');

export const DEFAULT_ROLES: RolePermissionConfig[] = [
  {
    role: 'Super Admin',
    description: 'Full platform authority including RBAC, admin invitations, and settings.',
    permissions: [
      'dashboard.view',
      'work_orders.read',
      'work_orders.write',
      'work_orders.delete',
      'work_orders.qc',
      'vendors.read',
      'vendors.write',
      'vendors.approve',
      'clients.read',
      'clients.write',
      'bid_requests.read',
      'bid_requests.write',
      'bid_requests.convert',
      'vendor_bids.read',
      'vendor_bids.decide',
      'dispatch.read',
      'dispatch.write',
      'services.manage',
      'gallery.manage',
      'coverage.manage',
      'reviews.manage',
      'messages.manage',
      'reports.view',
      'reports.export',
      'settings.manage',
      'admin_users.manage',
      'audit.view'
    ]
  },
  {
    role: 'Admin',
    description: 'Operational oversight across work orders, vendors, clients, and CMS.',
    permissions: [
      'dashboard.view',
      'work_orders.read',
      'work_orders.write',
      'work_orders.delete',
      'work_orders.qc',
      'vendors.read',
      'vendors.write',
      'vendors.approve',
      'clients.read',
      'clients.write',
      'bid_requests.read',
      'bid_requests.write',
      'bid_requests.convert',
      'vendor_bids.read',
      'vendor_bids.decide',
      'dispatch.read',
      'dispatch.write',
      'services.manage',
      'gallery.manage',
      'coverage.manage',
      'reviews.manage',
      'messages.manage',
      'reports.view',
      'reports.export',
      'settings.manage',
      'audit.view'
    ]
  },
  {
    role: 'Operations Manager',
    description: 'Manages work orders, QC reviews, urgent dispatch, and coverage.',
    permissions: [
      'dashboard.view',
      'work_orders.read',
      'work_orders.write',
      'work_orders.qc',
      'vendors.read',
      'clients.read',
      'bid_requests.read',
      'bid_requests.convert',
      'vendor_bids.read',
      'vendor_bids.decide',
      'dispatch.read',
      'dispatch.write',
      'coverage.manage',
      'reports.view'
    ]
  },
  {
    role: 'Vendor Manager',
    description: 'Approves vendors, monitors compliance docs, and awards bids.',
    permissions: [
      'dashboard.view',
      'vendors.read',
      'vendors.write',
      'vendors.approve',
      'vendor_bids.read',
      'vendor_bids.decide',
      'work_orders.read',
      'reports.view'
    ]
  },
  {
    role: 'Support Manager',
    description: 'Handles bid requests, client messages, reviews, and reporting.',
    permissions: [
      'dashboard.view',
      'clients.read',
      'clients.write',
      'bid_requests.read',
      'bid_requests.write',
      'dispatch.read',
      'dispatch.write',
      'messages.manage',
      'reviews.manage',
      'reports.view'
    ]
  }
];

function hoursFromNowIso(hours: number): string {
  return new Date(Date.now() + hours * 3600 * 1000).toISOString();
}

function daysAgoIso(days: number): string {
  return new Date(Date.now() - days * 86400 * 1000).toISOString();
}

function buildInitialState(): PlatformDbState {
  const now = new Date().toISOString();

  const demoClients: ClientRecord[] = [
    {
      id: 'cli-demo-1',
      clientCode: 'CLI-1001',
      companyName: 'Heartland Mortgage Servicing',
      contactName: 'Rachel Vance',
      email: 'assetops@heartlandreo.example',
      phone: '(317) 555-0142',
      clientType: 'Mortgage Servicer',
      address: '200 N Illinois St, Indianapolis, IN 46204',
      notes: 'Primary Midwest HUD preservation portfolio (demo record).',
      accountStatus: 'active',
      isDemo: true,
      createdAt: daysAgoIso(28),
      updatedAt: now
    },
    {
      id: 'cli-demo-2',
      clientCode: 'CLI-1002',
      companyName: 'Keystone SFR Portfolio',
      contactName: 'Marcus Delgado',
      email: 'fieldops@keystonesfr.example',
      phone: '(502) 555-0199',
      clientType: 'Property Manager',
      address: '401 W Main St, Louisville, KY 40202',
      notes: 'REO make-ready & handyman turn account (demo record).',
      accountStatus: 'active',
      isDemo: true,
      createdAt: daysAgoIso(18),
      updatedAt: now
    }
  ];

  const demoVendors: VendorRecord[] = [
    {
      id: 'vnd-demo-1',
      vendorCode: 'VND-20410',
      companyName: 'Hoosier Field Preservation LLC',
      contactPerson: 'Caleb Dawson',
      email: 'dispatch@hoosierfield.example',
      phone: '(317) 555-0164',
      address: '1240 S Meridian St',
      city: 'Indianapolis',
      state: 'IN',
      zipCode: '46225',
      serviceCategories: ['Lawn Maintenance', 'Debris Removal', 'Winterization'],
      coverageAreas: 'IN, OH, KY',
      counties: ['Marion', 'Hamilton', 'Franklin'],
      licenseInfo: 'IN-CONTR-88412',
      insuranceInfo: '$2M GL / $1M E&O Verified',
      aspenGroveAbc: 'ABC-882410',
      applicationStatus: 'Approved',
      accountStatus: 'active',
      rating: 4.9,
      completedWorkOrders: 42,
      notes: 'Preferred Midwest winterization & securing crew (demo record).',
      isDemo: true,
      registrationDate: daysAgoIso(45),
      updatedAt: now
    },
    {
      id: 'vnd-demo-2',
      vendorCode: 'VND-20419',
      companyName: 'Piedmont Exterior & Storm Pros',
      contactPerson: 'Elena Brooks',
      email: 'ops@piedmontpros.example',
      phone: '(704) 555-0133',
      address: '890 Tryon Rd',
      city: 'Charlotte',
      state: 'NC',
      zipCode: '28202',
      serviceCategories: ['Lock Changes & Boarding', 'Debris Removal', 'Drywall & Painting'],
      coverageAreas: 'NC, SC, TN',
      counties: ['Mecklenburg', 'Davidson'],
      licenseInfo: 'NC-GC-44901',
      insuranceInfo: '$2M GL Verified',
      aspenGroveAbc: 'ABC-904112',
      applicationStatus: 'Pending',
      accountStatus: 'pending',
      rating: null,
      completedWorkOrders: 0,
      notes: 'Awaiting W-9 and COI expiration confirmation (demo record).',
      isDemo: true,
      registrationDate: daysAgoIso(2),
      updatedAt: now
    }
  ];

  const services: ManagedServiceEntity[] = CORE_SERVICES.map((svc, idx) => ({
    id: `svc-demo-${idx + 1}`,
    serviceNumber: svc.number,
    slug: svc.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, ''),
    title: svc.title,
    subtitle: svc.subtitle,
    category: svc.title,
    pricingModel: idx === 1 ? 'Per Lot Tier / Recurring' : idx === 2 ? 'Time & Materials / Xactimate' : 'HUD Allowable / Turnkey',
    basePrice: idx === 0 ? 350 : idx === 1 ? 125 : idx === 2 ? 240 : 295,
    turnaround: svc.turnaround,
    items: [...svc.items],
    complianceNote: svc.complianceNote,
    imageUrl: '',
    isVisible: true,
    sortOrder: idx + 1,
    isArchived: false,
    isDemo: true,
    updatedAt: now
  }));

  const galleryCases: GalleryCaseEntity[] = BEFORE_AFTER_CASES.map((g, idx) => ({
    id: `gal-demo-${idx + 1}`,
    slug: g.id,
    title: g.title,
    location: g.location,
    workOrderId: g.workOrderId,
    scopeSummary: g.scopeSummary,
    turnaroundHours: g.turnaroundHours,
    beforeImage: g.beforeImage,
    afterImage: g.afterImage,
    beforeAlt: g.beforeAlt,
    afterAlt: g.afterAlt,
    isPublished: true,
    sortOrder: idx + 1,
    isDemo: true,
    updatedAt: now
  }));

  const coverageRegions: CoverageRegionEntity[] = COVERAGE_REGIONS.map((r, idx) => ({
    id: `cov-demo-${idx + 1}`,
    region: r.region,
    hubCity: r.hubCity,
    states: [...r.states],
    counties: [],
    activeCounties: r.activeCounties,
    avgDispatchHours: r.avgDispatchHours,
    hudStandard: r.hudStandard,
    lat: r.coordinates.lat,
    lng: r.coordinates.lng,
    isHeadquarters: Boolean(r.isHeadquarters),
    coverageStatus: 'Active',
    isPublished: true,
    isDemo: true,
    updatedAt: now
  }));

  const workOrders: WorkOrderEntity[] = SAMPLE_WORK_ORDERS.map((wo, idx) => {
    const [city, state] = wo.cityState.split(',').map((s) => s.trim());
    return {
      id: `wo-demo-${idx + 1}`,
      workOrderCode: wo.id,
      clientId: idx === 0 ? 'cli-demo-1' : idx === 2 ? 'cli-demo-2' : null,
      clientName: idx === 0 ? 'Heartland Mortgage Servicing' : idx === 2 ? 'Keystone SFR Portfolio' : `${wo.clientType} Account`,
      clientType: wo.clientType,
      propertyAddress: `${1100 + idx * 315} Oakridge Pkwy`,
      city: city || 'Indianapolis',
      state: state || 'IN',
      zipCode: `4620${idx + 1}`,
      county: wo.county,
      lat: wo.coordinates.lat,
      lng: wo.coordinates.lng,
      serviceCategory:
        idx === 0
          ? 'Property Preservation & Securing'
          : idx === 1
          ? 'Property Preservation & Securing'
          : idx === 2
          ? 'Handyman & REO Turnkey Repairs'
          : idx === 3
          ? 'Inspections & Emergency Storm Assessment'
          : 'Lawn Care & Grounds Maintenance',
      serviceDescription: wo.serviceType,
      priority: idx === 3 ? 'Urgent' : idx < 2 ? 'High' : 'Normal',
      estimatedBudget: wo.estimatedBudget,
      approvedBudget: wo.status === 'QC Verified' || wo.status === 'In Progress' ? wo.estimatedBudget : null,
      assignedVendorId: idx < 3 ? 'vnd-demo-1' : null,
      assignedVendorName: idx < 3 ? 'Hoosier Field Preservation LLC' : '',
      createdDate: daysAgoIso(5 - idx),
      scheduledDate: hoursFromNowIso(12 + idx * 6),
      slaDeadline: idx === 0 ? daysAgoIso(1) : hoursFromNowIso(6 + idx * 10),
      completionDate: wo.status === 'QC Verified' ? daysAgoIso(1) : null,
      status: wo.status,
      qcNotes: wo.status === 'QC Verified' ? 'GPS timestamped photo log verified against HUD ML 2022-07.' : '',
      isArchived: false,
      isDemo: true,
      updatedAt: now
    };
  });

  const reviews: ReviewEntity[] = GOOGLE_REVIEWS.map((rev, idx) => ({
    id: `rev-demo-${idx + 1}`,
    reviewer: rev.reviewer,
    organization: rev.organization,
    role: rev.role,
    rating: rev.rating,
    comment: rev.comment,
    serviceTag: rev.serviceTag,
    dateLabel: rev.dateLabel,
    isVerifiedCustomer: false,
    publicationStatus: 'Published',
    sortOrder: idx + 1,
    isDemo: true,
    createdAt: daysAgoIso(10 + idx * 7)
  }));

  const timeline: WorkOrderTimelineEvent[] = workOrders.map((wo) => ({
    id: crypto.randomUUID(),
    workOrderId: wo.id,
    actorName: 'System Demo Seed',
    eventType: 'created',
    description: `Demo work order ${wo.workOrderCode} initialized with status ${wo.status}.`,
    createdAt: wo.createdDate
  }));

  const vendorBids: VendorBidEntity[] = [
    {
      id: 'bid-demo-1',
      bidCode: 'BID-30112',
      workOrderId: 'wo-demo-4',
      workOrderCode: 'SLC-26-4129',
      vendorId: 'vnd-demo-2',
      vendorName: 'Piedmont Exterior & Storm Pros',
      aspenGroveAbc: 'ABC-904112',
      proposedPrice: 890,
      estimatedCompletionTime: '6 Hours',
      bidNotes: '2-person roof tarping & chainsaw crew staged in Charlotte.',
      attachments: [],
      status: 'Submitted',
      clarificationNote: '',
      submittedDate: daysAgoIso(1),
      updatedAt: now
    }
  ];

  return {
    seededAt: now,
    roles: JSON.parse(JSON.stringify(DEFAULT_ROLES)) as RolePermissionConfig[],
    admins: [],
    passwordResets: [],
    revokedJtis: [],
    activityLogs: [],
    clients: demoClients,
    clientProperties: [
      {
        id: 'prop-demo-1',
        clientId: 'cli-demo-1',
        address: '4120 N Meridian St',
        city: 'Indianapolis',
        state: 'IN',
        zipCode: '46208',
        county: 'Marion',
        lat: 39.7684,
        lng: -86.1581,
        occupancyStatus: 'Vacant',
        lockboxCode: '4490',
        notes: 'Demo REO asset property.',
        createdAt: daysAgoIso(20)
      }
    ],
    vendors: demoVendors,
    vendorDocuments: [],
    services,
    workOrders,
    workOrderNotes: [],
    workOrderAttachments: [],
    workOrderTimeline: timeline,
    bidRequests: [],
    vendorBids,
    dispatchRequests: [],
    galleryCases,
    coverageRegions,
    reviews,
    messages: [],
    notifications: [],
    notificationPreferences: {},
    businessSettings: {
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
      updatedAt: now
    }
  };
}

let cachedState: PlatformDbState | null = null;

function ensureDirectories(): void {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  for (const bucket of ['gallery', 'work-order-attachments', 'vendor-documents', 'dispatch-attachments']) {
    fs.mkdirSync(path.join(UPLOADS_ROOT, bucket), { recursive: true });
  }
}

export function getDbState(): PlatformDbState {
  if (isProductionEnvironment()) {
    throw new Error(
      'Local JSON persistence (data/platform-db.json) is disabled in production. Configure SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.'
    );
  }
  if (cachedState) return cachedState;
  ensureDirectories();
  if (fs.existsSync(DB_FILE)) {
    try {
      const raw = fs.readFileSync(DB_FILE, 'utf8');
      const parsed = JSON.parse(raw) as PlatformDbState;
      if (parsed && Array.isArray(parsed.roles) && Array.isArray(parsed.workOrders)) {
        cachedState = parsed;
        return cachedState;
      }
    } catch {
      // Fall through to clean re-seed if file was corrupted
    }
  }
  cachedState = buildInitialState();
  saveDbState(cachedState);
  return cachedState;
}

export function saveDbState(state: PlatformDbState): void {
  if (isProductionEnvironment()) {
    throw new Error(
      'Local JSON persistence (data/platform-db.json) is disabled in production. Configure SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.'
    );
  }
  ensureDirectories();
  cachedState = state;
  const tmpFile = `${DB_FILE}.tmp`;
  fs.writeFileSync(tmpFile, JSON.stringify(state, null, 2), 'utf8');
  fs.renameSync(tmpFile, DB_FILE);
}

export function getPermissionsForRole(state: PlatformDbState, roleName: AdminRoleName): PermissionKey[] {
  if (roleName === 'Super Admin') {
    return [...DEFAULT_ROLES[0].permissions];
  }
  const found = state.roles.find((r) => r.role === roleName);
  return found ? [...found.permissions] : [];
}

export function appendActivityLog(
  state: PlatformDbState,
  entry: {
    actorId: string | null;
    actorEmail: string;
    actorRole: string;
    action: string;
    entityType: string;
    entityId: string;
    summary: string;
  }
): void {
  state.activityLogs.unshift({
    id: crypto.randomUUID(),
    actorId: entry.actorId,
    actorEmail: entry.actorEmail,
    actorRole: entry.actorRole,
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId,
    summary: entry.summary,
    createdAt: new Date().toISOString()
  });
  if (state.activityLogs.length > 2000) {
    state.activityLogs.length = 2000;
  }
}

export function appendNotification(
  state: PlatformDbState,
  notif: {
    eventType: string;
    title: string;
    message: string;
    entityType: string;
    entityId: string;
    recipientRole?: string;
  }
): void {
  state.notifications.unshift({
    id: crypto.randomUUID(),
    eventType: notif.eventType,
    title: notif.title,
    message: notif.message,
    entityType: notif.entityType,
    entityId: notif.entityId,
    isRead: false,
    recipientRole: notif.recipientRole || 'All Admins',
    createdAt: new Date().toISOString()
  });
  if (state.notifications.length > 500) {
    state.notifications.length = 500;
  }
}

export function appendWorkOrderTimeline(
  state: PlatformDbState,
  workOrderId: string,
  actorName: string,
  eventType: string,
  description: string
): void {
  state.workOrderTimeline.unshift({
    id: crypto.randomUUID(),
    workOrderId,
    actorName,
    eventType,
    description,
    createdAt: new Date().toISOString()
  });
}
