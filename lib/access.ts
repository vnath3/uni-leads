import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupportModeForTenant } from "@/lib/tenant";

const isActiveRole = (value?: string | null) => {
  const role = (value ?? "").toLowerCase();
  return role === "owner" || role === "admin" || role === "member";
};

export const requireTenantAccess = async (
  supabase: SupabaseClient,
  tenantId: string
): Promise<boolean> => {
  const { data: sessionData, error: sessionError } =
    await supabase.auth.getSession();

  if (!sessionError && sessionData.session?.user?.id) {
    const { data: platformUser, error: platformError } = await supabase
      .from("platform_users")
      .select("user_id, is_active")
      .eq("user_id", sessionData.session.user.id)
      .eq("is_active", true)
      .maybeSingle();

    if (!platformError && platformUser?.is_active) {
      return true;
    }
  }

  const { error } = await supabase
    .from("tenant_features")
    .select("tenant_id")
    .eq("tenant_id", tenantId)
    .limit(1);

  return !error;
};

export const assertTenantAccess = async (
  supabase: SupabaseClient,
  tenantId: string
) => {
  const ok = await requireTenantAccess(supabase, tenantId);
  if (!ok) {
    throw new Error("Access denied.");
  }
  return true;
};

export const requireTenantWrite = async (
  supabase: SupabaseClient,
  tenantId: string
): Promise<boolean> => {
  const { data: sessionData, error: sessionError } =
    await supabase.auth.getSession();

  if (sessionError || !sessionData.session?.user?.id) {
    return false;
  }

  const { data: membership, error: membershipError } = await supabase
    .from("tenant_members")
    .select("role, is_active")
    .eq("tenant_id", tenantId)
    .eq("user_id", sessionData.session.user.id)
    .eq("is_active", true)
    .maybeSingle();

  if (!membershipError && membership?.is_active && isActiveRole(membership.role)) {
    return true;
  }

  const supportMode = await getSupportModeForTenant(supabase, tenantId);
  return supportMode === "rw";
};
