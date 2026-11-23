-- =============================================================================
-- Smoker's Lawn Care Service LLC — Idempotent Demo & RBAC Seed (Migration 003)
-- Note: Zero default/hardcoded admin credentials are seeded here.
-- Use the controlled first-admin setup flow on first launch.
-- =============================================================================

-- 1. Built-in Admin Roles
INSERT INTO public.admin_roles (name, description, is_system)
VALUES
  ('Super Admin', 'Full platform authority including RBAC, admin invitations, and settings.', TRUE),
  ('Admin', 'Operational oversight across work orders, vendors, clients, and CMS.', TRUE),
  ('Operations Manager', 'Manages work orders, QC reviews, urgent dispatch, and coverage.', TRUE),
  ('Vendor Manager', 'Approves vendors, monitors compliance docs, and awards bids.', TRUE),
  ('Support Manager', 'Handles bid requests, client messages, reviews, and reporting.', TRUE)
ON CONFLICT (name) DO NOTHING;

-- 2. Default Role Permissions
WITH role_perms(role_name, perm_key) AS (
  VALUES
    -- Super Admin gets all permissions (plus wildcard bypass in has_admin_permission)
    ('Super Admin', 'dashboard.view'),
    ('Super Admin', 'work_orders.read'), ('Super Admin', 'work_orders.write'), ('Super Admin', 'work_orders.delete'), ('Super Admin', 'work_orders.qc'),
    ('Super Admin', 'vendors.read'), ('Super Admin', 'vendors.write'), ('Super Admin', 'vendors.approve'),
    ('Super Admin', 'clients.read'), ('Super Admin', 'clients.write'),
    ('Super Admin', 'bid_requests.read'), ('Super Admin', 'bid_requests.write'), ('Super Admin', 'bid_requests.convert'),
    ('Super Admin', 'vendor_bids.read'), ('Super Admin', 'vendor_bids.decide'),
    ('Super Admin', 'dispatch.read'), ('Super Admin', 'dispatch.write'),
    ('Super Admin', 'services.manage'), ('Super Admin', 'gallery.manage'), ('Super Admin', 'coverage.manage'), ('Super Admin', 'reviews.manage'),
    ('Super Admin', 'messages.manage'), ('Super Admin', 'reports.view'), ('Super Admin', 'reports.export'),
    ('Super Admin', 'settings.manage'), ('Super Admin', 'admin_users.manage'), ('Super Admin', 'audit.view'),

    -- Admin
    ('Admin', 'dashboard.view'),
    ('Admin', 'work_orders.read'), ('Admin', 'work_orders.write'), ('Admin', 'work_orders.delete'), ('Admin', 'work_orders.qc'),
    ('Admin', 'vendors.read'), ('Admin', 'vendors.write'), ('Admin', 'vendors.approve'),
    ('Admin', 'clients.read'), ('Admin', 'clients.write'),
    ('Admin', 'bid_requests.read'), ('Admin', 'bid_requests.write'), ('Admin', 'bid_requests.convert'),
    ('Admin', 'vendor_bids.read'), ('Admin', 'vendor_bids.decide'),
    ('Admin', 'dispatch.read'), ('Admin', 'dispatch.write'),
    ('Admin', 'services.manage'), ('Admin', 'gallery.manage'), ('Admin', 'coverage.manage'), ('Admin', 'reviews.manage'),
    ('Admin', 'messages.manage'), ('Admin', 'reports.view'), ('Admin', 'reports.export'),
    ('Admin', 'settings.manage'), ('Admin', 'audit.view'),

    -- Operations Manager
    ('Operations Manager', 'dashboard.view'),
    ('Operations Manager', 'work_orders.read'), ('Operations Manager', 'work_orders.write'), ('Operations Manager', 'work_orders.qc'),
    ('Operations Manager', 'vendors.read'),
    ('Operations Manager', 'clients.read'),
    ('Operations Manager', 'bid_requests.read'), ('Operations Manager', 'bid_requests.convert'),
    ('Operations Manager', 'vendor_bids.read'), ('Operations Manager', 'vendor_bids.decide'),
    ('Operations Manager', 'dispatch.read'), ('Operations Manager', 'dispatch.write'),
    ('Operations Manager', 'coverage.manage'), ('Operations Manager', 'reports.view'),

    -- Vendor Manager
    ('Vendor Manager', 'dashboard.view'),
    ('Vendor Manager', 'vendors.read'), ('Vendor Manager', 'vendors.write'), ('Vendor Manager', 'vendors.approve'),
    ('Vendor Manager', 'vendor_bids.read'), ('Vendor Manager', 'vendor_bids.decide'),
    ('Vendor Manager', 'work_orders.read'), ('Vendor Manager', 'reports.view'),

    -- Support Manager
    ('Support Manager', 'dashboard.view'),
    ('Support Manager', 'clients.read'), ('Support Manager', 'clients.write'),
    ('Support Manager', 'bid_requests.read'), ('Support Manager', 'bid_requests.write'),
    ('Support Manager', 'dispatch.read'), ('Support Manager', 'dispatch.write'),
    ('Support Manager', 'messages.manage'), ('Support Manager', 'reviews.manage'), ('Support Manager', 'reports.view')
)
INSERT INTO public.role_permissions (role_id, permission_key, allowed)
SELECT r.id, rp.perm_key, TRUE
FROM role_perms rp
JOIN public.admin_roles r ON r.name = rp.role_name
ON CONFLICT (role_id, permission_key) DO NOTHING;

