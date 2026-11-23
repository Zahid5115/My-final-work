# First Super Admin Setup & Supabase Verification Guide

**Smoker's Lawn Care Service LLC — Admin Portal**

This guide explains how to use **`ADMIN_BOOTSTRAP_SECRET`** and **`ADMIN_BOOTSTRAP_EMAIL`** to securely establish your first **Super Admin** account in **Supabase** (Authentication + PostgreSQL), and how to verify in the Supabase Dashboard that every table, role, and audit record was created properly.

---

## 1. How `ADMIN_BOOTSTRAP_SECRET` & `ADMIN_BOOTSTRAP_EMAIL` Work

To prevent random website visitors from claiming administrator privileges when a brand-new database has zero admins:

- **`ADMIN_BOOTSTRAP_SECRET`** *(Required, server-only)*: Acts as a one-time setup gate. Until this variable is set on the server, `/admin/setup` stays locked and `POST /api/admin/auth/setup-first-admin` rejects all requests (`403 Forbidden`). The server compares the submitted secret using a constant-time check (`crypto.timingSafeEqual`).
- **`ADMIN_BOOTSTRAP_EMAIL`** *(Optional but strongly recommended, server-only)*: Locks the initial setup to one exact email address (case-insensitive). Even if someone knew your setup secret, any other email address is rejected (`403 Forbidden`).
- **One-Time Permanent Lock**: The backend never promotes general visitors or first sign-ups automatically. Once one active admin (`is_admin = true`) exists in `public.profiles`, the initial setup endpoint permanently locks (`409 Conflict`) and `/admin/setup` switches to a locked screen.

---

## 2. Step 1 — Prepare Supabase (Dashboard)

Before configuring your app secrets, prepare your Supabase project:

1. **Run the SQL Migrations in Order**
   Open **Supabase Dashboard → SQL Editor → New query** and execute each file from `supabase/migrations/` in numerical order:
   1. `supabase/migrations/001_initial_schema.sql` — Creates all 25 tables, including `admin_roles`, `role_permissions`, `profiles`, and `admin_activity_logs`.
   2. `supabase/migrations/002_rls_and_storage.sql` — Enables Row Level Security (`RLS`) with separate `SELECT`/`INSERT`/`UPDATE`/`DELETE` policies, creates `is_active_admin()` / `has_admin_permission()` / `claim_first_super_admin()` helpers, and provisions storage buckets.
   3. `supabase/migrations/003_seed_demo_data.sql` — Seeds the 5 system roles (`Super Admin`, `Admin`, `Operations Manager`, `Vendor Manager`, `Support Manager`) and default permissions without creating any default admin user or password.
   4. `supabase/migrations/004_security_rls_and_atomic_bootstrap.sql` — Ensures separated RLS policies and installs the atomic `claim_first_super_admin()` RPC on existing projects.

2. **Enable Email/Password Sign-In**
   Go to **Supabase Dashboard → Authentication → Providers** and confirm **Email** is enabled.

3. **Configure Redirect URLs**
   Go to **Supabase Dashboard → Authentication → URL Configuration**:
   - Set **Site URL** to your application URL (for example, your AI Studio Dev URL or production domain).
   - Add `<your-app-url>/admin/reset-password` under **Redirect URLs**.

4. **Copy Your Supabase Project Credentials**
   Go to **Supabase Dashboard → Project Settings → Data API (or API)** and copy:
   - **Project URL** — must be a full `https://` URL, e.g. `https://yourprojectref.supabase.co`
   - **`anon` / `public` key**
   - **`service_role` secret key** *(never share or expose in frontend variables)*

---

## 3. Step 2 — Set Environment Variables / Google AI Studio Secrets

Open **Settings → Secrets** in Google AI Studio (or your server `.env` file) and set these variables:

| Variable | Visibility | Value / Example |
| --- | --- | --- |
| `SUPABASE_URL` | Server-only | `https://yourprojectref.supabase.co` *(must start with `https://`)* |
| `VITE_SUPABASE_URL` | Client & Server | Same full URL: `https://yourprojectref.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | Client (Public) | Your Supabase `anon` public key |
| `SUPABASE_SERVICE_ROLE_KEY` | **Server-only Secret** | Your Supabase `service_role` key |
| `ADMIN_BOOTSTRAP_SECRET` | **Server-only Secret** | A private one-time setup passphrase you invent |
| `ADMIN_BOOTSTRAP_EMAIL` | **Server-only** | Your owner email address (e.g., `owner@yourdomain.com`) |

> **Important**: Always enter the full `https://...` URL in `SUPABASE_URL` and `VITE_SUPABASE_URL` (no surrounding quotes, and not just the project ID). If the URL is malformed, the portal stays in Local Server Mode and displays a **Supabase URL Secret Format Notice** on `/admin/setup` instead of writing to Supabase.

Save your secrets and restart/reload the dev server so the environment picks them up.

---

## 4. Step 3 — Initialize the First Super Admin

### Option A: Protected Web Setup (`/admin/setup`)

1. Navigate to **`/admin/setup`** in your browser.
2. Verify the top-right status badge reads **`Supabase Auth + RLS`** *(do not proceed if it says `Local Server Mode`, because that means your Supabase env vars are not active yet)*.
3. If `ADMIN_BOOTSTRAP_EMAIL` is configured, you will see: *"Owner Email Lock Active: email must match ADMIN_BOOTSTRAP_EMAIL."*
4. Complete the form:
   - **Full Name**: Your full name
   - **Owner Email Address**: Exact email matching `ADMIN_BOOTSTRAP_EMAIL`
   - **Password & Confirm Password**: At least 10 characters
   - **Server Bootstrap Secret**: Exact passphrase from `ADMIN_BOOTSTRAP_SECRET`
