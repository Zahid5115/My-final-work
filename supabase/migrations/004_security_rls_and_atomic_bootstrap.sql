-- =============================================================================
-- Smoker's Lawn Care Service LLC — Security Hardening & Atomic Bootstrap (Migration 004)
-- Idempotent upgrade for existing Supabase projects that already ran 001–003:
--   1. Drops all legacy FOR ALL policies that allowed .read roles to DELETE.
--   2. Creates separate SELECT / INSERT / UPDATE / DELETE policies per operation.
--   3. Creates atomic pg_advisory_xact_lock function claim_first_super_admin().
-- =============================================================================

-- 1. Atomic First Super Admin Claim Function (service_role only)
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

-- 2. Drop Legacy Broad / FOR ALL Policies Safely
DROP POLICY IF EXISTS "Admins can view profiles" ON public.profiles;
DROP POLICY IF EXISTS "Super Admins manage profiles" ON public.profiles;
DROP POLICY IF EXISTS "Admins read roles" ON public.admin_roles;
DROP POLICY IF EXISTS "Super Admins manage roles" ON public.admin_roles;
DROP POLICY IF EXISTS "Admins read role permissions" ON public.role_permissions;
DROP POLICY IF EXISTS "Super Admins manage role permissions" ON public.role_permissions;
DROP POLICY IF EXISTS "Authorized admins read audit logs" ON public.admin_activity_logs;
DROP POLICY IF EXISTS "Active admins append audit logs" ON public.admin_activity_logs;
DROP POLICY IF EXISTS "Public reads visible services" ON public.services;
DROP POLICY IF EXISTS "Public reads published gallery" ON public.gallery_cases;
DROP POLICY IF EXISTS "Public reads published coverage" ON public.coverage_regions;
DROP POLICY IF EXISTS "Public reads published reviews" ON public.reviews;
DROP POLICY IF EXISTS "Public reads business profile" ON public.business_settings;
DROP POLICY IF EXISTS "Public submits bid requests" ON public.bid_requests;
DROP POLICY IF EXISTS "Public submits dispatch requests" ON public.dispatch_requests;
DROP POLICY IF EXISTS "Public submits vendor applications" ON public.vendors;
DROP POLICY IF EXISTS "Public submits contact messages" ON public.messages;
DROP POLICY IF EXISTS "Admins manage services" ON public.services;
DROP POLICY IF EXISTS "Admins manage gallery" ON public.gallery_cases;
DROP POLICY IF EXISTS "Admins manage coverage" ON public.coverage_regions;
DROP POLICY IF EXISTS "Admins manage reviews" ON public.reviews;
DROP POLICY IF EXISTS "Admins manage clients" ON public.clients;
DROP POLICY IF EXISTS "Admins manage client properties" ON public.client_properties;
DROP POLICY IF EXISTS "Admins manage vendors" ON public.vendors;
DROP POLICY IF EXISTS "Admins manage vendor docs" ON public.vendor_documents;
DROP POLICY IF EXISTS "Admins manage vendor service areas" ON public.vendor_service_areas;
DROP POLICY IF EXISTS "Admins manage work orders" ON public.work_orders;
DROP POLICY IF EXISTS "Admins manage wo assignments" ON public.work_order_assignments;
DROP POLICY IF EXISTS "Admins manage wo notes" ON public.work_order_notes;
DROP POLICY IF EXISTS "Admins manage wo attachments" ON public.work_order_attachments;
DROP POLICY IF EXISTS "Admins manage wo timeline" ON public.work_order_timeline;
DROP POLICY IF EXISTS "Admins manage bid requests" ON public.bid_requests;
DROP POLICY IF EXISTS "Admins manage vendor bids" ON public.vendor_bids;
DROP POLICY IF EXISTS "Admins manage dispatch requests" ON public.dispatch_requests;
DROP POLICY IF EXISTS "Admins manage messages" ON public.messages;
DROP POLICY IF EXISTS "Admins manage notifications" ON public.notifications;
DROP POLICY IF EXISTS "Users manage own notification prefs" ON public.notification_preferences;
DROP POLICY IF EXISTS "Admins manage business settings" ON public.business_settings;

