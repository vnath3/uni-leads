````md
# Database Guide (Supabase / Postgres) — Multi-Tenant Core Template

This repo uses a **single Supabase Postgres database** to host **multiple client businesses (tenants)** such as PG, Clinic, Salon.  
All tenant data is isolated using **RLS (Row Level Security)**.

This file is the single source of truth for how to query the DB correctly.

---

## 1) Tenancy model (most important)

### Tenant = Client
- Table: `public.tenants`
- Each client business (Jyoti PG, Physio Mantra, etc.) has one row.

**Key columns**
- `tenants.id` (uuid) = tenant_id
- `tenants.name` (text)
- `tenants.status` (enum: `active | paused | archived`)
- `tenants.deleted_at` (nullable) = soft delete marker

### How we resolve tenant from URL
We use **tenant identities**:
- Table: `public.tenant_identities`

**Key columns**
- `tenant_identities.tenant_id` (uuid FK -> tenants.id)
- `tenant_identities.identity_type` (enum: `slug | domain`)
- `tenant_identities.value` (text)
- `tenant_identities.is_primary` (boolean)

**Example routing**
- `/t/jyoti-pg` => identity_type=`slug`, value=`jyoti-pg`
- `/t/physio-mantra` => identity_type=`slug`, value=`physio-mantra`

