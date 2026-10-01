import { useRef, useState } from "react";
import { StudioComposer } from "./StudioComposer";
import { useStudio } from "./StudioContext";
import { StudioHeader } from "./StudioHeader";
import { StudioHistory } from "./StudioHistory";
import { StudioPanels } from "./StudioPanels";
import { StudioTranscript } from "./StudioTranscript";
import {
  useStudioKeyboardShortcuts,
  useStudioScrollLock,
  useStudioVisualViewport,
} from "./useStudioWorkspaceEffects";
import styles from "./AgentStudio.module.css";

export function StudioWorkspace({
  onExitStudio,
}: {
  onExitStudio?: () => void;
}) {
  const studio = useStudio();
  const workspaceRef = useRef<HTMLDivElement>(null);
  const [historyCollapsed, setHistoryCollapsed] = useState(false);
  useStudioKeyboardShortcuts(studio);
  useStudioVisualViewport(workspaceRef);
  useStudioScrollLock();

  return (
    <div
      ref={workspaceRef}
      className={`${styles.studioWorkspace} ${
        historyCollapsed ? styles.studioWorkspaceHistoryCollapsed : ""
      }`}
      data-testid="studio-workspace"
    >
      <StudioHistory
        collapsed={historyCollapsed}
        onCollapsedChange={setHistoryCollapsed}
      />
      <main className={styles.conversationWorkspace}>
        <StudioHeader onExitStudio={onExitStudio} />
        <section className={styles.conversationSurface} aria-label="Agent 对话">
          <StudioTranscript />
          <StudioComposer />
        </section>
      </main>
      <StudioPanels />
    </div>
  );
}
