"use client";

import { FormEvent, useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

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
  const [formState, setFormState] = useState({
    fullName: "",
    phone: "",
    email: "",
    studentType: "",
    moveInMonth: ""
  });

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

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setSuccessId(null);
    setSubmitting(true);

    const contact: Record<string, unknown> = {
      full_name: formState.fullName,
      phone: formState.phone,
      email: formState.email || null,
      student_type: formState.studentType || null,
      move_in_month: formState.moveInMonth || null
    };
    const payload: Record<string, unknown> = {
      full_name: formState.fullName,
      phone: formState.phone,
      email: formState.email || null,
      student_type: formState.studentType || null,
      move_in_month: formState.moveInMonth || null
    };

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

    if (leadIdValue) {
      void supabase.functions
        .invoke("run-lead-instant-message", {
          body: { lead_id: String(leadIdValue), force: false }
        })
        .catch(() => null);
    }

    setSuccessId(leadIdValue ? String(leadIdValue) : "submitted");
    setSubmitting(false);
    setFormState({
      fullName: "",
      phone: "",
      email: "",
      studentType: "",
      moveInMonth: ""
    });
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
          <span>Walking distance to JEE/NEET classes</span>
          <span>Homely food + safe environment</span>
          <span>Limited beds (10 total)</span>
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
            <label className="field">
              <span>Full Name*</span>
              <input
                type="text"
                required
                value={formState.fullName}
                onChange={(event) =>
                  setFormState((prev) => ({
                    ...prev,
                    fullName: event.target.value
                  }))
                }
              />
            </label>
            <label className="field">
              <span>Phone*</span>
              <input
                type="tel"
                required
                value={formState.phone}
                onChange={(event) =>
                  setFormState((prev) => ({
                    ...prev,
                    phone: event.target.value
                  }))
                }
              />
            </label>
            <label className="field">
              <span>Student Type</span>
              <select
                value={formState.studentType}
                onChange={(event) =>
                  setFormState((prev) => ({
                    ...prev,
                    studentType: event.target.value
                  }))
                }
              >
                <option value="">Select</option>
                <option value="JEE">JEE</option>
                <option value="NEET">NEET</option>
                <option value="Other">Other</option>
              </select>
            </label>
            <label className="field">
              <span>Move-in month</span>
              <input
                type="month"
                value={formState.moveInMonth}
                onChange={(event) =>
                  setFormState((prev) => ({
                    ...prev,
                    moveInMonth: event.target.value
                  }))
                }
              />
            </label>
            <button
              type="button"
              className="button secondary"
              onClick={() => setShowEmail((prev) => !prev)}
            >
              Add email (optional)
            </button>
            {showEmail && (
              <label className="field">
                <span>Email</span>
                <input
                  type="email"
                  value={formState.email}
                  onChange={(event) =>
                    setFormState((prev) => ({
                      ...prev,
                      email: event.target.value
                    }))
                  }
                />
              </label>
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
