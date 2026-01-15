alter table public.landing_settings enable row level security;

drop policy if exists landing_settings_select on public.landing_settings;
drop policy if exists landing_settings_update on public.landing_settings;

create policy landing_settings_select
  on public.landing_settings
  for select
  using (
    exists (
      select 1
      from public.tenant_members tm
      where tm.tenant_id = landing_settings.tenant_id
        and tm.user_id = auth.uid()
        and tm.is_active = true
    )
    or exists (
      select 1
      from public.support_access_grants sag
      where sag.tenant_id = landing_settings.tenant_id
        and sag.platform_user_id = auth.uid()
        and sag.status = 'active'
        and sag.expires_at > now()
    )
  );

create policy landing_settings_update
  on public.landing_settings
  for update
  using (
    exists (
      select 1
      from public.tenant_members tm
      where tm.tenant_id = landing_settings.tenant_id
        and tm.user_id = auth.uid()
        and tm.is_active = true
        and tm.role in ('owner','admin')
    )
    or exists (
      select 1
      from public.support_access_grants sag
      where sag.tenant_id = landing_settings.tenant_id
        and sag.platform_user_id = auth.uid()
        and sag.status = 'active'
        and sag.expires_at > now()
        and sag.access_mode = 'rw'
    )
  )
  with check (
    exists (
      select 1
      from public.tenant_members tm
      where tm.tenant_id = landing_settings.tenant_id
        and tm.user_id = auth.uid()
        and tm.is_active = true
        and tm.role in ('owner','admin')
    )
    or exists (
      select 1
      from public.support_access_grants sag
      where sag.tenant_id = landing_settings.tenant_id
        and sag.platform_user_id = auth.uid()
        and sag.status = 'active'
        and sag.expires_at > now()
        and sag.access_mode = 'rw'
    )
  );
