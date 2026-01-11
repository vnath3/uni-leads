"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { useTenantContext } from "@/components/TenantContextProvider";

type PaymentStatus = "due" | "partial" | "paid" | "waived" | "refunded";

type Contact = {
  id: string;
  full_name?: string | null;
  phone?: string | null;
  email?: string | null;
};

type Payment = {
  id: string;
  contact_id: string;
  occupancy_id?: string | null;
  period_start?: string | null;
  period_end?: string | null;
  due_date?: string | null;
  amount_due: number | string;
  amount_paid: number | string;
  status: PaymentStatus;
  paid_at?: string | null;
  method?: string | null;
  reference?: string | null;
  notes?: string | null;
  contacts?: Contact | Contact[] | null;
};

type OccupancyOption = {
  id: string;
  contact_id: string;
  pg_beds?: { id?: string; bed_code?: string } | { id?: string; bed_code?: string }[] | null;
  contacts?: Contact | Contact[] | null;
};

type FormState = {
  occupancyId: string;
  amountDue: string;
  dueDate: string;
  periodStart: string;
  periodEnd: string;
  notes: string;
};

type PaymentInputState = {
  amountPaid: string;
  method: string;
  reference: string;
};

const statusOptions: PaymentStatus[] = [
  "due",
  "partial",
  "paid",
  "waived",
  "refunded"
];

const resolveContact = (contact?: Contact | Contact[] | null) => {
  const resolved = Array.isArray(contact) ? contact[0] : contact;
  if (!resolved) return "Unknown contact";
  return resolved.full_name || resolved.email || resolved.phone || "Unknown contact";
};

const resolveBed = (occupancy: OccupancyOption) => {
  const bed = Array.isArray(occupancy.pg_beds)
    ? occupancy.pg_beds[0]
    : occupancy.pg_beds;
  return bed?.bed_code ?? "Bed";
};

const toNumber = (value: number | string) => {
  if (typeof value === "number") return value;
  const parsed = Number(value);
  return Number.isNaN(parsed) ? 0 : parsed;
};

