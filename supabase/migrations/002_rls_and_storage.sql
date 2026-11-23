-- =============================================================================
-- Smoker's Lawn Care Service LLC — Row Level Security & Storage (Migration 002)
-- =============================================================================

-- Server-side authorization helpers (SECURITY DEFINER avoids recursive RLS reads)
CREATE OR REPLACE FUNCTION public.is_active_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = auth.uid()
      AND p.is_admin = TRUE
      AND p.account_status = 'active'
  );
$$;

CREATE OR REPLACE FUNCTION public.has_admin_permission(req_perm TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles p
    JOIN public.admin_roles r ON r.id = p.role_id
    LEFT JOIN public.role_permissions rp
      ON rp.role_id = r.id AND rp.permission_key = req_perm
    WHERE p.id = auth.uid()
      AND p.is_admin = TRUE
      AND p.account_status = 'active'
      AND (r.name = 'Super Admin' OR rp.allowed = TRUE)
  );
$$;

-- Enable RLS on ALL tables
ALTER TABLE public.admin_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.role_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_activity_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.client_properties ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vendors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vendor_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vendor_service_areas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.services ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.work_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.work_order_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.work_order_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.work_order_attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.work_order_timeline ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bid_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vendor_bids ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dispatch_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gallery_cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.coverage_regions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.business_settings ENABLE ROW LEVEL SECURITY;

-- Profiles & RBAC Policies (NEVER allow users to elevate their own is_admin or role_id)
CREATE POLICY "Admins can view profiles" ON public.profiles
  FOR SELECT USING (public.is_active_admin() OR auth.uid() = id);

CREATE POLICY "Super Admins manage profiles" ON public.profiles
  FOR ALL USING (public.has_admin_permission('admin_users.manage'))
  WITH CHECK (public.has_admin_permission('admin_users.manage'));

CREATE POLICY "Admins read roles" ON public.admin_roles
  FOR SELECT USING (public.is_active_admin());

CREATE POLICY "Super Admins manage roles" ON public.admin_roles
  FOR ALL USING (public.has_admin_permission('admin_users.manage'));

CREATE POLICY "Admins read role permissions" ON public.role_permissions
  FOR SELECT USING (public.is_active_admin());

CREATE POLICY "Super Admins manage role permissions" ON public.role_permissions
  FOR ALL USING (public.has_admin_permission('admin_users.manage'));

-- Audit Logs: Read for authorized admins; Insert only for active admins; NEVER Update/Delete
CREATE POLICY "Authorized admins read audit logs" ON public.admin_activity_logs
  FOR SELECT USING (public.has_admin_permission('audit.view'));

CREATE POLICY "Active admins append audit logs" ON public.admin_activity_logs
  FOR INSERT WITH CHECK (public.is_active_admin());

-- Public Website Read Policies (Strict published-only, zero PII)
CREATE POLICY "Public reads visible services" ON public.services
  FOR SELECT USING (is_visible = TRUE AND is_archived = FALSE);

CREATE POLICY "Public reads published gallery" ON public.gallery_cases
  FOR SELECT USING (is_published = TRUE);

CREATE POLICY "Public reads published coverage" ON public.coverage_regions
  FOR SELECT USING (is_published = TRUE);

CREATE POLICY "Public reads published reviews" ON public.reviews
  FOR SELECT USING (publication_status = 'Published');

CREATE POLICY "Public reads business profile" ON public.business_settings
  FOR SELECT USING (id = 1);

-- Public Submission Policies (Strictly forced safe initial statuses)
CREATE POLICY "Public submits bid requests" ON public.bid_requests
  FOR INSERT WITH CHECK (
    status = 'New'
    AND converted_work_order_id IS NULL
    AND is_archived = FALSE
  );

CREATE POLICY "Public submits dispatch requests" ON public.dispatch_requests
  FOR INSERT WITH CHECK (
    status = 'New'
    AND assigned_vendor_id IS NULL
  );

CREATE POLICY "Public submits vendor applications" ON public.vendors
  FOR INSERT WITH CHECK (
    application_status = 'Pending'
    AND account_status = 'pending'
    AND is_demo = FALSE
  );

CREATE POLICY "Public submits contact messages" ON public.messages
  FOR INSERT WITH CHECK (
    status = 'Unread'
    AND linked_client_id IS NULL
    AND linked_work_order_id IS NULL
  );

-- Admin Full Access Policies (Scoped by permission checks)
CREATE POLICY "Admins manage services" ON public.services
  FOR ALL USING (public.has_admin_permission('services.manage'))
  WITH CHECK (public.has_admin_permission('services.manage'));

CREATE POLICY "Admins manage gallery" ON public.gallery_cases
  FOR ALL USING (public.has_admin_permission('gallery.manage'))
  WITH CHECK (public.has_admin_permission('gallery.manage'));

CREATE POLICY "Admins manage coverage" ON public.coverage_regions
  FOR ALL USING (public.has_admin_permission('coverage.manage'))
  WITH CHECK (public.has_admin_permission('coverage.manage'));

CREATE POLICY "Admins manage reviews" ON public.reviews
  FOR ALL USING (public.has_admin_permission('reviews.manage'))
  WITH CHECK (public.has_admin_permission('reviews.manage'));

CREATE POLICY "Admins manage clients" ON public.clients
  FOR ALL USING (public.has_admin_permission('clients.read'))
  WITH CHECK (public.has_admin_permission('clients.write'));