DROP POLICY IF EXISTS "Public read gallery images" ON storage.objects;
DROP POLICY IF EXISTS "Admins manage gallery images" ON storage.objects;
DROP POLICY IF EXISTS "Admins manage work order files" ON storage.objects;
DROP POLICY IF EXISTS "Admins manage vendor docs storage" ON storage.objects;
DROP POLICY IF EXISTS "Admins manage dispatch files" ON storage.objects;

-- Drop new policy names as well so this migration is 100% re-runnable
DROP POLICY IF EXISTS "profiles_select_admin_or_self" ON public.profiles;
DROP POLICY IF EXISTS "profiles_insert_manage" ON public.profiles;
DROP POLICY IF EXISTS "profiles_update_manage" ON public.profiles;
DROP POLICY IF EXISTS "profiles_delete_manage" ON public.profiles;
DROP POLICY IF EXISTS "admin_roles_select" ON public.admin_roles;
DROP POLICY IF EXISTS "admin_roles_insert" ON public.admin_roles;
DROP POLICY IF EXISTS "admin_roles_update" ON public.admin_roles;
DROP POLICY IF EXISTS "admin_roles_delete" ON public.admin_roles;
DROP POLICY IF EXISTS "role_permissions_select" ON public.role_permissions;
DROP POLICY IF EXISTS "role_permissions_insert" ON public.role_permissions;
DROP POLICY IF EXISTS "role_permissions_update" ON public.role_permissions;
DROP POLICY IF EXISTS "role_permissions_delete" ON public.role_permissions;
DROP POLICY IF EXISTS "activity_logs_select" ON public.admin_activity_logs;
DROP POLICY IF EXISTS "activity_logs_insert" ON public.admin_activity_logs;

DROP POLICY IF EXISTS "services_select_public" ON public.services;
DROP POLICY IF EXISTS "services_select_admin" ON public.services;
DROP POLICY IF EXISTS "services_insert_admin" ON public.services;
DROP POLICY IF EXISTS "services_update_admin" ON public.services;
DROP POLICY IF EXISTS "services_delete_admin" ON public.services;
DROP POLICY IF EXISTS "gallery_select_public" ON public.gallery_cases;
DROP POLICY IF EXISTS "gallery_select_admin" ON public.gallery_cases;
DROP POLICY IF EXISTS "gallery_insert_admin" ON public.gallery_cases;
DROP POLICY IF EXISTS "gallery_update_admin" ON public.gallery_cases;
DROP POLICY IF EXISTS "gallery_delete_admin" ON public.gallery_cases;
DROP POLICY IF EXISTS "coverage_select_public" ON public.coverage_regions;
DROP POLICY IF EXISTS "coverage_select_admin" ON public.coverage_regions;
DROP POLICY IF EXISTS "coverage_insert_admin" ON public.coverage_regions;
DROP POLICY IF EXISTS "coverage_update_admin" ON public.coverage_regions;
DROP POLICY IF EXISTS "coverage_delete_admin" ON public.coverage_regions;
DROP POLICY IF EXISTS "reviews_select_public" ON public.reviews;
DROP POLICY IF EXISTS "reviews_select_admin" ON public.reviews;
DROP POLICY IF EXISTS "reviews_insert_admin" ON public.reviews;
DROP POLICY IF EXISTS "reviews_update_admin" ON public.reviews;
DROP POLICY IF EXISTS "reviews_delete_admin" ON public.reviews;
DROP POLICY IF EXISTS "business_settings_select_public" ON public.business_settings;
DROP POLICY IF EXISTS "business_settings_insert_admin" ON public.business_settings;
DROP POLICY IF EXISTS "business_settings_update_admin" ON public.business_settings;
DROP POLICY IF EXISTS "business_settings_delete_admin" ON public.business_settings;

DROP POLICY IF EXISTS "clients_select_admin" ON public.clients;
DROP POLICY IF EXISTS "clients_insert_admin" ON public.clients;
DROP POLICY IF EXISTS "clients_update_admin" ON public.clients;
DROP POLICY IF EXISTS "clients_delete_admin" ON public.clients;
DROP POLICY IF EXISTS "client_properties_select_admin" ON public.client_properties;
DROP POLICY IF EXISTS "client_properties_insert_admin" ON public.client_properties;
DROP POLICY IF EXISTS "client_properties_update_admin" ON public.client_properties;
DROP POLICY IF EXISTS "client_properties_delete_admin" ON public.client_properties;

