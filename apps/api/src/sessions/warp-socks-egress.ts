import { spawn } from "node:child_process";
import { readFile, rename, rm, writeFile } from "node:fs/promises";

import {
  type AuthEgress,
  type AuthEgressLease,
  throwIfAborted,
} from "./auth-egress.js";

export interface WarpStatus {
  readonly connected: boolean;
  readonly mode: string;
  readonly proxyPort: number | null;
}

export interface WarpCli {
  status(): Promise<WarpStatus>;
  setMode(mode: string): Promise<void>;
  setProxyPort(port: number): Promise<void>;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
}

interface PersistentLease {
  readonly version: 1;
  readonly ownerPid: number;
  readonly originalMode: string;
  readonly originalConnected: boolean;
  readonly port: number;
  readonly acquiredAtMs: number;
}

interface WarpSocksAuthEgressOptions {
  readonly cli: WarpCli;
  readonly port: number;
  readonly leasePath: string;
  readonly ownerPid?: number;
  readonly isProcessAlive?: (pid: number) => boolean;
  readonly readinessPollMs?: number;
  readonly readinessTimeoutMs?: number;
}

function defaultIsProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function readLease(path: string): Promise<PersistentLease | null> {
  try {
    const value = JSON.parse(await readFile(path, "utf8")) as Partial<PersistentLease>;
    if (
      value.version !== 1 ||
      !Number.isInteger(value.ownerPid) ||
      typeof value.originalMode !== "string" ||
      typeof value.originalConnected !== "boolean" ||
      !Number.isInteger(value.port) ||
      typeof value.acquiredAtMs !== "number"
    ) {
      throw new Error("Invalid WARP lease record");
    }
    return value as PersistentLease;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

export class WarpSocksAuthEgress implements AuthEgress {
  readonly name = "WARP_SOCKS";
  readonly #cli: WarpCli;
  readonly #port: number;
  readonly #leasePath: string;
  readonly #ownerPid: number;
  readonly #isProcessAlive: (pid: number) => boolean;
  readonly #readinessPollMs: number;
  readonly #readinessTimeoutMs: number;
  #activeLeases = 0;
  #original: WarpStatus | null = null;
  #operation: Promise<void> = Promise.resolve();

  constructor(options: WarpSocksAuthEgressOptions) {
    if (!Number.isInteger(options.port) || options.port < 1 || options.port > 65_535) {
      throw new Error("WARP SOCKS port must be an integer from 1 to 65535");
    }
    this.#cli = options.cli;
    this.#port = options.port;
    this.#leasePath = options.leasePath;
    this.#ownerPid = options.ownerPid ?? process.pid;
    this.#isProcessAlive = options.isProcessAlive ?? defaultIsProcessAlive;
    this.#readinessPollMs = options.readinessPollMs ?? 250;
    this.#readinessTimeoutMs = options.readinessTimeoutMs ?? 15_000;
  }

  async acquire(signal: AbortSignal): Promise<AuthEgressLease> {
    throwIfAborted(signal);
    await this.#serialized(async () => {
      throwIfAborted(signal);
      if (this.#activeLeases === 0) {
        try {
          await this.#activate();
        } catch (error) {
          await this.#restore().catch(() => undefined);
          throw error;
        }
      }
      this.#activeLeases += 1;
      await this.#persist();
    });

    let released = false;
    return {
      name: this.name,
      playwrightProxy: { server: `socks5://127.0.0.1:${this.#port}` },
      release: async () => {
        if (released) return;
        released = true;
        await this.#serialized(async () => {
          if (this.#activeLeases === 0) return;
          this.#activeLeases -= 1;
          if (this.#activeLeases > 0) {
            await this.#persist();
            return;
          }
          await this.#restore();
        });
      },
    };
  }

  async #serialized<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.#operation;
    let unlock!: () => void;
    this.#operation = new Promise<void>((resolve) => {
      unlock = resolve;
    });
    await previous;
    try {
      return await operation();
    } finally {
      unlock();
    }
  }

  async #activate(): Promise<void> {
    const existing = await readLease(this.#leasePath);
    if (
      existing &&
      existing.ownerPid !== this.#ownerPid &&
      this.#isProcessAlive(existing.ownerPid)
    ) {
      throw new Error(`WARP SOCKS lease is owned by another live process (${existing.ownerPid})`);
    }
    if (existing) await this.#recoverStale(existing);

    const original = await this.#cli.status();
    this.#original = original;
    // Persist ownership before mutating the global WARP client. A crash or a
    // readiness failure can then be recovered on the next acquisition.
    await this.#persist();
    if (original.connected && original.mode !== "proxy") await this.#cli.disconnect();
    if (original.mode !== "proxy") await this.#cli.setMode("proxy");
    if (original.proxyPort !== this.#port) await this.#cli.setProxyPort(this.#port);
    if (!original.connected || original.mode !== "proxy") await this.#cli.connect();
    await this.#waitUntilReady();
  }

  async #waitUntilReady(): Promise<void> {
    const deadline = Date.now() + this.#readinessTimeoutMs;
    for (;;) {
      const status = await this.#cli.status();
      if (status.connected && status.mode === "proxy" && status.proxyPort === this.#port) return;
      if (Date.now() >= deadline) throw new Error("WARP SOCKS proxy did not become ready");
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, this.#readinessPollMs);
        timer.unref?.();
      });
    }
  }

  async #persist(): Promise<void> {
    if (!this.#original) throw new Error("WARP SOCKS lease has no original state");
    const record: PersistentLease = {
      version: 1,
      ownerPid: this.#ownerPid,
      originalMode: this.#original.mode,
      originalConnected: this.#original.connected,
      port: this.#port,
      acquiredAtMs: Date.now(),
    };
    const temporaryPath = `${this.#leasePath}.${this.#ownerPid}.tmp`;
    await writeFile(temporaryPath, JSON.stringify(record), { encoding: "utf8", mode: 0o600 });
    await rename(temporaryPath, this.#leasePath);
  }

  async #recoverStale(stale: PersistentLease): Promise<void> {
    await this.#cli.disconnect();
    if (stale.originalMode !== "proxy") await this.#cli.setMode(stale.originalMode);
    if (stale.originalConnected) await this.#cli.connect();
    await rm(this.#leasePath, { force: true });
  }

  async #restore(): Promise<void> {
    const original = this.#original;
    if (!original) return;
    if (!original.connected) {
      await this.#cli.disconnect();
      if (original.mode !== "proxy") await this.#cli.setMode(original.mode);
    } else if (original.mode !== "proxy") {
      await this.#cli.disconnect();
      await this.#cli.setMode(original.mode);
      if (original.proxyPort !== null) await this.#cli.setProxyPort(original.proxyPort);
      await this.#cli.connect();
      await this.#cli.status();
    } else if (original.proxyPort !== null && original.proxyPort !== this.#port) {
      await this.#cli.setProxyPort(original.proxyPort);
    }
    this.#original = null;
    await rm(this.#leasePath, { force: true });
  }
}

