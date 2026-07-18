import assert from "node:assert/strict";
import test from "node:test";
import { parseQueueStatus } from "./queue-supervision.js";

test("queue status parser extracts live and cumulative supervision metrics", () => {
  const output = `nbvq-383f52d2192d42d58217b13339497fe8 has 2 calls (max unlimited) in 'ringall' strategy (12s holdtime, 43s talktime), W:0, C:7, A:3, SL:71.4%, SL2:85.7% within 0s
   Members:
      PJSIP/100 (ringinuse disabled) (Not in use) has taken 4 calls
   Callers:
      1. PJSIP/102-00000001 (wait: 0:17, prio: 0)
      2. PJSIP/103-00000002 (wait: 1:04, prio: 0)`;
  const parsed = parseQueueStatus(output).get("nbvq-383f52d2192d42d58217b13339497fe8");
  assert.deepEqual(parsed, {
    waitingCallers: 2,
    averageHoldSeconds: 12,
    averageTalkSeconds: 43,
    completedCalls: 7,
    abandonedCalls: 3,
    serviceLevelPercent: 71.4,
    longestWaitSeconds: 64,
  });
});

test("queue status parser ignores unrelated Asterisk output", () => {
  assert.equal(parseQueueStatus("No queues.\n").size, 0);
});
