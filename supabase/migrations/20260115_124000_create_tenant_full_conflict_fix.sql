create or replace function public.create_tenant_full(
  p_name text,
  p_slug text,
  p_status text default 'active',
  p_vertical text default 'pg',
  p_owner_user_id uuid default null
)
returns table (
  tenant_id uuid,
  slug text
)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_tenant_id uuid;
  v_slug text;
  v_status tenant_status;
  v_vertical text;
  v_lead_form_schema jsonb;
  v_exists boolean;
begin
  v_slug := lower(trim(coalesce(p_slug, '')));

  if v_slug = '' then
    raise exception 'Slug is required';
  end if;

  if v_slug !~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' then
    raise exception 'Invalid slug format';
  end if;

  if coalesce(nullif(trim(p_name), ''), '') = '' then
    raise exception 'Tenant name is required';
  end if;

  v_status := coalesce(nullif(trim(p_status), ''), 'active')::tenant_status;

  select true
    into v_exists
  from public.tenant_identities ti
  where ti.identity_type = 'slug'
    and public.normalize_identity_value(ti.value) = public.normalize_identity_value(v_slug)
  limit 1;

  if v_exists then
    raise exception 'Slug already exists';
  end if;

  insert into public.tenants (name, status)
  values (p_name, v_status)
  returning id into v_tenant_id;

  insert into public.tenant_identities (tenant_id, identity_type, value, is_primary)
  values (v_tenant_id, 'slug', v_slug, true);

  v_vertical := lower(trim(coalesce(p_vertical, 'pg')));

  if v_vertical = 'clinic' then
    v_lead_form_schema := jsonb_build_object(
      'fields', jsonb_build_array(
        jsonb_build_object('key','full_name','label','Full Name','type','text','required',true),
        jsonb_build_object('key','phone','label','Phone','type','tel','required',true),
        jsonb_build_object(
          'key','pain_area',
          'label','Pain Area',
          'type','select',
          'required',false,
          'options',jsonb_build_array('Knee','Back','Shoulder','Sports')
        )
      ),
      'trust_points', jsonb_build_array(
        'Physio-led care plans',
        'Same-day appointment slots',
        'Evidence-based rehab'
      )
    );
  else
    v_lead_form_schema := jsonb_build_object(
      'fields', jsonb_build_array(
        jsonb_build_object('key','full_name','label','Full Name','type','text','required',true),
        jsonb_build_object('key','phone','label','Phone','type','tel','required',true),
        jsonb_build_object(
          'key','student_type',
          'label','Student Type',
          'type','select',
          'required',false,
          'options',jsonb_build_array('JEE','NEET','Other')
        ),
        jsonb_build_object(
          'key','move_in_month',
          'label','Move-in month',
          'type','month',
          'required',false
        )
      ),
      'trust_points', jsonb_build_array(
        'Walking distance to coaching',
        'Homely food + safe environment',
        'Limited beds (10 total)'
      )
    );
  end if;

  insert into public.landing_settings (
    tenant_id,
    brand_name,
    tagline,
    logo_url,
    primary_color,
    contact_phone,
    contact_email,
    address,
    lead_form_schema
  )
  values (
    v_tenant_id,
    p_name,
    null,
    null,
    null,
    null,
    null,
    null,
    v_lead_form_schema
  );

  insert into public.tenant_features (tenant_id, feature_key, enabled, enabled_by, enabled_at)
  select v_tenant_id, f.key, true, p_owner_user_id, now()
  from public.features f
  where f.key in ('landing','leads','contacts','audit')
    and coalesce(f.is_active, true) = true;

  if v_vertical = 'clinic' then
    insert into public.tenant_features (tenant_id, feature_key, enabled, enabled_by, enabled_at)
    select v_tenant_id, f.key, true, p_owner_user_id, now()
    from public.features f
    where f.key in ('clinic.appointments')
      and coalesce(f.is_active, true) = true;
  else
    insert into public.tenant_features (tenant_id, feature_key, enabled, enabled_by, enabled_at)
    select v_tenant_id, f.key, true, p_owner_user_id, now()
    from public.features f
    where f.key in ('pg.beds','pg.payments','pg.occupancy')
      and coalesce(f.is_active, true) = true;
  end if;

  insert into public.message_templates (
    tenant_id,
    key,
    channel,
    name,
    subject,
    body,
    variables,
    is_active
  )
  values (
    v_tenant_id,
    'lead_instant_ack',
    'whatsapp',
    'Lead Instant Acknowledgement',
    null,
    'Hi {{full_name}}, thanks for your enquiry! We''ll contact you shortly. If you want a quick reply, reply with your preferred time.',
    jsonb_build_array('full_name','tenant_name','source','campaign'),
    true
  )
  on conflict (tenant_id, key, channel) do nothing;

  if v_vertical = 'clinic' then
    insert into public.automation_rules (
      tenant_id,
      job,
      is_enabled,
      config,
      created_by,
      updated_by
    )
    values (
      v_tenant_id,
      'clinic_appt_reminders',
      false,
      jsonb_build_object('window_hours', 24),
      p_owner_user_id,
      p_owner_user_id
    )
    on conflict (tenant_id, job)
    where deleted_at is null
    do nothing;
  else
    insert into public.automation_rules (
      tenant_id,
      job,
      is_enabled,
      config,
      created_by,
      updated_by
    )
    values (
      v_tenant_id,
      'pg_monthly_dues',
      false,
      jsonb_build_object('due_day', 5),
      p_owner_user_id,
      p_owner_user_id
    )
    on conflict (tenant_id, job)
    where deleted_at is null
    do nothing;
  end if;

  if p_owner_user_id is not null then
    insert into public.tenant_members (tenant_id, user_id, role, is_active)
    values (v_tenant_id, p_owner_user_id, 'owner', true);
  end if;

  tenant_id := v_tenant_id;
  slug := v_slug;
  return next;
end;
$$;
