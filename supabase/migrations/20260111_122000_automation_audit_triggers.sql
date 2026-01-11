do $$
begin
  if not exists (
    select 1
    from pg_trigger
    where tgname = 'trg_audit_automation_rules'
  ) then
    create trigger trg_audit_automation_rules
    after insert or update on public.automation_rules
    for each row
    execute function public.audit_generic_trigger_with_soft_delete(
      'automation_rule_created',
      'automation_rule_updated'
    );
  end if;
end;
$$;

do $$
begin
  if not exists (
    select 1
    from pg_trigger
    where tgname = 'trg_audit_message_templates'
  ) then
    create trigger trg_audit_message_templates
    after insert or update on public.message_templates
    for each row
    execute function public.audit_generic_trigger_with_soft_delete(
      'template_created',
      'template_updated'
    );
  end if;
end;
$$;

do $$
begin
  if not exists (
    select 1
    from pg_trigger
    where tgname = 'trg_audit_message_outbox'
  ) then
    create trigger trg_audit_message_outbox
    after insert or update on public.message_outbox
    for each row
    execute function public.audit_generic_trigger_with_soft_delete(
      'outbox_created',
      'outbox_updated'
    );
  end if;
end;
$$;
