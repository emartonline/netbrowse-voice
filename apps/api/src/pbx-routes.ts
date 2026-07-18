import { randomBytes } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { requireAdministrator, requireCustomer } from "./auth.js";
import { audit, pool } from "./database.js";
import {
  applyPbxConfiguration,
  getExtensionRegistrationStatuses,
  serializedPbxMutation,
  type ExtensionRow,
  type RegistrationStatus,
} from "./pbx.js";
import { encryptSecret } from "./secrets.js";
import { customerRecordingStorageSummary } from "./recordings.js";

interface ExtensionBody {
  extensionNumber?: string;
  displayName?: string;
  maxContacts?: number;
}

interface ExtensionServicesBody {
  ringTimeoutSeconds?: number;
  voicemailEnabled?: boolean;
  voicemailPin?: string;
  dndEnabled?: boolean;
  callWaiting?: boolean;
  recordCalls?: boolean;
  pickupGroup?: number | null;
  forwardMode?: "off" | "always" | "busy" | "unavailable";
  forwardExtensionId?: string | null;
}

interface ExtensionParams {
  id: string;
}

const extensionColumns = `id, extension_number, display_name, secret_ciphertext,
  enabled, max_contacts, ring_timeout_seconds, voicemail_enabled,
  voicemail_pin_ciphertext, dnd_enabled, call_waiting, record_calls,
  pickup_group, forward_mode, forward_extension_id, created_at, updated_at`;

