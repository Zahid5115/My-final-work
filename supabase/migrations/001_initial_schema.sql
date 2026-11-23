-- =============================================================================
-- Smoker's Lawn Care Service LLC — Core PostgreSQL Schema (Migration 001)
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Helper trigger for automatic updated_at timestamps
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

-- 1. Admin Roles & Granular Permissions
CREATE TABLE IF NOT EXISTS public.admin_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE CHECK (name IN (
    'Super Admin',
    'Admin',
    'Operations Manager',
    'Vendor Manager',
    'Support Manager'
  )),
  description TEXT NOT NULL DEFAULT '',
  is_system BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.role_permissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  role_id UUID NOT NULL REFERENCES public.admin_roles(id) ON DELETE CASCADE,
  permission_key TEXT NOT NULL,
  allowed BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (role_id, permission_key)
);

-- 2. User / Admin Profiles (linked to auth.users)
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL UNIQUE,
  full_name TEXT NOT NULL,
  phone TEXT DEFAULT '',
  avatar_url TEXT DEFAULT '',
  role_id UUID REFERENCES public.admin_roles(id) ON DELETE RESTRICT,
  is_admin BOOLEAN NOT NULL DEFAULT FALSE,
  account_status TEXT NOT NULL DEFAULT 'active' CHECK (account_status IN ('active', 'suspended', 'invited')),
  last_login_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. Immutable Admin Activity Audit Logs
CREATE TABLE IF NOT EXISTS public.admin_activity_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  actor_email TEXT NOT NULL,
  actor_role TEXT NOT NULL,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  summary TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  ip_address TEXT DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4. Clients & Client Properties
CREATE TABLE IF NOT EXISTS public.clients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_code TEXT NOT NULL UNIQUE,
  company_name TEXT NOT NULL DEFAULT '',
  contact_name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT NOT NULL,
  client_type TEXT NOT NULL CHECK (client_type IN (
    'Mortgage Servicer',
    'REO Asset Manager',
    'Property Manager',
    'Homeowner',
    'Other'
  )),
  address TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  account_status TEXT NOT NULL DEFAULT 'active' CHECK (account_status IN ('active', 'archived')),
  is_demo BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.client_properties (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  address TEXT NOT NULL,
  city TEXT NOT NULL DEFAULT '',
  state TEXT NOT NULL DEFAULT '',
  zip_code TEXT NOT NULL DEFAULT '',
  county TEXT NOT NULL DEFAULT '',
  lat DOUBLE PRECISION,
  lng DOUBLE PRECISION,
  occupancy_status TEXT NOT NULL DEFAULT 'Vacant',
  lockbox_code TEXT DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 5. Vendors, Documents & Service Areas
CREATE TABLE IF NOT EXISTS public.vendors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_code TEXT NOT NULL UNIQUE,
  company_name TEXT NOT NULL,
  contact_person TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT NOT NULL,
  address TEXT NOT NULL DEFAULT '',
  city TEXT NOT NULL DEFAULT '',
  state TEXT NOT NULL DEFAULT '',
  zip_code TEXT NOT NULL DEFAULT '',
  service_categories TEXT[] NOT NULL DEFAULT '{}',
  coverage_areas TEXT NOT NULL DEFAULT '',
  counties TEXT[] NOT NULL DEFAULT '{}',
  license_info TEXT NOT NULL DEFAULT '',
  insurance_info TEXT NOT NULL DEFAULT '',
  aspen_grove_abc TEXT NOT NULL DEFAULT '',
  application_status TEXT NOT NULL DEFAULT 'Pending' CHECK (application_status IN (
    'Pending',
    'Under Review',
    'Approved',
    'Rejected',
    'Suspended'
  )),
  account_status TEXT NOT NULL DEFAULT 'pending' CHECK (account_status IN ('pending', 'active', 'suspended')),
  rating NUMERIC(3, 2) CHECK (rating IS NULL OR (rating >= 0 AND rating <= 5)),
  completed_work_orders INTEGER NOT NULL DEFAULT 0,
  notes TEXT NOT NULL DEFAULT '',
  is_demo BOOLEAN NOT NULL DEFAULT FALSE,
  registration_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.vendor_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id UUID NOT NULL REFERENCES public.vendors(id) ON DELETE CASCADE,
  doc_type TEXT NOT NULL,
  file_name TEXT NOT NULL,
  storage_bucket TEXT NOT NULL DEFAULT 'vendor-documents',
  storage_path TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  file_size BIGINT NOT NULL CHECK (file_size > 0),
  verified BOOLEAN NOT NULL DEFAULT FALSE,
  expires_at DATE,
  uploaded_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.vendor_service_areas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id UUID NOT NULL REFERENCES public.vendors(id) ON DELETE CASCADE,
  state_code TEXT NOT NULL,
  county_name TEXT NOT NULL,
  is_primary BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (vendor_id, state_code, county_name)
);

