import type { FastifyInstance } from "fastify";
import { requireAdministrator } from "./auth.js";
import { audit, pool } from "./database.js";
import { applyPbxConfiguration, serializedPbxMutation } from "./pbx.js";
import { encryptSecret } from "./secrets.js";
import {
  getTrunkRegistrationStatuses,
  type TrunkRegistrationState,
  type TrunkRow,
} from "./trunks.js";

interface TrunkBody {
  name?: string;
  authMode?: "registration" | "credentials" | "ip";
  providerHost?: string;
  providerPort?: number;
  transport?: "udp" | "tcp";
  username?: string;
  password?: string;
  registrationUsername?: string | null;
  registrationContactUser?: string | null;
  fromUser?: string | null;
  fromDomain?: string | null;
  inboundMatch?: string | null;
  dialPrefix?: string;
  stripPlus?: boolean;
  enabled?: boolean;
}

interface DidBody {
  didNumber?: string;
  trunkId?: string;
  destinationType?: "extension" | "ivr";
  destinationId?: string;
  // Retained for clients created before IVR destinations were introduced.
  extensionId?: string;
}

interface IdParams {
  id: string;
}

interface DidRouteRow {
  id: string;
  did_number: string;
  trunk_id: string;
  destination_type: "extension" | "ivr";
  extension_id: string | null;
  ivr_menu_id: string | null;
  enabled: boolean;
  created_at: Date;
  updated_at: Date;
}

interface PublicDidRouteRow extends DidRouteRow {
  trunk_name: string;
  trunk_enabled: boolean;
  extension_number: string | null;
  extension_name: string | null;
  extension_enabled: boolean | null;
  ivr_number: string | null;
  ivr_name: string | null;
  ivr_enabled: boolean | null;
}

const trunkColumns = `id, name, auth_mode, provider_host, provider_port,
  transport, username, secret_ciphertext, registration_username, registration_contact_user, from_user,
  from_domain, inbound_match, dial_prefix, strip_plus,
  enabled, created_at, updated_at`;
const didColumns = `id, did_number, trunk_id, destination_type, extension_id,
  ivr_menu_id, enabled, created_at, updated_at`;

