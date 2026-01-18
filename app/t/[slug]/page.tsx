
"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
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

type ContentCard = {
  title: string;
  description: string;
};

type ServiceItem = {
  title: string;
  description: string;
  price?: string;
};

type Testimonial = {
  quote: string;
  name: string;
  meta?: string;
};

type FaqItem = {
  question: string;
  answer: string;
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

const defaultTrustPoints = [
  "Fast response on WhatsApp",
  "Verified local team",
  "Transparent pricing"
];

const defaultWhyChoose: ContentCard[] = [
  {
    title: "Fast response",
    description: "Replies in minutes via WhatsApp or call."
  },
  {
    title: "Verified and trusted",
    description: "Every enquiry gets a personal follow-up."
  },
  {
    title: "Flexible options",
    description: "Plans that match your budget and timing."
  },
  {
    title: "Prime location",
    description: "Easy to reach and close to key hubs."
  }
];

const defaultServices: ServiceItem[] = [
  {
    title: "Starter Plan",
    description: "Essentials for a quick start.",
    price: "From Rs. 4,999"
  },
  {
    title: "Standard Plan",
    description: "Most popular, balanced features.",
    price: "From Rs. 7,999"
  },
  {
    title: "Premium Plan",
    description: "All-inclusive support and upgrades.",
    price: "From Rs. 11,999"
  }
];

const defaultTestimonials: Testimonial[] = [
  {
    quote: "We got a response within minutes and booked right away.",
    name: "Aarav",
    meta: "Parent"
  },
  {
    quote: "Clean, calm, and exactly as promised.",
    name: "Meera",
    meta: "Student"
  },
  {
    quote: "Transparent pricing and great follow-through.",
    name: "Dr. Anita",
    meta: "Clinic lead"
  }
];

const defaultFaqs: FaqItem[] = [
  {
    question: "How fast do you respond?",
    answer: "Typically within 10 minutes on WhatsApp."
  },
  {
    question: "Can I schedule a visit?",
    answer: "Yes, pick a time that suits you and we will confirm."
  },
  {
    question: "What details do you need to get started?",
    answer: "Just your name, phone, and preferred timing."
  },
  {
    question: "Can I change plans later?",
    answer: "Yes, upgrades are available anytime."
  }
];

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;

const asRecord = (value: unknown): Record<string, unknown> | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
};

const pickString = (...values: unknown[]) => {
  for (const value of values) {
    if (isNonEmptyString(value)) return value.trim();
  }
  return null;
};

const pickStringArray = (...values: unknown[]) => {
  for (const value of values) {
    if (Array.isArray(value)) {
      const filtered = value.filter(isNonEmptyString);
      if (filtered.length > 0) return filtered;
    }
  }
  return [];
};
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

const normalizeCards = (value: unknown, fallback: ContentCard[]) => {
  if (!Array.isArray(value)) return fallback;
  const cards = value
    .map<ContentCard | null>((item) => {
      if (isNonEmptyString(item)) {
        return { title: item.trim(), description: "Details available on request." };
      }
      const record = asRecord(item);
      if (!record) return null;
      const title = pickString(record.title, record.heading, record.name);
      const description = pickString(record.description, record.detail, record.subtitle);
      if (!title) return null;
      return {
        title,
        description: description ?? "Details available on request."
      };
    })
    .filter((card): card is ContentCard => Boolean(card));
  return cards.length > 0 ? cards : fallback;
};

const normalizeServices = (value: unknown, fallback: ServiceItem[]) => {
  if (!Array.isArray(value)) return fallback;
  const services = value
    .map<ServiceItem | null>((item) => {
      if (isNonEmptyString(item)) {
        return { title: item.trim(), description: "Tailored option available." };
      }
      const record = asRecord(item);
      if (!record) return null;
      const title = pickString(record.title, record.heading, record.name);
      const description = pickString(record.description, record.detail, record.subtitle);
      if (!title) return null;
      return {
        title,
        description: description ?? "Tailored option available.",
        price: pickString(record.price, record.rate, record.cost) ?? undefined
      };
    })
    .filter((service): service is ServiceItem => Boolean(service));
  return services.length > 0 ? services : fallback;
};