DROP POLICY IF EXISTS "vendors_insert_public" ON public.vendors;
DROP POLICY IF EXISTS "vendors_select_admin" ON public.vendors;
DROP POLICY IF EXISTS "vendors_insert_admin" ON public.vendors;
DROP POLICY IF EXISTS "vendors_update_admin" ON public.vendors;
DROP POLICY IF EXISTS "vendors_delete_admin" ON public.vendors;
DROP POLICY IF EXISTS "vendor_documents_select_admin" ON public.vendor_documents;
DROP POLICY IF EXISTS "vendor_documents_insert_admin" ON public.vendor_documents;
DROP POLICY IF EXISTS "vendor_documents_update_admin" ON public.vendor_documents;
DROP POLICY IF EXISTS "vendor_documents_delete_admin" ON public.vendor_documents;
DROP POLICY IF EXISTS "vendor_service_areas_select_admin" ON public.vendor_service_areas;
DROP POLICY IF EXISTS "vendor_service_areas_insert_admin" ON public.vendor_service_areas;
DROP POLICY IF EXISTS "vendor_service_areas_update_admin" ON public.vendor_service_areas;
DROP POLICY IF EXISTS "vendor_service_areas_delete_admin" ON public.vendor_service_areas;

DROP POLICY IF EXISTS "work_orders_select_admin" ON public.work_orders;
DROP POLICY IF EXISTS "work_orders_insert_admin" ON public.work_orders;
DROP POLICY IF EXISTS "work_orders_update_admin" ON public.work_orders;
DROP POLICY IF EXISTS "work_orders_delete_admin" ON public.work_orders;
DROP POLICY IF EXISTS "wo_assignments_select_admin" ON public.work_order_assignments;
DROP POLICY IF EXISTS "wo_assignments_insert_admin" ON public.work_order_assignments;
DROP POLICY IF EXISTS "wo_assignments_update_admin" ON public.work_order_assignments;
DROP POLICY IF EXISTS "wo_assignments_delete_admin" ON public.work_order_assignments;
DROP POLICY IF EXISTS "wo_notes_select_admin" ON public.work_order_notes;
DROP POLICY IF EXISTS "wo_notes_insert_admin" ON public.work_order_notes;
DROP POLICY IF EXISTS "wo_notes_update_admin" ON public.work_order_notes;
DROP POLICY IF EXISTS "wo_notes_delete_admin" ON public.work_order_notes;
DROP POLICY IF EXISTS "wo_attachments_select_admin" ON public.work_order_attachments;
DROP POLICY IF EXISTS "wo_attachments_insert_admin" ON public.work_order_attachments;
DROP POLICY IF EXISTS "wo_attachments_update_admin" ON public.work_order_attachments;
DROP POLICY IF EXISTS "wo_attachments_delete_admin" ON public.work_order_attachments;
DROP POLICY IF EXISTS "wo_timeline_select_admin" ON public.work_order_timeline;
DROP POLICY IF EXISTS "wo_timeline_insert_admin" ON public.work_order_timeline;
DROP POLICY IF EXISTS "wo_timeline_update_admin" ON public.work_order_timeline;
DROP POLICY IF EXISTS "wo_timeline_delete_admin" ON public.work_order_timeline;

DROP POLICY IF EXISTS "bid_requests_insert_public" ON public.bid_requests;
DROP POLICY IF EXISTS "bid_requests_select_admin" ON public.bid_requests;
DROP POLICY IF EXISTS "bid_requests_insert_admin" ON public.bid_requests;
DROP POLICY IF EXISTS "bid_requests_update_admin" ON public.bid_requests;
DROP POLICY IF EXISTS "bid_requests_delete_admin" ON public.bid_requests;
DROP POLICY IF EXISTS "vendor_bids_select_admin" ON public.vendor_bids;
DROP POLICY IF EXISTS "vendor_bids_insert_admin" ON public.vendor_bids;
DROP POLICY IF EXISTS "vendor_bids_update_admin" ON public.vendor_bids;
DROP POLICY IF EXISTS "vendor_bids_delete_admin" ON public.vendor_bids;
DROP POLICY IF EXISTS "dispatch_insert_public" ON public.dispatch_requests;
DROP POLICY IF EXISTS "dispatch_select_admin" ON public.dispatch_requests;
DROP POLICY IF EXISTS "dispatch_insert_admin" ON public.dispatch_requests;
DROP POLICY IF EXISTS "dispatch_update_admin" ON public.dispatch_requests;
DROP POLICY IF EXISTS "dispatch_delete_admin" ON public.dispatch_requests;
DROP POLICY IF EXISTS "messages_insert_public" ON public.messages;
DROP POLICY IF EXISTS "messages_select_admin" ON public.messages;
DROP POLICY IF EXISTS "messages_insert_admin" ON public.messages;
DROP POLICY IF EXISTS "messages_update_admin" ON public.messages;
DROP POLICY IF EXISTS "messages_delete_admin" ON public.messages;

