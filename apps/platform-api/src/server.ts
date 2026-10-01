import { createApp } from "./app.js";
import { config } from "./config.js";
import { pool } from "./db.js";
import { ensureSymbolBuiltinAgents } from "./symbol-bootstrap.js";
import { ensureChannelCompassAgent } from "./channel-compass-bootstrap.js";

const app = createApp();
let server: ReturnType<typeof app.listen>;

async function start() {
  await ensureSymbolBuiltinAgents();
  await ensureChannelCompassAgent();
  server = app.listen(config.port, () =>
    console.log(`A2A platform API listening on :${config.port}`),
  );
}
void start().catch((error) => {
  console.error("Failed to register built-in agents:", error);
  process.exit(1);
});

async function shutdown(signal: string) {
  console.log(`Received ${signal}, shutting down gracefully.`);
  server?.close(async () => {
    await pool.end();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
