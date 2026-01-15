alter table public.landing_settings
  add column if not exists is_live boolean not null default false,
  add column if not exists live_enabled_at timestamptz null,
  add column if not exists live_enabled_by uuid null references auth.users(id);

alter table public.landing_settings enable row level security;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'landing_settings'
      and policyname = 'landing_settings_select'
  ) then
    create policy landing_settings_select
      on public.landing_settings
      for select
      using (
        is_tenant_member(tenant_id, array['owner','admin','member','viewer'])
      );
  end if;
end;
$$;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'landing_settings'
      and policyname = 'landing_settings_update'
  ) then
    create policy landing_settings_update
      on public.landing_settings
      for update
      using (
        is_tenant_member(tenant_id, array['owner','admin'])
      )
      with check (
        is_tenant_member(tenant_id, array['owner','admin'])
      );
  end if;
end;
$$;
