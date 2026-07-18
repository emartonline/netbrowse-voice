import type { FastifyInstance } from "fastify";
import type { PoolClient } from "pg";
import { requireAdministrator } from "./auth.js";
import { audit, pool } from "./database.js";
import { applyPbxConfiguration, serializedPbxMutation } from "./pbx.js";
import { soundFileStat } from "./sound-studio.js";

interface IvrMenuRow {
  id: string;
  name: string;
  extension_number: string;
  greeting_sound_asset_id: string;
  timeout_seconds: number;
  max_attempts: number;
  fallback_extension_id: string | null;
  enabled: boolean;
  created_by: string | null;
  created_at: Date;
  updated_at: Date;
}

interface IvrOptionRow {
  ivr_menu_id: string;
  digit: string;
  destination_extension_id: string;
}

interface IvrBody {
  name?: string;
  internalNumber?: string;
  greetingSoundId?: string;
  timeoutSeconds?: number;
  maxAttempts?: number;
  fallbackExtensionId?: string | null;
  enabled?: boolean;
  options?: Array<{ digit?: string; extensionId?: string }>;
}

interface IvrParams {
  id: string;
}

interface ValidatedIvr {
  name: string;
  internalNumber: string;
  greetingSoundId: string;
  timeoutSeconds: number;
  maxAttempts: number;
  fallbackExtensionId: string | null;
  enabled: boolean;
  options: Array<{ digit: string; extensionId: string }>;
}

const menuColumns = `id, name, extension_number, greeting_sound_asset_id,
  timeout_seconds, max_attempts, fallback_extension_id, enabled, created_by,
  created_at, updated_at`;

function validUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function validName(value: string): boolean {
  return value.length >= 2 && value.length <= 80 && !/[\u0000-\u001f<>]/.test(value);
}

async function menuById(id: string): Promise<IvrMenuRow | undefined> {
  if (!validUuid(id)) return undefined;
  const result = await pool.query<IvrMenuRow>(
    `SELECT ${menuColumns} FROM ivr_menus WHERE id = $1`,
    [id],
  );
  return result.rows[0];
}

async function optionRows(menuId: string): Promise<IvrOptionRow[]> {
  const result = await pool.query<IvrOptionRow>(
    `SELECT ivr_menu_id, digit, destination_extension_id
       FROM ivr_options
      WHERE ivr_menu_id = $1
      ORDER BY digit`,
    [menuId],
  );
  return result.rows;
}

async function replaceOptions(
  client: PoolClient,
  menuId: string,
  options: Array<{ digit: string; extensionId: string }>,
): Promise<void> {
  await client.query("DELETE FROM ivr_options WHERE ivr_menu_id = $1", [menuId]);
  for (const option of options) {
    await client.query(
      `INSERT INTO ivr_options (ivr_menu_id, digit, destination_extension_id)
       VALUES ($1, $2, $3)`,
      [menuId, option.digit, option.extensionId],
    );
  }
}