-- 3. Default Business Settings Singleton
INSERT INTO public.business_settings (id)
VALUES (1)
ON CONFLICT (id) DO NOTHING;

-- 4. Seed Core Services (is_demo = TRUE)
INSERT INTO public.services (service_number, slug, title, subtitle, category, pricing_model, base_price, turnaround, items, compliance_note, is_visible, sort_order, is_demo)
VALUES
  (
    '01.',
    'property-preservation-securing',
    'Property Preservation & Securing',
    'Full-lifecycle field preservation aligned with HUD, FHA, VA, and Fannie Mae mortgagee guidelines.',
    'Property Preservation & Securing',
    'HUD Allowable / Turnkey',
    350.00,
    '24–48 hr standard SLA',
    '["Initial & recurring lock changes, re-keying, and lockbox installation","Interior & exterior debris removal, trash-outs, and broom-swept cleanouts","HUD-compliant window & door board-ups and structural securing","Dry & wet winterization with pressure testing and antifreeze tagging","Sump pump checks, roof tarping, and vacant property maintenance"]'::jsonb,
    'Photo-verified completion via GPS & date-stamped mobile reporting',
    TRUE, 1, TRUE
  ),
  (
    '02.',
    'lawn-care-grounds-maintenance',
    'Lawn Care & Grounds Maintenance',
    'Recurring bi-weekly cuts, initial overgrown clearing, and seasonal curb-appeal restoration.',
    'Lawn Care & Grounds Maintenance',
    'Per Lot Tier / Recurring',
    125.00,
    '48 hr initial cut',
    '["Initial overgrown grass cutting (>12\" clearing) and brush hogging","Recurring bi-weekly mowing, string trimming, and hard-edge borders","Shrub pruning, tree limb clearing, and gutter debris removal","Snow removal, salting, and municipal code-violation abatement"]'::jsonb,
    'Municipal grass-height & HOA compliance guaranteed',
    TRUE, 2, TRUE
  ),
  (
    '03.',
    'handyman-reo-turnkey-repairs',
    'Handyman & REO Turnkey Repairs',
    'Licensed trade repair crews handling make-ready turns, punch lists, and landlord maintenance.',
    'Handyman & REO Turnkey Repairs',
    'Time & Materials / Xactimate',
    240.00,
    '72 hr bid-to-repair',
    '["Drywall patching, texture matching, and interior/exterior painting","Plumbing leak repairs, faucet/wax-ring replacements, and shut-offs","Electrical troubleshooting, GFCI upgrades, and fixture installations","Finish carpentry, subfloor repair, cabinet hardware, and door framing"]'::jsonb,
    'Uniform pricing aligned with RepairBase & Xactimate scopes',
    TRUE, 3, TRUE
  ),
  (
    '04.',
    'inspections-emergency-storm-assessment',
    'Inspections & Emergency Storm Assessment',
    'Rapid post-storm damage documentation, occupancy checks, and emergency hazard mitigation.',
    'Inspections & Emergency Storm Assessment',
    'Emergency Dispatch Flat + Scope',
    295.00,
    '4–12 hr emergency dispatch',
    '["Same-day occupancy verification & interior/exterior condition reports (PCR)","Emergency storm tree removal, roof tarping, and water extraction dispatch","FEMA/insurance-ready itemized bid scopes with high-res photo logs","Mold remediation prep, basement pump-outs, and winter freeze-break mitigation"]'::jsonb,
    '24/7 emergency dispatch desk covering 38 U.S. states',
    TRUE, 4, TRUE
  )
