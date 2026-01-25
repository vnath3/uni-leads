# Database Guide (Supabase / Postgres) - Multi-Tenant Core Template

This repo uses a single Supabase Postgres database to host multiple client
businesses (tenants) such as PG, Clinic, Salon, Cab.
All tenant data is isolated using RLS (Row Level Security).

This file is the source of truth for how to query the DB correctly.

---

## 1) Tenancy model (most important)

### Tenant = client
- Table: `public.tenants`
- Each client business has one row.

**Key columns**
- `tenants.id` (uuid) = tenant_id
- `tenants.name` (text)
- `tenants.status` (enum: `active | paused | archived`)
- `tenants.deleted_at` (nullable) = soft delete marker

### Tenant identity (slug + domain)
We resolve tenants using identities:
- Table: `public.tenant_identities`

**Key columns**
- `tenant_identities.tenant_id` (uuid FK -> tenants.id)
- `tenant_identities.identity_type` (enum: `slug | domain`)
- `tenant_identities.value` (text)
- `tenant_identities.is_primary` (boolean)
- `tenant_identities.deleted_at` (nullable, when supported)

**Example routing**
- `/t/jyoti-pg` => identity_type = `slug`, value = `jyoti-pg`
- `jyoti-pg.com` => identity_type = `domain`, value = `jyoti-pg.com`

**Query to resolve tenant_id by slug**
```sql
select tenant_id
from public.tenant_identities
where identity_type = 'slug'
  and lower(value) = lower('jyoti-pg')
limit 1;
```

**RPC helpers**
- `public.resolve_tenant_id(p_identity_type, p_value)` returns `uuid`.
- `public.resolve_tenant_domain(p_domain)` returns `tenant_id` + `slug`.

**Notes**
- Domain identities are unique on normalized value (see `idx_tenant_identities_domain_unique`).
- Domain resolution strips `www.` and ports and matches normalized values.

---

## 2) Authentication + authorization

### Super admin / platform operator
Super admin is identified by presence in:
- Table: `public.platform_users`

**Key columns**
- `platform_users.user_id` (uuid FK -> auth.users.id)
- `platform_users.is_active` (boolean)
- `platform_users.platform_role` (text, default `super_admin`)

**Rule**
User is a platform user if:
- `platform_users.user_id = auth.uid() AND is_active = true`

### Tenant members (client admin users)
Tenant membership is stored in:
- Table: `public.tenant_members`

**Key columns**
- `tenant_members.tenant_id` (uuid)
- `tenant_members.user_id` (uuid FK -> auth.users.id)
- `tenant_members.role` (enum: `owner | admin | member | viewer`)
- `tenant_members.is_active` (boolean)

**Rule**
User can access tenant data if they have:
- a membership row for that tenant with `is_active = true`

> IMPORTANT: DB enforces one user belongs to one tenant right now:
- unique index on `tenant_members.user_id`

---

## 3) Support access (super admin enters a tenant)

Support access is explicit and time-bound:
- Table: `public.support_access_grants`

**Key columns**
- `support_access_grants.tenant_id` (uuid)
- `support_access_grants.platform_user_id` (uuid -> auth.users.id)
- `support_access_grants.access_mode` (enum: `ro | rw`)
- `support_access_grants.status` (enum: `active | revoked | expired`)
- `support_access_grants.expires_at` (timestamptz)

**Active grant rule**
A grant is active if:
- `status = 'active'`
- `expires_at > now()`
- `platform_user_id = auth.uid()`
- `tenant_id = current tenant`

**RO vs RW**
- RO grant => read tenant data
- RW grant => read + write tenant data

---

## 4) Tenant invites (platform onboarding)

Invite links are created by platform users and claimed by authenticated users.

- Table: `public.tenant_invites`

**Key columns**
- `tenant_invites.tenant_id` (uuid)
- `tenant_invites.role` (enum: `owner | admin`)
- `tenant_invites.token` (text, unique)
- `tenant_invites.status` (enum: `active | used | revoked | expired`)
- `tenant_invites.expires_at` (timestamptz)
- `tenant_invites.used_by`, `tenant_invites.used_at`, `tenant_invites.created_by`

