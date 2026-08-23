import crypto from "node:crypto";
import { z } from "zod";
import { config } from "./config.js";
import { AppError } from "./domain.js";

export const upstreamCredentialSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("none") }),
  z.object({ type: z.literal("bearer"), token: z.string().min(1).max(8192) }),
  z.object({
    type: z.literal("api_key"),
    headerName: z
      .string()
      .regex(/^[A-Za-z0-9-]{1,64}$/)
      .refine(
        (value) =>
          !["host", "content-length", "connection"].includes(
            value.toLowerCase(),
          ),
      ),
    value: z.string().min(1).max(8192),
  }),
  z.object({
    type: z.literal("headers"),
    headers: z
      .record(z.string().max(8192))
      .refine(
        (headers) =>
          Object.keys(headers).length <= 20 &&
          Object.keys(headers).every(
            (key) =>
              /^[A-Za-z0-9-]{1,64}$/.test(key) &&
              ![
                "host",
                "content-length",
                "connection",
                "transfer-encoding",
              ].includes(key.toLowerCase()),
          ),
        "上游 Header 名称或数量无效。",
      ),
  }),
]);

export type UpstreamCredential = z.infer<typeof upstreamCredentialSchema>;
export type EncryptedCredential = {
  ciphertext: string;
  iv: string;
  tag: string;
  keyVersion: string;
};

function encryptionKey(version = config.credentialKeyVersion): Buffer {
  let material = config.credentialEncryptionKey;
  if (version !== config.credentialKeyVersion) {
    let previous: Record<string, string>;
    try {
      previous = JSON.parse(config.credentialPreviousKeys) as Record<
        string,
        string
      >;
    } catch {
      throw new AppError(
        500,
        "SECRET_KEYRING_INVALID",
        "历史凭据密钥配置不是有效 JSON。",
      );
    }
    material = previous[version];
    if (!material)
      throw new AppError(
        500,
        "SECRET_KEY_UNAVAILABLE",
        `缺少密钥版本 ${version}。`,
      );
  }
  if (
    process.env.NODE_ENV === "production" &&
    material.startsWith("local-development-")
  ) {
    throw new Error(
      "CREDENTIAL_ENCRYPTION_KEY must be configured in production",
    );
  }
  return crypto.createHash("sha256").update(material).digest();
}

export function encryptSecret(
  plaintext: string,
  purpose: string,
): EncryptedCredential {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey(), iv);
  cipher.setAAD(
    Buffer.from(`a2a-secret:${purpose}:${config.credentialKeyVersion}`),
  );
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  return {
    ciphertext: ciphertext.toString("base64"),
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    keyVersion: config.credentialKeyVersion,
  };
}

export function decryptSecret(
  encrypted: EncryptedCredential,
  purpose: string,
): string {
  try {
    const decipher = crypto.createDecipheriv(
      "aes-256-gcm",
      encryptionKey(encrypted.keyVersion),
      Buffer.from(encrypted.iv, "base64"),
    );
    decipher.setAAD(
      Buffer.from(`a2a-secret:${purpose}:${encrypted.keyVersion}`),
    );
    decipher.setAuthTag(Buffer.from(encrypted.tag, "base64"));
    return Buffer.concat([
      decipher.update(Buffer.from(encrypted.ciphertext, "base64")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    throw new AppError(500, "SECRET_DECRYPT_FAILED", "无法解密通知签名密钥。");
  }
}

export function encryptCredential(
  raw: unknown,
): EncryptedCredential | undefined {
  const value = upstreamCredentialSchema.parse(raw ?? { type: "none" });
  if (value.type === "none") return undefined;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey(), iv);
  cipher.setAAD(Buffer.from(`a2a-upstream:${config.credentialKeyVersion}`));
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(value), "utf8"),
    cipher.final(),
  ]);
  return {
    ciphertext: ciphertext.toString("base64"),
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    keyVersion: config.credentialKeyVersion,
  };
}

export function decryptCredential(
  value:
    | {
        credentialCiphertext?: string | null;
        credentialIv?: string | null;
        credentialTag?: string | null;
        credentialKeyVersion?: string | null;
      }
    | undefined,
): UpstreamCredential {
  if (!value?.credentialCiphertext) return { type: "none" };
  if (
    !value.credentialIv ||
    !value.credentialTag ||
    !value.credentialKeyVersion
  )
    throw new AppError(
      500,
      "UPSTREAM_CREDENTIAL_CORRUPT",
      "上游凭据数据不完整。",
    );
  try {
    const decipher = crypto.createDecipheriv(
      "aes-256-gcm",
      encryptionKey(value.credentialKeyVersion),
      Buffer.from(value.credentialIv, "base64"),
    );
    decipher.setAAD(Buffer.from(`a2a-upstream:${value.credentialKeyVersion}`));
    decipher.setAuthTag(Buffer.from(value.credentialTag, "base64"));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(value.credentialCiphertext, "base64")),
      decipher.final(),
    ]).toString("utf8");
    return upstreamCredentialSchema.parse(JSON.parse(plaintext));
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(
      500,
      "UPSTREAM_CREDENTIAL_DECRYPT_FAILED",
      "无法解密上游凭据。",
    );
  }
}

export function credentialHeaders(
  value: UpstreamCredential,
): Record<string, string> {
  if (value.type === "none") return {};
  if (value.type === "bearer")
    return { Authorization: `Bearer ${value.token}` };
  if (value.type === "api_key") return { [value.headerName]: value.value };
  return { ...value.headers };
}

export function credentialSummary(value: UpstreamCredential): {
  type: UpstreamCredential["type"];
  configured: boolean;
} {
  return { type: value.type, configured: value.type !== "none" };
}
