# Uni-Leads Project Overview

## Purpose
Uni-Leads is a multi-tenant lead capture and lightweight ops console built on
Next.js and Supabase. It powers public tenant landing pages for lead capture
and a platform plus tenant admin UI for managing contacts, leads, PG operations,
clinic appointments, and automations.

## Architecture
- Next.js 14 app router with client-heavy pages (routes in `app/`).
- Supabase Postgres with RLS; browser uses `@supabase/supabase-js`.
- Supabase Edge Functions (Deno) for scheduled automations and instant lead follow-up.
- Netlify deployment via the Next.js plugin.
- Middleware resolves custom domains via `resolve_tenant_domain` and redirects to canonical routes.

## Key user flows
### Public lead capture (tenant landing)
- Route: `/t/[slug]`.
- Loads landing settings via RPC `public.get_landing_settings(...)`.
- Landing content (headline, CTA labels, proof chips, FAQs, gallery) is read from
  `lead_form_schema.landing` when present.
- Submits lead via `/api/lead-submit` which calls `public.submit_lead(...)`.
- Rate limiting is enforced inside `submit_lead` using `lead_rate_limits`.
- After submit, `/api/lead-submit` optionally triggers edge function
  `run-lead-instant-message` if `SUPABASE_SERVICE_ROLE_KEY` is configured.
- Custom domains are resolved with `resolve_tenant_domain` in `middleware.ts` and
  rewritten to `/t/[slug]`; admin routes redirect to the app host.

### Super admin (platform operator)
- Routes: `/login` and `/super`.
- Access gate: `platform_users` row with `is_active=true`.
- Capabilities: list tenants, search by name or slug, create tenants via
  `/super/create-tenant`, toggle features, request or revoke support access,
  manage domains, generate invite links, edit landing config
  (`/super/tenants/[tenant_id]/landing`), archive or hard delete tenants,
  copy landing or admin links.

### Tenant admin (client operator)
- Routes: `/t/[slug]/admin` and subpages.
- Access gate: tenant membership in `tenant_members` or an active support grant
  in `support_access_grants`.
- Uses `TenantContextProvider` to share tenant id, enabled features, and support mode.
- Business profile settings live at `/t/[slug]/admin/settings`.

### Tenant invite claim
- Route: `/claim?token=...`.
- Claims are processed by `public.claim_tenant_invite(p_token)` and redirect to
  `/t/[slug]/admin`.
- Unauthenticated users are redirected to `/login?redirect=...` before claiming.

## Feature modules and routes
- Core overview, contacts, and leads: `/t/[slug]/admin`.
- Audit log: `/t/[slug]/admin/audit`.
- Automations: `/t/[slug]/admin/automations`.
- Outbox: `/t/[slug]/admin/outbox`.
- Settings (business profile): `/t/[slug]/admin/settings`.
- PG operations:
  - Beds and rooms: `/t/[slug]/admin/pg/beds`
  - Occupancy: `/t/[slug]/admin/pg/occupancy`
  - Payments: `/t/[slug]/admin/pg/payments`
- Clinic appointments: `/t/[slug]/admin/appointments`.

## Automation system
- Tables: `automation_rules`, `message_templates`, `message_outbox`, `job_runs`.
- Edge functions:
  - `run-pg-monthly-dues`: creates monthly dues (`pg_payments`) and outbox
    messages via `create_pg_due_and_outbox`. Idempotent on
    `(tenant_id, occupancy_id, period_start)` and outbox idempotency keys.
  - `run-clinic-appointment-reminders`: queues internal reminders for upcoming
    appointments. Uses `try_job_lock` and `job_runs`; supports `?force=1` and
    `?dry=1`.
  - `run-lead-instant-message`: queues a WhatsApp acknowledgment message after
    a lead submit. Uses template key `lead_instant_ack` and idempotency key
    `lead_instant:{lead_id}`. Optionally posts to a Make webhook if configured.

## Database highlights
See `docs/db.md` for the full schema guide and query conventions. Notable tables:
- Tenancy and access: `tenants`, `tenant_identities`, `tenant_members`,
  `platform_users`, `support_access_grants`, `tenant_invites`.
- Feature flags: `features`, `tenant_features`.
- Leads and contacts: `contacts`, `leads`, `landing_settings`.
- PG module: `pg_rooms`, `pg_beds`, `pg_occupancies`, `pg_payments`.
- Clinic module: `clinic_appointments`.
- Automation: `automation_rules`, `message_templates`, `message_outbox`, `job_runs`.
- Auditing: `audit_log` plus triggers in migrations.
- Rate limiting: `lead_rate_limits`.

## RLS and security model
- RLS is enabled on module tables; policies depend on DB helpers
  `is_tenant_member` and `has_active_support_grant`.
- Public pages must use RPCs (`get_landing_settings`, `submit_lead`) because
  `landing_settings` is RLS protected.
- Support access is time-bound and explicit, with RO and RW modes.

## Environment and runtime
- Node version: 18 to 20 (see `package.json` engines and `.nvmrc`).
- Scripts: `npm run dev`, `npm run build`, `npm run start`.
- Required env vars:
  - Routing: `NEXT_PUBLIC_APP_URL` (canonical app host for domain redirects).
  - Browser and app: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
  - Server route: `SUPABASE_URL`, `SUPABASE_ANON_KEY` (falls back to NEXT_PUBLIC)
    and optional `SUPABASE_SERVICE_ROLE_KEY` for instant messaging.
  - Edge functions: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`.
  - Optional webhook: `MAKE_OUTBOX_WEBHOOK_URL`, `MAKE_OUTBOX_WEBHOOK_SECRET`.

## Directory map
- `app/`: Next.js routes and UI.
- `components/`: shared UI context (`TenantContextProvider`).
- `lib/`: Supabase client and tenant access helpers.
- `supabase/`: SQL migrations and edge functions.
- `docs/`: database guide and this overview.

## Operational checks
SQL checks for duplicate dues and outbox idempotency keys live in `README.md`.

## Known gaps and notes
- Landing media uploads are not supported yet (URL-only placeholders in create flow).
- Automated tests are not present in this repo.
- Core schema for tenants, contacts, leads, audit log, and RLS helper functions is
  assumed to exist in Supabase (see `docs/db.md`).

## Whats New (append entries here)
### 2026-01-16
- Added: tenant invite flow with `/claim` and `tenant_invites`.
- Added: custom domain routing + management (`resolve_tenant_domain`, add/remove).
- Added: tenant archive + hard delete actions in `/super`.
- Added: super admin landing editor (`/super/tenants/[tenant_id]/landing`).
### 2026-01-18
- Added: `/super/create-tenant` multi-step flow to configure landing content at creation time.
- Changed: `create_tenant_full` accepts optional landing content and trust points.
