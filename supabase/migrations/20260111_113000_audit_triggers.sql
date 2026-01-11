create or replace function public.write_audit_event(
  p_tenant_id uuid,
  p_action text,
  p_entity_table text,
  p_entity_id uuid,
  p_before jsonb,
  p_after jsonb,
  p_meta jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_user_id uuid;
  v_actor_type text;
  v_metadata jsonb;
begin
  v_actor_user_id := auth.uid();
  v_actor_type := case when v_actor_user_id is null then 'system' else 'user' end;
  v_metadata := coalesce(p_meta, '{}'::jsonb)
    || jsonb_build_object('before', p_before, 'after', p_after);

  insert into public.audit_log (
    tenant_id,
    actor_user_id,
    actor_type,
    action,
    entity_type,
    entity_id,
    metadata
  )
  values (
    p_tenant_id,
    v_actor_user_id,
    v_actor_type,
    p_action,
    p_entity_table,
    p_entity_id,
    v_metadata
  );
end;
$$;

create or replace function public.audit_generic_trigger_with_soft_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_insert_action text;
  v_update_action text;
  v_before jsonb;
  v_after jsonb;
  v_before_clean jsonb;
  v_after_clean jsonb;
begin
  v_insert_action := TG_ARGV[0];
  v_update_action := TG_ARGV[1];

  if TG_OP = 'INSERT' then
    if NEW.deleted_at is not null then
      return NEW;
    end if;
    v_after := to_jsonb(NEW);
    perform public.write_audit_event(
      NEW.tenant_id,
      v_insert_action,
      TG_TABLE_NAME,
      NEW.id,
      null,
      v_after,
      null
    );
    return NEW;
  end if;

  if TG_OP = 'UPDATE' then
    if NEW.deleted_at is not null and OLD.deleted_at is not null then
      return NEW;
    end if;
    v_before := to_jsonb(OLD);
    v_after := to_jsonb(NEW);
    v_before_clean := v_before - 'updated_at' - 'updated_by';
    v_after_clean := v_after - 'updated_at' - 'updated_by';
    if v_before_clean is not distinct from v_after_clean then
      return NEW;
    end if;
    perform public.write_audit_event(
      NEW.tenant_id,
      v_update_action,
      TG_TABLE_NAME,
      NEW.id,
      v_before_clean,
      v_after_clean,
      null
    );
    return NEW;
  end if;

  return NEW;
end;
$$;

create or replace function public.audit_tenant_features()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_action text;
begin
  if TG_OP = 'INSERT' then
    v_action := case when NEW.enabled then 'feature_enabled' else 'feature_disabled' end;
    perform public.write_audit_event(
      NEW.tenant_id,
      v_action,
      TG_TABLE_NAME,
      null,
      null,
      to_jsonb(NEW) - 'updated_at' - 'updated_by',
      jsonb_build_object('feature_key', NEW.feature_key)
    );
    return NEW;
  end if;

  if TG_OP = 'UPDATE' then
    if NEW.enabled is distinct from OLD.enabled then
      v_action := case when NEW.enabled then 'feature_enabled' else 'feature_disabled' end;
      perform public.write_audit_event(
        NEW.tenant_id,
        v_action,
        TG_TABLE_NAME,
        null,
        jsonb_build_object('enabled', OLD.enabled),
        jsonb_build_object('enabled', NEW.enabled),
        jsonb_build_object('feature_key', NEW.feature_key)
      );
    end if;
    return NEW;
  end if;

  return NEW;
end;
$$;

create or replace function public.audit_support_access_grants()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_action text;
  v_before jsonb;
  v_after jsonb;
  v_before_clean jsonb;
  v_after_clean jsonb;
begin
  if TG_OP = 'INSERT' then
    v_action := 'support_grant_created';
    v_after := to_jsonb(NEW) - 'updated_at' - 'updated_by';
    perform public.write_audit_event(
      NEW.tenant_id,
      v_action,
      TG_TABLE_NAME,
      NEW.id,
      null,
      v_after,
      null
    );
    return NEW;
  end if;

  if TG_OP = 'UPDATE' then
    v_before := to_jsonb(OLD);
    v_after := to_jsonb(NEW);
    v_before_clean := v_before - 'updated_at' - 'updated_by';
    v_after_clean := v_after - 'updated_at' - 'updated_by';
    if v_before_clean is not distinct from v_after_clean then
      return NEW;
    end if;
    if NEW.status is distinct from OLD.status
      and NEW.status in ('revoked','expired') then
      v_action := 'support_grant_revoked';
    else
      v_action := 'support_grant_updated';
    end if;
    perform public.write_audit_event(
      NEW.tenant_id,
      v_action,
      TG_TABLE_NAME,
      NEW.id,
      v_before_clean,
      v_after_clean,
      null
    );
    return NEW;
  end if;

  return NEW;
end;
$$;

create or replace function public.audit_pg_occupancies()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_action text;
  v_before_clean jsonb;
  v_after_clean jsonb;
begin
  if TG_OP = 'INSERT' then
    if NEW.deleted_at is not null then
      return NEW;
    end if;
    perform public.write_audit_event(
      NEW.tenant_id,
      'pg_occupancy_assigned',
      TG_TABLE_NAME,
      NEW.id,
      null,
      to_jsonb(NEW) - 'updated_at' - 'updated_by',
      null
    );
    return NEW;
  end if;

  if TG_OP = 'UPDATE' then
    if NEW.deleted_at is not null and OLD.deleted_at is not null then
      return NEW;
    end if;
    v_before_clean := to_jsonb(OLD) - 'updated_at' - 'updated_by';
    v_after_clean := to_jsonb(NEW) - 'updated_at' - 'updated_by';
    if v_before_clean is not distinct from v_after_clean then
      return NEW;
    end if;
    if NEW.status is distinct from OLD.status and NEW.status = 'ended' then
      v_action := 'pg_occupancy_ended';
    else
      v_action := 'pg_occupancy_updated';
    end if;
    perform public.write_audit_event(
      NEW.tenant_id,
      v_action,
      TG_TABLE_NAME,
      NEW.id,
      v_before_clean,
      v_after_clean,
      null
    );
    return NEW;
  end if;

  return NEW;
end;
$$;

do $$
begin
  if not exists (
    select 1
    from pg_trigger
    where tgname = 'trg_audit_tenant_features'
  ) then
    create trigger trg_audit_tenant_features
    after insert or update on public.tenant_features
    for each row
    execute function public.audit_tenant_features();
  end if;
end;
$$;

do $$
begin
  if not exists (
    select 1
    from pg_trigger
    where tgname = 'trg_audit_support_access_grants'
  ) then
    create trigger trg_audit_support_access_grants
    after insert or update on public.support_access_grants
    for each row
    execute function public.audit_support_access_grants();
  end if;
end;
$$;

do $$
begin
  if not exists (
    select 1
    from pg_trigger
    where tgname = 'trg_audit_contacts'
  ) then
    create trigger trg_audit_contacts
    after insert or update on public.contacts
    for each row
    execute function public.audit_generic_trigger_with_soft_delete(
      'contact_created',
      'contact_updated'
    );
  end if;
end;
$$;

do $$
begin
  if not exists (
    select 1
    from pg_trigger
    where tgname = 'trg_audit_clinic_appointments'
  ) then
    create trigger trg_audit_clinic_appointments
    after insert or update on public.clinic_appointments
    for each row
    execute function public.audit_generic_trigger_with_soft_delete(
      'appointment_created',
      'appointment_updated'
    );
  end if;
end;
$$;

do $$
begin
  if not exists (
    select 1
    from pg_trigger
    where tgname = 'trg_audit_pg_rooms'
  ) then
    create trigger trg_audit_pg_rooms
    after insert or update on public.pg_rooms
    for each row
    execute function public.audit_generic_trigger_with_soft_delete(
      'pg_room_created',
      'pg_room_updated'
    );
  end if;
end;
$$;

do $$
begin
  if not exists (
    select 1
    from pg_trigger
    where tgname = 'trg_audit_pg_beds'
  ) then
    create trigger trg_audit_pg_beds
    after insert or update on public.pg_beds
    for each row
    execute function public.audit_generic_trigger_with_soft_delete(
      'pg_bed_created',
      'pg_bed_updated'
    );
  end if;
end;
$$;

do $$
begin
  if not exists (
    select 1
    from pg_trigger
    where tgname = 'trg_audit_pg_occupancies'
  ) then
    create trigger trg_audit_pg_occupancies
    after insert or update on public.pg_occupancies
    for each row
    execute function public.audit_pg_occupancies();
  end if;
end;
$$;

do $$
begin
  if not exists (
    select 1
    from pg_trigger
    where tgname = 'trg_audit_pg_payments'
  ) then
    create trigger trg_audit_pg_payments
    after insert or update on public.pg_payments
    for each row
    execute function public.audit_generic_trigger_with_soft_delete(
      'payment_created',
      'payment_updated'
    );
  end if;
end;
$$;
