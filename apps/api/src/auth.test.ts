import assert from "node:assert/strict";
import test from "node:test";
import { hashPassword, isAdministratorRole, isCustomerRole, verifyPassword } from "./auth.js";

test("password hashes validate the original password", () => {
  const encoded = hashPassword("a-long-development-password");
  assert.equal(verifyPassword("a-long-development-password", encoded), true);
  assert.equal(verifyPassword("a-different-password", encoded), false);
});

test("password hashes use independent salts", () => {
  const first = hashPassword("same-password-value");
  const second = hashPassword("same-password-value");
  assert.notEqual(first, second);
  assert.equal(verifyPassword("same-password-value", first), true);
  assert.equal(verifyPassword("same-password-value", second), true);
});

test("malformed password hashes are rejected", () => {
  assert.equal(verifyPassword("anything", "not-a-valid-hash"), false);
});

test("only owner and administrator roles have control-centre access", () => {
  assert.equal(isAdministratorRole("owner"), true);
  assert.equal(isAdministratorRole("administrator"), true);
  assert.equal(isAdministratorRole("agent"), false);
  assert.equal(isAdministratorRole("customer_admin"), false);
  assert.equal(isAdministratorRole("unknown"), false);
});

test("customer portal role is isolated from administrator roles", () => {
  assert.equal(isCustomerRole("customer_admin"), true);
  assert.equal(isCustomerRole("owner"), false);
  assert.equal(isCustomerRole("administrator"), false);
  assert.equal(isCustomerRole("agent"), false);
});
