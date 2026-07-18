import assert from "node:assert/strict";
import test from "node:test";
import { recordingFilename } from "./recordings.js";
import { readFileSync } from "node:fs";

test("extracts only safe Netbrowse Voice recording filenames", () => {
  assert.equal(
    recordingFilename("nbvoice-recording:nbv-1770000000.12.wav"),
    "nbv-1770000000.12.wav",
  );
  assert.equal(
    recordingFilename("note;nbvoice-recording:nbv-server-1770000000.12.wav"),
    "nbv-server-1770000000.12.wav",
  );
  assert.equal(recordingFilename("nbvoice-recording:../../secret.wav"), undefined);
  assert.equal(recordingFilename("nbvoice-recording-deleted:nbv-1.1.wav"), undefined);
});

test("customer recording routes bind every archive action to the session customer", () => {
  const routeSource = readFileSync(new URL("./recording-routes.js", import.meta.url), "utf8");
  const recordingSource = readFileSync(new URL("./recordings.js", import.meta.url), "utf8");
  const start = routeSource.indexOf('app.get("/api/customer/recordings"');
  const customerRoutes = routeSource.slice(start);

  assert.ok(start > 0);
  assert.match(customerRoutes, /requireCustomer/);
  assert.match(customerRoutes, /assignments\.customer_id=\$1/);
  assert.match(customerRoutes, /customerOwnsRecording\(user\.customerId/);
  assert.doesNotMatch(customerRoutes, /request\.(query|body).*customerId/);
  assert.match(recordingSource, /enforceCustomerRecordingQuotas/);
  assert.match(recordingSource, /record_calls=false/);
});
