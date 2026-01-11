"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { getTenantContextFromSlug, type TenantContext } from "@/lib/tenant";
import { requireTenantAccess } from "@/lib/access";
import {
  TenantContextProvider,
  type TenantAdminContext
} from "@/components/TenantContextProvider";

const normalizeRole = (value?: string | null) => (value ?? "").toLowerCase();

const isOwnerAdminRole = (value?: string | null) => {
  const role = normalizeRole(value);
  return role === "owner" || role === "admin";
};

const isMemberRole = (value?: string | null) => {
  const role = normalizeRole(value);
  return role === "owner" || role === "admin" || role === "member";
};

const getErrorMessage = (error: unknown) =>
  error instanceof Error ? error.message : "Unexpected error.";

export default function TenantAdminLayout({
  children,
  params
}: {
  children: React.ReactNode;
  params: { slug: string };
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [accessDenied, setAccessDenied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [contextValue, setContextValue] = useState<TenantAdminContext | null>(
    null
  );
  const [tenantName, setTenantName] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [copyMessage, setCopyMessage] = useState<string | null>(null);

  const adminPath = useMemo(() => `/t/${params.slug}/admin`, [params.slug]);

  useEffect(() => {
    let active = true;

    const init = async () => {
      setLoading(true);
      setAccessDenied(false);
      setError(null);

      const { data: sessionData, error: sessionError } =
        await supabase.auth.getSession();

      if (!active) return;

      if (sessionError) {
        setError(sessionError.message);
        setLoading(false);
        return;
      }

      if (!sessionData.session) {
        router.replace(`/login?redirect=${encodeURIComponent(adminPath)}`);
        return;
      }
      setUserEmail(sessionData.session.user.email ?? null);

      let tenantContext: TenantContext;
      try {
        tenantContext = await getTenantContextFromSlug(supabase, params.slug, {
          includeLanding: false
        });
      } catch (loadError) {
        setError(getErrorMessage(loadError));
        setLoading(false);
        return;
      }

      if (!active) return;

      const hasAccess = await requireTenantAccess(
        supabase,
        tenantContext.tenantId
      );

      if (!active) return;

      if (!hasAccess) {
        setAccessDenied(true);
        setLoading(false);
        return;
      }

      const { data: membership, error: membershipError } = await supabase
        .from("tenant_members")
        .select("role, is_active")
        .eq("tenant_id", tenantContext.tenantId)
        .eq("user_id", sessionData.session.user.id)
        .eq("is_active", true)
        .maybeSingle();

      if (!active) return;

      const roleValue =
        !membershipError && membership?.is_active ? String(membership.role) : null;
      const hasMembership = !!roleValue;
      const hasSupport = tenantContext.supportMode !== "none";

      if (!hasMembership && !hasSupport) {
        setAccessDenied(true);
        setLoading(false);
        return;
      }

      const isOwnerAdmin = isOwnerAdminRole(roleValue);
      const canWrite = isMemberRole(roleValue) || tenantContext.supportMode === "rw";

      setContextValue({
        tenant: tenantContext,
        memberRole: roleValue,
        isOwnerAdmin,
        canWrite
      });

      const { data: tenantRow } = await supabase
        .from("tenants")
        .select("name")
        .eq("id", tenantContext.tenantId)
        .maybeSingle();

      if (active) {
        setTenantName(tenantRow?.name ?? null);
      }
      setLoading(false);
    };

    init();

    return () => {
      active = false;
    };
  }, [params.slug, router, adminPath]);

  if (loading) {
    return (
      <div className="card">
        <h1>Loading admin...</h1>
        <p className="muted">Resolving tenant access.</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="card">
        <h1>Admin unavailable</h1>
        <div className="error">{error}</div>
      </div>
    );
  }

  if (accessDenied) {
    return (
      <div className="card">
        <h1>Access denied</h1>
        <p className="muted">
          You do not have tenant membership or an active support grant.
        </p>
        <Link
          className="button secondary"
          href={`/login?redirect=${encodeURIComponent(adminPath)}`}
        >
          Go to login
        </Link>
      </div>
    );
  }

  if (!contextValue) {
    return null;
  }

  const hasAppointments =
    contextValue.tenant.enabledFeatureKeys.includes("clinic.appointments");
  const hasPgBeds = contextValue.tenant.enabledFeatureKeys.includes("pg.beds");
  const hasPgPayments =
    contextValue.tenant.enabledFeatureKeys.includes("pg.payments");
  const isMember = isMemberRole(contextValue.memberRole);
  const hasAuditAccess =
    contextValue.isOwnerAdmin ||
    (contextValue.tenant.isPlatformUser &&
      contextValue.tenant.supportMode !== "none");
  const hasAutomationAccess =
    isMember ||
    (contextValue.tenant.isPlatformUser &&
      contextValue.tenant.supportMode !== "none");
  const showSupportNav = hasAuditAccess;
  const supportLabel =
    contextValue.tenant.supportMode === "none"
      ? null
      : `Support: ${contextValue.tenant.supportMode.toUpperCase()}`;
  const showSupportBanner = contextValue.tenant.supportMode === "ro";
  const tenantDisplayName = tenantName || contextValue.tenant.slug;
  const tenantSubLabel = tenantName ? contextValue.tenant.slug : "Tenant";

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    router.replace("/login");
  };

  const copyLink = async (label: string, path: string) => {
    if (typeof window === "undefined") return;
    try {
      const url = new URL(path, window.location.origin).toString();
      await navigator.clipboard.writeText(url);
      setCopyMessage(`${label} copied`);
      setTimeout(() => setCopyMessage(null), 2000);
    } catch (copyError) {
      setCopyMessage("Copy failed");
      setTimeout(() => setCopyMessage(null), 2000);
    }
  };

  return (
    <TenantContextProvider value={contextValue}>
      <div className="admin-layout">
        <header className="admin-topbar">
          <div className="admin-topbar-left">
            <div className="admin-tenant">{tenantDisplayName}</div>
            <div className="muted">{tenantSubLabel}</div>
          </div>
          <div className="admin-topbar-center muted">Tenant Admin</div>
          <div className="admin-topbar-right">
            {supportLabel && <span className="support-badge">{supportLabel}</span>}
            <details className="admin-dropdown">
              <summary className="button secondary">Copy links</summary>
              <div className="admin-dropdown-menu">
                <button
                  type="button"
                  className="button secondary"
                  onClick={() => copyLink("Landing link", `/t/${params.slug}`)}
                >
                  Copy landing
                </button>
                <button
                  type="button"
                  className="button secondary"
                  onClick={() => copyLink("Admin link", adminPath)}
                >
                  Copy admin
                </button>
                {copyMessage && <div className="muted">{copyMessage}</div>}
              </div>
            </details>
            <details className="admin-dropdown">
              <summary className="button secondary">
                {userEmail ?? "User menu"}
              </summary>
              <div className="admin-dropdown-menu">
                <div className="muted">{userEmail ?? "Signed in"}</div>
                <button type="button" className="button" onClick={handleSignOut}>
                  Sign out
                </button>
              </div>
            </details>
          </div>
        </header>
        {showSupportBanner && (
          <div className="support-ro-banner">
            Support is viewing in Read-only mode
          </div>
        )}
        <div className="admin-shell">
          <aside className="admin-sidebar">
            <div className="admin-sidebar-header">
              <div className="admin-tenant">{tenantDisplayName}</div>
              <div className="muted">Tenant admin</div>
            </div>
            <nav className="admin-nav">
              <div className="admin-nav-group">
                <div className="admin-nav-title">Dashboard</div>
                <Link href={`${adminPath}#overview`}>Overview</Link>
              </div>
              <div className="admin-nav-group">
                <div className="admin-nav-title">CRM</div>
                <Link href={`${adminPath}#leads`}>Leads</Link>
                <Link href={`${adminPath}#contacts`}>Contacts</Link>
                {hasAppointments && (
                  <Link href={`${adminPath}/appointments`}>Appointments</Link>
                )}
              </div>
              <div className="admin-nav-group">
                <div className="admin-nav-title">PG Ops</div>
                {hasPgBeds && <Link href={`${adminPath}/pg/beds`}>Beds</Link>}
                {hasPgBeds && (
                  <Link href={`${adminPath}/pg/occupancy`}>Occupancy</Link>
                )}
                {hasPgPayments && (
                  <Link href={`${adminPath}/pg/payments`}>Payments</Link>
                )}
              </div>
              <div className="admin-nav-group">
                <div className="admin-nav-title">Automation</div>
                {hasAutomationAccess && (
                  <Link href={`${adminPath}/automations`}>Automations</Link>
                )}
                {hasAutomationAccess && (
                  <Link href={`${adminPath}/outbox`}>Outbox</Link>
                )}
              </div>
              <div className="admin-nav-group">
                <div className="admin-nav-title">System</div>
                <Link href={`${adminPath}#features`}>Features</Link>
                {hasAuditAccess && <Link href={`${adminPath}/audit`}>Audit</Link>}
                {showSupportNav && <Link href={`${adminPath}#support`}>Support</Link>}
              </div>
            </nav>
          </aside>
          <section className="admin-main">
            <div className="admin-content">{children}</div>
          </section>
        </div>
      </div>
    </TenantContextProvider>
  );
}
