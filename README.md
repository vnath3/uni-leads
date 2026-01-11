# uni-leads
Universal Lead capture multi tenant 

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
