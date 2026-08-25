import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const DRAFT_PREFIX = "a2a-studio:draft:v1";
const DRAFT_TTL_MS = 1000 * 60 * 60 * 24 * 14;
const WRITE_DELAY_MS = 350;

type StoredDraft = {
  value: string;
  updatedAt: number;
  source: "typing" | "suggestion" | "recovery";
};

export type StudioDraft = {
  value: string;
  restored: boolean;
  updatedAt?: number;
  setValue: (value: string, source?: StoredDraft["source"]) => void;
  clear: () => void;
  discardRestored: () => void;
};

function draftKey(tenantId: string, agentSlug: string, conversationId: string) {
  return `${DRAFT_PREFIX}:${tenantId}:${agentSlug}:${conversationId || "new"}`;
}

function readDraft(key: string): StoredDraft | undefined {
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as Partial<StoredDraft>;
    if (
      typeof parsed.value !== "string" ||
      typeof parsed.updatedAt !== "number" ||
      Date.now() - parsed.updatedAt > DRAFT_TTL_MS
    ) {
      sessionStorage.removeItem(key);
      return undefined;
    }
    return {
      value: parsed.value,
      updatedAt: parsed.updatedAt,
      source:
        parsed.source === "suggestion" || parsed.source === "recovery"
          ? parsed.source
          : "typing",
    };
  } catch {
    // Browser privacy modes can deny session storage. The composer still works.
    return undefined;
  }
}

function writeDraft(key: string, value: string, source: StoredDraft["source"]) {
  try {
    if (!value.trim()) {
      sessionStorage.removeItem(key);
      return;
    }
    sessionStorage.setItem(
      key,
      JSON.stringify({
        value,
        updatedAt: Date.now(),
        source,
      } satisfies StoredDraft),
    );
  } catch {
    // Draft recovery is progressive enhancement and must never block a message.
  }
}

/**
 * A session-scoped draft is intentionally separate from persisted conversation
 * messages: an unfinished thought must never be visible to another operator or
 * sent to the platform API. It survives refresh in the current browser tab.
 */
export function useStudioDraft(
  tenantId: string,
  agentSlug: string,
  conversationId: string,
): StudioDraft {
  const key = useMemo(
    () => draftKey(tenantId, agentSlug, conversationId),
    [tenantId, agentSlug, conversationId],
  );
  const [value, setRawValue] = useState("");
  const [restored, setRestored] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<number>();
  const source = useRef<StoredDraft["source"]>("typing");
  const lastKey = useRef(key);

  useEffect(() => {
    const draft = readDraft(key);
    lastKey.current = key;
    setRawValue(draft?.value ?? "");
    setUpdatedAt(draft?.updatedAt);
    setRestored(Boolean(draft?.value));
    source.current = draft?.source ?? "typing";
  }, [key]);

  useEffect(() => {
    if (!tenantId || !agentSlug || lastKey.current !== key) return;
    const timer = window.setTimeout(() => {
      writeDraft(key, value, source.current);
      setUpdatedAt(value.trim() ? Date.now() : undefined);
    }, WRITE_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [agentSlug, key, tenantId, value]);

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.storageArea !== sessionStorage || event.key !== key) return;
      const next = readDraft(key);
      if (!next || next.updatedAt <= (updatedAt ?? 0)) return;
      setRawValue(next.value);
      setUpdatedAt(next.updatedAt);
      setRestored(true);
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [key, updatedAt]);

  const setValue = useCallback(
    (next: string, nextSource: StoredDraft["source"] = "typing") => {
      source.current = nextSource;
      setRestored(false);
      setRawValue(next);
    },
    [],
  );
  const clear = useCallback(() => {
    try {
      sessionStorage.removeItem(key);
    } catch {
      // no-op; in-memory state still clears.
    }
    setRestored(false);
    setUpdatedAt(undefined);
    setRawValue("");
  }, [key]);
  const discardRestored = useCallback(() => setRestored(false), []);

  return { value, restored, updatedAt, setValue, clear, discardRestored };
}

export const __studioDraftInternals = {
  draftKey,
  readDraft,
  writeDraft,
  DRAFT_TTL_MS,
};
