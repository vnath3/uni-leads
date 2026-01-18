create or replace function public.create_tenant_full(
  p_name text,
  p_slug text,
  p_status text default 'active',
  p_vertical text default 'pg',
  p_owner_user_id uuid default null,
  p_tagline text default null,
  p_contact_phone text default null,
  p_contact_email text default null,
  p_address text default null,
  p_primary_color text default null,
  p_landing_content jsonb default null,
  p_trust_points jsonb default null
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
  v_has_template boolean;
  v_has_rule boolean;
  v_tagline text;
  v_lead_body text;
  v_contact_phone text;
  v_contact_email text;
  v_address text;
  v_primary_color text;
  v_landing_config jsonb;
  v_proof_chips jsonb;
  v_services_title text;
  v_subheadline text;
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

  select exists(
    select 1
    from public.tenant_identities ti
    where ti.identity_type = 'slug'
      and public.normalize_identity_value(ti.value) = public.normalize_identity_value(v_slug)
  )
  into v_exists;

  if v_exists then
    raise exception 'Slug already exists';
  end if;

  insert into public.tenants (name, status)
  values (p_name, v_status)
  returning id into v_tenant_id;

  insert into public.tenant_identities (tenant_id, identity_type, value, is_primary)
  values (v_tenant_id, 'slug', v_slug, true);

  v_vertical := lower(trim(coalesce(p_vertical, 'pg')));
  v_tagline := null;
  v_lead_body := 'Hi {{full_name}}, thanks for your enquiry! We''ll contact you shortly. If you want a quick reply, reply with your preferred time.';

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
  elsif v_vertical = 'cab' then
    v_tagline := 'Airport - Local - Outstation';
    v_lead_body := 'Hi {{full_name}}, thanks for contacting {{tenant_name}}. Please share Pickup, Drop and Time. We''ll confirm the best fare shortly.';
    v_lead_form_schema := jsonb_build_object(
      'fields', jsonb_build_array(
        jsonb_build_object('key','full_name','label','Full Name','type','text','required',true),
        jsonb_build_object('key','phone','label','Phone','type','tel','required',true),
        jsonb_build_object(
          'key','trip_type',
          'label','Trip Type',
          'type','select',
          'required',false,
          'options',jsonb_build_array('Airport','Local','Outstation')
        ),
        jsonb_build_object(
          'key','pickup',
          'label','Pickup',
          'type','text',
          'required',true
        ),
        jsonb_build_object(
          'key','drop',
          'label','Drop',
          'type','text',
          'required',true
        ),
        jsonb_build_object(
          'key','travel_time',
          'label','Travel time',
          'type','select',
          'required',false,
          'options',jsonb_build_array('Morning','Afternoon','Evening')
        )
      ),
      'trust_points', jsonb_build_array(
        'Airport pickups on time',
        'Clean, comfortable cabs',
        'Local and outstation coverage'
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

  if p_trust_points is not null and jsonb_typeof(p_trust_points) = 'array' then
    v_lead_form_schema := jsonb_set(v_lead_form_schema, '{trust_points}', p_trust_points, true);
  end if;

  v_tagline := coalesce(nullif(trim(p_tagline), ''), v_tagline);
  v_contact_phone := nullif(trim(p_contact_phone), '');
  v_contact_email := nullif(trim(p_contact_email), '');
  v_address := nullif(trim(p_address), '');
  v_primary_color := nullif(trim(p_primary_color), '');
  v_services_title := case
    when v_vertical = 'pg' then 'Room types'
    when v_vertical = 'clinic' then 'Treatments & packages'
    when v_vertical = 'salon' then 'Popular services'
    when v_vertical = 'coaching' then 'Courses & batches'
    when v_vertical = 'cab' then 'Services'
    else 'Services and packages'
  end;
  v_proof_chips := coalesce(
    case when jsonb_typeof(p_trust_points) = 'array' then p_trust_points else null end,
    v_lead_form_schema->'trust_points',
    '[]'::jsonb
  );
  v_subheadline := coalesce(
    v_tagline,
    'Fast, friendly, and verified support for your next enquiry.'
  );
  v_landing_config := jsonb_build_object(
    'version', 1,
    'vertical', v_vertical,
    'brand', jsonb_build_object(
      'name', p_name,
      'tagline', v_tagline,
      'badge', 'Trusted local team'
    ),
    'contact', jsonb_build_object(
      'phone', v_contact_phone,
      'whatsapp', v_contact_phone,
      'email', v_contact_email,
      'address_line', v_address,
      'map_url', null,
      'hours', jsonb_build_array()
    ),
    'cta', jsonb_build_object(
      'primary', jsonb_build_object(
        'type', 'whatsapp',
        'label', 'WhatsApp',
        'prefill_template', 'Hi, I want to enquire about {brand_name}.'
      ),
      'secondary', jsonb_build_object(
        'type', 'call',
        'label', 'Call'
      ),
      'sticky_bar', jsonb_build_object(
        'enabled', true,
        'show_enquire', true
      )
    ),
    'hero', jsonb_build_object(
      'headline', p_name,
      'subheadline', v_subheadline,
      'proof_chips', v_proof_chips,
      'snapshot', jsonb_build_object(
        'title', 'Quick snapshot',
        'bullets', v_proof_chips
      ),
      'media', jsonb_build_object(
        'hero_image_url', null,
        'gallery_strip_enabled', false
      )
    ),
    'sections', jsonb_build_object(
      'why_choose', jsonb_build_object(
        'enabled', true,
        'title', 'Why choose us',
        'subtitle', 'The details that matter before you decide.',
        'items', null
      ),
      'gallery', jsonb_build_object(
        'enabled', true,
        'title', 'Gallery',
        'images', jsonb_build_array()
      ),
      'services', jsonb_build_object(
        'enabled', true,
        'title', v_services_title,
        'subtitle', 'Choose the plan that fits your needs.',
        'pricing_note', null,
        'items', null
      ),
      'testimonials', jsonb_build_object(
        'enabled', true,
        'title', 'People love the experience',
        'subtitle', 'Recent feedback from real visitors.',
        'items', null
      ),
      'faq', jsonb_build_object(
        'enabled', true,
        'title', 'FAQ',
        'subtitle', 'Quick answers to common questions.',
        'items', null
      ),
      'location', jsonb_build_object(
        'enabled', true,
        'title', 'Location and hours',
        'subtitle', 'Find us or reach out anytime.',
        'show_map_button', true,
        'show_contact_card', true
      )
    ),
    'footer', jsonb_build_object(
      'show_share', true,
      'share_label', 'Share this page',
      'developer_credit', jsonb_build_object(
        'enabled', false,
        'label', null,
        'url', null
      )
    ),
    'theme', jsonb_build_object(
      'theme_id', null
    )
  );

  if p_landing_content is not null and jsonb_typeof(p_landing_content) = 'object' then
    v_landing_config := v_landing_config || p_landing_content;
  end if;

  v_lead_form_schema := v_lead_form_schema || jsonb_build_object('landing', v_landing_config);

  insert into public.landing_settings (
    tenant_id,
    brand_name,
    tagline,
    logo_url,
    primary_color,
    contact_phone,
    contact_email,
    address,
    lead_form_schema,
    is_live
  )
  values (
    v_tenant_id,
    p_name,
    v_tagline,
    null,
    v_primary_color,
    v_contact_phone,
    v_contact_email,
    v_address,
    v_lead_form_schema,
    false
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
  elsif v_vertical = 'cab' then
    null;
  else
    insert into public.tenant_features (tenant_id, feature_key, enabled, enabled_by, enabled_at)
    select v_tenant_id, f.key, true, p_owner_user_id, now()
    from public.features f
    where f.key in ('pg.beds','pg.payments','pg.occupancy')
      and coalesce(f.is_active, true) = true;
  end if;

  select exists(
    select 1
    from public.message_templates
    where tenant_id = v_tenant_id
      and key = 'lead_instant_ack'
      and channel = 'whatsapp'
      and deleted_at is null
  )
  into v_has_template;

  if not v_has_template then
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
      v_lead_body,
      jsonb_build_array('full_name','tenant_name','source','campaign'),
      true
    );
  end if;

  if v_vertical = 'clinic' then
    select exists(
      select 1
      from public.automation_rules
      where tenant_id = v_tenant_id
        and job = 'clinic_appt_reminders'
        and deleted_at is null
    )
    into v_has_rule;

    if not v_has_rule then
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
      );
    end if;
  elsif v_vertical = 'cab' then
    null;
  else
    select exists(
      select 1
      from public.automation_rules
      where tenant_id = v_tenant_id
        and job = 'pg_monthly_dues'
        and deleted_at is null
    )
    into v_has_rule;

    if not v_has_rule then
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
      );
    end if;
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
