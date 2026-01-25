import type { SupabaseClient } from "@supabase/supabase-js";

export type TenantIdentityType = "slug" | "domain";
export type SupportMode = "none" | "ro" | "rw";

export type TenantContext = {
  tenantId: string;
  slug: string;
  landing?: Record<string, unknown>;
  enabledFeatureKeys: string[];
  supportMode: SupportMode;
  isPlatformUser: boolean;
};

type SupportContext = {
  supportMode: SupportMode;
  isPlatformUser: boolean;
  userId: string | null;
};

const isRlsError = (error: { code?: string; message?: string } | null) => {
  if (!error) return false;
  if (error.code === "42501") return true;
  const message = (error.message ?? "").toLowerCase();
  return (
    message.includes("permission denied") ||
    message.includes("row level security") ||
    message.includes("rls")
  );
};

const getSupportContextForTenant = async (
  supabase: SupabaseClient,
  tenantId: string
): Promise<SupportContext> => {
  const { data: sessionData, error: sessionError } =
    await supabase.auth.getSession();

  if (sessionError || !sessionData.session?.user?.id) {
    return { supportMode: "none", isPlatformUser: false, userId: null };
  }

  const userId = sessionData.session.user.id;

  const { data: platformUser, error: platformError } = await supabase
    .from("platform_users")
    .select("user_id, is_active")
    .eq("user_id", userId)
    .maybeSingle();

  if (platformError || !platformUser?.is_active) {
    return { supportMode: "none", isPlatformUser: false, userId };
  }

  return {
    supportMode: "rw",
    isPlatformUser: true,
    userId
  };
};

export const resolveTenantIdBySlug = async (
  supabase: SupabaseClient,
  slug: string
) => {
  const { data, error } = await supabase.schema("public").rpc("resolve_tenant_id", {
    p_identity_type: "slug",
    p_value: slug
  });

  if (error) {
    throw new Error(error.message);
  }

  const tenantId =
    typeof data === "string"
      ? data
      : (data as { tenant_id?: string } | null)?.tenant_id;

  if (!tenantId) {
    throw new Error("Tenant unavailable.");
  }

  return tenantId;
};

export const fetchEnabledFeatures = async (
  supabase: SupabaseClient,
  tenantId: string
): Promise<string[]> => {
  const { data, error } = await supabase
    .from("tenant_features")
    .select("feature_key, enabled")
    .eq("tenant_id", tenantId)
    .eq("enabled", true);

  if (error) {
    throw error;
  }

  return (data ?? [])
    .map((row) => row.feature_key)
    .filter((value): value is string => typeof value === "string");
};

export const getSupportModeForTenant = async (
  supabase: SupabaseClient,
  tenantId: string
): Promise<SupportMode> => {
  const { supportMode } = await getSupportContextForTenant(supabase, tenantId);
  return supportMode;
};

export const getTenantContextFromSlug = async (
  supabase: SupabaseClient,
  slug: string,
  options?: { includeLanding?: boolean }
): Promise<TenantContext> => {
  const tenantId = await resolveTenantIdBySlug(supabase, slug);
  const includeLanding = options?.includeLanding ?? false;

  const [supportContext, enabledFeatureKeys, landing] = await Promise.all([
    getSupportContextForTenant(supabase, tenantId),
    fetchEnabledFeatures(supabase, tenantId).catch((error) => {
      if (isRlsError(error)) {
        return [];
      }
      throw error;
    }),
    includeLanding
      ? supabase
          .schema("public")
          .rpc("get_landing_settings", {
            p_identity_type: "slug",
            p_identity_value: slug
          })
          .then(({ data, error }) => {
            if (error) {
              throw new Error(error.message);
            }
            return data as Record<string, unknown> | undefined;
          })
      : Promise.resolve(undefined)
  ]);

  return {
    tenantId,
    slug,
    landing,
    enabledFeatureKeys,
    supportMode: supportContext.supportMode,
    isPlatformUser: supportContext.isPlatformUser
  };
};
