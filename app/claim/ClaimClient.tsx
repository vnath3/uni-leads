"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

const normalizeClaimError = (message: string) => {
  const normalized = message.toLowerCase();
  if (normalized.includes("invalid or expired")) {
    return "This invite link is invalid or expired.";
  }
  if (normalized.includes("already assigned")) {
    return "This account already belongs to a tenant.";
  }
  if (normalized.includes("authentication required")) {
    return "Please sign in to claim the invite.";
  }
  return message;
};

export default function ClaimClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = (searchParams.get("token") ?? "").trim();
  const attemptedTokenRef = useRef<string | null>(null);
  const [status, setStatus] = useState<
    "checking" | "redirecting" | "claiming" | "error"
  >("checking");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    const run = async () => {
      if (!token) {
        setStatus("error");
        setError("Missing invite token.");
        return;
      }

      if (attemptedTokenRef.current === token) {
        return;
      }
      attemptedTokenRef.current = token;

      setStatus("checking");
      setError(null);

      const { data: sessionData, error: sessionError } =
        await supabase.auth.getSession();

      if (!active) return;

      if (sessionError) {
        setStatus("error");
        setError(sessionError.message);
        return;
      }

      if (!sessionData.session) {
        setStatus("redirecting");
        const redirectTarget = `/claim?token=${encodeURIComponent(token)}`;
        router.replace(`/login?redirect=${encodeURIComponent(redirectTarget)}`);
        return;
      }

      setStatus("claiming");
      const { data, error: claimError } = await supabase
        .schema("public")
        .rpc("claim_tenant_invite", { p_token: token });

      if (!active) return;

      if (claimError) {
        setStatus("error");
        setError(normalizeClaimError(claimError.message));
        return;
      }

      const claimRow = Array.isArray(data) ? data[0] : data;
      const tenantId = claimRow?.tenant_id;
      if (!tenantId) {
        setStatus("error");
        setError("Invite claimed, but tenant resolution failed.");
        return;
      }

      const { data: identityData, error: identityError } = await supabase
        .from("tenant_identities")
        .select("value, is_primary")
        .eq("tenant_id", tenantId)
        .eq("identity_type", "slug")
        .order("is_primary", { ascending: false })
        .limit(1);

      if (!active) return;

      if (identityError) {
        setStatus("error");
        setError(identityError.message);
        return;
      }

      const slug = identityData?.[0]?.value;
      if (!slug) {
        setStatus("error");
        setError("Invite claimed, but tenant slug was not found.");
        return;
      }

      router.replace(`/t/${slug}/admin`);
    };

    run();

    return () => {
      active = false;
    };
  }, [router, token]);

  return (
    <div className="card">
      <h1>Claim invite</h1>
      {status === "checking" && (
        <p className="muted">Checking your session...</p>
      )}
      {status === "redirecting" && (
        <p className="muted">Redirecting to login...</p>
      )}
      {status === "claiming" && (
        <p className="muted">Claiming your invite...</p>
      )}
      {status === "error" && (
        <div className="error">{error ?? "Invite claim failed."}</div>
      )}
    </div>
  );
}