const normalizeTestimonials = (value: unknown, fallback: Testimonial[]) => {
  if (!Array.isArray(value)) return fallback;
  const testimonials = value
    .map<Testimonial | null>((item) => {
      if (isNonEmptyString(item)) {
        return { quote: item.trim(), name: "Customer" };
      }
      const record = asRecord(item);
      if (!record) return null;
      const quote = pickString(record.quote, record.text, record.feedback);
      const name = pickString(record.name, record.author);
      if (!quote) return null;
      return {
        quote,
        name: name ?? "Customer",
        meta: pickString(record.meta, record.role) ?? undefined
      };
    })
    .filter((item): item is Testimonial => Boolean(item));
  return testimonials.length > 0 ? testimonials : fallback;
};

const normalizeFaqs = (value: unknown, fallback: FaqItem[]) => {
  if (!Array.isArray(value)) return fallback;
  const faqs = value
    .map<FaqItem | null>((item) => {
      if (isNonEmptyString(item)) {
        return { question: item.trim(), answer: "We can share details on request." };
      }
      const record = asRecord(item);
      if (!record) return null;
      const question = pickString(record.question, record.title);
      const answer = pickString(record.answer, record.detail);
      if (!question) return null;
      return {
        question,
        answer: answer ?? "We can share details on request."
      };
    })
    .filter((item): item is FaqItem => Boolean(item));
  return faqs.length > 0 ? faqs : fallback;
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

const buildWhatsAppText = (
  tenantName: string,
  nameValue: string | undefined,
  timingValue: string | undefined
) => {
  const parts = [];
  if (nameValue) {
    parts.push(`Hi, I am ${nameValue}.`);
  } else {
    parts.push("Hi.");
  }
  parts.push(`I just submitted an enquiry for ${tenantName}.`);
  if (timingValue) {
    parts.push(`Preferred timing: ${timingValue}.`);
  }
  return parts.join(" ");
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

  const contactPhone = settings?.contact_phone ?? "";
  const cleanPhone = contactPhone.replace(/\D/g, "");
  const whatsappLink = cleanPhone ? `https://wa.me/${cleanPhone}` : null;
  const callLink = contactPhone ? `tel:${contactPhone}` : null;
  const shareLink =
    typeof window !== "undefined"
      ? `${window.location.origin}/t/${params.slug}`
      : "";
  const tenantName = settings?.brand_name ?? settings?.name ?? params.slug;
  const settingsRecord = asRecord(settings) ?? {};
  const headline =
    pickString(settingsRecord.headline, settingsRecord.hero_headline, settings?.brand_name) ??
    tenantName;
  const subheadline =
    pickString(settingsRecord.subheadline, settingsRecord.hero_subheadline, settings?.tagline) ??
    "Fast, friendly, and verified support for your next enquiry.";
  const trustLine =
    pickString(settingsRecord.trust_line, settingsRecord.trustline) ??
    "Fast response on WhatsApp";
  const proofPoints = pickStringArray(
    settingsRecord.proof_points,
    settingsRecord.trust_points,
    trustPoints
  ).slice(0, 3);
  const proofChips = proofPoints.length > 0 ? proofPoints : trustPoints.slice(0, 3);
  const whyChoose = normalizeCards(
    settingsRecord.why_choose ?? settingsRecord.benefits,
    defaultWhyChoose
  ).slice(0, 4);
  const services = normalizeServices(
    settingsRecord.services ?? settingsRecord.packages,
    defaultServices
  ).slice(0, 3);
  const testimonials = normalizeTestimonials(settingsRecord.testimonials, defaultTestimonials).slice(
    0,
    3
  );
  const faqs = normalizeFaqs(settingsRecord.faq ?? settingsRecord.faqs, defaultFaqs).slice(0, 4);
  const gallery = pickStringArray(
    settingsRecord.gallery,
    settingsRecord.images,
    settingsRecord.gallery_images
  ).slice(0, 6);
  const address = settings?.address ?? "";
  const hours = pickStringArray(settingsRecord.hours, settingsRecord.opening_hours);
  const mapLink = address
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`
    : null;
  const contactEmail = settings?.contact_email ?? "";
  const themeAccent = isNonEmptyString(settings?.primary_color)
    ? settings?.primary_color.trim()
    : "#b65a3c";
  const primaryLabel = pickString(settingsRecord.primary_cta_label) ??
    (whatsappLink ? "WhatsApp" : "Enquire");
  const secondaryLabel =
    pickString(settingsRecord.secondary_cta_label) ??
    (callLink ? "Call" : mapLink ? "Directions" : "Enquire");
  const primaryIsEnquire = primaryLabel.toLowerCase() === "enquire";
  const showEnquireCta = !primaryIsEnquire;
  const nameValue = nameField ? lastSubmission[nameField.key] : "";
  const timingValue = timingField ? lastSubmission[timingField.key] : "";
  const whatsappText = buildWhatsAppText(tenantName, nameValue, timingValue);
  const whatsappPrefill = whatsappLink
    ? `${whatsappLink}?text=${encodeURIComponent(whatsappText)}`
    : null;

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
          <p className="landing-eyebrow">Trusted local team</p>
          <h1>{headline}</h1>
          <p className="landing-subheadline">{subheadline}</p>
          <div className="landing-hero-ctas">
            {primaryIsEnquire || !whatsappLink ? (
              <button type="button" className="button" onClick={openSheet}>
                {primaryLabel}
              </button>
            ) : (
              <a
                className="button"
                href={whatsappPrefill ?? whatsappLink ?? "#"}
                target="_blank"
                rel="noreferrer"
                aria-disabled={!whatsappLink}
              >
                {primaryLabel}
              </a>
            )}
            {secondaryLabel.toLowerCase().includes("call") && callLink ? (
              <a className="button secondary" href={callLink} aria-disabled={!callLink}>
                {secondaryLabel}
              </a>
            ) : secondaryLabel.toLowerCase().includes("direction") && mapLink ? (
              <a className="button secondary" href={mapLink} target="_blank" rel="noreferrer">
                {secondaryLabel}
              </a>
            ) : (
              <button type="button" className="button secondary" onClick={openSheet}>
                {secondaryLabel}
              </button>
            )}
          </div>
          <div className="landing-trust-line">{trustLine}</div>
          <div className="landing-proof-chips">
            {proofChips.map((point) => (
              <span className="landing-chip" key={point}>
                {point}
              </span>
            ))}
          </div>
        </div>
        <div className="landing-hero-card">
          <div className="landing-hero-card-title">Quick snapshot</div>
          <div className="landing-hero-card-list">
            {trustPoints.slice(0, 3).map((point) => (
              <div className="landing-hero-card-item" key={point}>
                <span className="landing-dot" aria-hidden="true" />
                <span>{point}</span>
              </div>
            ))}
          </div>
          <button type="button" className="button secondary" onClick={openSheet}>
            Enquire now
          </button>
        </div>
      </section>

      <section className="landing-section">
        <div className="landing-section-header">
          <h2>Why choose us</h2>
          <p className="muted">The details that matter before you decide.</p>
        </div>
        <div className="landing-grid">
          {whyChoose.map((item) => (
            <div className="landing-card" key={item.title}>
              <h3>{item.title}</h3>
              <p className="muted">{item.description}</p>
            </div>
          ))}
        </div>
      </section>

      {gallery.length > 0 && (
        <section className="landing-section">
          <div className="landing-section-header">
            <h2>Gallery</h2>
            <p className="muted">A quick look at the experience.</p>
          </div>
          <div className="landing-gallery">
            {gallery.map((src, index) => (
              <img
                key={`${src}-${index}`}
                src={src}
                alt={`${tenantName} gallery ${index + 1}`}
                loading="lazy"
              />
            ))}
          </div>
        </section>
      )}

      <section className="landing-section">
        <div className="landing-section-header">
          <h2>Services and packages</h2>
          <p className="muted">Choose the plan that fits your needs.</p>
        </div>
        <div className="landing-grid">
          {services.map((service) => (
            <div className="landing-card" key={service.title}>
              <div className="landing-card-header">
                <h3>{service.title}</h3>
                {service.price && <span className="landing-price">{service.price}</span>}
              </div>
              <p className="muted">{service.description}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="landing-section">
        <div className="landing-section-header">
          <h2>People love the experience</h2>
          <p className="muted">Recent feedback from real visitors.</p>
        </div>
        <div className="landing-grid">
          {testimonials.map((item) => (
            <div className="landing-card" key={item.quote}>
              <p className="landing-quote">"{item.quote}"</p>
              <div className="landing-testimonial-meta">
                <strong>{item.name}</strong>
                {item.meta && <span className="muted">{item.meta}</span>}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="landing-section">
        <div className="landing-section-header">
          <h2>FAQ</h2>
          <p className="muted">Quick answers to common questions.</p>
        </div>
        <div className="landing-faq">
          {faqs.map((item) => (
            <details className="landing-faq-item" key={item.question}>
              <summary>{item.question}</summary>
              <p className="muted">{item.answer}</p>
            </details>
          ))}
        </div>
      </section>

      {(address || contactPhone || contactEmail || hours.length > 0) && (
        <section className="landing-section">
          <div className="landing-section-header">
            <h2>Location and hours</h2>
            <p className="muted">Find us or reach out anytime.</p>
          </div>
          <div className="landing-grid two-col">
            <div className="landing-card">
              <h3>Visit us</h3>
              <p className="muted">{address || "Address available on request."}</p>
              {mapLink && (
                <a className="button secondary" href={mapLink} target="_blank" rel="noreferrer">
                  Directions
                </a>
              )}
            </div>
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
                    {hours.map((slot) => (
                      <span key={slot}>{slot}</span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </section>
      )}

      <footer className="landing-footer">
        <div className="landing-footer-card">
          <div>
            <div className="landing-footer-title">Share this page</div>
            <p className="muted">Send this link to parents, patients, or friends.</p>
          </div>
          <div className="landing-footer-actions">
            <button className="button secondary" type="button" onClick={handleCopyLink}>
              Copy link
            </button>
            {copyMessage && <span className="muted">{copyMessage}</span>}
          </div>
        </div>
      </footer>

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

      <div className="landing-cta-bar" role="region" aria-label="Quick actions">
        {primaryIsEnquire || !whatsappLink ? (
          <button type="button" className="cta-primary" onClick={openSheet}>
            {primaryLabel}
          </button>
        ) : (
          <a
            className="cta-primary"
            href={whatsappPrefill ?? whatsappLink ?? "#"}
            target="_blank"
            rel="noreferrer"
            aria-disabled={!whatsappLink}
          >
            {primaryLabel}
          </a>
        )}
        {secondaryLabel.toLowerCase().includes("call") && callLink ? (
          <a className="cta-secondary" href={callLink}>
            {secondaryLabel}
          </a>
        ) : secondaryLabel.toLowerCase().includes("direction") && mapLink ? (
          <a className="cta-secondary" href={mapLink} target="_blank" rel="noreferrer">
            {secondaryLabel}
          </a>
        ) : (
          <button type="button" className="cta-secondary" onClick={openSheet}>
            {secondaryLabel}
          </button>
        )}
        {showEnquireCta && (
          <button type="button" className="cta-tertiary" onClick={openSheet}>
            Enquire
          </button>
        )}
      </div>
    </div>
  );
}
