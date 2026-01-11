"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabaseClient";

type Tenant = {
  id: string;
  name: string;
  status: string | null;
  created_at: string;
};

type TenantIdentity = {
  tenant_id: string;
  value: string;
  identity_type?: string | null;
  is_primary?: boolean | null;
};

type Feature = {
  key: string;
  name: string;
  category?: string | null;
  is_active?: boolean | null;
};

type TenantFeature = {
  tenant_id: string;
  feature_key: string;
  enabled: boolean;
  features?: {
    key?: string;
    name: string;
    category?: string | null;
    is_active?: boolean | null;
  } | { key?: string; name: string; category?: string | null; is_active?: boolean | null }[] | null;
};

type SupportGrant = {
  tenant_id: string;
  access_mode: string | null;
  status: string;
  expires_at: string;
};

type PlatformCheckResult = {
  data: { is_active: boolean } | null;
  error: string | null;
};

const formatDate = (value: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString();
};

const formatDateTime = (value: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
};

const normalizeAccess = (value: string | null | undefined): "RO" | "RW" => {
  const normalized = (value ?? "").toString().toLowerCase();
  if (normalized.includes("rw") || normalized.includes("write")) {
    return "RW";
  }
  return "RO";
};

const extractFeatureMeta = (features?: TenantFeature["features"]) => {
  if (!features) return undefined;
  if (Array.isArray(features)) {
    return features[0];
  }
  return features;
};

