import { execFile } from "node:child_process";
import { access, statfs } from "node:fs/promises";
import os from "node:os";
import { promisify } from "node:util";

const run = promisify(execFile);

export type ServiceState = "online" | "offline" | "unavailable";

export interface ServiceStatus {
  key: string;
  label: string;
  state: ServiceState;
  detail?: string;
}

async function systemdStatus(service: string): Promise<ServiceState> {
  try {
    const { stdout } = await run("systemctl", ["is-active", service], {
      timeout: 2_500,
    });
    return stdout.trim() === "active" ? "online" : "offline";
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    return message.includes("ENOENT") ? "unavailable" : "offline";
  }
}

async function asteriskDetail(): Promise<string | undefined> {
  try {
    await access("/usr/sbin/asterisk");
    const { stdout } = await run(
      "/usr/sbin/asterisk",
      ["-rx", "core show version"],
      { timeout: 3_000 },
    );
    return stdout.trim().split("\n")[0]?.slice(0, 140);
  } catch {
    return undefined;
  }
}

export async function serviceStatuses(): Promise<ServiceStatus[]> {
  const [asterisk, postgres, redis, nginx, asteriskVersion] = await Promise.all([
    systemdStatus("asterisk"),
    systemdStatus("postgresql"),
    systemdStatus("redis-server"),
    systemdStatus("nginx"),
    asteriskDetail(),
  ]);

  return [
    { key: "asterisk", label: "Asterisk PBX", state: asterisk, detail: asteriskVersion },
    { key: "postgresql", label: "PostgreSQL", state: postgres },
    { key: "redis", label: "Redis", state: redis },
    { key: "nginx", label: "Nginx", state: nginx },
    { key: "api", label: "Voice Core API", state: "online" },
  ];
}

export async function systemMetrics() {
  const disk = await statfs("/");
  const totalDisk = disk.blocks * disk.bsize;
  const availableDisk = disk.bavail * disk.bsize;
  return {
    hostname: os.hostname(),
    platform: `${os.type()} ${os.release()}`,
    architecture: os.arch(),
    uptimeSeconds: Math.floor(os.uptime()),
    cpuCount: os.cpus().length,
    loadAverage: os.loadavg().map((value) => Number(value.toFixed(2))),
    memory: {
      total: os.totalmem(),
      free: os.freemem(),
    },
    disk: {
      total: totalDisk,
      free: availableDisk,
    },
  };
}
