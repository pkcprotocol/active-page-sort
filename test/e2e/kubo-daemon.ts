import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import * as fs from "node:fs";
import * as net from "node:net";
import * as path from "node:path";
import { path as kuboBinaryPath } from "kubo";

// A throwaway kubo daemon for the e2e: its own repo directory, no bootstrap peers, no mDNS, ports far from
// the pkc-js test server's (15001-15006 / 18080-18085 / 24001-24006) so both can run on one machine.
// Override with KUBO_E2E_API_PORT / KUBO_E2E_GATEWAY_PORT / KUBO_E2E_SWARM_PORT when they collide anyway.

export interface KuboDaemon {
  apiUrl: string;
  pid: number;
  stop: () => Promise<void>;
}

const envPort = (name: string, fallback: number): number => {
  const raw = process.env[name];
  const parsed = raw === undefined ? NaN : Number.parseInt(raw, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
};

export const E2E_PORTS = {
  api: envPort("KUBO_E2E_API_PORT", 15301),
  gateway: envPort("KUBO_E2E_GATEWAY_PORT", 18380),
  swarm: envPort("KUBO_E2E_SWARM_PORT", 24301)
};

const assertPortFree = (port: number): Promise<void> =>
  new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", (error: NodeJS.ErrnoException) =>
      reject(new Error(`port ${port} is not free (${error.code}); set the KUBO_E2E_*_PORT env vars to move the e2e daemon`))
    );
    server.listen(port, "127.0.0.1", () => server.close(() => resolve()));
  });

export async function startKuboDaemon({ repoDir }: { repoDir: string }): Promise<KuboDaemon> {
  await Promise.all([E2E_PORTS.api, E2E_PORTS.gateway, E2E_PORTS.swarm].map(assertPortFree));
  const binary = kuboBinaryPath();
  const env = { ...process.env, IPFS_PATH: repoDir };
  fs.mkdirSync(repoDir, { recursive: true });

  const ipfs = (...args: string[]) => execFileSync(binary, args, { env, stdio: ["ignore", "ignore", "inherit"] });
  ipfs("init", "--profile", "test");
  ipfs("bootstrap", "rm", "--all");
  ipfs("config", "--json", "Discovery.MDNS.Enabled", "false");
  ipfs("config", "Addresses.API", `/ip4/127.0.0.1/tcp/${E2E_PORTS.api}`);
  ipfs("config", "Addresses.Gateway", `/ip4/127.0.0.1/tcp/${E2E_PORTS.gateway}`);
  ipfs("config", "--json", "Addresses.Swarm", JSON.stringify([`/ip4/127.0.0.1/tcp/${E2E_PORTS.swarm}/ws`]));
  ipfs("config", "Ipns.MaxCacheTTL", "10s");

  const logPath = path.join(repoDir, "daemon.log");
  const log = fs.createWriteStream(logPath, { flags: "a" });
  const child: ChildProcess = spawn(binary, ["daemon", "--migrate", "--enable-namesys-pubsub"], { env, stdio: ["ignore", "pipe", "pipe"] });

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`kubo daemon did not report ready within 60s, see ${logPath}`)), 60_000);
    child.stdout?.on("data", (chunk: Buffer) => {
      log.write(chunk);
      if (chunk.toString().includes("Daemon is ready")) {
        clearTimeout(timer);
        resolve();
      }
    });
    child.stderr?.on("data", (chunk: Buffer) => log.write(chunk));
    child.once("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`kubo daemon exited with code ${code} before it was ready, see ${logPath}`));
    });
    child.once("error", reject);
  });

  const stop = (): Promise<void> =>
    new Promise((resolve) => {
      if (child.exitCode !== null) return resolve();
      const killTimer = setTimeout(() => child.kill("SIGKILL"), 15_000);
      child.once("exit", () => {
        clearTimeout(killTimer);
        log.end();
        resolve();
      });
      child.kill("SIGTERM");
    });

  return { apiUrl: `http://127.0.0.1:${E2E_PORTS.api}/api/v0`, pid: child.pid ?? -1, stop };
}
