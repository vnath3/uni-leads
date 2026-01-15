import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.2";

type LeadRow = {
  id: string;
  tenant_id: string;
  contact_id: string | null;
  source: string | null;
  campaign: string | null;
};

type ContactRow = {
  full_name?: string | null;
  phone?: string | null;
  email?: string | null;
};

type TemplateRow = {
  key: string | null;
  subject: string | null;
  body: string | null;
};

type LandingSettingsRow = {
  contact_phone?: string | null;
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

const renderTemplate = (template: string, data: Record<string, string>) => {
  let result = template;
  for (const [key, value] of Object.entries(data)) {
    result = result.replaceAll(`{{${key}}}`, value);
  }
  return result;
};

const fallbackTemplate =
  "Hi {{full_name}}, thanks for your enquiry! We'll contact you shortly. If you want a quick reply, reply with your preferred time.";

serve(async (req) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ ok: false, error: "Method not allowed" }), {
      status: 405
    });
  }

  let payload: { lead_id?: string; force?: boolean } | null = null;
  try {
    payload = (await req.json()) as { lead_id?: string; force?: boolean };
  } catch (error) {
    payload = null;
  }

  const leadId = payload?.lead_id?.toString();
  const force = payload?.force === true;

  if (!leadId) {
    return new Response(JSON.stringify({ ok: false, error: "lead_id is required" }), {
      status: 400
    });
  }

  const supabase = getServiceClient();
  const nowIso = new Date().toISOString();

  const { data: lead, error: leadError } = await supabase
    .from("leads")
    .select("id, tenant_id, contact_id, source, campaign")
    .eq("id", leadId)
    .maybeSingle();

  if (leadError) {
    return new Response(JSON.stringify({ ok: false, error: leadError.message }), {
      status: 500
    });
  }

  if (!lead) {
    return new Response(JSON.stringify({ ok: false, error: "Lead not found" }), {
      status: 404
    });
  }

  const tenantId = (lead as LeadRow).tenant_id;
  const contactId = (lead as LeadRow).contact_id;

  if (!tenantId || !contactId) {
    return new Response(
      JSON.stringify({
        ok: true,
        created_outbox: false,
        skipped_reason: "missing_contact"
      }),
      { status: 200 }
    );
  }

  const { data: contact, error: contactError } = await supabase
    .from("contacts")
    .select("full_name, phone, email")
    .eq("tenant_id", tenantId)
    .eq("id", contactId)
    .maybeSingle();

  if (contactError) {
    return new Response(JSON.stringify({ ok: false, error: contactError.message }), {
      status: 500
    });
  }

  if (!contact) {
    return new Response(
      JSON.stringify({
        ok: true,
        created_outbox: false,
        skipped_reason: "missing_contact"
      }),
      { status: 200 }
    );
  }

  const contactRow = contact as ContactRow;
  const phone = contactRow.phone ?? null;

  if (!phone) {
    return new Response(
      JSON.stringify({
        ok: true,
        created_outbox: false,
        skipped_reason: "missing_phone"
      }),
      { status: 200 }
    );
  }

  const { data: tenantRow, error: tenantError } = await supabase
    .from("tenants")
    .select("name")
    .eq("id", tenantId)
    .maybeSingle();

  if (tenantError) {
    return new Response(JSON.stringify({ ok: false, error: tenantError.message }), {
      status: 500
    });
  }

  const { data: landingRow, error: landingError } = await supabase
    .from("landing_settings")
    .select("contact_phone")
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (landingError) {
    return new Response(JSON.stringify({ ok: false, error: landingError.message }), {
      status: 500
    });
  }

  const tenantName = tenantRow?.name ?? null;
  const tenantPhone = (landingRow as LandingSettingsRow | null)?.contact_phone ?? null;

  const contactName = contactRow.full_name || contactRow.email || "there";

  const { data: templateRow, error: templateError } = await supabase
    .from("message_templates")
    .select("key, subject, body")
    .eq("tenant_id", tenantId)
    .eq("key", "lead_instant_ack")
    .eq("channel", "whatsapp")
    .eq("is_active", true)
    .is("deleted_at", null)
    .maybeSingle();

  if (templateError) {
    return new Response(JSON.stringify({ ok: false, error: templateError.message }), {
      status: 500
    });
  }

  const leadRow = lead as LeadRow;
  const variables = {
    full_name: String(contactName ?? ""),
    tenant_name: String(tenantName ?? ""),
    source: String(leadRow.source ?? ""),
    campaign: String(leadRow.campaign ?? "")
  };

  const bodyTemplate = (templateRow as TemplateRow | null)?.body ?? fallbackTemplate;
  const subjectTemplate = (templateRow as TemplateRow | null)?.subject ?? null;
  const body = renderTemplate(bodyTemplate, variables);
  const subject = subjectTemplate ? renderTemplate(subjectTemplate, variables) : null;
  const idempotencyKey = `lead_instant:${leadId}`;

  const { data: existingOutbox, error: existingError } = await supabase
    .from("message_outbox")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("idempotency_key", idempotencyKey)
    .is("deleted_at", null)
    .maybeSingle();

  if (existingError) {
    return new Response(JSON.stringify({ ok: false, error: existingError.message }), {
      status: 500
    });
  }

  if (existingOutbox && !force) {
    return new Response(
      JSON.stringify({
        ok: true,
        created_outbox: false,
        outbox_id: existingOutbox.id,
        skipped_reason: "already_exists"
      }),
      { status: 200 }
    );
  }

  if (existingOutbox && force) {
    const { error: deleteError } = await supabase
      .from("message_outbox")
      .update({ deleted_at: nowIso, updated_at: nowIso })
      .eq("tenant_id", tenantId)
      .eq("id", existingOutbox.id);

    if (deleteError) {
      return new Response(
        JSON.stringify({ ok: false, error: deleteError.message }),
        { status: 500 }
      );
    }
  }

  const outboxPayload = {
    tenant_id: tenantId,
    channel: "whatsapp",
    status: "queued",
    scheduled_at: nowIso,
    contact_id: contactId,
    to_phone: phone,
    to_email: contactRow.email ?? null,
    template_key: templateRow?.key ?? "lead_instant_ack",
    subject,
    body,
    related_table: "leads",
    related_id: leadId,
    idempotency_key: idempotencyKey,
    meta: {
      job: "lead_instant_message",
      source: "lead_capture",
      template_key: templateRow?.key ?? "lead_instant_ack",
      tenant_name: tenantName,
      tenant_phone: tenantPhone
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
    if (isDuplicate) {
      return new Response(
        JSON.stringify({
          ok: true,
          created_outbox: false,
          skipped_reason: "already_exists"
        }),
        { status: 200 }
      );
    }

    return new Response(JSON.stringify({ ok: false, error: outboxError.message }), {
      status: 500
    });
  }

  const outboxId = outboxRows?.[0]?.id ?? null;

  const webhookUrl = Deno.env.get("MAKE_OUTBOX_WEBHOOK_URL");
  const webhookSecret = Deno.env.get("MAKE_OUTBOX_WEBHOOK_SECRET");
  let webhookSent = false;
  let webhookError: string | null = null;

  if (webhookUrl && webhookSecret && outboxId) {
    try {
      const webhookResponse = await fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          secret: webhookSecret,
          outbox_ids: [outboxId]
        })
      });

      if (!webhookResponse.ok) {
        webhookError = `Webhook failed (${webhookResponse.status})`;
      } else {
        webhookSent = true;
      }
    } catch (error) {
      webhookError = "Webhook request failed";
    }
  } else {
    webhookError = "Webhook env not configured";
  }

  return new Response(
    JSON.stringify({
      ok: true,
      created_outbox: true,
      outbox_id: outboxId,
      skipped_reason: null,
      webhook_sent: webhookSent,
      webhook_error: webhookError
    }),
    { status: 200 }
  );
});
