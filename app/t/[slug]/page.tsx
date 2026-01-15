"use client";

import { FormEvent, useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

type LeadFormField = {
  key: string;
  label: string;
  type: "text" | "tel" | "email" | "select" | "month" | "date" | "textarea" | "number";
  required?: boolean;
  options?: string[];
};

type LeadFormSchema = {
  fields?: LeadFormField[];
  trust_points?: string[];
};

type LandingSettings = {
  tenant_id?: string;
  name?: string;
  brand_name?: string;
  tagline?: string;
  logo_url?: string;
  primary_color?: string;
  contact_email?: string;
  contact_phone?: string;
  address?: string;
  campaign?: string;
  lead_campaign?: string;
  default_campaign?: string;
  lead_form_schema?: LeadFormSchema | null;
};

const defaultFields: LeadFormField[] = [
  { key: "full_name", label: "Full Name", type: "text", required: true },
  { key: "phone", label: "Phone", type: "tel", required: true },
  {
    key: "student_type",
    label: "Student Type",
    type: "select",
    options: ["JEE", "NEET", "Other"]
  },
  { key: "move_in_month", label: "Move-in month", type: "month" }
];

const emailField: LeadFormField = {
  key: "email",
  label: "Email",
  type: "email"
};

const defaultTrustPoints = [
  "Walking distance to JEE/NEET classes",
  "Homely food + safe environment",
  "Limited beds (10 total)"
];

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;

const normalizeLeadSchema = (value: unknown) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { fields: [], trustPoints: [] };
  }

  const rawFields = Array.isArray((value as LeadFormSchema).fields)
    ? (value as LeadFormSchema).fields
    : [];

  const fields = rawFields
    .map((field) => {
      if (!field || typeof field !== "object") return null;
      const key = isNonEmptyString(field.key) ? field.key.trim() : "";
      const label = isNonEmptyString(field.label) ? field.label.trim() : "";
      if (!key || !label) return null;

      const typeRaw = isNonEmptyString(field.type) ? field.type.toLowerCase() : "text";
      const allowedTypes = [
        "text",
        "tel",
        "email",
        "select",
        "month",
        "date",
        "textarea",
        "number"
      ];
      const type = allowedTypes.includes(typeRaw) ? typeRaw : "text";
      const required = Boolean(field.required);
      const options = Array.isArray(field.options)
        ? field.options.filter(isNonEmptyString)
        : [];
      const finalType = type === "select" && options.length === 0 ? "text" : type;

      return {
        key,
        label,
        type: finalType as LeadFormField["type"],
        required,
        options: finalType === "select" ? options : undefined
      };
    })
    .filter((field): field is LeadFormField => Boolean(field));

  const trustPoints = Array.isArray((value as LeadFormSchema).trust_points)
    ? (value as LeadFormSchema).trust_points.filter(isNonEmptyString)
    : [];

  return { fields, trustPoints };
};

const resolveCampaign = (settings: LandingSettings | null) => {
  const campaign =
    settings?.campaign || settings?.lead_campaign || settings?.default_campaign;
  return campaign && campaign.trim().length > 0 ? campaign : "demo";
};

