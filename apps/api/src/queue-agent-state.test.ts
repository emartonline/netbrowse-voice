import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeQueueAgentState,
  QueueAgentStateValidationError,
} from "./queue-agent-state.js";

const ready = { signedIn: true, paused: false, pauseReason: null } as const;

test("signing out also clears pause state", () => {
  assert.deepEqual(normalizeQueueAgentState(
    { signedIn: true, paused: true, pauseReason: "lunch" },
    { signedIn: false },
  ), { signedIn: false, paused: false, pauseReason: null });
});

test("pausing defaults to the break reason", () => {
  assert.deepEqual(normalizeQueueAgentState(ready, { paused: true }), {
    signedIn: true,
    paused: true,
    pauseReason: "break",
  });
});

test("invalid runtime values are rejected", () => {
  assert.throws(
    () => normalizeQueueAgentState(ready, { pauseReason: "meeting" as never }),
    QueueAgentStateValidationError,
  );
});