async function restoreMenu(menu: IvrMenuRow, options: IvrOptionRow[]): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO ivr_menus (${menuColumns})
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       ON CONFLICT (id) DO UPDATE SET
         name = EXCLUDED.name,
         extension_number = EXCLUDED.extension_number,
         greeting_sound_asset_id = EXCLUDED.greeting_sound_asset_id,
         timeout_seconds = EXCLUDED.timeout_seconds,
         max_attempts = EXCLUDED.max_attempts,
         fallback_extension_id = EXCLUDED.fallback_extension_id,
         enabled = EXCLUDED.enabled,
         created_by = EXCLUDED.created_by,
         created_at = EXCLUDED.created_at,
         updated_at = EXCLUDED.updated_at`,
      [
        menu.id, menu.name, menu.extension_number, menu.greeting_sound_asset_id,
        menu.timeout_seconds, menu.max_attempts, menu.fallback_extension_id,
        menu.enabled, menu.created_by, menu.created_at, menu.updated_at,
      ],
    );
    await replaceOptions(client, menu.id, options.map((option) => ({
      digit: option.digit,
      extensionId: option.destination_extension_id,
    })));
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function validateIvrBody(
  body: IvrBody | undefined,
  existing?: IvrMenuRow,
): Promise<{ value?: ValidatedIvr; error?: string }> {
  const name = body?.name?.trim().replace(/\s+/g, " ") ?? existing?.name ?? "";
  const internalNumber = body?.internalNumber?.trim() ?? existing?.extension_number ?? "";
  const greetingSoundId = body?.greetingSoundId ?? existing?.greeting_sound_asset_id ?? "";
  const timeoutSeconds = Number(body?.timeoutSeconds ?? existing?.timeout_seconds ?? 7);
  const maxAttempts = Number(body?.maxAttempts ?? existing?.max_attempts ?? 3);
  const fallbackExtensionId = body?.fallbackExtensionId === undefined
    ? (existing?.fallback_extension_id ?? null)
    : (body.fallbackExtensionId || null);
  const enabled = body?.enabled ?? existing?.enabled ?? true;
  const rawOptions = body?.options ?? [];

  if (!validName(name)) return { error: "Menu name must contain between 2 and 80 characters" };
  if (!/^[0-9]{2,8}$/.test(internalNumber)) {
    return { error: "Internal IVR number must contain 2 to 8 digits" };
  }
  if (!validUuid(greetingSoundId)) return { error: "Choose a Sound Studio greeting" };
  if (!Number.isInteger(timeoutSeconds) || timeoutSeconds < 2 || timeoutSeconds > 30) {
    return { error: "Input timeout must be between 2 and 30 seconds" };
  }
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 5) {
    return { error: "Invalid attempts must be between 1 and 5" };
  }
  if (typeof enabled !== "boolean") return { error: "Invalid menu state" };
  if (!Array.isArray(rawOptions) || rawOptions.length < 1 || rawOptions.length > 10) {
    return { error: "Add between 1 and 10 keypad destinations" };
  }

  const options: Array<{ digit: string; extensionId: string }> = [];
  const digits = new Set<string>();
  for (const item of rawOptions) {
    const digit = item.digit?.trim() ?? "";
    const extensionId = item.extensionId ?? "";
    if (!/^[0-9]$/.test(digit)) return { error: "Every keypad option must use a digit from 0 to 9" };
    if (digits.has(digit)) return { error: `Key ${digit} is assigned more than once` };
    if (!validUuid(extensionId)) return { error: `Choose a destination for key ${digit}` };
    digits.add(digit);
    options.push({ digit, extensionId });
  }
  if (fallbackExtensionId !== null && !validUuid(fallbackExtensionId)) {
    return { error: "Choose a valid fallback extension or hang up" };
  }

  const [extensionCollision, menuCollision, aiCollision, soundResult, extensionResult] = await Promise.all([
    pool.query("SELECT 1 FROM extensions WHERE extension_number = $1 LIMIT 1", [internalNumber]),
    pool.query(
      "SELECT 1 FROM ivr_menus WHERE extension_number = $1 AND id <> $2::uuid LIMIT 1",
      [internalNumber, existing?.id ?? "00000000-0000-0000-0000-000000000000"],
    ),
    pool.query(
      "SELECT 1 FROM ai_receptionists WHERE extension_number = $1 LIMIT 1",
      [internalNumber],
    ),
    pool.query<{ filename: string }>(
      "SELECT filename FROM sound_assets WHERE id = $1",
      [greetingSoundId],
    ),
    pool.query<{ id: string }>("SELECT id FROM extensions WHERE enabled = true"),
  ]);
  if (extensionCollision.rowCount) return { error: "That number is already used by an extension" };
  if (menuCollision.rowCount) return { error: "That number is already used by another IVR" };
  if (aiCollision.rowCount) return { error: "That number is already used by an AI receptionist" };
  const sound = soundResult.rows[0];
  if (!sound || !(await soundFileStat(sound.filename))) {
    return { error: "The selected greeting audio is unavailable" };
  }
  const activeExtensionIds = new Set(extensionResult.rows.map((row) => row.id));
  for (const option of options) {
    if (!activeExtensionIds.has(option.extensionId)) {
      return { error: `Key ${option.digit} must route to an active extension` };
    }
  }
  if (fallbackExtensionId && !activeExtensionIds.has(fallbackExtensionId)) {
    return { error: "The fallback must route to an active extension" };
  }
  return {
    value: {
      name, internalNumber, greetingSoundId, timeoutSeconds, maxAttempts,
      fallbackExtensionId, enabled, options,
    },
  };
}

export function registerIvrRoutes(app: FastifyInstance): void {
  app.get("/api/ivrs", async (request, reply) => {
    const user = await requireAdministrator(request, reply);
    if (!user) return;
    const [menus, options, sounds, extensions] = await Promise.all([
      pool.query<IvrMenuRow>(
        `SELECT ${menuColumns} FROM ivr_menus
         ORDER BY length(extension_number), extension_number`,
      ),
      pool.query<{
        ivr_menu_id: string;
        digit: string;
        destination_extension_id: string;
        extension_number: string;
        display_name: string;
      }>(
        `SELECT options.ivr_menu_id, options.digit, options.destination_extension_id,
                extensions.extension_number, extensions.display_name
           FROM ivr_options AS options
           JOIN extensions ON extensions.id = options.destination_extension_id
          ORDER BY options.ivr_menu_id, options.digit`,
      ),
      pool.query<{
        id: string; name: string; filename: string; provider: string; voice: string;
      }>(
        `SELECT id, name, filename, provider, voice
           FROM sound_assets ORDER BY created_at DESC`,
      ),
      pool.query<{ id: string; extension_number: string; display_name: string }>(
        `SELECT id, extension_number, display_name FROM extensions
          WHERE enabled = true ORDER BY length(extension_number), extension_number`,
      ),
    ]);
    const optionsByMenu = new Map<string, typeof options.rows>();
    for (const option of options.rows) {
      const items = optionsByMenu.get(option.ivr_menu_id) ?? [];
      items.push(option);
      optionsByMenu.set(option.ivr_menu_id, items);
    }
    const soundById = new Map(sounds.rows.map((sound) => [sound.id, sound]));
    const extensionById = new Map(extensions.rows.map((extension) => [extension.id, extension]));
    const publicSounds = [];
    for (const sound of sounds.rows) {
      if (await soundFileStat(sound.filename)) {
        publicSounds.push({
          id: sound.id,
          name: sound.name,
          provider: sound.provider,
          voice: sound.voice,
        });
      }
    }
    return {
      ivrs: menus.rows.map((menu) => ({
        id: menu.id,
        name: menu.name,
        internalNumber: menu.extension_number,
        greetingSoundId: menu.greeting_sound_asset_id,
        greetingSoundName: soundById.get(menu.greeting_sound_asset_id)?.name ?? "Unavailable sound",
        timeoutSeconds: menu.timeout_seconds,
        maxAttempts: menu.max_attempts,
        fallbackExtensionId: menu.fallback_extension_id,
        fallbackExtensionNumber: menu.fallback_extension_id
          ? extensionById.get(menu.fallback_extension_id)?.extension_number ?? null
          : null,
        enabled: menu.enabled,
        options: (optionsByMenu.get(menu.id) ?? []).map((option) => ({
          digit: option.digit,
          extensionId: option.destination_extension_id,
          extensionNumber: option.extension_number,
          extensionName: option.display_name,
        })),
        createdAt: menu.created_at,
        updatedAt: menu.updated_at,
      })),
      sounds: publicSounds,
      extensions: extensions.rows.map((extension) => ({
        id: extension.id,
        extensionNumber: extension.extension_number,
        displayName: extension.display_name,
      })),
    };
  });

  app.post<{ Body: IvrBody }>("/api/ivrs", async (request, reply) => {
    const user = await requireAdministrator(request, reply);
    if (!user) return;
    const validated = await validateIvrBody(request.body);
    if (!validated.value) return reply.code(400).send({ error: validated.error });
    const value = validated.value;
    try {
      const menu = await serializedPbxMutation(async () => {
        const client = await pool.connect();
        let inserted: IvrMenuRow | undefined;
        try {
          await client.query("BEGIN");
          const result = await client.query<IvrMenuRow>(
            `INSERT INTO ivr_menus
               (name, extension_number, greeting_sound_asset_id, timeout_seconds,
                max_attempts, fallback_extension_id, enabled, created_by)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
             RETURNING ${menuColumns}`,
            [value.name, value.internalNumber, value.greetingSoundId, value.timeoutSeconds,
              value.maxAttempts, value.fallbackExtensionId, value.enabled, user.id],
          );
          inserted = result.rows[0];
          if (!inserted) throw new Error("IVR insert did not return a row");
          await replaceOptions(client, inserted.id, value.options);
          await client.query("COMMIT");
        } catch (error) {
          await client.query("ROLLBACK").catch(() => undefined);
          throw error;
        } finally {
          client.release();
        }
        try {
          await applyPbxConfiguration();
        } catch (error) {
          await pool.query("DELETE FROM ivr_menus WHERE id = $1", [inserted.id]);
          await applyPbxConfiguration().catch(() => undefined);
          throw error;
        }
        return inserted;
      });
      await audit("ivr.created", user.id, {
        ivrId: menu.id,
        internalNumber: menu.extension_number,
        optionCount: value.options.length,
      }, request.ip);
      return reply.code(201).send({ id: menu.id });
    } catch (error) {
      if ((error as { code?: string }).code === "23505") {
        return reply.code(409).send({ error: "That internal IVR number is already in use" });
      }
      request.log.error({ error }, "IVR creation failed");
      return reply.code(500).send({ error: "Could not publish the IVR to Asterisk" });
    }
  });

  app.patch<{ Params: IvrParams; Body: IvrBody }>("/api/ivrs/:id", async (request, reply) => {
    const user = await requireAdministrator(request, reply);
    if (!user) return;
    const existing = await menuById(request.params.id);
    if (!existing) return reply.code(404).send({ error: "IVR not found" });
    const existingOptions = await optionRows(existing.id);
    const body = request.body?.options === undefined
      ? {
          ...request.body,
          options: existingOptions.map((option) => ({
            digit: option.digit,
            extensionId: option.destination_extension_id,
          })),
        }
      : request.body;
    const validated = await validateIvrBody(body, existing);
    if (!validated.value) return reply.code(400).send({ error: validated.error });
    const value = validated.value;
    try {
      await serializedPbxMutation(async () => {
        const client = await pool.connect();
        try {
          await client.query("BEGIN");
          await client.query(
            `UPDATE ivr_menus SET
                name = $1, extension_number = $2, greeting_sound_asset_id = $3,
                timeout_seconds = $4, max_attempts = $5,
                fallback_extension_id = $6, enabled = $7, updated_at = now()
              WHERE id = $8`,
            [value.name, value.internalNumber, value.greetingSoundId, value.timeoutSeconds,
              value.maxAttempts, value.fallbackExtensionId, value.enabled, existing.id],
          );
          await replaceOptions(client, existing.id, value.options);
          await client.query("COMMIT");
        } catch (error) {
          await client.query("ROLLBACK").catch(() => undefined);
          throw error;
        } finally {
          client.release();
        }
        try {
          await applyPbxConfiguration();
        } catch (error) {
          await restoreMenu(existing, existingOptions);
          await applyPbxConfiguration().catch(() => undefined);
          throw error;
        }
      });
      await audit("ivr.updated", user.id, {
        ivrId: existing.id,
        internalNumber: value.internalNumber,
        enabled: value.enabled,
      }, request.ip);
      return { id: existing.id };
    } catch (error) {
      if ((error as { code?: string }).code === "23505") {
        return reply.code(409).send({ error: "That internal IVR number is already in use" });
      }
      request.log.error({ error }, "IVR update failed");
      return reply.code(500).send({ error: "Could not update the IVR in Asterisk" });
    }
  });

  app.delete<{ Params: IvrParams }>("/api/ivrs/:id", async (request, reply) => {
    const user = await requireAdministrator(request, reply);
    if (!user) return;
    const existing = await menuById(request.params.id);
    if (!existing) return reply.code(404).send({ error: "IVR not found" });
    const didRoutes = await pool.query<{ count: string }>(
      "SELECT count(*) FROM did_routes WHERE ivr_menu_id = $1",
      [existing.id],
    );
    if (Number(didRoutes.rows[0]?.count ?? 0) > 0) {
      return reply.code(409).send({ error: "Delete this IVR's inbound DID routes first" });
    }
    const existingOptions = await optionRows(existing.id);
    try {
      await serializedPbxMutation(async () => {
        await pool.query("DELETE FROM ivr_menus WHERE id = $1", [existing.id]);
        try {
          await applyPbxConfiguration();
        } catch (error) {
          await restoreMenu(existing, existingOptions);
          await applyPbxConfiguration().catch(() => undefined);
          throw error;
        }
      });
      await audit("ivr.deleted", user.id, {
        ivrId: existing.id,
        internalNumber: existing.extension_number,
      }, request.ip);
      return reply.code(204).send();
    } catch (error) {
      request.log.error({ error }, "IVR deletion failed");
      return reply.code(500).send({ error: "Could not remove the IVR from Asterisk" });
    }
  });
}
