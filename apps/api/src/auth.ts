import {
  createHash,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";
import { config } from "./config.js";
import { pool } from "./database.js";

const COOKIE_NAME = "nbvoice_session";
const SCRYPT_N = 16_384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;

export interface AuthenticatedUser {
  id: string;
  email: string;
  displayName: string;
  role: "owner" | "administrator" | "agent" | "customer_admin";
  extensionId: string | null;
  customerId: string | null;
}

export function isAdministratorRole(role: string): boolean {
  return role === "owner" || role === "administrator";
}

export function isCustomerRole(role: string): boolean {
  return role === "customer_admin";
}

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 64, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    maxmem: 64 * 1024 * 1024,
  });
  return [
    "scrypt",
    SCRYPT_N,
    SCRYPT_R,
    SCRYPT_P,
    salt.toString("base64url"),
    hash.toString("base64url"),
  ].join("$");
}

export function verifyPassword(password: string, encoded: string): boolean {
  const [algorithm, n, r, p, saltEncoded, hashEncoded] = encoded.split("$");
  if (
    algorithm !== "scrypt" ||
    !n ||
    !r ||
    !p ||
    !saltEncoded ||
    !hashEncoded
  ) {
    return false;
  }

  try {
    const expected = Buffer.from(hashEncoded, "base64url");
    const actual = scryptSync(
      password,
      Buffer.from(saltEncoded, "base64url"),
      expected.length,
      {
        N: Number.parseInt(n, 10),
        r: Number.parseInt(r, 10),
        p: Number.parseInt(p, 10),
        maxmem: 64 * 1024 * 1024,
      },
    );
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function parseCookies(header: string | undefined): Map<string, string> {
  const cookies = new Map<string, string>();
  for (const item of (header ?? "").split(";")) {
    const separator = item.indexOf("=");
    if (separator < 1) continue;
    cookies.set(
      item.slice(0, separator).trim(),
      decodeURIComponent(item.slice(separator + 1).trim()),
    );
  }
  return cookies;
}

function sessionCookie(token: string, maxAgeSeconds: number): string {
  const secure = config.secureCookie ? "; Secure" : "";
  return `${COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAgeSeconds}${secure}`;
}

export async function createSession(
  userId: string,
  reply: FastifyReply,
  request: FastifyRequest,
): Promise<void> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + config.sessionHours * 3_600_000);
  await pool.query(
    `INSERT INTO sessions (token_hash, user_id, expires_at, ip_address, user_agent)
     VALUES ($1, $2, $3, $4, $5)`,
    [
      tokenHash(token),
      userId,
      expiresAt,
      request.ip,
      request.headers["user-agent"]?.slice(0, 500) ?? null,
    ],
  );
  reply.header("set-cookie", sessionCookie(token, config.sessionHours * 3_600));
}

export async function currentUser(
  request: FastifyRequest,
): Promise<AuthenticatedUser | null> {
  const token = parseCookies(request.headers.cookie).get(COOKIE_NAME);
  if (!token) return null;

  const result = await pool.query<{
    id: string;
    email: string;
    display_name: string;
    role: "owner" | "administrator" | "agent" | "customer_admin";
    extension_id: string | null;
    customer_id: string | null;
  }>(
    `SELECT u.id, u.email, u.display_name, u.role, u.extension_id, u.customer_id
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       LEFT JOIN customers ON customers.id = u.customer_id
       LEFT JOIN customers AS parent_customer
         ON parent_customer.id = customers.parent_customer_id
      WHERE s.token_hash = $1
        AND s.expires_at > now()
        AND u.active = true
        AND (
          u.role <> 'customer_admin'
          OR (
            customers.active = true
            AND (parent_customer.id IS NULL OR parent_customer.active = true)
          )
        )`,
    [tokenHash(token)],
  );
  const row = result.rows[0];
  return row
    ? {
        id: row.id,
        email: row.email,
        displayName: row.display_name,
        role: row.role,
        extensionId: row.extension_id,
        customerId: row.customer_id,
      }
    : null;
}

export async function requireUser(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<AuthenticatedUser | null> {
  const user = await currentUser(request);
  if (!user) {
    await reply.code(401).send({ error: "Authentication required" });
    return null;
  }
  return user;
}

export async function requireAdministrator(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<AuthenticatedUser | null> {
  const user = await requireUser(request, reply);
  if (!user) return null;
  if (!isAdministratorRole(user.role)) {
    await reply.code(403).send({ error: "Administrator access required" });
    return null;
  }
  return user;
}

export async function requireAgent(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<AuthenticatedUser | null> {
  const user = await requireUser(request, reply);
  if (!user) return null;
  if (user.role !== "agent" || !user.extensionId) {
    await reply.code(403).send({ error: "Agent access required" });
    return null;
  }
  return user;
}

export async function requireCustomer(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<AuthenticatedUser | null> {
  const user = await requireUser(request, reply);
  if (!user) return null;
  if (!isCustomerRole(user.role) || !user.customerId) {
    await reply.code(403).send({ error: "Customer portal access required" });
    return null;
  }
  return user;
}

export async function clearSession(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const token = parseCookies(request.headers.cookie).get(COOKIE_NAME);
  if (token) {
    await pool.query("DELETE FROM sessions WHERE token_hash = $1", [tokenHash(token)]);
  }
  reply.header("set-cookie", sessionCookie("", 0));
}
