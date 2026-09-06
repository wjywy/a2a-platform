import crypto from "node:crypto";
import type { SymbolAgentSlug } from "./symbol-service.js";

export type SymbolStreamEvent = Record<string, unknown>;

type Listener = (event: SymbolStreamEvent) => void;

export type ActiveSymbolStream = {
  key: string;
  controller: AbortController;
  events: SymbolStreamEvent[];
  listeners: Set<Listener>;
  completion: Promise<void>;
  taskId?: string;
  contextId?: string;
  text: string;
  sequence: number;
  done: boolean;
  complete: () => void;
};

const activeStreams = new Map<string, ActiveSymbolStream>();
const STREAM_REPLAY_TTL_MS = 5 * 60_000;

export function symbolStreamKey(
  tenantId: string,
  slug: SymbolAgentSlug,
  taskId: string,
) {
  return `${tenantId}:${slug}:${taskId}`;
}

export function createSymbolStream(input: {
  tenantId: string;
  slug: SymbolAgentSlug;
  taskId?: string;
}) {
  const key = input.taskId
    ? symbolStreamKey(input.tenantId, input.slug, input.taskId)
    : `${input.tenantId}:${input.slug}:pending:${crypto.randomUUID()}`;
  const stream = {} as ActiveSymbolStream;
  let resolveCompletion!: () => void;
  stream.key = key;
  stream.controller = new AbortController();
  stream.events = [];
  stream.listeners = new Set();
  stream.completion = new Promise<void>((resolve) => {
    resolveCompletion = resolve;
  });
  stream.complete = () => {
    if (stream.done) return;
    stream.done = true;
    resolveCompletion();
    if (stream.taskId) {
      const replayKey = symbolStreamKey(
        input.tenantId,
        input.slug,
        stream.taskId,
      );
      const timer = setTimeout(() => {
        if (activeStreams.get(replayKey) === stream) activeStreams.delete(replayKey);
      }, STREAM_REPLAY_TTL_MS);
      timer.unref();
    }
  };
  stream.text = "";
  stream.sequence = 0;
  stream.done = false;
  if (input.taskId) activeStreams.set(key, stream);
  return stream;
}

export function bindSymbolStream(
  stream: ActiveSymbolStream,
  tenantId: string,
  slug: SymbolAgentSlug,
  taskId: string,
  contextId: string,
) {
  stream.taskId = taskId;
  stream.contextId = contextId;
  const key = symbolStreamKey(tenantId, slug, taskId);
  stream.key = key;
  activeStreams.set(key, stream);
}

export function findSymbolStream(
  tenantId: string,
  slug: SymbolAgentSlug,
  taskId: string,
) {
  return activeStreams.get(symbolStreamKey(tenantId, slug, taskId));
}

export function appendSymbolStreamEvent(
  stream: ActiveSymbolStream,
  event: SymbolStreamEvent,
) {
  stream.events.push(event);
  for (const listener of stream.listeners) {
    try {
      listener(event);
    } catch {
      // A disconnected socket must never abort the background Agent run.
    }
  }
}

export function appendSymbolStreamText(
  stream: ActiveSymbolStream,
  delta: string,
) {
  stream.text += delta;
  stream.sequence += 1;
  return { text: stream.text, sequence: stream.sequence };
}

export function subscribeSymbolStream(
  stream: ActiveSymbolStream,
  listener: Listener,
) {
  stream.listeners.add(listener);
  for (const event of stream.events) listener(event);
  return () => stream.listeners.delete(listener);
}

export function abortSymbolStream(
  tenantId: string,
  slug: SymbolAgentSlug,
  taskId: string,
) {
  const stream = findSymbolStream(tenantId, slug, taskId);
  stream?.controller.abort();
  return Boolean(stream);
}

export const __symbolStreamInternals = {
  activeStreams,
  STREAM_REPLAY_TTL_MS,
};
