import pg from "pg";
import { config } from "./config.js";

const { Pool } = pg;

export const pool = new Pool({
  connectionString: config.databaseUrl,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 3_000,
});

export async function databaseHealthy(): Promise<boolean> {
  try {
    await pool.query("SELECT 1");
    return true;
  } catch {
    return false;
  }
}

export async function audit(
  action: string,
  actorUserId: string | null,
  details: Record<string, unknown>,
  ipAddress?: string,
): Promise<void> {
  await pool.query(
    `INSERT INTO audit_events (actor_user_id, action, details, ip_address)
     VALUES ($1, $2, $3::jsonb, $4)`,
    [actorUserId, action, JSON.stringify(details), ipAddress ?? null],
  );
}
