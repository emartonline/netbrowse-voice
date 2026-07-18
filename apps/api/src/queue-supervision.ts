import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { config } from "./config.js";

const execFileAsync = promisify(execFile);

export interface QueueRuntimeStats {
  waitingCallers: number;
  averageHoldSeconds: number;
  averageTalkSeconds: number;
  completedCalls: number;
  abandonedCalls: number;
  serviceLevelPercent: number;
  longestWaitSeconds: number;
}

export function parseQueueStatus(output: string): Map<string, QueueRuntimeStats> {
  const queues = new Map<string, QueueRuntimeStats>();
  let currentQueue = "";
  for (const line of output.split(/\r?\n/)) {
    const header = line.match(
      /^(nbvq-[0-9a-f]{32}) has (\d+) calls .*?\((\d+)s holdtime, (\d+)s talktime\), W:\d+, C:(\d+), A:(\d+), SL:([0-9.]+)%/i,
    );
    if (header) {
      currentQueue = header[1]!.toLowerCase();
      queues.set(currentQueue, {
        waitingCallers: Number(header[2]),
        averageHoldSeconds: Number(header[3]),
        averageTalkSeconds: Number(header[4]),
        completedCalls: Number(header[5]),
        abandonedCalls: Number(header[6]),
        serviceLevelPercent: Number(header[7]),
        longestWaitSeconds: 0,
      });
      continue;
    }
    if (!currentQueue) continue;
    const wait = line.match(/\bwait:\s*(\d+):(\d{2})\b/i);
    if (!wait) continue;
    const stats = queues.get(currentQueue);
    if (stats) {
      stats.longestWaitSeconds = Math.max(
        stats.longestWaitSeconds,
        Number(wait[1]) * 60 + Number(wait[2]),
      );
    }
  }
  return queues;
}

export async function getQueueRuntimeStats(): Promise<Map<string, QueueRuntimeStats>> {
  try {
    const { stdout } = await execFileAsync(
      config.asteriskQueuesCommand,
      ["-n", config.asteriskQueuesHelper],
      { timeout: 5_000, maxBuffer: 1024 * 1024 },
    );
    return parseQueueStatus(stdout);
  } catch {
    return new Map();
  }
}
