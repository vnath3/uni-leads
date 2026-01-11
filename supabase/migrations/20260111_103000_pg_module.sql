create table if not exists public.pg_rooms (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  name text not null,
  floor text null,
  capacity int null,
  notes text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz null,
  constraint pg_rooms_capacity_check
    check (capacity is null or capacity >= 0)
);

create unique index if not exists idx_pg_rooms_tenant_name_unique
  on public.pg_rooms (tenant_id, name)
  where deleted_at is null;

create index if not exists idx_pg_rooms_tenant
  on public.pg_rooms (tenant_id);

create table if not exists public.pg_beds (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  room_id uuid null references public.pg_rooms(id) on delete set null,
  bed_code text not null,
  status text not null default 'available',
  notes text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz null,
  metadata jsonb not null default '{}'::jsonb,
  constraint pg_beds_status_check
    check (status in ('available','occupied','maintenance','blocked'))
);

create unique index if not exists idx_pg_beds_tenant_bed_code_unique
  on public.pg_beds (tenant_id, bed_code)
  where deleted_at is null;

create index if not exists idx_pg_beds_tenant_status
  on public.pg_beds (tenant_id, status);

create index if not exists idx_pg_beds_tenant_room
  on public.pg_beds (tenant_id, room_id);

create table if not exists public.pg_occupancies (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  bed_id uuid not null references public.pg_beds(id),
  contact_id uuid not null references public.contacts(id),
  start_date date not null,
  end_date date null,
  monthly_rent numeric(12,2) null,
  security_deposit numeric(12,2) null,
  status text not null default 'active',
  notes text null,
  created_by uuid null references auth.users(id),
  updated_by uuid null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz null,
  constraint pg_occupancies_status_check
    check (status in ('active','ended','cancelled')),
  constraint pg_occupancies_dates_check
    check (end_date is null or start_date <= end_date)
);

create unique index if not exists idx_pg_occupancies_bed_active_unique
  on public.pg_occupancies (bed_id)
  where status = 'active' and deleted_at is null;

create unique index if not exists idx_pg_occupancies_contact_active_unique
  on public.pg_occupancies (contact_id)
  where status = 'active' and deleted_at is null;

create index if not exists idx_pg_occupancies_tenant_bed
  on public.pg_occupancies (tenant_id, bed_id);

create index if not exists idx_pg_occupancies_tenant_contact
  on public.pg_occupancies (tenant_id, contact_id);

create index if not exists idx_pg_occupancies_tenant_status
  on public.pg_occupancies (tenant_id, status);

create table if not exists public.pg_payments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  occupancy_id uuid null references public.pg_occupancies(id) on delete set null,
  contact_id uuid not null references public.contacts(id),
  period_start date null,
  period_end date null,
  due_date date null,
  amount_due numeric(12,2) not null,
  amount_paid numeric(12,2) not null default 0,
  paid_at timestamptz null,
  status text not null default 'due',
  method text null,
  reference text null,
  notes text null,
  created_by uuid null references auth.users(id),
  updated_by uuid null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz null,
  metadata jsonb not null default '{}'::jsonb,
  constraint pg_payments_status_check
    check (status in ('due','partial','paid','waived','refunded')),
  constraint pg_payments_amounts_check
    check (amount_due >= 0 and amount_paid >= 0)
);

create index if not exists idx_pg_payments_tenant_contact_due
  on public.pg_payments (tenant_id, contact_id, due_date);

create index if not exists idx_pg_payments_tenant_status_due
  on public.pg_payments (tenant_id, status, due_date);

create index if not exists idx_pg_payments_tenant_occupancy
  on public.pg_payments (tenant_id, occupancy_id);

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
    where tgname = 'trg_pg_rooms_set_updated_at'
  ) then
    create trigger trg_pg_rooms_set_updated_at
    before update on public.pg_rooms
    for each row
    execute function public.set_updated_at();
  end if;
end;
$$;

do $$
begin
  if not exists (
    select 1
    from pg_trigger
    where tgname = 'trg_pg_beds_set_updated_at'
  ) then
    create trigger trg_pg_beds_set_updated_at
    before update on public.pg_beds
    for each row
    execute function public.set_updated_at();
  end if;
end;
$$;

do $$
begin
  if not exists (
    select 1
    from pg_trigger
    where tgname = 'trg_pg_occupancies_set_updated_at'
  ) then
    create trigger trg_pg_occupancies_set_updated_at
    before update on public.pg_occupancies
    for each row
    execute function public.set_updated_at();
  end if;
end;
$$;

do $$
begin
  if not exists (
    select 1
    from pg_trigger
    where tgname = 'trg_pg_payments_set_updated_at'
  ) then
    create trigger trg_pg_payments_set_updated_at
    before update on public.pg_payments
    for each row
    execute function public.set_updated_at();
  end if;
end;
$$;

alter table public.pg_rooms enable row level security;
alter table public.pg_beds enable row level security;
alter table public.pg_occupancies enable row level security;
alter table public.pg_payments enable row level security;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'pg_rooms'
      and policyname = 'pg_rooms_select'
  ) then
    create policy pg_rooms_select
      on public.pg_rooms
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
      and tablename = 'pg_rooms'
      and policyname = 'pg_rooms_insert'
  ) then
    create policy pg_rooms_insert
      on public.pg_rooms
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
      and tablename = 'pg_rooms'
      and policyname = 'pg_rooms_update'
  ) then
    create policy pg_rooms_update
      on public.pg_rooms
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

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'pg_beds'
      and policyname = 'pg_beds_select'
  ) then
    create policy pg_beds_select
      on public.pg_beds
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
      and tablename = 'pg_beds'
      and policyname = 'pg_beds_insert'
  ) then
    create policy pg_beds_insert
      on public.pg_beds
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
      and tablename = 'pg_beds'
      and policyname = 'pg_beds_update'
  ) then
    create policy pg_beds_update
      on public.pg_beds
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

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'pg_occupancies'
      and policyname = 'pg_occupancies_select'
  ) then
    create policy pg_occupancies_select
      on public.pg_occupancies
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
      and tablename = 'pg_occupancies'
      and policyname = 'pg_occupancies_insert'
  ) then
    create policy pg_occupancies_insert
      on public.pg_occupancies
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
      and tablename = 'pg_occupancies'
      and policyname = 'pg_occupancies_update'
  ) then
    create policy pg_occupancies_update
      on public.pg_occupancies
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

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'pg_payments'
      and policyname = 'pg_payments_select'
  ) then
    create policy pg_payments_select
      on public.pg_payments
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
      and tablename = 'pg_payments'
      and policyname = 'pg_payments_insert'
  ) then
    create policy pg_payments_insert
      on public.pg_payments
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
      and tablename = 'pg_payments'
      and policyname = 'pg_payments_update'
  ) then
    create policy pg_payments_update
      on public.pg_payments
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
values
  ('pg.beds', 'Beds & Rooms', 'pg', true),
  ('pg.payments', 'Payments', 'pg', true)
on conflict (key) do nothing;
