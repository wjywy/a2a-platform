import { isIP } from "node:net";
import { lookup } from "node:dns/promises";
import { AppError } from "./domain.js";

function privateIpv4(hostname: string): boolean {
  const parts = hostname.split(".").map(Number);
  if (parts.length !== 4 || parts.some((value) => !Number.isInteger(value)))
    return false;
  const [first, second] = parts;
  return (
    first === 10 ||
    first === 127 ||
    (first === 100 && second >= 64 && second <= 127) ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168) ||
    (first === 192 && second === 0) ||
    (first === 198 && (second === 18 || second === 19)) ||
    first >= 224 ||
    first === 0
  );
}

export function isPrivateAddress(raw: string): boolean {
  const address = raw.replace(/^\[|\]$/g, "").toLowerCase();
  if (privateIpv4(address)) return true;
  if (isIP(address) !== 6) return false;
  return (
    address === "::" ||
    address === "::1" ||
    address.startsWith("::ffff:") ||
    address.startsWith("fc") ||
    address.startsWith("fd") ||
    address.startsWith("fe8") ||
    address.startsWith("fe9") ||
    address.startsWith("fea") ||
    address.startsWith("feb")
  );
}

export async function assertSafeOutboundUrl(
  raw: string,
  options: { allowPrivate?: boolean; purpose: "agent_card" | "webhook" },
): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new AppError(400, "OUTBOUND_URL_INVALID", "目标 URL 格式无效。");
  }
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new AppError(
      400,
      "OUTBOUND_PROTOCOL_DENIED",
      "目标 URL 仅支持 HTTP 或 HTTPS。",
    );
  }
  if (url.username || url.password) {
    throw new AppError(
      400,
      "OUTBOUND_CREDENTIALS_DENIED",
      "目标 URL 不能包含用户名或密码。",
    );
  }
  if (options.allowPrivate) return url;
  const hostname = url.hostname.toLowerCase();
  const privateHost =
    hostname === "localhost" ||
    hostname === "host.docker.internal" ||
    hostname.endsWith(".localhost") ||
    isPrivateAddress(hostname);
  if (privateHost) {
    throw new AppError(
      400,
      "OUTBOUND_PRIVATE_ADDRESS_DENIED",
      `${options.purpose === "webhook" ? "Webhook" : "Agent Card"} 不允许访问内网或本机地址。`,
    );
  }
  try {
    const addresses = await lookup(hostname, { all: true, verbatim: true });
    if (addresses.some(({ address }) => isPrivateAddress(address))) {
      throw new AppError(
        400,
        "OUTBOUND_DNS_PRIVATE_ADDRESS_DENIED",
        "目标域名解析到了内网地址。",
      );
    }
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(422, "OUTBOUND_DNS_FAILED", "无法解析目标域名。", {
      hostname,
    });
  }
  return url;
}

export function allowPrivateOutboundTargets(): boolean {
  return (
    process.env.ALLOW_PRIVATE_OUTBOUND_TARGETS === "true" ||
    process.env.NODE_ENV !== "production"
  );
}
