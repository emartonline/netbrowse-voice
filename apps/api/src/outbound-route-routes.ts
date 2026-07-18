import type { FastifyInstance } from "fastify";
import { requireAdministrator } from "./auth.js";
import { audit, pool } from "./database.js";
import { applyPbxConfiguration, serializedPbxMutation } from "./pbx.js";

interface IdParams {
  id: string;
}

interface OutboundRouteBody {
  name?: string;
  sipTrunkId?: string;
  accessPrefix?: string;
  outboundCallerId?: string | null;
  ringTimeoutSeconds?: number;
  enabled?: boolean;
}

interface OutboundRouteRow {
  id: string;
  name: string;
  sip_trunk_id: string;
  access_prefix: string;
  outbound_caller_id: string | null;
  ring_timeout_seconds: number;
  enabled: boolean;
  created_at: Date;
  updated_at: Date;
}

interface PublicOutboundRouteRow extends OutboundRouteRow {
  trunk_name: string;
  trunk_enabled: boolean;
  dial_prefix: string;
  strip_plus: boolean;
}

const routeColumns = `id, name, sip_trunk_id, access_prefix,
  outbound_caller_id, ring_timeout_seconds, enabled, created_at, updated_at`;

function validUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function publicRoute(row: PublicOutboundRouteRow) {
  return {
    id: row.id,
    name: row.name,
    sipTrunkId: row.sip_trunk_id,
    trunkName: row.trunk_name,
    trunkEnabled: row.trunk_enabled,
    accessPrefix: row.access_prefix,
    outboundCallerId: row.outbound_caller_id,
    ringTimeoutSeconds: row.ring_timeout_seconds,
    enabled: row.enabled,
    published: row.enabled && row.trunk_enabled,
    providerDialPrefix: row.dial_prefix,
    providerStripsPlus: row.strip_plus,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function routeById(id: string): Promise<OutboundRouteRow | undefined> {
  const result = await pool.query<OutboundRouteRow>(
    `SELECT ${routeColumns} FROM outbound_routes WHERE id = $1`,
    [id],
  );
  return result.rows[0];
}

async function restoreRoute(row: OutboundRouteRow): Promise<void> {
  await pool.query(
    `INSERT INTO outbound_routes (${routeColumns})
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [row.id, row.name, row.sip_trunk_id, row.access_prefix,
      row.outbound_caller_id, row.ring_timeout_seconds, row.enabled,
      row.created_at, row.updated_at],
  );
}

function normalizedBody(body: OutboundRouteBody, existing?: OutboundRouteRow) {
  const name = body.name?.trim().replace(/\s+/g, " ") ?? existing?.name ?? "";
  const sipTrunkId = body.sipTrunkId ?? existing?.sip_trunk_id ?? "";
  const accessPrefix = body.accessPrefix?.trim() ?? existing?.access_prefix ?? "9";
  const outboundCallerId = body.outboundCallerId === undefined
    ? existing?.outbound_caller_id ?? null
    : body.outboundCallerId?.trim() || null;
  const ringTimeoutSeconds = Number(
    body.ringTimeoutSeconds ?? existing?.ring_timeout_seconds ?? 60,
  );
  const enabled = body.enabled ?? existing?.enabled ?? true;

  if (name.length < 2 || name.length > 80 ||
      !/^[A-Za-z0-9][A-Za-z0-9 .,'()-]*$/.test(name)) {
    throw new Error("Enter a valid outbound route name");
  }
  if (!validUuid(sipTrunkId)) throw new Error("Choose an enabled SIP trunk");
  if (!/^[0-9]{1,4}$/.test(accessPrefix)) {
    throw new Error("Access prefix must contain 1 to 4 digits");
  }
  if (outboundCallerId && !/^\+[1-9][0-9]{7,14}$/.test(outboundCallerId)) {
    throw new Error("Outbound caller ID must use international E.164 format");
  }
  if (!Number.isInteger(ringTimeoutSeconds) ||
      ringTimeoutSeconds < 10 || ringTimeoutSeconds > 120) {
    throw new Error("Ring timeout must be between 10 and 120 seconds");
  }
  if (typeof enabled !== "boolean") throw new Error("Invalid outbound route state");
  return { name, sipTrunkId, accessPrefix, outboundCallerId, ringTimeoutSeconds, enabled };
}

async function validateDependencies(
  sipTrunkId: string,
  accessPrefix: string,
  excludedId?: string,
): Promise<string | undefined> {
  const [trunk, prefixes] = await Promise.all([
    pool.query<{ id: string }>(
      "SELECT id FROM sip_trunks WHERE id = $1 AND enabled = true",
      [sipTrunkId],
    ),
    pool.query<{ access_prefix: string }>(
      `SELECT access_prefix FROM outbound_routes
        WHERE ($1::uuid IS NULL OR id <> $1::uuid)`,
      [excludedId ?? null],
    ),
  ]);
  if (!trunk.rows[0]) return "Choose an enabled SIP trunk";
  const overlaps = prefixes.rows.some(
    (row) => row.access_prefix.startsWith(accessPrefix) ||
      accessPrefix.startsWith(row.access_prefix),
  );
  return overlaps
    ? "Choose an access prefix that does not overlap another outbound route"
    : undefined;
}

export function registerOutboundRouteRoutes(app: FastifyInstance): void {
  app.get("/api/pbx/outbound-routes", async (request, reply) => {
    const user = await requireAdministrator(request, reply);
    if (!user) return;
    const result = await pool.query<PublicOutboundRouteRow>(
      `SELECT routes.id, routes.name, routes.sip_trunk_id,
              routes.access_prefix, routes.outbound_caller_id,
              routes.ring_timeout_seconds, routes.enabled,
              routes.created_at, routes.updated_at,
              trunks.name AS trunk_name, trunks.enabled AS trunk_enabled,
              trunks.dial_prefix, trunks.strip_plus
         FROM outbound_routes AS routes
         JOIN sip_trunks AS trunks ON trunks.id = routes.sip_trunk_id
        ORDER BY routes.access_prefix, routes.name`,
    );
    return { outboundRoutes: result.rows.map(publicRoute) };
  });

  app.post<{ Body: OutboundRouteBody }>(
    "/api/pbx/outbound-routes",
    async (request, reply) => {
      const user = await requireAdministrator(request, reply);
      if (!user) return;
      let values: ReturnType<typeof normalizedBody>;
      try {
        values = normalizedBody(request.body ?? {});
      } catch (error) {
        return reply.code(400).send({ error: (error as Error).message });
      }
      const dependencyError = await validateDependencies(
        values.sipTrunkId,
        values.accessPrefix,
      );
      if (dependencyError) return reply.code(409).send({ error: dependencyError });
      try {
        const row = await serializedPbxMutation(async () => {
          const result = await pool.query<OutboundRouteRow>(
            `INSERT INTO outbound_routes
               (name, sip_trunk_id, access_prefix, outbound_caller_id,
                ring_timeout_seconds, enabled)
             VALUES ($1, $2, $3, $4, $5, $6)
             RETURNING ${routeColumns}`,
            [values.name, values.sipTrunkId, values.accessPrefix,
              values.outboundCallerId, values.ringTimeoutSeconds, values.enabled],
          );
          const created = result.rows[0];
          if (!created) throw new Error("Outbound route insert did not return a row");
          try {
            await applyPbxConfiguration();
          } catch (error) {
            await pool.query("DELETE FROM outbound_routes WHERE id = $1", [created.id]);
            await applyPbxConfiguration().catch(() => undefined);
            throw error;
          }
          return created;
        });
        await audit("pbx.outbound_route.created", user.id, {
          routeId: row.id,
          trunkId: row.sip_trunk_id,
          accessPrefix: row.access_prefix,
        }, request.ip);
        return reply.code(201).send({ outboundRoute: row });
      } catch (error) {
        if ((error as { code?: string }).code === "23505") {
          return reply.code(409).send({ error: "That route name or access prefix is already used" });
        }
        request.log.error({ error }, "Outbound route provisioning failed");
        return reply.code(500).send({ error: "Could not provision the outbound route" });
      }
    },
  );

  app.patch<{ Params: IdParams; Body: OutboundRouteBody }>(
    "/api/pbx/outbound-routes/:id",
    async (request, reply) => {
      const user = await requireAdministrator(request, reply);
      if (!user) return;
      const existing = await routeById(request.params.id);
      if (!existing) return reply.code(404).send({ error: "Outbound route not found" });
      let values: ReturnType<typeof normalizedBody>;
      try {
        values = normalizedBody(request.body ?? {}, existing);
      } catch (error) {
        return reply.code(400).send({ error: (error as Error).message });
      }
      const dependencyError = await validateDependencies(
        values.sipTrunkId,
        values.accessPrefix,
        existing.id,
      );
      if (dependencyError) return reply.code(409).send({ error: dependencyError });
      try {
        const row = await serializedPbxMutation(async () => {
          const result = await pool.query<OutboundRouteRow>(
            `UPDATE outbound_routes
                SET name = $1, sip_trunk_id = $2, access_prefix = $3,
                    outbound_caller_id = $4, ring_timeout_seconds = $5,
                    enabled = $6, updated_at = now()
              WHERE id = $7
              RETURNING ${routeColumns}`,
            [values.name, values.sipTrunkId, values.accessPrefix,
              values.outboundCallerId, values.ringTimeoutSeconds,
              values.enabled, existing.id],
          );
          const updated = result.rows[0];
          if (!updated) throw new Error("Outbound route update did not return a row");
          try {
            await applyPbxConfiguration();
          } catch (error) {
            await pool.query(
              `UPDATE outbound_routes
                  SET name=$1, sip_trunk_id=$2, access_prefix=$3,
                      outbound_caller_id=$4, ring_timeout_seconds=$5,
                      enabled=$6, updated_at=$7
                WHERE id=$8`,
              [existing.name, existing.sip_trunk_id, existing.access_prefix,
                existing.outbound_caller_id, existing.ring_timeout_seconds,
                existing.enabled, existing.updated_at, existing.id],
            );
            await applyPbxConfiguration().catch(() => undefined);
            throw error;
          }
          return updated;
        });
        await audit("pbx.outbound_route.updated", user.id, {
          routeId: row.id,
          trunkId: row.sip_trunk_id,
          accessPrefix: row.access_prefix,
        }, request.ip);
        return { outboundRoute: row };
      } catch (error) {
        if ((error as { code?: string }).code === "23505") {
          return reply.code(409).send({ error: "That route name or access prefix is already used" });
        }
        request.log.error({ error }, "Outbound route update failed");
        return reply.code(500).send({ error: "Could not update the outbound route" });
      }
    },
  );

  app.delete<{ Params: IdParams }>(
    "/api/pbx/outbound-routes/:id",
    async (request, reply) => {
      const user = await requireAdministrator(request, reply);
      if (!user) return;
      const existing = await routeById(request.params.id);
      if (!existing) return reply.code(404).send({ error: "Outbound route not found" });
      try {
        await serializedPbxMutation(async () => {
          await pool.query("DELETE FROM outbound_routes WHERE id = $1", [existing.id]);
          try {
            await applyPbxConfiguration();
          } catch (error) {
            await restoreRoute(existing);
            await applyPbxConfiguration().catch(() => undefined);
            throw error;
          }
        });
        await audit("pbx.outbound_route.deleted", user.id, {
          routeId: existing.id,
          accessPrefix: existing.access_prefix,
        }, request.ip);
        return reply.code(204).send();
      } catch (error) {
        request.log.error({ error }, "Outbound route deletion failed");
        return reply.code(500).send({ error: "Could not delete the outbound route" });
      }
    },
  );
}
