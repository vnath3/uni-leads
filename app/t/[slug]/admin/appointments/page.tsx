"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { useTenantContext } from "@/components/TenantContextProvider";

type AppointmentStatus =
  | "scheduled"
  | "confirmed"
  | "completed"
  | "cancelled"
  | "no_show";

type Contact = {
  id: string;
  full_name?: string | null;
  phone?: string | null;
  email?: string | null;
  status?: string | null;
};

type Appointment = {
  id: string;
  scheduled_at: string;
  duration_minutes: number;
  status: AppointmentStatus;
  reason?: string | null;
  notes?: string | null;
  location?: string | null;
  contact_id?: string | null;
  created_at?: string | null;
  metadata?: Record<string, unknown> | null;
  contacts?: Contact | Contact[] | null;
};

type FormState = {
  contactId: string;
  scheduledAt: string;
  durationMinutes: number;
  status: AppointmentStatus;
  reason: string;
  notes: string;
  location: string;
};

type EditState = {
  status: AppointmentStatus;
  reason: string;
  notes: string;
  location: string;
};

const statusOptions: AppointmentStatus[] = [
  "scheduled",
  "confirmed",
  "completed",
  "cancelled",
  "no_show"
];

const formatDateTime = (value?: string | null) => {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
};

const getContactDisplay = (contact?: Contact | Contact[] | null) => {
  const resolved = Array.isArray(contact) ? contact[0] : contact;
  if (!resolved) return "Unknown contact";
  return (
    resolved.full_name ||
    resolved.email ||
    resolved.phone ||
    "Unknown contact"
  );
};

const getContactDetail = (contact?: Contact | Contact[] | null) => {
  const resolved = Array.isArray(contact) ? contact[0] : contact;
  if (!resolved) return "";
  return resolved.phone || resolved.email || "";
};

const startOfToday = () => {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return now;
};

const endOfToday = () => {
  const now = new Date();
  now.setHours(23, 59, 59, 999);
  return now;
};

