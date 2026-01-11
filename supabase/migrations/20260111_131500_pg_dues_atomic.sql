create or replace function public.create_pg_due_and_outbox(
  p_tenant_id uuid,
  p_occupancy_id uuid,
  p_contact_id uuid,
  p_period_start date,
  p_period_end date,
  p_due_date date,
  p_amount_due numeric,
  p_amount_paid numeric,
  p_status text,
  p_payment_meta jsonb,
  p_scheduled_at timestamptz,
  p_template_key text,
  p_subject text,
  p_body text,
  p_to_phone text,
  p_to_email text,
  p_outbox_idempotency_key text,
  p_outbox_meta jsonb
)
returns table (
  payment_id uuid,
  outbox_id uuid,
  payment_created boolean,
  outbox_created boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_payment_created boolean;
  v_outbox_created boolean;
begin
  insert into public.pg_payments (
    tenant_id,
    occupancy_id,
    contact_id,
    period_start,
    period_end,
    due_date,
    amount_due,
    amount_paid,
    status,
    metadata
  )
  values (
    p_tenant_id,
    p_occupancy_id,
    p_contact_id,
    p_period_start,
    p_period_end,
    p_due_date,
    p_amount_due,
    p_amount_paid,
    p_status,
    coalesce(p_payment_meta, '{}'::jsonb)
  )
  on conflict (tenant_id, occupancy_id, period_start)
  where deleted_at is null
    and occupancy_id is not null
    and period_start is not null
  do update
    set updated_at = public.pg_payments.updated_at
  returning id, (xmax = 0)
  into payment_id, v_payment_created;

  insert into public.message_outbox (
    tenant_id,
    channel,
    status,
    scheduled_at,
    contact_id,
    to_phone,
    to_email,
    template_key,
    subject,
    body,
    related_table,
    related_id,
    idempotency_key,
    meta
  )
  values (
    p_tenant_id,
    'internal',
    'queued',
    p_scheduled_at,
    p_contact_id,
    p_to_phone,
    p_to_email,
    p_template_key,
    p_subject,
    p_body,
    'pg_payments',
    payment_id,
    p_outbox_idempotency_key,
    coalesce(p_outbox_meta, '{}'::jsonb)
  )
  on conflict (tenant_id, idempotency_key)
  where deleted_at is null
  do update
    set updated_at = public.message_outbox.updated_at
  returning id, (xmax = 0)
  into outbox_id, v_outbox_created;

  payment_created := v_payment_created;
  outbox_created := v_outbox_created;
  return next;
end;
$$;

create or replace function public.try_job_lock(p_job text, p_run_key text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_key bigint := hashtext(p_job || ':' || p_run_key)::bigint;
  v_locked boolean;
begin
  v_locked := pg_try_advisory_lock(v_key);
  if v_locked then
    perform pg_advisory_unlock(v_key);
  end if;
  return v_locked;
end;
$$;

revoke execute on function public.create_pg_due_and_outbox(
  uuid,
  uuid,
  uuid,
  date,
  date,
  date,
  numeric,
  numeric,
  text,
  jsonb,
  timestamptz,
  text,
  text,
  text,
  text,
  text,
  text,
  jsonb
) from anon, authenticated;

revoke execute on function public.try_job_lock(text, text)
from anon, authenticated;

grant execute on function public.create_pg_due_and_outbox(
  uuid,
  uuid,
  uuid,
  date,
  date,
  date,
  numeric,
  numeric,
  text,
  jsonb,
  timestamptz,
  text,
  text,
  text,
  text,
  text,
  text,
  jsonb
) to service_role;

grant execute on function public.try_job_lock(text, text) to service_role;
