import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  type WarpCli,
  WarpSocksAuthEgress,
} from "./warp-socks-egress.js";

class FakeWarpCli implements WarpCli {
  readonly calls: string[] = [];

  constructor(
    private readonly initial: {
      connected: boolean;
      mode: string;
      proxyPort: number | null;
    },
  ) {}

  async status() {
    this.calls.push("status");
    return { ...this.initial };
  }

  async setMode(mode: string) {
    this.calls.push(`mode:${mode}`);
    this.initial.mode = mode;
  }

  async setProxyPort(port: number) {
    this.calls.push(`port:${port}`);
    this.initial.proxyPort = port;
  }

  async connect() {
    this.calls.push("connect");
    this.initial.connected = true;
  }

  async disconnect() {
    this.calls.push("disconnect");
    this.initial.connected = false;
  }
}

const temporaryDirectories: string[] = [];

async function temporaryLeasePath() {
  const directory = await mkdtemp(join(tmpdir(), "tool-chenh-warp-"));
  temporaryDirectories.push(directory);
  return join(directory, "lease.json");
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("WarpSocksAuthEgress", () => {
  it("temporarily switches disconnected WARP to SOCKS proxy and restores it", async () => {
    const leasePath = await temporaryLeasePath();
    const cli = new FakeWarpCli({ connected: false, mode: "warp", proxyPort: null });
    const egress = new WarpSocksAuthEgress({
      cli,
      port: 40_000,
      leasePath,
      ownerPid: 1234,
    });

    const lease = await egress.acquire(new AbortController().signal);

    expect(lease.name).toBe("WARP_SOCKS");
    expect(lease.playwrightProxy).toEqual({ server: "socks5://127.0.0.1:40000" });
    expect(cli.calls).toEqual(["status", "mode:proxy", "port:40000", "connect"]);
    expect(JSON.parse(await readFile(leasePath, "utf8"))).toMatchObject({
      ownerPid: 1234,
      originalConnected: false,
      originalMode: "warp",
      port: 40_000,
    });

    await lease.release();
    expect(cli.calls).toEqual([
      "status",
      "mode:proxy",
      "port:40000",
      "connect",
      "disconnect",
      "mode:warp",
    ]);
  });

  it("reference-counts concurrent leases and restores only after the last release", async () => {
    const cli = new FakeWarpCli({ connected: true, mode: "warp", proxyPort: null });
    const egress = new WarpSocksAuthEgress({
      cli,
      port: 40_001,
      leasePath: await temporaryLeasePath(),
    });

    const first = await egress.acquire(new AbortController().signal);
    const second = await egress.acquire(new AbortController().signal);
    expect(cli.calls).toEqual(["status", "disconnect", "mode:proxy", "port:40001", "connect"]);

    await first.release();
    expect(cli.calls.at(-1)).toBe("connect");

    await second.release();
    expect(cli.calls.slice(-4)).toEqual(["disconnect", "mode:warp", "connect", "status"]);
  });

  it("does not mutate WARP when acquisition was already aborted", async () => {
    const cli = new FakeWarpCli({ connected: false, mode: "warp", proxyPort: null });
    const egress = new WarpSocksAuthEgress({
      cli,
      port: 40_000,
      leasePath: await temporaryLeasePath(),
    });
    const controller = new AbortController();
    controller.abort(new Error("stop"));

    await expect(egress.acquire(controller.signal)).rejects.toThrow("stop");
    expect(cli.calls).toEqual([]);
  });

  it("fails closed when another live process owns the persistent lease", async () => {
    const leasePath = await temporaryLeasePath();
    await writeFile(
      leasePath,
      JSON.stringify({
        version: 1,
        ownerPid: 999,
        originalMode: "warp",
        originalConnected: false,
        port: 40_000,
        acquiredAtMs: 1_700_000_000_000,
      }),
      "utf8",
    );
    const cli = new FakeWarpCli({ connected: false, mode: "warp", proxyPort: null });
    const egress = new WarpSocksAuthEgress({
      cli,
      port: 40_000,
      leasePath,
      ownerPid: 123,
      isProcessAlive: (pid) => pid === 999,
    });

    await expect(egress.acquire(new AbortController().signal)).rejects.toThrow(
      "owned by another live process",
    );
    expect(cli.calls).toEqual([]);
  });

  it("restores a stale dead-process lease before taking a new lease", async () => {
    const leasePath = await temporaryLeasePath();
    await writeFile(
      leasePath,
      JSON.stringify({
        version: 1,
        ownerPid: 999,
        originalMode: "warp",
        originalConnected: false,
        port: 40_000,
        acquiredAtMs: 1_700_000_000_000,
      }),
      "utf8",
    );
    const cli = new FakeWarpCli({ connected: true, mode: "proxy", proxyPort: 40_000 });
    const egress = new WarpSocksAuthEgress({
      cli,
      port: 40_001,
      leasePath,
      ownerPid: 123,
      isProcessAlive: () => false,
    });

    const lease = await egress.acquire(new AbortController().signal);

    expect(cli.calls).toEqual([
      "disconnect",
      "mode:warp",
      "status",
      "mode:proxy",
      "port:40001",
      "connect",
    ]);
    await lease.release();
  });
});
