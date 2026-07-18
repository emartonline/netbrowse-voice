import type { FastifyInstance, FastifyReply } from "fastify";
import { requireCustomer } from "./auth.js";
import { audit, pool } from "./database.js";

const MAX_LOGO_BYTES = 384 * 1024;
const DEFAULT_PRIMARY = "#0B243A";
const DEFAULT_ACCENT = "#FF7A1A";

interface SlugParams { slug: string }
interface BrandingBody {
  slug?: string;
  brandName?: string;
  portalTitle?: string;
  primaryColor?: string;
  accentColor?: string;
  supportEmail?: string;
  supportPhone?: string;
  websiteUrl?: string;
  enabled?: boolean;
}
interface LogoBody { dataUrl?: string }

interface BrandingRow {
  customer_id: string | null;
  slug: string | null;
  brand_name: string | null;
  portal_title: string | null;
  primary_color: string | null;
  accent_color: string | null;
  support_email: string | null;
  support_phone: string | null;
  website_url: string | null;
  logo_mime_type: string | null;
  enabled: boolean | null;
  updated_at: Date | null;
}

export interface PublicBranding {
  slug: string;
  brandName: string;
  portalTitle: string;
  primaryColor: string;
  accentColor: string;
  supportEmail: string;
  supportPhone: string;
  websiteUrl: string;
  logoUrl: string | null;
  loginPath: string;
}

function textValue(value: unknown, label: string, minimum: number, maximum: number): string {
  const text = typeof value === "string" ? value.trim() : "";
  if (text.length < minimum || text.length > maximum || /[\u0000-\u001f\u007f]/.test(text)) {
    throw new Error(`Enter a valid ${label}`);
  }
  return text;
}

function optionalText(value: unknown, label: string, maximum: number): string {
  if (value === undefined || value === null || value === "") return "";
  return textValue(value, label, 2, maximum);
}

function validEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function webAddress(value: unknown): string {
  const text = optionalText(value, "website address", 500);
  if (!text) return "";
  try {
    const parsed = new URL(text);
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
      throw new Error();
    }
    return parsed.toString();
  } catch {
    throw new Error("Enter a valid HTTP or HTTPS website address");
  }
}