DROP POLICY IF EXISTS "notifications_select_admin" ON public.notifications;
DROP POLICY IF EXISTS "notifications_insert_admin" ON public.notifications;
DROP POLICY IF EXISTS "notifications_update_admin" ON public.notifications;
DROP POLICY IF EXISTS "notifications_delete_admin" ON public.notifications;
DROP POLICY IF EXISTS "notif_prefs_select_self" ON public.notification_preferences;
DROP POLICY IF EXISTS "notif_prefs_insert_self" ON public.notification_preferences;
DROP POLICY IF EXISTS "notif_prefs_update_self" ON public.notification_preferences;
DROP POLICY IF EXISTS "notif_prefs_delete_self" ON public.notification_preferences;

DROP POLICY IF EXISTS "storage_gallery_select_public" ON storage.objects;
DROP POLICY IF EXISTS "storage_gallery_insert_admin" ON storage.objects;
DROP POLICY IF EXISTS "storage_gallery_update_admin" ON storage.objects;
DROP POLICY IF EXISTS "storage_gallery_delete_admin" ON storage.objects;
DROP POLICY IF EXISTS "storage_wo_select_admin" ON storage.objects;
DROP POLICY IF EXISTS "storage_wo_insert_admin" ON storage.objects;
DROP POLICY IF EXISTS "storage_wo_update_admin" ON storage.objects;
DROP POLICY IF EXISTS "storage_wo_delete_admin" ON storage.objects;
DROP POLICY IF EXISTS "storage_vendor_select_admin" ON storage.objects;
DROP POLICY IF EXISTS "storage_vendor_insert_admin" ON storage.objects;
DROP POLICY IF EXISTS "storage_vendor_update_admin" ON storage.objects;
DROP POLICY IF EXISTS "storage_vendor_delete_admin" ON storage.objects;
DROP POLICY IF EXISTS "storage_dispatch_select_admin" ON storage.objects;
DROP POLICY IF EXISTS "storage_dispatch_insert_admin" ON storage.objects;
DROP POLICY IF EXISTS "storage_dispatch_update_admin" ON storage.objects;
DROP POLICY IF EXISTS "storage_dispatch_delete_admin" ON storage.objects;

-- 3. Re-create Granular Operation-Specific Policies
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

CREATE POLICY "activity_logs_select" ON public.admin_activity_logs
  FOR SELECT USING (public.has_admin_permission('audit.view'));
CREATE POLICY "activity_logs_insert" ON public.admin_activity_logs
  FOR INSERT WITH CHECK (public.is_active_admin());

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

-- Storage Object Policies (Granular SELECT / INSERT / UPDATE / DELETE)
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

CREATE POLICY "storage_vendor_select_admin" ON storage.objects
  FOR SELECT USING (bucket_id = 'vendor-documents' AND public.has_admin_permission('vendors.read'));
CREATE POLICY "storage_vendor_insert_admin" ON storage.objects
  FOR INSERT WITH CHECK (bucket_id = 'vendor-documents' AND public.has_admin_permission('vendors.write'));
CREATE POLICY "storage_vendor_update_admin" ON public.objects
  FOR UPDATE
  USING (bucket_id = 'vendor-documents' AND public.has_admin_permission('vendors.write'))
  WITH CHECK (bucket_id = 'vendor-documents' AND public.has_admin_permission('vendors.write'));
CREATE POLICY "storage_vendor_delete_admin" ON storage.objects
  FOR DELETE USING (bucket_id = 'vendor-documents' AND public.has_admin_permission('vendors.write'));

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