CREATE POLICY "Admins manage client properties" ON public.client_properties
  FOR ALL USING (public.has_admin_permission('clients.read'))
  WITH CHECK (public.has_admin_permission('clients.write'));

CREATE POLICY "Admins manage vendors" ON public.vendors
  FOR ALL USING (public.has_admin_permission('vendors.read'))
  WITH CHECK (public.has_admin_permission('vendors.write'));

CREATE POLICY "Admins manage vendor docs" ON public.vendor_documents
  FOR ALL USING (public.has_admin_permission('vendors.read'))
  WITH CHECK (public.has_admin_permission('vendors.write'));

CREATE POLICY "Admins manage vendor service areas" ON public.vendor_service_areas
  FOR ALL USING (public.has_admin_permission('vendors.read'))
  WITH CHECK (public.has_admin_permission('vendors.write'));

CREATE POLICY "Admins manage work orders" ON public.work_orders
  FOR ALL USING (public.has_admin_permission('work_orders.read'))
  WITH CHECK (public.has_admin_permission('work_orders.write'));

CREATE POLICY "Admins manage wo assignments" ON public.work_order_assignments
  FOR ALL USING (public.has_admin_permission('work_orders.read'))
  WITH CHECK (public.has_admin_permission('work_orders.write'));

CREATE POLICY "Admins manage wo notes" ON public.work_order_notes
  FOR ALL USING (public.has_admin_permission('work_orders.read'))
  WITH CHECK (public.has_admin_permission('work_orders.write'));

CREATE POLICY "Admins manage wo attachments" ON public.work_order_attachments
  FOR ALL USING (public.has_admin_permission('work_orders.read'))
  WITH CHECK (public.has_admin_permission('work_orders.write'));

CREATE POLICY "Admins manage wo timeline" ON public.work_order_timeline
  FOR ALL USING (public.has_admin_permission('work_orders.read'))
  WITH CHECK (public.has_admin_permission('work_orders.write'));

CREATE POLICY "Admins manage bid requests" ON public.bid_requests
  FOR ALL USING (public.has_admin_permission('bid_requests.read'))
  WITH CHECK (public.has_admin_permission('bid_requests.write'));

CREATE POLICY "Admins manage vendor bids" ON public.vendor_bids
  FOR ALL USING (public.has_admin_permission('vendor_bids.read'))
  WITH CHECK (public.has_admin_permission('vendor_bids.decide'));

CREATE POLICY "Admins manage dispatch requests" ON public.dispatch_requests
  FOR ALL USING (public.has_admin_permission('dispatch.read'))
  WITH CHECK (public.has_admin_permission('dispatch.write'));

CREATE POLICY "Admins manage messages" ON public.messages
  FOR ALL USING (public.has_admin_permission('messages.manage'))
  WITH CHECK (public.has_admin_permission('messages.manage'));

CREATE POLICY "Admins manage notifications" ON public.notifications
  FOR ALL USING (public.is_active_admin())
  WITH CHECK (public.is_active_admin());

CREATE POLICY "Users manage own notification prefs" ON public.notification_preferences
  FOR ALL USING (auth.uid() = profile_id AND public.is_active_admin())
  WITH CHECK (auth.uid() = profile_id AND public.is_active_admin());

CREATE POLICY "Admins manage business settings" ON public.business_settings
  FOR ALL USING (public.has_admin_permission('settings.manage'))
  WITH CHECK (public.has_admin_permission('settings.manage'));

-- =============================================================================
-- Supabase Storage Buckets & Policies
-- =============================================================================
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES
  ('gallery', 'gallery', TRUE, 10485760, ARRAY['image/jpeg', 'image/png', 'image/webp']),
  ('work-order-attachments', 'work-order-attachments', FALSE, 10485760, ARRAY['image/jpeg', 'image/png', 'image/webp', 'application/pdf', 'text/plain']),
  ('vendor-documents', 'vendor-documents', FALSE, 10485760, ARRAY['image/jpeg', 'image/png', 'application/pdf']),
  ('dispatch-attachments', 'dispatch-attachments', FALSE, 10485760, ARRAY['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
ON CONFLICT (id) DO NOTHING;

-- Gallery bucket: public read, admin write
CREATE POLICY "Public read gallery images" ON storage.objects
  FOR SELECT USING (bucket_id = 'gallery');

CREATE POLICY "Admins manage gallery images" ON storage.objects
  FOR ALL USING (bucket_id = 'gallery' AND public.has_admin_permission('gallery.manage'))
  WITH CHECK (bucket_id = 'gallery' AND public.has_admin_permission('gallery.manage'));

-- Private buckets: active authorized admins only (served via signed URLs)
CREATE POLICY "Admins manage work order files" ON storage.objects
  FOR ALL USING (bucket_id = 'work-order-attachments' AND public.has_admin_permission('work_orders.read'))
  WITH CHECK (bucket_id = 'work-order-attachments' AND public.has_admin_permission('work_orders.write'));

CREATE POLICY "Admins manage vendor docs storage" ON storage.objects
  FOR ALL USING (bucket_id = 'vendor-documents' AND public.has_admin_permission('vendors.read'))
  WITH CHECK (bucket_id = 'vendor-documents' AND public.has_admin_permission('vendors.write'));

CREATE POLICY "Admins manage dispatch files" ON storage.objects
  FOR ALL USING (bucket_id = 'dispatch-attachments' AND public.has_admin_permission('dispatch.read'))
  WITH CHECK (bucket_id = 'dispatch-attachments' AND public.has_admin_permission('dispatch.write'));
