export type AdminRoleName =
  | 'Super Admin'
  | 'Admin'
  | 'Operations Manager'
  | 'Vendor Manager'
  | 'Support Manager';

export type PermissionKey =
  | 'dashboard.view'
  | 'work_orders.read'
  | 'work_orders.write'
  | 'work_orders.delete'
  | 'work_orders.qc'
  | 'vendors.read'
  | 'vendors.write'
  | 'vendors.approve'
  | 'clients.read'
  | 'clients.write'
  | 'bid_requests.read'
  | 'bid_requests.write'
  | 'bid_requests.convert'
  | 'vendor_bids.read'
  | 'vendor_bids.decide'
  | 'dispatch.read'
  | 'dispatch.write'
  | 'services.manage'
  | 'gallery.manage'
  | 'coverage.manage'
  | 'reviews.manage'
  | 'messages.manage'
  | 'reports.view'
  | 'reports.export'
  | 'settings.manage'
  | 'admin_users.manage'
  | 'audit.view';

export const ALL_PERMISSION_KEYS: PermissionKey[] = [
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
];

export type WorkOrderStatus =
  | 'New'
  | 'Open Bid'
  | 'Bid Review'
  | 'Approved'
  | 'Dispatched'
  | 'Scheduled'
  | 'In Progress'
  | 'Submitted for QC'
  | 'QC Rejected'
  | 'QC Verified'
  | 'Completed'
  | 'Cancelled';

export const WORK_ORDER_STATUSES: WorkOrderStatus[] = [
  'New',
  'Open Bid',
  'Bid Review',
  'Approved',
  'Dispatched',
  'Scheduled',
  'In Progress',
  'Submitted for QC',
  'QC Rejected',
  'QC Verified',
  'Completed',
  'Cancelled'
];

export type PriorityLevel = 'Low' | 'Normal' | 'High' | 'Urgent';

export const PRIORITY_LEVELS: PriorityLevel[] = ['Low', 'Normal', 'High', 'Urgent'];

export type ClientType =
  | 'Mortgage Servicer'
  | 'REO Asset Manager'
  | 'Property Manager'
  | 'Homeowner'
  | 'Other';

export const CLIENT_TYPES: ClientType[] = [
  'Mortgage Servicer',
  'REO Asset Manager',
  'Property Manager',
  'Homeowner',
  'Other'
];

export type VendorApplicationStatus =
  | 'Pending'
  | 'Under Review'
  | 'Approved'
  | 'Rejected'
  | 'Suspended';

export const VENDOR_APPLICATION_STATUSES: VendorApplicationStatus[] = [
  'Pending',
  'Under Review',
  'Approved',
  'Rejected',
  'Suspended'
];

export type BidRequestStatus =
  | 'New'
  | 'Pending Review'
  | 'Contacted'
  | 'Estimating'
  | 'Proposal Sent'
  | 'Approved'
  | 'Converted'
  | 'Rejected'
  | 'Archived';

export const BID_REQUEST_STATUSES: BidRequestStatus[] = [
  'New',
  'Pending Review',
  'Contacted',
  'Estimating',
  'Proposal Sent',
  'Approved',
  'Converted',
  'Rejected',
  'Archived'
];

export type VendorBidStatus =
  | 'Submitted'
  | 'Under Review'
  | 'Accepted'
  | 'Rejected'
  | 'Withdrawn';

export const VENDOR_BID_STATUSES: VendorBidStatus[] = [
  'Submitted',
  'Under Review',
  'Accepted',
  'Rejected',
  'Withdrawn'
];

export type DispatchStatus =
  | 'New'
  | 'Acknowledged'
  | 'Assigned'
  | 'En Route'
  | 'In Progress'
  | 'Resolved'
  | 'Closed';

export const DISPATCH_STATUSES: DispatchStatus[] = [
  'New',
  'Acknowledged',
  'Assigned',
  'En Route',
  'In Progress',
  'Resolved',
  'Closed'
];

export type MessageStatus = 'Unread' | 'Read' | 'Responded' | 'Archived';
export type ReviewPublicationStatus = 'Pending' | 'Approved' | 'Published' | 'Hidden';