function publicExtension(
  row: ExtensionRow,
  registration: RegistrationStatus = { state: "unknown", contactCount: 0 },
  forwardExtensionNumber?: string,
) {
  return {
    id: row.id,
    extensionNumber: row.extension_number,
    displayName: row.display_name,
    enabled: row.enabled,
    maxContacts: row.max_contacts,
    registrationState: registration.state,
    deviceCount: registration.contactCount,
    ringTimeoutSeconds: row.ring_timeout_seconds,
    voicemailEnabled: row.voicemail_enabled,
    voicemailConfigured: Boolean(row.voicemail_pin_ciphertext),
    dndEnabled: row.dnd_enabled,
    callWaiting: row.call_waiting,
    recordCalls: row.record_calls,
    pickupGroup: row.pickup_group,
    forwardMode: row.forward_mode,
    forwardExtensionId: row.forward_extension_id,
    forwardExtensionNumber: forwardExtensionNumber ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function validDisplayName(value: string): boolean {
  return (
    value.length >= 2 &&
    value.length <= 80 &&
    /^[A-Za-z0-9][A-Za-z0-9 .,'-]*$/.test(value)
  );
}

function sipPassword(): string {
  return randomBytes(18).toString("base64url");
}

async function allExtensions(): Promise<ExtensionRow[]> {
  const result = await pool.query<ExtensionRow>(
    `SELECT ${extensionColumns}
       FROM extensions
      ORDER BY length(extension_number), extension_number`,
  );
  return result.rows;
}

async function extensionById(id: string): Promise<ExtensionRow | undefined> {
  const result = await pool.query<ExtensionRow>(
    `SELECT ${extensionColumns} FROM extensions WHERE id = $1`,
    [id],
  );
  return result.rows[0];
}

async function customerExtensionById(
  customerId: string,
  extensionId: string,
): Promise<ExtensionRow | undefined> {
  const result = await pool.query<ExtensionRow>(
    `SELECT ${extensionColumns}
       FROM extensions
      WHERE extensions.id=$1
        AND EXISTS (
          SELECT 1 FROM customer_extensions AS assignments
           WHERE assignments.extension_id=extensions.id
             AND assignments.customer_id=$2
        )`,
    [extensionId, customerId],
  );
  return result.rows[0];
}

function hasForwardingCycle(rows: ExtensionRow[]): boolean {
  const next = new Map(
    rows
      .filter((row) => row.forward_mode !== "off" && row.forward_extension_id)
      .map((row) => [row.id, row.forward_extension_id!]),
  );
  for (const row of rows) {
    const visited = new Set<string>();
    let current: string | undefined = row.id;
    while (current) {
      if (visited.has(current)) return true;
      visited.add(current);
      current = next.get(current);
    }
  }
  return false;
}

async function restoreExtension(row: ExtensionRow): Promise<void> {
  await pool.query(
    `INSERT INTO extensions
       (${extensionColumns})
     VALUES
       ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)`,
    [
      row.id,
      row.extension_number,
      row.display_name,
      row.secret_ciphertext,
      row.enabled,
      row.max_contacts,
      row.ring_timeout_seconds,
      row.voicemail_enabled,
      row.voicemail_pin_ciphertext,
      row.dnd_enabled,
      row.call_waiting,
      row.record_calls,
      row.pickup_group,
      row.forward_mode,
      row.forward_extension_id,
      row.created_at,
      row.updated_at,
    ],
  );
}

export function registerPbxRoutes(app: FastifyInstance): void {
  app.get("/api/pbx/extensions", async (request, reply) => {
    const user = await requireAdministrator(request, reply);
    if (!user) return;
    const rows = await allExtensions();
    const statuses = await getExtensionRegistrationStatuses(
      rows.map((row) => row.extension_number),
    );
    const byId = new Map(rows.map((row) => [row.id, row.extension_number]));
    return {
      extensions: rows.map((row) =>
        publicExtension(
          row,
          statuses.get(row.extension_number),
          row.forward_extension_id ? byId.get(row.forward_extension_id) : undefined,
        ),
      ),
    };
  });

  app.post<{ Body: ExtensionBody }>("/api/pbx/extensions", async (request, reply) => {
    const user = await requireAdministrator(request, reply);
    if (!user) return;

    const extensionNumber = request.body?.extensionNumber?.trim() ?? "";
    const displayName = request.body?.displayName?.trim().replace(/\s+/g, " ") ?? "";
    const maxContacts = Number(request.body?.maxContacts ?? 1);
    if (!/^[0-9]{2,8}$/.test(extensionNumber)) {
      return reply.code(400).send({ error: "Extension must contain 2 to 8 digits" });
    }
    if (!validDisplayName(displayName)) {
      return reply.code(400).send({
        error: "Name must start with a letter or number and use basic punctuation only",
      });
    }
    if (!Number.isInteger(maxContacts) || maxContacts < 1 || maxContacts > 10) {
      return reply.code(400).send({ error: "Maximum devices must be between 1 and 10" });
    }
    const reservedNumber = await pool.query(
      `SELECT 1 FROM ivr_menus WHERE extension_number = $1
       UNION ALL
       SELECT 1 FROM ai_receptionists WHERE extension_number = $1
       LIMIT 1`,
      [extensionNumber],
    );
    if (reservedNumber.rowCount) {
      return reply.code(409).send({ error: "That number is already used by an IVR or AI receptionist" });
    }

    try {
      const result = await serializedPbxMutation(async () => {
        const password = sipPassword();
        const inserted = await pool.query<ExtensionRow>(
          `INSERT INTO extensions
             (extension_number, display_name, secret_ciphertext, max_contacts)
           VALUES ($1, $2, $3, $4)
           RETURNING ${extensionColumns}`,
          [extensionNumber, displayName, encryptSecret(password), maxContacts],
        );
        const row = inserted.rows[0];
        if (!row) throw new Error("Extension insert did not return a record");
        try {
          await applyPbxConfiguration();
        } catch (error) {
          await pool.query("DELETE FROM extensions WHERE id = $1", [row.id]);
          await applyPbxConfiguration().catch(() => undefined);
          throw error;
        }
        return { row, password };
      });
      await audit(
        "pbx.extension.created",
        user.id,
        { extensionNumber, maxContacts },
        request.ip,
      );
      return reply.code(201).send({
        extension: publicExtension(result.row),
        credentials: {
          username: extensionNumber,
          password: result.password,
          port: 5060,
          transport: "UDP",
        },
      });
    } catch (error) {
      if ((error as { code?: string }).code === "23505") {
        return reply.code(409).send({ error: "That extension number already exists" });
      }
      request.log.error({ error }, "Extension provisioning failed");
      return reply.code(500).send({ error: "Could not provision the extension in Asterisk" });
    }
  });

  app.patch<{ Params: ExtensionParams; Body: ExtensionServicesBody }>(
    "/api/pbx/extensions/:id/services",
    async (request, reply) => {
      const user = await requireAdministrator(request, reply);
      if (!user) return;
      const existing = await extensionById(request.params.id);
      if (!existing) return reply.code(404).send({ error: "Extension not found" });

      const ringTimeoutSeconds = Number(
        request.body?.ringTimeoutSeconds ?? existing.ring_timeout_seconds,
      );
      const voicemailEnabled =
        request.body?.voicemailEnabled ?? existing.voicemail_enabled;
      const dndEnabled = request.body?.dndEnabled ?? existing.dnd_enabled;
      const callWaiting = request.body?.callWaiting ?? existing.call_waiting;
      const recordCalls = request.body?.recordCalls ?? existing.record_calls;
      const pickupGroup = request.body?.pickupGroup === undefined
        ? existing.pickup_group
        : request.body.pickupGroup;
      const forwardMode = request.body?.forwardMode ?? existing.forward_mode;
      const forwardExtensionId = forwardMode === "off"
        ? null
        : (request.body?.forwardExtensionId ?? existing.forward_extension_id);
      const voicemailPin = request.body?.voicemailPin?.trim() ?? "";

      if (!Number.isInteger(ringTimeoutSeconds) || ringTimeoutSeconds < 5 || ringTimeoutSeconds > 120) {
        return reply.code(400).send({ error: "Ring timeout must be between 5 and 120 seconds" });
      }
      if (typeof voicemailEnabled !== "boolean" || typeof dndEnabled !== "boolean" ||
          typeof callWaiting !== "boolean" || typeof recordCalls !== "boolean") {
        return reply.code(400).send({ error: "Invalid extension service setting" });
      }
      if (pickupGroup !== null && (!Number.isInteger(pickupGroup) || pickupGroup < 0 || pickupGroup > 63)) {
        return reply.code(400).send({ error: "Pickup group must be between 0 and 63" });
      }
      if (!["off", "always", "busy", "unavailable"].includes(forwardMode)) {
        return reply.code(400).send({ error: "Invalid forwarding mode" });
      }
      if (voicemailPin && !/^[0-9]{4,10}$/.test(voicemailPin)) {
        return reply.code(400).send({ error: "Voicemail PIN must contain 4 to 10 digits" });
      }
      if (voicemailEnabled && !voicemailPin && !existing.voicemail_pin_ciphertext) {
        return reply.code(400).send({ error: "Set a voicemail PIN before enabling voicemail" });
      }

      const rows = await allExtensions();
      if (forwardMode !== "off") {
        const target = rows.find((row) => row.id === forwardExtensionId && row.enabled);
        if (!target) return reply.code(400).send({ error: "Choose an active forwarding extension" });
        if (target.id === existing.id) {
          return reply.code(400).send({ error: "An extension cannot forward to itself" });
        }
      }
      const proposedRows = rows.map((row) =>
        row.id === existing.id
          ? { ...row, forward_mode: forwardMode, forward_extension_id: forwardExtensionId }
          : row,
      );
      if (hasForwardingCycle(proposedRows)) {
        return reply.code(400).send({ error: "That setting would create a forwarding loop" });
      }

      try {
        const updated = await serializedPbxMutation(async () => {
          const pinCiphertext = voicemailPin
            ? encryptSecret(voicemailPin)
            : existing.voicemail_pin_ciphertext;
          const result = await pool.query<ExtensionRow>(
            `UPDATE extensions
                SET ring_timeout_seconds = $1,
                    voicemail_enabled = $2,
                    voicemail_pin_ciphertext = $3,
                    dnd_enabled = $4,
                    call_waiting = $5,
                    record_calls = $6,
                    pickup_group = $7,
                    forward_mode = $8,
                    forward_extension_id = $9,
                    updated_at = now()
              WHERE id = $10
              RETURNING ${extensionColumns}`,
            [
              ringTimeoutSeconds,
              voicemailEnabled,
              pinCiphertext,
              dndEnabled,
              callWaiting,
              recordCalls,
              pickupGroup,
              forwardMode,
              forwardExtensionId,
              existing.id,
            ],
          );
          const row = result.rows[0];
          if (!row) throw new Error("Extension update did not return a record");
          try {
            await applyPbxConfiguration();
          } catch (error) {
            await pool.query(
              `UPDATE extensions
                  SET ring_timeout_seconds = $1, voicemail_enabled = $2,
                      voicemail_pin_ciphertext = $3, dnd_enabled = $4,
                      call_waiting = $5, record_calls = $6, pickup_group = $7,
                      forward_mode = $8, forward_extension_id = $9, updated_at = $10
                WHERE id = $11`,
              [
                existing.ring_timeout_seconds,
                existing.voicemail_enabled,
                existing.voicemail_pin_ciphertext,
                existing.dnd_enabled,
                existing.call_waiting,
                existing.record_calls,
                existing.pickup_group,
                existing.forward_mode,
                existing.forward_extension_id,
                existing.updated_at,
                existing.id,
              ],
            );
            await applyPbxConfiguration().catch(() => undefined);
            throw error;
          }
          return row;
        });
        await audit(
          "pbx.extension.services_updated",
          user.id,
          {
            extensionNumber: existing.extension_number,
            voicemailEnabled,
            dndEnabled,
            callWaiting,
            recordCalls,
            pickupGroup,
            forwardMode,
          },
          request.ip,
        );
        const targetNumber = forwardExtensionId
          ? rows.find((row) => row.id === forwardExtensionId)?.extension_number
          : undefined;
        return { extension: publicExtension(updated, undefined, targetNumber) };
      } catch (error) {
        request.log.error({ error }, "Extension service update failed");
        return reply.code(500).send({ error: "Could not apply the extension services" });
      }
    },
  );

  app.post<{ Params: ExtensionParams }>(
    "/api/pbx/extensions/:id/reset-secret",
    async (request, reply) => {
      const user = await requireAdministrator(request, reply);
      if (!user) return;
      const existing = await extensionById(request.params.id);
      if (!existing) return reply.code(404).send({ error: "Extension not found" });

      try {
        const password = await serializedPbxMutation(async () => {
          const newPassword = sipPassword();
          await pool.query(
            `UPDATE extensions
                SET secret_ciphertext = $1, updated_at = now()
              WHERE id = $2`,
            [encryptSecret(newPassword), existing.id],
          );
          try {
            await applyPbxConfiguration();
          } catch (error) {
            await pool.query(
              `UPDATE extensions
                  SET secret_ciphertext = $1, updated_at = $2
                WHERE id = $3`,
              [existing.secret_ciphertext, existing.updated_at, existing.id],
            );
            await applyPbxConfiguration().catch(() => undefined);
            throw error;
          }
          return newPassword;
        });
        await audit(
          "pbx.extension.secret_reset",
          user.id,
          { extensionNumber: existing.extension_number },
          request.ip,
        );
        return {
          credentials: {
            username: existing.extension_number,
            password,
            port: 5060,
            transport: "UDP",
          },
        };
      } catch (error) {
        request.log.error({ error }, "Extension credential reset failed");
        return reply.code(500).send({ error: "Could not reset the extension credentials" });
      }
    },
  );

  app.delete<{ Params: ExtensionParams }>(
    "/api/pbx/extensions/:id",
    async (request, reply) => {
      const user = await requireAdministrator(request, reply);
      if (!user) return;
      const existing = await extensionById(request.params.id);
      if (!existing) return reply.code(404).send({ error: "Extension not found" });

      const didRoutes = await pool.query<{ count: string }>(
        "SELECT count(*) FROM did_routes WHERE extension_id = $1",
        [existing.id],
      );
      if (Number(didRoutes.rows[0]?.count ?? 0) > 0) {
        return reply.code(409).send({ error: "Delete this extension's DID routes first" });
      }
      const ivrRoutes = await pool.query<{ count: string }>(
        `SELECT
           (SELECT count(*) FROM ivr_options WHERE destination_extension_id = $1) +
           (SELECT count(*) FROM ivr_menus WHERE fallback_extension_id = $1) AS count`,
        [existing.id],
      );
      if (Number(ivrRoutes.rows[0]?.count ?? 0) > 0) {
        return reply.code(409).send({ error: "Remove this extension from IVR destinations first" });
      }
      const aiRoutes = await pool.query<{ count: string }>(
        "SELECT count(*) FROM ai_receptionists WHERE handoff_extension_id = $1",
        [existing.id],
      );
      if (Number(aiRoutes.rows[0]?.count ?? 0) > 0) {
        return reply.code(409).send({ error: "Remove this extension from AI human handoff first" });
      }
      const callCentreRoutes = await pool.query<{ count: string }>(
        `SELECT
           (SELECT count(*) FROM call_group_members WHERE extension_id = $1) +
           (SELECT count(*) FROM call_groups WHERE fallback_extension_id = $1) AS count`,
        [existing.id],
      );
      if (Number(callCentreRoutes.rows[0]?.count ?? 0) > 0) {
        return reply.code(409).send({ error: "Remove this extension from call-centre groups first" });
      }
      const agentAccounts = await pool.query<{ count: string }>(
        "SELECT count(*) FROM users WHERE role = 'agent' AND extension_id = $1",
        [existing.id],
      );
      if (Number(agentAccounts.rows[0]?.count ?? 0) > 0) {
        return reply.code(409).send({ error: "Delete or reassign this extension's agent account first" });
      }

      try {
        await serializedPbxMutation(async () => {
          const referring = (await allExtensions()).filter(
            (row) => row.forward_extension_id === existing.id,
          );
          await pool.query(
            `UPDATE extensions
                SET forward_mode = 'off', forward_extension_id = NULL, updated_at = now()
              WHERE forward_extension_id = $1`,
            [existing.id],
          );
          await pool.query("DELETE FROM extensions WHERE id = $1", [existing.id]);
          try {
            await applyPbxConfiguration();
          } catch (error) {
            await restoreExtension(existing);
            for (const row of referring) {
              await pool.query(
                `UPDATE extensions
                    SET forward_mode = $1, forward_extension_id = $2, updated_at = $3
                  WHERE id = $4`,
                [row.forward_mode, row.forward_extension_id, row.updated_at, row.id],
              );
            }
            await applyPbxConfiguration().catch(() => undefined);
            throw error;
          }
        });
        await audit(
          "pbx.extension.deleted",
          user.id,
          { extensionNumber: existing.extension_number },
          request.ip,
        );
        return reply.code(204).send();
      } catch (error) {
        request.log.error({ error }, "Extension deletion failed");
        return reply.code(500).send({ error: "Could not remove the extension from Asterisk" });
      }
    },
  );

  app.post<{ Body: ExtensionBody }>("/api/customer/extensions", async (request, reply) => {
    const user = await requireCustomer(request, reply);
    if (!user?.customerId) return;
    const displayName = request.body?.displayName?.trim().replace(/\s+/g, " ") ?? "";
    const maxContacts = Number(request.body?.maxContacts ?? 1);
    if (!validDisplayName(displayName)) {
      return reply.code(400).send({
        error: "Name must start with a letter or number and use basic punctuation only",
      });
    }
    if (!Number.isInteger(maxContacts) || maxContacts < 1 || maxContacts > 10) {
      return reply.code(400).send({ error: "Maximum devices must be between 1 and 10" });
    }
    const entitlementResult = await pool.query<{
      active: boolean;
      extension_range_start: number | null;
      extension_range_end: number | null;
      max_extensions: number;
      self_service_extensions: boolean;
      plan_enabled: boolean;
      extension_count: string;
      delegated_extensions: string;
    }>(
      `SELECT customers.active, customers.extension_range_start,
              customers.extension_range_end, plans.max_extensions,
              plans.self_service_extensions, plans.enabled AS plan_enabled,
              (SELECT count(*) FROM customer_extensions
                WHERE customer_id=customers.id)::text AS extension_count,
              (SELECT COALESCE(sum(child_plans.max_extensions),0)::text
                 FROM customers AS child_accounts
                 JOIN customer_service_plans AS child_plans
                   ON child_plans.id=child_accounts.service_plan_id
                WHERE child_accounts.parent_customer_id=customers.id
              ) AS delegated_extensions
         FROM customers
         JOIN customer_service_plans AS plans
           ON plans.id=customers.service_plan_id
        WHERE customers.id=$1`,
      [user.customerId],
    );
    const entitlement = entitlementResult.rows[0];
    if (!entitlement) return reply.code(403).send({ error: "A customer service plan must be assigned" });
    if (!entitlement.active) return reply.code(403).send({ error: "Customer account is disabled" });
    if (!entitlement.plan_enabled) return reply.code(403).send({ error: "Customer service plan is disabled" });
    if (!entitlement.self_service_extensions) {
      return reply.code(403).send({ error: "Extension self-service is not included in this plan" });
    }
    if (entitlement.extension_range_start === null || entitlement.extension_range_end === null) {
      return reply.code(409).send({ error: "An administrator must assign an extension number range first" });
    }
    if (
      Number(entitlement.extension_count) + Number(entitlement.delegated_extensions)
      >= entitlement.max_extensions
    ) {
      return reply.code(409).send({ error: `This plan permits ${entitlement.max_extensions} extensions` });
    }

    try {
      const result = await serializedPbxMutation(async () => {
        const candidateResult = await pool.query<{ extension_number: string }>(
          `SELECT candidate::text AS extension_number
             FROM generate_series($1::integer, $2::integer) AS candidate
            WHERE NOT EXISTS (
                    SELECT 1 FROM extensions
                     WHERE extension_number=candidate::text
                  )
              AND NOT EXISTS (
                    SELECT 1 FROM ivr_menus
                     WHERE extension_number=candidate::text
                  )
              AND NOT EXISTS (
                    SELECT 1 FROM ai_receptionists
                     WHERE extension_number=candidate::text
                  )
              AND NOT EXISTS (
                    SELECT 1 FROM call_groups
                     WHERE extension_number=candidate::text
                  )
              AND NOT EXISTS (
                    SELECT 1 FROM customers AS child_accounts
                     WHERE child_accounts.parent_customer_id=$3
                       AND child_accounts.extension_range_start IS NOT NULL
                       AND child_accounts.extension_range_end IS NOT NULL
                       AND candidate BETWEEN child_accounts.extension_range_start
                                         AND child_accounts.extension_range_end
                  )
            ORDER BY candidate
            LIMIT 1`,
          [
            entitlement.extension_range_start,
            entitlement.extension_range_end,
            user.customerId,
          ],
        );
        const extensionNumber = candidateResult.rows[0]?.extension_number;
        if (!extensionNumber) throw new Error("EXTENSION_RANGE_EXHAUSTED");
        const password = sipPassword();
        const inserted = await pool.query<ExtensionRow>(
          `INSERT INTO extensions
             (extension_number, display_name, secret_ciphertext, max_contacts)
           VALUES ($1,$2,$3,$4)
           RETURNING ${extensionColumns}`,
          [extensionNumber, displayName, encryptSecret(password), maxContacts],
        );
        const row = inserted.rows[0];
        if (!row) throw new Error("Extension insert did not return a record");
        await pool.query(
          `INSERT INTO customer_extensions (customer_id, extension_id, assigned_by)
           VALUES ($1,$2,$3)`,
          [user.customerId, row.id, user.id],
        );
        try {
          await applyPbxConfiguration();
        } catch (error) {
          await pool.query("DELETE FROM extensions WHERE id=$1", [row.id]);
          await applyPbxConfiguration().catch(() => undefined);
          throw error;
        }
        return { row, password };
      });
      await audit("customer.extension.created", user.id, {
        customerId: user.customerId,
        extensionNumber: result.row.extension_number,
      }, request.ip);
      return reply.code(201).send({
        extension: publicExtension(result.row),
        credentials: {
          username: result.row.extension_number,
          password: result.password,
          port: 5060,
          transport: "UDP",
        },
      });
    } catch (error) {
      if ((error as Error).message === "EXTENSION_RANGE_EXHAUSTED") {
        return reply.code(409).send({ error: "No free numbers remain in the assigned extension range" });
      }
      request.log.error({ error }, "Customer extension provisioning failed");
      return reply.code(500).send({ error: "Could not provision the extension in Asterisk" });
    }
  });

  app.patch<{ Params: ExtensionParams; Body: ExtensionServicesBody }>(
    "/api/customer/extensions/:id/services",
    async (request, reply) => {
      const user = await requireCustomer(request, reply);
      if (!user?.customerId) return;
      const existing = await customerExtensionById(user.customerId, request.params.id);
      if (!existing) return reply.code(404).send({ error: "Extension not found" });
      const planResult = await pool.query<{
        recording_enabled: boolean;
        recording_storage_mb: number;
      }>(
        `SELECT plans.recording_enabled, plans.recording_storage_mb
           FROM customers
           JOIN customer_service_plans AS plans ON plans.id=customers.service_plan_id
          WHERE customers.id=$1 AND customers.active=true AND plans.enabled=true`,
        [user.customerId],
      );
      const plan = planResult.rows[0];
      if (!plan) return reply.code(403).send({ error: "Customer service plan is unavailable" });

      const ringTimeoutSeconds = Number(request.body?.ringTimeoutSeconds ?? existing.ring_timeout_seconds);
      const voicemailEnabled = request.body?.voicemailEnabled ?? existing.voicemail_enabled;
      const dndEnabled = request.body?.dndEnabled ?? existing.dnd_enabled;
      const callWaiting = request.body?.callWaiting ?? existing.call_waiting;
      const recordCalls = request.body?.recordCalls ?? existing.record_calls;
      const forwardMode = request.body?.forwardMode ?? existing.forward_mode;
      const forwardExtensionId = forwardMode === "off"
        ? null
        : (request.body?.forwardExtensionId ?? existing.forward_extension_id);
      const voicemailPin = request.body?.voicemailPin?.trim() ?? "";
      if (!Number.isInteger(ringTimeoutSeconds) || ringTimeoutSeconds < 5 || ringTimeoutSeconds > 120) {
        return reply.code(400).send({ error: "Ring timeout must be between 5 and 120 seconds" });
      }
      if (typeof voicemailEnabled !== "boolean" || typeof dndEnabled !== "boolean"
          || typeof callWaiting !== "boolean" || typeof recordCalls !== "boolean") {
        return reply.code(400).send({ error: "Invalid extension service setting" });
      }
      if (recordCalls && !plan.recording_enabled) {
        return reply.code(403).send({ error: "Call recording is not included in this service plan" });
      }
      if (recordCalls && !existing.record_calls) {
        const storage = await customerRecordingStorageSummary(user.customerId);
        const storageLimitBytes = Math.max(0, plan.recording_storage_mb) * 1024 * 1024;
        if (storageLimitBytes === 0 || storage.bytes >= storageLimitBytes) {
          return reply.code(409).send({
            error: "Recording storage allowance is full. Delete older recordings or ask an administrator to increase the plan allowance",
          });
        }
      }
      if (!["off", "always", "busy", "unavailable"].includes(forwardMode)) {
        return reply.code(400).send({ error: "Invalid forwarding mode" });
      }
      if (voicemailPin && !/^[0-9]{4,10}$/.test(voicemailPin)) {
        return reply.code(400).send({ error: "Voicemail PIN must contain 4 to 10 digits" });
      }
      if (voicemailEnabled && !voicemailPin && !existing.voicemail_pin_ciphertext) {
        return reply.code(400).send({ error: "Set a voicemail PIN before enabling voicemail" });
      }
      const rows = await allExtensions();
      const ownedIds = new Set((await pool.query<{ extension_id: string }>(
        "SELECT extension_id FROM customer_extensions WHERE customer_id=$1",
        [user.customerId],
      )).rows.map((row) => row.extension_id));
      if (forwardMode !== "off") {
        const target = rows.find((row) => row.id === forwardExtensionId && row.enabled && ownedIds.has(row.id));
        if (!target) return reply.code(400).send({ error: "Choose another extension from this customer account" });
        if (target.id === existing.id) return reply.code(400).send({ error: "An extension cannot forward to itself" });
      }
      const proposedRows = rows.map((row) => row.id === existing.id
        ? { ...row, forward_mode: forwardMode, forward_extension_id: forwardExtensionId }
        : row);
      if (hasForwardingCycle(proposedRows)) {
        return reply.code(400).send({ error: "That setting would create a forwarding loop" });
      }

      try {
        const updated = await serializedPbxMutation(async () => {
          const pinCiphertext = voicemailPin ? encryptSecret(voicemailPin) : existing.voicemail_pin_ciphertext;
          const result = await pool.query<ExtensionRow>(
            `UPDATE extensions
                SET ring_timeout_seconds=$1, voicemail_enabled=$2,
                    voicemail_pin_ciphertext=$3, dnd_enabled=$4,
                    call_waiting=$5, record_calls=$6, forward_mode=$7,
                    forward_extension_id=$8, updated_at=now()
              WHERE id=$9
              RETURNING ${extensionColumns}`,
            [
              ringTimeoutSeconds, voicemailEnabled, pinCiphertext, dndEnabled,
              callWaiting, recordCalls, forwardMode, forwardExtensionId, existing.id,
            ],
          );
          const row = result.rows[0];
          if (!row) throw new Error("Extension update did not return a record");
          try {
            await applyPbxConfiguration();
          } catch (error) {
            await pool.query(
              `UPDATE extensions
                  SET ring_timeout_seconds=$1, voicemail_enabled=$2,
                      voicemail_pin_ciphertext=$3, dnd_enabled=$4,
                      call_waiting=$5, record_calls=$6, forward_mode=$7,
                      forward_extension_id=$8, updated_at=$9
                WHERE id=$10`,
              [
                existing.ring_timeout_seconds, existing.voicemail_enabled,
                existing.voicemail_pin_ciphertext, existing.dnd_enabled,
                existing.call_waiting, existing.record_calls, existing.forward_mode,
                existing.forward_extension_id, existing.updated_at, existing.id,
              ],
            );
            await applyPbxConfiguration().catch(() => undefined);
            throw error;
          }
          return row;
        });
        await audit("customer.extension.services_updated", user.id, {
          customerId: user.customerId,
          extensionNumber: existing.extension_number,
          voicemailEnabled, dndEnabled, callWaiting, recordCalls, forwardMode,
        }, request.ip);
        const targetNumber = forwardExtensionId
          ? rows.find((row) => row.id === forwardExtensionId)?.extension_number
          : undefined;
        return { extension: publicExtension(updated, undefined, targetNumber) };
      } catch (error) {
        request.log.error({ error }, "Customer extension service update failed");
        return reply.code(500).send({ error: "Could not apply the extension services" });
      }
    },
  );

  app.post<{ Params: ExtensionParams }>(
    "/api/customer/extensions/:id/reset-secret",
    async (request, reply) => {
      const user = await requireCustomer(request, reply);
      if (!user?.customerId) return;
      const existing = await customerExtensionById(user.customerId, request.params.id);
      if (!existing) return reply.code(404).send({ error: "Extension not found" });
      try {
        const password = await serializedPbxMutation(async () => {
          const newPassword = sipPassword();
          await pool.query(
            "UPDATE extensions SET secret_ciphertext=$1, updated_at=now() WHERE id=$2",
            [encryptSecret(newPassword), existing.id],
          );
          try {
            await applyPbxConfiguration();
          } catch (error) {
            await pool.query(
              "UPDATE extensions SET secret_ciphertext=$1, updated_at=$2 WHERE id=$3",
              [existing.secret_ciphertext, existing.updated_at, existing.id],
            );
            await applyPbxConfiguration().catch(() => undefined);
            throw error;
          }
          return newPassword;
        });
        await audit("customer.extension.secret_reset", user.id, {
          customerId: user.customerId,
          extensionNumber: existing.extension_number,
        }, request.ip);
        return {
          credentials: {
            username: existing.extension_number,
            password,
            port: 5060,
            transport: "UDP",
          },
        };
      } catch (error) {
        request.log.error({ error }, "Customer extension credential reset failed");
        return reply.code(500).send({ error: "Could not reset the extension credentials" });
      }
    },
  );
}
