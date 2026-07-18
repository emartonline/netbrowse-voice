import assert from "node:assert/strict";
import test from "node:test";
import { decryptSecret, encryptSecret } from "./secrets.js";

test("PBX secrets round-trip through authenticated encryption", () => {
  const encrypted = encryptSecret("SIP-password_example-123");
  assert.notEqual(encrypted, "SIP-password_example-123");
  assert.match(encrypted, /^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  assert.equal(decryptSecret(encrypted), "SIP-password_example-123");
});

test("tampered PBX secrets cannot be decrypted", () => {
  const encrypted = encryptSecret("another-secret");
  const parts = encrypted.split(".");
  const ciphertext = Buffer.from(parts[3]!, "base64url");
  ciphertext[0] = ciphertext[0]! ^ 1;
  parts[3] = ciphertext.toString("base64url");
  assert.throws(() => decryptSecret(parts.join(".")));
});