5. Click **Create First Super Admin**.

Behind the scenes, the backend (`POST /api/admin/auth/setup-first-admin`):
- Acquires an in-process setup lock and verifies `ADMIN_BOOTSTRAP_SECRET` and `ADMIN_BOOTSTRAP_EMAIL`.
- Creates a confirmed user in **`auth.users`**.
- Calls the atomic PostgreSQL function **`public.claim_first_super_admin()`** (protected by a transaction-level advisory lock `pg_advisory_xact_lock`) so concurrent requests cannot race. If another request already claimed the first admin, the backend rolls back the Auth user and rejects with `409 Conflict`.
- Inserts a `first_admin_claimed` entry into **`public.admin_activity_logs`**.
- Signs you in and redirects to `/admin/dashboard`.

### Option B: Server Terminal CLI (`npm run bootstrap:admin`)

If you have shell access to the server with your environment variables loaded:

```bash
npm run bootstrap:admin -- --name "Your Full Name" --email "owner@yourdomain.com"
```

Enter a password of 10+ characters when prompted. Once created, a second run automatically aborts.

---

## 5. Step 4 — Verify in the Supabase Dashboard & Database

After creating your first Super Admin, verify that the account, role link, and audit trail exist in Supabase:

### A. Visual Check in Supabase Dashboard

1. **Authentication → Users**
   - Confirm your email address appears in the user list.
   - Check that **Confirmed at** (email verification) has a timestamp.
2. **Table Editor → `profiles`**
   - Find the row matching your email.
   - Confirm:
     - `is_admin` = `true`
     - `account_status` = `'active'`
     - `role_id` = UUID matching `'Super Admin'` in `admin_roles`
3. **Table Editor → `admin_activity_logs`**
   - Confirm there is an immutable log row with `action` = `'first_admin_claimed'` (or `'first_admin_claimed_cli'`) and `actor_role` = `'Super Admin'`.

### B. SQL Verification Queries (Supabase SQL Editor)

Run these read-only queries in **Supabase Dashboard → SQL Editor** to verify all links in one pass:

#### 1. Verify Auth User, Profile, and `Super Admin` Role Link
```sql
SELECT
  u.id AS auth_user_id,
  u.email AS auth_email,
  u.email_confirmed_at,
  p.full_name,
  p.is_admin,
  p.account_status,
  r.name AS assigned_role,
  p.last_login_at,
  p.created_at
FROM auth.users u
JOIN public.profiles p ON p.id = u.id
LEFT JOIN public.admin_roles r ON r.id = p.role_id
WHERE p.is_admin = TRUE;
```
**Expected result**: Exactly **1 row** for your email with `is_admin = true`, `account_status = 'active'`, `assigned_role = 'Super Admin'`, and a non-null `email_confirmed_at`.

#### 2. Verify Active Admin Count & Permanent Lock Readiness
```sql
SELECT COUNT(*) AS active_admin_count
FROM public.profiles
WHERE is_admin = TRUE;
```
**Expected result**: `active_admin_count = 1`. Because this count is `> 0`, `/api/admin/auth/setup-first-admin` now rejects all future bootstrap attempts with `409 Conflict`.

#### 3. Verify Audit Log Entry
```sql
SELECT
  actor_email,
  actor_role,
  action,
  entity_type,
  summary,
  created_at
FROM public.admin_activity_logs
ORDER BY created_at DESC
LIMIT 10;
```
**Expected result**: Contains the `first_admin_claimed` record with your email and `Super Admin` role.

#### 4. Verify One-Time Lock in the Browser
- Open `/admin/setup` again in your browser: it should display **Initial Setup Permanently Locked** with a **Go to Admin Login** button instead of the registration form.

---

## 6. Logging In & Inviting Additional Administrators

1. **Routine Login**: Sign in anytime at **`/admin/login`** using your email and password.
2. **Inviting Team Admins**: Inside the Admin Portal, open **Admin Users** (`/admin/users`) and click **Invite / Add Administrator** to provision staff under any of the 5 server-enforced roles:
   - `Super Admin`
   - `Admin`
   - `Operations Manager`
   - `Vendor Manager`
   - `Support Manager`
3. **Clean Up (Optional)**: Once verified, you can keep or remove `ADMIN_BOOTSTRAP_SECRET` from Secrets—the setup endpoint remains permanently locked regardless because `public.profiles` now contains an active admin.

---

## 7. Troubleshooting Quick Reference

| Message / Symptom | Cause | Fix |
| --- | --- | --- |
| Badge says `Local Server Mode` & shows `Supabase URL Secret Format Notice` | `SUPABASE_URL` or `VITE_SUPABASE_URL` is empty or missing `https://` | Paste your full `https://<project-ref>.supabase.co` URL into Secrets and restart |
| `First-admin setup is locked until ADMIN_BOOTSTRAP_SECRET is configured` | `ADMIN_BOOTSTRAP_SECRET` is missing in server Secrets | Add `ADMIN_BOOTSTRAP_SECRET` in Secrets and click **Re-check Setup Status** |
| `Invalid server setup secret` (`403`) | Entered passphrase doesn't match `ADMIN_BOOTSTRAP_SECRET` | Re-enter exact secret value (check for extra spaces) |
| `This email address is not authorized by ADMIN_BOOTSTRAP_EMAIL` (`403`) | Submitted email differs from `ADMIN_BOOTSTRAP_EMAIL` | Use the exact email configured in `ADMIN_BOOTSTRAP_EMAIL` |
| `Unable to verify Supabase admin table` (`500`) | Migrations `001`–`003` have not been run in Supabase SQL Editor | Run `001_initial_schema.sql`, `002_rls_and_storage.sql`, and `003_seed_demo_data.sql` |
