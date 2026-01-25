create or replace function public.has_active_support_grant(
  p_tenant_id uuid,
  p_write boolean default false
)
returns boolean
language plpgsql
stable security definer
set search_path = public
as $function$
declare
  v_is_platform_user boolean;
begin
  select exists (
    select 1
    from public.platform_users
    where user_id = auth.uid()
      and is_active = true
  )
  into v_is_platform_user;

  if v_is_platform_user then
    return true;
  end if;

  return exists (
    select 1
    from public.support_access_grants
    where tenant_id = p_tenant_id
      and platform_user_id = auth.uid()
      and status = 'active'
      and expires_at > now()
      and (not p_write or access_mode = 'rw')
  );
end;
$function$;

revoke all on function public.has_active_support_grant(uuid, boolean) from public;
grant execute on function public.has_active_support_grant(uuid, boolean) to authenticated;