export interface AdminUserProfile {
  id: string;
  email: string;
  fullName: string;
  phone: string;
  avatarUrl: string;
  role: AdminRoleName;
  accountStatus: 'active' | 'suspended' | 'invited';
  permissions: PermissionKey[];
  lastLoginAt: string | null;
  createdAt: string;
}

export interface RolePermissionConfig {
  role: AdminRoleName;
  description: string;
  permissions: PermissionKey[];
}

export interface ClientPropertyRecord {
  id: string;
  clientId: string;
  address: string;
  city: string;
  state: string;
  zipCode: string;
  county: string;
  lat: number | null;
  lng: number | null;
  occupancyStatus: string;
  lockboxCode: string;
  notes: string;
  createdAt: string;
}

export interface ClientRecord {
  id: string;
  clientCode: string;
  companyName: string;
  contactName: string;
  email: string;
  phone: string;
  clientType: ClientType;
  address: string;
  notes: string;
  accountStatus: 'active' | 'archived';
  isDemo: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface VendorDocumentRecord {
  id: string;
  vendorId: string;
  docType: string;
  fileName: string;
  storageBucket: string;
  storagePath: string;
  mimeType: string;
  fileSize: number;
  verified: boolean;
  expiresAt: string | null;
  createdAt: string;
}

export interface VendorRecord {
  id: string;
  vendorCode: string;
  companyName: string;
  contactPerson: string;
  email: string;
  phone: string;
  address: string;
  city: string;
  state: string;
  zipCode: string;
  serviceCategories: string[];
  coverageAreas: string;
  counties: string[];
  licenseInfo: string;
  insuranceInfo: string;
  aspenGroveAbc: string;
  applicationStatus: VendorApplicationStatus;
  accountStatus: 'pending' | 'active' | 'suspended';
  rating: number | null;
  completedWorkOrders: number;
  notes: string;
  isDemo: boolean;
  registrationDate: string;
  updatedAt: string;
}

export interface WorkOrderNote {
  id: string;
  workOrderId: string;
  authorName: string;
  isInternal: boolean;
  body: string;
  createdAt: string;
}

export interface WorkOrderAttachment {
  id: string;
  workOrderId: string;
  kind: 'document' | 'before_photo' | 'after_photo';
  fileName: string;
  storageBucket: string;
  storagePath: string;
  mimeType: string;
  fileSize: number;
  uploadedBy: string;
  createdAt: string;
}

export interface WorkOrderTimelineEvent {
  id: string;
  workOrderId: string;
  actorName: string;
  eventType: string;
  description: string;
  createdAt: string;
}

export interface WorkOrderEntity {
  id: string;
  workOrderCode: string;
  clientId: string | null;
  clientName: string;
  clientType: ClientType;
  propertyAddress: string;
  city: string;
  state: string;
  zipCode: string;
  county: string;
  lat: number | null;
  lng: number | null;
  serviceCategory: string;
  serviceDescription: string;
  priority: PriorityLevel;
  estimatedBudget: number;
  approvedBudget: number | null;
  assignedVendorId: string | null;
  assignedVendorName: string;
  createdDate: string;
  scheduledDate: string | null;
  slaDeadline: string | null;
  completionDate: string | null;
  status: WorkOrderStatus;
  qcNotes: string;
  isArchived: boolean;
  isDemo: boolean;
  updatedAt: string;
}

export interface BidRequestEntity {
  id: string;
  requestCode: string;
  contactName: string;
  email: string;
  phone: string;
  propertyAddress: string;
  city: string;
  state: string;
  zipCode: string;
  requestedServices: string;
  notes: string;
  estimatorData: {
    categoryLabel: string;
    lowEstimate: number;
    highEstimate: number;
    summary: string;
  } | null;
  status: BidRequestStatus;
  internalNotes: string;
  convertedWorkOrderId: string | null;
  isArchived: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface VendorBidEntity {
  id: string;
  bidCode: string;
  workOrderId: string;
  workOrderCode: string;
  vendorId: string | null;
  vendorName: string;
  aspenGroveAbc: string;
  proposedPrice: number;
  estimatedCompletionTime: string;
  bidNotes: string;
  attachments: string[];
  status: VendorBidStatus;
  clarificationNote: string;
  submittedDate: string;
  updatedAt: string;
}

export interface DispatchTimelineEntry {
  id: string;
  actorName: string;
  description: string;
  createdAt: string;
}

export interface DispatchRequestEntity {
  id: string;
  dispatchCode: string;
  contactName: string;
  phone: string;
  email: string;
  propertyAddress: string;
  city: string;
  state: string;
  zipCode: string;
  emergencyType: string;
  description: string;
  priority: PriorityLevel;
  status: DispatchStatus;
  assignedVendorId: string | null;
  assignedVendorName: string;
  internalNotes: string;
  timeline: DispatchTimelineEntry[];
  submittedDate: string;
  updatedAt: string;
}

export interface ManagedServiceEntity {
  id: string;
  serviceNumber: string;
  slug: string;
  title: string;
  subtitle: string;
  category: string;
  pricingModel: string;
  basePrice: number;
  turnaround: string;
  items: string[];
  complianceNote: string;
  imageUrl: string;
  isVisible: boolean;
  sortOrder: number;
  isArchived: boolean;
  isDemo: boolean;
  updatedAt: string;
}

export interface GalleryCaseEntity {
  id: string;
  slug: string;
  title: string;
  location: string;
  workOrderId: string;
  scopeSummary: string;
  turnaroundHours: number;
  beforeImage: string;
  afterImage: string;
  beforeAlt: string;
  afterAlt: string;
  isPublished: boolean;
  sortOrder: number;
  isDemo: boolean;
  updatedAt: string;
}

export interface CoverageRegionEntity {
  id: string;
  region: string;
  hubCity: string;
  states: string[];
  counties: string[];
  activeCounties: number;
  avgDispatchHours: number;
  hudStandard: string;
  lat: number | null;
  lng: number | null;
  isHeadquarters: boolean;
  coverageStatus: 'Active' | 'Expanding' | 'Paused';
  isPublished: boolean;
  isDemo: boolean;
  updatedAt: string;
}

export interface ReviewEntity {
  id: string;
  reviewer: string;
  organization: string;
  role: string;
  rating: number;
  comment: string;
  serviceTag: string;
  dateLabel: string;
  isVerifiedCustomer: boolean;
  publicationStatus: ReviewPublicationStatus;
  sortOrder: number;
  isDemo: boolean;
  createdAt: string;
}

export interface ContactMessageEntity {
  id: string;
  senderName: string;
  senderEmail: string;
  senderPhone: string;
  subject: string;
  body: string;
  source: string;
  status: MessageStatus;
  internalNotes: string;
  linkedClientId: string | null;
  linkedBidRequestId: string | null;
  linkedWorkOrderId: string | null;
  linkedDispatchId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface NotificationEntity {
  id: string;
  eventType: string;
  title: string;
  message: string;
  entityType: string;
  entityId: string;
  isRead: boolean;
  recipientRole: string;
  createdAt: string;
}

export interface ActivityLogEntity {
  id: string;
  actorId: string | null;
  actorEmail: string;
  actorRole: string;
  action: string;
  entityType: string;
  entityId: string;
  summary: string;
  createdAt: string;
}

export interface BusinessSettingsEntity {
  businessName: string;
  phone: string;
  email: string;
  address: string;
  hours: string;
  logoUrl: string;
  defaultWoPriority: PriorityLevel;
  defaultSlaHours: number;
  autoNotifyUrgent: boolean;
  coverageRadiusNote: string;
  googleProfileUrl: string;
  googleRating: number;
  googleReviewCount: number;
  updatedAt: string;
}

export interface NotificationPreferenceEntity {
  emailEnabled: boolean;
  events: Record<string, boolean>;
}

export interface PublicBootstrapData {
  services: ManagedServiceEntity[];
  galleryCases: GalleryCaseEntity[];
  coverageRegions: CoverageRegionEntity[];
  reviews: ReviewEntity[];
  publicWorkOrders: Array<{
    id: string;
    workOrderCode: string;
    clientType: ClientType;
    serviceType: string;
    cityState: string;
    county: string;
    status: WorkOrderStatus;
    slaDue: string;
    estimatedBudget: number;
    coordinates: { lat: number; lng: number } | null;
  }>;
  businessSettings: BusinessSettingsEntity;
}