ON CONFLICT (slug) DO NOTHING;

-- 5. Seed Before/After Gallery Cases (is_demo = TRUE)
INSERT INTO public.gallery_cases (slug, title, location, work_order_code, scope_summary, turnaround_hours, before_image_url, after_image_url, before_alt, after_alt, is_published, sort_order, is_demo)
VALUES
  (
    'yard-restoration',
    'Vacant Asset Curb-Appeal & Debris Abatement',
    'Marion County, IN',
    'WO-88412-IN',
    'Cleared 14 cubic yards of storm brush, cut 22" overgrown turf, edged driveway, and secured front porch.',
    36,
    '/src/assets/images/before_overgrown_yard_1794909182781.jpg',
    '/src/assets/images/after_manicured_yard_1794909182832.jpg',
    'Overgrown vacant residential yard with tall grass and fallen branches prior to property preservation',
    'Restored residential front lawn with freshly striped green turf, edged concrete driveway, and cleared walkway',
    TRUE, 1, TRUE
  ),
  (
    'reo-interior',
    'REO Living Room Drywall, Trim & Floor Turn',
    'Franklin County, OH',
    'WO-88509-OH',
    'Patched damaged plaster walls, primed and painted two coats, installed crisp baseboards, and refinished oak flooring.',
    64,
    '/src/assets/images/before_reo_interior_1794909186324.jpg',
    '/src/assets/images/after_reo_interior_1794909185210.jpg',
    'Distressed vacant residential living room with scuffed drywall patches and worn hardwood floors',
    'Renovated clean living room interior with freshly painted smooth walls, trim, and polished hardwood floors',
    TRUE, 2, TRUE
  )
ON CONFLICT (slug) DO NOTHING;

-- 6. Seed Coverage Regions (is_demo = TRUE)
INSERT INTO public.coverage_regions (region_name, hub_city, states, counties, active_counties, avg_dispatch_hours, hud_standard, lat, lng, is_headquarters, coverage_status, is_published, is_demo)
VALUES
  ('Midwest Operations Hub', 'Indianapolis, IN', ARRAY['IN','OH','IL','MI','KY','MO','WI','MN'], ARRAY['Marion','Franklin','Jefferson','Cook'], 312, 18, 'HUD ML 2022-07 & Winterization Protocols', 39.7684, -86.1581, TRUE, 'Active', TRUE, TRUE),
  ('Southeast & Gulf Corridor', 'Charlotte, NC', ARRAY['NC','SC','GA','TN','FL','AL','VA','TX'], ARRAY['Mecklenburg','Davidson','Fulton'], 428, 22, 'FEMA/HUD Storm Mitigation & Lawn Abatement', 35.2271, -80.8431, FALSE, 'Active', TRUE, TRUE),
  ('Northeast & Mid-Atlantic', 'Pittsburgh, PA', ARRAY['PA','NJ','NY','MD','DE','CT','MA'], ARRAY['Allegheny','Philadelphia'], 194, 24, 'Municipal Code & Freeze-Protection Standards', 40.4406, -79.9959, FALSE, 'Active', TRUE, TRUE),
  ('West & Mountain States', 'Phoenix, AZ', ARRAY['AZ','CO','NV','UT','TX','WA','OR'], ARRAY['Maricopa','Denver','Clark'], 165, 26, 'Xeriscape Maintenance & REO Securing', 33.4484, -112.0740, FALSE, 'Active', TRUE, TRUE)
ON CONFLICT (region_name) DO NOTHING;

