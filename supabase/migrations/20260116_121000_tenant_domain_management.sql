create or replace function public.add_tenant_domain(
  p_tenant_id uuid,
  p_domain text
)
returns table (
  identity_id uuid,
  domain text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_is_platform_user boolean;
  v_domain text;
begin
  select exists (
    select 1
    from public.platform_users
    where user_id = auth.uid()
      and is_active = true
  )
  into v_is_platform_user;

  if not v_is_platform_user then
    raise exception 'Only super admins can manage domains';
  end if;

  v_domain := lower(trim(coalesce(p_domain, '')));
  v_domain := regexp_replace(v_domain, '^https?://', '');
  v_domain := regexp_replace(v_domain, '/.*$', '');
  v_domain := regexp_replace(v_domain, ':\d+$', '');
  v_domain := regexp_replace(v_domain, '/$', '');

  if v_domain = '' then
    raise exception 'Domain is required';
  end if;

  begin
    insert into public.tenant_identities (
      tenant_id,
      identity_type,
      value,
      is_primary
    )
    values (
      p_tenant_id,
      'domain',
      v_domain,
      false
    )
    returning id, value
    into identity_id, domain;
  exception
    when unique_violation then
      raise exception 'Domain already in use';
  end;

  return next;
end;
$$;

create or replace function public.remove_tenant_domain(
  p_tenant_id uuid,
  p_domain text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_is_platform_user boolean;
  v_domain text;
  v_count int;
begin
  select exists (
    select 1
    from public.platform_users
    where user_id = auth.uid()
      and is_active = true
  )
  into v_is_platform_user;

  if not v_is_platform_user then
    raise exception 'Only super admins can manage domains';
  end if;

  v_domain := lower(trim(coalesce(p_domain, '')));
  v_domain := regexp_replace(v_domain, '^https?://', '');
  v_domain := regexp_replace(v_domain, '/.*$', '');
  v_domain := regexp_replace(v_domain, ':\d+$', '');
  v_domain := regexp_replace(v_domain, '/$', '');

  if v_domain = '' then
    raise exception 'Domain is required';
  end if;

  delete from public.tenant_identities ti
  where ti.tenant_id = p_tenant_id
    and ti.identity_type = 'domain'
    and public.normalize_identity_value(ti.value) =
      public.normalize_identity_value(v_domain);

  get diagnostics v_count = row_count;
  return v_count > 0;
end;
$$;

revoke all on function public.add_tenant_domain(uuid, text) from public;
revoke all on function public.remove_tenant_domain(uuid, text) from public;

grant execute on function public.add_tenant_domain(uuid, text) to authenticated;
grant execute on function public.remove_tenant_domain(uuid, text) to authenticated;
