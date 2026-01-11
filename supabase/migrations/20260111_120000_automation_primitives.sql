create table if not exists public.automation_rules (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  job text not null,
  is_enabled boolean not null default false,
  config jsonb not null default '{}'::jsonb,
  last_run_at timestamptz null,
  created_by uuid null references auth.users(id),
  updated_by uuid null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz null,
  constraint automation_rules_job_check
    check (job in ('pg_monthly_dues','clinic_appt_reminders'))
);

create unique index if not exists idx_automation_rules_tenant_job_unique
  on public.automation_rules (tenant_id, job)
  where deleted_at is null;

create table if not exists public.message_templates (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  key text not null,
  channel text not null,
  name text not null,
  subject text null,
  body text not null,
  variables jsonb not null default '[]'::jsonb,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz null,
  constraint message_templates_channel_check
    check (channel in ('internal','whatsapp','sms','email'))
);

create unique index if not exists idx_message_templates_tenant_key_channel_unique
  on public.message_templates (tenant_id, key, channel)
  where deleted_at is null;

create table if not exists public.message_outbox (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  channel text not null,
  status text not null default 'queued',
  scheduled_at timestamptz not null default now(),
  contact_id uuid null references public.contacts(id) on delete set null,
  to_phone text null,
  to_email text null,
  template_key text null,
  subject text null,
  body text not null,
  related_table text null,
  related_id uuid null,
  idempotency_key text not null,
  error text null,
  meta jsonb not null default '{}'::jsonb,
  created_by uuid null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz null,
  constraint message_outbox_channel_check
    check (channel in ('internal','whatsapp','sms','email')),
  constraint message_outbox_status_check
    check (status in ('queued','processing','sent','failed','cancelled'))
);

create unique index if not exists idx_message_outbox_tenant_idempotency_unique
  on public.message_outbox (tenant_id, idempotency_key)
  where deleted_at is null;

create index if not exists idx_message_outbox_tenant_status_scheduled
  on public.message_outbox (tenant_id, status, scheduled_at);

create index if not exists idx_message_outbox_tenant_related
  on public.message_outbox (tenant_id, related_table, related_id);

create table if not exists public.job_runs (
  id uuid primary key default gen_random_uuid(),
  job text not null,
  run_key text not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz null,
  status text not null default 'running',
  summary jsonb not null default '{}'::jsonb,
  constraint job_runs_job_check
    check (job in ('pg_monthly_dues','clinic_appt_reminders')),
  constraint job_runs_status_check
    check (status in ('running','success','failed'))
);

create unique index if not exists idx_job_runs_job_run_key_unique
  on public.job_runs (job, run_key);

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
    where tgname = 'trg_automation_rules_set_updated_at'
  ) then
    create trigger trg_automation_rules_set_updated_at
    before update on public.automation_rules
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
    where tgname = 'trg_message_templates_set_updated_at'
  ) then
    create trigger trg_message_templates_set_updated_at
    before update on public.message_templates
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
    where tgname = 'trg_message_outbox_set_updated_at'
  ) then
    create trigger trg_message_outbox_set_updated_at
    before update on public.message_outbox
    for each row
    execute function public.set_updated_at();
  end if;
end;
$$;

alter table public.automation_rules enable row level security;
alter table public.message_templates enable row level security;
alter table public.message_outbox enable row level security;
alter table public.job_runs enable row level security;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'automation_rules'
      and policyname = 'automation_rules_select'
  ) then
    create policy automation_rules_select
      on public.automation_rules
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
      and tablename = 'automation_rules'
      and policyname = 'automation_rules_insert'
  ) then
    create policy automation_rules_insert
      on public.automation_rules
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
      and tablename = 'automation_rules'
      and policyname = 'automation_rules_update'
  ) then
    create policy automation_rules_update
      on public.automation_rules
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
      and tablename = 'message_templates'
      and policyname = 'message_templates_select'
  ) then
    create policy message_templates_select
      on public.message_templates
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
      and tablename = 'message_templates'
      and policyname = 'message_templates_insert'
  ) then
    create policy message_templates_insert
      on public.message_templates
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
      and tablename = 'message_templates'
      and policyname = 'message_templates_update'
  ) then
    create policy message_templates_update
      on public.message_templates
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
      and tablename = 'message_outbox'
      and policyname = 'message_outbox_select'
  ) then
    create policy message_outbox_select
      on public.message_outbox
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
      and tablename = 'message_outbox'
      and policyname = 'message_outbox_insert'
  ) then
    create policy message_outbox_insert
      on public.message_outbox
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
      and tablename = 'message_outbox'
      and policyname = 'message_outbox_update'
  ) then
    create policy message_outbox_update
      on public.message_outbox
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