**RPC helpers**
- `public.create_tenant_invite(p_tenant_id, p_role, p_expires_in_days)`
  returns `invite_id`, `token`, `expires_at`.
- `public.claim_tenant_invite(p_token)` returns `tenant_id`, `role`.

**Notes**
- Claiming an invite inserts into `tenant_members` and marks the invite as `used`.
- A user can only claim if they are not already assigned to a tenant.

---

## 5) Domain management (platform)

Custom domains are stored as tenant identities.

**RPC helpers**
- `public.add_tenant_domain(p_tenant_id, p_domain)` returns `identity_id`, `domain`.
- `public.remove_tenant_domain(p_tenant_id, p_domain)` returns `boolean`.

**Notes**
- Domain management is restricted to platform users.
- Input domains are normalized (scheme and path stripped) before insert.

---

## 6) Feature flags (tenant-specific modules)

We use feature flags to decide which modules a tenant has enabled.

### Feature catalog
- Table: `public.features`

**Key columns**
- `features.key` (text PK) e.g. `landing`, `leads`, `contacts`, `audit`,
  `pg.beds`, `pg.payments`, `clinic.appointments`
- `features.name` (text)
- `features.category` (text)
- `features.is_active` (boolean)

### Tenant features (enabled/disabled)
- Table: `public.tenant_features`

**Key columns**
- `tenant_features.tenant_id` (uuid)
- `tenant_features.feature_key` (text FK -> features.key)
- `tenant_features.enabled` (boolean)
- `tenant_features.enabled_by` (uuid FK -> auth.users.id)
- `tenant_features.enabled_at` / `tenant_features.disabled_at`

**Rule**
Feature is enabled if:
- row exists for `(tenant_id, feature_key)` with `enabled = true`

**RPC helper**
- `public.is_feature_enabled(tenant_id, feature_key)` returns boolean

---

## 7) Landing page (public) - IMPORTANT RLS NOTE

`public.landing_settings` is RLS-protected. Anonymous users cannot select it
directly.

### Correct way to fetch landing data (public)
Use RPC:
- `public.get_landing_settings(p_identity_type, p_identity_value)` returns `jsonb`

For slug:
- `p_identity_type = 'slug'`
- `p_identity_value = 'jyoti-pg'` or `physio-mantra`

**Returned JSON keys**
- `tenant_id`
- `brand_name`
- `tagline`
- `logo_url`
- `primary_color`
- `contact_phone`
- `contact_email`
- `address`
- `lead_form_schema`

**lead_form_schema format (trimmed example)**
```json
{
  "fields": [
    {"key":"full_name","label":"Full Name","type":"text","required":true},
    {"key":"phone","label":"Phone","type":"tel","required":true}
  ],
  "trust_points": [
    "Fast WhatsApp response",
    "Verified local team",
    "Transparent pricing"
  ],
  "landing": {
    "version": 1,
    "vertical": "pg",
    "brand": {"name":"Jyoti PG","tagline":"Premium stays"},
    "contact": {"phone":"+91...", "whatsapp":"+91...", "address_line":"Kota"},
    "cta": {"primary": {"type":"whatsapp","label":"WhatsApp"}},
    "hero": {"headline":"Premium stays", "subheadline":"Safe and calm"}
  }
}
```

**Notes**
- `lead_form_schema.landing` supports the v1 config used by `lib/landingConfig.ts`.
- Legacy landing keys (headline, proof_points, faq, gallery) are still accepted
  and normalized.
- `trust_points` and `landing.hero.proof_chips` can both drive hero proof chips.

---

## 8) Create tenant (platform)

RPC: `public.create_tenant_full(...)` creates tenant + defaults and landing
settings.

**Common inputs**
- `p_name`, `p_slug`, `p_status`
- `p_vertical` (defaults to `pg`; other presets include `clinic` and `cab`)
- `p_owner_user_id` (optional initial owner)

**Optional landing config arguments**
- `p_tagline`: overrides landing tagline.
- `p_contact_phone`, `p_contact_email`, `p_address`, `p_primary_color`
- `p_landing_content` (jsonb): merged into `lead_form_schema.landing`.
- `p_trust_points` (jsonb array): overrides `lead_form_schema.trust_points`.

