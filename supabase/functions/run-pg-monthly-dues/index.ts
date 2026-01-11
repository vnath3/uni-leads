import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.2";

type AutomationRule = {
  tenant_id: string;
  config: Record<string, unknown> | null;
};

type Occupancy = {
  id: string;
  contact_id: string;
  monthly_rent: number | null;
  contacts?: {
    full_name?: string | null;
    phone?: string | null;
    email?: string | null;
  } | { full_name?: string | null; phone?: string | null; email?: string | null }[] | null;
};

const getServiceClient = () => {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  }
  return createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false }
  });
};

const clampNumber = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);

const toDateString = (value: Date) => value.toISOString().slice(0, 10);

const renderTemplate = (template: string, data: Record<string, string>) => {
  let result = template;
  for (const [key, value] of Object.entries(data)) {
    result = result.replaceAll(`{{${key}}}`, value);
  }
  return result;
};

serve(async () => {
  const supabase = getServiceClient();
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();
  const periodStart = new Date(Date.UTC(year, month, 1));
  const periodEnd = new Date(Date.UTC(year, month + 1, 0));
  const periodStartDate = toDateString(periodStart);
  const periodEndDate = toDateString(periodEnd);
  const runKey = `pg_monthly_dues:${periodStartDate}`;

  const { error: runInsertError } = await supabase.from("job_runs").insert({
    job: "pg_monthly_dues",
    run_key: runKey,
    status: "running"
  });

  if (runInsertError?.code === "23505") {
    return new Response(
      JSON.stringify({ ok: true, skipped: true, run_key: runKey }),
      { status: 200 }
    );
  }

  if (runInsertError) {
    return new Response(JSON.stringify({ ok: false, error: runInsertError.message }), {
      status: 500
    });
  }

  const summary = {
    tenants_processed: 0,
    dues_created: 0,
    dues_skipped: 0,
    outbox_created: 0,
    outbox_skipped: 0,
    errors: [] as string[]
  };

  try {
    const { data: rules, error: rulesError } = await supabase
      .from("automation_rules")
      .select("tenant_id, config")
      .eq("job", "pg_monthly_dues")
      .eq("is_enabled", true)
      .is("deleted_at", null);

    if (rulesError) {
      throw rulesError;
    }

    for (const rule of (rules as AutomationRule[]) ?? []) {
      summary.tenants_processed += 1;
      const tenantId = rule.tenant_id;
      const { data: tenantRow } = await supabase
        .from("tenants")
        .select("status, deleted_at")
        .eq("id", tenantId)
        .maybeSingle();

      if (!tenantRow || tenantRow.deleted_at || tenantRow.status !== "active") {
        continue;
      }

      const { data: featureRow } = await supabase
        .from("tenant_features")
        .select("enabled")
        .eq("tenant_id", tenantId)
        .eq("feature_key", "pg.payments")
        .maybeSingle();

      if (!featureRow?.enabled) {
        continue;
      }

      const { data: template } = await supabase
        .from("message_templates")
        .select("key, subject, body")
        .eq("tenant_id", tenantId)
        .eq("key", "pg_due_reminder")
        .eq("channel", "internal")
        .eq("is_active", true)
        .is("deleted_at", null)
        .maybeSingle();

      const { data: occupancies, error: occupancyError } = await supabase
        .from("pg_occupancies")
        .select(
          `id,
           contact_id,
           monthly_rent,
           contacts:contact_id (full_name, phone, email)`
        )
        .eq("tenant_id", tenantId)
        .eq("status", "active")
        .is("deleted_at", null);

      if (occupancyError) {
        summary.errors.push(`Occupancies for ${tenantId}: ${occupancyError.message}`);
        continue;
      }

      const config = rule.config ?? {};
      const dueDayRaw = Number((config as { due_day?: number }).due_day ?? 5);
      const dueDay = Number.isFinite(dueDayRaw) ? clampNumber(dueDayRaw, 1, 28) : 5;
      const dueDate = toDateString(new Date(Date.UTC(year, month, dueDay)));

      for (const occupancy of (occupancies as Occupancy[]) ?? []) {
        const amountDue = Number(occupancy.monthly_rent ?? 0);
        if (!amountDue || amountDue <= 0) {
          summary.dues_skipped += 1;
          continue;
        }

        const { data: paymentRows, error: paymentError } = await supabase
          .from("pg_payments")
          .upsert(
            [
              {
                tenant_id: tenantId,
                occupancy_id: occupancy.id,
                contact_id: occupancy.contact_id,
                period_start: periodStartDate,
                period_end: periodEndDate,
                due_date: dueDate,
                amount_due: amountDue,
                amount_paid: 0,
                status: "due",
                metadata: {
                  generated_by: "automation",
                  job: "pg_monthly_dues"
                }
              }
            ],
            {
              onConflict: "tenant_id,occupancy_id,period_start",
              ignoreDuplicates: true
            }
          )
          .select("id");

        if (paymentError) {
          summary.errors.push(`Payment for ${occupancy.id}: ${paymentError.message}`);
          continue;
        }

        const paymentId = paymentRows?.[0]?.id ?? null;
        if (paymentId) {
          summary.dues_created += 1;
        } else {
          summary.dues_skipped += 1;
        }

        const contact = Array.isArray(occupancy.contacts)
          ? occupancy.contacts[0]
          : occupancy.contacts;
        const contactName =
          contact?.full_name || contact?.email || contact?.phone || "resident";
        const bodyTemplate =
          template?.body ??
          `Rent due for ${contactName} (${periodStartDate}) amount ${amountDue}.`;
        const subjectTemplate = template?.subject ?? null;
        const variables = {
          name: contactName,
          amount_due: amountDue.toFixed(2),
          due_date: dueDate,
          period_start: periodStartDate,
          period_end: periodEndDate
        };
        const body = renderTemplate(bodyTemplate, variables);
        const subject = subjectTemplate
          ? renderTemplate(subjectTemplate, variables)
          : null;

        const { data: outboxRows, error: outboxError } = await supabase
          .from("message_outbox")
          .upsert(
            [
              {
                tenant_id: tenantId,
                channel: "internal",
                status: "queued",
                scheduled_at: now.toISOString(),
                contact_id: occupancy.contact_id,
                to_phone: contact?.phone ?? null,
                to_email: contact?.email ?? null,
                template_key: template?.key ?? null,
                subject,
                body,
                related_table: "pg_payments",
                related_id: paymentId,
                idempotency_key: `pg_due:${occupancy.id}:${periodStartDate}`,
                meta: {
                  job: "pg_monthly_dues",
                  occupancy_id: occupancy.id,
                  period_start: periodStartDate
                }
              }
            ],
            {
              onConflict: "tenant_id,idempotency_key",
              ignoreDuplicates: true
            }
          )
          .select("id");

        if (outboxError) {
          summary.errors.push(`Outbox for ${occupancy.id}: ${outboxError.message}`);
          continue;
        }

        if (outboxRows?.length) {
          summary.outbox_created += 1;
        } else {
          summary.outbox_skipped += 1;
        }
      }

      await supabase
        .from("automation_rules")
        .update({ last_run_at: now.toISOString() })
        .eq("tenant_id", tenantId)
        .eq("job", "pg_monthly_dues");
    }

    await supabase
      .from("job_runs")
      .update({
        finished_at: new Date().toISOString(),
        status: "success",
        summary
      })
      .eq("job", "pg_monthly_dues")
      .eq("run_key", runKey);

    return new Response(JSON.stringify({ ok: true, run_key: runKey, summary }), {
      status: 200
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    await supabase
      .from("job_runs")
      .update({
        finished_at: new Date().toISOString(),
        status: "failed",
        summary: { error: message }
      })
      .eq("job", "pg_monthly_dues")
      .eq("run_key", runKey);

    return new Response(JSON.stringify({ ok: false, error: message }), {
      status: 500
    });
  }
});
