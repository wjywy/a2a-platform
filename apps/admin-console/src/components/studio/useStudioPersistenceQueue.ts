import { useCallback, useEffect, useMemo, useState } from "react";
import type { StudioMessage } from "../../api";

const STORAGE_KEY = "a2a-studio:pending-persistence:v1";
const MAX_OPERATIONS = 40;
const MAX_ATTEMPTS = 8;

export type PendingStudioOperation = {
  id: string;
  type: "append-message";
  tenantId: string;
  conversationId: string;
  payload: {
    tenantId: string;
    role: "user" | "assistant" | "system";
    content: string;
    status?: StudioMessage["status"];
    taskId?: string;
    errorCode?: string;
    metadata?: Record<string, unknown>;
    clientRequestId?: string;
  };
  attempts: number;
  createdAt: number;
  lastError?: string;
};

function readQueue(): PendingStudioOperation[] {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((value): value is PendingStudioOperation =>
      Boolean(
        value &&
        typeof value === "object" &&
        (value as PendingStudioOperation).type === "append-message" &&
        typeof (value as PendingStudioOperation).conversationId === "string" &&
        typeof (value as PendingStudioOperation).tenantId === "string" &&
        typeof (value as PendingStudioOperation).payload?.content === "string",
      ),
    );
  } catch {
    return [];
  }
}

function saveQueue(queue: PendingStudioOperation[]) {
  try {
    if (queue.length)
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(queue));
    else sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // Persistence retry is best effort; messages still remain in the live UI.
  }
}

function normalizeError(error: unknown) {
  return error instanceof Error
    ? error.message.slice(0, 240)
    : "持久化请求失败";
}

/**
 * Buffers only non-secret message persistence operations. It bridges a browser
 * network interruption after an A2A stream has completed, without replaying the
 * remote agent request itself (which could produce duplicate side effects).
 */
export function useStudioPersistenceQueue(
  deliver: (operation: PendingStudioOperation) => Promise<void>,
) {
  const [queue, setQueue] = useState<PendingStudioOperation[]>(readQueue);
  const [flushing, setFlushing] = useState(false);

  const replace = useCallback((next: PendingStudioOperation[]) => {
    const bounded = next.slice(-MAX_OPERATIONS);
    saveQueue(bounded);
    setQueue(bounded);
  }, []);

  const enqueue = useCallback(
    (
      operation: Omit<
        PendingStudioOperation,
        "id" | "attempts" | "createdAt" | "lastError"
      >,
    ) => {
      const next: PendingStudioOperation = {
        ...operation,
        id: crypto.randomUUID(),
        attempts: 0,
        createdAt: Date.now(),
      };
      setQueue((current) => {
        // Same idempotency key describes the same user/assistant write.
        const duplicate = current.some(
          (item) =>
            item.conversationId === next.conversationId &&
            item.payload.clientRequestId &&
            item.payload.clientRequestId === next.payload.clientRequestId,
        );
        const updated = duplicate
          ? current
          : [...current, next].slice(-MAX_OPERATIONS);
        saveQueue(updated);
        return updated;
      });
      return next.id;
    },
    [],
  );

  const discard = useCallback(
    (id: string) =>
      setQueue((current) => {
        const next = current.filter((item) => item.id !== id);
        saveQueue(next);
        return next;
      }),
    [],
  );

  const flush = useCallback(async () => {
    if (flushing) return;
    setFlushing(true);
    const initial = readQueue();
    const remaining: PendingStudioOperation[] = [];
    for (const operation of initial) {
      try {
        await deliver(operation);
      } catch (error) {
        const retried = {
          ...operation,
          attempts: operation.attempts + 1,
          lastError: normalizeError(error),
        };
        if (retried.attempts < MAX_ATTEMPTS) remaining.push(retried);
      }
    }
    replace(remaining);
    setFlushing(false);
  }, [deliver, flushing, replace]);

  useEffect(() => {
    const onOnline = () => void flush();
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, [flush]);

  useEffect(() => {
    if (queue.length && navigator.onLine) void flush();
  }, [flush, queue.length]);

  return useMemo(
    () => ({
      pending: queue,
      pendingCount: queue.length,
      flushing,
      enqueue,
      discard,
      flush,
    }),
    [discard, enqueue, flush, flushing, queue],
  );
}

export const __studioPersistenceQueueInternals = {
  readQueue,
  saveQueue,
  normalizeError,
  STORAGE_KEY,
};
