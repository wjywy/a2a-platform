import { useEffect, type RefObject } from "react";
import type { AgentStudioController } from "./useAgentStudio";

function isEditableTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  return Boolean(
    target.closest(
      'input, textarea, select, [contenteditable="true"], [role="textbox"]',
    ),
  );
}

/**
 * Global Studio commands remain intentionally small and discoverable. They
 * are implemented at workspace scope so message inputs and nested drawers do
 * not register competing listeners.
 */
export function useStudioKeyboardShortcuts(studio: AgentStudioController) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const commandKey = event.ctrlKey || event.metaKey;

      if (commandKey && event.shiftKey && event.key.toLowerCase() === "n") {
        event.preventDefault();
        if (!studio.stream.busy) studio.actions.startNewConversation();
        return;
      }

      if (commandKey && event.key === "/") {
        event.preventDefault();
        if (!studio.stream.busy) studio.panels.setSettingsOpen(true);
        return;
      }

      if (commandKey && event.shiftKey && event.key.toLowerCase() === "o") {
        event.preventDefault();
        studio.draft.ref.current?.focus();
        return;
      }

      if (event.key !== "Escape") return;

      if (studio.stream.busy) {
        event.preventDefault();
        void studio.actions.stopGeneration();
        return;
      }

      if (studio.panels.conversationMenuOpen) {
        event.preventDefault();
        studio.panels.setConversationMenuOpen(false);
      } else if (studio.panels.labelManagerOpen) {
        event.preventDefault();
        studio.panels.setLabelManagerOpen(false);
      } else if (studio.panels.traceOpen) {
        event.preventDefault();
        studio.panels.setTraceOpen(false);
      } else if (studio.panels.settingsOpen) {
        event.preventDefault();
        studio.panels.setSettingsOpen(false);
      } else if (studio.panels.historyOpen) {
        event.preventDefault();
        studio.panels.setHistoryOpen(false);
      } else if (!isEditableTarget(event.target)) {
        studio.draft.ref.current?.focus();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [studio]);
}

/**
 * visualViewport is the only reliable signal for a software keyboard that
 * reduces the usable mobile viewport without changing the layout viewport.
 * CSS consumes these custom properties to keep the Composer above the
 * keyboard and to prevent the transcript from being obscured.
 */
export function useStudioVisualViewport(
  workspaceRef: RefObject<HTMLDivElement | null>,
) {
  useEffect(() => {
    const workspace = workspaceRef.current;
    const viewport = window.visualViewport;
    if (!workspace || !viewport) return;

    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const visualHeight = Math.max(320, Math.round(viewport.height));
        const visualTop = Math.max(0, Math.round(viewport.offsetTop));
        const keyboardInset = Math.max(
          0,
          Math.round(window.innerHeight - viewport.height - viewport.offsetTop),
        );

        workspace.style.setProperty(
          "--studio-visual-height",
          `${visualHeight}px`,
        );
        workspace.style.setProperty(
          "--studio-visual-top",
          `${visualTop}px`,
        );
        workspace.style.setProperty(
          "--studio-keyboard-inset",
          `${keyboardInset}px`,
        );
        workspace.dataset.keyboardOpen = keyboardInset > 120 ? "true" : "false";
      });
    };

    update();
    viewport.addEventListener("resize", update);
    viewport.addEventListener("scroll", update);
    window.addEventListener("orientationchange", update);

    return () => {
      cancelAnimationFrame(frame);
      viewport.removeEventListener("resize", update);
      viewport.removeEventListener("scroll", update);
      window.removeEventListener("orientationchange", update);
      workspace.style.removeProperty("--studio-visual-height");
      workspace.style.removeProperty("--studio-visual-top");
      workspace.style.removeProperty("--studio-keyboard-inset");
      delete workspace.dataset.keyboardOpen;
    };
  }, [workspaceRef]);
}

/** Studio owns the viewport while mounted, then restores the host page. */
export function useStudioScrollLock() {
  useEffect(() => {
    const previousBodyOverflow = document.body.style.overflow;
    const previousHtmlOverflow = document.documentElement.style.overflow;
    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = previousBodyOverflow;
      document.documentElement.style.overflow = previousHtmlOverflow;
    };
  }, []);
}
