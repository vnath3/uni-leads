create unique index if not exists idx_pg_payments_tenant_occupancy_period_unique
  on public.pg_payments (tenant_id, occupancy_id, period_start)
  where deleted_at is null
    and occupancy_id is not null
    and period_start is not null;
