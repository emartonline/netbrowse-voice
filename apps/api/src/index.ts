import Fastify from "fastify";
import { createClient } from "redis";
import {
  clearSession,
  createSession,
  hashPassword,
  requireAdministrator,
  requireUser,
  verifyPassword,
} from "./auth.js";
import { config } from "./config.js";
import { audit, databaseHealthy, pool } from "./database.js";
import { registerPbxRoutes } from "./pbx-routes.js";
import { applyPbxConfiguration } from "./pbx.js";
import { registerCallRoutes } from "./call-routes.js";
import { registerRecordingRoutes } from "./recording-routes.js";
import {
  enforceCustomerRecordingQuotas,
  pruneExpiredRecordings,
} from "./recordings.js";
import { serviceStatuses, systemMetrics } from "./system.js";
import { registerSoundStudioRoutes } from "./sound-studio-routes.js";
import { registerTrunkRoutes } from "./trunk-routes.js";
import { registerIvrRoutes } from "./ivr-routes.js";
import { registerAiReceptionistRoutes } from "./ai-receptionist-routes.js";
import { registerCallCentreRoutes } from "./call-centre-routes.js";
import { registerAgentRoutes } from "./agent-routes.js";
import { registerCampaignRoutes } from "./campaign-routes.js";
import { registerOutboundRouteRoutes } from "./outbound-route-routes.js";
import { registerBillingRoutes } from "./billing-routes.js";
import { registerCustomerRoutes } from "./customer-routes.js";
import { registerCustomerPlanRoutes } from "./customer-plan-routes.js";
import { registerInvoiceRoutes } from "./invoice-routes.js";
import { registerResellerRoutes } from "./reseller-routes.js";
import {
  brandedLoginAllowsUser,
  registerBrandingRoutes,
} from "./branding-routes.js";
import { registerDidMarketplaceRoutes } from "./did-marketplace-routes.js";
import {
  startDidRenewalWorker,
  stopDidRenewalWorker,
} from "./did-marketplace.js";
import { startBillingRater, stopBillingRater } from "./billing.js";
import {
  closeAiAudioSocketServer,
  closeAiFastAgiServer,
  startAiAudioSocketServer,
  startAiFastAgiServer,
} from "./ai-receptionist.js";
import type { Server } from "node:net";
import { startCampaignDialer, stopCampaignDialer } from "./campaign-dialer.js";

interface CredentialsBody {
  email?: string;
  password?: string;
  displayName?: string;
  brandSlug?: string;
}

const app = Fastify({
  logger: {
    level: config.nodeEnv === "production" ? "info" : "debug",
  },
  trustProxy: "127.0.0.1",
  bodyLimit: 256 * 1024,
});

const redis = createClient({ url: config.redisUrl });
redis.on("error", (error) => app.log.warn({ error }, "Redis connection error"));

const loginAttempts = new Map<string, { count: number; resetAt: number }>();

registerPbxRoutes(app);
registerTrunkRoutes(app);
registerCallRoutes(app);
registerRecordingRoutes(app);
registerSoundStudioRoutes(app);
registerIvrRoutes(app);
registerAiReceptionistRoutes(app);
registerCallCentreRoutes(app);
registerAgentRoutes(app);
registerCampaignRoutes(app);
registerOutboundRouteRoutes(app);
registerBillingRoutes(app);
registerCustomerRoutes(app);
registerCustomerPlanRoutes(app);
registerInvoiceRoutes(app);
registerResellerRoutes(app);
registerBrandingRoutes(app);
registerDidMarketplaceRoutes(app);

let aiFastAgiServer: Server | undefined;
let aiAudioSocketServer: Server | undefined;
let campaignDialerTimer: NodeJS.Timeout | undefined;
let billingRaterTimer: NodeJS.Timeout | undefined;
let recordingQuotaTimer: NodeJS.Timeout | undefined;
let didRenewalTimer: NodeJS.Timeout | undefined;

function validEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function loginAllowed(ip: string): boolean {
  const now = Date.now();
  const attempt = loginAttempts.get(ip);
  if (!attempt || attempt.resetAt <= now) {
    loginAttempts.set(ip, { count: 0, resetAt: now + 15 * 60_000 });
    return true;
  }
  return attempt.count < 8;
}

