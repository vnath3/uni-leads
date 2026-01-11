"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { useTenantContext } from "@/components/TenantContextProvider";

type AuditRow = {
  id: string;
  action: string;
  entity_type?: string | null;
  entity_id?: string | null;
  actor_user_id?: string | null;
  actor_type: string;
  metadata?: Record<string, unknown> | null;
  created_at: string;
};

const formatDateTime = (value?: string | null) => {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
};

const buildSummary = (metadata?: Record<string, unknown> | null) => {
  if (!metadata) return "";
  const before = metadata.before as Record<string, unknown> | undefined;
  const after = metadata.after as Record<string, unknown> | undefined;
  const keys =
    before && after
      ? Object.keys(after).filter((key) => before[key] !== after[key])
      : [];
  if (keys.length === 0) return "";
  return `Changed: ${keys.slice(0, 4).join(", ")}${keys.length > 4 ? "..." : ""}`;
};

export default function AuditPage() {
  const { tenant, isOwnerAdmin } = useTenantContext();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [actionFilter, setActionFilter] = useState<string>("all");
  const [entityFilter, setEntityFilter] = useState<string>("all");

  const hasAccess =
    isOwnerAdmin || (tenant.isPlatformUser && tenant.supportMode !== "none");

  useEffect(() => {
    if (!hasAccess) {
      setLoading(false);
      return;
    }

    let active = true;
    const load = async () => {
      setLoading(true);
      setError(null);

      const { data, error: auditError } = await supabase
        .from("audit_log")
        .select(
          "id, action, entity_type, entity_id, actor_user_id, actor_type, metadata, created_at"
        )
        .eq("tenant_id", tenant.tenantId)
        .order("created_at", { ascending: false })
        .limit(200);

      if (!active) return;

      if (auditError) {
        setError(auditError.message);
        setLoading(false);
        return;
      }

      setRows((data as AuditRow[]) ?? []);
      setLoading(false);
    };

    load();
    return () => {
      active = false;
    };
  }, [tenant.tenantId, hasAccess]);

  const actionOptions = useMemo(() => {
    const set = new Set<string>();
    for (const row of rows) {
      if (row.action) set.add(row.action);
    }
    return Array.from(set).sort();
  }, [rows]);

  const entityOptions = useMemo(() => {
    const set = new Set<string>();
    for (const row of rows) {
      if (row.entity_type) set.add(row.entity_type);
    }
    return Array.from(set).sort();
  }, [rows]);

  const filteredRows = useMemo(() => {
    return rows.filter((row) => {
      if (actionFilter !== "all" && row.action !== actionFilter) {
        return false;
      }
      if (entityFilter !== "all" && row.entity_type !== entityFilter) {
        return false;
      }
      return true;
    });
  }, [rows, actionFilter, entityFilter]);

  if (!hasAccess) {
    return (
      <div className="card">
        <h1>Audit log</h1>
        <p className="muted">You do not have access to view audit events.</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="card">
        <h1>Loading audit log...</h1>
        <p className="muted">Fetching recent events.</p>
      </div>
    );
  }

  return (
    <>
      <div className="card">
        <h1>Audit log</h1>
        <p className="muted">Recent activity for this tenant.</p>
        {error && <div className="error">{error}</div>}
        <div className="section">
          <div className="section-title">Filters</div>
          <label className="field">
            <span>Action</span>
            <select
              value={actionFilter}
              onChange={(event) => setActionFilter(event.target.value)}
            >
              <option value="all">All actions</option>
              {actionOptions.map((action) => (
                <option key={action} value={action}>
                  {action}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Entity</span>
            <select
              value={entityFilter}
              onChange={(event) => setEntityFilter(event.target.value)}
            >
              <option value="all">All entities</option>
              {entityOptions.map((entity) => (
                <option key={entity} value={entity}>
                  {entity}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      <div className="card">
        <div className="section-title">Events</div>
        {filteredRows.length === 0 ? (
          <p className="muted">No audit events found.</p>
        ) : (
          filteredRows.map((row) => (
            <div className="card" key={row.id}>
              <h3>{row.action}</h3>
              <p className="muted">
                {formatDateTime(row.created_at)} | {row.entity_type ?? "unknown"}{" "}
                {row.entity_id ? `(${row.entity_id})` : ""}
              </p>
              <p className="muted">
                Actor: {row.actor_user_id ?? row.actor_type}
              </p>
              {row.metadata && (
                <p className="muted">{buildSummary(row.metadata)}</p>
              )}
            </div>
          ))
        )}
      </div>
    </>
  );
}
