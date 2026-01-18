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
  v_has_deleted_at boolean;
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

  select exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'tenant_identities'
      and column_name = 'deleted_at'
  )
  into v_has_deleted_at;

  if v_has_deleted_at then
    execute
      'update public.tenant_identities
       set deleted_at = now()
       where tenant_id = $1
         and identity_type = ''domain''
         and public.normalize_identity_value(value) = public.normalize_identity_value($2)'
    using p_tenant_id, v_domain;
  else
    delete from public.tenant_identities
    where tenant_id = p_tenant_id
      and identity_type = 'domain'
      and public.normalize_identity_value(value) =
        public.normalize_identity_value(v_domain);
  end if;

  get diagnostics v_count = row_count;
  return v_count > 0;
end;
$$;
