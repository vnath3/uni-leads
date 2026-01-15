# uni-leads
Universal lead capture, multi-tenant.

## Overview
- Next.js 14 + Supabase app with public landing pages and admin consoles.
- Public lead capture lives at `/t/[slug]` with secure RPC-backed submit flow.
- Platform admin lives at `/super`; tenant admin lives at `/t/[slug]/admin`.
- Feature flags drive module access (PG ops, clinic appointments, automations).

## Documentation
- Product and engineering overview: `docs/PROJECT_OVERVIEW.md`.
- Database guide and query rules: `docs/db.md`.

## Development
- `npm run dev`
- `npm run build`
- `npm run start`

## Supabase Edge Function Deploy (CLI)
```pwsh
cd c:\A_Data\Git_projects\uni-leads\uni-leads

npx supabase --version
npx supabase login
npx supabase link --project-ref <your-project-ref>
npx supabase functions deploy run-lead-instant-message

# Optional: tail logs
npx supabase functions logs run-lead-instant-message --tail
```

## Automation sanity checks

```sql
select tenant_id, occupancy_id, period_start, count(*)
from pg_payments
where deleted_at is null
  and period_start = date_trunc('month', now())::date
group by 1, 2, 3
having count(*) > 1;
```

```sql
select tenant_id, idempotency_key, count(*)
from message_outbox
where deleted_at is null
  and idempotency_key like 'pg_due:%'
group by 1, 2
having count(*) > 1;
```

```sql
select id, tenant_id, meta->>'tenant_name' as tenant_name, meta->>'tenant_phone' as tenant_phone
from message_outbox
where deleted_at is null
  and idempotency_key like 'lead_instant:%'
order by created_at desc
limit 20;
```
