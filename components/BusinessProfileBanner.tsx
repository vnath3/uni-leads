"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

type LandingSettings = {
  brand_name?: string | null;
  tagline?: string | null;
  logo_url?: string | null;
  primary_color?: string | null;
  contact_email?: string | null;
  contact_phone?: string | null;
  address?: string | null;
  is_live?: boolean | null;
  live_enabled_at?: string | null;
};

type ChecklistItem = {
  key: string;
  label: string;
  done: boolean;
};

type BusinessProfileBannerProps = {
  tenantId: string;
  slug: string;
  isOwnerAdmin: boolean;
  canWrite: boolean;
  refreshKey?: number;
};

const isFilled = (value?: string | null) =>
  typeof value === "string" && value.trim().length > 0;

const formatDateTime = (value?: string | null) => {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
};

export default function BusinessProfileBanner({
  tenantId,
  slug,
  isOwnerAdmin,
  canWrite,
  refreshKey
}: BusinessProfileBannerProps) {
  const [loading, setLoading] = useState(true);
  const [settings, setSettings] = useState<LandingSettings | null>(null);
  const [tenantName, setTenantName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [liveSaving, setLiveSaving] = useState(false);
  const [liveError, setLiveError] = useState<string | null>(null);

  const canEditLive = isOwnerAdmin && canWrite;

  useEffect(() => {
    let active = true;

    const load = async () => {
      setLoading(true);
      setError(null);

      const [settingsRes, tenantRes] = await Promise.all([
        supabase
          .from("landing_settings")
          .select(
            "brand_name, tagline, logo_url, primary_color, contact_email, contact_phone, address, is_live, live_enabled_at"
          )
          .eq("tenant_id", tenantId)
          .maybeSingle(),
        supabase.from("tenants").select("name").eq("id", tenantId).maybeSingle()
      ]);

      if (!active) return;

      const firstError = settingsRes.error || tenantRes.error;
      if (firstError) {
        setError(firstError.message);
        setLoading(false);
        return;
      }

      if (!settingsRes.data) {
        setError("Landing settings not found for this tenant.");
        setLoading(false);
        return;
      }

      setSettings((settingsRes.data as LandingSettings) ?? null);
      setTenantName(
        typeof tenantRes.data?.name === "string" ? tenantRes.data.name : null
      );
      setLoading(false);
    };

    load();

    return () => {
      active = false;
    };
  }, [tenantId, refreshKey]);

  const { requiredItems, recommendedItems, percent, readyToGoLive } = useMemo(() => {
    const hasBrandName =
      isFilled(settings?.brand_name) || isFilled(tenantName);

    const required: ChecklistItem[] = [
      { key: "brand_name", label: "Brand name", done: hasBrandName },
      {
        key: "contact_phone",
        label: "Contact phone",
        done: isFilled(settings?.contact_phone)
      },
      { key: "address", label: "Address", done: isFilled(settings?.address) }
    ];

    const recommended: ChecklistItem[] = [
      { key: "tagline", label: "Tagline", done: isFilled(settings?.tagline) },
      {
        key: "contact_email",
        label: "Contact email",
        done: isFilled(settings?.contact_email)
      },
      {
        key: "primary_color",
        label: "Primary color",
        done: isFilled(settings?.primary_color)
      },
      { key: "logo_url", label: "Logo", done: isFilled(settings?.logo_url) }
    ];

    const total = required.length + recommended.length;
    const completed = [...required, ...recommended].filter((item) => item.done)
      .length;
    const score = total ? Math.round((completed / total) * 100) : 0;

    return {
      requiredItems: required,
      recommendedItems: recommended,
      percent: score,
      readyToGoLive: required.every((item) => item.done)
    };
  }, [settings, tenantName]);

  const handleToggleLive = async () => {
    if (!settings) return;
    if (!canEditLive) {
      setLiveError("Owner or admin access required.");
      return;
    }
    if (!settings.is_live && !readyToGoLive) {
      setLiveError("Complete required fields before going live.");
      return;
    }

    setLiveSaving(true);
    setLiveError(null);

    const { data: sessionData } = await supabase.auth.getSession();
    const userId = sessionData?.session?.user?.id ?? null;

    const payload = settings.is_live
      ? { is_live: false }
      : {
          is_live: true,
          live_enabled_at: new Date().toISOString(),
          live_enabled_by: userId
        };

    const { data, error: updateError } = await supabase
      .from("landing_settings")
      .update(payload)
      .eq("tenant_id", tenantId)
      .select(
        "brand_name, tagline, logo_url, primary_color, contact_email, contact_phone, address, is_live, live_enabled_at"
      )
      .maybeSingle();

    if (updateError) {
      setLiveError(updateError.message);
      setLiveSaving(false);
      return;
    }

    if (!data) {
      setLiveError("Landing settings not found for this tenant.");
      setLiveSaving(false);
      return;
    }

    setSettings((data as LandingSettings) ?? settings);
    setLiveSaving(false);
  };

  if (loading) {
    return (
      <div className="card">
        <h2>Business profile</h2>
        <p className="muted">Loading setup status...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="card">
        <h2>Business profile</h2>
        <div className="error">{error}</div>
      </div>
    );
  }

  const isLive = Boolean(settings?.is_live);
  const liveLabel = isLive ? "Live" : "Not live";

  return (
    <div className="card setup-banner">
      <div className="setup-header">
        <div>
          <h2>Business profile setup</h2>
          <p className="muted">Complete the basics before sharing your landing.</p>
        </div>
        <div className="setup-score">Setup: {percent}% complete</div>
      </div>

      <div className="checklist-grid">
        <div>
          <div className="section-title">Required</div>
          {requiredItems.map((item) => (
            <div className="checklist-item" key={item.key}>
              <span
                className={`checklist-status ${item.done ? "done" : "todo"}`}
              >
                {item.done ? "[x]" : "[ ]"}
              </span>
              <span>{item.label}</span>
            </div>
          ))}
        </div>
        <div>
          <div className="section-title">Recommended</div>
          {recommendedItems.map((item) => (
            <div className="checklist-item" key={item.key}>
              <span
                className={`checklist-status ${item.done ? "done" : "todo"}`}
              >
                {item.done ? "[x]" : "[ ]"}
              </span>
              <span>{item.label}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="section">
        <div className="section-title">Go Live</div>
        <div className="go-live-row">
          <div className="go-live-status">{liveLabel}</div>
          {settings?.live_enabled_at && isLive && (
            <span className="muted">
              Enabled on {formatDateTime(settings.live_enabled_at)}
            </span>
          )}
          <button
            type="button"
            className={`button ${liveSaving ? "disabled" : ""}`}
            disabled={liveSaving || (!readyToGoLive && !isLive) || !canEditLive}
            onClick={handleToggleLive}
          >
            {liveSaving
              ? "Saving..."
              : isLive
                ? "Take offline"
                : "Go Live"}
          </button>
          <Link className="button secondary" href={`/t/${slug}/admin/settings`}>
            Edit profile
          </Link>
        </div>
        {!readyToGoLive && !isLive && (
          <p className="muted">
            Complete required fields to enable Go Live.
          </p>
        )}
        {!canEditLive && (
          <p className="muted">Owner/admin access required to go live.</p>
        )}
        {liveError && <div className="error">{liveError}</div>}
      </div>
    </div>
  );
}
