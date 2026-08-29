import { lookup } from "node:dns";
import type { LookupFunction } from "node:net";
import { Agent, fetch as undiciFetch } from "undici";
import { allowPrivateOutboundTargets, isPrivateAddress } from "./url-policy.js";

function safeLookup(allowPrivate: boolean): LookupFunction {
  return ((
    hostname: string,
    options: Record<string, unknown>,
    callback: (...args: unknown[]) => void,
  ) => {
    lookup(
      hostname,
      {
        all: true,
        verbatim: true,
        family: typeof options.family === "number" ? options.family : 0,
        hints: typeof options.hints === "number" ? options.hints : 0,
      },
      (error, addresses) => {
        if (error) {
          callback(error);
          return;
        }
        const allowed = allowPrivate
          ? addresses
          : addresses.filter((item) => !isPrivateAddress(item.address));
        if (!allowed.length) {
          callback(
            Object.assign(new Error("目标域名只解析到禁止访问的私网地址。"), {
              code: "EACCES",
            }),
          );
          return;
        }
        if (options.all) callback(null, allowed);
        else callback(null, allowed[0].address, allowed[0].family);
      },
    );
  }) as LookupFunction;
}

// The actual socket connector validates and pins the address returned by DNS,
// so a second DNS answer cannot race a separate preflight check.
const publicDispatcher = new Agent({ connect: { lookup: safeLookup(false) } });
const privateDispatcher = new Agent({ connect: { lookup: safeLookup(true) } });

/**
 * Fetch through a DNS-pinning dispatcher. Private addresses require an
 * explicit allow-list decision by the caller after URL validation.
 */
export async function secureFetchWithPolicy(
  input: Parameters<typeof fetch>[0],
  init?: Parameters<typeof fetch>[1],
  options: { allowPrivate?: boolean } = {},
): Promise<Response> {
  const allowPrivate = options.allowPrivate ?? allowPrivateOutboundTargets();
  return (await undiciFetch(input as string | URL, {
    ...init,
    dispatcher: allowPrivate ? privateDispatcher : publicDispatcher,
  } as unknown as Parameters<typeof undiciFetch>[1])) as unknown as Response;
}

export const secureFetch: typeof fetch = (input, init) =>
  secureFetchWithPolicy(input, init);

export function createLimitedFetch(maxBytes: number): typeof fetch {
  return (async (input, init) => {
    const response = await secureFetch(input, init);
    if (!response.body) return response;
    let received = 0;
    const limited = response.body.pipeThrough(
      new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, controller) {
          received += chunk.byteLength;
          if (received > maxBytes) {
            controller.error(
              new Error(`A2A 响应超过 ${maxBytes} 字节平台上限。`),
            );
            return;
          }
          controller.enqueue(chunk);
        },
      }),
    );
    return new Response(limited, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  }) as typeof fetch;
}

export async function readLimitedResponseText(
  response: Response,
  maxBytes: number,
  rejectOnOverflow = true,
): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const chunks: string[] = [];
  let received = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > maxBytes) {
      await reader.cancel();
      if (rejectOnOverflow)
        throw new Error(`响应内容超过 ${maxBytes} 字节限制。`);
      const accepted = value.subarray(
        0,
        Math.max(0, value.byteLength - (received - maxBytes)),
      );
      chunks.push(decoder.decode(accepted, { stream: true }));
      break;
    }
    chunks.push(decoder.decode(value, { stream: true }));
  }
  chunks.push(decoder.decode());
  return chunks.join("");
}
