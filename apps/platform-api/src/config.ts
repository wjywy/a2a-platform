export const config = {
  port: Number(process.env.PORT ?? 3000),
  postgresUrl:
    process.env.POSTGRES_URL ??
    "postgres://platform:platform@localhost:5432/a2a_platform",
  redisUrl: process.env.REDIS_URL ?? "redis://localhost:6379",
  platformOrigin: (
    process.env.PLATFORM_ORIGIN ?? "http://localhost:8080"
  ).replace(/\/$/, ""),
  corsOrigins: (
    process.env.CONSOLE_ORIGINS ??
    "http://localhost:5173,http://127.0.0.1:5173,http://localhost:8080,http://127.0.0.1:8080"
  )
    .split(",")
    .map((value) => value.trim().replace(/\/$/, ""))
    .filter(Boolean),
  devToken:
    process.env.PLATFORM_DEV_TOKEN ??
    (process.env.NODE_ENV === "production" ? "" : "dev-admin-token"),
  jwtSecret:
    process.env.PLATFORM_JWT_SECRET ??
    "change-me-in-production-at-least-32-characters",
  jwtIssuer: process.env.PLATFORM_JWT_ISSUER ?? "a2a-agent-platform",
  accessTokenSeconds: Number(process.env.ACCESS_TOKEN_SECONDS ?? 900),
  refreshTokenDays: Number(process.env.REFRESH_TOKEN_DAYS ?? 30),
  consoleOrigin: (
    process.env.CONSOLE_PUBLIC_ORIGIN ?? "http://localhost:5173"
  ).replace(/\/$/, ""),
  localLoginEnabled:
    process.env.LOCAL_LOGIN_ENABLED === "true" ||
    process.env.NODE_ENV !== "production",
  selfRegistrationEnabled:
    process.env.SELF_REGISTRATION_ENABLED === "true" ||
    process.env.NODE_ENV !== "production",
  oidcIssuer: process.env.OIDC_ISSUER?.replace(/\/$/, "") ?? "",
  oidcClientId: process.env.OIDC_CLIENT_ID ?? "",
  oidcClientSecret: process.env.OIDC_CLIENT_SECRET ?? "",
  oidcRedirectUri:
    process.env.OIDC_REDIRECT_URI ??
    "http://localhost:8080/api/auth/oidc/callback",
  credentialEncryptionKey:
    process.env.CREDENTIAL_ENCRYPTION_KEY ??
    "local-development-credential-key-change-before-deploy",
  credentialKeyVersion: process.env.CREDENTIAL_KEY_VERSION ?? "v1",
  credentialPreviousKeys: process.env.CREDENTIAL_PREVIOUS_KEYS ?? "{}",
  smtpUrl: process.env.SMTP_URL ?? "",
  publicCatalogEnabled: process.env.PUBLIC_AGENT_CATALOG !== "false",
  healthIntervalMs: Number(process.env.HEALTH_CHECK_INTERVAL_MS ?? 30_000),
  rateLimitPerMinute: Number(process.env.RATE_LIMIT_PER_MINUTE ?? 120),
  maxA2AResponseBytes: Number(process.env.MAX_A2A_RESPONSE_BYTES ?? 16_777_216),
  maxA2AEventBytes: Number(process.env.MAX_A2A_EVENT_BYTES ?? 1_048_576),
  maxA2AStreamEvents: Number(process.env.MAX_A2A_STREAM_EVENTS ?? 10_000),
  maxA2ACallDurationMs: Number(process.env.MAX_A2A_CALL_DURATION_MS ?? 300_000),
  /**
   * A tenant-scoped platform key held only by the API process.  Agent Studio
   * uses it through an authenticated server-side proxy, never through the
   * browser bundle.
   */
  studioApiKey: process.env.STUDIO_API_KEY ?? "",
  /**
   * Internal credential used only when the platform calls its bundled agents.
   * A deterministic development-only value keeps a fresh local compose
   * database bootstrappable; production must provide an explicit secret.
   */
  symbolInternalToken:
    process.env.SYMBOL_INTERNAL_TOKEN ||
    (process.env.NODE_ENV === "production" ? "" : "local-symbol-internal-token"),
  // In Docker development this is http://api:3000, avoiding a host-network hairpin.
  // Production may leave it equal to PLATFORM_ORIGIN.
  symbolInternalOrigin: (process.env.SYMBOL_INTERNAL_ORIGIN || process.env.PLATFORM_ORIGIN || "http://localhost:8080").replace(/\/$/, ""),
  channelCompassInternalToken:
    process.env.CHANNEL_COMPASS_INTERNAL_TOKEN ||
    process.env.SYMBOL_INTERNAL_TOKEN ||
    (process.env.NODE_ENV === "production"
      ? ""
      : "local-channel-compass-internal-token"),
  channelCompassInternalOrigin: (
    process.env.CHANNEL_COMPASS_INTERNAL_ORIGIN ||
    process.env.SYMBOL_INTERNAL_ORIGIN ||
    process.env.PLATFORM_ORIGIN ||
    "http://localhost:8080"
  ).replace(/\/$/, ""),
  channelDataApiBaseUrl: (process.env.CHANNEL_DATA_API_BASE_URL ?? "").replace(
    /\/$/,
    "",
  ),
  channelDataApiToken: process.env.CHANNEL_DATA_API_TOKEN ?? "",
  channelDataApiTimeoutMs: Number(
    process.env.CHANNEL_DATA_API_TIMEOUT_MS ?? 15_000,
  ),
  channelChartSigningSecret:
    process.env.CHANNEL_CHART_SIGNING_SECRET ||
    process.env.PLATFORM_JWT_SECRET ||
    "local-channel-chart-signing-secret",
  channelChartTtlSeconds: Number(
    process.env.CHANNEL_CHART_TTL_SECONDS ?? 604_800,
  ),
  deepseekApiKey: process.env.DEEPSEEK_API_KEY ?? "",
  deepseekModel: process.env.DEEPSEEK_MODEL ?? "deepseek-chat",
  finnhubApiKey: process.env.FINNHUB_API_KEY ?? "",
  longbridgeEnabled: process.env.LONGBRIDGE_ENABLED !== "false",
  longbridgeRegion: process.env.LONGBRIDGE_REGION ?? "",
  longbridgeHttpUrl:
    process.env.LONGBRIDGE_HTTP_URL ?? "https://openapi.longbridge.com",
  longbridgeAppKey: process.env.LONGBRIDGE_APP_KEY ?? "",
  longbridgeAppSecret: process.env.LONGBRIDGE_APP_SECRET ?? "",
  longbridgeAccessToken: process.env.LONGBRIDGE_ACCESS_TOKEN ?? "",
  longbridgeClientId: process.env.LONGBRIDGE_CLIENT_ID ?? "",
  longbridgeOAuthToken: process.env.LONGBRIDGE_OAUTH_TOKEN ?? "",
  longbridgeTimeoutMs: Number(process.env.LONGBRIDGE_TIMEOUT_MS ?? 12_000),
  longbridgeMaxConcurrent: Number(
    process.env.LONGBRIDGE_MAX_CONCURRENT ?? 4,
  ),
  longbridgeMaxOptionContracts: Number(
    process.env.LONGBRIDGE_MAX_OPTION_CONTRACTS ?? 500,
  ),
  memoryMaxEntries: Number(process.env.MEMORY_MAX_ENTRIES ?? 40),
  memoryMaxContextChars: Number(process.env.MEMORY_MAX_CONTEXT_CHARS ?? 12_000),
};