const checkPlatformUser = async (userId: string): Promise<PlatformCheckResult> => {
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

const upsertFeatureRow = (
  rows: TenantFeature[],
  tenantId: string,
  featureKey: string,
  enabled: boolean,
  featureMetaByKey: Record<
    string,
    { key: string; name: string; category?: string | null; is_active?: boolean | null }
  >
) => {
  const index = rows.findIndex(
    (row) => row.tenant_id === tenantId && row.feature_key === featureKey
  );

  if (index === -1) {
    return [
      ...rows,
      {
        tenant_id: tenantId,
        feature_key: featureKey,
        enabled,
        features: featureMetaByKey[featureKey] ?? { name: featureKey }
      }
    ];
  }

  const next = [...rows];
  next[index] = {
    ...next[index],
    enabled
  };
  return next;
};

export default function SuperDashboardPage() {
  const router = useRouter();
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [accessDenied, setAccessDenied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [slugByTenant, setSlugByTenant] = useState<Record<string, string>>({});
  const [features, setFeatures] = useState<Feature[]>([]);
  const [tenantFeatures, setTenantFeatures] = useState<TenantFeature[]>([]);
  const [supportAccess, setSupportAccess] = useState<
    Record<string, { mode: "RO" | "RW"; expiresAt: string }>
  >({});
  const [toggleBusy, setToggleBusy] = useState<Record<string, boolean>>({});

  const featureMetaByKey = useMemo(() => {
    const map: Record<
      string,
      { key: string; name: string; category?: string | null; is_active?: boolean | null }
    > = {};
    for (const feature of features) {
      map[feature.key] = {
        key: feature.key,
        name: feature.name,
        category: feature.category ?? null,
        is_active: feature.is_active ?? null
      };
    }
    return map;
  }, [features]);

  const featureNameByKey = useMemo(() => {
    const map: Record<string, string> = {};
    for (const feature of features) {
      map[feature.key] = feature.name;
    }
    return map;
  }, [features]);

  const tenantFeatureMap = useMemo(() => {
    const map: Record<string, Record<string, boolean>> = {};
    for (const row of tenantFeatures) {
      if (!map[row.tenant_id]) {
        map[row.tenant_id] = {};
      }
        map[row.tenant_id][row.feature_key] = !!row.enabled;
    }
    return map;
  }, [tenantFeatures]);

  useEffect(() => {
    let active = true;

    const init = async () => {
      const { data, error: sessionError } = await supabase.auth.getSession();
      if (!active) return;

      if (sessionError) {
        setError(sessionError.message);
        setLoading(false);
        return;
      }

      if (!data.session) {
        router.replace("/login");
        return;
      }

      setSession(data.session);
      await loadData(data.session);
    };

    init();

    const { data: authListener } = supabase.auth.onAuthStateChange(
      (_event, nextSession) => {
        setSession(nextSession);
        if (!nextSession) {
          router.replace("/login");
        }
      }
    );

    return () => {
      active = false;
      authListener.subscription.unsubscribe();
    };
  }, [router]);

  const loadData = async (currentSession: Session) => {
    setLoading(true);
    setError(null);
    setAccessDenied(false);

    const userId = currentSession.user.id;

    const platformCheck = await checkPlatformUser(userId);

    if (platformCheck.error) {
      setError(platformCheck.error);
      setLoading(false);
      return;
    }

    if (!platformCheck.data) {
      setAccessDenied(true);
      setLoading(false);
      return;
    }

    const nowIso = new Date().toISOString();

    const [
      tenantsRes,
      identitiesRes,
      featuresRes,
      tenantFeaturesRes,
      supportRes
    ] = await Promise.all([
      supabase
        .from("tenants")
        .select("id, name, status, created_at")
        .order("created_at", { ascending: false }),
      supabase
        .from("tenant_identities")
        .select("tenant_id, value, identity_type, is_primary")
        .eq("identity_type", "slug")
        .order("is_primary", { ascending: false }),
      supabase.from("features").select("key, name, category, is_active").order("name"),
      supabase
        .from("tenant_features")
        .select(
          "tenant_id, feature_key, enabled, features(key, name, category, is_active)"
        ),
      supabase
        .from("support_access_grants")
        .select("tenant_id, access_mode, status, expires_at")
        .eq("platform_user_id", userId)
        .eq("status", "active")
        .gt("expires_at", nowIso)
    ]);

    const firstError =
      tenantsRes.error ||
      identitiesRes.error ||
      featuresRes.error ||
      tenantFeaturesRes.error ||
      supportRes.error;

    if (firstError) {
      setError(firstError.message);
      setLoading(false);
      return;
    }

    setTenants((tenantsRes.data as Tenant[]) ?? []);
    setFeatures((featuresRes.data as Feature[]) ?? []);
    setTenantFeatures((tenantFeaturesRes.data as TenantFeature[]) ?? []);

    const slugMap: Record<string, string> = {};
    for (const identity of (identitiesRes.data as TenantIdentity[]) ?? []) {
      if (!slugMap[identity.tenant_id]) {
        slugMap[identity.tenant_id] = identity.value;
      }
    }
    setSlugByTenant(slugMap);

    const accessMap: Record<
      string,
      { mode: "RO" | "RW"; expiresAt: string }
    > = {};
    for (const grant of (supportRes.data as SupportGrant[]) ?? []) {
      const display = normalizeAccess(grant.access_mode);
      const expiresAt = grant.expires_at;
      if (!expiresAt) continue;

      const existing = accessMap[grant.tenant_id];
      if (!existing) {
        accessMap[grant.tenant_id] = { mode: display, expiresAt };
        continue;
      }

      if (existing.mode !== "RW" && display === "RW") {
        accessMap[grant.tenant_id] = { mode: display, expiresAt };
        continue;
      }

      if (existing.mode === display && expiresAt > existing.expiresAt) {
        accessMap[grant.tenant_id] = { mode: display, expiresAt };
      }
    }
    setSupportAccess(accessMap);

    setLoading(false);
  };

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    router.replace("/login");
  };

  const handleToggle = async (
    tenantId: string,
    featureKey: string,
    nextEnabled: boolean
  ) => {
    const currentUserId = session?.user.id;
    if (!currentUserId) {
      setError("Session expired. Please sign in again.");
      return;
    }

    const key = `${tenantId}:${featureKey}`;
    const nowIso = new Date().toISOString();
    setToggleBusy((prev) => ({ ...prev, [key]: true }));
    setTenantFeatures((prev) =>
      upsertFeatureRow(prev, tenantId, featureKey, nextEnabled, featureMetaByKey)
    );

    const { error: toggleError } = nextEnabled
      ? await supabase.from("tenant_features").upsert(
          {
            tenant_id: tenantId,
            feature_key: featureKey,
            enabled: true,
            enabled_by: currentUserId,
            enabled_at: nowIso,
            disabled_at: null
          },
          { onConflict: "tenant_id,feature_key" }
        )
      : await supabase
          .from("tenant_features")
          .update({
            enabled: false,
            disabled_at: nowIso,
            enabled_by: currentUserId
          })
          .eq("tenant_id", tenantId)
          .eq("feature_key", featureKey);

    if (toggleError) {
      setTenantFeatures((prev) =>
        upsertFeatureRow(prev, tenantId, featureKey, !nextEnabled, featureMetaByKey)
      );
      setError(toggleError.message);
    }

    setToggleBusy((prev) => ({ ...prev, [key]: false }));
  };

  if (loading) {
    return (
      <div className="card">
        <h1>Loading</h1>
        <p className="muted">Checking access and loading tenants...</p>
      </div>
    );
  }

  if (accessDenied) {
    return (
      <div className="card">
        <h1>Access denied</h1>
        <p className="muted">
          Your account is not an active platform user. Contact an administrator
          for access.
        </p>
        <button className="button secondary" onClick={handleSignOut}>
          Sign out
        </button>
      </div>
    );
  }

  return (
    <>
      <div className="card">
        <div className="card-header">
          <div>
            <h1>Super Admin Dashboard</h1>
            <p className="muted">
              Signed in as {session?.user.email ?? session?.user.id}
            </p>
          </div>
          <button className="button secondary" onClick={handleSignOut}>
            Sign out
          </button>
        </div>
        <div className="notice">
          Platform access is granted only for users in
          <strong> public.platform_users</strong> with
          <strong> is_active</strong> set to true.
        </div>
      </div>

      {error && <div className="error">{error}</div>}

      {tenants.length === 0 && (
        <div className="notice">No tenants found in the database.</div>
      )}

      {tenants.map((tenant, index) => {
        const slug = slugByTenant[tenant.id];
        const enabledFeatures = tenantFeatures
          .filter((row) => row.tenant_id === tenant.id && row.enabled)
          .map((row) => {
            const meta = extractFeatureMeta(row.features);
            const baseName =
              meta?.name || featureNameByKey[row.feature_key] || row.feature_key;
            return meta?.category ? `${baseName} (${meta.category})` : baseName;
          });
        const supportStatus = supportAccess[tenant.id];

        return (
          <div
            className="card"
            key={tenant.id}
            style={{ animationDelay: `${index * 0.03}s` }}
          >
            <div className="card-header">
              <div>
                <h2>{tenant.name}</h2>
                <p className="muted">
                  Status: {tenant.status ?? "unknown"} | Created:{" "}
                  {formatDate(tenant.created_at)}
                </p>
                <p className="muted">Slug: {slug ?? "missing"}</p>
              </div>
              {slug ? (
                <div>
                  <Link className="button" href={`/t/${slug}/admin`}>
                    Open Tenant Admin
                  </Link>
                  <Link className="button secondary" href={`/t/${slug}`}>
                    Open Tenant Landing
                  </Link>
                </div>
              ) : (
                <span className="button disabled">Missing slug</span>
              )}
            </div>

            <div className="section">
              <div className="section-title">Enabled features</div>
              {enabledFeatures.length > 0 ? (
                <div className="tag-list">
                  {enabledFeatures.map((name) => (
                    <span className="tag" key={`${tenant.id}-${name}`}>
                      {name}
                    </span>
                  ))}
                </div>
              ) : (
                <p className="muted">None enabled.</p>
              )}
            </div>

            <div className="section">
              <div className="section-title">Feature toggles</div>
              {features.length === 0 ? (
                <p className="muted">No features configured.</p>
              ) : (
                <div className="toggle-grid">
                  {features.map((feature) => {
                    const enabled = !!tenantFeatureMap[tenant.id]?.[feature.key];
                    const key = `${tenant.id}:${feature.key}`;
                    const busy = !!toggleBusy[key];

                    return (
                      <label
                        key={feature.key}
                        className={`toggle ${busy ? "disabled" : ""}`}
                      >
                        <input
                          type="checkbox"
                          checked={enabled}
                          disabled={busy}
                          onChange={() =>
                            handleToggle(tenant.id, feature.key, !enabled)
                          }
                        />
                        <span>{feature.name}</span>
                      </label>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="section">
              <div className="section-title">Support access</div>
              {supportStatus ? (
                <p className="muted">
                  Support Access: {supportStatus.mode} until{" "}
                  {formatDateTime(supportStatus.expiresAt)}
                </p>
              ) : (
                <p className="muted">Support Access: None</p>
              )}
            </div>
          </div>
        );
      })}
    </>
  );
}
