import { createContext, useContext, type ReactNode } from "react";
import type { Agent, Page, PlatformUser, Tenant } from "./api";

export type AppContextValue = {
  token: string;
  setToken: (value: string) => void;
  user: PlatformUser;
  selectedRole?: "tenant_admin" | "developer" | "viewer";
  canWrite: boolean;
  canAdminister: boolean;
  realtimeVersion: number;
  logout: () => Promise<void>;
  tenants: Tenant[];
  selectedTenantId: string;
  setSelectedTenantId: (value: string) => void;
  agents: Agent[];
  agentPage: Page<Agent>;
  refreshTenants: () => Promise<unknown>;
  refreshAgents: (input?: {
    page?: number;
    pageSize?: number;
    search?: string;
    status?: string;
  }) => Promise<unknown>;
};
const AppContext = createContext<AppContextValue | undefined>(undefined);
export function AppContextProvider({
  value,
  children,
}: {
  value: AppContextValue;
  children: ReactNode;
}) {
  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}
export function useApp() {
  const value = useContext(AppContext);
  if (!value) throw new Error("useApp 必须在 AppContextProvider 内使用");
  return value;
}