-- 7. Seed Sample Work Orders (is_demo = TRUE)
INSERT INTO public.work_orders (work_order_code, client_name, client_type, property_address, city, state, zip_code, county, lat, lng, service_category, service_description, priority, estimated_budget, approved_budget, status, sla_deadline, is_demo)
VALUES
  ('SLC-26-4091', 'Heartland Mortgage Servicing', 'Mortgage Servicer', '4120 N Meridian St', 'Indianapolis', 'IN', '46208', 'Marion', 39.7684, -86.1581, 'Property Preservation & Securing', 'Initial Secure + Lock Change + Winterization', 'High', 485, 485, 'QC Verified', NOW() + INTERVAL '24 hours', TRUE),
  ('SLC-26-4104', 'Buckeye REO Asset Group', 'REO Asset Manager', '1842 Oakwood Blvd', 'Columbus', 'OH', '43215', 'Franklin', 39.9612, -82.9988, 'Property Preservation & Securing', '18 Cu. Yd. Debris Trash-Out & Overgrown Cut', 'High', 1120, 1120, 'In Progress', NOW() + INTERVAL '14 hours', TRUE),
  ('SLC-26-4118', 'Keystone SFR Portfolio', 'Property Manager', '715 Bardstown Rd', 'Louisville', 'KY', '40204', 'Jefferson', 38.2527, -85.7585, 'Handyman & REO Turnkey Repairs', 'Drywall Patch, Interior Paint & GFCI Swap', 'Normal', 740, NULL, 'Dispatched', NOW() + INTERVAL '32 hours', TRUE),
  ('SLC-26-4129', 'Piedmont REO Partners', 'REO Asset Manager', '2290 South Blvd', 'Charlotte', 'NC', '28203', 'Mecklenburg', 35.2271, -80.8431, 'Inspections & Emergency Storm Assessment', 'Emergency Roof Tarp & Fallen Limb Removal', 'Urgent', 950, NULL, 'Open Bid', NOW() + INTERVAL '6 hours', TRUE),
  ('SLC-26-4135', 'Residential Portfolio Client', 'Homeowner', '904 Woodland St', 'Nashville', 'TN', '37206', 'Davidson', 36.1627, -86.7816, 'Lawn Care & Grounds Maintenance', 'Bi-Weekly Lawn Care & Shrub Trimming', 'Normal', 185, NULL, 'Open Bid', NOW() + INTERVAL '24 hours', TRUE)
ON CONFLICT (work_order_code) DO NOTHING;

-- 8. Seed Reviews (is_demo = TRUE)
INSERT INTO public.reviews (reviewer_name, organization, role, rating, comment, service_tag, review_date_label, is_verified_customer, publication_status, sort_order, is_demo)
SELECT * FROM (VALUES
  ('Rachel Vance', 'Heartland REO Servicing', 'Regional Asset Manager', 5, 'We migrated 140 vacant Indiana and Ohio properties to Smoker’s Lawn Care Service LLC after repeated missed cut windows elsewhere. Before-and-after GPS photo sets arrive within 36 hours and pass HUD audit review on the first pass.', 'Property Preservation & Winterization', '2 weeks ago', FALSE, 'Published', 1, TRUE),
  ('Marcus Delgado', 'Keystone SFR Portfolio', 'Director of Field Operations', 5, 'Their handyman crews turned 9 rental units in Louisville ahead of lease-up. Drywall patches, lock re-keys, and overgrown yard cleanups were completed under one work order without separate vendor markups.', 'REO Handyman & Make-Ready Turns', '1 month ago', FALSE, 'Published', 2, TRUE),
  ('Denise Whitaker', 'Marion County Residence', 'Homeowner', 5, 'After severe wind downed two limbs onto our porch, their dispatch team arrived the same afternoon, cleared the debris cleanly, and kept our lawn edged all summer. Transparent pricing and zero surprises.', 'Emergency Storm Cleanup & Lawn Care', '1 month ago', FALSE, 'Published', 3, TRUE)
) AS v(reviewer_name, organization, role, rating, comment, service_tag, review_date_label, is_verified_customer, publication_status, sort_order, is_demo)
WHERE NOT EXISTS (SELECT 1 FROM public.reviews WHERE is_demo = TRUE);
