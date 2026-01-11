import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

type LeadSubmitPayload = {
  slug?: string;
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

  if (!payload?.slug) {
    return NextResponse.json({ error: "Missing tenant slug." }, { status: 400 });
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

  const { data, error: submitError } = await supabase
    .schema("public")
    .rpc("submit_lead", {
      p_identity_type: "slug",
      p_identity_value: payload.slug,
      p_contact: payload.contact ?? {},
      p_form_payload: payload.form_payload ?? {},
      p_source: payload.source ?? "landing",
      p_campaign: payload.campaign ?? null
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
        console.info("Lead instant message enqueued", {
          lead_id: String(leadId)
        });
      }
    } catch (error) {
      console.error("Lead instant message request error", error);
    }
  }

  return NextResponse.json({ lead_id: String(leadId) });
}
