alter table public.landing_settings
  add column if not exists marketing_site_url text;

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
    'marketing_site_url', v_row.marketing_site_url,
    'lead_form_schema', v_row.lead_form_schema
  );
end;
$function$;

create or replace function public.get_tenant_marketing_site(
  p_tenant_id uuid
)
returns text
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_is_platform_user boolean;
  v_url text;
begin
  select exists (
    select 1
    from public.platform_users
    where user_id = auth.uid()
      and is_active = true
  )
  into v_is_platform_user;

  if not v_is_platform_user then
    raise exception 'Only super admins can access marketing site';
  end if;

  select marketing_site_url
    into v_url
  from public.landing_settings
  where tenant_id = p_tenant_id;

  return v_url;
end;
$function$;

revoke all on function public.get_tenant_marketing_site(uuid) from public;
grant execute on function public.get_tenant_marketing_site(uuid) to authenticated;
