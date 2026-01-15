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
set search_path = public, extensions
as $$
declare
  v_is_platform_user boolean;
  v_expires_in_days int;
  v_token text;
  v_attempt int;
  v_invite_id uuid;
  v_expires_at timestamptz;
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
      insert into public.tenant_invites as ti (
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
      returning ti.id, ti.expires_at
      into v_invite_id, v_expires_at;

      invite_id := v_invite_id;
      token := v_token;
      expires_at := v_expires_at;
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
