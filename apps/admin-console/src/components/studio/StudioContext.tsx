import { createContext, useContext, type ReactNode } from "react";
import type { AgentStudioController } from "./useAgentStudio";

const StudioContext = createContext<AgentStudioController | undefined>(
  undefined,
);

export function StudioProvider({
  controller,
  children,
}: {
  controller: AgentStudioController;
  children: ReactNode;
}) {
  return (
    <StudioContext.Provider value={controller}>
      {children}
    </StudioContext.Provider>
  );
}

export function useStudio() {
  const value = useContext(StudioContext);
  if (!value) {
    throw new Error("Studio 组件必须在 StudioProvider 内使用");
  }
  return value;
}
