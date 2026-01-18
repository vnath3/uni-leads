create or replace function public.hard_delete_tenant(
  p_tenant_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_is_platform_user boolean;
  v_deleted int;
begin
  select exists (
    select 1
    from public.platform_users
    where user_id = auth.uid()
      and is_active = true
  )
  into v_is_platform_user;

  if not v_is_platform_user then
    raise exception 'Only super admins can delete tenants';
  end if;

  if to_regclass('public.tenant_invites') is not null then
    execute 'delete from public.tenant_invites where tenant_id = $1' using p_tenant_id;
  end if;
  if to_regclass('public.support_access_grants') is not null then
    execute 'delete from public.support_access_grants where tenant_id = $1' using p_tenant_id;
  end if;
  if to_regclass('public.tenant_members') is not null then
    execute 'delete from public.tenant_members where tenant_id = $1' using p_tenant_id;
  end if;
  if to_regclass('public.tenant_features') is not null then
    execute 'delete from public.tenant_features where tenant_id = $1' using p_tenant_id;
  end if;
  if to_regclass('public.message_outbox') is not null then
    execute 'delete from public.message_outbox where tenant_id = $1' using p_tenant_id;
  end if;
  if to_regclass('public.message_templates') is not null then
    execute 'delete from public.message_templates where tenant_id = $1' using p_tenant_id;
  end if;
  if to_regclass('public.automation_rules') is not null then
    execute 'delete from public.automation_rules where tenant_id = $1' using p_tenant_id;
  end if;
  if to_regclass('public.pg_payments') is not null then
    execute 'delete from public.pg_payments where tenant_id = $1' using p_tenant_id;
  end if;
  if to_regclass('public.pg_occupancies') is not null then
    execute 'delete from public.pg_occupancies where tenant_id = $1' using p_tenant_id;
  end if;
  if to_regclass('public.pg_beds') is not null then
    execute 'delete from public.pg_beds where tenant_id = $1' using p_tenant_id;
  end if;
  if to_regclass('public.pg_rooms') is not null then
    execute 'delete from public.pg_rooms where tenant_id = $1' using p_tenant_id;
  end if;
  if to_regclass('public.clinic_appointments') is not null then
    execute 'delete from public.clinic_appointments where tenant_id = $1' using p_tenant_id;
  end if;
  if to_regclass('public.leads') is not null then
    execute 'delete from public.leads where tenant_id = $1' using p_tenant_id;
  end if;
  if to_regclass('public.contacts') is not null then
    execute 'delete from public.contacts where tenant_id = $1' using p_tenant_id;
  end if;
  if to_regclass('public.landing_settings') is not null then
    execute 'delete from public.landing_settings where tenant_id = $1' using p_tenant_id;
  end if;
  if to_regclass('public.tenant_identities') is not null then
    execute 'delete from public.tenant_identities where tenant_id = $1' using p_tenant_id;
  end if;
  if to_regclass('public.lead_rate_limits') is not null then
    execute 'delete from public.lead_rate_limits where tenant_id = $1' using p_tenant_id;
  end if;
  if to_regclass('public.audit_log') is not null then
    execute 'delete from public.audit_log where tenant_id = $1' using p_tenant_id;
  end if;

  delete from public.tenants where id = p_tenant_id;
  get diagnostics v_deleted = row_count;

  if v_deleted = 0 then
    raise exception 'Tenant not found';
  end if;

  return true;
end;
$$;

revoke all on function public.hard_delete_tenant(uuid) from public;
grant execute on function public.hard_delete_tenant(uuid) to authenticated;
