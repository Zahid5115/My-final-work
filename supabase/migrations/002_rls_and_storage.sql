-- =============================================================================
-- Smoker's Lawn Care Service LLC — Row Level Security & Storage (Migration 002)
-- Updated with separate SELECT / INSERT / UPDATE / DELETE policies and atomic
-- first-Super-Admin bootstrap lock function.
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

-- Atomic transaction-locked first Super Admin claim function (service_role only)
CREATE OR REPLACE FUNCTION public.claim_first_super_admin(
  p_user_id UUID,
  p_email TEXT,
  p_full_name TEXT
)
RETURNS TABLE(claimed BOOLEAN, role_id UUID)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_super_role_id UUID;
BEGIN
  -- Serialize concurrent first-admin registration attempts across all connections
  PERFORM pg_advisory_xact_lock(hashtext('smokers_first_super_admin_lock'));

  IF EXISTS (SELECT 1 FROM public.profiles WHERE is_admin = TRUE) THEN
    RETURN QUERY SELECT FALSE, NULL::UUID;
    RETURN;
  END IF;

  SELECT id INTO v_super_role_id
  FROM public.admin_roles
  WHERE name = 'Super Admin'
  LIMIT 1;

  IF v_super_role_id IS NULL THEN
    INSERT INTO public.admin_roles (name, description, is_system)
    VALUES ('Super Admin', 'Full platform authority including RBAC, admin invitations, and settings.', TRUE)
    ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
    RETURNING id INTO v_super_role_id;
  END IF;

  INSERT INTO public.profiles (
    id,
    email,
    full_name,
    role_id,
    is_admin,
    account_status,
    last_login_at
  )
  VALUES (
    p_user_id,
    LOWER(TRIM(p_email)),
    TRIM(p_full_name),
    v_super_role_id,
    TRUE,
    'active',
    NOW()
  )
  ON CONFLICT (id) DO UPDATE SET
    email = EXCLUDED.email,
    full_name = EXCLUDED.full_name,
    role_id = EXCLUDED.role_id,
    is_admin = TRUE,
    account_status = 'active',
    last_login_at = NOW();

  INSERT INTO public.admin_activity_logs (
    actor_id,
    actor_email,
    actor_role,
    action,
    entity_type,
    entity_id,
    summary
  )
  VALUES (
    p_user_id,
    LOWER(TRIM(p_email)),
    'Super Admin',
    'first_admin_claimed',
    'admin_user',
    p_user_id::TEXT,
    'Initial Super Admin account established atomically for ' || LOWER(TRIM(p_email)) || '.'
  );

  RETURN QUERY SELECT TRUE, v_super_role_id;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_first_super_admin(UUID, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_first_super_admin(UUID, TEXT, TEXT) TO service_role;

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

-- =============================================================================
-- Profiles & RBAC Policies (Explicit SELECT / INSERT / UPDATE / DELETE)
-- =============================================================================
CREATE POLICY "profiles_select_admin_or_self" ON public.profiles
  FOR SELECT USING (public.is_active_admin() OR auth.uid() = id);

CREATE POLICY "profiles_insert_manage" ON public.profiles
  FOR INSERT WITH CHECK (public.has_admin_permission('admin_users.manage'));

CREATE POLICY "profiles_update_manage" ON public.profiles
  FOR UPDATE
  USING (public.has_admin_permission('admin_users.manage'))
  WITH CHECK (public.has_admin_permission('admin_users.manage'));

CREATE POLICY "profiles_delete_manage" ON public.profiles
  FOR DELETE USING (public.has_admin_permission('admin_users.manage'));

CREATE POLICY "admin_roles_select" ON public.admin_roles
  FOR SELECT USING (public.is_active_admin());

CREATE POLICY "admin_roles_insert" ON public.admin_roles
  FOR INSERT WITH CHECK (public.has_admin_permission('admin_users.manage'));

CREATE POLICY "admin_roles_update" ON public.admin_roles
  FOR UPDATE
  USING (public.has_admin_permission('admin_users.manage'))
  WITH CHECK (public.has_admin_permission('admin_users.manage'));

CREATE POLICY "admin_roles_delete" ON public.admin_roles
  FOR DELETE USING (public.has_admin_permission('admin_users.manage'));

CREATE POLICY "role_permissions_select" ON public.role_permissions
  FOR SELECT USING (public.is_active_admin());

CREATE POLICY "role_permissions_insert" ON public.role_permissions
  FOR INSERT WITH CHECK (public.has_admin_permission('admin_users.manage'));

CREATE POLICY "role_permissions_update" ON public.role_permissions
  FOR UPDATE
  USING (public.has_admin_permission('admin_users.manage'))
  WITH CHECK (public.has_admin_permission('admin_users.manage'));

CREATE POLICY "role_permissions_delete" ON public.role_permissions
  FOR DELETE USING (public.has_admin_permission('admin_users.manage'));

-- =============================================================================
-- Audit Logs: Read for audit.view; Insert for active admins; NEVER Update/Delete
-- =============================================================================
CREATE POLICY "activity_logs_select" ON public.admin_activity_logs
  FOR SELECT USING (public.has_admin_permission('audit.view'));

CREATE POLICY "activity_logs_insert" ON public.admin_activity_logs
  FOR INSERT WITH CHECK (public.is_active_admin());

-- =============================================================================
-- Public Website Content & Settings
-- =============================================================================
CREATE POLICY "services_select_public" ON public.services
  FOR SELECT USING (is_visible = TRUE AND is_archived = FALSE);

CREATE POLICY "services_select_admin" ON public.services
  FOR SELECT USING (public.has_admin_permission('services.manage'));

CREATE POLICY "services_insert_admin" ON public.services
  FOR INSERT WITH CHECK (public.has_admin_permission('services.manage'));

CREATE POLICY "services_update_admin" ON public.services
  FOR UPDATE
  USING (public.has_admin_permission('services.manage'))
  WITH CHECK (public.has_admin_permission('services.manage'));

CREATE POLICY "services_delete_admin" ON public.services
  FOR DELETE USING (public.has_admin_permission('services.manage'));

CREATE POLICY "gallery_select_public" ON public.gallery_cases
  FOR SELECT USING (is_published = TRUE);

CREATE POLICY "gallery_select_admin" ON public.gallery_cases
  FOR SELECT USING (public.has_admin_permission('gallery.manage'));

CREATE POLICY "gallery_insert_admin" ON public.gallery_cases
  FOR INSERT WITH CHECK (public.has_admin_permission('gallery.manage'));

CREATE POLICY "gallery_update_admin" ON public.gallery_cases
  FOR UPDATE
  USING (public.has_admin_permission('gallery.manage'))
  WITH CHECK (public.has_admin_permission('gallery.manage'));

CREATE POLICY "gallery_delete_admin" ON public.gallery_cases
  FOR DELETE USING (public.has_admin_permission('gallery.manage'));

CREATE POLICY "coverage_select_public" ON public.coverage_regions
  FOR SELECT USING (is_published = TRUE);

CREATE POLICY "coverage_select_admin" ON public.coverage_regions
  FOR SELECT USING (public.has_admin_permission('coverage.manage'));

CREATE POLICY "coverage_insert_admin" ON public.coverage_regions
  FOR INSERT WITH CHECK (public.has_admin_permission('coverage.manage'));

CREATE POLICY "coverage_update_admin" ON public.coverage_regions
  FOR UPDATE
  USING (public.has_admin_permission('coverage.manage'))
  WITH CHECK (public.has_admin_permission('coverage.manage'));

CREATE POLICY "coverage_delete_admin" ON public.coverage_regions
  FOR DELETE USING (public.has_admin_permission('coverage.manage'));

CREATE POLICY "reviews_select_public" ON public.reviews
  FOR SELECT USING (publication_status = 'Published');

CREATE POLICY "reviews_select_admin" ON public.reviews
  FOR SELECT USING (public.has_admin_permission('reviews.manage'));

CREATE POLICY "reviews_insert_admin" ON public.reviews
  FOR INSERT WITH CHECK (public.has_admin_permission('reviews.manage'));

CREATE POLICY "reviews_update_admin" ON public.reviews
  FOR UPDATE
  USING (public.has_admin_permission('reviews.manage'))
  WITH CHECK (public.has_admin_permission('reviews.manage'));

CREATE POLICY "reviews_delete_admin" ON public.reviews
  FOR DELETE USING (public.has_admin_permission('reviews.manage'));

CREATE POLICY "business_settings_select_public" ON public.business_settings
  FOR SELECT USING (id = 1);

CREATE POLICY "business_settings_insert_admin" ON public.business_settings
  FOR INSERT WITH CHECK (public.has_admin_permission('settings.manage'));

CREATE POLICY "business_settings_update_admin" ON public.business_settings
  FOR UPDATE
  USING (public.has_admin_permission('settings.manage'))
  WITH CHECK (public.has_admin_permission('settings.manage'));

CREATE POLICY "business_settings_delete_admin" ON public.business_settings
  FOR DELETE USING (public.has_admin_permission('settings.manage'));

-- =============================================================================
-- Clients & Client Properties (Strict read vs write separation)
-- =============================================================================
CREATE POLICY "clients_select_admin" ON public.clients
  FOR SELECT USING (public.has_admin_permission('clients.read'));

CREATE POLICY "clients_insert_admin" ON public.clients
  FOR INSERT WITH CHECK (public.has_admin_permission('clients.write'));

CREATE POLICY "clients_update_admin" ON public.clients
  FOR UPDATE
  USING (public.has_admin_permission('clients.write'))
  WITH CHECK (public.has_admin_permission('clients.write'));

CREATE POLICY "clients_delete_admin" ON public.clients
  FOR DELETE USING (public.has_admin_permission('clients.write'));

CREATE POLICY "client_properties_select_admin" ON public.client_properties
  FOR SELECT USING (public.has_admin_permission('clients.read'));

CREATE POLICY "client_properties_insert_admin" ON public.client_properties
  FOR INSERT WITH CHECK (public.has_admin_permission('clients.write'));

CREATE POLICY "client_properties_update_admin" ON public.client_properties
  FOR UPDATE
  USING (public.has_admin_permission('clients.write'))
  WITH CHECK (public.has_admin_permission('clients.write'));

CREATE POLICY "client_properties_delete_admin" ON public.client_properties
  FOR DELETE USING (public.has_admin_permission('clients.write'));

-- =============================================================================
-- Vendors, Documents & Service Areas
-- =============================================================================
CREATE POLICY "vendors_insert_public" ON public.vendors
  FOR INSERT WITH CHECK (
    application_status = 'Pending'
    AND account_status = 'pending'
    AND is_demo = FALSE
  );

CREATE POLICY "vendors_select_admin" ON public.vendors
  FOR SELECT USING (public.has_admin_permission('vendors.read'));

CREATE POLICY "vendors_insert_admin" ON public.vendors
  FOR INSERT WITH CHECK (public.has_admin_permission('vendors.write'));

CREATE POLICY "vendors_update_admin" ON public.vendors
  FOR UPDATE
  USING (public.has_admin_permission('vendors.write') OR public.has_admin_permission('vendors.approve'))
  WITH CHECK (public.has_admin_permission('vendors.write') OR public.has_admin_permission('vendors.approve'));

CREATE POLICY "vendors_delete_admin" ON public.vendors
  FOR DELETE USING (public.has_admin_permission('vendors.write'));

CREATE POLICY "vendor_documents_select_admin" ON public.vendor_documents
  FOR SELECT USING (public.has_admin_permission('vendors.read'));

CREATE POLICY "vendor_documents_insert_admin" ON public.vendor_documents
  FOR INSERT WITH CHECK (public.has_admin_permission('vendors.write'));

CREATE POLICY "vendor_documents_update_admin" ON public.vendor_documents
  FOR UPDATE
  USING (public.has_admin_permission('vendors.write'))
  WITH CHECK (public.has_admin_permission('vendors.write'));

CREATE POLICY "vendor_documents_delete_admin" ON public.vendor_documents
  FOR DELETE USING (public.has_admin_permission('vendors.write'));

CREATE POLICY "vendor_service_areas_select_admin" ON public.vendor_service_areas
  FOR SELECT USING (public.has_admin_permission('vendors.read'));

CREATE POLICY "vendor_service_areas_insert_admin" ON public.vendor_service_areas
  FOR INSERT WITH CHECK (public.has_admin_permission('vendors.write'));

CREATE POLICY "vendor_service_areas_update_admin" ON public.vendor_service_areas
  FOR UPDATE
  USING (public.has_admin_permission('vendors.write'))
  WITH CHECK (public.has_admin_permission('vendors.write'));

CREATE POLICY "vendor_service_areas_delete_admin" ON public.vendor_service_areas
  FOR DELETE USING (public.has_admin_permission('vendors.write'));

-- =============================================================================
-- Work Orders & Sub-tables (Strict .read vs .write/.qc vs .delete separation)
-- =============================================================================
CREATE POLICY "work_orders_select_admin" ON public.work_orders
  FOR SELECT USING (public.has_admin_permission('work_orders.read'));

CREATE POLICY "work_orders_insert_admin" ON public.work_orders
  FOR INSERT WITH CHECK (public.has_admin_permission('work_orders.write'));

CREATE POLICY "work_orders_update_admin" ON public.work_orders
  FOR UPDATE
  USING (public.has_admin_permission('work_orders.write') OR public.has_admin_permission('work_orders.qc'))
  WITH CHECK (public.has_admin_permission('work_orders.write') OR public.has_admin_permission('work_orders.qc'));

CREATE POLICY "work_orders_delete_admin" ON public.work_orders
  FOR DELETE USING (public.has_admin_permission('work_orders.delete'));

CREATE POLICY "wo_assignments_select_admin" ON public.work_order_assignments
  FOR SELECT USING (public.has_admin_permission('work_orders.read'));

CREATE POLICY "wo_assignments_insert_admin" ON public.work_order_assignments
  FOR INSERT WITH CHECK (public.has_admin_permission('work_orders.write'));

CREATE POLICY "wo_assignments_update_admin" ON public.work_order_assignments
  FOR UPDATE
  USING (public.has_admin_permission('work_orders.write'))
  WITH CHECK (public.has_admin_permission('work_orders.write'));

CREATE POLICY "wo_assignments_delete_admin" ON public.work_order_assignments
  FOR DELETE USING (public.has_admin_permission('work_orders.delete'));

CREATE POLICY "wo_notes_select_admin" ON public.work_order_notes
  FOR SELECT USING (public.has_admin_permission('work_orders.read'));

CREATE POLICY "wo_notes_insert_admin" ON public.work_order_notes
  FOR INSERT WITH CHECK (public.has_admin_permission('work_orders.write') OR public.has_admin_permission('work_orders.qc'));

CREATE POLICY "wo_notes_update_admin" ON public.work_order_notes
  FOR UPDATE
  USING (public.has_admin_permission('work_orders.write') OR public.has_admin_permission('work_orders.qc'))
  WITH CHECK (public.has_admin_permission('work_orders.write') OR public.has_admin_permission('work_orders.qc'));

CREATE POLICY "wo_notes_delete_admin" ON public.work_order_notes
  FOR DELETE USING (public.has_admin_permission('work_orders.delete'));

CREATE POLICY "wo_attachments_select_admin" ON public.work_order_attachments
  FOR SELECT USING (public.has_admin_permission('work_orders.read'));

CREATE POLICY "wo_attachments_insert_admin" ON public.work_order_attachments
  FOR INSERT WITH CHECK (public.has_admin_permission('work_orders.write'));

CREATE POLICY "wo_attachments_update_admin" ON public.work_order_attachments
  FOR UPDATE
  USING (public.has_admin_permission('work_orders.write'))
  WITH CHECK (public.has_admin_permission('work_orders.write'));

CREATE POLICY "wo_attachments_delete_admin" ON public.work_order_attachments
  FOR DELETE USING (public.has_admin_permission('work_orders.delete'));

CREATE POLICY "wo_timeline_select_admin" ON public.work_order_timeline
  FOR SELECT USING (public.has_admin_permission('work_orders.read'));

CREATE POLICY "wo_timeline_insert_admin" ON public.work_order_timeline
  FOR INSERT WITH CHECK (public.has_admin_permission('work_orders.write') OR public.has_admin_permission('work_orders.qc'));

CREATE POLICY "wo_timeline_update_admin" ON public.work_order_timeline
  FOR UPDATE
  USING (public.has_admin_permission('work_orders.write') OR public.has_admin_permission('work_orders.qc'))
  WITH CHECK (public.has_admin_permission('work_orders.write') OR public.has_admin_permission('work_orders.qc'));

CREATE POLICY "wo_timeline_delete_admin" ON public.work_order_timeline
  FOR DELETE USING (public.has_admin_permission('work_orders.delete'));

-- =============================================================================
-- Bid Requests, Vendor Bids, Dispatch & Messages
-- =============================================================================
CREATE POLICY "bid_requests_insert_public" ON public.bid_requests
  FOR INSERT WITH CHECK (
    status = 'New'
    AND converted_work_order_id IS NULL
    AND is_archived = FALSE
  );

CREATE POLICY "bid_requests_select_admin" ON public.bid_requests
  FOR SELECT USING (public.has_admin_permission('bid_requests.read'));

CREATE POLICY "bid_requests_insert_admin" ON public.bid_requests
  FOR INSERT WITH CHECK (public.has_admin_permission('bid_requests.write'));

CREATE POLICY "bid_requests_update_admin" ON public.bid_requests
  FOR UPDATE
  USING (public.has_admin_permission('bid_requests.write') OR public.has_admin_permission('bid_requests.convert'))
  WITH CHECK (public.has_admin_permission('bid_requests.write') OR public.has_admin_permission('bid_requests.convert'));

CREATE POLICY "bid_requests_delete_admin" ON public.bid_requests
  FOR DELETE USING (public.has_admin_permission('bid_requests.write'));

CREATE POLICY "vendor_bids_select_admin" ON public.vendor_bids
  FOR SELECT USING (public.has_admin_permission('vendor_bids.read'));

CREATE POLICY "vendor_bids_insert_admin" ON public.vendor_bids
  FOR INSERT WITH CHECK (public.has_admin_permission('vendor_bids.decide'));

CREATE POLICY "vendor_bids_update_admin" ON public.vendor_bids
  FOR UPDATE
  USING (public.has_admin_permission('vendor_bids.decide'))
  WITH CHECK (public.has_admin_permission('vendor_bids.decide'));

CREATE POLICY "vendor_bids_delete_admin" ON public.vendor_bids
  FOR DELETE USING (public.has_admin_permission('vendor_bids.decide'));

CREATE POLICY "dispatch_insert_public" ON public.dispatch_requests
  FOR INSERT WITH CHECK (
    status = 'New'
    AND assigned_vendor_id IS NULL
  );

CREATE POLICY "dispatch_select_admin" ON public.dispatch_requests
  FOR SELECT USING (public.has_admin_permission('dispatch.read'));

CREATE POLICY "dispatch_insert_admin" ON public.dispatch_requests
  FOR INSERT WITH CHECK (public.has_admin_permission('dispatch.write'));

CREATE POLICY "dispatch_update_admin" ON public.dispatch_requests
  FOR UPDATE
  USING (public.has_admin_permission('dispatch.write'))
  WITH CHECK (public.has_admin_permission('dispatch.write'));

CREATE POLICY "dispatch_delete_admin" ON public.dispatch_requests
  FOR DELETE USING (public.has_admin_permission('dispatch.write'));

CREATE POLICY "messages_insert_public" ON public.messages
  FOR INSERT WITH CHECK (
    status = 'Unread'
    AND linked_client_id IS NULL
    AND linked_work_order_id IS NULL
  );

CREATE POLICY "messages_select_admin" ON public.messages
  FOR SELECT USING (public.has_admin_permission('messages.manage'));

CREATE POLICY "messages_insert_admin" ON public.messages
  FOR INSERT WITH CHECK (public.has_admin_permission('messages.manage'));

CREATE POLICY "messages_update_admin" ON public.messages
  FOR UPDATE
  USING (public.has_admin_permission('messages.manage'))
  WITH CHECK (public.has_admin_permission('messages.manage'));

CREATE POLICY "messages_delete_admin" ON public.messages
  FOR DELETE USING (public.has_admin_permission('messages.manage'));

-- =============================================================================
-- Notifications & User Preferences
-- =============================================================================
CREATE POLICY "notifications_select_admin" ON public.notifications
  FOR SELECT USING (public.is_active_admin());

CREATE POLICY "notifications_insert_admin" ON public.notifications
  FOR INSERT WITH CHECK (public.is_active_admin());

CREATE POLICY "notifications_update_admin" ON public.notifications
  FOR UPDATE
  USING (public.is_active_admin())
  WITH CHECK (public.is_active_admin());

CREATE POLICY "notifications_delete_admin" ON public.notifications
  FOR DELETE USING (public.is_active_admin());

CREATE POLICY "notif_prefs_select_self" ON public.notification_preferences
  FOR SELECT USING (auth.uid() = profile_id AND public.is_active_admin());

CREATE POLICY "notif_prefs_insert_self" ON public.notification_preferences
  FOR INSERT WITH CHECK (auth.uid() = profile_id AND public.is_active_admin());

CREATE POLICY "notif_prefs_update_self" ON public.notification_preferences
  FOR UPDATE
  USING (auth.uid() = profile_id AND public.is_active_admin())
  WITH CHECK (auth.uid() = profile_id AND public.is_active_admin());

CREATE POLICY "notif_prefs_delete_self" ON public.notification_preferences
  FOR DELETE USING (auth.uid() = profile_id AND public.is_active_admin());

-- =============================================================================
-- Supabase Storage Buckets & Separated Operation Policies
-- =============================================================================
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES
  ('gallery', 'gallery', TRUE, 10485760, ARRAY['image/jpeg', 'image/png', 'image/webp']),
  ('work-order-attachments', 'work-order-attachments', FALSE, 10485760, ARRAY['image/jpeg', 'image/png', 'image/webp', 'application/pdf', 'text/plain']),
  ('vendor-documents', 'vendor-documents', FALSE, 10485760, ARRAY['image/jpeg', 'image/png', 'application/pdf']),
  ('dispatch-attachments', 'dispatch-attachments', FALSE, 10485760, ARRAY['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
ON CONFLICT (id) DO NOTHING;

-- Gallery bucket: public SELECT, gallery.manage for INSERT / UPDATE / DELETE
CREATE POLICY "storage_gallery_select_public" ON storage.objects
  FOR SELECT USING (bucket_id = 'gallery');

CREATE POLICY "storage_gallery_insert_admin" ON storage.objects
  FOR INSERT WITH CHECK (bucket_id = 'gallery' AND public.has_admin_permission('gallery.manage'));

CREATE POLICY "storage_gallery_update_admin" ON storage.objects
  FOR UPDATE
  USING (bucket_id = 'gallery' AND public.has_admin_permission('gallery.manage'))
  WITH CHECK (bucket_id = 'gallery' AND public.has_admin_permission('gallery.manage'));

CREATE POLICY "storage_gallery_delete_admin" ON storage.objects
  FOR DELETE USING (bucket_id = 'gallery' AND public.has_admin_permission('gallery.manage'));

-- Private work-order-attachments bucket: .read vs .write vs .delete
CREATE POLICY "storage_wo_select_admin" ON storage.objects
  FOR SELECT USING (bucket_id = 'work-order-attachments' AND public.has_admin_permission('work_orders.read'));

CREATE POLICY "storage_wo_insert_admin" ON storage.objects
  FOR INSERT WITH CHECK (bucket_id = 'work-order-attachments' AND public.has_admin_permission('work_orders.write'));

CREATE POLICY "storage_wo_update_admin" ON storage.objects
  FOR UPDATE
  USING (bucket_id = 'work-order-attachments' AND public.has_admin_permission('work_orders.write'))
  WITH CHECK (bucket_id = 'work-order-attachments' AND public.has_admin_permission('work_orders.write'));

CREATE POLICY "storage_wo_delete_admin" ON storage.objects
  FOR DELETE USING (bucket_id = 'work-order-attachments' AND public.has_admin_permission('work_orders.delete'));

-- Private vendor-documents bucket: .read vs .write
CREATE POLICY "storage_vendor_select_admin" ON storage.objects
  FOR SELECT USING (bucket_id = 'vendor-documents' AND public.has_admin_permission('vendors.read'));

CREATE POLICY "storage_vendor_insert_admin" ON storage.objects
  FOR INSERT WITH CHECK (bucket_id = 'vendor-documents' AND public.has_admin_permission('vendors.write'));

CREATE POLICY "storage_vendor_update_admin" ON storage.objects
  FOR UPDATE
  USING (bucket_id = 'vendor-documents' AND public.has_admin_permission('vendors.write'))
  WITH CHECK (bucket_id = 'vendor-documents' AND public.has_admin_permission('vendors.write'));

CREATE POLICY "storage_vendor_delete_admin" ON storage.objects
  FOR DELETE USING (bucket_id = 'vendor-documents' AND public.has_admin_permission('vendors.write'));

-- Private dispatch-attachments bucket: .read vs .write
CREATE POLICY "storage_dispatch_select_admin" ON storage.objects
  FOR SELECT USING (bucket_id = 'dispatch-attachments' AND public.has_admin_permission('dispatch.read'));

CREATE POLICY "storage_dispatch_insert_admin" ON storage.objects
  FOR INSERT WITH CHECK (bucket_id = 'dispatch-attachments' AND public.has_admin_permission('dispatch.write'));

CREATE POLICY "storage_dispatch_update_admin" ON storage.objects
  FOR UPDATE
  USING (bucket_id = 'dispatch-attachments' AND public.has_admin_permission('dispatch.write'))
  WITH CHECK (bucket_id = 'dispatch-attachments' AND public.has_admin_permission('dispatch.write'));

CREATE POLICY "storage_dispatch_delete_admin" ON storage.objects
  FOR DELETE USING (bucket_id = 'dispatch-attachments' AND public.has_admin_permission('dispatch.write'));