**Side effects**
- Seeds `landing_settings`, `tenant_features`, and default `message_templates`.
- Seeds `automation_rules` for vertical-specific jobs (pg dues or clinic reminders).

---

## 9) Lead capture (public submit)

Public lead submission must NOT insert directly into tables (RLS + security).

### Correct way to submit a lead
Use RPC:
- `public.submit_lead(p_identity_type, p_identity_value, p_contact, p_form_payload, p_source, p_campaign)`

**Arguments**
- `p_identity_type`: `slug` or `domain`
- `p_identity_value`: `jyoti-pg`, `physio-mantra`, etc.
- `p_contact`: jsonb containing at minimum `full_name`, `phone`, optional
  `email`, plus any custom fields
- `p_form_payload`: jsonb full raw answers snapshot
- `p_source`: text, typically `landing`
- `p_campaign`: text, e.g. `demo`

**What it does**
- Resolves tenant_id from identity
- Upserts into `public.contacts` (dedupe by phone/email if present)
- Inserts into `public.leads`
- Enforces rate limits using `lead_rate_limits`
- Returns the new `lead_id` (uuid)

---

## 10) Tenant lifecycle (platform)

**RPC helpers**
- `public.archive_tenant(p_tenant_id)` marks a tenant archived and soft-deletes
  identities and landing settings when supported.
- `public.hard_delete_tenant(p_tenant_id)` removes tenant data across modules.

Use these from platform contexts only.

---

## 11) Core data tables used by tenant admins

### Contacts (master person record)
- Table: `public.contacts`
- Key columns: `id`, `tenant_id`, `full_name`, `phone`, `email`, `status`,
  `attributes`, `created_at`, `updated_at`, `deleted_at`

### Leads (events)
- Table: `public.leads`
- Key columns: `id`, `tenant_id`, `contact_id`, `submitted_at`, `source`,
  `campaign`, `form_payload`

### Landing settings (business profile)
- Table: `public.landing_settings`
- Stores `brand_name`, `tagline`, `primary_color`, contact fields, and
  `lead_form_schema`.

### Audit log (append-only)
- Table: `public.audit_log`

**Rule**
- Select allowed for tenant members and support RO
- Insert allowed for tenant members, support RW, and platform users
- Updates/deletes blocked by policy

---

## 12) RLS expectations (how the app should behave)

### Tenant admin access check
After login:
1. Resolve tenant_id for slug.
2. Determine if user can access:
   - Is member? `select * from tenant_members where tenant_id = X and user_id = auth.uid() and is_active = true`
   - Else is support? `select * from support_access_grants where tenant_id = X and platform_user_id = auth.uid() and status = 'active' and expires_at > now()`
3. If neither => show "Access denied"

### Write operations
- Tenant write: roles `owner/admin/member` can write
- Viewer is read-only
- Support write requires RW grant

---

## 13) Quick reference queries (for dev debugging)

### Is current user platform user?
```sql
select *
from public.platform_users
where user_id = auth.uid() and is_active = true;
```

### Get current tenant slug list (platform user)
```sql
select t.id, t.name, ti.value as slug
from public.tenants t
left join public.tenant_identities ti
  on ti.tenant_id = t.id and ti.identity_type = 'slug'
order by t.created_at desc;
```

### List domains for a tenant
```sql
select value
from public.tenant_identities
where tenant_id = '<TENANT_ID>'
  and identity_type = 'domain'
  and deleted_at is null;
```

### Enabled features for tenant
```sql
select tf.feature_key, tf.enabled, f.name, f.category
from public.tenant_features tf
join public.features f on f.key = tf.feature_key
where tf.tenant_id = '<TENANT_ID>'
order by f.category, f.name;
```

### Active support grant for current user
```sql
select *
from public.support_access_grants
where tenant_id = '<TENANT_ID>'
  and platform_user_id = auth.uid()
  and status = 'active'
  and expires_at > now();
```

### Active invites for tenant
```sql
select id, role, status, expires_at, token
from public.tenant_invites
where tenant_id = '<TENANT_ID>'
  and status = 'active'
order by created_at desc;
```

---

## 14) Naming conventions (for future module tables)

When adding modules later, we will prefix tables:
- `pg_*` for PG
- `clinic_*` for clinic
- `salon_*` for salon

