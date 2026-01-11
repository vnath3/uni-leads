import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.2";

type AutomationRule = {
  tenant_id: string;
  config: Record<string, unknown> | null;
};

type Appointment = {
  id: string;
  contact_id: string | null;
  scheduled_at: string;
  status: string;
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

const renderTemplate = (template: string, data: Record<string, string>) => {
  let result = template;
  for (const [key, value] of Object.entries(data)) {
    result = result.replaceAll(`{{${key}}}`, value);
  }
  return result;
};

serve(async (req) => {
  const supabase = getServiceClient();
  const now = new Date();
  const bucketStart = new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate(),
      now.getUTCHours()
    )
  );
  const bucketKey = bucketStart.toISOString().slice(0, 13);
  const runKey = `clinic_appt_reminders:${bucketKey}`;
  const url = new URL(req.url);
  const forceRun = url.searchParams.get("force") === "1";

  const { error: runInsertError } = await supabase.from("job_runs").insert({
    job: "clinic_appt_reminders",
    run_key: runKey,
    status: "running"
  });

  const hasConflict =
    runInsertError?.code === "23505" ||
    (runInsertError?.message &&
      runInsertError.message.toLowerCase().includes("duplicate key value"));

  if (hasConflict) {
    const { data: existingRun, error: existingError } = await supabase
      .from("job_runs")
      .select("status")
      .eq("job", "clinic_appt_reminders")
      .eq("run_key", runKey)
      .maybeSingle();

    if (existingError) {
      return new Response(
        JSON.stringify({ ok: false, error: existingError.message }),
        { status: 500 }
      );
    }

    if (!forceRun && existingRun?.status !== "failed") {
      return new Response(
        JSON.stringify({
          ok: true,
          skipped: true,
          run_key: runKey,
          status: existingRun?.status ?? "unknown"
        }),
        { status: 200 }
      );
    }

    const { error: restartError } = await supabase
      .from("job_runs")
      .update({
        status: "running",
        started_at: now.toISOString(),
        finished_at: null,
        summary: {}
      })
      .eq("job", "clinic_appt_reminders")
      .eq("run_key", runKey);

    if (restartError) {
      return new Response(
        JSON.stringify({ ok: false, error: restartError.message }),
        { status: 500 }
      );
    }
  } else if (runInsertError) {
    return new Response(JSON.stringify({ ok: false, error: runInsertError.message }), {
      status: 500
    });
  }

  const summary = {
    tenants_processed: 0,
    reminders_created: 0,
    reminders_skipped: 0,
    errors: [] as string[]
  };

  try {
    const { data: rules, error: rulesError } = await supabase
      .from("automation_rules")
      .select("tenant_id, config")
      .eq("job", "clinic_appt_reminders")
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
        .eq("feature_key", "clinic.appointments")
        .maybeSingle();

      if (!featureRow?.enabled) {
        continue;
      }

      const config = rule.config ?? {};
      const windowHoursRaw = Number((config as { window_hours?: number }).window_hours ?? 24);
      const windowHours = Number.isFinite(windowHoursRaw)
        ? clampNumber(windowHoursRaw, 1, 72)
        : 24;
      const leadTimeRaw = Number((config as { lead_time_hours?: number }).lead_time_hours ?? 24);
      const leadTimeHours = Number.isFinite(leadTimeRaw)
        ? clampNumber(leadTimeRaw, 1, 168)
        : 24;

      const windowEnd = new Date(now.getTime() + windowHours * 60 * 60 * 1000);

      const { data: template } = await supabase
        .from("message_templates")
        .select("key, subject, body")
        .eq("tenant_id", tenantId)
        .eq("key", "clinic_appt_reminder")
        .eq("channel", "internal")
        .eq("is_active", true)
        .is("deleted_at", null)
        .maybeSingle();

      const { data: appointments, error: apptError } = await supabase
        .from("clinic_appointments")
        .select(
          `id,
           contact_id,
           scheduled_at,
           status,
           contacts:contact_id (full_name, phone, email)`
        )
        .eq("tenant_id", tenantId)
        .in("status", ["scheduled", "confirmed"])
        .is("deleted_at", null)
        .gte("scheduled_at", now.toISOString())
        .lte("scheduled_at", windowEnd.toISOString())
        .order("scheduled_at", { ascending: true });

      if (apptError) {
        summary.errors.push(`Appointments for ${tenantId}: ${apptError.message}`);
        continue;
      }

      for (const appointment of (appointments as Appointment[]) ?? []) {
        const scheduledAt = new Date(appointment.scheduled_at);
        const contact = Array.isArray(appointment.contacts)
          ? appointment.contacts[0]
          : appointment.contacts;
        const contactName =
          contact?.full_name || contact?.email || contact?.phone || "client";

        const variables = {
          name: contactName,
          scheduled_at: scheduledAt.toISOString(),
          appointment_id: appointment.id
        };

        const bodyTemplate =
          template?.body ??
          `Reminder: appointment scheduled at ${variables.scheduled_at} for ${contactName}.`;
        const subjectTemplate = template?.subject ?? null;
        const body = renderTemplate(bodyTemplate, variables);
        const subject = subjectTemplate
          ? renderTemplate(subjectTemplate, variables)
          : null;

        const sendAt = new Date(
          scheduledAt.getTime() - leadTimeHours * 60 * 60 * 1000
        );
        const scheduledAtValue = sendAt.getTime() < now.getTime() ? now : sendAt;

        const outboxPayload = {
          tenant_id: tenantId,
          channel: "internal",
          status: "queued",
          scheduled_at: scheduledAtValue.toISOString(),
          contact_id: appointment.contact_id,
          to_phone: contact?.phone ?? null,
          to_email: contact?.email ?? null,
          template_key: template?.key ?? null,
          subject,
          body,
          related_table: "clinic_appointments",
          related_id: appointment.id,
          idempotency_key: `clinic_reminder:${appointment.id}:${bucketKey}`,
          meta: {
            job: "clinic_appt_reminders",
            scheduled_at: appointment.scheduled_at,
            bucket: bucketKey
          }
        };

        const { data: outboxRows, error: outboxError } = await supabase
          .from("message_outbox")
          .insert([outboxPayload])
          .select("id");

        if (outboxError) {
          const isDuplicate =
            outboxError.code === "23505" ||
            outboxError.message?.toLowerCase().includes("duplicate key value");
          if (!isDuplicate) {
            summary.errors.push(`Outbox for ${appointment.id}: ${outboxError.message}`);
            continue;
          }
          summary.reminders_skipped += 1;
        } else if (outboxRows?.length) {
          summary.reminders_created += 1;
        } else {
          summary.reminders_skipped += 1;
        }
      }

      await supabase
        .from("automation_rules")
        .update({ last_run_at: now.toISOString() })
        .eq("tenant_id", tenantId)
        .eq("job", "clinic_appt_reminders");
    }

    await supabase
      .from("job_runs")
      .update({
        finished_at: new Date().toISOString(),
        status: "success",
        summary
      })
      .eq("job", "clinic_appt_reminders")
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
      .eq("job", "clinic_appt_reminders")
      .eq("run_key", runKey);

    return new Response(JSON.stringify({ ok: false, error: message }), {
      status: 500
    });
  }
});