function recordFailedLogin(ip: string): void {
  const current = loginAttempts.get(ip) ?? {
    count: 0,
    resetAt: Date.now() + 15 * 60_000,
  };
  current.count += 1;
  loginAttempts.set(ip, current);
}

app.get("/api/health/public", async () => ({
  status: "ok",
  product: "Netbrowse Voice",
  version: config.version,
  timestamp: new Date().toISOString(),
}));

app.get("/api/setup/status", async (_request, reply) => {
  try {
    const result = await pool.query<{ count: string }>("SELECT count(*) FROM users");
    return { setupRequired: Number(result.rows[0]?.count ?? 0) === 0 };
  } catch {
    return reply.code(503).send({ error: "Database is not ready" });
  }
});

app.post<{ Body: CredentialsBody }>("/api/setup/admin", async (request, reply) => {
  const displayName = request.body?.displayName?.trim() ?? "";
  const email = request.body?.email?.trim().toLowerCase() ?? "";
  const password = request.body?.password ?? "";
  if (displayName.length < 2 || displayName.length > 100) {
    return reply.code(400).send({ error: "Enter a valid administrator name" });
  }
  if (!validEmail(email)) {
    return reply.code(400).send({ error: "Enter a valid email address" });
  }
  if (password.length < 12) {
    return reply.code(400).send({ error: "Password must be at least 12 characters" });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(762601)");
    const count = await client.query<{ count: string }>("SELECT count(*) FROM users");
    if (Number(count.rows[0]?.count ?? 0) !== 0) {
      await client.query("ROLLBACK");
      return reply.code(409).send({ error: "Initial setup is already complete" });
    }
    const result = await client.query<{ id: string }>(
      `INSERT INTO users (email, display_name, password_hash, role)
       VALUES ($1, $2, $3, 'owner') RETURNING id`,
      [email, displayName, hashPassword(password)],
    );
    await client.query("COMMIT");
    const userId = result.rows[0]?.id;
    if (!userId) throw new Error("Administrator creation did not return an id");
    await createSession(userId, reply, request);
    await audit("system.setup.completed", userId, { email }, request.ip);
    return reply.code(201).send({ ok: true });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    request.log.error({ error }, "Initial setup failed");
    return reply.code(500).send({ error: "Initial setup failed" });
  } finally {
    client.release();
  }
});

app.post<{ Body: CredentialsBody }>("/api/auth/login", async (request, reply) => {
  if (!loginAllowed(request.ip)) {
    return reply.code(429).send({ error: "Too many attempts. Try again later." });
  }
  const email = request.body?.email?.trim().toLowerCase() ?? "";
  const password = request.body?.password ?? "";
  const brandSlug = request.body?.brandSlug?.trim().toLowerCase() ?? "";
  const result = await pool.query<{
    id: string;
    password_hash: string;
    active: boolean;
    customer_active: boolean;
    parent_customer_active: boolean;
  }>(
    `SELECT users.id, users.password_hash, users.active,
            COALESCE(customers.active, true) AS customer_active,
            COALESCE(parent_customer.active, true) AS parent_customer_active
       FROM users
       LEFT JOIN customers ON customers.id = users.customer_id
       LEFT JOIN customers AS parent_customer
         ON parent_customer.id=customers.parent_customer_id
      WHERE users.email = $1`,
    [email],
  );
  const user = result.rows[0];
  const credentialsValid = Boolean(
    user && user.active && user.customer_active
    && user.parent_customer_active && verifyPassword(password, user.password_hash),
  );
  const brandValid = !brandSlug || (
    credentialsValid
    && /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(brandSlug)
    && user !== undefined
    && await brandedLoginAllowsUser(user.id, brandSlug)
  );
  if (!user || !credentialsValid || !brandValid) {
    recordFailedLogin(request.ip);
    await audit("auth.login.failed", null, { email }, request.ip).catch(() => undefined);
    return reply.code(401).send({ error: "Incorrect email or password" });
  }
  loginAttempts.delete(request.ip);
  await createSession(user.id, reply, request);
  await audit("auth.login.succeeded", user.id, {}, request.ip);
  return { ok: true };
});

app.post("/api/auth/logout", async (request, reply) => {
  await clearSession(request, reply);
  return { ok: true };
});

app.get("/api/me", async (request, reply) => {
  const user = await requireUser(request, reply);
  return user ? { user } : undefined;
});