function colour(value: unknown, label: string): string {
  const text = typeof value === "string" ? value.trim().toUpperCase() : "";
  if (!/^#[0-9A-F]{6}$/.test(text)) throw new Error(`Choose a valid ${label}`);
  return text;
}

export function brandingValues(body: BrandingBody) {
  const slug = typeof body.slug === "string" ? body.slug.trim().toLowerCase() : "";
  if (!/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(slug)) {
    throw new Error("Portal address must contain 3 to 63 lowercase letters, numbers or hyphens");
  }
  const supportEmail = optionalText(body.supportEmail, "support email", 254).toLowerCase();
  if (supportEmail && !validEmail(supportEmail)) throw new Error("Enter a valid support email");
  return {
    slug,
    brandName: textValue(body.brandName, "brand name", 2, 120),
    portalTitle: textValue(body.portalTitle, "portal title", 2, 160),
    primaryColor: colour(body.primaryColor, "primary colour"),
    accentColor: colour(body.accentColor, "accent colour"),
    supportEmail,
    supportPhone: optionalText(body.supportPhone, "support telephone number", 40),
    websiteUrl: webAddress(body.websiteUrl),
    enabled: body.enabled !== false,
  };
}

function detectedMimeType(content: Buffer): string | null {
  if (content.length >= 8 && content.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return "image/png";
  }
  if (content.length >= 3 && content[0] === 0xff && content[1] === 0xd8 && content[2] === 0xff) {
    return "image/jpeg";
  }
  if (content.length >= 12 && content.subarray(0, 4).toString("ascii") === "RIFF" && content.subarray(8, 12).toString("ascii") === "WEBP") {
    return "image/webp";
  }
  return null;
}

export function decodeLogo(dataUrl: unknown): { content: Buffer; mimeType: string } {
  if (typeof dataUrl !== "string") throw new Error("Choose a PNG, JPEG or WebP logo");
  const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(dataUrl);
  if (!match?.[1] || !match[2]) throw new Error("Choose a PNG, JPEG or WebP logo");
  const content = Buffer.from(match[2], "base64");
  if (content.length < 16 || content.length > MAX_LOGO_BYTES) {
    throw new Error("Logo must be smaller than 384 KB");
  }
  const mimeType = detectedMimeType(content);
  if (!mimeType || mimeType !== match[1]) throw new Error("Logo content does not match its file type");
  return { content, mimeType };
}

function publicBranding(row: BrandingRow | undefined): PublicBranding | null {
  if (!row?.customer_id || !row.slug || !row.brand_name || !row.portal_title) return null;
  const version = row.updated_at?.getTime() ?? 0;
  return {
    slug: row.slug,
    brandName: row.brand_name,
    portalTitle: row.portal_title,
    primaryColor: row.primary_color ?? DEFAULT_PRIMARY,
    accentColor: row.accent_color ?? DEFAULT_ACCENT,
    supportEmail: row.support_email ?? "",
    supportPhone: row.support_phone ?? "",
    websiteUrl: row.website_url ?? "",
    logoUrl: row.logo_mime_type
      ? `/api/public/branding/${encodeURIComponent(row.slug)}/logo?v=${version}`
      : null,
    loginPath: `/login/${row.slug}`,
  };
}

export async function effectiveBrandingForCustomer(customerId: string): Promise<PublicBranding | null> {
  const result = await pool.query<BrandingRow>(
    `SELECT branding.customer_id, branding.slug, branding.brand_name,
            branding.portal_title, branding.primary_color, branding.accent_color,
            branding.support_email, branding.support_phone, branding.website_url,
            branding.logo_mime_type, branding.updated_at
       FROM customers AS account
       LEFT JOIN customers AS parent ON parent.id=account.parent_customer_id
       LEFT JOIN customer_branding AS branding
         ON branding.customer_id=COALESCE(parent.id, account.id)
        AND branding.enabled=true
      WHERE account.id=$1`,
    [customerId],
  );
  return publicBranding(result.rows[0]);
}

export async function brandedLoginAllowsUser(userId: string, slug: string): Promise<boolean> {
  const result = await pool.query<{ allowed: boolean }>(
    `SELECT EXISTS (
       SELECT 1
         FROM users
         JOIN customers AS account ON account.id=users.customer_id
         LEFT JOIN customers AS parent ON parent.id=account.parent_customer_id
         JOIN customer_branding AS branding
           ON branding.customer_id=COALESCE(parent.id, account.id)
          AND branding.enabled=true
        WHERE users.id=$1 AND lower(branding.slug)=lower($2)
     ) AS allowed`,
    [userId, slug],
  );
  return result.rows[0]?.allowed === true;
}

async function wholesaleAccount(customerId: string) {
  const result = await pool.query<{
    id: string; name: string; account_number: string; account_type: string;
    parent_customer_id: string | null;
  }>(
    `SELECT id, name, account_number::text, account_type, parent_customer_id
       FROM customers WHERE id=$1`,
    [customerId],
  );
  const account = result.rows[0];
  if (!account || account.account_type !== "wholesale" || account.parent_customer_id) {
    throw new Error("White-label branding is available to reseller accounts");
  }
  return account;
}

async function editableBranding(customerId: string) {
  const result = await pool.query<BrandingRow>(
    `SELECT customer_id, slug, brand_name, portal_title, primary_color,
            accent_color, support_email, support_phone, website_url,
            logo_mime_type, enabled, updated_at
       FROM customer_branding WHERE customer_id=$1`,
    [customerId],
  );
  return result.rows[0];
}

function sendLogo(reply: FastifyReply, row: { logo_data: Buffer; logo_mime_type: string; updated_at: Date }) {
  return reply
    .header("content-type", row.logo_mime_type)
    .header("content-length", String(row.logo_data.length))
    .header("cache-control", "public, max-age=3600, must-revalidate")
    .header("etag", `\"${row.updated_at.getTime()}-${row.logo_data.length}\"`)
    .send(row.logo_data);
}

export function registerBrandingRoutes(app: FastifyInstance): void {
  app.get<{ Params: SlugParams }>("/api/public/branding/:slug", async (request, reply) => {
    const slug = request.params.slug.trim().toLowerCase();
    if (!/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(slug)) {
      return reply.code(404).send({ error: "Brand not found" });
    }
    const result = await pool.query<BrandingRow>(
      `SELECT branding.customer_id, branding.slug, branding.brand_name,
              branding.portal_title, branding.primary_color, branding.accent_color,
              branding.support_email, branding.support_phone, branding.website_url,
              branding.logo_mime_type, branding.updated_at
         FROM customer_branding AS branding
         JOIN customers ON customers.id=branding.customer_id
        WHERE lower(branding.slug)=lower($1)
          AND branding.enabled=true AND customers.active=true
          AND customers.account_type='wholesale'
          AND customers.parent_customer_id IS NULL`,
      [slug],
    );
    const branding = publicBranding(result.rows[0]);
    return branding ?? reply.code(404).send({ error: "Brand not found" });
  });

  app.get<{ Params: SlugParams }>("/api/public/branding/:slug/logo", async (request, reply) => {
    const result = await pool.query<{ logo_data: Buffer; logo_mime_type: string; updated_at: Date }>(
      `SELECT branding.logo_data, branding.logo_mime_type, branding.updated_at
         FROM customer_branding AS branding
         JOIN customers ON customers.id=branding.customer_id
        WHERE lower(branding.slug)=lower($1)
          AND branding.enabled=true AND customers.active=true
          AND customers.account_type='wholesale'
          AND customers.parent_customer_id IS NULL
          AND branding.logo_data IS NOT NULL
          AND branding.logo_mime_type IS NOT NULL`,
      [request.params.slug],
    );
    const row = result.rows[0];
    return row ? sendLogo(reply, row) : reply.code(404).send({ error: "Logo not found" });
  });

  app.get("/api/customer/branding", async (request, reply) => {
    const user = await requireCustomer(request, reply);
    if (!user?.customerId) return;
    let account;
    try { account = await wholesaleAccount(user.customerId); }
    catch (error) { return reply.code(403).send({ error: (error as Error).message }); }
    const row = await editableBranding(user.customerId);
    const draft = publicBranding(row) ?? {
      slug: `reseller-${account.account_number.padStart(6, "0")}`,
      brandName: account.name,
      portalTitle: "Communications portal",
      primaryColor: DEFAULT_PRIMARY,
      accentColor: DEFAULT_ACCENT,
      supportEmail: "",
      supportPhone: "",
      websiteUrl: "",
      logoUrl: null,
      loginPath: `/login/reseller-${account.account_number.padStart(6, "0")}`,
    };
    return { branding: draft, enabled: row?.enabled === true };
  });

  app.patch<{ Body: BrandingBody }>("/api/customer/branding", async (request, reply) => {
    const user = await requireCustomer(request, reply);
    if (!user?.customerId) return;
    try { await wholesaleAccount(user.customerId); }
    catch (error) { return reply.code(403).send({ error: (error as Error).message }); }
    let values;
    try { values = brandingValues(request.body ?? {}); }
    catch (error) { return reply.code(400).send({ error: (error as Error).message }); }
    try {
      await pool.query(
        `INSERT INTO customer_branding
           (customer_id, slug, brand_name, portal_title, primary_color,
            accent_color, support_email, support_phone, website_url, enabled)
         VALUES ($1,$2,$3,$4,$5,$6,NULLIF($7,''),NULLIF($8,''),NULLIF($9,''),$10)
         ON CONFLICT (customer_id) DO UPDATE
           SET slug=EXCLUDED.slug, brand_name=EXCLUDED.brand_name,
               portal_title=EXCLUDED.portal_title,
               primary_color=EXCLUDED.primary_color,
               accent_color=EXCLUDED.accent_color,
               support_email=EXCLUDED.support_email,
               support_phone=EXCLUDED.support_phone,
               website_url=EXCLUDED.website_url, enabled=EXCLUDED.enabled,
               updated_at=now()`,
        [user.customerId, values.slug, values.brandName, values.portalTitle,
          values.primaryColor, values.accentColor, values.supportEmail,
          values.supportPhone, values.websiteUrl, values.enabled],
      );
    } catch (error) {
      if ((error as { code?: string }).code === "23505") {
        return reply.code(409).send({ error: "That branded portal address is already in use" });
      }
      throw error;
    }
    await audit("reseller.branding.updated", user.id, {
      customerId: user.customerId, slug: values.slug, enabled: values.enabled,
    }, request.ip);
    return { branding: publicBranding(await editableBranding(user.customerId)) };
  });

  app.put<{ Body: LogoBody }>(
    "/api/customer/branding/logo",
    { bodyLimit: 560 * 1024 },
    async (request, reply) => {
      const user = await requireCustomer(request, reply);
      if (!user?.customerId) return;
      try { await wholesaleAccount(user.customerId); }
      catch (error) { return reply.code(403).send({ error: (error as Error).message }); }
      let logo;
      try { logo = decodeLogo(request.body?.dataUrl); }
      catch (error) { return reply.code(400).send({ error: (error as Error).message }); }
      const result = await pool.query(
        `UPDATE customer_branding
            SET logo_data=$2, logo_mime_type=$3, updated_at=now()
          WHERE customer_id=$1`,
        [user.customerId, logo.content, logo.mimeType],
      );
      if (result.rowCount !== 1) {
        return reply.code(409).send({ error: "Save the branding settings before uploading a logo" });
      }
      await audit("reseller.branding.logo.updated", user.id, {
        customerId: user.customerId, mimeType: logo.mimeType, bytes: logo.content.length,
      }, request.ip);
      return { branding: publicBranding(await editableBranding(user.customerId)) };
    },
  );

  app.delete("/api/customer/branding/logo", async (request, reply) => {
    const user = await requireCustomer(request, reply);
    if (!user?.customerId) return;
    try { await wholesaleAccount(user.customerId); }
    catch (error) { return reply.code(403).send({ error: (error as Error).message }); }
    await pool.query(
      `UPDATE customer_branding SET logo_data=NULL, logo_mime_type=NULL, updated_at=now()
        WHERE customer_id=$1`,
      [user.customerId],
    );
    await audit("reseller.branding.logo.removed", user.id, {
      customerId: user.customerId,
    }, request.ip);
    return { ok: true };
  });
}
