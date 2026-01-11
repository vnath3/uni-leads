"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { useTenantContext } from "@/components/TenantContextProvider";

type Bed = {
  id: string;
  bed_code: string;
  status?: string | null;
};

type Contact = {
  id: string;
  full_name?: string | null;
  phone?: string | null;
  email?: string | null;
  status?: string | null;
};

type Occupancy = {
  id: string;
  bed_id: string;
  contact_id: string;
  start_date: string;
  end_date?: string | null;
  monthly_rent?: number | null;
  security_deposit?: number | null;
  status: "active" | "ended" | "cancelled";
  notes?: string | null;
  pg_beds?: Bed | Bed[] | null;
  contacts?: Contact | Contact[] | null;
};

type FormState = {
  bedId: string;
  contactId: string;
  startDate: string;
  monthlyRent: string;
  securityDeposit: string;
  notes: string;
};

const normalizeName = (contact?: Contact | Contact[] | null) => {
  const resolved = Array.isArray(contact) ? contact[0] : contact;
  if (!resolved) return "Unknown contact";
  return resolved.full_name || resolved.email || resolved.phone || "Unknown contact";
};

const normalizeBed = (bed?: Bed | Bed[] | null) => {
  const resolved = Array.isArray(bed) ? bed[0] : bed;
  return resolved?.bed_code ?? "Unknown bed";
};

