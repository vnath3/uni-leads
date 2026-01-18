"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import {
  resolveLandingConfig,
  type LandingConfigResolved,
  type LandingConfigV1,
  type LandingSettings
} from "@/lib/landingConfig";

type LandingSettingsResponse = LandingSettings & {
  lead_form_schema?: Record<string, unknown> | null;
};

const trimValue = (value: string) => value.trim();

const normalizeStringList = (items: string[]) =>
  items.map((item) => item.trim()).filter((item) => item.length > 0);

const buildLandingPayload = (draft: LandingConfigResolved): LandingConfigV1 => ({
  version: 1,
  vertical: draft.vertical,
  brand: {
    name: trimValue(draft.brand.name),
    tagline: trimValue(draft.brand.tagline),
    badge: trimValue(draft.brand.badge)
  },
  contact: {
    phone: trimValue(draft.contact.phone),
    whatsapp: trimValue(draft.contact.whatsapp),
    email: trimValue(draft.contact.email),
    address_line: trimValue(draft.contact.address_line),
    map_url: trimValue(draft.contact.map_url),
    hours: draft.contact.hours
      .map((slot) => ({
        label: trimValue(slot.label),
        value: trimValue(slot.value)
      }))
      .filter((slot) => slot.label.length > 0 || slot.value.length > 0)
  },
  cta: {
    primary: {
      type: draft.cta.primary.type,
      label: trimValue(draft.cta.primary.label),
      prefill_template: trimValue(draft.cta.primary.prefill_template)
    },
    secondary: {
      type: draft.cta.secondary.type,
      label: trimValue(draft.cta.secondary.label)
    },
    sticky_bar: {
      enabled: draft.cta.sticky_bar.enabled,
      show_enquire: draft.cta.sticky_bar.show_enquire
    }
  },
  hero: {
    headline: trimValue(draft.hero.headline),
    subheadline: trimValue(draft.hero.subheadline),
    proof_chips: normalizeStringList(draft.hero.proof_chips),
    snapshot: {
      title: trimValue(draft.hero.snapshot.title),
      bullets: normalizeStringList(draft.hero.snapshot.bullets)
    },
    media: {
      hero_image_url: trimValue(draft.hero.media.hero_image_url),
      gallery_strip_enabled: draft.hero.media.gallery_strip_enabled
    }
  },
  sections: {
    why_choose: {
      enabled: draft.sections.why_choose.enabled,
      title: trimValue(draft.sections.why_choose.title),
      subtitle: trimValue(draft.sections.why_choose.subtitle),
      items: draft.sections.why_choose.items
        .map((item) => ({
          title: trimValue(item.title),
          body: trimValue(item.body)
        }))
        .filter((item) => item.title.length > 0)
    },
    gallery: {
      enabled: draft.sections.gallery.enabled,
      title: trimValue(draft.sections.gallery.title),
      images: draft.sections.gallery.images
        .map((item) => ({
          url: trimValue(item.url),
          caption: trimValue(item.caption)
        }))
        .filter((item) => item.url.length > 0)
    },
    services: {
      enabled: draft.sections.services.enabled,
      title: trimValue(draft.sections.services.title),
      subtitle: trimValue(draft.sections.services.subtitle),
      pricing_note: trimValue(draft.sections.services.pricing_note),
      items: draft.sections.services.items
        .map((item) => ({
          title: trimValue(item.title),
          price: trimValue(item.price),
          body: trimValue(item.body)
        }))
        .filter((item) => item.title.length > 0)
    },
    testimonials: {
      enabled: draft.sections.testimonials.enabled,
      title: trimValue(draft.sections.testimonials.title),
      subtitle: trimValue(draft.sections.testimonials.subtitle),
      items: draft.sections.testimonials.items
        .map((item) => ({
          quote: trimValue(item.quote),
          name: trimValue(item.name),
          role: trimValue(item.role)
        }))
        .filter((item) => item.quote.length > 0)
    },
    faq: {
      enabled: draft.sections.faq.enabled,
      title: trimValue(draft.sections.faq.title),
      subtitle: trimValue(draft.sections.faq.subtitle),
      items: draft.sections.faq.items
        .map((item) => ({
          q: trimValue(item.q),
          a: trimValue(item.a)
        }))
        .filter((item) => item.q.length > 0 && item.a.length > 0)
    },
    location: {
      enabled: draft.sections.location.enabled,
      title: trimValue(draft.sections.location.title),
      subtitle: trimValue(draft.sections.location.subtitle),
      show_map_button: draft.sections.location.show_map_button,
      show_contact_card: draft.sections.location.show_contact_card
    }
  },
  footer: {
    show_share: draft.footer.show_share,
    share_label: trimValue(draft.footer.share_label),
    developer_credit: {
      enabled: draft.footer.developer_credit.enabled,
      label: trimValue(draft.footer.developer_credit.label),
      url: trimValue(draft.footer.developer_credit.url)
    }
  },
  theme: {
    theme_id: trimValue(draft.theme.theme_id)
  }
});

