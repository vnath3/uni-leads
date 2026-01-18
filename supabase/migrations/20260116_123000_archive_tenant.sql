create or replace function public.archive_tenant(
  p_tenant_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_is_platform_user boolean;
  v_has_tenant_deleted_at boolean;
  v_has_identity_deleted_at boolean;
  v_has_landing_deleted_at boolean;
  v_updated int;
begin
  select exists (
    select 1
    from public.platform_users
    where user_id = auth.uid()
      and is_active = true
  )
  into v_is_platform_user;

  if not v_is_platform_user then
    raise exception 'Only super admins can archive tenants';
  end if;

  select exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'tenants'
      and column_name = 'deleted_at'
  )
  into v_has_tenant_deleted_at;

  if v_has_tenant_deleted_at then
    execute
      'update public.tenants
       set status = ''archived'',
           deleted_at = now()
       where id = $1'
    using p_tenant_id;
  else
    update public.tenants
    set status = 'archived'
    where id = p_tenant_id;
  end if;

  get diagnostics v_updated = row_count;
  if v_updated = 0 then
    raise exception 'Tenant not found';
  end if;

  select exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'tenant_identities'
      and column_name = 'deleted_at'
  )
  into v_has_identity_deleted_at;

  if v_has_identity_deleted_at then
    execute
      'update public.tenant_identities
       set deleted_at = now()
       where tenant_id = $1'
    using p_tenant_id;
  else
    delete from public.tenant_identities
    where tenant_id = p_tenant_id;
  end if;

  select exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'landing_settings'
      and column_name = 'deleted_at'
  )
  into v_has_landing_deleted_at;

  if v_has_landing_deleted_at then
    execute
      'update public.landing_settings
       set deleted_at = now(),
           is_live = false
       where tenant_id = $1'
    using p_tenant_id;
  else
    update public.landing_settings
    set is_live = false
    where tenant_id = p_tenant_id;
  end if;

  return true;
end;
$$;

revoke all on function public.archive_tenant(uuid) from public;
grant execute on function public.archive_tenant(uuid) to authenticated;
