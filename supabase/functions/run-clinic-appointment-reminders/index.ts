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

type Template = {
  key: string | null;
  subject: string | null;
  body: string | null;
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

const asSummaryObject = (value: unknown) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {} as Record<string, unknown>;
  }
  return value as Record<string, unknown>;
};

serve(async (req) => {
  const supabase = getServiceClient();
  const now = new Date();
  const bucketStart = new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate(),
      now.getUTCHours(),
      0,
      0,
      0
    )
  );
  const bucketStartIso = bucketStart.toISOString();
  const runKey = `clinic_appt_reminders:${bucketStartIso}`;
  const url = new URL(req.url);
  const force = url.searchParams.get("force") === "1";
  const dry = url.searchParams.get("dry") === "1";
  const staleCutoff = new Date(now.getTime() - 30 * 60 * 1000);

  const { data: lockGranted, error: lockError } = await supabase.rpc(
    "try_job_lock",
    {
      p_job: "clinic_appt_reminders",
      p_run_key: runKey
    }
  );

  if (lockError) {
    return new Response(JSON.stringify({ ok: false, error: lockError.message }), {
      status: 500
    });
  }

  if (!lockGranted) {
    return new Response(
      JSON.stringify({
        ok: true,
        skipped: true,
        run_key: runKey,
        status: null,
        summary: {
          skipped_reason: "already_running",
          tenants_processed: 0,
          appointments_seen: 0,
          outbox_created: 0,
          outbox_conflict_existing: 0,
          errors: [],
          meta: { force, dry }
        }
      }),
      { status: 200 }
    );
  }

  let summaryMeta: Record<string, unknown> = {};
  if (!dry) {
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
        .select("status, started_at, summary")
        .eq("job", "clinic_appt_reminders")
        .eq("run_key", runKey)
        .maybeSingle();

      if (existingError) {
        return new Response(
          JSON.stringify({ ok: false, error: existingError.message }),
          { status: 500 }
        );
      }

      if (!existingRun) {
        return new Response(
          JSON.stringify({ ok: false, error: "Failed to load existing run state." }),
          { status: 500 }
        );
      }

      let existingSummary = asSummaryObject(existingRun.summary);
      if (existingRun.status === "running" && existingRun.started_at) {
        const startedAt = new Date(existingRun.started_at);
        if (startedAt.getTime() < staleCutoff.getTime()) {
          existingSummary = {
            ...existingSummary,
            note: "auto_recovered_stuck_run",
            auto_recovered_at: now.toISOString()
          };
          const { error: recoveryError } = await supabase
            .from("job_runs")
            .update({
              status: "failed",
              finished_at: now.toISOString(),
              summary: existingSummary
            })
            .eq("job", "clinic_appt_reminders")
            .eq("run_key", runKey);

          if (recoveryError) {
            return new Response(
              JSON.stringify({ ok: false, error: recoveryError.message }),
              { status: 500 }
            );
          }
          existingRun.status = "failed";
        }
      }

      if (existingRun.status === "success" && !force) {
        return new Response(
          JSON.stringify({
            ok: true,
            skipped: true,
            run_key: runKey,
            status: existingRun.status ?? "unknown",
            summary: {
              skipped_reason: "job_runs_success",
              tenants_processed: 0,
              appointments_seen: 0,
              outbox_created: 0,
              outbox_conflict_existing: 0,
              errors: [],
              meta: { force, dry }
            }
          }),
          { status: 200 }
        );
      }

      if (existingRun.status === "running" && !force) {
        return new Response(
          JSON.stringify({
            ok: true,
            skipped: true,
            run_key: runKey,
            status: existingRun.status ?? "unknown",
            summary: {
              skipped_reason: "job_runs_running",
              tenants_processed: 0,
              appointments_seen: 0,
              outbox_created: 0,
              outbox_conflict_existing: 0,
              errors: [],
              meta: { force, dry }
            }
          }),
          { status: 200 }
        );
      }

      if (force) {
        const rerunCount = Number(existingSummary.rerun_count ?? 0) + 1;
        existingSummary = {
          ...existingSummary,
          rerun_count: rerunCount,
          last_rerun_at: now.toISOString()
        };
      }

      if ("error" in existingSummary) {
        delete existingSummary.error;
      }
      if ("errors" in existingSummary) {
        delete existingSummary.errors;
      }

      summaryMeta = existingSummary;
      const { error: restartError } = await supabase
        .from("job_runs")
        .update({
          status: "running",
          started_at: now.toISOString(),
          finished_at: null,
          summary: summaryMeta
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
      return new Response(
        JSON.stringify({ ok: false, error: runInsertError.message }),
        { status: 500 }
      );
    }
  }

  const summary = {
    tenants_processed: 0,
    appointments_seen: 0,
    outbox_created: 0,
    outbox_conflict_existing: 0,
    errors: [] as string[],
    skipped_reason: null as string | null
  };

  try {
    const templateCache = new Map<string, Template>();
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
      const windowHoursRaw = Number(
        (config as { window_hours?: number }).window_hours ?? 24
      );
      const windowHours = Number.isFinite(windowHoursRaw)
        ? clampNumber(windowHoursRaw, 1, 72)
        : 24;
      const windowEnd = new Date(now.getTime() + windowHours * 60 * 60 * 1000);

      let template = templateCache.get(tenantId);
      if (!template) {
        const { data: templateRow, error: templateError } = await supabase
          .from("message_templates")
          .select("key, subject, body")
          .eq("tenant_id", tenantId)
          .eq("key", "clinic_appt_reminder")
          .eq("channel", "internal")
          .eq("is_active", true)
          .is("deleted_at", null)
          .maybeSingle();

        if (templateError) {
          summary.errors.push(
            `Template for ${tenantId}: ${templateError.message}`
          );
          template = { key: null, subject: null, body: null };
        } else {
          template = {
            key: templateRow?.key ?? null,
            subject: templateRow?.subject ?? null,
            body: templateRow?.body ?? null
          };
        }
        templateCache.set(tenantId, template);
      }

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
        .lt("scheduled_at", windowEnd.toISOString())
        .order("scheduled_at", { ascending: true });

      if (apptError) {
        summary.errors.push(`Appointments for ${tenantId}: ${apptError.message}`);
        continue;
      }

      const appointmentList = (appointments as Appointment[]) ?? [];
      summary.appointments_seen += appointmentList.length;

      let existingOutbox = new Set<string>();
      if (dry && appointmentList.length) {
        const outboxKeys = appointmentList.map(
          (appointment) => `clinic_reminder:${appointment.id}:${bucketStartIso}`
        );

        const { data: outboxRows, error: outboxCheckError } = await supabase
          .from("message_outbox")
          .select("id, idempotency_key")
          .eq("tenant_id", tenantId)
          .is("deleted_at", null)
          .in("idempotency_key", outboxKeys);

        if (outboxCheckError) {
          summary.errors.push(
            `Outbox check for ${tenantId}: ${outboxCheckError.message}`
          );
        } else {
          existingOutbox = new Set((outboxRows ?? []).map((row) => row.idempotency_key));
        }
      }

      for (const appointment of appointmentList) {
        const contact = Array.isArray(appointment.contacts)
          ? appointment.contacts[0]
          : appointment.contacts;
        const contactName =
          contact?.full_name || contact?.email || contact?.phone || "Unknown";
        const variables = {
          name: contactName,
          scheduled_at: appointment.scheduled_at,
          status: appointment.status
        };
        const bodyTemplate =
          template?.body ??
          `Reminder: ${variables.name} has an appointment on ${variables.scheduled_at}. Status: ${variables.status}.`;
        const subjectTemplate = template?.subject ?? null;
        const body = renderTemplate(bodyTemplate, variables);
        const subject = subjectTemplate
          ? renderTemplate(subjectTemplate, variables)
          : null;
        const idempotencyKey = `clinic_reminder:${appointment.id}:${bucketStartIso}`;

        if (dry) {
          const outboxExists = existingOutbox.has(idempotencyKey);
          if (!outboxExists) {
            summary.outbox_created += 1;
          } else {
            summary.outbox_conflict_existing += 1;
          }
          continue;
        }

        const outboxPayload = {
          tenant_id: tenantId,
          channel: "internal",
          status: "queued",
          scheduled_at: now.toISOString(),
          contact_id: appointment.contact_id,
          to_phone: contact?.phone ?? null,
          to_email: contact?.email ?? null,
          template_key: template?.key ?? null,
          subject,
          body,
          related_table: "clinic_appointments",
          related_id: appointment.id,
          idempotency_key: idempotencyKey,
          meta: {
            job: "clinic_appt_reminders",
            bucket_start: bucketStartIso
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
          summary.outbox_conflict_existing += 1;
        } else if (outboxRows?.length) {
          summary.outbox_created += 1;
        } else {
          summary.outbox_conflict_existing += 1;
        }
      }

      if (!dry) {
        await supabase
          .from("automation_rules")
          .update({ last_run_at: now.toISOString() })
          .eq("tenant_id", tenantId)
          .eq("job", "clinic_appt_reminders");
      }
    }

    const meta = {
      ...(typeof summaryMeta.meta === "object" && summaryMeta.meta !== null
        ? (summaryMeta.meta as Record<string, unknown>)
        : {}),
      force,
      dry
    };
    const finalSummary = {
      ...summaryMeta,
      ...summary,
      meta
    };

    if (dry) {
      return new Response(
        JSON.stringify({
          ok: true,
          skipped: false,
          run_key: runKey,
          status: null,
          summary: finalSummary
        }),
        { status: 200 }
      );
    }

    await supabase
      .from("job_runs")
      .update({
        finished_at: new Date().toISOString(),
        status: "success",
        summary: finalSummary
      })
      .eq("job", "clinic_appt_reminders")
      .eq("run_key", runKey);

    return new Response(
      JSON.stringify({
        ok: true,
        skipped: false,
        run_key: runKey,
        status: "success",
        summary: finalSummary
      }),
      { status: 200 }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    if (!dry) {
      await supabase
        .from("job_runs")
        .update({
          finished_at: new Date().toISOString(),
          status: "failed",
          summary: { ...summaryMeta, error: message }
        })
        .eq("job", "clinic_appt_reminders")
        .eq("run_key", runKey);
    }

    return new Response(JSON.stringify({ ok: false, error: message, status: "failed" }), {
      status: 500
    });
  }
});
