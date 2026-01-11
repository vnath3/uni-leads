"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { useTenantContext } from "@/components/TenantContextProvider";

type Feature = {
  key: string;
  name: string;
  category?: string | null;
};

type SupportGrant = {
  id: string;
  tenant_id: string;
  platform_user_id: string;
  access_mode: string | null;
  status: string;
  expires_at: string | null;
};

type Contact = Record<string, unknown> & {
  id?: string;
  full_name?: string | null;
  name?: string | null;
  phone?: string | null;
  email?: string | null;
  status?: string | null;
  source?: string | null;
  created_at?: string | null;
};

type Lead = Record<string, unknown> & {
  id?: string;
  contact_id?: string | null;
  submitted_at?: string | null;
  created_at?: string | null;
  source?: string | null;
  campaign?: string | null;
};

const formatDateTime = (value?: string | null) => {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
};

const missingColumn = (message: string, column: string) =>
  message.includes(`column ${column}`) && message.includes("does not exist");

const fetchContacts = async (tenantId: string) => {
  const ordered = await supabase
    .from("contacts")
    .select("*")
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false });

  if (!ordered.error) return ordered;

  if (missingColumn(ordered.error.message, "contacts.created_at")) {
    return supabase.from("contacts").select("*").eq("tenant_id", tenantId);
  }

  return ordered;
};

const fetchLeads = async (tenantId: string) => {
  const ordered = await supabase
    .from("leads")
    .select("*")
    .eq("tenant_id", tenantId)
    .order("submitted_at", { ascending: false });

  if (!ordered.error) return ordered;

  if (missingColumn(ordered.error.message, "leads.submitted_at")) {
    return supabase.from("leads").select("*").eq("tenant_id", tenantId);
  }

  return ordered;
};

const normalizeAccess = (value: string | null | undefined): "RO" | "RW" => {
  const normalized = (value ?? "").toLowerCase();
  if (normalized.includes("rw") || normalized.includes("write")) {
    return "RW";
  }
  return "RO";
};

