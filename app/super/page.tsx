"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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

type TenantStats = {
  leads7d: number;
  outboxQueued: number;
  pendingPayments: number;
  apptsToday: number;
  lastActivity: string | null;
};

type DrawerSection =
  | "overview"
  | "features"
  | "support"
  | "domain"
  | "invites"
  | "danger";

const formatDateTime = (value: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
};

const formatRelativeTime = (value?: string | null) => {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const diffMs = Date.now() - date.getTime();
  if (diffMs <= 0) return "just now";
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `${weeks}w ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  const years = Math.floor(days / 365);
  return `${years}y ago`;
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

const normalizeConfirmToken = (value?: string | null) =>
  (value ?? "").trim().toLowerCase();

const missingColumn = (message: string, column: string) =>
  message.includes(`column ${column}`) && message.includes("does not exist");

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
  const [hardDeleteInputByTenant, setHardDeleteInputByTenant] = useState<
    Record<string, string>
  >({});
  const [hardDeleteBusyByTenant, setHardDeleteBusyByTenant] = useState<
    Record<string, boolean>
  >({});
  const [hardDeleteErrorByTenant, setHardDeleteErrorByTenant] = useState<
    Record<string, string>
  >({});
  const [hardDeleteConfirmByTenant, setHardDeleteConfirmByTenant] = useState<
    Record<string, boolean>
  >({});
  const [searchTerm, setSearchTerm] = useState("");
  const [verticalFilter, setVerticalFilter] = useState<"all" | "pg" | "clinic">(
    "all"
  );
  const [statusFilter, setStatusFilter] = useState<
    "all" | "active" | "paused" | "archived"
  >("all");
  const [filterHasOutbox, setFilterHasOutbox] = useState(false);
  const [filterHasPending, setFilterHasPending] = useState(false);
  const [selectedTenantId, setSelectedTenantId] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [activeDrawerSection, setActiveDrawerSection] =
    useState<DrawerSection>("overview");
  const [activeMenuTenantId, setActiveMenuTenantId] = useState<string | null>(null);
  const [tenantStats, setTenantStats] = useState<
    Record<string, TenantStats>
  >({});
  const [statsLoading, setStatsLoading] = useState(false);
  const [statsError, setStatsError] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const toastTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const drawerRef = useRef<HTMLDivElement | null>(null);
  const drawerTouchStartX = useRef<number | null>(null);

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

  const tenantVerticalById = useMemo(() => {
    const map: Record<string, "PG" | "Clinic" | "Core"> = {};
    for (const tenant of tenants) {
      const featuresForTenant = tenantFeatureMap[tenant.id] ?? {};
      let hasPg = false;
      let hasClinic = false;
      for (const [key, enabled] of Object.entries(featuresForTenant)) {
        if (!enabled) continue;
        if (key.startsWith("clinic.")) {
          hasClinic = true;
        }
        if (key.startsWith("pg.")) {
          hasPg = true;
        }
      }
      if (hasClinic) {
        map[tenant.id] = "Clinic";
      } else if (hasPg) {
        map[tenant.id] = "PG";
      } else {
        map[tenant.id] = "Core";
      }
    }
    return map;
  }, [tenants, tenantFeatureMap]);

  const filteredTenants = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    return tenants.filter((tenant) => {
      const slug = slugByTenant[tenant.id] ?? "";
      const matchesTerm =
        !term ||
        tenant.name.toLowerCase().includes(term) ||
        slug.toLowerCase().includes(term);
      if (!matchesTerm) return false;

      if (verticalFilter !== "all") {
        const vertical = tenantVerticalById[tenant.id];
        if (verticalFilter === "pg" && vertical !== "PG") return false;
        if (verticalFilter === "clinic" && vertical !== "Clinic") return false;
      }

      const status = (tenant.status ?? "").toLowerCase();
      if (statusFilter !== "all" && status !== statusFilter) {
        return false;
      }

      if (filterHasOutbox) {
        const queued = tenantStats[tenant.id]?.outboxQueued ?? 0;
        if (queued < 1) return false;
      }

      if (filterHasPending) {
        const stats = tenantStats[tenant.id];
        const pendingCount =
          (stats?.pendingPayments ?? 0) + (stats?.apptsToday ?? 0);
        if (pendingCount < 1) return false;
      }

      return true;
    });
  }, [
    tenants,
    slugByTenant,
    searchTerm,
    verticalFilter,
    statusFilter,
    filterHasOutbox,
    filterHasPending,
    tenantVerticalById,
    tenantStats
  ]);

  const selectedTenant = useMemo(() => {
    if (!selectedTenantId) return null;
    return tenants.find((tenant) => tenant.id === selectedTenantId) ?? null;
  }, [selectedTenantId, tenants]);

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

  useEffect(() => {
    if (!activeMenuTenantId) return;
    const handleClick = (event: MouseEvent) => {
      if (!(event.target as HTMLElement).closest("[data-menu-root]")) {
        setActiveMenuTenantId(null);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [activeMenuTenantId]);

  useEffect(() => {
    if (!activeMenuTenantId) return;
    const menu = document.querySelector<HTMLElement>(
      `[data-menu-items="${activeMenuTenantId}"]`
    );
    const firstItem = menu?.querySelector<HTMLElement>('[role="menuitem"]');
    if (firstItem) {
      requestAnimationFrame(() => firstItem.focus());
    }
  }, [activeMenuTenantId]);

  useEffect(() => {
    return () => {
      if (toastTimeoutRef.current) {
        clearTimeout(toastTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const drawerNode = drawerRef.current;

    if (!drawerOpen) {
      document.body.style.overflow = "";
      if (drawerNode) {
        drawerNode.setAttribute("inert", "");
      }
      return;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    if (drawerNode) {
      drawerNode.removeAttribute("inert");
    }
    const focusable = drawerNode?.querySelectorAll<HTMLElement>(
      "a[href], button:not([disabled]), textarea, input:not([disabled]), select:not([disabled]), summary, [tabindex]:not([tabindex=\"-1\"])"
    );
    const first = focusable?.[0];
    const last = focusable?.[focusable.length - 1];

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setDrawerOpen(false);
        return;
      }
      if (event.key !== "Tab" || !focusable || focusable.length === 0) {
        return;
      }
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    requestAnimationFrame(() => first?.focus());

    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [drawerOpen]);

  useEffect(() => {
    if (drawerOpen && !selectedTenant) {
      setDrawerOpen(false);
    }
  }, [drawerOpen, selectedTenant]);

  useEffect(() => {
    if (drawerOpen && selectedTenant) {
      setActiveDrawerSection("overview");
    }
  }, [drawerOpen, selectedTenant]);

  const loadTenantStats = async (tenantRows: Tenant[]) => {
    const tenantIds = tenantRows.map((tenant) => tenant.id);
    if (tenantIds.length === 0) {
      setTenantStats({});
      setStatsError(null);
      setStatsLoading(false);
      return;
    }

    setStatsLoading(true);
    setStatsError(null);

    const statsMap: Record<string, TenantStats> = {};
    for (const tenant of tenantRows) {
      statsMap[tenant.id] = {
        leads7d: 0,
        outboxQueued: 0,
        pendingPayments: 0,
        apptsToday: 0,
        lastActivity: tenant.created_at ?? null
      };
    }

    const recordActivity = (tenantId: string, value?: string | null) => {
      if (!value) return;
      const existing = statsMap[tenantId];
      if (!existing) return;
      if (!existing.lastActivity) {
        existing.lastActivity = value;
        return;
      }
      const current = new Date(existing.lastActivity);
      const next = new Date(value);
      if (Number.isNaN(next.getTime())) return;
      if (Number.isNaN(current.getTime()) || next > current) {
        existing.lastActivity = value;
      }
    };

    let failedQueries = 0;

    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    const primaryLeadsRes = await supabase
      .from("leads")
      .select("tenant_id, submitted_at, created_at")
      .in("tenant_id", tenantIds)
      .gte("submitted_at", since);

    let leadsRows: {
      tenant_id?: string;
      submitted_at?: string | null;
      created_at?: string | null;
    }[] = [];
    let leadsError = primaryLeadsRes.error;

    if (
      primaryLeadsRes.error &&
      missingColumn(primaryLeadsRes.error.message, "leads.submitted_at")
    ) {
      const fallbackRes = await supabase
        .from("leads")
        .select("tenant_id, created_at")
        .in("tenant_id", tenantIds)
        .gte("created_at", since);
      leadsError = fallbackRes.error;
      leadsRows =
        (fallbackRes.data as {
          tenant_id?: string;
          created_at?: string | null;
        }[]) ?? [];
    } else {
      leadsRows =
        (primaryLeadsRes.data as {
          tenant_id?: string;
          submitted_at?: string | null;
          created_at?: string | null;
        }[]) ?? [];
    }

    if (leadsError) {
      failedQueries += 1;
    } else {
      for (const row of leadsRows) {
        if (!row.tenant_id || !statsMap[row.tenant_id]) continue;
        statsMap[row.tenant_id].leads7d += 1;
        recordActivity(row.tenant_id, row.submitted_at ?? row.created_at ?? null);
      }
    }

    const outboxRes = await supabase
      .from("message_outbox")
      .select("tenant_id, created_at, status")
      .in("tenant_id", tenantIds)
      .is("deleted_at", null)
      .eq("status", "queued");

    if (outboxRes.error) {
      failedQueries += 1;
    } else {
      const rows =
        (outboxRes.data as {
          tenant_id?: string;
          created_at?: string | null;
          status?: string | null;
        }[]) ?? [];
      for (const row of rows) {
        if (!row.tenant_id || !statsMap[row.tenant_id]) continue;
        statsMap[row.tenant_id].outboxQueued += 1;
        recordActivity(row.tenant_id, row.created_at ?? null);
      }
    }

    const paymentsRes = await supabase
      .from("pg_payments")
      .select("tenant_id, created_at, status")
      .in("tenant_id", tenantIds)
      .is("deleted_at", null)
      .in("status", ["due", "partial"]);

    if (paymentsRes.error) {
      failedQueries += 1;
    } else {
      const rows =
        (paymentsRes.data as {
          tenant_id?: string;
          created_at?: string | null;
          status?: string | null;
        }[]) ?? [];
      for (const row of rows) {
        if (!row.tenant_id || !statsMap[row.tenant_id]) continue;
        statsMap[row.tenant_id].pendingPayments += 1;
        recordActivity(row.tenant_id, row.created_at ?? null);
      }
    }

    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const endOfToday = new Date(startOfToday);
    endOfToday.setDate(startOfToday.getDate() + 1);

    const apptsRes = await supabase
      .from("clinic_appointments")
      .select("tenant_id, scheduled_at")
      .in("tenant_id", tenantIds)
      .is("deleted_at", null)
      .gte("scheduled_at", startOfToday.toISOString())
      .lt("scheduled_at", endOfToday.toISOString());

    if (apptsRes.error) {
      failedQueries += 1;
    } else {
      const rows =
        (apptsRes.data as {
          tenant_id?: string;
          scheduled_at?: string | null;
        }[]) ?? [];
      for (const row of rows) {
        if (!row.tenant_id || !statsMap[row.tenant_id]) continue;
        statsMap[row.tenant_id].apptsToday += 1;
        recordActivity(row.tenant_id, row.scheduled_at ?? null);
      }
    }

    if (failedQueries >= 4) {
      setStatsError("Stats unavailable for this account.");
    }

    setTenantStats(statsMap);
    setStatsLoading(false);
  };

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
    void loadTenantStats((tenantsRes.data as Tenant[]) ?? []);
  };

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    router.replace("/login");
  };

  const showToast = (message: string) => {
    setToastMessage(message);
    if (toastTimeoutRef.current) {
      clearTimeout(toastTimeoutRef.current);
    }
    toastTimeoutRef.current = setTimeout(() => {
      setToastMessage(null);
    }, 2200);
  };

  const openDrawer = (tenantId: string) => {
    setSelectedTenantId(tenantId);
    setDrawerOpen(true);
    setActiveMenuTenantId(null);
    setActiveDrawerSection("overview");
  };

  const closeDrawer = () => {
    setDrawerOpen(false);
  };

  const handleDrawerTouchStart = (event: React.TouchEvent<HTMLDivElement>) => {
    drawerTouchStartX.current = event.touches[0]?.clientX ?? null;
  };

  const handleDrawerTouchMove = (event: React.TouchEvent<HTMLDivElement>) => {
    if (drawerTouchStartX.current === null) return;
    const currentX = event.touches[0]?.clientX ?? 0;
    if (currentX - drawerTouchStartX.current > 80) {
      drawerTouchStartX.current = null;
      setDrawerOpen(false);
    }
  };

  const handleDrawerTouchEnd = () => {
    drawerTouchStartX.current = null;
  };

  const handleCopyLink = async (tenantId: string, label: string, path: string) => {
    try {
      const url = new URL(path, window.location.origin).toString();
      await navigator.clipboard.writeText(url);
      showToast(`${label} copied`);
    } catch (copyError) {
      showToast("Copy failed");
    }
  };

  const handleCopyInvite = async (tenantId: string, url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      showToast("Invite link copied");
    } catch (copyError) {
      showToast("Copy failed");
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

  const handleArchiveTenant = async (
    tenantId: string,
    expectedToken: string
  ) => {
    if (!session?.user.id) {
      setError("Session expired. Please sign in again.");
      return;
    }

    const input = normalizeConfirmToken(archiveInputByTenant[tenantId]);
    const expected = normalizeConfirmToken(expectedToken);

    if (!expected) {
      setArchiveErrorByTenant((prev) => ({
        ...prev,
        [tenantId]: "Tenant identifier is missing. Cannot archive."
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

  const handleHardDeleteTenant = async (
    tenantId: string,
    expectedToken: string
  ) => {
    if (!session?.user.id) {
      setError("Session expired. Please sign in again.");
      return;
    }

    const input = normalizeConfirmToken(hardDeleteInputByTenant[tenantId]);
    const expected = normalizeConfirmToken(expectedToken);

    if (!expected) {
      setHardDeleteErrorByTenant((prev) => ({
        ...prev,
        [tenantId]: "Tenant identifier is missing. Cannot delete."
      }));
      return;
    }

    if (input !== expected) {
      setHardDeleteErrorByTenant((prev) => ({
        ...prev,
        [tenantId]: "Type the exact slug to confirm."
      }));
      return;
    }

    setHardDeleteBusyByTenant((prev) => ({ ...prev, [tenantId]: true }));
    setHardDeleteErrorByTenant((prev) => {
      const next = { ...prev };
      delete next[tenantId];
      return next;
    });

    const { error: deleteError } = await supabase
      .schema("public")
      .rpc("hard_delete_tenant", { p_tenant_id: tenantId });

    if (deleteError) {
      setHardDeleteErrorByTenant((prev) => ({
        ...prev,
        [tenantId]: deleteError.message
      }));
      setHardDeleteBusyByTenant((prev) => ({ ...prev, [tenantId]: false }));
      return;
    }

    setTenants((prev) => prev.filter((row) => row.id !== tenantId));
    setSlugByTenant((prev) => {
      const next = { ...prev };
      delete next[tenantId];
      return next;
    });
    setDomainsByTenant((prev) => {
      const next = { ...prev };
      delete next[tenantId];
      return next;
    });
    setHardDeleteInputByTenant((prev) => ({ ...prev, [tenantId]: "" }));
    setHardDeleteConfirmByTenant((prev) => {
      const next = { ...prev };
      delete next[tenantId];
      return next;
    });
    setHardDeleteBusyByTenant((prev) => ({ ...prev, [tenantId]: false }));
    if (selectedTenantId === tenantId) {
      setDrawerOpen(false);
      setSelectedTenantId(null);
    }
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

  const statsReady = !statsLoading && !statsError;

  const formatStatValue = (value?: number) => {
  if (statsLoading) return "...";
  if (typeof value !== "number") return "-";
    return value.toString();
  };

  const handleRowKeyDown = (
    event: React.KeyboardEvent<HTMLTableRowElement | HTMLDivElement>,
    tenantId: string
  ) => {
    const target = event.target as HTMLElement | null;
    if (
      target &&
      target !== event.currentTarget &&
      target.closest("a, button, input, select, textarea, summary, details")
    ) {
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openDrawer(tenantId);
    }
  };

  const stopRowClick = (event: React.SyntheticEvent) => {
    event.stopPropagation();
  };

  const handleMenuKeyDown = (
    event: React.KeyboardEvent<HTMLDivElement>,
    tenantId: string
  ) => {
    const menuItems = Array.from(
      event.currentTarget.querySelectorAll<HTMLElement>('[role="menuitem"]')
    );
    if (event.key === "Escape") {
      event.stopPropagation();
      setActiveMenuTenantId(null);
      const trigger = document.querySelector<HTMLElement>(
        `[data-menu-trigger="${tenantId}"]`
      );
      trigger?.focus();
      return;
    }
    if (!menuItems.length) return;

    const currentIndex = menuItems.indexOf(
      document.activeElement as HTMLElement
    );

    if (event.key === "ArrowDown") {
      event.preventDefault();
      const nextIndex = currentIndex >= 0 ? currentIndex + 1 : 0;
      menuItems[nextIndex % menuItems.length]?.focus();
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      const prevIndex =
        currentIndex >= 0 ? currentIndex - 1 : menuItems.length - 1;
      menuItems[(prevIndex + menuItems.length) % menuItems.length]?.focus();
    }

    if (event.key === "Home") {
      event.preventDefault();
      menuItems[0]?.focus();
    }

    if (event.key === "End") {
      event.preventDefault();
      menuItems[menuItems.length - 1]?.focus();
    }
  };

  const handleSectionClick =
    (section: DrawerSection) => (event: React.MouseEvent<HTMLElement>) => {
      event.preventDefault();
      setActiveDrawerSection(section);
    };

  const renderStatsChips = (
    tenantId: string,
    vertical: "PG" | "Clinic" | "Core"
  ) => {
    const stats = tenantStats[tenantId];
    const primaryLabel =
      vertical === "Clinic"
        ? "Appts today"
        : vertical === "PG"
          ? "PG dues"
          : "Pending";
    const primaryValue =
      vertical === "Clinic"
        ? stats?.apptsToday
        : vertical === "PG"
          ? stats?.pendingPayments
          : (stats?.pendingPayments ?? 0) + (stats?.apptsToday ?? 0);

    return (
      <div className="stat-chips">
        <span className="stat-chip">
          Leads 7d <strong>{formatStatValue(stats?.leads7d)}</strong>
        </span>
        <span className="stat-chip">
          Outbox queued <strong>{formatStatValue(stats?.outboxQueued)}</strong>
        </span>
        <span className="stat-chip">
          {primaryLabel} <strong>{formatStatValue(primaryValue)}</strong>
        </span>
      </div>
    );
  };

  const renderMoreMenu = (tenantId: string, slug?: string | null) => {
    const isOpen = activeMenuTenantId === tenantId;
    return (
      <div className="more-menu" data-menu-root onClick={stopRowClick}>
        <button
          type="button"
          className="kebab-button"
          aria-haspopup="menu"
          aria-expanded={isOpen}
          aria-label="More tenant actions"
          data-menu-trigger={tenantId}
          onClick={() =>
            setActiveMenuTenantId((prev) => (prev === tenantId ? null : tenantId))
          }
        >
          <span aria-hidden="true">...</span>
        </button>
        {isOpen && (
          <div
            className="menu"
            role="menu"
            aria-label="Tenant actions"
            data-menu-items={tenantId}
            onKeyDown={(event) => handleMenuKeyDown(event, tenantId)}
          >
            {slug ? (
              <>
                <button
                  type="button"
                  role="menuitem"
                  className="menu-item"
                  onClick={() => {
                    setActiveMenuTenantId(null);
                    router.push(`/t/${slug}`);
                  }}
                >
                  Open Landing
                </button>
                <div className="menu-divider" />
                <div className="menu-group">
                  <div className="menu-group-title">Copy links</div>
                  <button
                    type="button"
                    role="menuitem"
                    className="menu-item"
                    onClick={() => {
                      setActiveMenuTenantId(null);
                      handleCopyLink(tenantId, "Admin link", `/t/${slug}/admin`);
                    }}
                  >
                    Copy Admin Link
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    className="menu-item"
                    onClick={() => {
                      setActiveMenuTenantId(null);
                      handleCopyLink(tenantId, "Landing link", `/t/${slug}`);
                    }}
                  >
                    Copy Landing Link
                  </button>
                </div>
              </>
            ) : (
              <div className="menu-item muted">Slug missing</div>
            )}
            <div className="menu-divider" />
            <button
              type="button"
              role="menuitem"
              className="menu-item"
              onClick={() => openDrawer(tenantId)}
            >
              Manage
            </button>
          </div>
        )}
      </div>
    );
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
      <div className="super-shell" aria-hidden={drawerOpen}>
      <div className="super-header">
        <div className="super-header-left">
          <h1>Super Admin</h1>
          <p className="muted">Tenant operations and support controls.</p>
        </div>
        <div className="super-header-center">
            <input
              className="super-search"
              type="search"
              placeholder="Search tenant name or slug"
              aria-label="Search tenant name or slug"
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
            />
        </div>
        <div className="super-header-right">
          <Link className="button secondary" href="/super/create-tenant">
            Create tenant
          </Link>
          <div className="super-user">
            <span className="muted">{session?.user.email ?? session?.user.id}</span>
            <button className="button secondary" onClick={handleSignOut}>
              Sign out
            </button>
          </div>
        </div>
      </div>

      {error && <div className="error">{error}</div>}

      <details className="super-filters" open>
        <summary>Filters</summary>
        <div className="super-filters-body">
          <div className="filter-group">
            <span className="filter-label">Vertical</span>
            <div className="segmented">
              <button
                type="button"
                className={`segmented-button ${
                  verticalFilter === "all" ? "active" : ""
                }`}
                onClick={() => setVerticalFilter("all")}
              >
                All
              </button>
              <button
                type="button"
                className={`segmented-button ${
                  verticalFilter === "pg" ? "active" : ""
                }`}
                onClick={() => setVerticalFilter("pg")}
              >
                PG
              </button>
              <button
                type="button"
                className={`segmented-button ${
                  verticalFilter === "clinic" ? "active" : ""
                }`}
                onClick={() => setVerticalFilter("clinic")}
              >
                Clinic
              </button>
            </div>
          </div>
          <div className="filter-group">
            <span className="filter-label">Status</span>
            <div className="segmented">
              <button
                type="button"
                className={`segmented-button ${
                  statusFilter === "all" ? "active" : ""
                }`}
                onClick={() => setStatusFilter("all")}
              >
                All
              </button>
              <button
                type="button"
                className={`segmented-button ${
                  statusFilter === "active" ? "active" : ""
                }`}
                onClick={() => setStatusFilter("active")}
              >
                Active
              </button>
              <button
                type="button"
                className={`segmented-button ${
                  statusFilter === "paused" ? "active" : ""
                }`}
                onClick={() => setStatusFilter("paused")}
              >
                Paused
              </button>
              <button
                type="button"
                className={`segmented-button ${
                  statusFilter === "archived" ? "active" : ""
                }`}
                onClick={() => setStatusFilter("archived")}
              >
                Archived
              </button>
            </div>
          </div>
          <div className="filter-group">
            <span className="filter-label">Quick toggles</span>
            <div className="filter-toggles">
              <label className={`toggle-pill ${!statsReady ? "disabled" : ""}`}>
                <input
                  type="checkbox"
                  checked={filterHasOutbox}
                  disabled={!statsReady}
                  onChange={(event) => setFilterHasOutbox(event.target.checked)}
                />
                Has queued outbox
              </label>
              <label className={`toggle-pill ${!statsReady ? "disabled" : ""}`}>
                <input
                  type="checkbox"
                  checked={filterHasPending}
                  disabled={!statsReady}
                  onChange={(event) => setFilterHasPending(event.target.checked)}
                />
                Has pending dues/appts
              </label>
            </div>
            {!statsReady && statsError && (
              <span className="muted">{statsError}</span>
            )}
          </div>
          <div className="filter-meta">
            <span className="muted">
              Showing {filteredTenants.length} of {tenants.length} tenants
            </span>
            {statsLoading && <span className="muted">Refreshing stats...</span>}
          </div>
        </div>
      </details>

      {filteredTenants.length === 0 ? (
        <div className="notice">No tenants match those filters.</div>
      ) : (
        <>
          <div className="super-table-wrap">
            <table className="super-table">
              <thead>
                <tr>
                  <th>Tenant</th>
                  <th>Vertical</th>
                  <th>Status</th>
                  <th>Key stats</th>
                  <th>Last activity</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredTenants.map((tenant, index) => {
                  const slug = slugByTenant[tenant.id];
                  const statusLabel = (tenant.status ?? "unknown").toLowerCase();
                  const statusBadgeClass = `status-badge ${statusLabel}`;
                  const vertical = tenantVerticalById[tenant.id] ?? "Core";
                  const stats = tenantStats[tenant.id];
                  const lastActivity = stats?.lastActivity ?? tenant.created_at;
                  const isSelected = selectedTenantId === tenant.id;
                  const isMenuOpen = activeMenuTenantId === tenant.id;

                  return (
                    <tr
                      key={tenant.id}
                      className={`tenant-row ${isSelected ? "selected" : ""} ${
                        isMenuOpen ? "menu-open" : ""
                      }`}
                      onClick={() => openDrawer(tenant.id)}
                      onKeyDown={(event) => handleRowKeyDown(event, tenant.id)}
                      tabIndex={0}
                      aria-label={`Open ${tenant.name} panel`}
                      style={{ animationDelay: `${index * 0.02}s` }}
                    >
                      <td>
                        <div className="tenant-title">{tenant.name}</div>
                        <div className="tenant-subtitle">
                          {slug ?? "missing slug"}
                        </div>
                      </td>
                      <td>
                        <span className="badge">{vertical}</span>
                      </td>
                      <td>
                        <span className={statusBadgeClass}>
                          {tenant.status ?? "unknown"}
                        </span>
                      </td>
                      <td>{renderStatsChips(tenant.id, vertical)}</td>
                      <td>
                        <span title={formatDateTime(lastActivity)}>
                          {formatRelativeTime(lastActivity)}
                        </span>
                      </td>
                      <td>
                        <div className="table-actions">
                          {slug ? (
                            <Link
                              className="button"
                              href={`/t/${slug}/admin`}
                              onClick={stopRowClick}
                            >
                              Open Admin
                            </Link>
                          ) : (
                            <span className="button disabled">Missing slug</span>
                          )}
                          {renderMoreMenu(tenant.id, slug)}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="tenant-cards">
            {filteredTenants.map((tenant, index) => {
              const slug = slugByTenant[tenant.id];
              const statusLabel = (tenant.status ?? "unknown").toLowerCase();
              const statusBadgeClass = `status-badge ${statusLabel}`;
              const vertical = tenantVerticalById[tenant.id] ?? "Core";
              const stats = tenantStats[tenant.id];
              const lastActivity = stats?.lastActivity ?? tenant.created_at;
              const isSelected = selectedTenantId === tenant.id;
              const isMenuOpen = activeMenuTenantId === tenant.id;

              return (
                <div
                  key={tenant.id}
                  className={`tenant-card ${isSelected ? "selected" : ""} ${
                    isMenuOpen ? "menu-open" : ""
                  }`}
                  onClick={() => openDrawer(tenant.id)}
                  onKeyDown={(event) => handleRowKeyDown(event, tenant.id)}
                  tabIndex={0}
                  role="button"
                  aria-label={`Open ${tenant.name} panel`}
                  style={{ animationDelay: `${index * 0.02}s` }}
                >
                  <div className="tenant-card-header">
                    <div>
                      <div className="tenant-title">{tenant.name}</div>
                      <div className="tenant-subtitle">
                        {slug ?? "missing slug"}
                      </div>
                    </div>
                    <div className="badge-row">
                      <span className="badge">{vertical}</span>
                      <span className={statusBadgeClass}>
                        {tenant.status ?? "unknown"}
                      </span>
                    </div>
                  </div>
                  <div className="tenant-card-meta">
                    Last activity{" "}
                    <span title={formatDateTime(lastActivity)}>
                      {formatRelativeTime(lastActivity)}
                    </span>
                  </div>
                  {renderStatsChips(tenant.id, vertical)}
                  <div className="tenant-card-actions">
                    {slug ? (
                      <Link
                        className="button"
                        href={`/t/${slug}/admin`}
                        onClick={stopRowClick}
                      >
                        Open Admin
                      </Link>
                    ) : (
                      <span className="button disabled">Missing slug</span>
                    )}
                    {renderMoreMenu(tenant.id, slug)}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {toastMessage && (
        <div className="toast" role="status" aria-live="polite">
          {toastMessage}
        </div>
      )}
      {selectedTenant &&
        (() => {
          const tenant = selectedTenant as Tenant;
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
          const domains = domainsByTenant[tenant.id] ?? [];
          const domainInput = domainInputByTenant[tenant.id] ?? "";
          const domainBusy = !!domainBusyByTenant[tenant.id];
          const domainError = domainErrorByTenant[tenant.id];
          const archiveInput = archiveInputByTenant[tenant.id] ?? "";
          const archiveBusy = !!archiveBusyByTenant[tenant.id];
          const archiveError = archiveErrorByTenant[tenant.id];
          const hardDeleteInput = hardDeleteInputByTenant[tenant.id] ?? "";
          const hardDeleteBusy = !!hardDeleteBusyByTenant[tenant.id];
          const hardDeleteError = hardDeleteErrorByTenant[tenant.id];
          const hardDeleteConfirm =
            !!hardDeleteConfirmByTenant[tenant.id];
          const confirmToken = slug ?? tenant.id;
          const confirmLabel = slug ? "Confirm slug" : "Confirm tenant ID";
          const confirmHint = slug
            ? "Type the tenant slug to confirm."
            : "Slug missing. Type the tenant ID to confirm.";
          const statusLabel = (tenant.status ?? "unknown").toLowerCase();
          const statusBadgeClass = `status-badge ${statusLabel}`;
          const isArchived = statusLabel === "archived";
          const vertical = tenantVerticalById[tenant.id] ?? "Core";
          const stats = tenantStats[tenant.id];
          const lastActivity = stats?.lastActivity ?? tenant.created_at;

          return (
            <>
              {drawerOpen && (
                <div className="drawer-backdrop" onClick={closeDrawer} />
              )}
              <aside
                className={`drawer ${drawerOpen ? "open" : ""}`}
                role="dialog"
                aria-modal="true"
                aria-label={`Tenant panel for ${tenant.name}`}
                aria-hidden={!drawerOpen}
                ref={drawerRef}
                onTouchStart={handleDrawerTouchStart}
                onTouchMove={handleDrawerTouchMove}
                onTouchEnd={handleDrawerTouchEnd}
              >
                <div className="drawer-header">
                  <div>
                    <p className="drawer-kicker">Tenant panel</p>
                    <h2>{tenant.name}</h2>
                    <div className="tenant-meta">
                      <span className={statusBadgeClass}>
                        {tenant.status ?? "unknown"}
                      </span>
                      <span className="badge">{vertical}</span>
                      <span className="muted">{slug ?? "missing slug"}</span>
                    </div>
                  </div>
                  <button
                    type="button"
                    className="button secondary icon-button"
                    aria-label="Close tenant panel"
                    onClick={closeDrawer}
                  >
                    X
                  </button>
                </div>
                <div className="drawer-body">
                  <details
                    className="drawer-section"
                    open={activeDrawerSection === "overview"}
                  >
                    <summary onClick={handleSectionClick("overview")}>
                      Overview
                    </summary>
                    <div className="drawer-section-content">
                      <div className="drawer-actions">
                        {slug ? (
                          <Link className="button" href={`/t/${slug}/admin`}>
                            Open Admin
                          </Link>
                        ) : (
                          <span className="button disabled">Missing slug</span>
                        )}
                        {slug ? (
                          <Link className="button secondary" href={`/t/${slug}`}>
                            Open Landing
                          </Link>
                        ) : (
                          <span className="button secondary disabled">
                            Open Landing
                          </span>
                        )}
                      </div>
                      <div className="drawer-actions">
                        {slug ? (
                          <details className="copy-dropdown">
                            <summary className="button secondary">
                              Copy links
                            </summary>
                            <div className="dropdown-menu">
                              <button
                                type="button"
                                className="dropdown-item"
                                onClick={(event) => {
                                  const details = (
                                    event.currentTarget as HTMLElement
                                  ).closest("details");
                                  if (details) {
                                    details.removeAttribute("open");
                                  }
                                  handleCopyLink(
                                    tenant.id,
                                    "Admin link",
                                    `/t/${slug}/admin`
                                  );
                                }}
                              >
                                Copy Admin Link
                              </button>
                              <button
                                type="button"
                                className="dropdown-item"
                                onClick={(event) => {
                                  const details = (
                                    event.currentTarget as HTMLElement
                                  ).closest("details");
                                  if (details) {
                                    details.removeAttribute("open");
                                  }
                                  handleCopyLink(
                                    tenant.id,
                                    "Landing link",
                                    `/t/${slug}`
                                  );
                                }}
                              >
                                Copy Landing Link
                              </button>
                            </div>
                          </details>
                        ) : (
                          <span className="button secondary disabled">Copy links</span>
                        )}
                      </div>
                      <div className="drawer-stats-grid">
                        <div className="drawer-stat">
                          <span className="muted">Leads 7d</span>
                          <strong>{formatStatValue(stats?.leads7d)}</strong>
                        </div>
                        <div className="drawer-stat">
                          <span className="muted">Outbox queued</span>
                          <strong>{formatStatValue(stats?.outboxQueued)}</strong>
                        </div>
                        <div className="drawer-stat">
                          <span className="muted">
                            {vertical === "Clinic"
                              ? "Appts today"
                              : vertical === "PG"
                                ? "PG dues"
                                : "Pending"}
                          </span>
                          <strong>
                            {formatStatValue(
                              vertical === "Clinic"
                                ? stats?.apptsToday
                                : vertical === "PG"
                                  ? stats?.pendingPayments
                                  : (stats?.pendingPayments ?? 0) +
                                    (stats?.apptsToday ?? 0)
                            )}
                          </strong>
                        </div>
                      </div>
                      <p className="muted">
                        Last activity:{" "}
                        <span title={formatDateTime(lastActivity)}>
                          {formatRelativeTime(lastActivity)}
                        </span>
                      </p>
                    </div>
                  </details>

                  <details
                    className="drawer-section"
                    open={activeDrawerSection === "features"}
                  >
                    <summary onClick={handleSectionClick("features")}>
                      Features
                    </summary>
                    <div className="drawer-section-content">
                      <div className="drawer-subsection">
                        <div className="drawer-subtitle">Enabled features</div>
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
                      <div className="drawer-subsection">
                        <div className="drawer-subtitle">Module toggles</div>
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
                                  <div className="feature-section-title">
                                    {section.title}
                                  </div>
                                  <div className="toggle-list">
                                    {sectionFeatures.map((feature) => {
                                      const enabled =
                                        !!tenantFeatureMap[tenant.id]?.[
                                          feature.key
                                        ];
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
                                              handleToggle(
                                                tenant.id,
                                                feature.key,
                                                !enabled
                                              )
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
                    </div>
                  </details>

                  <details
                    className="drawer-section"
                    open={activeDrawerSection === "support"}
                  >
                    <summary onClick={handleSectionClick("support")}>
                      Support Access
                    </summary>
                    <div className="drawer-section-content">
                      {supportStatus ? (
                        <p className="muted">
                          Current grant: {supportStatus.mode} until{" "}
                          {formatDateTime(supportStatus.expiresAt)}
                        </p>
                      ) : (
                        <p className="muted">Current grant: None</p>
                      )}
                      <p className="muted">Support requires tenant grant.</p>
                      <div className="drawer-actions">
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
                  </details>

                  <details
                    className="drawer-section"
                    open={activeDrawerSection === "domain"}
                  >
                    <summary onClick={handleSectionClick("domain")}>
                      Domain
                    </summary>
                    <div className="drawer-section-content">
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
                      <div className="drawer-actions">
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
                  </details>

                  <details
                    className="drawer-section"
                    open={activeDrawerSection === "invites"}
                  >
                    <summary onClick={handleSectionClick("invites")}>
                      Admin / Invites
                    </summary>
                    <div className="drawer-section-content">
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
                      <div className="drawer-actions">
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
                            onClick={() =>
                              handleCopyInvite(tenant.id, inviteInfo.url)
                            }
                          >
                            Copy invite link
                          </button>
                        )}
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
                  </details>

                  <details
                    className="drawer-section danger-zone"
                    open={activeDrawerSection === "danger"}
                  >
                    <summary onClick={handleSectionClick("danger")}>
                      Danger Zone
                    </summary>
                    <div className="drawer-section-content">
                      <div className="danger-block">
                        <div className="danger-title">Archive tenant</div>
                        <p className="muted">
                          {confirmHint} This disables landing and admin access.
                        </p>
                        <label className="field">
                          <span>{confirmLabel}</span>
                          <input
                            type="text"
                            value={archiveInput}
                            onChange={(event) =>
                              setArchiveInputByTenant((prev) => ({
                                ...prev,
                                [tenant.id]: event.target.value
                              }))
                            }
                            placeholder={confirmToken}
                          />
                        </label>
                        <div className="drawer-actions">
                          <button
                            type="button"
                            className="button secondary"
                            disabled={archiveBusy || isArchived}
                            onClick={() =>
                              handleArchiveTenant(tenant.id, confirmToken)
                            }
                          >
                            {archiveBusy
                              ? "Archiving..."
                              : isArchived
                                ? "Archived"
                                : "Archive tenant"}
                          </button>
                        </div>
                        {archiveError && <div className="error">{archiveError}</div>}
                      </div>
                      <div className="danger-divider" />
                      <div className="danger-block">
                        <div className="danger-title">Hard delete tenant</div>
                        <p className="muted">
                          Permanently removes tenant data. {confirmHint}
                        </p>
                        <label className="field">
                          <span>{confirmLabel}</span>
                          <input
                            type="text"
                            value={hardDeleteInput}
                            onChange={(event) =>
                              setHardDeleteInputByTenant((prev) => ({
                                ...prev,
                                [tenant.id]: event.target.value
                              }))
                            }
                            placeholder={confirmToken}
                          />
                        </label>
                        <label className="danger-confirm">
                          <input
                            type="checkbox"
                            checked={hardDeleteConfirm}
                            onChange={(event) =>
                              setHardDeleteConfirmByTenant((prev) => ({
                                ...prev,
                                [tenant.id]: event.target.checked
                              }))
                            }
                          />
                          I understand this is permanent.
                        </label>
                        <div className="drawer-actions">
                          <button
                            type="button"
                            className="button secondary"
                            disabled={hardDeleteBusy || !hardDeleteConfirm}
                            onClick={() =>
                              handleHardDeleteTenant(tenant.id, confirmToken)
                            }
                          >
                            {hardDeleteBusy ? "Deleting..." : "Hard delete tenant"}
                          </button>
                        </div>
                        {hardDeleteError && <div className="error">{hardDeleteError}</div>}
                      </div>
                    </div>
                  </details>
                </div>
              </aside>
            </>
          );
        })()}

      </div>

    </>
  );
}