export default function TenantLandingPage({
  params
}: {
  params: { slug: string };
}) {
  const [settings, setSettings] = useState<LandingSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successId, setSuccessId] = useState<string | null>(null);
  const [showEmail, setShowEmail] = useState(false);
  const [copyMessage, setCopyMessage] = useState<string | null>(null);
  const [formState, setFormState] = useState<Record<string, string>>({});

  const isLoading = loading || !settings;

  useEffect(() => {
    let active = true;

    const loadSettings = async () => {
      setLoading(true);
      setError(null);

      const { data, error: rpcError } = await supabase
        .schema("public")
        .rpc("get_landing_settings", {
          p_identity_type: "slug",
          p_identity_value: params.slug
        });

      if (!active) return;

      if (rpcError) {
        setError(rpcError.message);
        setLoading(false);
        return;
      }

      if (!data) {
        setError("Tenant not found.");
        setLoading(false);
        return;
      }

      setSettings(data as LandingSettings);
      setLoading(false);
    };

    loadSettings();

    return () => {
      active = false;
    };
  }, [params.slug]);

  const schema = normalizeLeadSchema(settings?.lead_form_schema);
  const hasCustomFields = schema.fields.length > 0;
  const baseFields = hasCustomFields ? schema.fields : defaultFields;
  const submitFields = hasCustomFields
    ? baseFields
    : showEmail
      ? [...baseFields, emailField]
      : baseFields;
  const trustPoints = schema.trustPoints.length > 0 ? schema.trustPoints : defaultTrustPoints;

  useEffect(() => {
    setFormState((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const field of submitFields) {
        if (next[field.key] === undefined) {
          next[field.key] = "";
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [submitFields]);

  const contactPhone = settings?.contact_phone ?? "";
  const cleanPhone = contactPhone.replace(/\D/g, "");
  const whatsappLink = cleanPhone ? `https://wa.me/${cleanPhone}` : null;
  const callLink = contactPhone ? `tel:${contactPhone}` : null;
  const shareLink =
    typeof window !== "undefined"
      ? `${window.location.origin}/t/${params.slug}`
      : "";
  const tenantName = settings?.brand_name ?? settings?.name ?? params.slug;
  const promiseLine =
    settings?.tagline ??
    "For JEE/NEET students who want a safe, calm stay near coaching.";
  const whatsappText = `Hi, I just submitted an enquiry on ${tenantName}.`;
  const whatsappPrefill =
    whatsappLink && whatsappText
      ? `${whatsappLink}?text=${encodeURIComponent(whatsappText)}`
      : whatsappLink;

  const updateField = (key: string, value: string) => {
    setFormState((prev) => ({
      ...prev,
      [key]: value
    }));
  };

  const renderField = (field: LeadFormField) => {
    const value = formState[field.key] ?? "";
    const label = field.required && !field.label.trim().endsWith("*")
      ? `${field.label}*`
      : field.label;

    if (field.type === "select") {
      return (
        <label className="field" key={field.key}>
          <span>{label}</span>
          <select
            value={value}
            required={field.required}
            onChange={(event) => updateField(field.key, event.target.value)}
          >
            <option value="">Select</option>
            {(field.options ?? []).map((option) => (
              <option key={`${field.key}-${option}`} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>
      );
    }

    if (field.type === "textarea") {
      return (
        <label className="field" key={field.key}>
          <span>{label}</span>
          <textarea
            rows={3}
            value={value}
            required={field.required}
            onChange={(event) => updateField(field.key, event.target.value)}
          />
        </label>
      );
    }

    return (
      <label className="field" key={field.key}>
        <span>{label}</span>
        <input
          type={field.type}
          value={value}
          required={field.required}
          onChange={(event) => updateField(field.key, event.target.value)}
        />
      </label>
    );
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setSuccessId(null);
    setSubmitting(true);

    const payload: Record<string, unknown> = {};
    for (const field of submitFields) {
      const rawValue = formState[field.key] ?? "";
      const trimmed = rawValue.trim();
      payload[field.key] = trimmed.length > 0 ? trimmed : null;
    }
    const contact: Record<string, unknown> = { ...payload };

    const response = await fetch("/api/lead-submit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        slug: params.slug,
        contact,
        form_payload: payload,
        source: "landing",
        campaign: resolveCampaign(settings)
      })
    });

    const responseBody = (await response.json()) as {
      lead_id?: string;
      error?: string;
    };

    if (!response.ok || responseBody.error) {
      const message = responseBody.error?.toLowerCase() ?? "Submission failed.";
      if (message.includes("tenant inactive")) {
        setError("This business is currently unavailable.");
      } else if (message.includes("rate limit")) {
        setError("Too many submissions. Please try again shortly.");
      } else {
        setError(responseBody.error ?? "Submission failed.");
      }
      setSubmitting(false);
      return;
    }

    const leadIdValue = responseBody.lead_id;

    setSuccessId(leadIdValue ? String(leadIdValue) : "submitted");
    setSubmitting(false);
    const clearedState: Record<string, string> = {};
    for (const field of submitFields) {
      clearedState[field.key] = "";
    }
    setFormState(clearedState);
    setShowEmail(false);
  };

  const handleCopyLink = async () => {
    if (!shareLink) return;
    try {
      await navigator.clipboard.writeText(shareLink);
      setCopyMessage("Link copied");
      setTimeout(() => setCopyMessage(null), 2000);
    } catch (copyError) {
      setCopyMessage("Copy failed");
      setTimeout(() => setCopyMessage(null), 2000);
    }
  };

  if (isLoading) {
    return (
      <div className="card">
        <h1>Loading landing...</h1>
        <p className="muted">Fetching tenant details.</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="card">
        <h1>Landing unavailable</h1>
        <div className="error">{error}</div>
      </div>
    );
  }

  return (
    <div className="landing">
      <div className="card landing-hero">
        <div>
          {settings?.logo_url && (
            <img
              src={settings.logo_url}
              alt={tenantName}
              className="landing-logo"
            />
          )}
          <h1>{tenantName}</h1>
          <p className="muted landing-promise">{promiseLine}</p>
        </div>
        <div className="cta-row">
          <a
            className={`button ${whatsappLink ? "" : "disabled"}`}
            href={whatsappLink ?? "#"}
            target="_blank"
            rel="noreferrer"
            aria-disabled={!whatsappLink}
          >
            WhatsApp Now
          </a>
          <a
            className={`button secondary ${callLink ? "" : "disabled"}`}
            href={callLink ?? "#"}
            aria-disabled={!callLink}
          >
            Call Now
          </a>
        </div>
        <div className="landing-trust">
          {trustPoints.map((point, index) => (
            <span key={`${index}-${point}`}>{point}</span>
          ))}
        </div>
      </div>

      <div className="card landing-form">
        <div className="section-title">Get in touch</div>
        {successId ? (
          <div className="notice landing-success">
            <h3>Thanks! We received your enquiry.</h3>
            <p className="muted">
              We&apos;ll WhatsApp/call you within 10 minutes.
            </p>
            {whatsappPrefill && (
              <a className="button" href={whatsappPrefill} target="_blank" rel="noreferrer">
                Send WhatsApp message now
              </a>
            )}
          </div>
        ) : (
          <form onSubmit={handleSubmit}>
            {baseFields.map(renderField)}
            {!hasCustomFields && (
              <>
                <button
                  type="button"
                  className="button secondary"
                  onClick={() => setShowEmail((prev) => !prev)}
                >
                  Add email (optional)
                </button>
                {showEmail && renderField(emailField)}
              </>
            )}
            <button
              className="button"
              type="submit"
              disabled={submitting}
              style={
                settings?.primary_color
                  ? {
                      background: settings.primary_color,
                      borderColor: settings.primary_color
                    }
                  : undefined
              }
            >
              {submitting ? "Submitting..." : "Submit"}
            </button>
          </form>
        )}
      </div>

      <div className="card landing-share">
        <div>
          <div className="section-title">Share this page</div>
          <p className="muted">Send this link to parents and students.</p>
        </div>
        <button className="button secondary" type="button" onClick={handleCopyLink}>
          Copy link
        </button>
        {copyMessage && <span className="muted">{copyMessage}</span>}
      </div>
    </div>
  );
}