export default function TenantAdminPage() {
  const { tenant, canWrite, isOwnerAdmin } = useTenantContext();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [features, setFeatures] = useState<Feature[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [grants, setGrants] = useState<SupportGrant[]>([]);
  const [grantUserId, setGrantUserId] = useState("");
  const [grantMode, setGrantMode] = useState<"RO" | "RW">("RO");
  const [grantHours, setGrantHours] = useState(24);
  const [savingGrant, setSavingGrant] = useState(false);

  const featureMetaByKey = useMemo(() => {
    const map: Record<string, Feature> = {};
    for (const feature of features) {
      map[feature.key] = feature;
    }
    return map;
  }, [features]);

  const enabledFeatures = useMemo(() => {
    return tenant.enabledFeatureKeys.map((key) => {
      const meta = featureMetaByKey[key];
      const baseName = meta?.name ?? key;
      const label = meta?.category ? `${baseName} (${meta.category})` : baseName;
      return { key, label };
    });
  }, [tenant.enabledFeatureKeys, featureMetaByKey]);

  const hasPgBeds = tenant.enabledFeatureKeys.includes("pg.beds");
  const hasPgPayments = tenant.enabledFeatureKeys.includes("pg.payments");
  const hasClinicAppointments = tenant.enabledFeatureKeys.includes(
    "clinic.appointments"
  );
  const hasPgModules = hasPgBeds || hasPgPayments;
  const showSupportSection =
    isOwnerAdmin || (tenant.isPlatformUser && tenant.supportMode !== "none");

  const contactById = useMemo(() => {
    const map: Record<string, Contact> = {};
    for (const contact of contacts) {
      if (contact.id) map[contact.id] = contact;
    }
    return map;
  }, [contacts]);

  useEffect(() => {
    let active = true;

    const loadData = async () => {
      setLoading(true);
      setError(null);

      const nowIso = new Date().toISOString();

      const [featuresRes, contactsRes, leadsRes, grantsRes] = await Promise.all([
        supabase.from("features").select("key, name, category").order("name"),
        fetchContacts(tenant.tenantId),
        fetchLeads(tenant.tenantId),
        isOwnerAdmin
          ? supabase
              .from("support_access_grants")
              .select(
                "id, tenant_id, platform_user_id, access_mode, status, expires_at"
              )
              .eq("tenant_id", tenant.tenantId)
              .eq("status", "active")
              .gt("expires_at", nowIso)
              .order("expires_at", { ascending: false })
          : Promise.resolve({ data: [], error: null })
      ]);

      if (!active) return;

      const firstError =
        featuresRes.error ||
        contactsRes.error ||
        leadsRes.error ||
        (isOwnerAdmin ? grantsRes.error : null);

      if (firstError) {
        setError(firstError.message);
        setLoading(false);
        return;
      }

      setFeatures((featuresRes.data as Feature[]) ?? []);
      setContacts((contactsRes.data as Contact[]) ?? []);
      setLeads((leadsRes.data as Lead[]) ?? []);
      setGrants((grantsRes.data as SupportGrant[]) ?? []);
      setLoading(false);
    };

    loadData();

    return () => {
      active = false;
    };
  }, [tenant.tenantId, isOwnerAdmin]);

  const handleStatusUpdate = async (
    contactId: string | undefined,
    nextStatus: string
  ) => {
    if (!contactId) return;
    if (!canWrite) {
      setError("Write access required to update contacts.");
      return;
    }
    setError(null);

    const { error: updateError } = await supabase
      .from("contacts")
      .update({ status: nextStatus })
      .eq("id", contactId)
      .eq("tenant_id", tenant.tenantId);

    if (updateError) {
      setError(updateError.message);
      return;
    }

    setContacts((prev) =>
      prev.map((contact) =>
        contact.id === contactId ? { ...contact, status: nextStatus } : contact
      )
    );
  };

  const handleCreateGrant = async () => {
    if (!tenant.tenantId || !grantUserId) return;

    setSavingGrant(true);
    setError(null);

    const expiresAt = new Date(
      Date.now() + Math.max(1, grantHours) * 60 * 60 * 1000
    ).toISOString();

    const { data: sessionData } = await supabase.auth.getSession();

    const { error: grantError } = await supabase
      .from("support_access_grants")
      .insert({
        tenant_id: tenant.tenantId,
        platform_user_id: grantUserId,
        access_mode: grantMode.toLowerCase(),
        status: "active",
        created_by: sessionData?.session?.user.id,
        expires_at: expiresAt
      })
      .select("id, tenant_id, platform_user_id, access_mode, status, expires_at")
      .single();

    if (grantError) {
      setError(grantError.message);
      setSavingGrant(false);
      return;
    }

    setGrantUserId("");
    setSavingGrant(false);
    await refreshGrants();
  };

  const refreshGrants = async () => {
    if (!tenant.tenantId) return;
    const { data, error: grantError } = await supabase
      .from("support_access_grants")
      .select("id, tenant_id, platform_user_id, access_mode, status, expires_at")
      .eq("tenant_id", tenant.tenantId)
      .eq("status", "active")
      .gt("expires_at", new Date().toISOString())
      .order("expires_at", { ascending: false });

    if (grantError) {
      setError(grantError.message);
      return;
    }

    setGrants((data as SupportGrant[]) ?? []);
  };

  const handleRevokeGrant = async (grantId: string) => {
    if (!tenant.tenantId) return;
    const { data: sessionData } = await supabase.auth.getSession();

    const { error: revokeError } = await supabase
      .from("support_access_grants")
      .update({
        status: "revoked",
        revoked_at: new Date().toISOString(),
        revoked_by: sessionData?.session?.user.id
      })
      .eq("id", grantId)
      .eq("tenant_id", tenant.tenantId);

    if (revokeError) {
      setError(revokeError.message);
      return;
    }

    await refreshGrants();
  };

  if (loading) {
    return (
      <div className="card">
        <h1>Loading admin...</h1>
        <p className="muted">Loading tenant data.</p>
      </div>
    );
  }

  return (
    <>
      <div className="card" id="overview">
        <h1>Tenant Admin</h1>
        <p className="muted">Tenant slug: {tenant.slug}</p>
        {error && <div className="error">{error}</div>}
      </div>

      <div className="card" id="features">
        <div className="section-title">Enabled features</div>
        {enabledFeatures.length ? (
          <div className="tag-list">
            {enabledFeatures.map((feature) => (
              <span className="tag" key={feature.key}>
                {feature.label}
              </span>
            ))}
          </div>
        ) : (
          <p className="muted">No enabled features.</p>
        )}
      </div>

      <div className="card">
        <div className="section-title">Module status</div>
        {hasPgBeds && (
          <div className="notice">
            Beds module enabled.{" "}
            <Link className="button secondary" href={`/t/${tenant.slug}/admin/pg/beds`}>
              Open Beds
            </Link>
            <Link
              className="button secondary"
              href={`/t/${tenant.slug}/admin/pg/occupancy`}
            >
              Manage Occupancy
            </Link>
          </div>
        )}
        {hasPgPayments && (
          <div className="notice">
            Payments module enabled.{" "}
            <Link
              className="button secondary"
              href={`/t/${tenant.slug}/admin/pg/payments`}
            >
              Open Payments
            </Link>
          </div>
        )}
        {hasClinicAppointments && (
          <div className="notice">
            Appointments enabled.{" "}
            <Link className="button secondary" href={`/t/${tenant.slug}/admin/appointments`}>
              Open Appointments
            </Link>
          </div>
        )}
        {!hasPgBeds && !hasPgPayments && !hasClinicAppointments && (
          <p className="muted">No modules enabled.</p>
        )}
      </div>

      <div className="card" id="contacts">
        <div className="section-title">Contacts</div>
        {contacts.length === 0 ? (
          <p className="muted">No contacts yet.</p>
        ) : (
          contacts.map((contact) => {
            const displayName =
              contact.full_name || contact.name || "Unnamed contact";
            const status = contact.status ?? "unknown";
            return (
              <div className="card" key={contact.id ?? displayName}>
                <h3>{displayName}</h3>
                <p className="muted">
                  {contact.phone ? `Phone: ${contact.phone} ` : ""}
                  {contact.email ? `Email: ${contact.email}` : ""}
                </p>
                <p className="muted">
                  Status: {status}{" "}
                  {contact.source ? `| Source: ${contact.source}` : ""}
                </p>
                {hasPgModules && (
                  <button
                    className={`button ${canWrite ? "" : "disabled"}`}
                    disabled={!canWrite || status === "resident"}
                    onClick={() => handleStatusUpdate(contact.id, "resident")}
                  >
                    Mark as Resident
                  </button>
                )}
                {hasClinicAppointments && (
                  <>
                    <button
                      className={`button ${canWrite ? "" : "disabled"}`}
                      disabled={!canWrite || status === "patient"}
                      onClick={() => handleStatusUpdate(contact.id, "patient")}
                    >
                      Mark as Patient
                    </button>
                    <button
                      className={`button secondary ${canWrite ? "" : "disabled"}`}
                      disabled={!canWrite || status === "active_customer"}
                      onClick={() =>
                        handleStatusUpdate(contact.id, "active_customer")
                      }
                    >
                      Mark as Active Customer
                    </button>
                  </>
                )}
              </div>
            );
          })
        )}
      </div>

      <div className="card" id="leads">
        <div className="section-title">Leads</div>
        {leads.length === 0 ? (
          <p className="muted">No leads submitted.</p>
        ) : (
          leads.map((lead) => {
            const contact = lead.contact_id ? contactById[lead.contact_id] : null;
            const name =
              contact?.full_name || contact?.name || lead.contact_id || "Lead";
            const phone = contact?.phone || contact?.email || "";
            return (
              <div className="card" key={lead.id ?? String(name)}>
                <h3>{name}</h3>
                {phone && <p className="muted">{phone}</p>}
                <p className="muted">
                  Submitted: {formatDateTime(lead.submitted_at ?? lead.created_at)}
                </p>
                <p className="muted">
                  {lead.source ? `Source: ${lead.source}` : ""}
                  {lead.campaign ? ` | Campaign: ${lead.campaign}` : ""}
                </p>
              </div>
            );
          })
        )}
      </div>

      {showSupportSection && (
        <div className="card" id="support">
          <div className="section-title">Support grants</div>
          {isOwnerAdmin ? (
            <div className="card">
              <label className="field">
                <span>Super admin user_id (UUID)</span>
                <input
                  type="text"
                  value={grantUserId}
                  onChange={(event) => setGrantUserId(event.target.value)}
                  placeholder="UUID"
                />
              </label>
              <label className="field">
                <span>Access mode</span>
                <select
                  value={grantMode}
                  onChange={(event) =>
                    setGrantMode(event.target.value === "RW" ? "RW" : "RO")
                  }
                >
                  <option value="RO">RO</option>
                  <option value="RW">RW</option>
                </select>
              </label>
              <label className="field">
                <span>Duration (hours)</span>
                <input
                  type="number"
                  min={1}
                  value={grantHours}
                  onChange={(event) =>
                    setGrantHours(Number(event.target.value || 1))
                  }
                />
              </label>
              <button
                className={`button ${savingGrant ? "disabled" : ""}`}
                disabled={savingGrant || !grantUserId}
                onClick={handleCreateGrant}
              >
                {savingGrant ? "Saving..." : "Create grant"}
              </button>
            </div>
          ) : (
            <div className="notice">
              Support grants are managed by tenant owners and admins.
            </div>
          )}

          {isOwnerAdmin &&
            (grants.length === 0 ? (
              <p className="muted">No grants yet.</p>
            ) : (
              grants.map((grant) => {
                const status = grant.status ?? "unknown";
                return (
                  <div className="card" key={grant.id}>
                    <h3>{grant.platform_user_id}</h3>
                    <p className="muted">
                      Mode: {normalizeAccess(grant.access_mode)} | Status: {status}
                    </p>
                    <p className="muted">
                      Expires: {formatDateTime(grant.expires_at)}
                    </p>
                    {status === "active" && (
                      <button
                        className="button secondary"
                        onClick={() => handleRevokeGrant(grant.id)}
                      >
                        Revoke
                      </button>
                    )}
                  </div>
                );
              })
            ))}
        </div>
      )}
    </>
  );
}
