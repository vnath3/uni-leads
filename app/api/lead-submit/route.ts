import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

type LeadSubmitPayload = {
  slug?: string;
  identity_type?: string;
  identity_value?: string;
  contact?: Record<string, unknown>;
  form_payload?: Record<string, unknown>;
  source?: string;
  campaign?: string | null;
};

const getEnv = (key: string) => process.env[key] ?? "";

const getSupabaseUrl = () =>
  getEnv("SUPABASE_URL") || getEnv("NEXT_PUBLIC_SUPABASE_URL");

const getAnonKey = () =>
  getEnv("SUPABASE_ANON_KEY") || getEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");

export async function POST(req: Request) {
  let payload: LeadSubmitPayload | null = null;
  try {
    payload = (await req.json()) as LeadSubmitPayload;
  } catch (error) {
    payload = null;
  }

  const identityTypeRaw = payload?.identity_type ?? "slug";
  const identityType = identityTypeRaw.trim().toLowerCase();
  const identityValue = payload?.identity_value ?? payload?.slug;

  if (!identityValue) {
    return NextResponse.json(
      { error: "Missing tenant identity value." },
      { status: 400 }
    );
  }

  if (identityType !== "slug" && identityType !== "domain") {
    return NextResponse.json(
      { error: "Invalid identity_type. Use 'slug' or 'domain'." },
      { status: 400 }
    );
  }

  const supabaseUrl = getSupabaseUrl();
  const anonKey = getAnonKey();
  if (!supabaseUrl || !anonKey) {
    return NextResponse.json(
      { error: "Supabase configuration missing." },
      { status: 500 }
    );
  }

  const supabase = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false }
  });

  const safePayload = payload ?? {};
  const { data, error: submitError } = await supabase
    .schema("public")
    .rpc("submit_lead", {
      p_identity_type: identityType,
      p_identity_value: identityValue,
      p_contact: safePayload.contact ?? {},
      p_form_payload: safePayload.form_payload ?? {},
      p_source: safePayload.source ?? "landing",
      p_campaign: safePayload.campaign ?? null
    });

  if (submitError) {
    return NextResponse.json({ error: submitError.message }, { status: 400 });
  }

  const leadId =
    typeof data === "string" || typeof data === "number"
      ? data
      : (data as { lead_id?: string | number; id?: string | number } | null)
          ?.lead_id ??
        (data as { lead_id?: string | number; id?: string | number } | null)?.id;

  if (!leadId) {
    return NextResponse.json(
      { error: "Lead submission succeeded but no lead_id returned." },
      { status: 500 }
    );
  }

  const serviceKey = getEnv("SUPABASE_SERVICE_ROLE_KEY");
  if (!serviceKey) {
    console.error("Missing SUPABASE_SERVICE_ROLE_KEY for lead instant message.");
  } else {
    try {
      const response = await fetch(
        `${supabaseUrl}/functions/v1/run-lead-instant-message`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${serviceKey}`,
            apikey: serviceKey,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({ lead_id: String(leadId) })
        }
      );

      if (!response.ok) {
        const detail = await response.text();
        console.error(
          "Lead instant message failed",
          response.status,
          detail
        );
      } else {
        let responseJson: Record<string, unknown> | null = null;
        try {
          responseJson = (await response.json()) as Record<string, unknown>;
        } catch (parseError) {
          responseJson = null;
        }

        console.info("Lead instant message response", {
          lead_id: String(leadId),
          created_outbox: responseJson?.created_outbox ?? null,
          skipped_reason: responseJson?.skipped_reason ?? null,
          outbox_id: responseJson?.outbox_id ?? null
        });
      }
    } catch (error) {
      console.error("Lead instant message request error", error);
    }
  }

  return NextResponse.json({ lead_id: String(leadId) });
}
