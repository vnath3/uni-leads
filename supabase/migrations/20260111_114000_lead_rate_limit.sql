create table if not exists public.lead_rate_limits (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  ip text not null,
  bucket_start timestamptz not null,
  count int not null default 0,
  created_at timestamptz not null default now(),
  constraint lead_rate_limits_unique unique (tenant_id, ip, bucket_start)
);

create index if not exists idx_lead_rate_limits_tenant_bucket
  on public.lead_rate_limits (tenant_id, bucket_start);

alter table public.lead_rate_limits enable row level security;

create or replace function public.resolve_tenant_id(
  p_identity_type tenant_identity_type,
  p_value text
)
returns uuid
language sql
stable security definer
set search_path to 'public'
as $function$
  select ti.tenant_id
  from public.tenant_identities ti
  join public.tenants t on t.id = ti.tenant_id
  where ti.identity_type = p_identity_type
    and public.normalize_identity_value(ti.value) = public.normalize_identity_value(p_value)
    and t.status = 'active'
    and t.deleted_at is null
  order by ti.is_primary desc, ti.created_at asc
  limit 1;
$function$;

create or replace function public.get_landing_settings(
  p_identity_type tenant_identity_type,
  p_identity_value text
)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public'
as $function$
declare
  v_tenant_id uuid;
  v_row public.landing_settings%rowtype;
begin
  v_tenant_id := public.resolve_tenant_id(p_identity_type, p_identity_value);

  if v_tenant_id is null then
    return null;
  end if;

  select *
    into v_row
  from public.landing_settings ls
  where ls.tenant_id = v_tenant_id;

  if not found then
    return null;
  end if;

  return jsonb_build_object(
    'tenant_id', v_row.tenant_id,
    'brand_name', v_row.brand_name,
    'tagline', v_row.tagline,
    'logo_url', v_row.logo_url,
    'primary_color', v_row.primary_color,
    'contact_phone', v_row.contact_phone,
    'contact_email', v_row.contact_email,
    'address', v_row.address,
    'lead_form_schema', v_row.lead_form_schema
  );
end;
$function$;

create or replace function public.submit_lead(
  p_identity_type tenant_identity_type,
  p_identity_value text,
  p_contact jsonb,
  p_form_payload jsonb,
  p_source text default 'landing'::text,
  p_campaign text default null::text
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_tenant_id uuid;
  v_phone text;
  v_email text;
  v_full_name text;
  v_contact_id uuid;
  v_lead_id uuid;
  v_status text;
  v_deleted_at timestamptz;
  v_headers jsonb;
  v_ip text;
  v_bucket_start timestamptz;
  v_bucket_count int;
  v_hour_count int;
begin
  v_tenant_id := public.resolve_tenant_id(p_identity_type, p_identity_value);
  if v_tenant_id is null then
    select t.status, t.deleted_at
      into v_status, v_deleted_at
    from public.tenant_identities ti
    join public.tenants t on t.id = ti.tenant_id
    where ti.identity_type = p_identity_type
      and public.normalize_identity_value(ti.value) = public.normalize_identity_value(p_identity_value)
    order by ti.is_primary desc, ti.created_at asc
    limit 1;

    if found and (v_status is distinct from 'active' or v_deleted_at is not null) then
      raise exception 'Tenant inactive';
    end if;

    raise exception 'Unknown tenant identity';
  end if;

  v_headers := coalesce(current_setting('request.headers', true), '{}')::jsonb;
  v_ip := nullif(trim(split_part(coalesce(v_headers->>'x-forwarded-for', ''), ',', 1)), '');
  if v_ip is null then
    v_ip := nullif(trim(v_headers->>'x-real-ip'), '');
  end if;
  if v_ip is null then
    v_ip := 'unknown';
  end if;

  v_bucket_start := date_trunc('minute', now())
    - make_interval(mins => (extract(minute from now())::int % 10));

  insert into public.lead_rate_limits (tenant_id, ip, bucket_start, count)
  values (v_tenant_id, v_ip, v_bucket_start, 1)
  on conflict (tenant_id, ip, bucket_start)
  do update set count = public.lead_rate_limits.count + 1
  returning count into v_bucket_count;

  if v_bucket_count > 5 then
    raise exception 'Rate limit exceeded. Try later.';
  end if;

  select coalesce(sum(count), 0)
    into v_hour_count
  from public.lead_rate_limits
  where tenant_id = v_tenant_id
    and bucket_start >= date_trunc('hour', now());

  if v_hour_count > 100 then
    raise exception 'Rate limit exceeded. Try later.';
  end if;

  v_phone := nullif(trim(coalesce(p_contact->>'phone', '')), '');
  v_email := nullif(trim(coalesce(p_contact->>'email', '')), '');
  v_full_name := nullif(trim(coalesce(p_contact->>'full_name', '')), '');

  select c.id into v_contact_id
  from public.contacts c
  where c.tenant_id = v_tenant_id
    and c.deleted_at is null
    and (
      (v_phone is not null and c.phone = v_phone)
      or
      (v_email is not null and lower(c.email) = lower(v_email))
    )
  order by c.created_at asc
  limit 1;

  if v_contact_id is null then
    insert into public.contacts (tenant_id, full_name, phone, email, status, source, attributes)
    values (
      v_tenant_id,
      v_full_name,
      v_phone,
      v_email,
      'lead',
      p_source,
      coalesce(p_contact, '{}'::jsonb) - 'full_name' - 'phone' - 'email'
    )
    returning id into v_contact_id;
  else
    update public.contacts
    set
      full_name = coalesce(public.contacts.full_name, v_full_name),
      phone     = coalesce(public.contacts.phone, v_phone),
      email     = coalesce(public.contacts.email, v_email),
      attributes = coalesce(public.contacts.attributes, '{}'::jsonb)
                  || (coalesce(p_contact, '{}'::jsonb) - 'full_name' - 'phone' - 'email')
    where id = v_contact_id;
  end if;

  insert into public.leads (tenant_id, contact_id, source, campaign, form_payload)
  values (v_tenant_id, v_contact_id, coalesce(p_source, 'landing'), p_campaign, p_form_payload)
  returning id into v_lead_id;

  return v_lead_id;
end;
$function$;
