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
| `GOOGLE_MAPS_API_KEY` | Client / Build | Google Maps JavaScript API key (restricted by HTTP referrer in Google Cloud Console). |

---

## 2. Supabase Database & Storage Setup

Execute the three SQL migration files located in `supabase/migrations/` inside the Supabase SQL Editor **in numerical order**:

1. `supabase/migrations/001_initial_schema.sql` — Creates all 25 tables, foreign keys, indexes, check constraints, and `updated_at` triggers.
2. `supabase/migrations/002_rls_and_storage.sql` — Enables Row Level Security (`RLS`) across all 25 tables, creates `is_active_admin()` / `has_admin_permission(text)` `SECURITY DEFINER` helpers, creates immutable audit log rules, and provisions 4 storage buckets (`gallery`, `work-order-attachments`, `vendor-documents`, `dispatch-attachments`) with 10 MB size limits and strict MIME allowlists.
3. `supabase/migrations/003_seed_demo_data.sql` — Idempotently seeds the 5 RBAC roles (`Super Admin`, `Admin`, `Operations Manager`, `Vendor Manager`, `Support Manager`), default granular permissions, `business_settings`, and demo operational records (`is_demo = TRUE`). **No default admin password or account is seeded.**

### Supabase Auth Settings Checklist
- Enable **Email/Password** provider in Supabase Authentication.
- Configure **Site URL** to your production domain (e.g., `https://your-domain.vercel.app`) and add `/admin/reset-password` to **Redirect URLs**.

---

## 3. First-Time Super Admin Bootstrap (Zero Hardcoded Passwords)

No default admin username or password exists in the codebase or migrations, and public visitors can never claim admin access automatically.

1. Set `ADMIN_BOOTSTRAP_SECRET` (and optionally `ADMIN_BOOTSTRAP_EMAIL` to your personal/work email) in **AI Studio Secrets** or your server `.env` file.
2. Navigate to `/admin/setup` (or `/admin/login`).
3. Because zero active admins exist yet, `/admin/setup` presents the protected **First-Time Super Admin Setup** form.
4. Enter your Full Name, Email, strong password (10+ characters), and the `ADMIN_BOOTSTRAP_SECRET`. (Alternatively, run `npm run bootstrap:admin` from the server CLI.)
5. Once claimed, `/api/admin/auth/setup-first-admin` and `/admin/setup` permanently lock (`403`/`409`) and all future logins use `/admin/login`. Additional staff accounts (`Admin`, `Operations Manager`, `Vendor Manager`, `Support Manager`) are invited and managed by a Super Admin in **Admin Users** (`/admin/users`).

---

## 4. Storage Mode Notes

- **With `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` set**: Uploaded gallery images and private work-order/vendor files are stored in Supabase Storage buckets, and Supabase Auth handles JWT authentication against `profiles` & `admin_roles`.
- **Preview / Self-Hosted Node Mode**: When Supabase env vars are absent, `server.ts` persists structured platform state atomically to `data/platform-db.json` and stores uploaded attachments in `uploads/` (with private buckets gated behind authenticated `/api/admin/files/:bucket/:filename` and path traversal confinement).
- Note: On serverless platforms with ephemeral filesystems (like Vercel), always configure Supabase environment variables for durable multi-instance persistence.

---

## 5. Build, Verification & Vercel Deployment

```bash
# Install dependencies
npm install

# Development server (Express + Vite SSR/SPA middleware on port 3000)
npm run dev

# Production build & server start
npm run build
npm start
```

### Vercel Deployment Notes
- `vercel.json` is preconfigured to rewrite `/admin/*` deep links and `/` to `/index.html` while preserving `/api/*` routing.
- Set all required `VITE_*` and server secrets in **Vercel Project Settings → Environment Variables**.
- Restrict your Google Maps API key in Google Cloud Console using HTTP Referrer allowlists matching your Vercel production & preview URLs.
