"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { useTenantContext } from "@/components/TenantContextProvider";

type JobKey = "pg_monthly_dues" | "clinic_appt_reminders";

type AutomationRule = {
  id?: string;
  job: JobKey;
  is_enabled: boolean;
  config: Record<string, unknown>;
  last_run_at?: string | null;
};

const jobDefinitions: Array<{
  job: JobKey;
  label: string;
  description: string;
  featureKey: string;
  defaults: Record<string, number>;
}> = [
  {
    job: "pg_monthly_dues",
    label: "PG Monthly Dues",
    description: "Generate rent dues for active occupancies each month.",
    featureKey: "pg.payments",
    defaults: { due_day: 5 }
  },
  {
    job: "clinic_appt_reminders",
    label: "Clinic Appointment Reminders",
    description: "Queue reminders for upcoming appointments.",
    featureKey: "clinic.appointments",
    defaults: { window_hours: 24 }
  }
];

const formatDateTime = (value?: string | null) => {
  if (!value) return "Not run yet";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
};

const isMemberRole = (role?: string | null) => {
  const normalized = (role ?? "").toLowerCase();
  return normalized === "owner" || normalized === "admin" || normalized === "member";
};

export default function AutomationsPage() {
  const { tenant, canWrite, memberRole } = useTenantContext();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rules, setRules] = useState<Partial<Record<JobKey, AutomationRule>>>({});
  const [saving, setSaving] = useState<Record<JobKey, boolean>>({
    pg_monthly_dues: false,
    clinic_appt_reminders: false
  });
  const [userId, setUserId] = useState<string | null>(null);

  const availableJobs = useMemo(
    () =>
      jobDefinitions.filter((job) =>
        tenant.enabledFeatureKeys.includes(job.featureKey)
      ),
    [tenant.enabledFeatureKeys]
  );

  const canView =
    isMemberRole(memberRole) ||
    (tenant.isPlatformUser && tenant.supportMode !== "none");
  const readOnly = tenant.supportMode === "ro" || !canWrite;

  useEffect(() => {
    let active = true;
    const loadSession = async () => {
      const { data } = await supabase.auth.getSession();
      if (!active) return;
      setUserId(data.session?.user.id ?? null);
    };

    loadSession();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!canView) {
      setLoading(false);
      return;
    }

    let active = true;
    const load = async () => {
      setLoading(true);
      setError(null);

      if (availableJobs.length === 0) {
        setLoading(false);
        return;
      }

      const { data, error: rulesError } = await supabase
        .from("automation_rules")
        .select("id, job, is_enabled, config, last_run_at")
        .eq("tenant_id", tenant.tenantId)
        .in(
          "job",
          availableJobs.map((job) => job.job)
        )
        .is("deleted_at", null);

      if (!active) return;

      if (rulesError) {
        setError(rulesError.message);
        setLoading(false);
        return;
      }

      const nextRules: Partial<Record<JobKey, AutomationRule>> = {};
      for (const job of availableJobs) {
        const existing = (data as AutomationRule[] | null)?.find(
          (row) => row.job === job.job
        );
        nextRules[job.job] = existing
          ? {
              ...existing,
              config: existing.config ?? {}
            }
          : {
              job: job.job,
              is_enabled: false,
              config: { ...job.defaults }
            };
      }
      setRules(nextRules);
      setLoading(false);
    };

    load();
    return () => {
      active = false;
    };
  }, [tenant.tenantId, availableJobs, canView]);

  const saveRule = async (job: JobKey, updates: Partial<AutomationRule>) => {
    const current = rules[job];
    if (!current) return;
    if (!userId) {
      setError("Session expired. Please sign in again.");
      return;
    }

    setSaving((prev) => ({ ...prev, [job]: true }));
    setError(null);

    const config = updates.config ?? current.config;
    const payload: Record<string, unknown> = {
      tenant_id: tenant.tenantId,
      job,
      is_enabled: updates.is_enabled ?? current.is_enabled,
      config,
      updated_by: userId
    };

    if (!current.id) {
      payload.created_by = userId;
    }

    const { data, error: saveError } = await supabase
      .from("automation_rules")
      .upsert(payload, { onConflict: "tenant_id,job" })
      .select("id, job, is_enabled, config, last_run_at")
      .single();

    if (saveError) {
      setError(saveError.message);
      setSaving((prev) => ({ ...prev, [job]: false }));
      return;
    }

    setRules((prev) => ({
      ...prev,
      [job]: {
        ...(data as AutomationRule),
        config: (data as AutomationRule).config ?? {}
      }
    }));
    setSaving((prev) => ({ ...prev, [job]: false }));
  };

  if (!canView) {
    return (
      <div className="card">
        <h1>Automations</h1>
        <p className="muted">You do not have access to manage automations.</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="card">
        <h1>Loading automations...</h1>
        <p className="muted">Fetching automation rules.</p>
      </div>
    );
  }

  if (availableJobs.length === 0) {
    return (
      <div className="card">
        <h1>Automations</h1>
        <p className="muted">No automation modules are enabled.</p>
      </div>
    );
  }

  return (
    <>
      <div className="card">
        <h1>Automations</h1>
        <p className="muted">
          Enable scheduled jobs per tenant and control their settings.
        </p>
        {readOnly && (
          <div className="notice">Read-only support access is enabled.</div>
        )}
        {error && <div className="error">{error}</div>}
      </div>

      {availableJobs.map((job) => {
        const rule = rules[job.job];
        if (!rule) return null;
        const isSaving = saving[job.job];
        const config = rule.config ?? {};

        return (
          <div className="card" key={job.job}>
            <div className="card-header">
              <div>
                <h2>{job.label}</h2>
                <p className="muted">{job.description}</p>
                <p className="muted">
                  Last run: {formatDateTime(rule.last_run_at)}
                </p>
              </div>
              <button
                className={`button ${readOnly ? "disabled" : ""}`}
                disabled={readOnly || isSaving}
                onClick={() =>
                  saveRule(job.job, { is_enabled: !rule.is_enabled })
                }
              >
                {rule.is_enabled ? "Disable" : "Enable"}
              </button>
            </div>

            <div className="section">
              <div className="section-title">Config</div>
              {job.job === "pg_monthly_dues" && (
                <label className="field">
                  <span>Due day (1-28)</span>
                  <input
                    type="number"
                    min={1}
                    max={28}
                    value={String(config.due_day ?? job.defaults.due_day)}
                    onChange={(event) =>
                      setRules((prev) => ({
                        ...prev,
                        [job.job]: {
                          ...prev[job.job],
                          config: {
                            ...prev[job.job].config,
                            due_day: Number(event.target.value || 1)
                          }
                        }
                      }))
                    }
                    disabled={readOnly}
                  />
                </label>
              )}

              {job.job === "clinic_appt_reminders" && (
                <label className="field">
                  <span>Window hours (1-72)</span>
                  <input
                    type="number"
                    min={1}
                    max={72}
                    value={String(
                      config.window_hours ?? job.defaults.window_hours
                    )}
                    onChange={(event) =>
                      setRules((prev) => ({
                        ...prev,
                        [job.job]: {
                          ...prev[job.job],
                          config: {
                            ...prev[job.job].config,
                            window_hours: Number(event.target.value || 1)
                          }
                        }
                      }))
                    }
                    disabled={readOnly}
                  />
                </label>
              )}

              <button
                className={`button ${readOnly ? "disabled" : ""}`}
                disabled={readOnly || isSaving}
                onClick={() => saveRule(job.job, { config })}
              >
                {isSaving ? "Saving..." : "Save config"}
              </button>
            </div>
          </div>
        );
      })}
    </>
  );
}
