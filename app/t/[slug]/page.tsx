
"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { supabase } from "@/lib/supabaseClient";
import {
  interpolateTemplate,
  resolveLandingConfig,
  type LandingSettings
} from "@/lib/landingConfig";

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
  landing?: Record<string, unknown>;
};

const defaultFields: LeadFormField[] = [
  { key: "full_name", label: "Full Name", type: "text", required: true },
  { key: "phone", label: "Phone", type: "tel", required: true },
  { key: "move_in_month", label: "When do you need this?", type: "month" },
  {
    key: "student_type",
    label: "Student Type",
    type: "select",
    options: ["JEE", "NEET", "Other"]
  }
];

const emailField: LeadFormField = {
  key: "email",
  label: "Email",
  type: "email"
};

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;
const normalizeLeadSchema = (value: unknown) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { fields: [], trustPoints: [] };
  }

  const rawFields = Array.isArray((value as LeadFormSchema).fields)
    ? (value as LeadFormSchema).fields
    : [];

  const fields = (rawFields ?? [])
    .map<LeadFormField | null>((field) => {
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

  const rawTrustPoints = Array.isArray((value as LeadFormSchema).trust_points)
    ? (value as LeadFormSchema).trust_points
    : [];
  const trustPoints = (rawTrustPoints ?? []).filter(isNonEmptyString);

  return { fields, trustPoints };
};

const resolveCampaign = (settings: LandingSettings | null) => {
  const campaign =
    settings?.campaign || settings?.lead_campaign || settings?.default_campaign;
  return campaign && campaign.trim().length > 0 ? campaign : "demo";
};


const splitFields = (fields: LeadFormField[]) => {
  const selected: LeadFormField[] = [];

  const includesAny = (value: string, keywords: string[]) =>
    keywords.some((keyword) => value.includes(keyword));

  const addField = (field?: LeadFormField | null) => {
    if (!field) return;
    if (selected.some((item) => item.key === field.key)) return;
    selected.push(field);
  };

  const nameField = fields.find((field) => {
    const key = field.key.toLowerCase();
    const label = field.label.toLowerCase();
    return (
      includesAny(key, ["name", "full_name", "fullname", "first_name", "last_name"]) ||
      includesAny(label, ["name", "full name"])
    );
  });

  const phoneField = fields.find((field) => {
    const key = field.key.toLowerCase();
    const label = field.label.toLowerCase();
    return (
      field.type === "tel" ||
      includesAny(key, ["phone", "mobile", "whatsapp", "contact"]) ||
      includesAny(label, ["phone", "mobile", "whatsapp", "contact"])
    );
  });

  const timingField = fields.find((field) => {
    const key = field.key.toLowerCase();
    const label = field.label.toLowerCase();
    return (
      field.type === "month" ||
      field.type === "date" ||
      includesAny(key, ["move", "when", "time", "schedule", "visit", "appointment"]) ||
      includesAny(label, ["move", "when", "time", "schedule", "visit", "appointment"])
    );
  });

  addField(nameField);
  addField(phoneField);
  addField(timingField);

  for (const field of fields) {
    if (selected.length >= 3) break;
    addField(field);
  }

  const stepOneFields = selected.length > 0 ? selected : fields.slice(0, 3);
  const stepTwoFields = fields.filter(
    (field) => !stepOneFields.some((item) => item.key === field.key)
  );

  return { stepOneFields, stepTwoFields, nameField, timingField, phoneField };
};

export default function TenantLandingPage({
  params
}: {
  params: { slug: string };
}) {
  const [settings, setSettings] = useState<LandingSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [pageError, setPageError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [successId, setSuccessId] = useState<string | null>(null);
  const [showEmail, setShowEmail] = useState(false);
  const [copyMessage, setCopyMessage] = useState<string | null>(null);
  const [formState, setFormState] = useState<Record<string, string>>({});
  const [sheetOpen, setSheetOpen] = useState(false);
  const [formStep, setFormStep] = useState<1 | 2>(1);
  const [lastSubmission, setLastSubmission] = useState<Record<string, string>>({});
  const sheetRef = useRef<HTMLDivElement | null>(null);
  const landingRef = useRef<HTMLDivElement | null>(null);
  const ctaBarRef = useRef<HTMLDivElement | null>(null);

  const isLoading = loading || !settings;

  useEffect(() => {
    let active = true;

    const loadSettings = async () => {
      setLoading(true);
      setPageError(null);

      const { data, error: rpcError } = await supabase
        .schema("public")
        .rpc("get_landing_settings", {
          p_identity_type: "slug",
          p_identity_value: params.slug
        });

      if (!active) return;

      if (rpcError || !data) {
        setPageError("This page is unavailable.");
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
  const {
    stepOneFields,
    stepTwoFields: baseStepTwoFields,
    nameField,
    timingField,
    phoneField
  } = splitFields(baseFields);
  const stepTwoFields =
    !hasCustomFields && showEmail ? [...baseStepTwoFields, emailField] : baseStepTwoFields;
  const submitFields = [...stepOneFields, ...stepTwoFields];

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

  useEffect(() => {
    if (!sheetOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeSheet();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [sheetOpen]);

  useEffect(() => {
    if (!sheetOpen) return;
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    sheetRef.current?.focus();
    return () => {
      document.body.style.overflow = originalOverflow;
    };
  }, [sheetOpen]);

  const resolvedConfig = resolveLandingConfig(settings, { slug: params.slug });
  const { brand, contact, cta, hero, sections, footer } = resolvedConfig;
  const themeAccent = isNonEmptyString(settings?.primary_color)
    ? settings?.primary_color.trim()
    : "#b65a3c";
  const tenantName = brand.name || params.slug;
  const contactPhone = contact.phone;
  const contactEmail = contact.email;
  const addressLine = contact.address_line;
  const hours = contact.hours;
  const mapLink = isNonEmptyString(contact.map_url) ? contact.map_url : null;
  const cleanWhatsapp = contact.whatsapp.replace(/\D/g, "");
  const whatsappLink = cleanWhatsapp ? `https://wa.me/${cleanWhatsapp}` : null;
  const callLink = contactPhone ? `tel:${contactPhone}` : null;
  const shareLink =
    typeof window !== "undefined"
      ? `${window.location.origin}/t/${params.slug}`
      : "";
  const proofChips = hero.proof_chips.slice(0, 3);
  const snapshotBullets = hero.snapshot.bullets.slice(0, 3);
  const heroGalleryStrip = hero.media.gallery_strip_enabled
    ? sections.gallery.images.slice(0, 3)
    : [];
  const primaryCtaType = cta.primary.type;
  const primaryLabel =
    cta.primary.label ||
    (primaryCtaType === "call"
      ? "Call"
      : primaryCtaType === "enquire"
        ? "Enquire"
        : "WhatsApp");
  const getFieldValue = (field?: LeadFormField | null) => {
    if (!field) return "";
    return lastSubmission[field.key] ?? formState[field.key] ?? "";
  };
  const nameValue = getFieldValue(nameField);
  const timingValue = getFieldValue(timingField);
  const phoneValue = getFieldValue(phoneField);
  const tokenValues: Record<string, string> = {
    name: nameValue,
    phone: phoneValue,
    brand_name: brand.name,
    vertical: resolvedConfig.vertical,
    when_needed: timingValue
  };
  for (const field of submitFields) {
    const key = field.key.toLowerCase();
    if (tokenValues[key] !== undefined) continue;
    tokenValues[key] = lastSubmission[field.key] ?? formState[field.key] ?? "";
  }
  const prefillTemplate =
    cta.primary.prefill_template || "Hi, I want to enquire about {brand_name}.";
  const whatsappText = whatsappLink
    ? interpolateTemplate(prefillTemplate, tokenValues)
    : "";
  const trimmedWhatsAppText = whatsappText.trim();
  const whatsappPrefill = whatsappLink
    ? trimmedWhatsAppText
      ? `${whatsappLink}?text=${encodeURIComponent(trimmedWhatsAppText)}`
      : whatsappLink
    : null;
  const primaryCtaHref =
    primaryCtaType === "call"
      ? callLink
      : primaryCtaType === "whatsapp"
        ? whatsappPrefill ?? whatsappLink
        : null;
  const hasWhatsApp = Boolean(whatsappLink);
  const hasPhone = Boolean(callLink);
  const hasMap = Boolean(mapLink);
  const secondaryAction = (() => {
    if (cta.secondary.type === "call" && hasPhone) return "call";
    if (cta.secondary.type === "directions" && hasMap) return "directions";
    if (cta.secondary.type === "pricing") return "pricing";
    if (cta.secondary.type === "enquire") return "enquire";

    if (primaryCtaType === "call") {
      if (hasWhatsApp) return "whatsapp";
      if (hasMap) return "directions";
      return "enquire";
    }
    if (primaryCtaType === "whatsapp") {
      if (hasPhone) return "call";
      if (hasMap) return "directions";
      return "enquire";
    }
    if (hasPhone) return "call";
    if (hasWhatsApp) return "whatsapp";
    if (hasMap) return "directions";
    return "enquire";
  })();
  const secondaryLabel =
    cta.secondary.label ||
    (secondaryAction === "whatsapp"
      ? "WhatsApp"
      : secondaryAction === "call"
        ? "Call"
        : secondaryAction === "directions"
          ? "Directions"
          : secondaryAction === "pricing"
            ? "Pricing"
            : "Enquire");
  const secondaryHref =
    secondaryAction === "call"
      ? callLink
      : secondaryAction === "whatsapp"
        ? whatsappPrefill ?? whatsappLink
        : secondaryAction === "directions"
          ? mapLink
          : null;
  const primaryIsEnquire = primaryCtaType === "enquire" || !primaryCtaHref;
  const showEnquireCta = cta.sticky_bar.show_enquire && !primaryIsEnquire;
  const ctaBarEnabled = cta.sticky_bar.enabled;

  const handlePricing = () => {
    const servicesSection = document.getElementById("landing-services");
    servicesSection?.scrollIntoView({ behavior: "smooth" });
  };

  const handleSecondaryClick = () => {
    if (secondaryAction === "pricing") {
      handlePricing();
      return;
    }
    openSheet();
  };

  useEffect(() => {
    const updateCtaHeight = () => {
      const height = ctaBarRef.current?.offsetHeight ?? 0;
      if (landingRef.current) {
        landingRef.current.style.setProperty("--landing-cta-height", `${height}px`);
      }
    };
    updateCtaHeight();
    window.addEventListener("resize", updateCtaHeight);
    return () => window.removeEventListener("resize", updateCtaHeight);
  }, [ctaBarEnabled, primaryLabel, secondaryLabel, showEnquireCta]);

  const openSheet = () => {
    setSheetOpen(true);
    setFormStep(1);
    setSubmitError(null);
    setSuccessId(null);
  };

  const closeSheet = () => {
    setSheetOpen(false);
    setFormStep(1);
    setSubmitError(null);
  };

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
    setSubmitError(null);
    setSuccessId(null);
    setSubmitting(true);

    const payload: Record<string, unknown> = {};
    const submission: Record<string, string> = {};
    for (const field of submitFields) {
      const rawValue = formState[field.key] ?? "";
      const trimmed = rawValue.trim();
      payload[field.key] = trimmed.length > 0 ? trimmed : null;
      submission[field.key] = trimmed;
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
        setSubmitError("This business is currently unavailable.");
      } else if (message.includes("rate limit")) {
        setSubmitError("Too many submissions. Please try again shortly.");
      } else {
        setSubmitError(responseBody.error ?? "Submission failed.");
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
    setLastSubmission(submission);
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

  const requiredStepKeys = new Set(
    [nameField?.key, phoneField?.key, timingField?.key].filter(
      (key): key is string => Boolean(key)
    )
  );
  const stepOneComplete = stepOneFields.every((field) => {
    const mustFill = field.required || requiredStepKeys.has(field.key);
    if (!mustFill) return true;
    return Boolean(formState[field.key]?.trim());
  });
  const hasStepTwo = stepTwoFields.length > 0;
  const showWhyChoose =
    sections.why_choose.enabled && sections.why_choose.items.length > 0;
  const showGallery =
    sections.gallery.enabled && sections.gallery.images.length > 0;
  const showServices =
    sections.services.enabled && sections.services.items.length > 0;
  const showTestimonials =
    sections.testimonials.enabled && sections.testimonials.items.length > 0;
  const showFaq = sections.faq.enabled && sections.faq.items.length > 0;
  const showContactCard =
    sections.location.show_contact_card &&
    (contactPhone || contactEmail || hours.length > 0);
  const showVisitCard = Boolean(mapLink) || isNonEmptyString(addressLine);
  const showLocation = sections.location.enabled && (showVisitCard || showContactCard);
  const showShare = footer.show_share;
  const showDeveloperCredit =
    footer.developer_credit.enabled &&
    isNonEmptyString(footer.developer_credit.label);
  const showFooter = showShare || showDeveloperCredit;
  const shouldShowHeader = (title: string, subtitle: string) =>
    isNonEmptyString(title) || isNonEmptyString(subtitle);

  if (isLoading) {
    return (
      <div className="card">
        <h1>Loading landing...</h1>
        <p className="muted">Fetching tenant details.</p>
      </div>
    );
  }

  if (pageError) {
    return (
      <div className="card">
        <h1>Landing unavailable</h1>
        <div className="error">{pageError}</div>
      </div>
    );
  }

  return (
    <div
      className="landing"
      ref={landingRef}
      style={
        {
          "--landing-accent": themeAccent,
          "--landing-accent-dark": themeAccent
        } as CSSProperties
      }
    >
      <section className="landing-hero">
        <div className="landing-hero-content">
          {settings?.logo_url && (
            <img src={settings.logo_url} alt={tenantName} className="landing-logo" />
          )}
          {isNonEmptyString(brand.badge) && (
            <p className="landing-eyebrow">{brand.badge}</p>
          )}
          <h1>{hero.headline}</h1>
          <p className="landing-subheadline">{hero.subheadline}</p>
          <div className="landing-hero-ctas">
            {primaryIsEnquire || !primaryCtaHref ? (
              <button type="button" className="button" onClick={openSheet}>
                {primaryLabel}
              </button>
            ) : (
              <a
                className="button"
                href={primaryCtaHref}
                target={primaryCtaType === "whatsapp" ? "_blank" : undefined}
                rel={primaryCtaType === "whatsapp" ? "noreferrer" : undefined}
              >
                {primaryLabel}
              </a>
            )}
            {secondaryHref ? (
              <a
                className="button secondary"
                href={secondaryHref}
                target={secondaryAction === "call" ? undefined : "_blank"}
                rel={secondaryAction === "call" ? undefined : "noreferrer"}
              >
                {secondaryLabel}
              </a>
            ) : (
              <button
                type="button"
                className="button secondary"
                onClick={handleSecondaryClick}
              >
                {secondaryLabel}
              </button>
            )}
          </div>
          {proofChips.length > 0 && (
            <div className="landing-proof-chips">
              {proofChips.map((point) => (
                <span className="landing-chip" key={point}>
                  {point}
                </span>
              ))}
            </div>
          )}
          {heroGalleryStrip.length > 0 && (
            <div className="landing-hero-strip">
              {heroGalleryStrip.map((image, index) => (
                <img
                  key={`${image.url}-${index}`}
                  src={image.url}
                  alt={`${tenantName} preview ${index + 1}`}
                  loading="lazy"
                />
              ))}
            </div>
          )}
        </div>
        <div className="landing-hero-card">
          {hero.media.hero_image_url && (
            <div className="landing-hero-media">
              <img
                src={hero.media.hero_image_url}
                alt={`${tenantName} hero`}
                loading="lazy"
              />
            </div>
          )}
          {isNonEmptyString(hero.snapshot.title) && (
            <div className="landing-hero-card-title">{hero.snapshot.title}</div>
          )}
          {snapshotBullets.length > 0 && (
            <div className="landing-hero-card-list">
              {snapshotBullets.map((point) => (
                <div className="landing-hero-card-item" key={point}>
                  <span className="landing-dot" aria-hidden="true" />
                  <span>{point}</span>
                </div>
              ))}
            </div>
          )}
          <button type="button" className="button secondary" onClick={openSheet}>
            Enquire now
          </button>
        </div>
      </section>

      {showWhyChoose && (
        <section className="landing-section">
          {shouldShowHeader(
            sections.why_choose.title,
            sections.why_choose.subtitle
          ) && (
            <div className="landing-section-header">
              <h2>{sections.why_choose.title}</h2>
              {isNonEmptyString(sections.why_choose.subtitle) && (
                <p className="muted">{sections.why_choose.subtitle}</p>
              )}
            </div>
          )}
          <div className="landing-grid">
            {sections.why_choose.items.map((item) => (
              <div className="landing-card" key={item.title}>
                <h3>{item.title}</h3>
                {isNonEmptyString(item.body) && (
                  <p className="muted">{item.body}</p>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {showGallery && (
        <section className="landing-section">
          {shouldShowHeader(sections.gallery.title, "A quick look at the experience.") && (
            <div className="landing-section-header">
              <h2>{sections.gallery.title}</h2>
              <p className="muted">A quick look at the experience.</p>
            </div>
          )}
          <div className="landing-gallery">
            {sections.gallery.images.map((image, index) => (
              <figure className="landing-gallery-item" key={`${image.url}-${index}`}>
                <img
                  src={image.url}
                  alt={`${tenantName} gallery ${index + 1}`}
                  loading="lazy"
                />
                {isNonEmptyString(image.caption) && (
                  <figcaption className="muted">{image.caption}</figcaption>
                )}
              </figure>
            ))}
          </div>
        </section>
      )}

      {showServices && (
        <section className="landing-section" id="landing-services">
          {shouldShowHeader(sections.services.title, sections.services.subtitle) && (
            <div className="landing-section-header">
              <h2>{sections.services.title}</h2>
              {isNonEmptyString(sections.services.subtitle) && (
                <p className="muted">{sections.services.subtitle}</p>
              )}
              {isNonEmptyString(sections.services.pricing_note) && (
                <p className="muted">{sections.services.pricing_note}</p>
              )}
            </div>
          )}
          <div className="landing-grid">
            {sections.services.items.map((service) => (
              <div className="landing-card" key={service.title}>
                <div className="landing-card-header">
                  <h3>{service.title}</h3>
                  {isNonEmptyString(service.price) && (
                    <span className="landing-price">{service.price}</span>
                  )}
                </div>
                {isNonEmptyString(service.body) && (
                  <p className="muted">{service.body}</p>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {showTestimonials && (
        <section className="landing-section">
          {shouldShowHeader(
            sections.testimonials.title,
            sections.testimonials.subtitle
          ) && (
            <div className="landing-section-header">
              <h2>{sections.testimonials.title}</h2>
              {isNonEmptyString(sections.testimonials.subtitle) && (
                <p className="muted">{sections.testimonials.subtitle}</p>
              )}
            </div>
          )}
          <div className="landing-grid">
            {sections.testimonials.items.map((item) => (
              <div className="landing-card" key={item.quote}>
                <p className="landing-quote">"{item.quote}"</p>
                <div className="landing-testimonial-meta">
                  <strong>{item.name}</strong>
                  {isNonEmptyString(item.role) && (
                    <span className="muted">{item.role}</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {showFaq && (
        <section className="landing-section">
          {shouldShowHeader(sections.faq.title, sections.faq.subtitle) && (
            <div className="landing-section-header">
              <h2>{sections.faq.title}</h2>
              {isNonEmptyString(sections.faq.subtitle) && (
                <p className="muted">{sections.faq.subtitle}</p>
              )}
            </div>
          )}
          <div className="landing-faq">
            {sections.faq.items.map((item) => (
              <details className="landing-faq-item" key={item.q}>
                <summary>{item.q}</summary>
                <p className="muted">{item.a}</p>
              </details>
            ))}
          </div>
        </section>
      )}

      {showLocation && (
        <section className="landing-section">
          {shouldShowHeader(
            sections.location.title,
            sections.location.subtitle
          ) && (
            <div className="landing-section-header">
              <h2>{sections.location.title}</h2>
              {isNonEmptyString(sections.location.subtitle) && (
                <p className="muted">{sections.location.subtitle}</p>
              )}
            </div>
          )}
          <div className="landing-grid two-col">
            {showVisitCard && (
              <div className="landing-card">
                <h3>Visit us</h3>
                <p className="muted">
                  {addressLine || "Address available on request."}
                </p>
                {sections.location.show_map_button && mapLink && (
                  <a
                    className="button secondary"
                    href={mapLink}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Directions
                  </a>
                )}
              </div>
            )}
            {showContactCard && (
              <div className="landing-card">
                <h3>Contact</h3>
                <div className="landing-contact-list">
                  {contactPhone && (
                    <a className="landing-contact-link" href={callLink ?? "#"}>
                      {contactPhone}
                    </a>
                  )}
                  {contactEmail && (
                    <a className="landing-contact-link" href={`mailto:${contactEmail}`}>
                      {contactEmail}
                    </a>
                  )}
                  {hours.length > 0 && (
                    <div className="landing-hours">
                      {hours.map((slot, index) => (
                        <span key={`${slot.label}-${slot.value}-${index}`}>
                          {slot.label && slot.value
                            ? `${slot.label}: ${slot.value}`
                            : slot.label || slot.value}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </section>
      )}

      {showFooter && (
        <footer className="landing-footer">
          {showShare && (
            <div className="landing-footer-card">
              <div>
                <div className="landing-footer-title">{footer.share_label}</div>
                <p className="muted">
                  Send this link to parents, patients, or friends.
                </p>
              </div>
              <div className="landing-footer-actions">
                <button className="button secondary" type="button" onClick={handleCopyLink}>
                  Copy link
                </button>
                {copyMessage && <span className="muted">{copyMessage}</span>}
              </div>
            </div>
          )}
          {showDeveloperCredit && (
            <div className="landing-footer-credit">
              {footer.developer_credit.url ? (
                <a href={footer.developer_credit.url} target="_blank" rel="noreferrer">
                  {footer.developer_credit.label}
                </a>
              ) : (
                <span>{footer.developer_credit.label}</span>
              )}
            </div>
          )}
        </footer>
      )}

      <div
        className={`sheet-backdrop ${sheetOpen ? "open" : ""}`}
        onClick={closeSheet}
        aria-hidden={!sheetOpen}
      />
      <div
        className={`sheet ${sheetOpen ? "open" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label="Lead enquiry form"
        aria-hidden={!sheetOpen}
        ref={sheetRef}
        tabIndex={-1}
      >
        <div className="sheet-header">
          <div>
            <div className="sheet-kicker">Enquiry form</div>
            <h3>Get a quick response</h3>
            <p className="muted">Two short steps to reserve your slot.</p>
          </div>
          <button type="button" className="button secondary icon-button" onClick={closeSheet}>
            X
          </button>
        </div>
        <div className="sheet-body">
          {successId ? (
            <div className="landing-success">
              <h3>Thanks - we will respond soon.</h3>
              <p className="muted">If you want a faster reply, open WhatsApp now.</p>
              {whatsappPrefill && (
                <a className="button" href={whatsappPrefill} target="_blank" rel="noreferrer">
                  Open WhatsApp
                </a>
              )}
              <button
                type="button"
                className="button secondary"
                onClick={() => {
                  setSuccessId(null);
                  setFormStep(1);
                }}
              >
                Submit another enquiry
              </button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="landing-form">
              <div className="sheet-stepper">
                <span className="sheet-step active">Step 1</span>
                {hasStepTwo && (
                  <span className={`sheet-step ${formStep === 2 ? "active" : ""}`}>
                    Step 2
                  </span>
                )}
              </div>
              {submitError && <div className="error">{submitError}</div>}
              {formStep === 1 && (
                <>
                  <div className="sheet-fields">{stepOneFields.map(renderField)}</div>
                  {hasStepTwo && (
                    <button
                      type="button"
                      className="button"
                      onClick={() => setFormStep(2)}
                      disabled={!stepOneComplete}
                    >
                      Continue
                    </button>
                  )}
                  {!hasStepTwo && (
                    <button className="button" type="submit" disabled={submitting}>
                      {submitting ? "Submitting..." : "Submit"}
                    </button>
                  )}
                </>
              )}
              {formStep === 2 && (
                <>
                  <div className="sheet-fields">
                    {stepTwoFields.map(renderField)}
                    {!hasCustomFields && (
                      <button
                        type="button"
                        className="button secondary"
                        onClick={() => setShowEmail((prev) => !prev)}
                      >
                        {showEmail ? "Remove email" : "Add email (optional)"}
                      </button>
                    )}
                  </div>
                  <div className="sheet-actions">
                    <button
                      type="button"
                      className="button secondary"
                      onClick={() => setFormStep(1)}
                    >
                      Back
                    </button>
                    <button className="button" type="submit" disabled={submitting}>
                      {submitting ? "Submitting..." : "Submit"}
                    </button>
                  </div>
                </>
              )}
            </form>
          )}
        </div>
      </div>

      {ctaBarEnabled && (
        <div
          className="landing-cta-bar"
          role="region"
          aria-label="Quick actions"
          ref={ctaBarRef}
        >
          {primaryIsEnquire || !primaryCtaHref ? (
            <button type="button" className="cta-primary" onClick={openSheet}>
              {primaryLabel}
            </button>
          ) : (
            <a
              className="cta-primary"
              href={primaryCtaHref}
              target={primaryCtaType === "whatsapp" ? "_blank" : undefined}
              rel={primaryCtaType === "whatsapp" ? "noreferrer" : undefined}
            >
              {primaryLabel}
            </a>
          )}
          {secondaryHref ? (
            <a
              className="cta-secondary"
              href={secondaryHref}
              target={secondaryAction === "call" ? undefined : "_blank"}
              rel={secondaryAction === "call" ? undefined : "noreferrer"}
            >
              {secondaryLabel}
            </a>
          ) : (
            <button type="button" className="cta-secondary" onClick={handleSecondaryClick}>
              {secondaryLabel}
            </button>
          )}
          {showEnquireCta && (
            <button type="button" className="cta-tertiary" onClick={openSheet}>
              Enquire
            </button>
          )}
        </div>
      )}
    </div>
  );
}