Every module table must include:
- `tenant_id uuid not null` + RLS membership/grant checks
- `created_at` / `updated_at`
- indexes on `(tenant_id, created_at)` and other common filters

---

## 15) RPC correctness checks

RPC calls must use exact arg names.

```ts
supabase.schema("public").rpc("resolve_tenant_id", {
  p_identity_type: "slug",
  p_value: "jyoti-pg"
});

supabase.schema("public").rpc("get_landing_settings", {
  p_identity_type: "slug",
  p_identity_value: "jyoti-pg"
});

supabase.schema("public").rpc("submit_lead", {
  p_identity_type: "slug",
  p_identity_value: "jyoti-pg",
  p_contact: {...},
  p_form_payload: {...},
  p_source: "landing",
  p_campaign: "demo"
});

supabase.schema("public").rpc("create_tenant_invite", {
  p_tenant_id: "<TENANT_ID>",
  p_role: "owner",
  p_expires_in_days: 7
});

supabase.schema("public").rpc("claim_tenant_invite", {
  p_token: "<TOKEN>"
});
```

Notes:
- Public landing pages must use `get_landing_settings()` and `submit_lead()`
  because `landing_settings` is RLS protected.
- Use `platform_users`, `tenants`, `tenant_identities`, `tenant_features`,
  `features`, `support_access_grants` for super admin data.

---

## 16) DB smoke-test queries (run in SQL editor)

### Confirm RPC arg names
```sql
select
  p.proname,
  unnest(p.proargnames) as arg_name
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in (
    'resolve_tenant_id',
    'resolve_tenant_domain',
    'get_landing_settings',
    'submit_lead',
    'create_tenant_invite',
    'claim_tenant_invite',
    'add_tenant_domain',
    'remove_tenant_domain',
    'archive_tenant',
    'hard_delete_tenant'
  );
```

### Confirm tenants + slug mapping exists
```sql
select t.name, t.status, ti.value as slug
from public.tenants t
left join public.tenant_identities ti
  on ti.tenant_id = t.id and ti.identity_type = 'slug'
order by t.created_at desc;
```

### Confirm feature flags per tenant
```sql
select t.name, tf.feature_key, tf.enabled
from public.tenant_features tf
join public.tenants t on t.id = tf.tenant_id
order by t.name, tf.feature_key;
```

---

## 17) Checklist template for future prompts (copy-paste)

```txt
Codex Checklist - Supabase DB Integration (Schema-first)

1) Confirm tables/columns:
   - Use information_schema.columns or db.md to list exact columns.
   - Never assume ids like platform_users.id (it is platform_users.user_id).

2) Confirm RLS boundaries:
   - Public pages must use RPCs if base tables are protected.
   - Tenant-admin pages must handle: member OR active support grant.

3) Confirm RPC names + arg names:
   - Always call via: supabase.schema("public").rpc("function_name", { exact_arg_names })
   - Verify args using pg_proc/proargnames query.

4) Tenant resolution:
   - Resolve tenant_id using tenant_identities (identity_type = 'slug' or 'domain')
     or resolve_tenant_id RPC.
   - Custom domains use resolve_tenant_domain(p_domain).
   - Never accept tenant_id from client input for public write paths.

5) Platform user gate:
   - Gate super dashboard with:
     platform_users.user_id = auth.uid() AND is_active = true

6) Tenant membership gate:
   - tenant_members row must exist:
     tenant_id = X AND user_id = auth.uid() AND is_active = true

7) Support grant gate:
   - Active grant exists if:
     tenant_id = X AND platform_user_id = auth.uid()
     AND status = 'active' AND expires_at > now()
   - RO => read only, RW => can write.

8) Feature flags:
   - enabled feature means tenant_features.enabled = true
   - toggles must upsert/update tenant_features (feature_key from features.key).

9) Avoid schema-qualified REST paths:
   - Do NOT use /rpc/public.get_xxx
   - Use supabase.schema("public").rpc("get_xxx", ...)

10) Invite flow:
   - Invite creation requires platform user.
   - Claim requires authenticated user with no existing tenant membership.

11) Make login redirect-safe:
   - Preserve ?redirect= for tenant admin routes and invite claim.
```
