create table if not exists public.clinic_appointments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  contact_id uuid null references public.contacts(id) on delete set null,
  scheduled_at timestamptz not null,
  duration_minutes int not null default 30,
  status text not null default 'scheduled',
  reason text null,
  notes text null,
  location text null,
  created_by uuid null references auth.users(id),
  updated_by uuid null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz null,
  metadata jsonb not null default '{}'::jsonb,
  constraint clinic_appointments_status_check
    check (status in ('scheduled','confirmed','completed','cancelled','no_show')),
  constraint clinic_appointments_duration_check
    check (duration_minutes > 0)
);

create index if not exists idx_clinic_appt_tenant_scheduled
  on public.clinic_appointments (tenant_id, scheduled_at);

create index if not exists idx_clinic_appt_tenant_status_scheduled
  on public.clinic_appointments (tenant_id, status, scheduled_at);

create index if not exists idx_clinic_appt_tenant_contact_scheduled
  on public.clinic_appointments (tenant_id, contact_id, scheduled_at);

create index if not exists idx_clinic_appt_active_tenant_scheduled
  on public.clinic_appointments (tenant_id, scheduled_at)
  where deleted_at is null;

do $$
begin
  if not exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'set_updated_at'
  ) then
    execute $fn$
      create function public.set_updated_at()
      returns trigger
      language plpgsql
      as $$
      begin
        new.updated_at = now();
        return new;
      end;
      $$;
    $fn$;
  end if;
end;
$$;

do $$
begin
  if not exists (
    select 1
    from pg_trigger
    where tgname = 'trg_clinic_appointments_set_updated_at'
  ) then
    create trigger trg_clinic_appointments_set_updated_at
    before update on public.clinic_appointments
    for each row
    execute function public.set_updated_at();
  end if;
end;
$$;

alter table public.clinic_appointments enable row level security;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'clinic_appointments'
      and policyname = 'clinic_appointments_select'
  ) then
    create policy clinic_appointments_select
      on public.clinic_appointments
      for select
      using (
        deleted_at is null
        and (
          is_tenant_member(tenant_id, array['owner','admin','member','viewer'])
          or has_active_support_grant(tenant_id, false)
        )
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
      and tablename = 'clinic_appointments'
      and policyname = 'clinic_appointments_insert'
  ) then
    create policy clinic_appointments_insert
      on public.clinic_appointments
      for insert
      with check (
        tenant_id is not null
        and (
          is_tenant_member(tenant_id, array['owner','admin','member'])
          or has_active_support_grant(tenant_id, true)
        )
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
      and tablename = 'clinic_appointments'
      and policyname = 'clinic_appointments_update'
  ) then
    create policy clinic_appointments_update
      on public.clinic_appointments
      for update
      using (
        deleted_at is null
        and (
          is_tenant_member(tenant_id, array['owner','admin','member'])
          or has_active_support_grant(tenant_id, true)
        )
      )
      with check (
        tenant_id is not null
        and (
          is_tenant_member(tenant_id, array['owner','admin','member'])
          or has_active_support_grant(tenant_id, true)
        )
      );
  end if;
end;
$$;

insert into public.features (key, name, category, is_active)
values ('clinic.appointments', 'Appointments', 'clinic', true)
on conflict (key) do nothing;
