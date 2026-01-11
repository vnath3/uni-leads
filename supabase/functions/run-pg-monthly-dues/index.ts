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

const asSummaryObject = (value: unknown) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {} as Record<string, unknown>;
  }
  return value as Record<string, unknown>;
};

serve(async (req) => {
  const supabase = getServiceClient();
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();
  const periodStart = new Date(Date.UTC(year, month, 1));
  const periodEnd = new Date(Date.UTC(year, month + 1, 0));
  const periodStartDate = toDateString(periodStart);
  const periodEndDate = toDateString(periodEnd);
  const runKey = `pg_monthly_dues:${periodStartDate}`;
  const url = new URL(req.url);
  const forceRun = url.searchParams.get("force") === "1";
  const dryRun = url.searchParams.get("dry") === "1";
  const staleCutoff = new Date(now.getTime() - 30 * 60 * 1000);

  const { data: lockGranted, error: lockError } = await supabase.rpc(
    "try_job_lock",
    {
      p_job: "pg_monthly_dues",
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
      JSON.stringify({ ok: true, skipped: "already_running", run_key: runKey }),
      { status: 200 }
    );
  }

  let summaryMeta: Record<string, unknown> = {};
  if (!dryRun) {
    const { error: runInsertError } = await supabase.from("job_runs").insert({
      job: "pg_monthly_dues",
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
        .eq("job", "pg_monthly_dues")
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
            .eq("job", "pg_monthly_dues")
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

      if (!forceRun && existingRun.status !== "failed") {
        return new Response(
          JSON.stringify({
            ok: true,
            skipped: true,
            run_key: runKey,
            status: existingRun.status ?? "unknown"
          }),
          { status: 200 }
        );
      }

      if (forceRun) {
        const rerunCount = Number(existingSummary.rerun_count ?? 0) + 1;
        existingSummary = {
          ...existingSummary,
          rerun_count: rerunCount,
          last_rerun_at: now.toISOString()
        };
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
        .eq("job", "pg_monthly_dues")
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
    dues_created: 0,
    dues_skipped: 0,
    outbox_created: 0,
    outbox_skipped: 0,
    errors: [] as string[]
  };

  try {
    const dryPreview: Array<Record<string, unknown>> = [];
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

      const occupancyList = (occupancies as Occupancy[]) ?? [];
      const candidates = occupancyList.filter((occupancy) => {
        const amountDue = Number(occupancy.monthly_rent ?? 0);
        return amountDue > 0;
      });

      let existingPayments = new Map<string, string>();
      let existingOutbox = new Set<string>();
      if (dryRun && candidates.length) {
        const occupancyIds = candidates.map((occupancy) => occupancy.id);
        const outboxKeys = candidates.map(
          (occupancy) => `pg_due:${occupancy.id}:${periodStartDate}`
        );

        const { data: paymentRows, error: paymentCheckError } = await supabase
          .from("pg_payments")
          .select("id, occupancy_id")
          .eq("tenant_id", tenantId)
          .eq("period_start", periodStartDate)
          .is("deleted_at", null)
          .in("occupancy_id", occupancyIds);

        if (paymentCheckError) {
          summary.errors.push(
            `Payment check for ${tenantId}: ${paymentCheckError.message}`
          );
        } else {
          existingPayments = new Map(
            (paymentRows ?? []).map((row) => [row.occupancy_id, row.id])
          );
        }

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

      for (const occupancy of occupancyList) {
        const amountDue = Number(occupancy.monthly_rent ?? 0);
        if (!amountDue || amountDue <= 0) {
          summary.dues_skipped += 1;
          continue;
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

        const idempotencyKey = `pg_due:${occupancy.id}:${periodStartDate}`;

        if (dryRun) {
          const paymentExists = existingPayments.has(occupancy.id);
          const outboxExists = existingOutbox.has(idempotencyKey);
          if (!paymentExists) {
            summary.dues_created += 1;
          } else {
            summary.dues_skipped += 1;
          }
          if (!outboxExists) {
            summary.outbox_created += 1;
          } else {
            summary.outbox_skipped += 1;
          }
          if (dryPreview.length < 25) {
            dryPreview.push({
              tenant_id: tenantId,
              occupancy_id: occupancy.id,
              amount_due: amountDue,
              due_date: dueDate,
              payment_exists: paymentExists,
              outbox_exists: outboxExists
            });
          }
          continue;
        }

        const { data: resultRows, error: resultError } = await supabase.rpc(
          "create_pg_due_and_outbox",
          {
            p_tenant_id: tenantId,
            p_occupancy_id: occupancy.id,
            p_contact_id: occupancy.contact_id,
            p_period_start: periodStartDate,
            p_period_end: periodEndDate,
            p_due_date: dueDate,
            p_amount_due: amountDue,
            p_amount_paid: 0,
            p_status: "due",
            p_payment_meta: {
              generated_by: "automation",
              job: "pg_monthly_dues"
            },
            p_scheduled_at: now.toISOString(),
            p_template_key: template?.key ?? null,
            p_subject: subject,
            p_body: body,
            p_to_phone: contact?.phone ?? null,
            p_to_email: contact?.email ?? null,
            p_outbox_idempotency_key: idempotencyKey,
            p_outbox_meta: {
              job: "pg_monthly_dues",
              occupancy_id: occupancy.id,
              period_start: periodStartDate
            }
          }
        );

        if (resultError) {
          summary.errors.push(`Payment for ${occupancy.id}: ${resultError.message}`);
          continue;
        }

        const result = Array.isArray(resultRows) ? resultRows[0] : resultRows;
        if (!result?.payment_id) {
          summary.errors.push(`Payment for ${occupancy.id}: missing payment id`);
          continue;
        }

        if (result.payment_created) {
          summary.dues_created += 1;
        } else {
          summary.dues_skipped += 1;
        }

        if (result.outbox_created) {
          summary.outbox_created += 1;
        } else {
          summary.outbox_skipped += 1;
        }
      }

      if (!dryRun) {
        await supabase
          .from("automation_rules")
          .update({ last_run_at: now.toISOString() })
          .eq("tenant_id", tenantId)
          .eq("job", "pg_monthly_dues");
      }
    }

    const finalSummary = {
      ...summaryMeta,
      ...summary,
      ...(dryRun ? { dry_run: true, preview: dryPreview } : {})
    };

    if (!dryRun) {
      await supabase
        .from("job_runs")
        .update({
          finished_at: new Date().toISOString(),
          status: "success",
          summary: finalSummary
        })
        .eq("job", "pg_monthly_dues")
        .eq("run_key", runKey);
    }

    return new Response(JSON.stringify({ ok: true, run_key: runKey, summary: finalSummary }), {
      status: 200
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    if (!dryRun) {
      await supabase
        .from("job_runs")
        .update({
          finished_at: new Date().toISOString(),
          status: "failed",
          summary: { ...summaryMeta, error: message }
        })
        .eq("job", "pg_monthly_dues")
        .eq("run_key", runKey);
    }

    return new Response(JSON.stringify({ ok: false, error: message }), {
      status: 500
    });
  }
});
