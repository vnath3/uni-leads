"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

type LeadField = {
  key: string;
  label?: string;
  type?: string;
  required?: boolean;
  options?: string[];
};

type LandingSettings = {
  tenant_id?: string;
  brand_name?: string;
  tagline?: string;
  logo_url?: string;
  primary_color?: string;
  contact_email?: string;
  contact_phone?: string;
  address?: string;
  lead_form_schema?: {
    fields?: LeadField[];
  };
  campaign?: string;
  lead_campaign?: string;
  default_campaign?: string;
};

const normalizeFieldType = (fieldType?: string) =>
  (fieldType ?? "text").toLowerCase();

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
  const [formValues, setFormValues] = useState<Record<string, unknown>>({});
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successId, setSuccessId] = useState<string | null>(null);

  const fields = useMemo(
    () => settings?.lead_form_schema?.fields ?? [],
    [settings]
  );

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

  useEffect(() => {
    if (!fields.length) return;

    const nextValues: Record<string, unknown> = {};
    for (const field of fields) {
      const fieldType = normalizeFieldType(field.type);
      if (fieldType === "checkbox") {
        nextValues[field.key] = false;
      } else {
        nextValues[field.key] = "";
      }
    }
    setFormValues(nextValues);
  }, [fields]);

  const handleChange = (key: string, value: string | boolean | string[]) => {
    setFormValues((prev) => ({ ...prev, [key]: value }));
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setSuccessId(null);
    setSubmitting(true);

    const payload = { ...formValues } as Record<string, unknown>;
    const fullName =
      (payload.full_name as string | undefined) ||
      (payload.fullName as string | undefined) ||
      (payload.name as string | undefined);
    const phone = payload.phone as string | undefined;
    const email = payload.email as string | undefined;

    const contact: Record<string, unknown> = { ...payload };
    if (fullName) contact.full_name = fullName;
    if (phone) contact.phone = phone;
    if (email) contact.email = email;

    const { data, error: submitError } = await supabase
      .schema("public")
      .rpc("submit_lead", {
        p_identity_type: "slug",
        p_identity_value: params.slug,
        p_contact: contact,
        p_form_payload: payload,
        p_source: "landing",
        p_campaign: resolveCampaign(settings)
      });

    if (submitError) {
      const message = submitError.message.toLowerCase();
      if (message.includes("tenant inactive")) {
        setError("This business is currently unavailable.");
      } else if (message.includes("rate limit")) {
        setError("Too many submissions. Please try again shortly.");
      } else {
        setError(submitError.message);
      }
      setSubmitting(false);
      return;
    }

    const leadIdValue =
      typeof data === "string" || typeof data === "number"
        ? data
        : (data as { lead_id?: string | number; id?: string | number } | null)
            ?.lead_id ??
          (data as { lead_id?: string | number; id?: string | number } | null)
            ?.id;

    setSuccessId(leadIdValue ? String(leadIdValue) : "submitted");
    setSubmitting(false);
  };

  if (loading) {
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
    <div className="card">
      {settings?.logo_url && (
        <img
          src={settings.logo_url}
          alt={settings?.brand_name ?? "Tenant logo"}
          style={{ maxWidth: "160px", marginBottom: "12px" }}
        />
      )}
      <h1>{settings?.brand_name ?? params.slug}</h1>
      <p className="muted">{settings?.tagline ?? "Welcome to our space."}</p>

      <div className="section">
        <div className="section-title">Contact</div>
        <p className="muted">
          {settings?.contact_phone && (
            <span>Phone: {settings.contact_phone} </span>
          )}
          {settings?.contact_email && (
            <span>Email: {settings.contact_email} </span>
          )}
        </p>
        {settings?.address && (
          <p className="muted">Address: {settings.address}</p>
        )}
      </div>

      <div className="section">
        <div className="section-title">Get in touch</div>
        {successId ? (
          <div className="notice">
            Lead submitted successfully. Reference: {successId}
          </div>
        ) : (
          <form onSubmit={handleSubmit}>
            {fields.length === 0 && (
              <p className="muted">No lead form configured.</p>
            )}
            {fields.map((field) => {
              const fieldType = normalizeFieldType(field.type);
              const value = formValues[field.key] ?? "";

              if (fieldType === "textarea") {
                return (
                  <label className="field" key={field.key}>
                    <span>{field.label ?? field.key}</span>
                    <textarea
                      value={String(value)}
                      rows={4}
                      required={field.required}
                      onChange={(event) =>
                        handleChange(field.key, event.target.value)
                      }
                    />
                  </label>
                );
              }

              if (fieldType === "select") {
                return (
                  <label className="field" key={field.key}>
                    <span>{field.label ?? field.key}</span>
                    <select
                      value={String(value)}
                      required={field.required}
                      onChange={(event) =>
                        handleChange(field.key, event.target.value)
                      }
                    >
                      <option value="">Select</option>
                      {(field.options ?? []).map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </select>
                  </label>
                );
              }

              if (fieldType === "checkbox") {
                return (
                  <label className="field" key={field.key}>
                    <span>{field.label ?? field.key}</span>
                    <input
                      type="checkbox"
                      checked={Boolean(value)}
                      onChange={(event) =>
                        handleChange(field.key, event.target.checked)
                      }
                    />
                  </label>
                );
              }

              const inputType =
                fieldType === "phone" || fieldType === "tel"
                  ? "tel"
                  : fieldType === "email"
                    ? "email"
                    : fieldType === "number"
                      ? "number"
                      : "text";

              return (
                <label className="field" key={field.key}>
                  <span>{field.label ?? field.key}</span>
                  <input
                    type={inputType}
                    value={String(value)}
                    required={field.required}
                    onChange={(event) =>
                      handleChange(field.key, event.target.value)
                    }
                  />
                </label>
              );
            })}

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
    </div>
  );
}