const cloneDraft = (draft: LandingConfigResolved): LandingConfigResolved => {
  if (typeof structuredClone === "function") {
    return structuredClone(draft);
  }
  return JSON.parse(JSON.stringify(draft)) as LandingConfigResolved;
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

export default function SuperTenantLandingEditorPage() {
  const params = useParams();
  const router = useRouter();
  const tenantIdRaw = params?.tenant_id;
  const tenantId = Array.isArray(tenantIdRaw) ? tenantIdRaw[0] : tenantIdRaw;

  const [loading, setLoading] = useState(true);
  const [accessDenied, setAccessDenied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState<LandingConfigResolved | null>(null);
  const [settings, setSettings] = useState<LandingSettingsResponse | null>(null);
  const [leadSchema, setLeadSchema] = useState<Record<string, unknown>>({});
  const [tenantName, setTenantName] = useState<string | null>(null);
  const [tenantSlug, setTenantSlug] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    const load = async () => {
      setLoading(true);
      setError(null);

      if (!tenantId) {
        setError("Tenant identifier is missing.");
        setLoading(false);
        return;
      }

      const { data, error: sessionError } = await supabase.auth.getSession();
      if (!active) return;

      if (sessionError || !data.session) {
        setAccessDenied(true);
        setLoading(false);
        return;
      }

      const platform = await checkPlatformUser(data.session.user.id);
      if (!active) return;

      if (platform.error || !platform.data) {
        setAccessDenied(true);
        setLoading(false);
        return;
      }

      const [tenantRes, slugRes] = await Promise.all([
        supabase.from("tenants").select("name").eq("id", tenantId).maybeSingle(),
        supabase
          .from("tenant_identities")
          .select("value")
          .eq("tenant_id", tenantId)
          .eq("identity_type", "slug")
          .order("is_primary", { ascending: false })
          .limit(1)
          .maybeSingle()
      ]);

      if (!active) return;

      if (tenantRes.error || slugRes.error) {
        setError((tenantRes.error ?? slugRes.error)?.message ?? "Failed to load tenant.");
        setLoading(false);
        return;
      }

      const resolvedSlug = slugRes.data?.value ?? null;
      setTenantSlug(resolvedSlug);
      setTenantName(tenantRes.data?.name ?? null);

      if (!resolvedSlug) {
        setError("Tenant slug is missing. Landing settings cannot be loaded.");
        setLoading(false);
        return;
      }

      const { data: landingData, error: landingError } = await supabase
        .schema("public")
        .rpc("get_landing_settings", {
          p_identity_type: "slug",
          p_identity_value: resolvedSlug
        });

      if (!active) return;

      if (landingError || !landingData) {
        setError(landingError?.message ?? "Landing settings unavailable.");
        setLoading(false);
        return;
      }

      const landingSettings = landingData as LandingSettingsResponse;
      setSettings(landingSettings);
      const nextSchema =
        landingSettings.lead_form_schema && typeof landingSettings.lead_form_schema === "object"
          ? landingSettings.lead_form_schema
          : {};
      setLeadSchema(nextSchema);
      setDraft(resolveLandingConfig(landingSettings, { slug: resolvedSlug }));
      setLoading(false);
    };

    void load();

    return () => {
      active = false;
    };
  }, [tenantId]);

  const updateDraftValue = (path: (string | number)[], value: unknown) => {
    setDraft((prev) => {
      if (!prev) return prev;
      const next = cloneDraft(prev);
      let cursor: any = next;
      for (let i = 0; i < path.length - 1; i += 1) {
        cursor = cursor[path[i]];
      }
      cursor[path[path.length - 1]] = value;
      return next;
    });
  };

  const addListItem = (path: (string | number)[], value: unknown) => {
    setDraft((prev) => {
      if (!prev) return prev;
      const next = cloneDraft(prev);
      let cursor: any = next;
      for (const key of path) {
        cursor = cursor[key];
      }
      cursor.push(value);
      return next;
    });
  };

  const removeListItem = (path: (string | number)[], index: number) => {
    setDraft((prev) => {
      if (!prev) return prev;
      const next = cloneDraft(prev);
      let cursor: any = next;
      for (const key of path) {
        cursor = cursor[key];
      }
      cursor.splice(index, 1);
      return next;
    });
  };

  const handleSave = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!draft || !tenantId) return;

    setSaving(true);
    setError(null);
    setNotice(null);

    const payload = buildLandingPayload(draft);
    const nextSchema = {
      ...(leadSchema ?? {}),
      landing: payload
    };

    const { data, error: updateError } = await supabase
      .from("landing_settings")
      .update({ lead_form_schema: nextSchema })
      .eq("tenant_id", tenantId)
      .select("lead_form_schema")
      .maybeSingle();

    if (updateError) {
      setError(updateError.message);
      setSaving(false);
      return;
    }

    if (data?.lead_form_schema && typeof data.lead_form_schema === "object") {
      setLeadSchema(data.lead_form_schema as Record<string, unknown>);
    }

    setNotice("Landing settings saved.");
    setSaving(false);
  };

  const handleReset = async () => {
    if (!tenantId || !settings) return;
    setSaving(true);
    setError(null);
    setNotice(null);

    const nextSchema = {
      ...(leadSchema ?? {}),
      landing: {}
    };

    const { data, error: resetError } = await supabase
      .from("landing_settings")
      .update({ lead_form_schema: nextSchema })
      .eq("tenant_id", tenantId)
      .select("lead_form_schema")
      .maybeSingle();

    if (resetError) {
      setError(resetError.message);
      setSaving(false);
      return;
    }

    if (data?.lead_form_schema && typeof data.lead_form_schema === "object") {
      setLeadSchema(data.lead_form_schema as Record<string, unknown>);
    }

    setDraft(
      resolveLandingConfig(
        { ...settings, lead_form_schema: nextSchema },
        { slug: tenantSlug ?? undefined }
      )
    );
    setNotice("Landing config reset to defaults.");
    setSaving(false);
  };

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    router.push("/");
  };

  if (loading) {
    return (
      <div className="card">
        <h1>Landing settings</h1>
        <p className="muted">Loading tenant configuration...</p>
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

  if (error || !draft) {
    return (
      <div className="card">
        <h1>Landing settings</h1>
        <div className="error">{error ?? "Landing settings unavailable."}</div>
        <Link className="button secondary" href="/super">
          Back to Super Admin
        </Link>
      </div>
    );
  }

  return (
    <div className="card">
      <div className="card-header">
        <div>
          <p className="muted">Landing settings</p>
          <h1>{tenantName ?? "Tenant landing"}</h1>
          <p className="muted">{tenantSlug ? `/${tenantSlug}` : "Slug unavailable"}</p>
        </div>
        <div className="drawer-actions">
          {tenantSlug && (
            <Link
              className="button secondary"
              href={`/t/${tenantSlug}`}
              target="_blank"
              rel="noreferrer"
            >
              Open landing
            </Link>
          )}
          <Link className="button secondary" href="/super">
            Back to Super Admin
          </Link>
        </div>
      </div>

      {error && <div className="error">{error}</div>}
      {notice && <div className="notice">{notice}</div>}

      <form onSubmit={handleSave}>
        <div className="section">
          <div className="section-title">Brand</div>
          <label className="field">
            <span>Brand name</span>
            <input
              type="text"
              value={draft.brand.name}
              onChange={(event) => updateDraftValue(["brand", "name"], event.target.value)}
            />
          </label>
          <label className="field">
            <span>Tagline</span>
            <input
              type="text"
              value={draft.brand.tagline}
              onChange={(event) => updateDraftValue(["brand", "tagline"], event.target.value)}
            />
          </label>
          <label className="field">
            <span>Badge</span>
            <input
              type="text"
              value={draft.brand.badge}
              onChange={(event) => updateDraftValue(["brand", "badge"], event.target.value)}
            />
          </label>
          <label className="field">
            <span>Vertical</span>
            <select
              value={draft.vertical}
              onChange={(event) => updateDraftValue(["vertical"], event.target.value)}
            >
              <option value="pg">PG</option>
              <option value="clinic">Clinic</option>
              <option value="salon">Salon</option>
              <option value="coaching">Coaching</option>
              <option value="cab">Cab</option>
              <option value="generic">Generic</option>
            </select>
          </label>
        </div>

        <div className="section">
          <div className="section-title">Contact</div>
          <label className="field">
            <span>Phone</span>
            <input
              type="tel"
              value={draft.contact.phone}
              onChange={(event) => updateDraftValue(["contact", "phone"], event.target.value)}
            />
          </label>
          <label className="field">
            <span>WhatsApp</span>
            <input
              type="tel"
              value={draft.contact.whatsapp}
              onChange={(event) => updateDraftValue(["contact", "whatsapp"], event.target.value)}
            />
          </label>
          <label className="field">
            <span>Email</span>
            <input
              type="email"
              value={draft.contact.email}
              onChange={(event) => updateDraftValue(["contact", "email"], event.target.value)}
            />
          </label>
          <label className="field">
            <span>Address</span>
            <textarea
              rows={3}
              value={draft.contact.address_line}
              onChange={(event) => updateDraftValue(["contact", "address_line"], event.target.value)}
            />
          </label>
          <label className="field">
            <span>Map URL</span>
            <input
              type="text"
              value={draft.contact.map_url}
              onChange={(event) => updateDraftValue(["contact", "map_url"], event.target.value)}
            />
          </label>
          <div className="section-title">Hours</div>
          {draft.contact.hours.map((slot, index) => (
            <div className="section" key={`hour-${index}`}>
              <label className="field">
                <span>Label</span>
                <input
                  type="text"
                  value={slot.label}
                  onChange={(event) =>
                    updateDraftValue(["contact", "hours", index, "label"], event.target.value)
                  }
                />
              </label>
              <label className="field">
                <span>Value</span>
                <input
                  type="text"
                  value={slot.value}
                  onChange={(event) =>
                    updateDraftValue(["contact", "hours", index, "value"], event.target.value)
                  }
                />
              </label>
              <button
                type="button"
                className="button secondary"
                onClick={() => removeListItem(["contact", "hours"], index)}
              >
                Remove hour
              </button>
            </div>
          ))}
          <button
            type="button"
            className="button secondary"
            onClick={() => addListItem(["contact", "hours"], { label: "", value: "" })}
          >
            Add hour
          </button>
        </div>

        <div className="section">
          <div className="section-title">CTA + WhatsApp template</div>
          <label className="field">
            <span>Primary CTA type</span>
            <select
              value={draft.cta.primary.type}
              onChange={(event) => updateDraftValue(["cta", "primary", "type"], event.target.value)}
            >
              <option value="whatsapp">WhatsApp</option>
              <option value="call">Call</option>
              <option value="enquire">Enquire</option>
            </select>
          </label>
          <label className="field">
            <span>Primary CTA label</span>
            <input
              type="text"
              value={draft.cta.primary.label}
              onChange={(event) => updateDraftValue(["cta", "primary", "label"], event.target.value)}
            />
          </label>
          <label className="field">
            <span>WhatsApp prefill template</span>
            <textarea
              rows={3}
              value={draft.cta.primary.prefill_template}
              onChange={(event) =>
                updateDraftValue(["cta", "primary", "prefill_template"], event.target.value)
              }
              placeholder="Hi, I want to enquire about {brand_name}."
            />
          </label>
          <label className="field">
            <span>Secondary CTA type</span>
            <select
              value={draft.cta.secondary.type ?? ""}
              onChange={(event) =>
                updateDraftValue(["cta", "secondary", "type"], event.target.value || undefined)
              }
            >
              <option value="">Auto</option>
              <option value="call">Call</option>
              <option value="directions">Directions</option>
              <option value="pricing">Pricing</option>
              <option value="enquire">Enquire</option>
            </select>
          </label>
          <label className="field">
            <span>Secondary CTA label</span>
            <input
              type="text"
              value={draft.cta.secondary.label}
              onChange={(event) => updateDraftValue(["cta", "secondary", "label"], event.target.value)}
            />
          </label>
          <label className="toggle">
            <input
              type="checkbox"
              checked={draft.cta.sticky_bar.enabled}
              onChange={(event) =>
                updateDraftValue(["cta", "sticky_bar", "enabled"], event.target.checked)
              }
            />
            <span>Sticky CTA bar enabled</span>
          </label>
          <label className="toggle">
            <input
              type="checkbox"
              checked={draft.cta.sticky_bar.show_enquire}
              onChange={(event) =>
                updateDraftValue(["cta", "sticky_bar", "show_enquire"], event.target.checked)
              }
            />
            <span>Show Enquire in sticky bar</span>
          </label>
        </div>

        <div className="section">
          <div className="section-title">Hero</div>
          <label className="field">
            <span>Headline</span>
            <input
              type="text"
              value={draft.hero.headline}
              onChange={(event) => updateDraftValue(["hero", "headline"], event.target.value)}
            />
          </label>
          <label className="field">
            <span>Subheadline</span>
            <input
              type="text"
              value={draft.hero.subheadline}
              onChange={(event) => updateDraftValue(["hero", "subheadline"], event.target.value)}
            />
          </label>
          <label className="field">
            <span>Hero image URL</span>
            <input
              type="text"
              value={draft.hero.media.hero_image_url}
              onChange={(event) =>
                updateDraftValue(["hero", "media", "hero_image_url"], event.target.value)
              }
            />
          </label>
          <label className="toggle">
            <input
              type="checkbox"
              checked={draft.hero.media.gallery_strip_enabled}
              onChange={(event) =>
                updateDraftValue(["hero", "media", "gallery_strip_enabled"], event.target.checked)
              }
            />
            <span>Show gallery strip in hero</span>
          </label>
          <div className="section-title">Proof chips</div>
          {draft.hero.proof_chips.map((chip, index) => (
            <div className="section" key={`chip-${index}`}>
              <label className="field">
                <span>Chip {index + 1}</span>
                <input
                  type="text"
                  value={chip}
                  onChange={(event) => updateDraftValue(["hero", "proof_chips", index], event.target.value)}
                />
              </label>
              <button
                type="button"
                className="button secondary"
                onClick={() => removeListItem(["hero", "proof_chips"], index)}
              >
                Remove chip
              </button>
            </div>
          ))}
          <button
            type="button"
            className="button secondary"
            onClick={() => addListItem(["hero", "proof_chips"], "")}
          >
            Add chip
          </button>
          <div className="section-title">Snapshot</div>
          <label className="field">
            <span>Snapshot title</span>
            <input
              type="text"
              value={draft.hero.snapshot.title}
              onChange={(event) => updateDraftValue(["hero", "snapshot", "title"], event.target.value)}
            />
          </label>
          {draft.hero.snapshot.bullets.map((bullet, index) => (
            <div className="section" key={`bullet-${index}`}>
              <label className="field">
                <span>Bullet {index + 1}</span>
                <input
                  type="text"
                  value={bullet}
                  onChange={(event) => updateDraftValue(["hero", "snapshot", "bullets", index], event.target.value)}
                />
              </label>
              <button
                type="button"
                className="button secondary"
                onClick={() => removeListItem(["hero", "snapshot", "bullets"], index)}
              >
                Remove bullet
              </button>
            </div>
          ))}
          <button
            type="button"
            className="button secondary"
            onClick={() => addListItem(["hero", "snapshot", "bullets"], "")}
          >
            Add bullet
          </button>
        </div>

        <div className="section">
          <div className="section-title">Why choose us</div>
          {draft.sections.why_choose.items.map((item, index) => (
            <div className="section" key={`why-${index}`}>
              <label className="field">
                <span>Title</span>
                <input
                  type="text"
                  value={item.title}
                  onChange={(event) => updateDraftValue(["sections", "why_choose", "items", index, "title"], event.target.value)}
                />
              </label>
              <label className="field">
                <span>Body</span>
                <textarea
                  rows={2}
                  value={item.body}
                  onChange={(event) => updateDraftValue(["sections", "why_choose", "items", index, "body"], event.target.value)}
                />
              </label>
              <button
                type="button"
                className="button secondary"
                onClick={() => removeListItem(["sections", "why_choose", "items"], index)}
              >
                Remove item
              </button>
            </div>
          ))}
          <button
            type="button"
            className="button secondary"
            onClick={() => addListItem(["sections", "why_choose", "items"], { title: "", body: "" })}
          >
            Add item
          </button>
        </div>

        <div className="section">
          <div className="section-title">Gallery images</div>
          {draft.sections.gallery.images.map((item, index) => (
            <div className="section" key={`gallery-${index}`}>
              <label className="field">
                <span>Image URL</span>
                <input
                  type="text"
                  value={item.url}
                  onChange={(event) => updateDraftValue(["sections", "gallery", "images", index, "url"], event.target.value)}
                />
              </label>
              <label className="field">
                <span>Caption</span>
                <input
                  type="text"
                  value={item.caption}
                  onChange={(event) => updateDraftValue(["sections", "gallery", "images", index, "caption"], event.target.value)}
                />
              </label>
              <button
                type="button"
                className="button secondary"
                onClick={() => removeListItem(["sections", "gallery", "images"], index)}
              >
                Remove image
              </button>
            </div>
          ))}
          <button
            type="button"
            className="button secondary"
            onClick={() => addListItem(["sections", "gallery", "images"], { url: "", caption: "" })}
          >
            Add image
          </button>
        </div>

        <div className="section">
          <div className="section-title">Services items</div>
          {draft.sections.services.items.map((item, index) => (
            <div className="section" key={`service-${index}`}>
              <label className="field">
                <span>Title</span>
                <input
                  type="text"
                  value={item.title}
                  onChange={(event) => updateDraftValue(["sections", "services", "items", index, "title"], event.target.value)}
                />
              </label>
              <label className="field">
                <span>Price</span>
                <input
                  type="text"
                  value={item.price}
                  onChange={(event) => updateDraftValue(["sections", "services", "items", index, "price"], event.target.value)}
                />
              </label>
              <label className="field">
                <span>Body</span>
                <textarea
                  rows={2}
                  value={item.body}
                  onChange={(event) => updateDraftValue(["sections", "services", "items", index, "body"], event.target.value)}
                />
              </label>
              <button
                type="button"
                className="button secondary"
                onClick={() => removeListItem(["sections", "services", "items"], index)}
              >
                Remove item
              </button>
            </div>
          ))}
          <button
            type="button"
            className="button secondary"
            onClick={() => addListItem(["sections", "services", "items"], { title: "", price: "", body: "" })}
          >
            Add item
          </button>
        </div>

        <div className="section">
          <div className="section-title">Testimonials</div>
          {draft.sections.testimonials.items.map((item, index) => (
            <div className="section" key={`testimonial-${index}`}>
              <label className="field">
                <span>Quote</span>
                <textarea
                  rows={2}
                  value={item.quote}
                  onChange={(event) => updateDraftValue(["sections", "testimonials", "items", index, "quote"], event.target.value)}
                />
              </label>
              <label className="field">
                <span>Name</span>
                <input
                  type="text"
                  value={item.name}
                  onChange={(event) => updateDraftValue(["sections", "testimonials", "items", index, "name"], event.target.value)}
                />
              </label>
              <label className="field">
                <span>Role</span>
                <input
                  type="text"
                  value={item.role}
                  onChange={(event) => updateDraftValue(["sections", "testimonials", "items", index, "role"], event.target.value)}
                />
              </label>
              <button
                type="button"
                className="button secondary"
                onClick={() => removeListItem(["sections", "testimonials", "items"], index)}
              >
                Remove testimonial
              </button>
            </div>
          ))}
          <button
            type="button"
            className="button secondary"
            onClick={() => addListItem(["sections", "testimonials", "items"], { quote: "", name: "", role: "" })}
          >
            Add testimonial
          </button>
        </div>

        <div className="section">
          <div className="section-title">FAQ</div>
          {draft.sections.faq.items.map((item, index) => (
            <div className="section" key={`faq-${index}`}>
              <label className="field">
                <span>Question</span>
                <input
                  type="text"
                  value={item.q}
                  onChange={(event) => updateDraftValue(["sections", "faq", "items", index, "q"], event.target.value)}
                />
              </label>
              <label className="field">
                <span>Answer</span>
                <textarea
                  rows={2}
                  value={item.a}
                  onChange={(event) => updateDraftValue(["sections", "faq", "items", index, "a"], event.target.value)}
                />
              </label>
              <button
                type="button"
                className="button secondary"
                onClick={() => removeListItem(["sections", "faq", "items"], index)}
              >
                Remove FAQ
              </button>
            </div>
          ))}
          <button
            type="button"
            className="button secondary"
            onClick={() => addListItem(["sections", "faq", "items"], { q: "", a: "" })}
          >
            Add FAQ
          </button>
        </div>

        <div className="section">
          <div className="section-title">Section toggles</div>
          <label className="toggle">
            <input
              type="checkbox"
              checked={draft.sections.why_choose.enabled}
              onChange={(event) => updateDraftValue(["sections", "why_choose", "enabled"], event.target.checked)}
            />
            <span>Why choose us</span>
          </label>
          <label className="toggle">
            <input
              type="checkbox"
              checked={draft.sections.gallery.enabled}
              onChange={(event) => updateDraftValue(["sections", "gallery", "enabled"], event.target.checked)}
            />
            <span>Gallery</span>
          </label>
          <label className="toggle">
            <input
              type="checkbox"
              checked={draft.sections.services.enabled}
              onChange={(event) => updateDraftValue(["sections", "services", "enabled"], event.target.checked)}
            />
            <span>Services</span>
          </label>
          <label className="toggle">
            <input
              type="checkbox"
              checked={draft.sections.testimonials.enabled}
              onChange={(event) => updateDraftValue(["sections", "testimonials", "enabled"], event.target.checked)}
            />
            <span>Testimonials</span>
          </label>
          <label className="toggle">
            <input
              type="checkbox"
              checked={draft.sections.faq.enabled}
              onChange={(event) => updateDraftValue(["sections", "faq", "enabled"], event.target.checked)}
            />
            <span>FAQ</span>
          </label>
          <label className="toggle">
            <input
              type="checkbox"
              checked={draft.sections.location.enabled}
              onChange={(event) => updateDraftValue(["sections", "location", "enabled"], event.target.checked)}
            />
            <span>Location section</span>
          </label>
          <label className="toggle">
            <input
              type="checkbox"
              checked={draft.sections.location.show_map_button}
              onChange={(event) => updateDraftValue(["sections", "location", "show_map_button"], event.target.checked)}
            />
            <span>Show map button</span>
          </label>
          <label className="toggle">
            <input
              type="checkbox"
              checked={draft.sections.location.show_contact_card}
              onChange={(event) => updateDraftValue(["sections", "location", "show_contact_card"], event.target.checked)}
            />
            <span>Show contact card</span>
          </label>
        </div>

        <div className="section">
          <div className="section-title">Footer</div>
          <label className="toggle">
            <input
              type="checkbox"
              checked={draft.footer.show_share}
              onChange={(event) => updateDraftValue(["footer", "show_share"], event.target.checked)}
            />
            <span>Show share section</span>
          </label>
          <label className="field">
            <span>Share label</span>
            <input
              type="text"
              value={draft.footer.share_label}
              onChange={(event) => updateDraftValue(["footer", "share_label"], event.target.value)}
            />
          </label>
          <label className="toggle">
            <input
              type="checkbox"
              checked={draft.footer.developer_credit.enabled}
              onChange={(event) => updateDraftValue(["footer", "developer_credit", "enabled"], event.target.checked)}
            />
            <span>Show developer credit</span>
          </label>
          <label className="field">
            <span>Developer credit label</span>
            <input
              type="text"
              value={draft.footer.developer_credit.label}
              onChange={(event) => updateDraftValue(["footer", "developer_credit", "label"], event.target.value)}
            />
          </label>
          <label className="field">
            <span>Developer credit URL</span>
            <input
              type="text"
              value={draft.footer.developer_credit.url}
              onChange={(event) => updateDraftValue(["footer", "developer_credit", "url"], event.target.value)}
            />
          </label>
        </div>

        <div className="section">
          <div className="section-title">Theme</div>
          <label className="field">
            <span>Theme ID</span>
            <input
              type="text"
              value={draft.theme.theme_id}
              onChange={(event) => updateDraftValue(["theme", "theme_id"], event.target.value)}
            />
          </label>
        </div>

        <div className="drawer-actions">
          <button className="button" type="submit" disabled={saving}>
            {saving ? "Saving..." : "Save landing settings"}
          </button>
          <button className="button secondary" type="button" onClick={handleReset} disabled={saving}>
            Reset to defaults
          </button>
        </div>
      </form>
    </div>
  );
}
