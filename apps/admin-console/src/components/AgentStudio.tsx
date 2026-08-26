import { StudioProvider } from "./studio/StudioContext";
import { StudioWorkspace } from "./studio/StudioWorkspace";
import { useAgentStudio } from "./studio/useAgentStudio";

/**
 * The public Studio entry point intentionally stays small. Business state and
 * the real A2A streaming transport live in useAgentStudio; visual regions read
 * that controller through StudioProvider so history, transcript, Composer and
 * contextual drawers can evolve without duplicating network or persistence
 * state.
 */
export function AgentStudio({
  onExitStudio,
}: {
  onExitStudio?: () => void;
}) {
  const controller = useAgentStudio();

  return (
    <StudioProvider controller={controller}>
      <StudioWorkspace onExitStudio={onExitStudio} />
    </StudioProvider>
  );
}