export default function PgPaymentsPage() {
  const { tenant, canWrite } = useTenantContext();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [occupancies, setOccupancies] = useState<OccupancyOption[]>([]);
  const [statusFilter, setStatusFilter] = useState<PaymentStatus | "open" | "all">(
    "open"
  );
  const [contactFilter, setContactFilter] = useState<string>("all");
  const [creating, setCreating] = useState(false);
  const [paymentInputs, setPaymentInputs] = useState<
    Record<string, PaymentInputState>
  >({});
  const [formState, setFormState] = useState<FormState>({
    occupancyId: "",
    amountDue: "",
    dueDate: "",
    periodStart: "",
    periodEnd: "",
    notes: ""
  });

  const readOnly = tenant.supportMode === "ro" || !canWrite;
  const roTooltip = tenant.supportMode === "ro" ? "Disabled in RO" : undefined;
  const hasPayments = tenant.enabledFeatureKeys.includes("pg.payments");

  const occupancyById = useMemo(() => {
    const map: Record<string, OccupancyOption> = {};
    for (const occupancy of occupancies) {
      map[occupancy.id] = occupancy;
    }
    return map;
  }, [occupancies]);

  const contactOptions = useMemo(() => {
    const map: Record<string, string> = {};
    for (const payment of payments) {
      map[payment.contact_id] = resolveContact(payment.contacts);
    }
    return Object.entries(map).map(([id, label]) => ({ id, label }));
  }, [payments]);

  const filteredPayments = useMemo(() => {
    return payments.filter((payment) => {
      if (statusFilter === "open") {
        if (payment.status !== "due" && payment.status !== "partial") {
          return false;
        }
      } else if (statusFilter !== "all" && payment.status !== statusFilter) {
        return false;
      }

      if (contactFilter !== "all" && payment.contact_id !== contactFilter) {
        return false;
      }
      return true;
    });
  }, [payments, statusFilter, contactFilter]);

  useEffect(() => {
    if (!hasPayments) {
      setLoading(false);
      return;
    }

    let active = true;
    const load = async () => {
      setLoading(true);
      setError(null);

      const [paymentsRes, occupanciesRes] = await Promise.all([
        supabase
          .from("pg_payments")
          .select(
            `id,
             contact_id,
             occupancy_id,
             period_start,
             period_end,
             due_date,
             amount_due,
             amount_paid,
             status,
             paid_at,
             method,
             reference,
             notes,
             contacts:contact_id (id, full_name, phone, email)`
          )
          .eq("tenant_id", tenant.tenantId)
          .is("deleted_at", null)
          .order("due_date", { ascending: false }),
        supabase
          .from("pg_occupancies")
          .select(
            `id,
             contact_id,
             pg_beds:bed_id (id, bed_code),
             contacts:contact_id (id, full_name, phone, email)`
          )
          .eq("tenant_id", tenant.tenantId)
          .eq("status", "active")
          .is("deleted_at", null)
          .order("start_date", { ascending: false })
      ]);

      if (!active) return;

      const firstError = paymentsRes.error || occupanciesRes.error;
      if (firstError) {
        setError(firstError.message);
        setLoading(false);
        return;
      }

      setPayments((paymentsRes.data as Payment[]) ?? []);
      setOccupancies((occupanciesRes.data as OccupancyOption[]) ?? []);
      setLoading(false);
    };

    load();
    return () => {
      active = false;
    };
  }, [tenant.tenantId, hasPayments]);

  useEffect(() => {
    setPaymentInputs((prev) => {
      const next = { ...prev };
      for (const payment of payments) {
        if (!next[payment.id]) {
          next[payment.id] = {
            amountPaid: String(toNumber(payment.amount_paid)),
            method: payment.method ?? "",
            reference: payment.reference ?? ""
          };
        }
      }
      return next;
    });
  }, [payments]);

  const handleCreate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (readOnly) {
      setError("Read-only support access.");
      return;
    }

    if (!formState.occupancyId) {
      setError("Select an active occupancy.");
      return;
    }

    const amountDue = Number(formState.amountDue);
    if (Number.isNaN(amountDue) || amountDue <= 0) {
      setError("Amount due must be a positive number.");
      return;
    }

    const occupancy = occupancyById[formState.occupancyId];
    if (!occupancy) {
      setError("Occupancy not found.");
      return;
    }

    setCreating(true);
    setError(null);

    const { data: sessionData } = await supabase.auth.getSession();

    const { data, error: insertError } = await supabase
      .from("pg_payments")
      .insert({
        tenant_id: tenant.tenantId,
        occupancy_id: formState.occupancyId,
        contact_id: occupancy.contact_id,
        amount_due: amountDue,
        amount_paid: 0,
        status: "due",
        due_date: formState.dueDate || null,
        period_start: formState.periodStart || null,
        period_end: formState.periodEnd || null,
        notes: formState.notes.trim() || null,
        created_by: sessionData?.session?.user.id ?? null
      })
      .select(
        `id,
         contact_id,
         occupancy_id,
         period_start,
         period_end,
         due_date,
         amount_due,
         amount_paid,
         status,
         paid_at,
         method,
         reference,
         notes,
         contacts:contact_id (id, full_name, phone, email)`
      )
      .single();

    if (insertError) {
      setError(insertError.message);
      setCreating(false);
      return;
    }

    setPayments((prev) => [data as Payment, ...prev]);
    setFormState({
      occupancyId: "",
      amountDue: "",
      dueDate: "",
      periodStart: "",
      periodEnd: "",
      notes: ""
    });
    setCreating(false);
  };

  const updatePaymentState = (paymentId: string, updates: Partial<Payment>) => {
    setPayments((prev) =>
      prev.map((payment) =>
        payment.id === paymentId ? { ...payment, ...updates } : payment
      )
    );
  };

  const handleMarkPaid = async (payment: Payment) => {
    if (readOnly) {
      setError("Read-only support access.");
      return;
    }

    const input = paymentInputs[payment.id];
    setError(null);

    const { data: sessionData } = await supabase.auth.getSession();
    const now = new Date().toISOString();
    const amountDue = toNumber(payment.amount_due);

    const { error: updateError } = await supabase
      .from("pg_payments")
      .update({
        amount_paid: amountDue,
        status: "paid",
        paid_at: now,
        method: input?.method || null,
        reference: input?.reference || null,
        updated_by: sessionData?.session?.user.id ?? null
      })
      .eq("id", payment.id)
      .eq("tenant_id", tenant.tenantId);

    if (updateError) {
      setError(updateError.message);
      return;
    }

    updatePaymentState(payment.id, {
      amount_paid: amountDue,
      status: "paid",
      paid_at: now,
      method: input?.method || null,
      reference: input?.reference || null
    });
  };

  const handlePartial = async (payment: Payment) => {
    if (readOnly) {
      setError("Read-only support access.");
      return;
    }

    const input = paymentInputs[payment.id];
    const amountPaid = Number(input?.amountPaid ?? "");
    if (Number.isNaN(amountPaid) || amountPaid <= 0) {
      setError("Enter a valid amount paid.");
      return;
    }

    const amountDue = toNumber(payment.amount_due);
    const nextStatus: PaymentStatus =
      amountPaid >= amountDue ? "paid" : "partial";
    const now = new Date().toISOString();

    setError(null);
    const { data: sessionData } = await supabase.auth.getSession();

    const { error: updateError } = await supabase
      .from("pg_payments")
      .update({
        amount_paid: amountPaid,
        status: nextStatus,
        paid_at: now,
        method: input?.method || null,
        reference: input?.reference || null,
        updated_by: sessionData?.session?.user.id ?? null
      })
      .eq("id", payment.id)
      .eq("tenant_id", tenant.tenantId);

    if (updateError) {
      setError(updateError.message);
      return;
    }

    updatePaymentState(payment.id, {
      amount_paid: amountPaid,
      status: nextStatus,
      paid_at: now,
      method: input?.method || null,
      reference: input?.reference || null
    });
  };

  if (!hasPayments) {
    return (
      <div className="card">
        <h1>Payments</h1>
        <p className="muted">Module disabled for this tenant.</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="card">
        <h1>Loading payments...</h1>
        <p className="muted">Fetching ledger entries.</p>
      </div>
    );
  }

  return (
    <>
      <div className="card">
        <h1>Payments</h1>
        <p className="muted">Track rent dues and payment status per resident.</p>
        {readOnly && (
          <div className="notice">Read-only support access is enabled.</div>
        )}
        {error && <div className="error">{error}</div>}

        <div className="section">
          <div className="section-title">Filters</div>
          <label className="field">
            <span>Status</span>
            <select
              value={statusFilter}
              onChange={(event) =>
                setStatusFilter(
                  event.target.value as PaymentStatus | "open" | "all"
                )
              }
            >
              <option value="open">Open (due/partial)</option>
              <option value="all">All</option>
              {statusOptions.map((status) => (
                <option key={status} value={status}>
                  {status}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Contact</span>
            <select
              value={contactFilter}
              onChange={(event) => setContactFilter(event.target.value)}
            >
              <option value="all">All contacts</option>
              {contactOptions.map((contact) => (
                <option key={contact.id} value={contact.id}>
                  {contact.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      <div className="card">
        <div className="section-title">Create due</div>
        <form onSubmit={handleCreate}>
          <label className="field">
            <span>Active occupancy</span>
            <select
              value={formState.occupancyId}
              onChange={(event) =>
                setFormState((prev) => ({
                  ...prev,
                  occupancyId: event.target.value
                }))
              }
              disabled={readOnly}
            >
              <option value="">Select occupancy</option>
              {occupancies.map((occupancy) => (
                <option key={occupancy.id} value={occupancy.id}>
                  {resolveContact(occupancy.contacts)} - {resolveBed(occupancy)}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Amount due</span>
            <input
              type="number"
              min={0}
              step="0.01"
              value={formState.amountDue}
              onChange={(event) =>
                setFormState((prev) => ({
                  ...prev,
                  amountDue: event.target.value
                }))
              }
              disabled={readOnly}
            />
          </label>
          <label className="field">
            <span>Due date</span>
            <input
              type="date"
              value={formState.dueDate}
              onChange={(event) =>
                setFormState((prev) => ({
                  ...prev,
                  dueDate: event.target.value
                }))
              }
              disabled={readOnly}
            />
          </label>
          <label className="field">
            <span>Period start</span>
            <input
              type="date"
              value={formState.periodStart}
              onChange={(event) =>
                setFormState((prev) => ({
                  ...prev,
                  periodStart: event.target.value
                }))
              }
              disabled={readOnly}
            />
          </label>
          <label className="field">
            <span>Period end</span>
            <input
              type="date"
              value={formState.periodEnd}
              onChange={(event) =>
                setFormState((prev) => ({
                  ...prev,
                  periodEnd: event.target.value
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
            disabled={readOnly || creating}
            title={readOnly ? roTooltip : undefined}
          >
            {creating ? "Saving..." : "Create due"}
          </button>
        </form>
      </div>

      <div className="card">
        <div className="section-title">Payments</div>
        {filteredPayments.length === 0 ? (
          <p className="muted">No payments match this filter.</p>
        ) : (
          filteredPayments.map((payment) => {
            const input = paymentInputs[payment.id] ?? {
              amountPaid: "",
              method: "",
              reference: ""
            };
            return (
              <div className="card" key={payment.id}>
                <h3>{resolveContact(payment.contacts)}</h3>
                <p className="muted">
                  Due: {payment.due_date ?? "n/a"} | Amount:{" "}
                  {toNumber(payment.amount_due)} | Paid:{" "}
                  {toNumber(payment.amount_paid)}
                </p>
                <p className="muted">Status: {payment.status}</p>
                <div className="section">
                  <label className="field">
                    <span>Amount paid</span>
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      value={input.amountPaid}
                      onChange={(event) =>
                        setPaymentInputs((prev) => ({
                          ...prev,
                          [payment.id]: {
                            ...prev[payment.id],
                            amountPaid: event.target.value
                          }
                        }))
                      }
                      disabled={readOnly}
                    />
                  </label>
                  <label className="field">
                    <span>Method</span>
                    <input
                      type="text"
                      value={input.method}
                      onChange={(event) =>
                        setPaymentInputs((prev) => ({
                          ...prev,
                          [payment.id]: {
                            ...prev[payment.id],
                            method: event.target.value
                          }
                        }))
                      }
                      disabled={readOnly}
                    />
                  </label>
                  <label className="field">
                    <span>Reference</span>
                    <input
                      type="text"
                      value={input.reference}
                      onChange={(event) =>
                        setPaymentInputs((prev) => ({
                          ...prev,
                          [payment.id]: {
                            ...prev[payment.id],
                            reference: event.target.value
                          }
                        }))
                      }
                      disabled={readOnly}
                    />
                  </label>
                  <div className="tag-list">
                    <button
                      type="button"
                      className={`button ${readOnly ? "disabled" : ""}`}
                      disabled={readOnly}
                      title={readOnly ? roTooltip : undefined}
                      onClick={() => handleMarkPaid(payment)}
                    >
                      Mark paid
                    </button>
                    <button
                      type="button"
                      className={`button secondary ${readOnly ? "disabled" : ""}`}
                      disabled={readOnly}
                      title={readOnly ? roTooltip : undefined}
                      onClick={() => handlePartial(payment)}
                    >
                      Record payment
                    </button>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </>
  );
}
