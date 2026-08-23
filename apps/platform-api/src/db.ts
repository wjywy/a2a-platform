import { Pool } from "pg";
import { config } from "./config.js";

export const pool = new Pool({ connectionString: config.postgresUrl });

export async function query<
  T extends Record<string, unknown> = Record<string, unknown>,
>(text: string, values: unknown[] = []): Promise<T[]> {
  const result = await pool.query<T>(text, values);
  return result.rows;
}
