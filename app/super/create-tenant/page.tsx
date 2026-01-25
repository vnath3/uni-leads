"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabaseClient";
import type { LandingConfigV1 } from "@/lib/landingConfig";

type FaqItem = {
  question: string;
  answer: string;
};

type LandingDraft = {
  name: string;
  slug: string;
  vertical: string;
  status: string;
  websiteMode: "landing" | "external";
  headline: string;
  subheadline: string;
  proofChips: string[];
  primaryCtaType: "whatsapp" | "call" | "enquire";
  primaryCtaLabel: string;
  phoneNumber: string;
  whatsappNumber: string;
  address: string;
  whyChoose: string[];
  gallery: string[];
  faqs: FaqItem[];
};

const steps = [
  { id: 1, label: "Tenant basics" },
  { id: 2, label: "Landing content" },
  { id: 3, label: "Trust + sections" },
  { id: 4, label: "Review + create" }
];

const emptyFaqs: FaqItem[] = [
  { question: "", answer: "" },
  { question: "", answer: "" },
  { question: "", answer: "" }
];

const emptyDraft: LandingDraft = {
  name: "",
  slug: "",
  vertical: "pg",
  status: "active",
  websiteMode: "landing",
  headline: "",
  subheadline: "",
  proofChips: ["", "", ""],
  primaryCtaType: "whatsapp",
  primaryCtaLabel: "",
  phoneNumber: "",
  whatsappNumber: "",
  address: "",
  whyChoose: ["", "", "", ""],
  gallery: ["", "", "", "", "", ""],
  faqs: emptyFaqs
};

const normalizeSlug = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/--+/g, "-");

const normalizeList = (items: string[]) =>
  items.map((item) => item.trim()).filter((item) => item.length > 0);

const normalizeFaqs = (items: FaqItem[]) =>
  items
    .map((item) => ({
      question: item.question.trim(),
      answer: item.answer.trim()
    }))
    .filter((item) => item.question.length > 0 && item.answer.length > 0);

const defaultCtaLabel = (type: LandingDraft["primaryCtaType"]) => {
  if (type === "call") return "Call";
  if (type === "enquire") return "Enquire";
  return "WhatsApp";
};

const checkPlatformUser = async (userId: string) => {
  const { data, error } = await supabase
    .from("platform_users")
    .select("user_id, is_active")
    .eq("user_id", userId)
    .eq("is_active", true)
    .maybeSingle();

  if (error) {
    return { data: null, error: error.message };
  }

  return { data: data ? { is_active: true } : null, error: null };
};

