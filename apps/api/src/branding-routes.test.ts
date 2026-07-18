import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { brandingValues, decodeLogo } from "./branding-routes.js";

test("reseller branding values normalize safe public settings", () => {
  assert.deepEqual(
    brandingValues({
      slug: "Example-Voice",
      brandName: "Example Voice",
      portalTitle: "Customer communications",
      primaryColor: "#0b243a",
      accentColor: "#ff7a1a",
      supportEmail: "HELP@EXAMPLE.TEST",
      supportPhone: "+27 10 000 0000",
      websiteUrl: "https://example.test/support",
      enabled: true,
    }),
    {
      slug: "example-voice",
      brandName: "Example Voice",
      portalTitle: "Customer communications",
      primaryColor: "#0B243A",
      accentColor: "#FF7A1A",
      supportEmail: "help@example.test",
      supportPhone: "+27 10 000 0000",
      websiteUrl: "https://example.test/support",
      enabled: true,
    },
  );
});

test("branding rejects unsafe addresses, colours and website credentials", () => {
  const valid = {
    slug: "example-voice",
    brandName: "Example Voice",
    portalTitle: "Customer communications",
    primaryColor: "#0B243A",
    accentColor: "#FF7A1A",
  };
  assert.throws(() => brandingValues({ ...valid, slug: "../admin" }), /Portal address/);
  assert.throws(() => brandingValues({ ...valid, primaryColor: "red" }), /primary colour/);
  assert.throws(
    () => brandingValues({ ...valid, websiteUrl: "https://user:pass@example.test" }),
    /HTTP or HTTPS/,
  );
});

test("logo decoder accepts raster signatures and rejects SVG or mismatched content", () => {
  const png = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  ]);
  const decoded = decodeLogo(`data:image/png;base64,${png.toString("base64")}`);
  assert.equal(decoded.mimeType, "image/png");
  assert.deepEqual(decoded.content, png);
  assert.throws(
    () => decodeLogo(`data:image/jpeg;base64,${png.toString("base64")}`),
    /does not match/,
  );
  assert.throws(
    () => decodeLogo(`data:image/svg+xml;base64,${Buffer.from("<svg/>").toString("base64")}`),
    /PNG, JPEG or WebP/,
  );
});

test("white-label routes derive the brand from the authenticated tenant hierarchy", () => {
  const migration = readFileSync(
    new URL("../../../database/migrations/034_reseller_branding.sql", import.meta.url),
    "utf8",
  );
  const source = readFileSync(new URL("./branding-routes.js", import.meta.url), "utf8");
  const login = readFileSync(new URL("./index.js", import.meta.url), "utf8");
  const web = readFileSync(
    new URL("../../../apps/web/src/main.tsx", import.meta.url),
    "utf8",
  );

  assert.match(migration, /CREATE TABLE IF NOT EXISTS customer_branding/);
  assert.match(migration, /octet_length\(logo_data\) <= 393216/);
  assert.match(source, /branding\.customer_id=COALESCE\(parent\.id, account\.id\)/);
  assert.match(source, /WHERE users\.id=\$1 AND lower\(branding\.slug\)=lower\(\$2\)/);
  assert.match(source, /customers\.parent_customer_id IS NULL/);
  assert.doesNotMatch(source, /request\.(query|body).*customerId/);
  assert.match(login, /brandedLoginAllowsUser\(user\.id, brandSlug\)/);
  assert.match(web, /branding: "\/portal\/branding"/);
  assert.match(web, /ResellerBrandingPanel/);
});