**Query to resolve tenant_id**
```sql
select tenant_id
from public.tenant_identities
where identity_type = 'slug'
  and lower(value) = lower('jyoti-pg')
limit 1;
````

**Alternative RPC**

* `public.resolve_tenant_id(identity_type, value)` returns `uuid`

---

## 2) Authentication + authorization

### Super admin / platform operator

Super admin is identified by presence in:

* Table: `public.platform_users`

**Key columns**

* `platform_users.user_id` (uuid FK -> auth.users.id)
* `platform_users.is_active` (boolean)
* `platform_users.platform_role` (text, default `super_admin`)

**Rule**
User is a platform user if:

* `platform_users.user_id = auth.uid() AND is_active = true`

### Tenant members (client admin users)

Tenant membership is stored in:

* Table: `public.tenant_members`

**Key columns**

* `tenant_members.tenant_id` (uuid)
* `tenant_members.user_id` (uuid FK -> auth.users.id)
* `tenant_members.role` (enum: `owner | admin | member | viewer`)
* `tenant_members.is_active` (boolean)

**Rule**
User can access tenant data if they have:

* a membership row for that tenant with `is_active=true`

> IMPORTANT: DB enforces **one user belongs to one tenant** right now:

* unique index on `tenant_members.user_id`

---

## 3) Support access: super admin enters a tenant (RO/RW)

Support access is **explicit and time-bound**:

* Table: `public.support_access_grants`

**Key columns**

* `support_access_grants.tenant_id` (uuid)
* `support_access_grants.platform_user_id` (uuid -> auth.users.id)
* `support_access_grants.access_mode` (enum: `ro | rw`)
* `support_access_grants.status` (enum: `active | revoked | expired`)
* `support_access_grants.expires_at` (timestamptz)

**Active grant rule**
A grant is active if:

* `status = 'active'`
* `expires_at > now()`
* `platform_user_id = auth.uid()`
* `tenant_id = current tenant`

**RO vs RW**

* RO grant => read tenant data
* RW grant => read + write tenant data

---

## 4) Feature flags (tenant-specific modules)

We use feature flags to decide which modules a tenant has enabled.

### Feature catalog

* Table: `public.features`

**Key columns**

* `features.key` (text PK) e.g. `core.leads`, `pg.beds`, `clinic.appointments`
* `features.name` (text)
* `features.category` (text)
* `features.is_active` (boolean)

### Tenant features (enabled/disabled)

* Table: `public.tenant_features`

**Key columns**

* `tenant_features.tenant_id` (uuid)
* `tenant_features.feature_key` (text FK -> features.key)
* `tenant_features.enabled` (boolean)
* `tenant_features.enabled_by` (uuid FK -> auth.users.id)
* `tenant_features.enabled_at` / `tenant_features.disabled_at`

**Rule**
Feature is enabled if:

* row exists for `(tenant_id, feature_key)` with `enabled = true`

**Common feature keys**

* Core:

  * `core.landing`
  * `core.leads`
  * `core.contacts`
  * `core.audit`
* Example modules:

  * `pg.beds`
  * `pg.payments`
  * `clinic.appointments`
  * `salon.bookings`

**RPC helper**

* `public.is_feature_enabled(tenant_id, feature_key)` returns boolean

---

## 5) Landing page (public) — IMPORTANT RLS NOTE

`public.landing_settings` is RLS-protected. Anonymous users cannot select it directly.

### Correct way to fetch landing data (public)

Use RPC:

* `public.get_landing_settings(identity_type, identity_value)` returns `jsonb`

For slug:

* identity_type = `slug`
* identity_value = `jyoti-pg` or `physio-mantra`

**Returned JSON keys**

* `tenant_id`
* `brand_name`
* `tagline`
* `logo_url`
* `primary_color`
* `contact_phone`
* `contact_email`
* `address`
* `lead_form_schema`

**lead_form_schema format**

```json
{
  "fields": [
    {"key":"full_name","label":"Full Name","type":"text","required":true},
    {"key":"phone","label":"Phone","type":"tel","required":true},
    {"key":"pain_area","label":"Pain Area","type":"select","required":false,"options":["Knee","Back"]}
  ]
}
```

---

## 6) Lead capture (public submit)

Public lead submission must NOT insert directly into tables (RLS + security).

### Correct way to submit a lead

Use RPC:

* `public.submit_lead(identity_type, identity_value, contact, form_payload, source, campaign)`

**Arguments**

* `identity_type`: `slug` or `domain`
* `identity_value`: `jyoti-pg`, `physio-mantra`, etc.
* `contact`: jsonb containing at minimum `full_name`, `phone`, optional `email`, plus any custom fields
* `form_payload`: jsonb full raw answers snapshot
* `source`: text, typically `landing`
* `campaign`: text, e.g. `demo`

**What it does**

* Resolves tenant_id from identity
* Upserts into `public.contacts` (dedupe by phone/email if present)
* Inserts into `public.leads`
* Returns the new `lead_id` (uuid)

---

## 7) Core data tables used by tenant admins

### Contacts (master person record)

* Table: `public.contacts`

**Key columns**

* `id` (uuid)
* `tenant_id` (uuid)
* `full_name`, `phone`, `email`
* `status` (text; default `lead`) e.g. `lead`, `resident`, `patient`, `active_customer`
* `attributes` (jsonb) for extra fields
* `created_at`, `updated_at`, `deleted_at`

**Admin views**

* List contacts filtered by tenant_id
* Update contact status (requires tenant member write OR support RW grant)

### Leads (events)

* Table: `public.leads`

**Key columns**

* `id` (uuid)
* `tenant_id` (uuid)
* `contact_id` (uuid)
* `submitted_at` (timestamptz)
* `source`, `campaign`
* `form_payload` (jsonb)

**Admin views**

* List leads filtered by tenant_id
* Join leads -> contacts for name/phone display

### Audit log (append-only)

* Table: `public.audit_log`

**Rule**

* Select allowed for tenant members and support RO
* Insert allowed for tenant members and support RW and platform users
* Updates/deletes blocked by policy

---

## 8) RLS expectations (how the app should behave)

### Tenant Admin access check

After login:

1. Resolve tenant_id for slug
2. Determine if user can access:

   * Is member? `select * from tenant_members where tenant_id=X and user_id=auth.uid() and is_active=true`
   * Else is support? `select * from support_access_grants where tenant_id=X and platform_user_id=auth.uid() and status='active' and expires_at>now()`
3. If neither => show **Access denied**

### Write operations

* Tenant write: roles `owner/admin/member` can write
* Viewer is read-only
* Support write requires RW grant

---

## 9) Quick reference queries (for dev debugging)

### Is current user platform user?

```sql
select * from public.platform_users
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