-- 6. Managed Services
CREATE TABLE IF NOT EXISTS public.services (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service_number TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  subtitle TEXT NOT NULL,
  category TEXT NOT NULL,
  pricing_model TEXT NOT NULL DEFAULT 'Per Work Order / Scope',
  base_price NUMERIC(10, 2) NOT NULL DEFAULT 0,
  turnaround TEXT NOT NULL,
  items JSONB NOT NULL DEFAULT '[]'::jsonb,
  compliance_note TEXT NOT NULL DEFAULT '',
  image_url TEXT NOT NULL DEFAULT '',
  is_visible BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_archived BOOLEAN NOT NULL DEFAULT FALSE,
  is_demo BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 7. Work Orders, Assignments, Notes, Attachments, Timeline
CREATE TABLE IF NOT EXISTS public.work_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  work_order_code TEXT NOT NULL UNIQUE,
  client_id UUID REFERENCES public.clients(id) ON DELETE SET NULL,
  client_name TEXT NOT NULL DEFAULT '',
  client_type TEXT NOT NULL CHECK (client_type IN (
    'Mortgage Servicer',
    'REO Asset Manager',
    'Property Manager',
    'Homeowner',
    'Other'
  )),
  property_address TEXT NOT NULL,
  city TEXT NOT NULL,
  state TEXT NOT NULL,
  zip_code TEXT NOT NULL DEFAULT '',
  county TEXT NOT NULL DEFAULT '',
  lat DOUBLE PRECISION,
  lng DOUBLE PRECISION,
  service_category TEXT NOT NULL,
  service_description TEXT NOT NULL,
  priority TEXT NOT NULL DEFAULT 'Normal' CHECK (priority IN ('Low', 'Normal', 'High', 'Urgent')),
  estimated_budget NUMERIC(12, 2) NOT NULL DEFAULT 0,
  approved_budget NUMERIC(12, 2),
  assigned_vendor_id UUID REFERENCES public.vendors(id) ON DELETE SET NULL,
  scheduled_date TIMESTAMPTZ,
  sla_deadline TIMESTAMPTZ,
  completion_date TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'New' CHECK (status IN (
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
  )),
  qc_notes TEXT NOT NULL DEFAULT '',
  is_archived BOOLEAN NOT NULL DEFAULT FALSE,
  is_demo BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.work_order_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  work_order_id UUID NOT NULL REFERENCES public.work_orders(id) ON DELETE CASCADE,
  vendor_id UUID NOT NULL REFERENCES public.vendors(id) ON DELETE CASCADE,
  assigned_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  assignment_status TEXT NOT NULL DEFAULT 'active' CHECK (assignment_status IN ('active', 'reassigned', 'completed', 'cancelled')),
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.work_order_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  work_order_id UUID NOT NULL REFERENCES public.work_orders(id) ON DELETE CASCADE,
  author_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  author_name TEXT NOT NULL,
  is_internal BOOLEAN NOT NULL DEFAULT TRUE,
  body TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.work_order_attachments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  work_order_id UUID NOT NULL REFERENCES public.work_orders(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('document', 'before_photo', 'after_photo')),
  file_name TEXT NOT NULL,
  storage_bucket TEXT NOT NULL DEFAULT 'work-order-attachments',
  storage_path TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  file_size BIGINT NOT NULL CHECK (file_size > 0),
  uploaded_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.work_order_timeline (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  work_order_id UUID NOT NULL REFERENCES public.work_orders(id) ON DELETE CASCADE,
  actor_name TEXT NOT NULL,
  event_type TEXT NOT NULL,
  description TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 8. Customer Bid Requests
CREATE TABLE IF NOT EXISTS public.bid_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_code TEXT NOT NULL UNIQUE,
  contact_name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT NOT NULL,
  property_address TEXT NOT NULL,
  city TEXT NOT NULL DEFAULT '',
  state TEXT NOT NULL DEFAULT '',
  zip_code TEXT NOT NULL DEFAULT '',
  requested_services TEXT NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  estimator_data JSONB,
  status TEXT NOT NULL DEFAULT 'New' CHECK (status IN (
    'New',
    'Pending Review',
    'Contacted',
    'Estimating',
    'Proposal Sent',
    'Approved',
    'Converted',
    'Rejected',
    'Archived'
  )),
  internal_notes TEXT NOT NULL DEFAULT '',
  converted_work_order_id UUID REFERENCES public.work_orders(id) ON DELETE SET NULL,
  is_archived BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 9. Vendor Bids
CREATE TABLE IF NOT EXISTS public.vendor_bids (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bid_code TEXT NOT NULL UNIQUE,
  work_order_id UUID NOT NULL REFERENCES public.work_orders(id) ON DELETE CASCADE,
  vendor_id UUID REFERENCES public.vendors(id) ON DELETE SET NULL,
  vendor_name TEXT NOT NULL,
  aspen_grove_abc TEXT NOT NULL DEFAULT '',
  proposed_price NUMERIC(12, 2) NOT NULL CHECK (proposed_price > 0),
  estimated_completion_time TEXT NOT NULL DEFAULT '48 Hours',
  bid_notes TEXT NOT NULL DEFAULT '',
  attachments JSONB NOT NULL DEFAULT '[]'::jsonb,
  status TEXT NOT NULL DEFAULT 'Submitted' CHECK (status IN (
    'Submitted',
    'Under Review',
    'Accepted',
    'Rejected',
    'Withdrawn'
  )),
  clarification_note TEXT NOT NULL DEFAULT '',
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 10. Urgent Dispatch Requests
CREATE TABLE IF NOT EXISTS public.dispatch_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dispatch_code TEXT NOT NULL UNIQUE,
  contact_name TEXT NOT NULL,
  phone TEXT NOT NULL,
  email TEXT NOT NULL DEFAULT '',
  property_address TEXT NOT NULL,
  city TEXT NOT NULL DEFAULT '',
  state TEXT NOT NULL DEFAULT '',
  zip_code TEXT NOT NULL DEFAULT '',
  emergency_type TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  priority TEXT NOT NULL DEFAULT 'Urgent' CHECK (priority IN ('Low', 'Normal', 'High', 'Urgent')),
  status TEXT NOT NULL DEFAULT 'New' CHECK (status IN (
    'New',
    'Acknowledged',
    'Assigned',
    'En Route',
    'In Progress',
    'Resolved',
    'Closed'
  )),
  assigned_vendor_id UUID REFERENCES public.vendors(id) ON DELETE SET NULL,
  internal_notes TEXT NOT NULL DEFAULT '',
  timeline JSONB NOT NULL DEFAULT '[]'::jsonb,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 11. Before / After Gallery Cases
CREATE TABLE IF NOT EXISTS public.gallery_cases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  location TEXT NOT NULL,
  work_order_code TEXT NOT NULL,
  scope_summary TEXT NOT NULL,
  turnaround_hours INTEGER NOT NULL CHECK (turnaround_hours > 0),
  before_image_url TEXT NOT NULL,
  after_image_url TEXT NOT NULL,
  before_alt TEXT NOT NULL DEFAULT '',
  after_alt TEXT NOT NULL DEFAULT '',
  is_published BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_demo BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 12. Coverage Regions
CREATE TABLE IF NOT EXISTS public.coverage_regions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  region_name TEXT NOT NULL UNIQUE,
  hub_city TEXT NOT NULL,
  states TEXT[] NOT NULL DEFAULT '{}',
  counties TEXT[] NOT NULL DEFAULT '{}',
  active_counties INTEGER NOT NULL DEFAULT 0,
  avg_dispatch_hours INTEGER NOT NULL DEFAULT 24,
  hud_standard TEXT NOT NULL DEFAULT '',
  lat DOUBLE PRECISION,
  lng DOUBLE PRECISION,
  is_headquarters BOOLEAN NOT NULL DEFAULT FALSE,
  coverage_status TEXT NOT NULL DEFAULT 'Active' CHECK (coverage_status IN ('Active', 'Expanding', 'Paused')),
  is_published BOOLEAN NOT NULL DEFAULT TRUE,
  is_demo BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 13. Reviews
CREATE TABLE IF NOT EXISTS public.reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reviewer_name TEXT NOT NULL,
  organization TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL DEFAULT '',
  rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment TEXT NOT NULL,
  service_tag TEXT NOT NULL DEFAULT '',
  review_date_label TEXT NOT NULL DEFAULT '',
  is_verified_customer BOOLEAN NOT NULL DEFAULT FALSE,
  publication_status TEXT NOT NULL DEFAULT 'Published' CHECK (publication_status IN ('Pending', 'Approved', 'Published', 'Hidden')),
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_demo BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 14. Centralized Messages & Contact Submissions
CREATE TABLE IF NOT EXISTS public.messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_name TEXT NOT NULL,
  sender_email TEXT NOT NULL DEFAULT '',
  sender_phone TEXT NOT NULL DEFAULT '',
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'Contact Form',
  status TEXT NOT NULL DEFAULT 'Unread' CHECK (status IN ('Unread', 'Read', 'Responded', 'Archived')),
  internal_notes TEXT NOT NULL DEFAULT '',
  linked_client_id UUID REFERENCES public.clients(id) ON DELETE SET NULL,
  linked_bid_request_id UUID REFERENCES public.bid_requests(id) ON DELETE SET NULL,
  linked_work_order_id UUID REFERENCES public.work_orders(id) ON DELETE SET NULL,
  linked_dispatch_id UUID REFERENCES public.dispatch_requests(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 15. Notifications & Preferences
CREATE TABLE IF NOT EXISTS public.notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type TEXT NOT NULL,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  is_read BOOLEAN NOT NULL DEFAULT FALSE,
  recipient_role TEXT NOT NULL DEFAULT 'All Admins',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.notification_preferences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID NOT NULL UNIQUE REFERENCES public.profiles(id) ON DELETE CASCADE,
  email_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  events_config JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 16. Business & Platform Settings
CREATE TABLE IF NOT EXISTS public.business_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  business_name TEXT NOT NULL DEFAULT 'Smoker''s Lawn Care Service LLC',
  phone TEXT NOT NULL DEFAULT '(217) 394-6440',
  email TEXT NOT NULL DEFAULT 'dispatch@smokerslawncareservice.com',
  address TEXT NOT NULL DEFAULT '4820 Meridian Parkway, Suite 210, Indianapolis, IN 46208',
  hours TEXT NOT NULL DEFAULT 'Mon–Sat 7:00 AM – 7:00 PM EST · 24/7 Emergency Dispatch',
  logo_url TEXT NOT NULL DEFAULT '',
  default_wo_priority TEXT NOT NULL DEFAULT 'Normal',
  default_sla_hours INTEGER NOT NULL DEFAULT 48,
  auto_notify_urgent BOOLEAN NOT NULL DEFAULT TRUE,
  coverage_radius_note TEXT NOT NULL DEFAULT '38 U.S. States · 1,099+ Active Counties',
  google_profile_url TEXT NOT NULL DEFAULT 'https://www.google.com/maps/search/?api=1&query=Smokers+Lawn+Care+Service+LLC+Indianapolis+IN',
  google_rating NUMERIC(3, 2) NOT NULL DEFAULT 4.9,
  google_review_count INTEGER NOT NULL DEFAULT 284,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Performance Indexes
CREATE INDEX IF NOT EXISTS idx_profiles_role ON public.profiles(role_id);
CREATE INDEX IF NOT EXISTS idx_activity_logs_created ON public.admin_activity_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_logs_entity ON public.admin_activity_logs(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_work_orders_status ON public.work_orders(status);
CREATE INDEX IF NOT EXISTS idx_work_orders_priority ON public.work_orders(priority);
CREATE INDEX IF NOT EXISTS idx_work_orders_sla ON public.work_orders(sla_deadline);
CREATE INDEX IF NOT EXISTS idx_work_orders_vendor ON public.work_orders(assigned_vendor_id);
CREATE INDEX IF NOT EXISTS idx_work_orders_client ON public.work_orders(client_id);
CREATE INDEX IF NOT EXISTS idx_vendors_status ON public.vendors(application_status, account_status);
CREATE INDEX IF NOT EXISTS idx_bid_requests_status ON public.bid_requests(status);
CREATE INDEX IF NOT EXISTS idx_vendor_bids_wo ON public.vendor_bids(work_order_id);
CREATE INDEX IF NOT EXISTS idx_dispatch_status ON public.dispatch_requests(status, priority);
CREATE INDEX IF NOT EXISTS idx_messages_status ON public.messages(status);
CREATE INDEX IF NOT EXISTS idx_notifications_read ON public.notifications(is_read, created_at DESC);

-- Updated-at Triggers
DROP TRIGGER IF EXISTS trg_admin_roles_updated ON public.admin_roles;
CREATE TRIGGER trg_admin_roles_updated BEFORE UPDATE ON public.admin_roles FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_profiles_updated ON public.profiles;
CREATE TRIGGER trg_profiles_updated BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_clients_updated ON public.clients;
CREATE TRIGGER trg_clients_updated BEFORE UPDATE ON public.clients FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_vendors_updated ON public.vendors;
CREATE TRIGGER trg_vendors_updated BEFORE UPDATE ON public.vendors FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_services_updated ON public.services;
CREATE TRIGGER trg_services_updated BEFORE UPDATE ON public.services FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_work_orders_updated ON public.work_orders;
CREATE TRIGGER trg_work_orders_updated BEFORE UPDATE ON public.work_orders FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_bid_requests_updated ON public.bid_requests;
CREATE TRIGGER trg_bid_requests_updated BEFORE UPDATE ON public.bid_requests FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_vendor_bids_updated ON public.vendor_bids;
CREATE TRIGGER trg_vendor_bids_updated BEFORE UPDATE ON public.vendor_bids FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_dispatch_updated ON public.dispatch_requests;
CREATE TRIGGER trg_dispatch_updated BEFORE UPDATE ON public.dispatch_requests FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_gallery_updated ON public.gallery_cases;
CREATE TRIGGER trg_gallery_updated BEFORE UPDATE ON public.gallery_cases FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_coverage_updated ON public.coverage_regions;
CREATE TRIGGER trg_coverage_updated BEFORE UPDATE ON public.coverage_regions FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_reviews_updated ON public.reviews;
CREATE TRIGGER trg_reviews_updated BEFORE UPDATE ON public.reviews FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_messages_updated ON public.messages;
CREATE TRIGGER trg_messages_updated BEFORE UPDATE ON public.messages FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_settings_updated ON public.business_settings;
CREATE TRIGGER trg_settings_updated BEFORE UPDATE ON public.business_settings FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