interface ProcessWarpCliOptions {
  readonly executable?: string;
  readonly timeoutMs?: number;
  readonly maxOutputBytes?: number;
}

export class ProcessWarpCli implements WarpCli {
  readonly #executable: string;
  readonly #timeoutMs: number;
  readonly #maxOutputBytes: number;

  constructor(options: ProcessWarpCliOptions = {}) {
    this.#executable = options.executable ?? "warp-cli";
    this.#timeoutMs = options.timeoutMs ?? 10_000;
    this.#maxOutputBytes = options.maxOutputBytes ?? 64 * 1024;
  }

  async status(): Promise<WarpStatus> {
    const [statusOutput, settingsOutput] = await Promise.all([
      this.#run(["status"]),
      this.#run(["settings"]),
    ]);
    return parseWarpStatusOutputs(statusOutput, settingsOutput);
  }

  async setMode(mode: string): Promise<void> {
    await this.#run(["mode", mode]);
  }

  async setProxyPort(port: number): Promise<void> {
    await this.#run(["proxy", "port", String(port)]);
  }

  async connect(): Promise<void> {
    await this.#run(["connect"]);
  }

  async disconnect(): Promise<void> {
    await this.#run(["disconnect"]);
  }

  async #run(args: readonly string[]): Promise<string> {
    return await new Promise<string>((resolve, reject) => {
      const child = spawn(this.#executable, args, {
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
      const chunks: Buffer[] = [];
      let size = 0;
      const append = (chunk: Buffer) => {
        size += chunk.byteLength;
        if (size > this.#maxOutputBytes) {
          child.kill();
          reject(new Error("warp-cli output exceeded the configured limit"));
          return;
        }
        chunks.push(chunk);
      };
      child.stdout.on("data", append);
      child.stderr.on("data", append);
      const timer = setTimeout(() => {
        child.kill();
        reject(new Error(`warp-cli timed out after ${this.#timeoutMs}ms`));
      }, this.#timeoutMs);
      timer.unref();
      child.once("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
      child.once("exit", (code) => {
        clearTimeout(timer);
        const output = Buffer.concat(chunks).toString("utf8").trim();
        if (code !== 0) {
          reject(new Error(`warp-cli exited with code ${String(code)}: ${output}`));
          return;
        }
        resolve(output);
      });
    });
  }
}

export function parseWarpStatusOutputs(statusOutput: string, settingsOutput: string): WarpStatus {
  const connected = /\bconnected\b/iu.test(statusOutput) && !/\bdisconnected\b/iu.test(statusOutput);
  const rawMode = settingsOutput.match(/(?:Mode|mode)\s*[:=]\s*([+\w-]+)/u)?.[1]?.toLowerCase() ?? "unknown";
  const mode = rawMode === "warpproxy" ? "proxy" : rawMode;
  const portText = settingsOutput.match(/(?:proxy[^\n]*port|port)(?:\s*[:=])?\s*(\d+)/iu)?.[1];
  return { connected, mode, proxyPort: portText ? Number(portText) : null };
}