---

## 10) Naming conventions (for future module tables)

When adding modules later, we will prefix tables:

* `pg_*` for PG
* `clinic_*` for clinic
* `salon_*` for salon

Every module table must include:

* `tenant_id uuid not null` + RLS membership/grant checks
* created_at/updated_at
* indexes on (tenant_id, created_at) and other common filters

---

```


A couple of quick correctness checks + a reusable checklist (so Codex doesn’t stumble again):

---

## Quick correctness checks

### 1) RPC calls must use **exact arg names**

Your DB functions are defined as:

* `get_landing_settings(p_identity_type, p_identity_value)`
* `submit_lead(p_identity_type, p_identity_value, p_contact, p_form_payload, p_source, p_campaign)`

So the correct calls are:

```ts
supabase.schema("public").rpc("get_landing_settings", {
  p_identity_type: "slug",
  p_identity_value: "jyoti-pg"
})
```

```ts
supabase.schema("public").rpc("submit_lead", {
  p_identity_type: "slug",
  p_identity_value: "jyoti-pg",
  p_contact: {...},
  p_form_payload: {...},
  p_source: "landing",
  p_campaign: "demo"
})
```

If Codex “fallbacks” to non-`p_` names, it should be removed—keep it strict to avoid silent bugs.

### 2) Landing pages should not query `landing_settings` directly

Using only `get_landing_settings()` and `submit_lead()` is correct because `landing_settings` is RLS protected.

### 3) Super dashboard should not rely on `auth.users`

Correct: use `platform_users`, `tenants`, `tenant_identities`, `tenant_features`, `features`, `support_access_grants`.

---

## DB smoke-test queries (run in SQL editor)

### Confirm RPC arg names (so Codex never guesses)

```sql
select
  p.proname,
  unnest(p.proargnames) as arg_name
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('get_landing_settings','submit_lead','resolve_tenant_id');
```

### Confirm tenants + slug mapping exists

```sql
select t.name, t.status, ti.value as slug
from public.tenants t
left join public.tenant_identities ti
  on ti.tenant_id=t.id and ti.identity_type='slug'
order by t.created_at desc;
```

### Confirm feature flags per tenant

```sql
select t.name, tf.feature_key, tf.enabled
from public.tenant_features tf
join public.tenants t on t.id=tf.tenant_id
order by t.name, tf.feature_key;
```

---

## Checklist template for future Codex prompts (copy-paste)

```txt
CODEx CHECKLIST — Supabase DB Integration (Schema-first)

1) Confirm tables/columns:
   - Use information_schema.columns or db.md to list EXACT columns.
   - Never assume ids like platform_users.id (it is platform_users.user_id).

2) Confirm RLS boundaries:
   - Public pages must use RPCs if base tables are protected.
   - Tenant-admin pages must handle: member OR active support grant.

3) Confirm RPC names + arg names:
   - Always call via: supabase.schema("public").rpc("function_name", { exact_arg_names })
   - Verify args using pg_proc/proargnames query.

4) Tenant resolution:
   - Resolve tenant_id using tenant_identities (identity_type='slug', value) OR resolve_tenant_id RPC.
   - Never accept tenant_id from client input for public write paths.

5) Platform user gate:
   - Gate super dashboard with:
     platform_users.user_id = auth.uid() AND is_active=true

6) Tenant membership gate:
   - tenant_members row must exist:
     tenant_id = X AND user_id = auth.uid() AND is_active=true

7) Support grant gate:
   - active grant exists if:
     tenant_id=X AND platform_user_id=auth.uid()
     AND status='active' AND expires_at > now()
   - RO => read only, RW => can write.

8) Feature flags:
   - enabled feature means tenant_features.enabled=true
   - toggles must upsert/update tenant_features (feature_key from features.key).

9) Avoid schema-qualified REST paths:
   - Do NOT use /rpc/public.get_xxx
   - Use supabase.schema("public").rpc("get_xxx", ...)

10) Make login redirect-safe:
   - Preserve ?redirect= for tenant admin routes.
```

---
