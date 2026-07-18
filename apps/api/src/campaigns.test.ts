import assert from "node:assert/strict";
import test from "node:test";
import { normalizeE164, parseContactImport, parseCsvLine, validTimeZone } from "./campaigns.js";

test("phone normalizer accepts E.164 and common international formatting", () => {
  assert.equal(normalizeE164("+27 82 123 4567"), "+27821234567");
  assert.equal(normalizeE164("0027-82-123-4567"), "+27821234567");
  assert.equal(normalizeE164("0821234567"), null);
  assert.equal(normalizeE164("+01234"), null);
});

test("CSV parser supports quoted names and escaped quotes", () => {
  assert.deepEqual(parseCsvLine('+27820000000,"Doe, Jane","A ""Test""",ref-1'), [
    "+27820000000", "Doe, Jane", 'A "Test"', "ref-1",
  ]);
  assert.equal(parseCsvLine('+27820000000,"unfinished'), null);
});

test("contact import skips headers, duplicates and invalid numbers", () => {
  const result = parseContactImport([
    "phone,first_name,last_name,reference",
    "+27820000000,Jane,Doe,crm-1",
    "+27820000000,Duplicate,Person,crm-2",
    "invalid,Bad,Number,crm-3",
    "+27821111111,John,Smith,crm-4",
  ].join("\n"));
  assert.equal(result.contacts.length, 2);
  assert.equal(result.duplicateLines, 1);
  assert.equal(result.invalidLines, 1);
  assert.equal(result.totalLines, 4);
});

test("timezone validation uses known IANA identifiers", () => {
  assert.equal(validTimeZone("Africa/Johannesburg"), true);
  assert.equal(validTimeZone("Not/A-Timezone"), false);
});
