import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { pool } from "./db.js";
import { encryptSecret } from "./credential-service.js";

const migrationsDir = fileURLToPath(new URL("../migrations/", import.meta.url));

async function encryptLegacyWebhookSecrets(
  migrationClient: import("pg").PoolClient,
) {
  const legacySecrets = await migrationClient.query<{
    id: string;
    signing_secret: string;
  }>(
    "SELECT id,signing_secret FROM webhook_endpoints WHERE signing_secret IS NOT NULL",
  );
  for (const row of legacySecrets.rows) {
    const encrypted = encryptSecret(row.signing_secret, `webhook:${row.id}`);
    await migrationClient.query(
      `UPDATE webhook_endpoints SET signing_secret=NULL,secret_ciphertext=$2,secret_iv=$3,
       secret_tag=$4,secret_key_version=$5 WHERE id=$1`,
      [
        row.id,
        encrypted.ciphertext,
        encrypted.iv,
        encrypted.tag,
        encrypted.keyVersion,
      ],
    );
  }
}

async function run() {
  const migrationClient = await pool.connect();
  try {
    await migrationClient.query(
      "SELECT pg_advisory_lock(hashtext('a2a-platform-schema-migrations'))",
    );
    await migrationClient.query(
      "CREATE TABLE IF NOT EXISTS schema_migrations (id text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())",
    );
    const files = (await readdir(migrationsDir))
      .filter((file) => file.endsWith(".sql"))
      .sort();
    for (const file of files) {
      const exists = await migrationClient.query(
        "SELECT 1 FROM schema_migrations WHERE id = $1",
        [file],
      );
      if (exists.rowCount) continue;
      if (file === "012_reliability_guards.sql")
        await encryptLegacyWebhookSecrets(migrationClient);
      const sql = await readFile(join(migrationsDir, file), "utf8");
      try {
        await migrationClient.query("BEGIN");
        await migrationClient.query(sql);
        await migrationClient.query(
          "INSERT INTO schema_migrations(id) VALUES ($1)",
          [file],
        );
        await migrationClient.query("COMMIT");
        console.log(`Applied migration ${file}`);
      } catch (error) {
        await migrationClient.query("ROLLBACK");
        throw error;
      }
    }
  } finally {
    try {
      await migrationClient.query(
        "SELECT pg_advisory_unlock(hashtext('a2a-platform-schema-migrations'))",
      );
    } finally {
      migrationClient.release();
    }
  }
  await pool.end();
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
