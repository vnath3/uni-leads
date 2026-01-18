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

type DomainIdentity = {
  tenant_id: string;
  value: string;
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

type InviteRole = "owner" | "admin";

type InviteInfo = {
  role: InviteRole;
  token: string;
  expiresAt: string;
  url: string;
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

const buildInviteUrl = (token: string) => {
  const envUrl = process.env.NEXT_PUBLIC_APP_URL;
  const baseUrl =
    envUrl ??
    (typeof window !== "undefined" ? window.location.origin : "");
  const normalized = baseUrl.replace(/\/$/, "");
  if (!normalized) {
    return `/claim?token=${encodeURIComponent(token)}`;
  }
  return `${normalized}/claim?token=${encodeURIComponent(token)}`;
};

const normalizeDomainInput = (value: string) => {
  let domain = value.trim().toLowerCase();
  if (!domain) return "";
  domain = domain.replace(/^https?:\/\//, "");
  domain = domain.split("/")[0] ?? "";
  domain = domain.replace(/:\d+$/, "");
  domain = domain.replace(/\/$/, "");
  return domain;
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
  const [supportBusy, setSupportBusy] = useState<Record<string, boolean>>({});
  const [copyMessageByTenant, setCopyMessageByTenant] = useState<
    Record<string, string>
  >({});
  const [inviteRoleByTenant, setInviteRoleByTenant] = useState<
    Record<string, InviteRole>
  >({});
  const [inviteInfoByTenant, setInviteInfoByTenant] = useState<
    Record<string, InviteInfo>
  >({});
  const [inviteBusyByTenant, setInviteBusyByTenant] = useState<
    Record<string, boolean>
  >({});
  const [inviteErrorByTenant, setInviteErrorByTenant] = useState<
    Record<string, string>
  >({});
  const [inviteCopyMessageByTenant, setInviteCopyMessageByTenant] = useState<
    Record<string, string>
  >({});
  const [domainsByTenant, setDomainsByTenant] = useState<
    Record<string, string[]>
  >({});
  const [domainInputByTenant, setDomainInputByTenant] = useState<
    Record<string, string>
  >({});
  const [domainBusyByTenant, setDomainBusyByTenant] = useState<
    Record<string, boolean>
  >({});
  const [domainErrorByTenant, setDomainErrorByTenant] = useState<
    Record<string, string>
  >({});
  const [archiveInputByTenant, setArchiveInputByTenant] = useState<
    Record<string, string>
  >({});
  const [archiveBusyByTenant, setArchiveBusyByTenant] = useState<
    Record<string, boolean>
  >({});
  const [archiveErrorByTenant, setArchiveErrorByTenant] = useState<
    Record<string, string>
  >({});
  const [searchTerm, setSearchTerm] = useState("");
  const [showCreateTenant, setShowCreateTenant] = useState(false);
  const [creatingTenant, setCreatingTenant] = useState(false);
  const [createForm, setCreateForm] = useState({
    name: "",
    slug: "",
    ownerEmail: "",
    preset: "pg"
  });

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

  const filteredTenants = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    if (!term) return tenants;
    return tenants.filter((tenant) => {
      const slug = slugByTenant[tenant.id] ?? "";
      return (
        tenant.name.toLowerCase().includes(term) ||
        slug.toLowerCase().includes(term)
      );
    });
  }, [tenants, slugByTenant, searchTerm]);

  const featureSections = useMemo(() => {
    return [
      { title: "Core", keys: ["landing", "leads", "contacts", "audit"] },
      { title: "PG", keys: ["pg.beds", "pg.occupancy", "pg.payments"] },
      { title: "Clinic", keys: ["clinic.appointments"] }
    ];
  }, []);

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
      domainsRes,
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
      supabase
        .from("tenant_identities")
        .select("tenant_id, value")
        .eq("identity_type", "domain")
        .order("value"),
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
      domainsRes.error ||
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

    const domainMap: Record<string, string[]> = {};
    for (const identity of (domainsRes.data as DomainIdentity[]) ?? []) {
      if (!domainMap[identity.tenant_id]) {
        domainMap[identity.tenant_id] = [];
      }
      domainMap[identity.tenant_id].push(identity.value);
    }
    setDomainsByTenant(domainMap);

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

  const handleCopyLink = async (tenantId: string, label: string, path: string) => {
    try {
      const url = new URL(path, window.location.origin).toString();
      await navigator.clipboard.writeText(url);
      setCopyMessageByTenant((prev) => ({
        ...prev,
        [tenantId]: `${label} copied`
      }));
      setTimeout(() => {
        setCopyMessageByTenant((prev) => {
          const next = { ...prev };
          delete next[tenantId];
          return next;
        });
      }, 2000);
    } catch (copyError) {
      setCopyMessageByTenant((prev) => ({
        ...prev,
        [tenantId]: "Copy failed"
      }));
    }
  };

  const handleCopyInvite = async (tenantId: string, url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setInviteCopyMessageByTenant((prev) => ({
        ...prev,
        [tenantId]: "Invite link copied"
      }));
      setTimeout(() => {
        setInviteCopyMessageByTenant((prev) => {
          const next = { ...prev };
          delete next[tenantId];
          return next;
        });
      }, 2000);
    } catch (copyError) {
      setInviteCopyMessageByTenant((prev) => ({
        ...prev,
        [tenantId]: "Copy failed"
      }));
    }
  };

  const handleGenerateInvite = async (tenantId: string) => {
    if (!session?.user.id) {
      setError("Session expired. Please sign in again.");
      return;
    }

    const role = inviteRoleByTenant[tenantId] ?? "owner";
    setInviteBusyByTenant((prev) => ({ ...prev, [tenantId]: true }));
    setInviteErrorByTenant((prev) => {
      const next = { ...prev };
      delete next[tenantId];
      return next;
    });

    const { data, error: inviteError } = await supabase
      .schema("public")
      .rpc("create_tenant_invite", {
        p_tenant_id: tenantId,
        p_role: role,
        p_expires_in_days: 7
      });

    if (inviteError) {
      setInviteErrorByTenant((prev) => ({
        ...prev,
        [tenantId]: inviteError.message
      }));
      setInviteBusyByTenant((prev) => ({ ...prev, [tenantId]: false }));
      return;
    }

    const inviteRow = Array.isArray(data) ? data[0] : data;
    if (!inviteRow?.token || !inviteRow?.expires_at) {
      setInviteErrorByTenant((prev) => ({
        ...prev,
        [tenantId]: "Invite created but response is incomplete."
      }));
      setInviteBusyByTenant((prev) => ({ ...prev, [tenantId]: false }));
      return;
    }

    setInviteInfoByTenant((prev) => ({
      ...prev,
      [tenantId]: {
        role,
        token: inviteRow.token,
        expiresAt: inviteRow.expires_at,
        url: buildInviteUrl(inviteRow.token)
      }
    }));
    setInviteBusyByTenant((prev) => ({ ...prev, [tenantId]: false }));
  };

  const handleAddDomain = async (tenantId: string) => {
    if (!session?.user.id) {
      setError("Session expired. Please sign in again.");
      return;
    }

    const rawInput = domainInputByTenant[tenantId] ?? "";
    const normalized = normalizeDomainInput(rawInput);

    if (!normalized) {
      setDomainErrorByTenant((prev) => ({
        ...prev,
        [tenantId]: "Enter a valid domain."
      }));
      return;
    }

    setDomainBusyByTenant((prev) => ({ ...prev, [tenantId]: true }));
    setDomainErrorByTenant((prev) => {
      const next = { ...prev };
      delete next[tenantId];
      return next;
    });

    const { data, error: domainError } = await supabase
      .schema("public")
      .rpc("add_tenant_domain", {
        p_tenant_id: tenantId,
        p_domain: normalized
      });

    if (domainError) {
      const message = domainError.message.toLowerCase().includes("already")
        ? "Domain already in use."
        : domainError.message;
      setDomainErrorByTenant((prev) => ({
        ...prev,
        [tenantId]: message
      }));
      setDomainBusyByTenant((prev) => ({ ...prev, [tenantId]: false }));
      return;
    }

    const addedDomain =
      Array.isArray(data) && data.length > 0
        ? data[0]?.domain
        : (data as { domain?: string } | null)?.domain;

    if (addedDomain) {
      setDomainsByTenant((prev) => ({
        ...prev,
        [tenantId]: Array.from(
          new Set([...(prev[tenantId] ?? []), addedDomain])
        )
      }));
    }

    setDomainInputByTenant((prev) => ({
      ...prev,
      [tenantId]: ""
    }));
    setDomainBusyByTenant((prev) => ({ ...prev, [tenantId]: false }));
  };

  const handleRemoveDomain = async (tenantId: string, domain: string) => {
    if (!session?.user.id) {
      setError("Session expired. Please sign in again.");
      return;
    }

    setDomainBusyByTenant((prev) => ({ ...prev, [tenantId]: true }));
    setDomainErrorByTenant((prev) => {
      const next = { ...prev };
      delete next[tenantId];
      return next;
    });

    const { error: removeError } = await supabase
      .schema("public")
      .rpc("remove_tenant_domain", {
        p_tenant_id: tenantId,
        p_domain: domain
      });

    if (removeError) {
      setDomainErrorByTenant((prev) => ({
        ...prev,
        [tenantId]: removeError.message
      }));
      setDomainBusyByTenant((prev) => ({ ...prev, [tenantId]: false }));
      return;
    }

    setDomainsByTenant((prev) => ({
      ...prev,
      [tenantId]: (prev[tenantId] ?? []).filter((value) => value !== domain)
    }));
    setDomainBusyByTenant((prev) => ({ ...prev, [tenantId]: false }));
  };

  const handleArchiveTenant = async (tenantId: string, slug?: string) => {
    if (!session?.user.id) {
      setError("Session expired. Please sign in again.");
      return;
    }

    const input = (archiveInputByTenant[tenantId] ?? "").trim().toLowerCase();
    const expected = (slug ?? "").trim().toLowerCase();

    if (!expected) {
      setArchiveErrorByTenant((prev) => ({
        ...prev,
        [tenantId]: "Slug is missing. Cannot archive."
      }));
      return;
    }

    if (input !== expected) {
      setArchiveErrorByTenant((prev) => ({
        ...prev,
        [tenantId]: "Type the exact slug to confirm."
      }));
      return;
    }

    setArchiveBusyByTenant((prev) => ({ ...prev, [tenantId]: true }));
    setArchiveErrorByTenant((prev) => {
      const next = { ...prev };
      delete next[tenantId];
      return next;
    });

    const { error: archiveError } = await supabase
      .schema("public")
      .rpc("archive_tenant", { p_tenant_id: tenantId });

    if (archiveError) {
      setArchiveErrorByTenant((prev) => ({
        ...prev,
        [tenantId]: archiveError.message
      }));
      setArchiveBusyByTenant((prev) => ({ ...prev, [tenantId]: false }));
      return;
    }

    setTenants((prev) =>
      prev.map((row) =>
        row.id === tenantId ? { ...row, status: "archived" } : row
      )
    );
    setDomainsByTenant((prev) => ({
      ...prev,
      [tenantId]: []
    }));
    setArchiveInputByTenant((prev) => ({ ...prev, [tenantId]: "" }));
    setArchiveBusyByTenant((prev) => ({ ...prev, [tenantId]: false }));
  };

  const handleSupportRequest = async (tenantId: string, mode: "RO" | "RW") => {
    const currentUserId = session?.user.id;
    if (!currentUserId) {
      setError("Session expired. Please sign in again.");
      return;
    }

    const key = `${tenantId}:${mode}`;
    setSupportBusy((prev) => ({ ...prev, [key]: true }));
    setError(null);

    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

    const { error: grantError } = await supabase
      .from("support_access_grants")
      .insert({
        tenant_id: tenantId,
        platform_user_id: currentUserId,
        access_mode: mode.toLowerCase(),
        status: "active",
        created_by: currentUserId,
        expires_at: expiresAt
      });

    if (grantError) {
      setError(grantError.message);
      setSupportBusy((prev) => ({ ...prev, [key]: false }));
      return;
    }

    setSupportAccess((prev) => ({
      ...prev,
      [tenantId]: { mode, expiresAt }
    }));
    setSupportBusy((prev) => ({ ...prev, [key]: false }));
  };

  const handleSupportRevoke = async (tenantId: string) => {
    const currentUserId = session?.user.id;
    if (!currentUserId) {
      setError("Session expired. Please sign in again.");
      return;
    }

    const key = `${tenantId}:revoke`;
    setSupportBusy((prev) => ({ ...prev, [key]: true }));
    setError(null);

    const { error: revokeError } = await supabase
      .from("support_access_grants")
      .update({
        status: "revoked",
        revoked_at: new Date().toISOString(),
        revoked_by: currentUserId
      })
      .eq("tenant_id", tenantId)
      .eq("platform_user_id", currentUserId)
      .eq("status", "active");

    if (revokeError) {
      setError(revokeError.message);
      setSupportBusy((prev) => ({ ...prev, [key]: false }));
      return;
    }

    setSupportAccess((prev) => {
      const next = { ...prev };
      delete next[tenantId];
      return next;
    });
    setSupportBusy((prev) => ({ ...prev, [key]: false }));
  };

  const handleCreateTenant = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const currentUserId = session?.user.id;
    if (!currentUserId) {
      setError("Session expired. Please sign in again.");
      return;
    }

    const name = createForm.name.trim();
    const slug = createForm.slug.trim().toLowerCase();
    if (!name || !slug) {
      setError("Tenant name and slug are required.");
      return;
    }

    setCreatingTenant(true);
    setError(null);

    const { data: tenantResult, error: tenantError } = await supabase
      .rpc("create_tenant_full", {
        p_name: name,
        p_slug: slug,
        p_status: "active",
        p_vertical: createForm.preset
      });

    if (tenantError) {
      setError(tenantError.message);
      setCreatingTenant(false);
      return;
    }

    const createdRow = Array.isArray(tenantResult)
      ? tenantResult[0]
      : tenantResult;

    const { data: landingData, error: landingError } = await supabase
      .schema("public")
      .rpc("get_landing_settings", {
        p_identity_type: "slug",
        p_identity_value: slug
      });

    if (landingError || !landingData) {
      setError(
        "Tenant created, but landing settings are missing. Re-run bootstrap or check the RPC."
      );
    }

    if (createdRow?.tenant_id && createdRow?.slug) {
      setSlugByTenant((prev) => ({ ...prev, [createdRow.tenant_id]: createdRow.slug }));
    }
    setShowCreateTenant(false);
    setCreateForm({ name: "", slug: "", ownerEmail: "", preset: "pg" });
    setCreatingTenant(false);
    await loadData(session);
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
      <div className="super-header">
        <div className="super-header-left">
          <h1>FlowGrid Super Admin</h1>
        </div>
        <div className="super-header-center">
          <input
            className="super-search"
            type="search"
            placeholder="Search tenant name or slug"
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
          />
        </div>
        <div className="super-header-right">
          <button
            className="button secondary"
            onClick={() => setShowCreateTenant(true)}
          >
            Create Tenant
          </button>
          <span className="muted">{session?.user.email ?? session?.user.id}</span>
          <button className="button secondary" onClick={handleSignOut}>
            Sign out
          </button>
        </div>
      </div>

      {error && <div className="error">{error}</div>}

      {filteredTenants.length === 0 && (
        <div className="notice">No tenants found in the database.</div>
      )}

      {filteredTenants.map((tenant, index) => {
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
        const inviteRole = inviteRoleByTenant[tenant.id] ?? "owner";
        const inviteInfo = inviteInfoByTenant[tenant.id];
        const inviteBusy = !!inviteBusyByTenant[tenant.id];
        const inviteError = inviteErrorByTenant[tenant.id];
        const inviteCopyMessage = inviteCopyMessageByTenant[tenant.id];
        const domains = domainsByTenant[tenant.id] ?? [];
        const domainInput = domainInputByTenant[tenant.id] ?? "";
        const domainBusy = !!domainBusyByTenant[tenant.id];
        const domainError = domainErrorByTenant[tenant.id];
        const archiveInput = archiveInputByTenant[tenant.id] ?? "";
        const archiveBusy = !!archiveBusyByTenant[tenant.id];
        const archiveError = archiveErrorByTenant[tenant.id];

        const statusLabel = (tenant.status ?? "unknown").toLowerCase();
        const statusBadgeClass = `status-badge ${statusLabel}`;
        const isArchived = statusLabel === "archived";

        return (
          <div
            className="card"
            key={tenant.id}
            style={{ animationDelay: `${index * 0.03}s` }}
          >
            <div className="tenant-header">
              <div>
                <h2>{tenant.name}</h2>
                <div className="tenant-meta">
                  <span className={statusBadgeClass}>
                    {tenant.status ?? "unknown"}
                  </span>
                  <span className="muted">Slug: {slug ?? "missing"}</span>
                </div>
              </div>
              <div className="tenant-actions">
                {slug ? (
                  <>
                    <Link className="button" href={`/t/${slug}/admin`}>
                      Open Admin
                    </Link>
                    <Link className="button secondary" href={`/t/${slug}`}>
                      Open Landing
                    </Link>
                    <button
                      type="button"
                      className="button secondary"
                      onClick={() =>
                        handleCopyLink(tenant.id, "Admin link", `/t/${slug}/admin`)
                      }
                    >
                      Copy Admin
                    </button>
                    <button
                      type="button"
                      className="button secondary"
                      onClick={() =>
                        handleCopyLink(tenant.id, "Landing link", `/t/${slug}`)
                      }
                    >
                      Copy Landing
                    </button>
                    {copyMessageByTenant[tenant.id] && (
                      <span className="muted">
                        {copyMessageByTenant[tenant.id]}
                      </span>
                    )}
                  </>
                ) : (
                  <span className="button disabled">Missing slug</span>
                )}
              </div>
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
                <div className="feature-sections">
                  {featureSections.map((section) => {
                    const sectionFeatures = features.filter((feature) =>
                      section.keys.includes(feature.key)
                    );
                    if (!sectionFeatures.length) return null;

                    return (
                      <div className="feature-section" key={section.title}>
                        <div className="feature-section-title">{section.title}</div>
                        <div className="toggle-list">
                          {sectionFeatures.map((feature) => {
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
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="section">
              <div className="section-title">Support access</div>
              {supportStatus ? (
                <p className="muted">
                  Current grant: {supportStatus.mode} until{" "}
                  {formatDateTime(supportStatus.expiresAt)}
                </p>
              ) : (
                <p className="muted">Current grant: None</p>
              )}
              <p className="muted">Support requires tenant grant.</p>
              <div className="tag-list">
                <button
                  type="button"
                  className="button secondary"
                  disabled={!!supportBusy[`${tenant.id}:RO`]}
                  onClick={() => handleSupportRequest(tenant.id, "RO")}
                >
                  Request RO
                </button>
                <button
                  type="button"
                  className="button secondary"
                  disabled={!!supportBusy[`${tenant.id}:RW`]}
                  onClick={() => handleSupportRequest(tenant.id, "RW")}
                >
                  Request RW
                </button>
                <button
                  type="button"
                  className="button secondary"
                  disabled={!!supportBusy[`${tenant.id}:revoke`]}
                  onClick={() => handleSupportRevoke(tenant.id)}
                >
                  Revoke
                </button>
              </div>
            </div>

            <div className="section">
              <div className="section-title">Domains</div>
              <p className="muted">
                Add both apex and www if you want both to work.
              </p>
              <label className="field">
                <span>Domain</span>
                <input
                  type="text"
                  value={domainInput}
                  onChange={(event) =>
                    setDomainInputByTenant((prev) => ({
                      ...prev,
                      [tenant.id]: event.target.value
                    }))
                  }
                  placeholder="example.com"
                />
              </label>
              <div className="tag-list">
                <button
                  type="button"
                  className="button secondary"
                  disabled={domainBusy}
                  onClick={() => handleAddDomain(tenant.id)}
                >
                  {domainBusy ? "Saving..." : "Add domain"}
                </button>
              </div>
              {domainError && <div className="error">{domainError}</div>}
              {domains.length === 0 ? (
                <p className="muted">No domains added.</p>
              ) : (
                domains.map((domain) => (
                  <div className="tag-list" key={`${tenant.id}-${domain}`}>
                    <span className="tag">{domain}</span>
                    <button
                      type="button"
                      className="button secondary"
                      disabled={domainBusy}
                      onClick={() => handleRemoveDomain(tenant.id, domain)}
                    >
                      Remove
                    </button>
                  </div>
                ))
              )}
            </div>

            <div className="section">
              <div className="section-title">Archive tenant</div>
              <p className="muted">
                Type the tenant slug to confirm. This disables landing and admin access.
              </p>
              <label className="field">
                <span>Confirm slug</span>
                <input
                  type="text"
                  value={archiveInput}
                  onChange={(event) =>
                    setArchiveInputByTenant((prev) => ({
                      ...prev,
                      [tenant.id]: event.target.value
                    }))
                  }
                  placeholder={slug ?? "slug"}
                />
              </label>
              <div className="tag-list">
                <button
                  type="button"
                  className="button secondary"
                  disabled={archiveBusy || isArchived}
                  onClick={() => handleArchiveTenant(tenant.id, slug)}
                >
                  {archiveBusy ? "Archiving..." : isArchived ? "Archived" : "Archive tenant"}
                </button>
              </div>
              {archiveError && <div className="error">{archiveError}</div>}
            </div>

            <div className="section">
              <div className="section-title">Owner/Admin invite</div>
              <label className="field">
                <span>Invite role</span>
                <select
                  value={inviteRole}
                  onChange={(event) =>
                    setInviteRoleByTenant((prev) => ({
                      ...prev,
                      [tenant.id]: event.target.value as InviteRole
                    }))
                  }
                >
                  <option value="owner">Owner</option>
                  <option value="admin">Admin</option>
                </select>
              </label>
              <div className="tag-list">
                <button
                  type="button"
                  className="button secondary"
                  disabled={inviteBusy}
                  onClick={() => handleGenerateInvite(tenant.id)}
                >
                  {inviteBusy ? "Generating..." : "Generate invite link"}
                </button>
                {inviteInfo?.url && (
                  <button
                    type="button"
                    className="button secondary"
                    onClick={() => handleCopyInvite(tenant.id, inviteInfo.url)}
                  >
                    Copy invite link
                  </button>
                )}
                {inviteCopyMessage && <span className="muted">{inviteCopyMessage}</span>}
              </div>
              {inviteError && <div className="error">{inviteError}</div>}
              {inviteInfo?.url && (
                <>
                  <label className="field">
                    <span>Invite link</span>
                    <input type="text" value={inviteInfo.url} readOnly />
                  </label>
                  <p className="muted">
                    Expires on {formatDateTime(inviteInfo.expiresAt)}
                  </p>
                </>
              )}
            </div>
          </div>
        );
      })}

      {showCreateTenant && (
        <div className="modal-backdrop">
          <div className="modal">
            <div className="card-header">
              <div>
                <h2>Create Tenant</h2>
                <p className="muted">Add a new tenant with defaults.</p>
              </div>
              <button
                type="button"
                className="button secondary"
                onClick={() => setShowCreateTenant(false)}
              >
                Close
              </button>
            </div>
            <form onSubmit={handleCreateTenant}>
              <label className="field">
                <span>Tenant name</span>
                <input
                  type="text"
                  value={createForm.name}
                  onChange={(event) =>
                    setCreateForm((prev) => ({
                      ...prev,
                      name: event.target.value
                    }))
                  }
                  required
                />
              </label>
              <label className="field">
                <span>Slug</span>
                <input
                  type="text"
                  value={createForm.slug}
                  onChange={(event) =>
                    setCreateForm((prev) => ({
                      ...prev,
                      slug: event.target.value
                    }))
                  }
                  required
                />
              </label>
              <label className="field">
                <span>Owner email (optional)</span>
                <input
                  type="email"
                  value={createForm.ownerEmail}
                  onChange={(event) =>
                    setCreateForm((prev) => ({
                      ...prev,
                      ownerEmail: event.target.value
                    }))
                  }
                  placeholder="Optional"
                />
              </label>
              <label className="field">
                <span>Default feature preset</span>
                <select
                  value={createForm.preset}
                  onChange={(event) =>
                    setCreateForm((prev) => ({
                      ...prev,
                      preset: event.target.value
                    }))
                  }
                >
                  <option value="pg">PG</option>
                  <option value="clinic">Clinic</option>
                  <option value="cab">Cab</option>
                </select>
              </label>
              <button className="button" type="submit" disabled={creatingTenant}>
                {creatingTenant ? "Creating..." : "Create tenant"}
              </button>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
