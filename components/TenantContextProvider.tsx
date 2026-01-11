"use client";

import { createContext, useContext } from "react";
import type { TenantContext } from "@/lib/tenant";

export type TenantAdminContext = {
  tenant: TenantContext;
  memberRole: string | null;
  isOwnerAdmin: boolean;
  canWrite: boolean;
};

const TenantContextState = createContext<TenantAdminContext | null>(null);

export const TenantContextProvider = ({
  value,
  children
}: {
  value: TenantAdminContext;
  children: React.ReactNode;
}) => (
  <TenantContextState.Provider value={value}>
    {children}
  </TenantContextState.Provider>
);

export const useTenantContext = () => {
  const context = useContext(TenantContextState);
  if (!context) {
    throw new Error("Tenant context is not available.");
  }
  return context;
};
