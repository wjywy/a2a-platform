import { Pool, type PoolClient } from "pg";
import { config } from "./config.js";

export const pool = new Pool({ connectionString: config.postgresUrl });

export async function query<
  T extends Record<string, unknown> = Record<string, unknown>,
>(text: string, values: unknown[] = []): Promise<T[]> {
  const result = await pool.query<T>(text, values);
  return result.rows;
}

/**
 * Keeps multi-table domain changes on one client. Services must not compose
 * `pool.query` calls inside a transaction because pooled calls may land on
 * different PostgreSQL connections.
 */
export async function transaction<T>(
  operation: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await operation(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
