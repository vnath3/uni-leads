do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'tenant_identities'
      and column_name = 'deleted_at'
  ) then
    execute 'drop index if exists public.idx_tenant_identities_domain_unique';
    execute
      'create unique index if not exists idx_tenant_identities_domain_unique
       on public.tenant_identities (public.normalize_identity_value(value))
       where identity_type = ''domain'' and deleted_at is null';
  end if;
end;
$$;