export default function CreateTenantPage() {
  const router = useRouter();
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [accessDenied, setAccessDenied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [draft, setDraft] = useState<LandingDraft>(emptyDraft);
  const [slugEdited, setSlugEdited] = useState(false);
  const [ctaTouched, setCtaTouched] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createdTenant, setCreatedTenant] = useState<{
    tenantId: string;
    slug: string;
    name: string;
  } | null>(null);
  const [copyMessage, setCopyMessage] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    const load = async () => {
      setLoading(true);
      setAccessDenied(false);
      setError(null);

      const { data, error: sessionError } = await supabase.auth.getSession();
      if (!active) return;

      if (sessionError || !data.session) {
        setAccessDenied(true);
        setLoading(false);
        return;
      }

      setSession(data.session);
      const platform = await checkPlatformUser(data.session.user.id);
      if (!active) return;

      if (platform.error || !platform.data) {
        setAccessDenied(true);
        setLoading(false);
        return;
      }

      setLoading(false);
    };

    load();

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (slugEdited) return;
    if (!draft.name.trim()) return;
    const nextSlug = normalizeSlug(draft.name);
    if (!nextSlug || nextSlug === draft.slug) return;
    setDraft((prev) => ({ ...prev, slug: nextSlug }));
  }, [draft.name, draft.slug, slugEdited]);

  useEffect(() => {
    if (ctaTouched) return;
    const nextLabel = defaultCtaLabel(draft.primaryCtaType);
    if (!draft.primaryCtaLabel || draft.primaryCtaLabel === nextLabel) {
      setDraft((prev) => ({ ...prev, primaryCtaLabel: nextLabel }));
    }
  }, [draft.primaryCtaType, draft.primaryCtaLabel, ctaTouched]);

  const primaryPreviewLabel = useMemo(() => {
    return draft.primaryCtaLabel.trim() || defaultCtaLabel(draft.primaryCtaType);
  }, [draft.primaryCtaLabel, draft.primaryCtaType]);
  const isExternalWebsite = draft.websiteMode === "external";
  const websiteModeLabel = isExternalWebsite
    ? "External marketing site"
    : "Uni-Leads landing page";

  const validateBasics = () => {
    if (!draft.name.trim()) {
      return "Tenant name is required.";
    }
    if (!draft.slug.trim()) {
      return "Slug is required.";
    }
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(draft.slug.trim().toLowerCase())) {
      return "Slug must be lowercase letters, numbers, and hyphens only.";
    }
    return null;
  };

  const validateLanding = () => {
    if (draft.websiteMode === "external") {
      return null;
    }
    if (!draft.headline.trim()) {
      return "Headline is required.";
    }
    if (!draft.subheadline.trim()) {
      return "Subheadline is required.";
    }
    const hasPhone = draft.phoneNumber.trim().length > 0;
    const hasWhatsApp = draft.whatsappNumber.trim().length > 0;
    if (!hasPhone && !hasWhatsApp) {
      return "Add a phone or WhatsApp number.";
    }
    if (draft.primaryCtaType === "call" && !hasPhone) {
      return "Primary CTA is Call, so phone number is required.";
    }
    if (draft.primaryCtaType === "whatsapp" && !hasWhatsApp) {
      return "Primary CTA is WhatsApp, so WhatsApp number is required.";
    }
    return null;
  };

  const goNext = () => {
    setError(null);
    if (step === 1) {
      const message = validateBasics();
      if (message) {
        setError(message);
        return;
      }
      if (draft.websiteMode === "external") {
        setStep(4);
        return;
      }
    }
    if (step === 2) {
      const message = validateLanding();
      if (message) {
        setError(message);
        return;
      }
    }
    setStep((prev) => (prev < 4 ? ((prev + 1) as 1 | 2 | 3 | 4) : prev));
  };

  const goBack = () => {
    setError(null);
    setStep((prev) => (prev > 1 ? ((prev - 1) as 1 | 2 | 3 | 4) : prev));
  };

  const handleCreate = async () => {
    setError(null);
    setNotice(null);
    const basicsError = validateBasics();
    if (basicsError) {
      setStep(1);
      setError(basicsError);
      return;
    }
    const landingError = validateLanding();
    if (landingError) {
      setStep(2);
      setError(landingError);
      return;
    }

    setCreating(true);

    const isExternal = draft.websiteMode === "external";
    const proofPoints = isExternal ? [] : normalizeList(draft.proofChips);
    const whyChoose = isExternal ? [] : normalizeList(draft.whyChoose);
    const gallery = isExternal ? [] : normalizeList(draft.gallery);
    const faqs = isExternal ? [] : normalizeFaqs(draft.faqs);

    const trimmedHeadline = draft.headline.trim();
    const trimmedSubheadline = draft.subheadline.trim();
    const trimmedWhatsApp = draft.whatsappNumber.trim();
    let landingContent: LandingConfigV1 | null = null;

    if (!isExternal) {
      landingContent = {
        version: 1,
        vertical: draft.vertical as LandingConfigV1["vertical"],
        brand: {
          name: draft.name.trim(),
          tagline: trimmedSubheadline
        },
        contact: {
          phone: draft.phoneNumber.trim(),
          whatsapp: trimmedWhatsApp || draft.phoneNumber.trim(),
          address_line: draft.address.trim()
        },
        cta: {
          primary: {
            type: draft.primaryCtaType,
            label: primaryPreviewLabel,
            prefill_template: "Hi, I want to enquire about {brand_name}."
          }
        },
        hero: {
          headline: trimmedHeadline,
          subheadline: trimmedSubheadline,
          proof_chips: proofPoints,
          snapshot: {
            title: "Quick snapshot",
            bullets: proofPoints
          }
        },
        sections: {}
      };

      if (whyChoose.length > 0) {
        landingContent.sections = landingContent.sections ?? {};
        landingContent.sections.why_choose = {
          items: whyChoose.map((item) => ({
            title: item,
            body: "Details available on request."
          }))
        };
      }

      if (gallery.length > 0) {
        landingContent.sections = landingContent.sections ?? {};
        landingContent.sections.gallery = {
          images: gallery.map((url) => ({ url, caption: "" }))
        };
      }

      if (faqs.length > 0) {
        landingContent.sections = landingContent.sections ?? {};
        landingContent.sections.faq = {
          items: faqs.map((item) => ({ q: item.question, a: item.answer }))
        };
      }
    }

    const payload: Record<string, unknown> = {
      p_name: draft.name.trim(),
      p_slug: draft.slug.trim().toLowerCase(),
      p_status: draft.status,
      p_vertical: draft.vertical,
      p_tagline: trimmedSubheadline || null,
      p_contact_phone: draft.phoneNumber.trim() || null,
      p_contact_email: null,
      p_address: draft.address.trim() || null,
      p_primary_color: null,
      p_landing_content: landingContent,
      p_trust_points: !isExternal && proofPoints.length > 0 ? proofPoints : null
    };

    const { data, error: createError } = await supabase.rpc(
      "create_tenant_full",
      payload
    );

    if (createError) {
      setError(createError.message);
      setCreating(false);
      return;
    }

    const createdRow = Array.isArray(data) ? data[0] : data;
    if (!createdRow?.tenant_id || !createdRow?.slug) {
      setError("Tenant created, but details are missing.");
      setCreating(false);
      return;
    }

    let noticeMessage = isExternal
      ? "Tenant created for external marketing site."
      : "Tenant created with landing configuration.";

    if (isExternal) {
      const nowIso = new Date().toISOString();
      const { error: disableError } = await supabase
        .from("tenant_features")
        .update({
          enabled: false,
          disabled_at: nowIso,
          enabled_by: session?.user.id ?? null
        })
        .eq("tenant_id", createdRow.tenant_id)
        .eq("feature_key", "landing");

      if (disableError) {
        noticeMessage = `${noticeMessage} Landing feature could not be disabled.`;
      }
    }

    setCreatedTenant({
      tenantId: createdRow.tenant_id,
      slug: createdRow.slug,
      name: draft.name.trim()
    });
    setNotice(noticeMessage);
    setCreating(false);
  };

  const handleCopyLink = async (label: string, link: string) => {
    try {
      await navigator.clipboard.writeText(link);
      setCopyMessage(`${label} copied`);
      setTimeout(() => setCopyMessage(null), 2000);
    } catch (copyError) {
      setCopyMessage("Copy failed");
      setTimeout(() => setCopyMessage(null), 2000);
    }
  };

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    router.push("/");
  };

  const appBaseUrl =
    process.env.NEXT_PUBLIC_APP_URL ??
    (typeof window !== "undefined" ? window.location.origin : "");
  const createdLandingUrl = createdTenant
    ? `${appBaseUrl.replace(/\/$/, "")}/t/${createdTenant.slug}`
    : "";
  const createdAdminUrl = createdTenant
    ? `${appBaseUrl.replace(/\/$/, "")}/t/${createdTenant.slug}/admin`
    : "";

  if (loading) {
    return (
      <div className="card">
        <h1>Create tenant</h1>
        <p className="muted">Checking access...</p>
      </div>
    );
  }

  if (accessDenied) {
    return (
      <div className="card">
        <h1>Access denied</h1>
        <p className="muted">Your account is not an active platform user.</p>
        <button className="button secondary" onClick={handleSignOut}>
          Sign out
        </button>
      </div>
    );
  }

  return (
    <div className="create-tenant-shell">
      <div className="create-tenant-header">
        <div>
          <p className="muted">Super Admin</p>
          <h1>Create tenant</h1>
          <p className="muted">
            Configure landing content (optional) before publishing.
          </p>
        </div>
        <div className="create-tenant-header-actions">
          <Link className="button secondary" href="/super">
            Back to Super Admin
          </Link>
          <span className="muted">{session?.user.email ?? session?.user.id}</span>
          <button className="button secondary" onClick={handleSignOut}>
            Sign out
          </button>
        </div>
      </div>

      {error && <div className="error">{error}</div>}
      {notice && <div className="notice">{notice}</div>}

      {createdTenant ? (
        <div className="card create-tenant-card">
          <h2>Tenant created</h2>
          <p className="muted">
            {createdTenant.name} is ready.{" "}
            {isExternalWebsite
              ? "External website mode is enabled."
              : "Share the landing and start collecting leads."}
          </p>
          <div className="create-preview-list">
            <div>
              <strong>Landing</strong>
              <p className="muted">{createdLandingUrl}</p>
            </div>
            <div>
              <strong>Admin</strong>
              <p className="muted">{createdAdminUrl}</p>
            </div>
          </div>
          <div className="create-actions">
            <a className="button" href={createdLandingUrl} target="_blank" rel="noreferrer">
              Open Landing
            </a>
            <a className="button secondary" href={createdAdminUrl} target="_blank" rel="noreferrer">
              Open Admin
            </a>
            <button
              className="button secondary"
              type="button"
              onClick={() => handleCopyLink("Landing link", createdLandingUrl)}
            >
              Copy Landing Link
            </button>
            <button
              className="button secondary"
              type="button"
              onClick={() => handleCopyLink("Admin link", createdAdminUrl)}
            >
              Copy Admin Link
            </button>
          </div>
          {copyMessage && <p className="muted">{copyMessage}</p>}
          <button
            className="button secondary"
            type="button"
            onClick={() => {
              setCreatedTenant(null);
              setDraft(emptyDraft);
              setStep(1);
              setSlugEdited(false);
              setCtaTouched(false);
            }}
          >
            Create another tenant
          </button>
        </div>
      ) : (
        <div className="card create-tenant-card">
          <div className="create-stepper">
            {steps.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`create-step ${step === item.id ? "active" : ""} ${
                  step > item.id ? "complete" : ""
                }`}
                onClick={() => {
                  if (item.id <= step) {
                    setStep(item.id as 1 | 2 | 3 | 4);
                  }
                }}
              >
                <span>{item.id}</span>
                {item.label}
              </button>
            ))}
          </div>

          {step === 1 && (
            <div className="create-step-body">
              <div className="create-grid">
                <label className="field">
                  <span>Tenant name</span>
                  <input
                    type="text"
                    value={draft.name}
                    onChange={(event) =>
                      setDraft((prev) => ({ ...prev, name: event.target.value }))
                    }
                    placeholder="Jyoti PG"
                    required
                  />
                </label>
                <label className="field">
                  <span>Slug</span>
                  <input
                    type="text"
                    value={draft.slug}
                    onChange={(event) => {
                      setSlugEdited(true);
                      setDraft((prev) => ({
                        ...prev,
                        slug: normalizeSlug(event.target.value)
                      }));
                    }}
                    placeholder="jyoti-pg"
                    required
                  />
                </label>
                <label className="field">
                  <span>Vertical</span>
                  <select
                    value={draft.vertical}
                    onChange={(event) =>
                      setDraft((prev) => ({ ...prev, vertical: event.target.value }))
                    }
                  >
                    <option value="pg">PG</option>
                    <option value="clinic">Clinic</option>
                    <option value="salon">Salon</option>
                    <option value="coaching">Coaching</option>
                    <option value="cab">Cab</option>
                  </select>
                </label>
                <label className="field">
                  <span>Status</span>
                  <select
                    value={draft.status}
                    onChange={(event) =>
                      setDraft((prev) => ({ ...prev, status: event.target.value }))
                    }
                  >
                    <option value="active">Active</option>
                    <option value="paused">Paused</option>
                    <option value="archived">Archived</option>
                  </select>
                </label>
                <label className="field">
                  <span>Website mode</span>
                  <select
                    value={draft.websiteMode}
                    onChange={(event) =>
                      setDraft((prev) => ({
                        ...prev,
                        websiteMode: event.target.value as LandingDraft["websiteMode"]
                      }))
                    }
                  >
                    <option value="landing">Use Uni-Leads landing page</option>
                    <option value="external">
                      Client has own website (external marketing site)
                    </option>
                  </select>
                </label>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="create-step-body">
              {isExternalWebsite && (
                <div className="notice">
                  External website mode selected. Landing fields are optional and
                  can be skipped.
                </div>
              )}
              <div className="create-grid">
                <label className="field">
                  <span>Headline (H1)</span>
                  <input
                    type="text"
                    value={draft.headline}
                    onChange={(event) =>
                      setDraft((prev) => ({ ...prev, headline: event.target.value }))
                    }
                    placeholder="Premium stays for focused students"
                    required={!isExternalWebsite}
                  />
                </label>
                <label className="field">
                  <span>Subheadline</span>
                  <input
                    type="text"
                    value={draft.subheadline}
                    onChange={(event) =>
                      setDraft((prev) => ({ ...prev, subheadline: event.target.value }))
                    }
                    placeholder="Safe, calm, and just minutes from coaching."
                    required={!isExternalWebsite}
                  />
                </label>
              </div>

              <div className="create-section">
                <div className="section-title">Proof chips</div>
                <div className="create-grid">
                  {draft.proofChips.map((chip, index) => (
                    <label className="field" key={`proof-${index}`}>
                      <span>Chip {index + 1}</span>
                      <input
                        type="text"
                        value={chip}
                        onChange={(event) =>
                          setDraft((prev) => {
                            const next = [...prev.proofChips];
                            next[index] = event.target.value;
                            return { ...prev, proofChips: next };
                          })
                        }
                        placeholder="Fast WhatsApp response"
                      />
                    </label>
                  ))}
                </div>
              </div>

              <div className="create-section">
                <div className="section-title">Primary CTA</div>
                <div className="create-grid">
                  <label className="field">
                    <span>CTA type</span>
                    <select
                      value={draft.primaryCtaType}
                      onChange={(event) =>
                        setDraft((prev) => ({
                          ...prev,
                          primaryCtaType: event.target.value as LandingDraft["primaryCtaType"]
                        }))
                      }
                    >
                      <option value="whatsapp">WhatsApp</option>
                      <option value="call">Call</option>
                      <option value="enquire">Enquire</option>
                    </select>
                  </label>
                  <label className="field">
                    <span>CTA label</span>
                    <input
                      type="text"
                      value={draft.primaryCtaLabel}
                      onChange={(event) => {
                        setCtaTouched(true);
                        setDraft((prev) => ({
                          ...prev,
                          primaryCtaLabel: event.target.value
                        }));
                      }}
                      placeholder={defaultCtaLabel(draft.primaryCtaType)}
                    />
                  </label>
                  <label className="field">
                    <span>Phone number</span>
                    <input
                      type="tel"
                      value={draft.phoneNumber}
                      onChange={(event) =>
                        setDraft((prev) => ({ ...prev, phoneNumber: event.target.value }))
                      }
                      placeholder="+91 98xxxxxx"
                    />
                  </label>
                  <label className="field">
                    <span>WhatsApp number</span>
                    <input
                      type="tel"
                      value={draft.whatsappNumber}
                      onChange={(event) =>
                        setDraft((prev) => ({ ...prev, whatsappNumber: event.target.value }))
                      }
                      placeholder="+91 98xxxxxx"
                    />
                  </label>
                  <label className="field">
                    <span>Address / Location</span>
                    <input
                      type="text"
                      value={draft.address}
                      onChange={(event) =>
                        setDraft((prev) => ({ ...prev, address: event.target.value }))
                      }
                      placeholder="Sector 15, Jaipur"
                    />
                  </label>
                  <label className="field">
                    <span>Theme (coming soon)</span>
                    <input type="text" placeholder="Default" disabled />
                  </label>
                </div>
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="create-step-body">
              {isExternalWebsite && (
                <div className="notice">
                  External website mode selected. Trust sections are optional.
                </div>
              )}
              <div className="create-section">
                <div className="section-title">Why choose us</div>
                <div className="create-grid">
                  {draft.whyChoose.map((item, index) => (
                    <label className="field" key={`why-${index}`}>
                      <span>Point {index + 1}</span>
                      <input
                        type="text"
                        value={item}
                        onChange={(event) =>
                          setDraft((prev) => {
                            const next = [...prev.whyChoose];
                            next[index] = event.target.value;
                            return { ...prev, whyChoose: next };
                          })
                        }
                        placeholder="Verified staff, safety assured"
                      />
                    </label>
                  ))}
                </div>
              </div>

              <div className="create-section">
                <div className="section-title">Gallery</div>
                <div className="create-grid">
                  <label className="field">
                    <span>Upload (coming soon)</span>
                    <input type="text" placeholder="Upload support coming soon" disabled />
                  </label>
                  {draft.gallery.slice(0, 3).map((item, index) => (
                    <label className="field" key={`gallery-${index}`}>
                      <span>Image URL {index + 1}</span>
                      <input
                        type="url"
                        value={item}
                        onChange={(event) =>
                          setDraft((prev) => {
                            const next = [...prev.gallery];
                            next[index] = event.target.value;
                            return { ...prev, gallery: next };
                          })
                        }
                        placeholder="https://..."
                      />
                    </label>
                  ))}
                </div>
              </div>

              <div className="create-section">
                <div className="section-title">FAQ</div>
                <div className="create-faq-grid">
                  {draft.faqs.map((item, index) => (
                    <div className="create-faq" key={`faq-${index}`}>
                      <label className="field">
                        <span>Question {index + 1}</span>
                        <input
                          type="text"
                          value={item.question}
                          onChange={(event) =>
                            setDraft((prev) => {
                              const next = [...prev.faqs];
                              next[index] = { ...next[index], question: event.target.value };
                              return { ...prev, faqs: next };
                            })
                          }
                          placeholder="Do you have meal plans?"
                        />
                      </label>
                      <label className="field">
                        <span>Answer</span>
                        <input
                          type="text"
                          value={item.answer}
                          onChange={(event) =>
                            setDraft((prev) => {
                              const next = [...prev.faqs];
                              next[index] = { ...next[index], answer: event.target.value };
                              return { ...prev, faqs: next };
                            })
                          }
                          placeholder="Yes, homely meals are included."
                        />
                      </label>
                    </div>
                  ))}
                </div>
                {draft.faqs.length < 5 && (
                  <button
                    type="button"
                    className="button secondary"
                    onClick={() =>
                      setDraft((prev) => ({
                        ...prev,
                        faqs: [...prev.faqs, { question: "", answer: "" }]
                      }))
                    }
                  >
                    Add FAQ
                  </button>
                )}
              </div>
            </div>
          )}

          {step === 4 && (
            <div className="create-step-body">
              <div className="create-preview">
                <div>
                  <div className="section-title">Tenant basics</div>
                  <div className="create-preview-list">
                    <div>
                      <strong>Name</strong>
                      <p className="muted">{draft.name || "-"}</p>
                    </div>
                    <div>
                      <strong>Slug</strong>
                      <p className="muted">{draft.slug || "-"}</p>
                    </div>
                    <div>
                      <strong>Vertical</strong>
                      <p className="muted">{draft.vertical || "-"}</p>
                    </div>
                    <div>
                      <strong>Status</strong>
                      <p className="muted">{draft.status || "-"}</p>
                    </div>
                    <div>
                      <strong>Website mode</strong>
                      <p className="muted">{websiteModeLabel}</p>
                    </div>
                  </div>
                </div>
                <div>
                  <div className="section-title">Landing preview</div>
                  {isExternalWebsite ? (
                    <div className="notice">
                      External website mode selected. Landing content can be configured
                      later if needed.
                    </div>
                  ) : (
                    <div className="create-preview-list">
                      <div>
                        <strong>Headline</strong>
                        <p className="muted">{draft.headline || "-"}</p>
                      </div>
                      <div>
                        <strong>Subheadline</strong>
                        <p className="muted">{draft.subheadline || "-"}</p>
                      </div>
                      <div>
                        <strong>Primary CTA</strong>
                        <p className="muted">
                          {draft.primaryCtaType} - {primaryPreviewLabel}
                        </p>
                      </div>
                      <div>
                        <strong>Phone</strong>
                        <p className="muted">{draft.phoneNumber || "-"}</p>
                      </div>
                      <div>
                        <strong>WhatsApp</strong>
                        <p className="muted">{draft.whatsappNumber || "-"}</p>
                      </div>
                    </div>
                  )}
                </div>
              </div>
              <div className="notice">
                Review the essentials, then create the tenant. You can still edit
                landing settings later.
              </div>
            </div>
          )}

          <div className="create-actions">
            <button
              type="button"
              className="button secondary"
              onClick={goBack}
              disabled={step === 1}
            >
              Back
            </button>
            {step < 4 ? (
              <button type="button" className="button" onClick={goNext}>
                Continue
              </button>
            ) : (
              <button
                type="button"
                className="button"
                onClick={handleCreate}
                disabled={creating}
              >
                {creating ? "Creating..." : "Create tenant"}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
