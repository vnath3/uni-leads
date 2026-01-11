"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { useTenantContext } from "@/components/TenantContextProvider";

type OutboxStatus = "queued" | "processing" | "sent" | "failed" | "cancelled";
type OutboxChannel = "internal" | "whatsapp" | "sms" | "email";

type OutboxItem = {
  id: string;
  status: OutboxStatus;
  channel: OutboxChannel;
  scheduled_at: string;
  contact_id?: string | null;
  subject?: string | null;
  body: string;
  related_table?: string | null;
  related_id?: string | null;
  created_at: string;
  error?: string | null;
  meta?: Record<string, unknown> | null;
  contacts?: {
    full_name?: string | null;
    phone?: string | null;
    email?: string | null;
  } | { full_name?: string | null; phone?: string | null; email?: string | null }[] | null;
};

const formatDateTime = (value?: string | null) => {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
};

const resolveContact = (contact?: OutboxItem["contacts"]) => {
  const resolved = Array.isArray(contact) ? contact[0] : contact;
  if (!resolved) return "Unknown contact";
  return resolved.full_name || resolved.email || resolved.phone || "Unknown contact";
};

export default function OutboxPage() {
  const { tenant, canWrite } = useTenantContext();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [items, setItems] = useState<OutboxItem[]>([]);
  const [statusFilter, setStatusFilter] = useState<OutboxStatus | "all">("all");
  const [channelFilter, setChannelFilter] = useState<OutboxChannel | "all">("all");
  const [savingId, setSavingId] = useState<string | null>(null);

  const readOnly = tenant.supportMode === "ro" || !canWrite;

  useEffect(() => {
    let active = true;
    const load = async () => {
      setLoading(true);
      setError(null);

      const { data, error: outboxError } = await supabase
        .from("message_outbox")
        .select(
          `id,
           status,
           channel,
           scheduled_at,
           contact_id,
           subject,
           body,
           related_table,
           related_id,
           created_at,
           error,
           meta,
           contacts:contact_id (full_name, phone, email)`
        )
        .eq("tenant_id", tenant.tenantId)
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .limit(200);

      if (!active) return;

      if (outboxError) {
        setError(outboxError.message);
        setLoading(false);
        return;
      }

      setItems((data as OutboxItem[]) ?? []);
      setLoading(false);
    };

    load();
    return () => {
      active = false;
    };
  }, [tenant.tenantId]);

  const filteredItems = useMemo(() => {
    return items.filter((item) => {
      if (statusFilter !== "all" && item.status !== statusFilter) {
        return false;
      }
      if (channelFilter !== "all" && item.channel !== channelFilter) {
        return false;
      }
      return true;
    });
  }, [items, statusFilter, channelFilter]);

  const updateStatus = async (
    item: OutboxItem,
    status: OutboxStatus,
    errorValue: string | null = null
  ) => {
    if (readOnly) {
      setError("Read-only support access.");
      return;
    }

    setSavingId(item.id);
    setError(null);

    const { error: updateError } = await supabase
      .from("message_outbox")
      .update({ status, error: errorValue })
      .eq("id", item.id)
      .eq("tenant_id", tenant.tenantId);

    if (updateError) {
      setError(updateError.message);
      setSavingId(null);
      return;
    }

    setItems((prev) =>
      prev.map((row) =>
        row.id === item.id ? { ...row, status, error: errorValue } : row
      )
    );
    setSavingId(null);
  };

  if (loading) {
    return (
      <div className="card">
        <h1>Outbox</h1>
        <p className="muted">Loading queued messages.</p>
      </div>
    );
  }

  return (
    <>
      <div className="card">
        <h1>Outbox</h1>
        <p className="muted">Review queued automation messages.</p>
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
                setStatusFilter(event.target.value as OutboxStatus | "all")
              }
            >
              <option value="all">All</option>
              <option value="queued">Queued</option>
              <option value="processing">Processing</option>
              <option value="sent">Sent</option>
              <option value="failed">Failed</option>
              <option value="cancelled">Cancelled</option>
            </select>
          </label>
          <label className="field">
            <span>Channel</span>
            <select
              value={channelFilter}
              onChange={(event) =>
                setChannelFilter(event.target.value as OutboxChannel | "all")
              }
            >
              <option value="all">All</option>
              <option value="internal">Internal</option>
              <option value="whatsapp">WhatsApp</option>
              <option value="sms">SMS</option>
              <option value="email">Email</option>
            </select>
          </label>
        </div>
      </div>

      <div className="card">
        <div className="section-title">Messages</div>
        {filteredItems.length === 0 ? (
          <p className="muted">No outbox messages match the filters.</p>
        ) : (
          filteredItems.map((item) => (
            <div className="card" key={item.id}>
              <h3>{resolveContact(item.contacts)}</h3>
              <p className="muted">
                {item.channel} | {item.status} | Scheduled{" "}
                {formatDateTime(item.scheduled_at)}
              </p>
              {item.subject && <p className="muted">Subject: {item.subject}</p>}
              <p className="muted">{item.body}</p>
              {item.related_table && (
                <p className="muted">
                  Related: {item.related_table} {item.related_id ?? ""}
                </p>
              )}
              {item.error && <div className="error">{item.error}</div>}
              <div className="tag-list">
                <button
                  type="button"
                  className={`button ${readOnly ? "disabled" : ""}`}
                  disabled={readOnly || savingId === item.id}
                  onClick={() => updateStatus(item, "sent")}
                >
                  Mark sent
                </button>
                <button
                  type="button"
                  className={`button secondary ${readOnly ? "disabled" : ""}`}
                  disabled={readOnly || savingId === item.id}
                  onClick={() => updateStatus(item, "cancelled")}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className={`button secondary ${readOnly ? "disabled" : ""}`}
                  disabled={readOnly || savingId === item.id}
                  onClick={() => updateStatus(item, "queued", null)}
                >
                  Retry
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </>
  );
}