function validName(value: string): boolean {
  return value.length >= 2 && value.length <= 80 &&
    /^[A-Za-z0-9][A-Za-z0-9 .,'()-]*$/.test(value);
}

function validUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function validProviderHost(value: string): boolean {
  return value.length <= 253 &&
    /^[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?$/.test(value) &&
    !value.includes("..");
}

function validUsername(value: string): boolean {
  return value.length >= 1 && value.length <= 128 &&
    /^[A-Za-z0-9_.+-]+$/.test(value);
}

function validProviderPassword(value: string): boolean {
  return value.length >= 1 && value.length <= 128 &&
    /^[\x21-\x7e]+$/.test(value) && !/[;"\\]/.test(value);
}

function validIpv4Cidr(value: string): boolean {
  const [address, prefix, extra] = value.split("/");
  if (!address || extra !== undefined) return false;
  if (prefix !== undefined && (!/^\d{1,2}$/.test(prefix) || Number(prefix) > 32)) {
    return false;
  }
  const octets = address.split(".");
  return octets.length === 4 && octets.every(
    (octet) => /^\d{1,3}$/.test(octet) && Number(octet) <= 255,
  );
}

function normalizedInboundMatches(value: string | null): string | null {
  if (!value) return null;
  const matches = [...new Set(
    value.split(/[\s,]+/).map((item) => item.trim()).filter(Boolean),
  )];
  if (matches.length === 0) return null;
  if (matches.length > 16 || matches.some((item) => !validIpv4Cidr(item))) {
    throw new Error("Inbound matches must contain up to 16 IPv4 addresses or CIDR networks");
  }
  return matches.join(",");
}

function publicTrunk(
  row: TrunkRow,
  state: TrunkRegistrationState = "unknown",
  didCount = 0,
) {
  return {
    id: row.id,
    name: row.name,
    authMode: row.auth_mode,
    providerHost: row.provider_host,
    providerPort: row.provider_port,
    transport: row.transport,
    username: row.username,
    passwordConfigured: Boolean(row.secret_ciphertext),
    registrationUsername: row.registration_username,
    registrationContactUser: row.registration_contact_user,
    fromUser: row.from_user,
    fromDomain: row.from_domain,
    inboundMatch: row.inbound_match,
    dialPrefix: row.dial_prefix,
    stripPlus: row.strip_plus,
    enabled: row.enabled,
    registrationState: state,
    didCount,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function publicDidRoute(row: PublicDidRouteRow) {
  const isIvr = row.destination_type === "ivr";
  const destinationEnabled = isIvr ? row.ivr_enabled : row.extension_enabled;
  return {
    id: row.id,
    didNumber: row.did_number,
    trunkId: row.trunk_id,
    trunkName: row.trunk_name,
    destinationType: row.destination_type,
    destinationId: isIvr ? row.ivr_menu_id : row.extension_id,
    destinationNumber: isIvr ? row.ivr_number : row.extension_number,
    destinationName: isIvr ? row.ivr_name : row.extension_name,
    // Compatibility fields for earlier dashboard clients.
    extensionId: row.extension_id,
    extensionNumber: row.extension_number,
    extensionName: row.extension_name,
    enabled: row.enabled,
    published: row.enabled && row.trunk_enabled && destinationEnabled === true,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function allTrunks(): Promise<TrunkRow[]> {
  const result = await pool.query<TrunkRow>(
    `SELECT ${trunkColumns} FROM sip_trunks ORDER BY name`,
  );
  return result.rows;
}

async function trunkById(id: string): Promise<TrunkRow | undefined> {
  const result = await pool.query<TrunkRow>(
    `SELECT ${trunkColumns} FROM sip_trunks WHERE id = $1`,
    [id],
  );
  return result.rows[0];
}

async function didById(id: string): Promise<DidRouteRow | undefined> {
  const result = await pool.query<DidRouteRow>(
    `SELECT ${didColumns} FROM did_routes WHERE id = $1`,
    [id],
  );
  return result.rows[0];
}

async function restoreTrunk(row: TrunkRow): Promise<void> {
  await pool.query(
    `INSERT INTO sip_trunks (${trunkColumns})
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)`,
    [
      row.id,
      row.name,
      row.auth_mode,
      row.provider_host,
      row.provider_port,
      row.transport,
      row.username,
      row.secret_ciphertext,
      row.registration_username,
      row.registration_contact_user,
      row.from_user,
      row.from_domain,
      row.inbound_match,
      row.dial_prefix,
      row.strip_plus,
      row.enabled,
      row.created_at,
      row.updated_at,
    ],
  );
}

async function restoreDid(row: DidRouteRow): Promise<void> {
  await pool.query(
    `INSERT INTO did_routes (${didColumns})
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT (id) DO UPDATE SET
       did_number = EXCLUDED.did_number,
       trunk_id = EXCLUDED.trunk_id,
       destination_type = EXCLUDED.destination_type,
       extension_id = EXCLUDED.extension_id,
       ivr_menu_id = EXCLUDED.ivr_menu_id,
       enabled = EXCLUDED.enabled,
       created_at = EXCLUDED.created_at,
       updated_at = EXCLUDED.updated_at`,
    [
      row.id,
      row.did_number,
      row.trunk_id,
      row.destination_type,
      row.extension_id,
      row.ivr_menu_id,
      row.enabled,
      row.created_at,
      row.updated_at,
    ],
  );
}

function normalizedTrunkBody(body: TrunkBody, existing?: TrunkRow) {
  const name = body.name?.trim().replace(/\s+/g, " ") ?? existing?.name ?? "";
  const authMode = body.authMode ?? existing?.auth_mode ?? "registration";
  const providerHost = body.providerHost?.trim().toLowerCase() ??
    existing?.provider_host ?? "";
  const providerPort = Number(body.providerPort ?? existing?.provider_port ?? 5060);
  const transport = body.transport ?? existing?.transport ?? "udp";
  const username = body.username?.trim() ?? existing?.username ?? "";
  const password = body.password ?? "";
  const registrationUsername = body.registrationUsername === undefined
    ? existing?.registration_username ?? null
    : body.registrationUsername?.trim() || null;
  const registrationContactUser = body.registrationContactUser === undefined
    ? existing?.registration_contact_user ?? null
    : body.registrationContactUser?.trim() || null;
  const fromUser = body.fromUser === undefined
    ? existing?.from_user ?? null
    : body.fromUser?.trim() || null;
  const fromDomain = body.fromDomain === undefined
    ? existing?.from_domain ?? null
    : body.fromDomain?.trim().toLowerCase() || null;
  const rawInboundMatch = body.inboundMatch === undefined
    ? existing?.inbound_match ?? null
    : body.inboundMatch?.trim() || null;
  const inboundMatch = normalizedInboundMatches(rawInboundMatch);
  const dialPrefix = body.dialPrefix?.trim() ?? existing?.dial_prefix ?? "";
  const stripPlus = body.stripPlus ?? existing?.strip_plus ?? true;
  const enabled = body.enabled ?? existing?.enabled ?? true;

  if (!validName(name)) throw new Error("Enter a valid trunk name");
  if (!(["registration", "credentials", "ip"] as const).includes(authMode)) {
    throw new Error("Choose a valid authentication mode");
  }
  if (!validProviderHost(providerHost)) throw new Error("Enter a valid provider hostname or IPv4 address");
  if (!Number.isInteger(providerPort) || providerPort < 1 || providerPort > 65535) {
    throw new Error("Provider port must be between 1 and 65535");
  }
  if (!(transport === "udp" || transport === "tcp")) {
    throw new Error("Choose UDP or TCP transport");
  }
  if (typeof enabled !== "boolean") throw new Error("Invalid trunk state");
  if (typeof stripPlus !== "boolean") throw new Error("Invalid outbound number format");
  if (authMode !== "ip" && !validUsername(username)) {
    throw new Error("Enter a valid provider username");
  }
  if (password && !validProviderPassword(password)) {
    throw new Error("Provider password contains unsupported characters");
  }
  if (authMode !== "ip" && !password && !existing?.secret_ciphertext) {
    throw new Error("Enter the provider password");
  }
  if (registrationUsername && !validUsername(registrationUsername)) {
    throw new Error("Enter a valid registration username");
  }
  if (registrationContactUser && !validUsername(registrationContactUser)) {
    throw new Error("Enter a valid registration Contact user");
  }
  if (fromUser && !validUsername(fromUser)) {
    throw new Error("Enter a valid SIP From user");
  }
  if (fromDomain && !validProviderHost(fromDomain)) {
    throw new Error("Enter a valid SIP From domain");
  }
  if (!/^[0-9]{0,20}$/.test(dialPrefix)) {
    throw new Error("Dial prefix must contain no more than 20 digits");
  }
  if (dialPrefix && !stripPlus) {
    throw new Error("Carrier prefixes require leading + removal");
  }
  return {
    name,
    authMode,
    providerHost,
    providerPort,
    transport,
    username: authMode !== "ip" ? username : null,
    secretCiphertext: authMode !== "ip"
      ? (password ? encryptSecret(password) : existing?.secret_ciphertext ?? null)
      : null,
    registrationUsername: authMode === "registration" ? registrationUsername : null,
    registrationContactUser: authMode === "registration" ? registrationContactUser : null,
    fromUser,
    fromDomain,
    inboundMatch,
    dialPrefix,
    stripPlus,
    enabled,
  };
}

interface ValidatedDidRoute {
  didNumber: string;
  trunkId: string;
  destinationType: "extension" | "ivr";
  destinationId: string;
  extensionId: string | null;
  ivrMenuId: string | null;
}

async function validateDidBody(
  body: DidBody | undefined,
  existing?: DidRouteRow,
): Promise<{ value?: ValidatedDidRoute; error?: string }> {
  const didNumber = body?.didNumber?.trim() ?? existing?.did_number ?? "";
  const trunkId = body?.trunkId ?? existing?.trunk_id ?? "";
  const destinationType = body?.destinationType ?? existing?.destination_type ?? "extension";
  const existingDestinationId = existing?.destination_type === "ivr"
    ? existing.ivr_menu_id
    : existing?.extension_id;
  const destinationId = body?.destinationId ?? body?.extensionId ?? existingDestinationId ?? "";

  if (!/^\+?[0-9]{3,20}$/.test(didNumber)) {
    return { error: "DID must contain 3 to 20 digits with an optional leading +" };
  }
  if (!(destinationType === "extension" || destinationType === "ivr")) {
    return { error: "Choose a valid destination type" };
  }
  if (!validUuid(trunkId)) return { error: "Choose an active SIP trunk" };
  if (!validUuid(destinationId)) return { error: "Choose an active destination" };

  const destinationQuery = destinationType === "ivr"
    ? "SELECT id FROM ivr_menus WHERE id = $1 AND enabled = true"
    : "SELECT id FROM extensions WHERE id = $1 AND enabled = true";
  const [trunk, destination] = await Promise.all([
    pool.query<{ id: string }>(
      "SELECT id FROM sip_trunks WHERE id = $1 AND enabled = true",
      [trunkId],
    ),
    pool.query<{ id: string }>(destinationQuery, [destinationId]),
  ]);
  if (!trunk.rows[0]) return { error: "Choose an active SIP trunk" };
  if (!destination.rows[0]) {
    return {
      error: destinationType === "ivr"
        ? "Choose an active destination IVR"
        : "Choose an active destination extension",
    };
  }
  return {
    value: {
      didNumber,
      trunkId,
      destinationType,
      destinationId,
      extensionId: destinationType === "extension" ? destinationId : null,
      ivrMenuId: destinationType === "ivr" ? destinationId : null,
    },
  };
}

export function registerTrunkRoutes(app: FastifyInstance): void {
  app.get("/api/pbx/trunks", async (request, reply) => {
    const user = await requireAdministrator(request, reply);
    if (!user) return;
    const rows = await allTrunks();
    const [states, didCounts] = await Promise.all([
      getTrunkRegistrationStatuses(rows),
      pool.query<{ trunk_id: string; count: string }>(
        "SELECT trunk_id, count(*) FROM did_routes GROUP BY trunk_id",
      ),
    ]);
    const counts = new Map(didCounts.rows.map((row) => [row.trunk_id, Number(row.count)]));
    return {
      trunks: rows.map((row) => publicTrunk(
        row,
        states.get(row.id),
        counts.get(row.id) ?? 0,
      )),
    };
  });

  app.post<{ Body: TrunkBody }>("/api/pbx/trunks", async (request, reply) => {
    const user = await requireAdministrator(request, reply);
    if (!user) return;
    let values: ReturnType<typeof normalizedTrunkBody>;
    try {
      values = normalizedTrunkBody(request.body ?? {});
    } catch (error) {
      return reply.code(400).send({ error: (error as Error).message });
    }
    try {
      const row = await serializedPbxMutation(async () => {
        const inserted = await pool.query<TrunkRow>(
          `INSERT INTO sip_trunks
             (name, auth_mode, provider_host, provider_port, transport,
              username, secret_ciphertext, registration_username, registration_contact_user, from_user,
              from_domain, inbound_match, dial_prefix, strip_plus, enabled)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
           RETURNING ${trunkColumns}`,
          [
            values.name,
            values.authMode,
            values.providerHost,
            values.providerPort,
            values.transport,
            values.username,
            values.secretCiphertext,
            values.registrationUsername,
            values.registrationContactUser,
            values.fromUser,
            values.fromDomain,
            values.inboundMatch,
            values.dialPrefix,
            values.stripPlus,
            values.enabled,
          ],
        );
        const created = inserted.rows[0];
        if (!created) throw new Error("Trunk insert did not return a record");
        try {
          await applyPbxConfiguration();
        } catch (error) {
          await pool.query("DELETE FROM sip_trunks WHERE id = $1", [created.id]);
          await applyPbxConfiguration().catch(() => undefined);
          throw error;
        }
        return created;
      });
      await audit("pbx.trunk.created", user.id, {
        name: row.name,
        authMode: row.auth_mode,
        providerHost: row.provider_host,
      }, request.ip);
      return reply.code(201).send({ trunk: publicTrunk(row) });
    } catch (error) {
      if ((error as { code?: string }).code === "23505") {
        return reply.code(409).send({ error: "A trunk with that name already exists" });
      }
      request.log.error({ error }, "SIP trunk provisioning failed");
      return reply.code(500).send({ error: "Could not provision the SIP trunk in Asterisk" });
    }
  });

  app.patch<{ Params: IdParams; Body: TrunkBody }>(
    "/api/pbx/trunks/:id",
    async (request, reply) => {
      const user = await requireAdministrator(request, reply);
      if (!user) return;
      const existing = await trunkById(request.params.id);
      if (!existing) return reply.code(404).send({ error: "SIP trunk not found" });
      let values: ReturnType<typeof normalizedTrunkBody>;
      try {
        values = normalizedTrunkBody(request.body ?? {}, existing);
      } catch (error) {
        return reply.code(400).send({ error: (error as Error).message });
      }
      try {
        const row = await serializedPbxMutation(async () => {
          const result = await pool.query<TrunkRow>(
            `UPDATE sip_trunks
                SET name = $1, auth_mode = $2, provider_host = $3,
                    provider_port = $4, transport = $5, username = $6,
                    secret_ciphertext = $7, registration_username = $8,
                    registration_contact_user = $9, from_user = $10,
                    from_domain = $11, inbound_match = $12,
                    dial_prefix = $13, strip_plus = $14, enabled = $15,
                    updated_at = now()
              WHERE id = $16
              RETURNING ${trunkColumns}`,
            [
              values.name,
              values.authMode,
              values.providerHost,
              values.providerPort,
              values.transport,
              values.username,
              values.secretCiphertext,
              values.registrationUsername,
              values.registrationContactUser,
              values.fromUser,
              values.fromDomain,
              values.inboundMatch,
              values.dialPrefix,
              values.stripPlus,
              values.enabled,
              existing.id,
            ],
          );
          const updated = result.rows[0];
          if (!updated) throw new Error("Trunk update did not return a record");
          try {
            await applyPbxConfiguration();
          } catch (error) {
            await pool.query(
              `UPDATE sip_trunks
                  SET name = $1, auth_mode = $2, provider_host = $3,
                      provider_port = $4, transport = $5, username = $6,
                      secret_ciphertext = $7, registration_username = $8,
                      registration_contact_user = $9, from_user = $10,
                      from_domain = $11, inbound_match = $12,
                      dial_prefix = $13, strip_plus = $14, enabled = $15,
                      updated_at = $16
                WHERE id = $17`,
              [
                existing.name,
                existing.auth_mode,
                existing.provider_host,
                existing.provider_port,
                existing.transport,
                existing.username,
                existing.secret_ciphertext,
                existing.registration_username,
                existing.registration_contact_user,
                existing.from_user,
                existing.from_domain,
                existing.inbound_match,
                existing.dial_prefix,
                existing.strip_plus,
                existing.enabled,
                existing.updated_at,
                existing.id,
              ],
            );
            await applyPbxConfiguration().catch(() => undefined);
            throw error;
          }
          return updated;
        });
        await audit("pbx.trunk.updated", user.id, {
          name: row.name,
          authMode: row.auth_mode,
          enabled: row.enabled,
        }, request.ip);
        return { trunk: publicTrunk(row) };
      } catch (error) {
        if ((error as { code?: string }).code === "23505") {
          return reply.code(409).send({ error: "A trunk with that name already exists" });
        }
        request.log.error({ error }, "SIP trunk update failed");
        return reply.code(500).send({ error: "Could not update the SIP trunk" });
      }
    },
  );

  app.delete<{ Params: IdParams }>("/api/pbx/trunks/:id", async (request, reply) => {
    const user = await requireAdministrator(request, reply);
    if (!user) return;
    const existing = await trunkById(request.params.id);
    if (!existing) return reply.code(404).send({ error: "SIP trunk not found" });
    const [routes, outboundRoutes, campaigns] = await Promise.all([
      pool.query<{ count: string }>(
        "SELECT count(*) FROM did_routes WHERE trunk_id = $1",
        [existing.id],
      ),
      pool.query<{ count: string }>(
        "SELECT count(*) FROM outbound_routes WHERE sip_trunk_id = $1",
        [existing.id],
      ),
      pool.query<{ count: string }>(
        "SELECT count(*) FROM outbound_campaigns WHERE sip_trunk_id = $1",
        [existing.id],
      ),
    ]);
    if (Number(routes.rows[0]?.count ?? 0) > 0) {
      return reply.code(409).send({ error: "Delete this trunk's DID routes first" });
    }
    if (Number(outboundRoutes.rows[0]?.count ?? 0) > 0) {
      return reply.code(409).send({ error: "Delete this trunk's outbound routes first" });
    }
    if (Number(campaigns.rows[0]?.count ?? 0) > 0) {
      return reply.code(409).send({ error: "Remove this trunk from its campaigns first" });
    }
    try {
      await serializedPbxMutation(async () => {
        await pool.query("DELETE FROM sip_trunks WHERE id = $1", [existing.id]);
        try {
          await applyPbxConfiguration();
        } catch (error) {
          await restoreTrunk(existing);
          await applyPbxConfiguration().catch(() => undefined);
          throw error;
        }
      });
      await audit("pbx.trunk.deleted", user.id, { name: existing.name }, request.ip);
      return reply.code(204).send();
    } catch (error) {
      request.log.error({ error }, "SIP trunk deletion failed");
      return reply.code(500).send({ error: "Could not remove the SIP trunk" });
    }
  });

  app.get("/api/pbx/dids", async (request, reply) => {
    const user = await requireAdministrator(request, reply);
    if (!user) return;
    const result = await pool.query<PublicDidRouteRow>(
      `SELECT routes.id, routes.did_number, routes.trunk_id,
              routes.destination_type, routes.extension_id, routes.ivr_menu_id,
              routes.enabled, routes.created_at, routes.updated_at,
              trunks.name AS trunk_name, trunks.enabled AS trunk_enabled,
              extensions.extension_number,
              extensions.display_name AS extension_name,
              extensions.enabled AS extension_enabled,
              ivr_menus.extension_number AS ivr_number,
              ivr_menus.name AS ivr_name,
              ivr_menus.enabled AS ivr_enabled
         FROM did_routes AS routes
         JOIN sip_trunks AS trunks ON trunks.id = routes.trunk_id
         LEFT JOIN extensions ON extensions.id = routes.extension_id
         LEFT JOIN ivr_menus ON ivr_menus.id = routes.ivr_menu_id
        ORDER BY length(routes.did_number), routes.did_number`,
    );
    return { didRoutes: result.rows.map(publicDidRoute) };
  });

  app.post<{ Body: DidBody }>("/api/pbx/dids", async (request, reply) => {
    const user = await requireAdministrator(request, reply);
    if (!user) return;
    const validated = await validateDidBody(request.body);
    if (!validated.value) return reply.code(400).send({ error: validated.error });
    const value = validated.value;
    try {
      const row = await serializedPbxMutation(async () => {
        const inserted = await pool.query<DidRouteRow>(
          `INSERT INTO did_routes
             (did_number, trunk_id, destination_type, extension_id, ivr_menu_id)
           VALUES ($1, $2, $3, $4, $5) RETURNING ${didColumns}`,
          [value.didNumber, value.trunkId, value.destinationType,
            value.extensionId, value.ivrMenuId],
        );
        const created = inserted.rows[0];
        if (!created) throw new Error("DID route insert did not return a record");
        try {
          await applyPbxConfiguration();
        } catch (error) {
          await pool.query("DELETE FROM did_routes WHERE id = $1", [created.id]);
          await applyPbxConfiguration().catch(() => undefined);
          throw error;
        }
        return created;
      });
      await audit("pbx.did.created", user.id, {
        didNumber: value.didNumber,
        trunkId: value.trunkId,
        destinationType: value.destinationType,
        destinationId: value.destinationId,
      }, request.ip);
      return reply.code(201).send({ didRoute: row });
    } catch (error) {
      if ((error as { code?: string }).code === "23505") {
        return reply.code(409).send({ error: "That DID already has an inbound route" });
      }
      request.log.error({ error }, "DID route provisioning failed");
      return reply.code(500).send({ error: "Could not provision the inbound DID route" });
    }
  });

  app.patch<{ Params: IdParams; Body: DidBody }>(
    "/api/pbx/dids/:id",
    async (request, reply) => {
      const user = await requireAdministrator(request, reply);
      if (!user) return;
      const existing = await didById(request.params.id);
      if (!existing) return reply.code(404).send({ error: "DID route not found" });
      const validated = await validateDidBody(request.body, existing);
      if (!validated.value) return reply.code(400).send({ error: validated.error });
      const value = validated.value;
      try {
        const row = await serializedPbxMutation(async () => {
          const result = await pool.query<DidRouteRow>(
            `UPDATE did_routes
                SET did_number = $1, trunk_id = $2, destination_type = $3,
                    extension_id = $4, ivr_menu_id = $5, updated_at = now()
              WHERE id = $6
              RETURNING ${didColumns}`,
            [value.didNumber, value.trunkId, value.destinationType,
              value.extensionId, value.ivrMenuId, existing.id],
          );
          const updated = result.rows[0];
          if (!updated) throw new Error("DID route update did not return a record");
          try {
            await applyPbxConfiguration();
          } catch (error) {
            await restoreDid(existing);
            await applyPbxConfiguration().catch(() => undefined);
            throw error;
          }
          return updated;
        });
        await audit("pbx.did.updated", user.id, {
          didNumber: value.didNumber,
          trunkId: value.trunkId,
          destinationType: value.destinationType,
          destinationId: value.destinationId,
        }, request.ip);
        return { didRoute: row };
      } catch (error) {
        if ((error as { code?: string }).code === "23505") {
          return reply.code(409).send({ error: "That DID already has an inbound route" });
        }
        request.log.error({ error }, "DID route update failed");
        return reply.code(500).send({ error: "Could not update the inbound DID route" });
      }
    },
  );

  app.delete<{ Params: IdParams }>("/api/pbx/dids/:id", async (request, reply) => {
    const user = await requireAdministrator(request, reply);
    if (!user) return;
    const existing = await didById(request.params.id);
    if (!existing) return reply.code(404).send({ error: "DID route not found" });
    try {
      await serializedPbxMutation(async () => {
        await pool.query("DELETE FROM did_routes WHERE id = $1", [existing.id]);
        try {
          await applyPbxConfiguration();
        } catch (error) {
          await restoreDid(existing);
          await applyPbxConfiguration().catch(() => undefined);
          throw error;
        }
      });
      await audit("pbx.did.deleted", user.id, { didNumber: existing.did_number }, request.ip);
      return reply.code(204).send();
    } catch (error) {
      request.log.error({ error }, "DID route deletion failed");
      return reply.code(500).send({ error: "Could not remove the inbound DID route" });
    }
  });
}
