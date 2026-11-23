# Deployment & Operations Setup — Smoker's Lawn Care Service LLC

This guide covers environment configuration, Supabase database & storage setup, first-time Super Admin onboarding, security hardening, and Vercel / Node.js production deployment.

---

## 1. Environment Variables

Copy `.env.example` to `.env` (or configure directly in your Vercel / Cloud Run / Node.js environment):

| Variable | Scope | Purpose |
| --- | --- | --- |
| `VITE_SUPABASE_URL` | Client + Server | Your Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | Client (Public) | Supabase anonymous/public key (safe for browser with RLS enabled) |
| `SUPABASE_URL` | Server Only | Supabase project URL for server-side verification & storage |
| `SUPABASE_SERVICE_ROLE_KEY` | **Server Only (SECRET)** | Service-role key used strictly inside server routes (`server/*`). Never expose in `VITE_*` variables. |
| `ADMIN_BOOTSTRAP_SECRET` | **Server Only (SECRET)** | **Required** one-time secret to unlock `/admin/setup` and claim the initial Super Admin account. Setup stays locked until this is set. |
| `ADMIN_BOOTSTRAP_EMAIL` | **Server Only** | Optional owner email allowlist; when set, `/admin/setup` only accepts this exact email for the initial Super Admin claim. |
| `RESEND_API_KEY` | **Server Only (SECRET)** | Optional Resend API key for transactional password reset & urgent dispatch email notifications. |
| `EMAIL_FROM` | Server Only | Verified sender address (e.g. `Smoker's Dispatch <dispatch@yourdomain.com>`). |
| `VITE_GOOGLE_MAPS_API_KEY` | Client / Build | Google Maps JavaScript API key (restricted by HTTP referrer in Google Cloud Console). |

---

## 2. Supabase Database & Storage Setup

Execute the four SQL migration files located in `supabase/migrations/` inside the Supabase SQL Editor **in numerical order**:

1. `supabase/migrations/001_initial_schema.sql` — Creates all 25 tables, foreign keys, indexes, check constraints, and `updated_at` triggers.
2. `supabase/migrations/002_rls_and_storage.sql` — Enables Row Level Security (`RLS`) across all 25 tables with **separate `SELECT`, `INSERT`, `UPDATE`, and `DELETE` policies** per operation (so read permissions never allow deletion), creates `is_active_admin()` / `has_admin_permission(text)` helpers, creates `claim_first_super_admin()` atomic bootstrap RPC (`pg_advisory_xact_lock`), and provisions 4 storage buckets (`gallery`, `work-order-attachments`, `vendor-documents`, `dispatch-attachments`) with 10 MB size limits and strict MIME allowlists.
3. `supabase/migrations/003_seed_demo_data.sql` — Idempotently seeds the 5 RBAC roles (`Super Admin`, `Admin`, `Operations Manager`, `Vendor Manager`, `Support Manager`), default granular permissions, `business_settings`, and demo operational records (`is_demo = TRUE`). **No default admin password or account is seeded.**
4. `supabase/migrations/004_security_rls_and_atomic_bootstrap.sql` — Idempotent security upgrade migration for existing databases that replaces any broad `FOR ALL` policies with separated `SELECT`/`INSERT`/`UPDATE`/`DELETE` policies and installs `public.claim_first_super_admin()`.

### Supabase Auth Settings Checklist
- Enable **Email/Password** provider in Supabase Authentication.
- Configure **Site URL** to your production domain (e.g., `https://your-domain.vercel.app`) and add `/admin/reset-password` to **Redirect URLs**.

---

## 3. First-Time Super Admin Bootstrap (Zero Hardcoded Passwords)

No default admin username or password exists in the codebase or migrations, and public visitors can never claim admin access automatically.

1. Set `ADMIN_BOOTSTRAP_SECRET` (and optionally `ADMIN_BOOTSTRAP_EMAIL` to your personal/work email) in **AI Studio Secrets**, Vercel Environment Variables, or your server `.env` file.
2. Navigate to `/admin/setup` (or `/admin/login`).
3. Because zero active admins exist yet, `/admin/setup` presents the protected **First-Time Super Admin Setup** form.
4. Enter your Full Name, Email, strong password (10+ characters), and the `ADMIN_BOOTSTRAP_SECRET`. (Alternatively, run `npm run bootstrap:admin` from the server CLI.)
5. Registration uses an atomic PostgreSQL transaction advisory lock (`claim_first_super_admin`) plus a server-side lock so concurrent requests cannot race. Once claimed, `/api/admin/auth/setup-first-admin` and `/admin/setup` permanently lock (`403`/`409`) and all future logins use `/admin/login`. Additional staff accounts (`Admin`, `Operations Manager`, `Vendor Manager`, `Support Manager`) are invited and managed by a Super Admin in **Admin Users** (`/admin/users`).

> For detailed Supabase dashboard screenshots/checklist and SQL database verification queries, see [ADMIN_SETUP_GUIDE.md](./ADMIN_SETUP_GUIDE.md).

---

## 4. Storage & Persistence Mode Notes

- **Unified Supabase Persistence (`SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` set)**: All public submissions (`/api/public/*`), admin operations (`/api/admin/*`), CMS content, RBAC profiles, audit logs, and uploaded files use Supabase PostgreSQL and Supabase Storage as the single source of truth.
- **Production Enforcement**: When `NODE_ENV=production` or deployed on Vercel (`VERCEL=1`), local JSON storage (`data/platform-db.json`) and local `uploads/` disk writes are **strictly disabled**. The server refuses to start or fall back to local JSON without valid `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`.
- **Local Development Only**: When running locally in development (`NODE_ENV !== 'production'`) without Supabase env vars, `server.ts` stores development state in `data/platform-db.json` and `uploads/`.

---

## 5. Build, Verification & Vercel Deployment

```bash
# Install dependencies
npm install

# Development server (Express + Vite SSR/SPA middleware on port 3000)
npm run dev

# Production build (Vite client bundle -> dist/ + Vercel Serverless API bundle -> api/index.js)
npm run build
npm start
```

### Vercel Deployment Notes
- `npm run build` compiles the Vite frontend into `dist/` and bundles `server/vercel-entry.ts` into the Vercel Serverless Function `api/index.js` (`/api`).
- `vercel.json` rewrites `/api/(.*)` to `/api?__vercel_api_path=$1` and all frontend routes (`/`, `/admin/*`) to `/index.html`.
- Set these required variables in **Vercel Project Settings → Environment Variables** (for **Production** and **Preview**, then **redeploy** so `VITE_*` variables are baked into the client build):
  - `SUPABASE_URL` & `VITE_SUPABASE_URL`
  - `VITE_SUPABASE_ANON_KEY`
  - `SUPABASE_SERVICE_ROLE_KEY`
  - `ADMIN_BOOTSTRAP_SECRET` & `ADMIN_BOOTSTRAP_EMAIL`
  - `VITE_GOOGLE_MAPS_API_KEY` (optional, for interactive coverage map)
- Restrict your Google Maps API key in Google Cloud Console using HTTP Referrer allowlists matching your Vercel production & preview URLs.

