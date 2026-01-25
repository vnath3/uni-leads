"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { useTenantContext } from "@/components/TenantContextProvider";
import BusinessProfileBanner from "@/components/BusinessProfileBanner";

type LandingSettings = {
  brand_name?: string | null;
  tagline?: string | null;
  logo_url?: string | null;
  primary_color?: string | null;
  contact_email?: string | null;
  contact_phone?: string | null;
  address?: string | null;
  marketing_site_url?: string | null;
};

type FormState = {
  brand_name: string;
  tagline: string;
  contact_phone: string;
  contact_email: string;
  address: string;
  primary_color: string;
  marketing_site_url: string;
};

const emptyForm: FormState = {
  brand_name: "",
  tagline: "",
  contact_phone: "",
  contact_email: "",
  address: "",
  primary_color: "",
  marketing_site_url: ""
};

export default function TenantSettingsPage() {
  const { tenant, canWrite, isOwnerAdmin } = useTenantContext();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [formState, setFormState] = useState(emptyForm);
  const [refreshKey, setRefreshKey] = useState(0);

  const embedPayload = useMemo(
    () =>
      JSON.stringify(
        {
          identity_type: "slug",
          identity_value: tenant.slug,
          contact: {
            full_name: "Jane Doe",
            phone: "+91 98xxxxxx",
            email: "jane@example.com"
          },
          form_payload: {
            full_name: "Jane Doe",
            phone: "+91 98xxxxxx",
            source_page: "https://example.com/landing"
          },
          source: "website",
          campaign: "meta-ads"
        },
        null,
        2
      ),
    [tenant.slug]
  );

  const canEdit = isOwnerAdmin || (tenant.isPlatformUser && canWrite);

  useEffect(() => {
    let active = true;

    const load = async () => {
      setLoading(true);
      setError(null);

      const { data, error: settingsError } = await supabase
        .from("landing_settings")
        .select(
          "brand_name, tagline, logo_url, primary_color, contact_email, contact_phone, address, marketing_site_url"
        )
        .eq("tenant_id", tenant.tenantId)
        .maybeSingle();

      if (!active) return;

      if (settingsError) {
        setError(settingsError.message);
        setLoading(false);
        return;
      }

      if (!data) {
        setError("Landing settings not found for this tenant.");
        setLoading(false);
        return;
      }

      const settings = (data as LandingSettings) ?? null;
      setFormState({
        brand_name: settings?.brand_name ?? "",
        tagline: settings?.tagline ?? "",
        contact_phone: settings?.contact_phone ?? "",
        contact_email: settings?.contact_email ?? "",
        address: settings?.address ?? "",
        primary_color: settings?.primary_color ?? "",
        marketing_site_url: settings?.marketing_site_url ?? ""
      });
      setLoading(false);
    };

    load();

    return () => {
      active = false;
    };
  }, [tenant.tenantId]);

  const handleChange = (key: keyof typeof emptyForm, value: string) => {
    setFormState((prev) => ({ ...prev, [key]: value }));
  };

  const handleSave = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canEdit) return;

    setSaving(true);
    setError(null);
    setNotice(null);

    const payload = {
      brand_name: formState.brand_name.trim() || null,
      tagline: formState.tagline.trim() || null,
      contact_phone: formState.contact_phone.trim() || null,
      contact_email: formState.contact_email.trim() || null,
      address: formState.address.trim() || null,
      primary_color: formState.primary_color.trim() || null,
      marketing_site_url: formState.marketing_site_url.trim() || null
    };

    const { data, error: updateError } = await supabase
      .from("landing_settings")
      .update(payload)
      .eq("tenant_id", tenant.tenantId)
      .select(
        "brand_name, tagline, logo_url, primary_color, contact_email, contact_phone, address, marketing_site_url"
      )
      .maybeSingle();

    if (updateError) {
      setError(updateError.message);
      setSaving(false);
      return;
    }

    if (!data) {
      setError("Landing settings not found for this tenant.");
      setSaving(false);
      return;
    }

    const updated = (data as LandingSettings) ?? null;
    setFormState({
      brand_name: updated?.brand_name ?? "",
      tagline: updated?.tagline ?? "",
      contact_phone: updated?.contact_phone ?? "",
      contact_email: updated?.contact_email ?? "",
      address: updated?.address ?? "",
      primary_color: updated?.primary_color ?? "",
      marketing_site_url: updated?.marketing_site_url ?? ""
    });
    setNotice("Business profile saved.");
    setSaving(false);
    setRefreshKey((prev) => prev + 1);
  };

  if (loading) {
    return (
      <div className="card">
        <h1>Settings</h1>
        <p className="muted">Loading business profile...</p>
      </div>
    );
  }

  return (
    <>
      <BusinessProfileBanner
        tenantId={tenant.tenantId}
        slug={tenant.slug}
        isOwnerAdmin={isOwnerAdmin}
        canWrite={canWrite}
        refreshKey={refreshKey}
      />

      <div className="card">
        <div className="card-header">
          <div>
            <h1>Business profile</h1>
            <p className="muted">
              Keep your public landing page accurate and ready to share.
            </p>
          </div>
        </div>

        {error && <div className="error">{error}</div>}
        {notice && <div className="notice">{notice}</div>}

        {!canEdit && (
          <div className="notice">
            Owner or admin access is required to edit settings.
          </div>
        )}

        <form onSubmit={handleSave}>
          <label className="field">
            <span>Brand name</span>
            <input
              type="text"
              value={formState.brand_name}
              onChange={(event) => handleChange("brand_name", event.target.value)}
              placeholder={tenant.slug}
              disabled={!canEdit}
            />
          </label>
          <label className="field">
            <span>Tagline</span>
            <input
              type="text"
              value={formState.tagline}
              onChange={(event) => handleChange("tagline", event.target.value)}
              disabled={!canEdit}
            />
          </label>
          <label className="field">
            <span>Contact phone</span>
            <input
              type="tel"
              value={formState.contact_phone}
              onChange={(event) =>
                handleChange("contact_phone", event.target.value)
              }
              disabled={!canEdit}
              required={false}
            />
          </label>
          <label className="field">
            <span>Contact email</span>
            <input
              type="email"
              value={formState.contact_email}
              onChange={(event) =>
                handleChange("contact_email", event.target.value)
              }
              disabled={!canEdit}
              required={false}
            />
          </label>
          <label className="field">
            <span>Address</span>
            <textarea
              rows={3}
              value={formState.address}
              onChange={(event) => handleChange("address", event.target.value)}
              disabled={!canEdit}
            />
          </label>
          <label className="field">
            <span>Marketing site URL</span>
            <input
              type="url"
              value={formState.marketing_site_url}
              onChange={(event) =>
                handleChange("marketing_site_url", event.target.value)
              }
              placeholder="https://jyotipg.netlify.app/"
              disabled={!canEdit}
            />
          </label>
          <label className="field">
            <span>Primary color</span>
            <input
              type="text"
              value={formState.primary_color}
              onChange={(event) =>
                handleChange("primary_color", event.target.value)
              }
              placeholder="#b65a3c"
              disabled={!canEdit}
            />
          </label>
          <label className="field">
            <span>Logo URL (coming soon)</span>
            <input
              type="text"
              value=""
              placeholder="Upload support coming soon"
              disabled
            />
          </label>
          <button className="button" type="submit" disabled={!canEdit || saving}>
            {saving ? "Saving..." : "Save changes"}
          </button>
        </form>
      </div>

      <div className="card">
        <div className="card-header">
          <div>
            <h1>Embed / integrate form</h1>
            <p className="muted">
              Use this payload to post leads directly to Uni-Leads.
            </p>
          </div>
        </div>
        <div className="create-preview-list">
          <div>
            <strong>Tenant slug</strong>
            <p className="muted">{tenant.slug}</p>
          </div>
          <div>
            <strong>Submit endpoint</strong>
            <p className="muted">/api/lead-submit</p>
          </div>
        </div>
        <label className="field">
          <span>Example JSON payload</span>
          <textarea rows={12} value={embedPayload} readOnly />
        </label>
      </div>
    </>
  );
}