app.get("/api/dashboard", async (request, reply) => {
  const user = await requireAdministrator(request, reply);
  if (!user) return;

  const [
    services,
    metrics,
    moduleResult,
    extensionResult,
    trunkResult,
    didResult,
    billingTodayResult,
    dbHealthy,
  ] = await Promise.all([
    serviceStatuses(),
    systemMetrics(),
    pool.query<{
      module_key: string;
      name: string;
      version: string;
      status: string;
      description: string;
    }>(
      `SELECT module_key, name, version, status, description
         FROM modules ORDER BY sort_order, name`,
    ),
    pool.query<{ count: string }>("SELECT count(*) FROM extensions WHERE enabled = true"),
    pool.query<{ count: string }>("SELECT count(*) FROM sip_trunks WHERE enabled = true"),
    pool.query<{ count: string }>("SELECT count(*) FROM did_routes WHERE enabled = true"),
    pool.query<{ currency: string; cost: string }>(
      `SELECT currency, COALESCE(sum(cost_amount), 0)::text AS cost
         FROM billing_call_charges
        WHERE call_started_at >= date_trunc('day', now())
        GROUP BY currency
        ORDER BY currency`,
    ),
    databaseHealthy(),
  ]);

  const normalizedServices = services.map((service) =>
    service.key === "postgresql" && !dbHealthy
      ? { ...service, state: "offline" as const }
      : service,
  );

  return {
    user,
    services: normalizedServices,
    metrics,
    extensionCount: Number(extensionResult.rows[0]?.count ?? 0),
    trunkCount: Number(trunkResult.rows[0]?.count ?? 0),
    didCount: Number(didResult.rows[0]?.count ?? 0),
    billingToday: billingTodayResult.rows.map((row) => ({
      currency: row.currency,
      cost: Number(row.cost),
    })),
    modules: moduleResult.rows.map((row) => ({
      key: row.module_key,
      name: row.name,
      version: row.version,
      status: row.status,
      description: row.description,
    })),
    activity: [],
  };
});

async function applyRecordingQuotaPolicy(): Promise<void> {
  const result = await enforceCustomerRecordingQuotas();
  if (result.disabledExtensions === 0) return;
  await applyPbxConfiguration();
  await audit("recording.quota_enforced", null, result);
  app.log.warn(result, "Disabled recording after a customer reached its plan allowance");
}

async function start(): Promise<void> {
  try {
    await redis.connect();
    await redis.ping();
  } catch (error) {
    app.log.warn({ error }, "Starting without Redis; live events are unavailable");
  }
  if (config.nodeEnv === "production") {
    app.log.info("Regenerating managed Asterisk configuration");
    await applyPbxConfiguration();
    aiFastAgiServer = await startAiFastAgiServer(app.log);
    aiAudioSocketServer = await startAiAudioSocketServer(app.log);
    campaignDialerTimer = startCampaignDialer(app.log);
    billingRaterTimer = startBillingRater(app.log);
    didRenewalTimer = startDidRenewalWorker(app.log);
  }
  await pruneExpiredRecordings().catch((error) =>
    app.log.warn({ error }, "Recording retention cleanup failed"),
  );
  if (config.nodeEnv === "production") {
    await applyRecordingQuotaPolicy().catch((error) =>
      app.log.warn({ error }, "Recording quota enforcement failed"),
    );
    recordingQuotaTimer = setInterval(() => {
      void applyRecordingQuotaPolicy().catch((error) =>
        app.log.warn({ error }, "Recording quota enforcement failed"),
      );
    }, 60_000);
  }
  await app.listen({ host: config.host, port: config.port });
}

async function shutdown(signal: string): Promise<void> {
  app.log.info({ signal }, "Shutting down");
  stopCampaignDialer(campaignDialerTimer);
  stopBillingRater(billingRaterTimer);
  stopDidRenewalWorker(didRenewalTimer);
  if (recordingQuotaTimer) clearInterval(recordingQuotaTimer);
  await closeAiAudioSocketServer(aiAudioSocketServer);
  await closeAiFastAgiServer(aiFastAgiServer);
  await app.close();
  if (redis.isOpen) await redis.quit();
  await pool.end();
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

start().catch((error) => {
  app.log.fatal({ error }, "API failed to start");
  process.exit(1);
});