export default function AppointmentsPage() {
  const { tenant, canWrite } = useTenantContext();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [filterWindow, setFilterWindow] = useState<
    "recent" | "today" | "upcoming"
  >("recent");
  const [statusFilter, setStatusFilter] = useState<AppointmentStatus | "all">(
    "all"
  );
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValues, setEditValues] = useState<EditState | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);

  const [formState, setFormState] = useState<FormState>({
    contactId: "",
    scheduledAt: "",
    durationMinutes: 30,
    status: "scheduled",
    reason: "",
    notes: "",
    location: ""
  });

  const readOnly = tenant.supportMode === "ro" || !canWrite;
  const roTooltip = tenant.supportMode === "ro" ? "Disabled in RO" : undefined;
  const hasAppointments = tenant.enabledFeatureKeys.includes(
    "clinic.appointments"
  );

  useEffect(() => {
    if (!hasAppointments) {
      setLoading(false);
      return;
    }

    let active = true;

    const loadData = async () => {
      setLoading(true);
      setError(null);

      const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

      const [appointmentsRes, contactsRes] = await Promise.all([
        supabase
          .from("clinic_appointments")
          .select(
            `id,
             scheduled_at,
             duration_minutes,
             status,
             reason,
             notes,
             location,
             contact_id,
             created_at,
             metadata,
             contacts:contact_id (id, full_name, phone, email)`
          )
          .eq("tenant_id", tenant.tenantId)
          .is("deleted_at", null)
          .gte("scheduled_at", since)
          .order("scheduled_at", { ascending: true }),
        supabase
          .from("contacts")
          .select("id, full_name, phone, email, status")
          .eq("tenant_id", tenant.tenantId)
          .is("deleted_at", null)
          .order("created_at", { ascending: false })
          .limit(200)
      ]);

      if (!active) return;

      const firstError = appointmentsRes.error || contactsRes.error;
      if (firstError) {
        setError(firstError.message);
        setLoading(false);
        return;
      }

      setAppointments((appointmentsRes.data as Appointment[]) ?? []);
      setContacts((contactsRes.data as Contact[]) ?? []);
      setLoading(false);
    };

    loadData();

    return () => {
      active = false;
    };
  }, [tenant.tenantId, hasAppointments]);

  const filteredAppointments = useMemo(() => {
    const now = new Date();
    const startToday = startOfToday();
    const endToday = endOfToday();

    return appointments.filter((appointment) => {
      const scheduled = new Date(appointment.scheduled_at);
      if (Number.isNaN(scheduled.getTime())) return false;

      if (filterWindow === "today") {
        if (scheduled < startToday || scheduled > endToday) return false;
      }

      if (filterWindow === "upcoming") {
        if (scheduled < now) return false;
      }

      if (statusFilter !== "all" && appointment.status !== statusFilter) {
        return false;
      }

      return true;
    });
  }, [appointments, filterWindow, statusFilter]);

  const handleCreate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (readOnly) {
      setError("Read-only support access.");
      return;
    }

    if (!formState.contactId || !formState.scheduledAt) {
      setError("Contact and scheduled time are required.");
      return;
    }

    const scheduledAt = new Date(formState.scheduledAt);
    if (Number.isNaN(scheduledAt.getTime())) {
      setError("Scheduled time is invalid.");
      return;
    }

    setCreating(true);
    setError(null);

    const { data: sessionData } = await supabase.auth.getSession();
    const scheduledIso = scheduledAt.toISOString();

    const { data, error: insertError } = await supabase
      .from("clinic_appointments")
      .insert({
        tenant_id: tenant.tenantId,
        contact_id: formState.contactId,
        scheduled_at: scheduledIso,
        duration_minutes: formState.durationMinutes,
        status: formState.status,
        reason: formState.reason || null,
        notes: formState.notes || null,
        location: formState.location || null,
        created_by: sessionData?.session?.user.id ?? null
      })
      .select(
        `id,
         scheduled_at,
         duration_minutes,
         status,
         reason,
         notes,
         location,
         contact_id,
         created_at,
         metadata,
         contacts:contact_id (id, full_name, phone, email)`
      )
      .single();

    if (insertError) {
      setError(insertError.message);
      setCreating(false);
      return;
    }

    setAppointments((prev) => {
      const next = [...prev, data as Appointment];
      next.sort(
        (a, b) =>
          new Date(a.scheduled_at).getTime() -
          new Date(b.scheduled_at).getTime()
      );
      return next;
    });

    setFormState((prev) => ({
      ...prev,
      scheduledAt: "",
      durationMinutes: 30,
      status: "scheduled",
      reason: "",
      notes: "",
      location: ""
    }));
    setCreating(false);
  };

  const startEdit = (appointment: Appointment) => {
    setEditingId(appointment.id);
    setEditValues({
      status: appointment.status,
      reason: appointment.reason ?? "",
      notes: appointment.notes ?? "",
      location: appointment.location ?? ""
    });
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditValues(null);
  };

  const handleUpdate = async (appointmentId: string) => {
    if (!editValues) return;
    if (readOnly) {
      setError("Read-only support access.");
      return;
    }

    setError(null);
    const { data: sessionData } = await supabase.auth.getSession();

    const { error: updateError } = await supabase
      .from("clinic_appointments")
      .update({
        status: editValues.status,
        reason: editValues.reason || null,
        notes: editValues.notes || null,
        location: editValues.location || null,
        updated_by: sessionData?.session?.user.id ?? null
      })
      .eq("id", appointmentId)
      .eq("tenant_id", tenant.tenantId);

    if (updateError) {
      setError(updateError.message);
      return;
    }

    setAppointments((prev) =>
      prev.map((appointment) =>
        appointment.id === appointmentId
          ? { ...appointment, ...editValues }
          : appointment
      )
    );
    cancelEdit();
  };

  const handleStatusUpdate = async (
    appointmentId: string,
    nextStatus: AppointmentStatus
  ) => {
    if (readOnly) {
      setError("Read-only support access.");
      return;
    }
    setError(null);

    const { data: sessionData } = await supabase.auth.getSession();
    const { error: updateError } = await supabase
      .from("clinic_appointments")
      .update({
        status: nextStatus,
        updated_by: sessionData?.session?.user.id ?? null
      })
      .eq("id", appointmentId)
      .eq("tenant_id", tenant.tenantId);

    if (updateError) {
      setError(updateError.message);
      return;
    }

    setAppointments((prev) =>
      prev.map((appointment) =>
        appointment.id === appointmentId
          ? { ...appointment, status: nextStatus }
          : appointment
      )
    );
  };

  const handleRemove = async (appointmentId: string) => {
    if (readOnly) {
      setError("Read-only support access.");
      return;
    }

    setRemovingId(appointmentId);
    setError(null);

    const { data: sessionData } = await supabase.auth.getSession();
    const { error: removeError } = await supabase
      .from("clinic_appointments")
      .update({
        deleted_at: new Date().toISOString(),
        updated_by: sessionData?.session?.user.id ?? null
      })
      .eq("id", appointmentId)
      .eq("tenant_id", tenant.tenantId);

    if (removeError) {
      setError(removeError.message);
      setRemovingId(null);
      return;
    }

    setAppointments((prev) =>
      prev.filter((appointment) => appointment.id !== appointmentId)
    );
    setRemovingId(null);
  };

  if (!hasAppointments) {
    return (
      <div className="card">
        <h1>Appointments</h1>
        <p className="muted">Module disabled for this tenant.</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="card">
        <h1>Loading appointments...</h1>
        <p className="muted">Fetching scheduled visits.</p>
      </div>
    );
  }

  return (
    <>
      <div className="card">
        <h1>Appointments</h1>
        <p className="muted">
          Showing appointments from the last 7 days and upcoming visits.
        </p>
        {readOnly && (
          <div className="notice">Read-only support access is enabled.</div>
        )}
        {error && <div className="error">{error}</div>}

        <div className="section">
          <div className="section-title">Filters</div>
          <div className="tag-list">
            <button
              className={`button ${filterWindow === "recent" ? "" : "secondary"}`}
              type="button"
              onClick={() => setFilterWindow("recent")}
            >
              Last 7 days
            </button>
            <button
              className={`button ${filterWindow === "today" ? "" : "secondary"}`}
              type="button"
              onClick={() => setFilterWindow("today")}
            >
              Today
            </button>
            <button
              className={`button ${filterWindow === "upcoming" ? "" : "secondary"}`}
              type="button"
              onClick={() => setFilterWindow("upcoming")}
            >
              Upcoming
            </button>
          </div>
          <label className="field">
            <span>Status</span>
            <select
              value={statusFilter}
              onChange={(event) =>
                setStatusFilter(event.target.value as AppointmentStatus | "all")
              }
            >
              <option value="all">All</option>
              {statusOptions.map((status) => (
                <option key={status} value={status}>
                  {status}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      <div className="card">
        <div className="section-title">Create appointment</div>
        <form onSubmit={handleCreate}>
          <label className="field">
            <span>Contact</span>
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
              <option value="">Select a contact</option>
              {contacts.map((contact) => (
                <option key={contact.id} value={contact.id}>
                  {getContactDisplay(contact)}{" "}
                  {contact.phone ? `(${contact.phone})` : ""}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Scheduled at</span>
            <input
              type="datetime-local"
              required
              value={formState.scheduledAt}
              onChange={(event) =>
                setFormState((prev) => ({
                  ...prev,
                  scheduledAt: event.target.value
                }))
              }
              disabled={readOnly}
            />
          </label>
          <label className="field">
            <span>Duration (minutes)</span>
            <input
              type="number"
              min={1}
              value={formState.durationMinutes}
              onChange={(event) =>
                setFormState((prev) => ({
                  ...prev,
                  durationMinutes: Number(event.target.value || 30)
                }))
              }
              disabled={readOnly}
            />
          </label>
          <label className="field">
            <span>Status</span>
            <select
              value={formState.status}
              onChange={(event) =>
                setFormState((prev) => ({
                  ...prev,
                  status: event.target.value as AppointmentStatus
                }))
              }
              disabled={readOnly}
            >
              {statusOptions.map((status) => (
                <option key={status} value={status}>
                  {status}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Reason</span>
            <input
              type="text"
              value={formState.reason}
              onChange={(event) =>
                setFormState((prev) => ({
                  ...prev,
                  reason: event.target.value
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
                setFormState((prev) => ({
                  ...prev,
                  notes: event.target.value
                }))
              }
              disabled={readOnly}
            />
          </label>
          <label className="field">
            <span>Location</span>
            <input
              type="text"
              value={formState.location}
              onChange={(event) =>
                setFormState((prev) => ({
                  ...prev,
                  location: event.target.value
                }))
              }
              disabled={readOnly}
            />
          </label>
          <button
            className={`button ${readOnly ? "disabled" : ""}`}
            disabled={readOnly || creating}
            title={readOnly ? roTooltip : undefined}
          >
            {creating ? "Saving..." : "Create appointment"}
          </button>
        </form>
      </div>

      <div className="card">
        <div className="section-title">Appointments</div>
        {filteredAppointments.length === 0 ? (
          <p className="muted">No appointments match this filter.</p>
        ) : (
          filteredAppointments.map((appointment) => {
            const contactLabel = getContactDisplay(appointment.contacts);
            const contactDetail = getContactDetail(appointment.contacts);
            const isEditing = editingId === appointment.id;
            const edit = isEditing ? editValues : null;

            return (
              <div className="card" key={appointment.id}>
                <h3>{contactLabel}</h3>
                {contactDetail && <p className="muted">{contactDetail}</p>}
                <p className="muted">
                  Scheduled: {formatDateTime(appointment.scheduled_at)} |{" "}
                  {appointment.duration_minutes} min
                </p>
                <p className="muted">Status: {appointment.status}</p>

                {isEditing && edit ? (
                  <>
                    <label className="field">
                      <span>Status</span>
                      <select
                        value={edit.status}
                        onChange={(event) =>
                          setEditValues((prev) =>
                            prev
                              ? {
                                  ...prev,
                                  status: event.target.value as AppointmentStatus
                                }
                              : prev
                          )
                        }
                        disabled={readOnly}
                      >
                        {statusOptions.map((status) => (
                          <option key={status} value={status}>
                            {status}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="field">
                      <span>Reason</span>
                      <input
                        type="text"
                        value={edit.reason}
                        onChange={(event) =>
                          setEditValues((prev) =>
                            prev ? { ...prev, reason: event.target.value } : prev
                          )
                        }
                        disabled={readOnly}
                      />
                    </label>
                    <label className="field">
                      <span>Notes</span>
                      <textarea
                        rows={3}
                        value={edit.notes}
                        onChange={(event) =>
                          setEditValues((prev) =>
                            prev ? { ...prev, notes: event.target.value } : prev
                          )
                        }
                        disabled={readOnly}
                      />
                    </label>
                    <label className="field">
                      <span>Location</span>
                      <input
                        type="text"
                        value={edit.location}
                        onChange={(event) =>
                          setEditValues((prev) =>
                            prev ? { ...prev, location: event.target.value } : prev
                          )
                        }
                        disabled={readOnly}
                      />
                    </label>
                    <button
                      className={`button ${readOnly ? "disabled" : ""}`}
                      disabled={readOnly}
                      title={readOnly ? roTooltip : undefined}
                      onClick={() => handleUpdate(appointment.id)}
                      type="button"
                    >
                      Save changes
                    </button>
                    <button
                      className="button secondary"
                      type="button"
                      onClick={cancelEdit}
                    >
                      Cancel
                    </button>
                  </>
                ) : (
                  <>
                    <div className="tag-list">
                      <button
                        className={`button ${readOnly ? "disabled" : ""}`}
                        type="button"
                        disabled={readOnly}
                        title={readOnly ? roTooltip : undefined}
                        onClick={() => startEdit(appointment)}
                      >
                        Edit
                      </button>
                      <button
                        className={`button secondary ${readOnly ? "disabled" : ""}`}
                        type="button"
                        disabled={readOnly || appointment.status === "cancelled"}
                        title={readOnly ? roTooltip : undefined}
                        onClick={() =>
                          handleStatusUpdate(appointment.id, "cancelled")
                        }
                      >
                        Cancel appointment
                      </button>
                      <button
                        className={`button secondary ${readOnly ? "disabled" : ""}`}
                        type="button"
                        disabled={readOnly || removingId === appointment.id}
                        title={readOnly ? roTooltip : undefined}
                        onClick={() => handleRemove(appointment.id)}
                      >
                        {removingId === appointment.id ? "Removing..." : "Remove"}
                      </button>
                    </div>
                  </>
                )}
              </div>
            );
          })
        )}
      </div>
    </>
  );
}