export default function PgOccupancyPage() {
  const { tenant, canWrite } = useTenantContext();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [occupancies, setOccupancies] = useState<Occupancy[]>([]);
  const [availableBeds, setAvailableBeds] = useState<Bed[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [assigning, setAssigning] = useState(false);
  const [endingId, setEndingId] = useState<string | null>(null);
  const [formState, setFormState] = useState<FormState>({
    bedId: "",
    contactId: "",
    startDate: "",
    monthlyRent: "",
    securityDeposit: "",
    notes: ""
  });

  const readOnly = tenant.supportMode === "ro" || !canWrite;
  const hasBeds = tenant.enabledFeatureKeys.includes("pg.beds");

  const contactById = useMemo(() => {
    const map: Record<string, Contact> = {};
    for (const contact of contacts) {
      map[contact.id] = contact;
    }
    return map;
  }, [contacts]);

  const refreshData = async () => {
    const [occupanciesRes, bedsRes, contactsRes] = await Promise.all([
      supabase
        .from("pg_occupancies")
        .select(
          `id,
           bed_id,
           contact_id,
           start_date,
           end_date,
           monthly_rent,
           security_deposit,
           status,
           notes,
           pg_beds:bed_id (id, bed_code, status),
           contacts:contact_id (id, full_name, phone, email, status)`
        )
        .eq("tenant_id", tenant.tenantId)
        .eq("status", "active")
        .is("deleted_at", null)
        .order("start_date", { ascending: false }),
      supabase
        .from("pg_beds")
        .select("id, bed_code, status")
        .eq("tenant_id", tenant.tenantId)
        .eq("status", "available")
        .is("deleted_at", null)
        .order("bed_code"),
      supabase
        .from("contacts")
        .select("id, full_name, phone, email, status")
        .eq("tenant_id", tenant.tenantId)
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .limit(200)
    ]);

    const firstError = occupanciesRes.error || bedsRes.error || contactsRes.error;
    if (firstError) {
      throw new Error(firstError.message);
    }

    setOccupancies((occupanciesRes.data as Occupancy[]) ?? []);
    setAvailableBeds((bedsRes.data as Bed[]) ?? []);
    setContacts((contactsRes.data as Contact[]) ?? []);
  };

  useEffect(() => {
    if (!hasBeds) {
      setLoading(false);
      return;
    }

    let active = true;
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        await refreshData();
        if (!active) return;
        setLoading(false);
      } catch (loadError) {
        if (!active) return;
        setError(loadError instanceof Error ? loadError.message : "Load failed.");
        setLoading(false);
      }
    };

    load();
    return () => {
      active = false;
    };
  }, [tenant.tenantId, hasBeds]);

  const handleAssign = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (readOnly) {
      setError("Read-only support access.");
      return;
    }

    if (!formState.bedId || !formState.contactId || !formState.startDate) {
      setError("Bed, contact, and start date are required.");
      return;
    }

    const monthlyRent =
      formState.monthlyRent.trim() === "" ? null : Number(formState.monthlyRent);
    if (monthlyRent !== null && Number.isNaN(monthlyRent)) {
      setError("Monthly rent must be a number.");
      return;
    }

    const securityDeposit =
      formState.securityDeposit.trim() === ""
        ? null
        : Number(formState.securityDeposit);
    if (securityDeposit !== null && Number.isNaN(securityDeposit)) {
      setError("Security deposit must be a number.");
      return;
    }

    setAssigning(true);
    setError(null);

    const { data: sessionData } = await supabase.auth.getSession();

    const { error: insertError } = await supabase.from("pg_occupancies").insert({
      tenant_id: tenant.tenantId,
      bed_id: formState.bedId,
      contact_id: formState.contactId,
      start_date: formState.startDate,
      monthly_rent: monthlyRent,
      security_deposit: securityDeposit,
      status: "active",
      notes: formState.notes.trim() || null,
      created_by: sessionData?.session?.user.id ?? null
    });

    if (insertError) {
      const message = insertError.message.toLowerCase();
      if (insertError.code === "23505" || message.includes("duplicate")) {
        setError("This bed or resident already has an active occupancy.");
      } else {
        setError(insertError.message);
      }
      setAssigning(false);
      return;
    }

    const { error: bedError } = await supabase
      .from("pg_beds")
      .update({ status: "occupied" })
      .eq("id", formState.bedId)
      .eq("tenant_id", tenant.tenantId);

    if (bedError) {
      setError(`Occupancy created, but bed update failed: ${bedError.message}`);
      setAssigning(false);
      return;
    }

    const contactStatus = contactById[formState.contactId]?.status;
    if (contactStatus !== "resident") {
      await supabase
        .from("contacts")
        .update({ status: "resident" })
        .eq("id", formState.contactId)
        .eq("tenant_id", tenant.tenantId);
    }

    await refreshData();
    setFormState({
      bedId: "",
      contactId: "",
      startDate: "",
      monthlyRent: "",
      securityDeposit: "",
      notes: ""
    });
    setAssigning(false);
  };

  const handleEnd = async (occupancy: Occupancy) => {
    if (readOnly) {
      setError("Read-only support access.");
      return;
    }

    setEndingId(occupancy.id);
    setError(null);

    const { data: sessionData } = await supabase.auth.getSession();
    const today = new Date().toISOString().slice(0, 10);

    const { error: updateError } = await supabase
      .from("pg_occupancies")
      .update({
        status: "ended",
        end_date: today,
        updated_by: sessionData?.session?.user.id ?? null
      })
      .eq("id", occupancy.id)
      .eq("tenant_id", tenant.tenantId);

    if (updateError) {
      setError(updateError.message);
      setEndingId(null);
      return;
    }

    const { data: activeRows, error: activeError } = await supabase
      .from("pg_occupancies")
      .select("id")
      .eq("tenant_id", tenant.tenantId)
      .eq("bed_id", occupancy.bed_id)
      .eq("status", "active")
      .is("deleted_at", null)
      .limit(1);

    if (!activeError && (!activeRows || activeRows.length === 0)) {
      await supabase
        .from("pg_beds")
        .update({ status: "available" })
        .eq("id", occupancy.bed_id)
        .eq("tenant_id", tenant.tenantId);
    }

    await refreshData();
    setEndingId(null);
  };

  if (!hasBeds) {
    return (
      <div className="card">
        <h1>Occupancy</h1>
        <p className="muted">Module disabled for this tenant.</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="card">
        <h1>Loading occupancy...</h1>
        <p className="muted">Fetching resident assignments.</p>
      </div>
    );
  }

  return (
    <>
      <div className="card">
        <h1>Occupancy</h1>
        <p className="muted">Assign residents to beds and track active stays.</p>
        {readOnly && (
          <div className="notice">Read-only support access is enabled.</div>
        )}
        {error && <div className="error">{error}</div>}
      </div>

      <div className="card">
        <div className="section-title">Assign bed</div>
        <form onSubmit={handleAssign}>
          <label className="field">
            <span>Bed</span>
            <select
              required
              value={formState.bedId}
              onChange={(event) =>
                setFormState((prev) => ({ ...prev, bedId: event.target.value }))
              }
              disabled={readOnly}
            >
              <option value="">Select available bed</option>
              {availableBeds.map((bed) => (
                <option key={bed.id} value={bed.id}>
                  {bed.bed_code}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Resident (contact)</span>
            <select
              required
              value={formState.contactId}
              onChange={(event) =>
                setFormState((prev) => ({
                  ...prev,
                  contactId: event.target.value
                }))
              }
              disabled={readOnly}
            >
              <option value="">Select contact</option>
              {contacts.map((contact) => (
                <option key={contact.id} value={contact.id}>
                  {contact.full_name || contact.email || contact.phone || contact.id}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Start date</span>
            <input
              type="date"
              required
              value={formState.startDate}
              onChange={(event) =>
                setFormState((prev) => ({
                  ...prev,
                  startDate: event.target.value
                }))
              }
              disabled={readOnly}
            />
          </label>
          <label className="field">
            <span>Monthly rent</span>
            <input
              type="number"
              min={0}
              step="0.01"
              value={formState.monthlyRent}
              onChange={(event) =>
                setFormState((prev) => ({
                  ...prev,
                  monthlyRent: event.target.value
                }))
              }
              disabled={readOnly}
            />
          </label>
          <label className="field">
            <span>Security deposit</span>
            <input
              type="number"
              min={0}
              step="0.01"
              value={formState.securityDeposit}
              onChange={(event) =>
                setFormState((prev) => ({
                  ...prev,
                  securityDeposit: event.target.value
                }))
              }
              disabled={readOnly}
            />
          </label>
          <label className="field">
            <span>Notes</span>
            <textarea
              rows={3}
              value={formState.notes}
              onChange={(event) =>
                setFormState((prev) => ({ ...prev, notes: event.target.value }))
              }
              disabled={readOnly}
            />
          </label>
          <button
            className={`button ${readOnly ? "disabled" : ""}`}
            disabled={readOnly || assigning}
          >
            {assigning ? "Assigning..." : "Assign bed"}
          </button>
        </form>
      </div>

      <div className="card">
        <div className="section-title">Active occupancies</div>
        {occupancies.length === 0 ? (
          <p className="muted">No active occupancies.</p>
        ) : (
          occupancies.map((occupancy) => (
            <div className="card" key={occupancy.id}>
              <h3>{normalizeName(occupancy.contacts)}</h3>
              <p className="muted">
                Bed: {normalizeBed(occupancy.pg_beds)} | Start:{" "}
                {occupancy.start_date}
              </p>
              <p className="muted">
                Rent: {occupancy.monthly_rent ?? "n/a"} | Deposit:{" "}
                {occupancy.security_deposit ?? "n/a"}
              </p>
              {occupancy.notes && <p className="muted">{occupancy.notes}</p>}
              <button
                type="button"
                className={`button secondary ${readOnly ? "disabled" : ""}`}
                disabled={readOnly || endingId === occupancy.id}
                onClick={() => handleEnd(occupancy)}
              >
                {endingId === occupancy.id ? "Ending..." : "End occupancy"}
              </button>
            </div>
          ))
        )}
      </div>
    </>
  );
}
