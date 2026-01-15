create table if not exists public.tenant_invites (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  role tenant_role not null,
  token text not null unique,
  email text null,
  status text not null default 'active',
  expires_at timestamptz not null default (now() + interval '7 days'),
  used_by uuid null references auth.users(id),
  used_at timestamptz null,
  created_by uuid null references auth.users(id),
  created_at timestamptz not null default now(),
  revoked_at timestamptz null,
  revoked_by uuid null references auth.users(id),
  constraint tenant_invites_status_check
    check (status in ('active','used','revoked','expired'))
);

create index if not exists idx_tenant_invites_tenant_status
  on public.tenant_invites (tenant_id, status);

alter table public.tenant_invites enable row level security;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'tenant_invites'
      and policyname = 'tenant_invites_select'
  ) then
    create policy tenant_invites_select
      on public.tenant_invites
      for select
      using (
        exists (
          select 1
          from public.platform_users
          where user_id = auth.uid()
            and is_active = true
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
      and tablename = 'tenant_invites'
      and policyname = 'tenant_invites_insert'
  ) then
    create policy tenant_invites_insert
      on public.tenant_invites
      for insert
      with check (
        exists (
          select 1
          from public.platform_users
          where user_id = auth.uid()
            and is_active = true
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
      and tablename = 'tenant_invites'
      and policyname = 'tenant_invites_update'
  ) then
    create policy tenant_invites_update
      on public.tenant_invites
      for update
      using (
        exists (
          select 1
          from public.platform_users
          where user_id = auth.uid()
            and is_active = true
        )
      )
      with check (
        exists (
          select 1
          from public.platform_users
          where user_id = auth.uid()
            and is_active = true
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
      and tablename = 'tenant_invites'
      and policyname = 'tenant_invites_delete'
  ) then
    create policy tenant_invites_delete
      on public.tenant_invites
      for delete
      using (
        exists (
          select 1
          from public.platform_users
          where user_id = auth.uid()
            and is_active = true
        )
      );
  end if;
end;
$$;

create or replace function public.create_tenant_invite(
  p_tenant_id uuid,
  p_role tenant_role,
  p_expires_in_days int default 7
)
returns table (
  invite_id uuid,
  token text,
  expires_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_is_platform_user boolean;
  v_expires_in_days int;
  v_token text;
  v_attempt int;
begin
  select exists (
    select 1
    from public.platform_users
    where user_id = auth.uid()
      and is_active = true
  )
  into v_is_platform_user;

  if not v_is_platform_user then
    raise exception 'Only super admins can create invites';
  end if;

  if p_role is null or p_role::text not in ('owner','admin') then
    raise exception 'Invalid invite role';
  end if;

  v_expires_in_days := coalesce(p_expires_in_days, 7);
  if v_expires_in_days < 1 then
    raise exception 'Expiry must be at least 1 day';
  end if;

  for v_attempt in 1..5 loop
    v_token := encode(gen_random_bytes(24), 'base64');
    v_token := replace(replace(v_token, '+', '-'), '/', '_');
    v_token := regexp_replace(v_token, '=+$', '');

    begin
      insert into public.tenant_invites (
        tenant_id,
        role,
        token,
        expires_at,
        created_by
      )
      values (
        p_tenant_id,
        p_role,
        v_token,
        now() + make_interval(days => v_expires_in_days),
        auth.uid()
      )
      returning id, token, expires_at
      into invite_id, token, expires_at;

      return next;
      return;
    exception
      when unique_violation then
        null;
    end;
  end loop;

  raise exception 'Unable to generate unique invite token';
end;
$$;

create or replace function public.claim_tenant_invite(
  p_token text
)
returns table (
  tenant_id uuid,
  role tenant_role
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invite record;
  v_user_id uuid;
  v_has_membership boolean;
begin
  v_user_id := auth.uid();

  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  if coalesce(trim(p_token), '') = '' then
    raise exception 'Invalid or expired invite';
  end if;

  select *
  into v_invite
  from public.tenant_invites
  where token = p_token
    and status = 'active'
    and expires_at > now()
  for update;

  if not found then
    raise exception 'Invalid or expired invite';
  end if;

  select exists (
    select 1
    from public.tenant_members
    where user_id = v_user_id
  )
  into v_has_membership;

  if v_has_membership then
    raise exception 'User already assigned to a tenant';
  end if;

  insert into public.tenant_members (
    tenant_id,
    user_id,
    role,
    is_active
  )
  values (
    v_invite.tenant_id,
    v_user_id,
    v_invite.role,
    true
  );

  update public.tenant_invites
  set status = 'used',
      used_by = v_user_id,
      used_at = now()
  where id = v_invite.id;

  tenant_id := v_invite.tenant_id;
  role := v_invite.role;
  return next;
end;
$$;

revoke all on function public.create_tenant_invite(uuid, tenant_role, int) from public;
revoke all on function public.claim_tenant_invite(text) from public;

grant execute on function public.create_tenant_invite(uuid, tenant_role, int) to authenticated;
grant execute on function public.claim_tenant_invite(text) to authenticated;
