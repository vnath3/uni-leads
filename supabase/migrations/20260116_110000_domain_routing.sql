create unique index if not exists idx_tenant_identities_domain_unique
  on public.tenant_identities (public.normalize_identity_value(value))
  where identity_type = 'domain';

create or replace function public.resolve_tenant_domain(
  p_domain text
)
returns table (
  tenant_id uuid,
  slug text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_domain text;
  v_domain_alt text;
  v_tenant_id uuid;
begin
  v_domain := lower(trim(coalesce(p_domain, '')));
  if v_domain = '' then
    return;
  end if;

  v_domain := regexp_replace(v_domain, ':\d+$', '');
  v_domain_alt := regexp_replace(v_domain, '^www\.', '');

  select ti.tenant_id
  into v_tenant_id
  from public.tenant_identities ti
  where ti.identity_type = 'domain'
    and public.normalize_identity_value(ti.value) in (
      public.normalize_identity_value(v_domain),
      public.normalize_identity_value(v_domain_alt)
    )
  limit 1;

  if v_tenant_id is null then
    return;
  end if;

  select ti.value
  into slug
  from public.tenant_identities ti
  where ti.tenant_id = v_tenant_id
    and ti.identity_type = 'slug'
  order by ti.is_primary desc nulls last
  limit 1;

  tenant_id := v_tenant_id;
  return next;
end;
$$;

revoke all on function public.resolve_tenant_domain(text) from public;
grant execute on function public.resolve_tenant_domain(text) to anon;
grant execute on function public.resolve_tenant_domain(text) to authenticated;
