import { readFileSync } from "node:fs";
import {
  FixtureAdapter,
  type FixtureSnapshot,
  type ProviderAdapter,
  type ProviderSink,
  type ReplayScheduler
} from "@tool-chenh/adapters";
import { AppSnapshotSchema, RealtimeMessageSchema, type Category } from "@tool-chenh/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WebSocket as WebSocketClient, type WebSocket } from "ws";
import {
  buildApp,
  resolveApiLogLevel,
  safeRequestSerializer,
  safeResponseSerializer,
  validateViteOrigin
} from "./app.js";
import { sendBoundedMessage } from "./realtime/opportunity-ws.js";
import { Runtime, type RuntimeClock } from "./runtime.js";
import { CatalogRevisionStore } from "./catalog/catalog-revision-store.js";
import { createFixtureRuntime, createLiveRuntime, resolveServerConfig, shouldPersistCatalogJournal,
  shouldRunLegacySessionMaintenance } from "./server.js";

const immediateScheduler: ReplayScheduler = {
  async wait(): Promise<void> {}
};

const clock: RuntimeClock = {
  now: () => ({ monotonicNowMs: 100, wallClockNowMs: 1_800_000_000_100 })
};

const fixturePaths = [
  ["football/saba-snapshot.json", "SABA", "FOOTBALL"],
  ["football/im-snapshot.json", "IM", "FOOTBALL"],
  ["lol/saba-snapshot.json", "SABA", "LOL"],
  ["lol/im-snapshot.json", "IM", "LOL"]
] as const;

function loadFixture(path: string): FixtureSnapshot {
  return JSON.parse(
    readFileSync(new URL(`../../../fixtures/${path}`, import.meta.url), "utf8")
  ) as FixtureSnapshot;
}

function mappingPolicy() {
  return {
    prematchToleranceMs: 120_000,
    liveClockToleranceMs: 20_000,
    aliasRegistry: {
      version: "fixture-v1",
      aliases: {
        FOOTBALL: {
          northbridge_fc: "northbridge_fc",
          riverside_united: "riverside_united",
          city_academy: "city_academy",
          united_academy: "united_academy"
        },
        LOL: {
          blue_comets: "blue_comets",
          red_phoenix: "red_phoenix",
          alpha_academy: "alpha_academy",
          beta_academy: "beta_academy",
          gamma_academy: "gamma_academy"
        }
      }
    }
  } as const;
}

function fixtureAdapters(degraded = false) {
  return fixturePaths.map(([path, provider, category], index) => {
    const original = loadFixture(path);
    const records = original.records
      .filter((record) => record.offsetMs <= 90)
      .map((record) => degraded && index === 0 && record.kind === "STATUS"
        ? {
            ...record,
            payload: { ...record.payload as object, status: "DEGRADED" }
          }
        : record);
    const snapshot: FixtureSnapshot = { ...original, records };
    return new FixtureAdapter(snapshot, {
      id: snapshot.adapterId,
      provider,
      category: category as Category,
      scheduler: immediateScheduler
    });
  });
}

async function readyRuntime(degraded = false): Promise<Runtime> {
  const runtime = new Runtime({
    adapters: fixtureAdapters(degraded),
    clock,
    mappingPolicy: mappingPolicy()
  });
  await runtime.start(new AbortController().signal);
  return runtime;
}

const apps: Array<ReturnType<typeof buildApp>> = [];
const sockets: WebSocket[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  for (const socket of sockets.splice(0)) socket.terminate();
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

class AdvancingFixtureAdapter implements ProviderAdapter {
  readonly id = "fixture-football";
  readonly categories = ["FOOTBALL"] as const;
  #sink: ProviderSink | undefined;
  #updatedAtMs = 1_800_000_000_100;

  async start(sink: ProviderSink): Promise<void> {
    this.#sink = sink;
    this.#emitStatus();
  }

  advanceClock(deltaMs: number): void {
    this.#updatedAtMs += deltaMs;
    this.#emitStatus();
  }

  #emitStatus(): void {
    this.#sink?.onStatus({
      adapterId: this.id,
      provider: "SABA",
      category: "FOOTBALL",
      status: "LIVE",
      detail: null,
      updatedAtMs: this.#updatedAtMs
    });
  }
}

function collectMessages(): {
  readonly onInit: (socket: WebSocket) => void;
  readonly next: () => Promise<unknown>;
} {
  const queued: unknown[] = [];
  const waiters: Array<(value: unknown) => void> = [];
  return {
    onInit(socket) {
      socket.on("message", (data) => {
        const parsed: unknown = JSON.parse(data.toString());
        const waiter = waiters.shift();
        if (waiter === undefined) queued.push(parsed);
        else waiter(parsed);
      });
    },
    next() {
      const queuedValue = queued.shift();
      if (queuedValue !== undefined) return Promise.resolve(queuedValue);
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("Timed out waiting for WebSocket message")), 1_000);
        waiters.push((value) => {
          clearTimeout(timer);
          resolve(value);
        });
      });
    }
  };
}

describe("Fastify snapshot API", () => {
  it("registers the local CMD hidden-market probe when provided", async () => {
    const runtime = await readyRuntime();
    const probe = vi.fn(async (providerEventId: string) => ({
      providerEventId,
      status: "NO_SAFE_CONTROL" as const
    }));
    const app = buildApp(runtime, { cmdHiddenMarketProbe: { probe } });
    apps.push(app);

    const response = await app.inject({ method: "POST", url: "/api/catalog/cmd-hidden-probe",
      headers: { host: "127.0.0.1:4310" }, payload: { providerEventId: "25250586" } });

    expect(response.statusCode).toBe(200);
    expect(probe).toHaveBeenCalledWith("25250586");
  });

  it("keeps routine polling logs quiet unless an explicit valid level is configured", () => {
    expect(resolveApiLogLevel(undefined, "production")).toBe("warn");
    expect(resolveApiLogLevel(undefined, "test")).toBe("silent");
    expect(resolveApiLogLevel("debug", "production")).toBe("debug");
    expect(resolveApiLogLevel("not-a-level", "production")).toBe("warn");
  });
  it("keeps provider preflight available but never mounts the execution route", async () => {
    const options = {
      providerPreflight: { preflight: async () => { throw new Error("not invoked"); } },
      executionDryRun: { execute: async () => { throw new Error("not invoked"); } }
    } as unknown as Parameters<typeof buildApp>[1];
    const app = buildApp(createFixtureRuntime(1_000), options);
    await app.ready();

    expect(app.hasRoute({ method: "POST", url: "/api/preflight/provider" })).toBe(true);
    expect(app.hasRoute({ method: "POST", url: "/api/execution/dry-run" })).toBe(false);
    await app.close();
  });

  it("builds an inspectable fixture snapshot with verified opportunities", async () => {
    const runtime = createFixtureRuntime(1_000);
    await runtime.start(new AbortController().signal);

    const snapshot = runtime.getSnapshot();
    expect(snapshot.events.filter((event) => event.mappingStatus === "VERIFIED")).toHaveLength(2);
    expect(snapshot.markets).toHaveLength(4);
    expect(snapshot.opportunities.map((opportunity) => opportunity.category).sort()).toEqual([
      "FOOTBALL",
      "LOL"
    ]);
  });

  it("advances fixture quote age and removes opportunities after the documented inspection TTL", async () => {
    let elapsedMs = 0;
    vi.spyOn(performance, "now").mockImplementation(() => elapsedMs);
    const runtime = createFixtureRuntime(1_000);
    await runtime.start(new AbortController().signal);

    expect(runtime.getSnapshot().opportunities).toHaveLength(2);
    elapsedMs = 300_001;

    const stale = runtime.getSnapshot();
    expect(stale.opportunities).toHaveLength(0);
    expect(stale.blockedDiagnostics.some((diagnostic) => diagnostic.code === "QUOTE_STALE")).toBe(true);
  });

  it("defaults server binding to loopback and reads the established API env names", () => {
    expect(resolveServerConfig({})).toEqual({
      host: "127.0.0.1",
      port: 4310,
      viteOrigin: "http://127.0.0.1:4311",
      dataMode: "LIVE",
      fixtureReplaySpeed: 1
    });
    expect(resolveServerConfig({
      API_HOST: "localhost",
      API_PORT: "5310",
      VITE_ORIGIN: "http://localhost:5311",
      FIXTURE_MODE: "1",
      FIXTURE_REPLAY_SPEED: "2"
    })).toEqual({
      host: "localhost",
      port: 5310,
      viteOrigin: "http://localhost:5311",
      dataMode: "FIXTURE",
      fixtureReplaySpeed: 2
    });
    expect(resolveServerConfig({ VITE_ORIGIN: "https://live.babiesbo.uk" }).viteOrigin)
      .toBe("https://live.babiesbo.uk");
    expect(() => resolveServerConfig({ API_HOST: "0.0.0.0" })).toThrow(/loopback/u);
    expect(() => resolveServerConfig({ VITE_ORIGIN: "https://attacker.example" })).toThrow(/allowed/u);
    expect(() => resolveServerConfig({ FIXTURE_MODE: "true" })).toThrow("FIXTURE_MODE must be 1 or unset");
  });

  it("runs automatic session recovery by default with an explicit kill switch", () => {
    expect(shouldRunLegacySessionMaintenance({})).toBe(true);
    expect(shouldRunLegacySessionMaintenance({ SESSION_MAINTENANCE_ENABLED: "0" })).toBe(false);
    expect(shouldRunLegacySessionMaintenance({ SESSION_MAINTENANCE_ENABLED: "1" })).toBe(true);
    expect(() => shouldRunLegacySessionMaintenance({ SESSION_MAINTENANCE_ENABLED: "yes" }))
      .toThrow("SESSION_MAINTENANCE_ENABLED must be 0, 1 or unset");
  });

  it("keeps the high-volume catalog JSONL journal opt-in", () => {
    expect(shouldPersistCatalogJournal({})).toBe(false);
    expect(shouldPersistCatalogJournal({ TOOL_CHENH_CATALOG_JOURNAL_ENABLED: "0" })).toBe(false);
    expect(shouldPersistCatalogJournal({ TOOL_CHENH_CATALOG_JOURNAL_ENABLED: "1" })).toBe(true);
  });

  it("starts live mode empty instead of publishing fixture opportunities", async () => {
    const runtime = createLiveRuntime();
    await runtime.start(new AbortController().signal);
    expect(runtime.getSnapshot()).toMatchObject({
      events: [], markets: [], opportunities: [], providerStatuses: []
    });
  });

  it("rejects a non-local Vite origin at the application boundary", () => {
    expect(() => validateViteOrigin("https://attacker.example")).toThrow(/local HTTP origin/u);
    expect(validateViteOrigin("http://localhost:4311")).toBe("http://localhost:4311");
  });

  it("serializes logs without headers, query values, bodies, or session material", () => {
    const secret = "never-log-this-secret";
    const request = safeRequestSerializer({
      method: "POST",
      url: `/api/snapshot?token=${secret}&accountId=${secret}`,
      headers: {
        authorization: `Bearer ${secret}`,
        cookie: `session=${secret}`
      },
      query: { token: secret },
      body: { account: secret, bet: secret }
    });
    const response = safeResponseSerializer({
      statusCode: 200,
      headers: { "set-cookie": `session=${secret}` },
      body: { token: secret }
    });

    expect(request).toEqual({ method: "POST", url: "/api/snapshot" });
    expect(response).toEqual({ statusCode: 200 });
    expect(JSON.stringify({ request, response })).not.toContain(secret);
  });

  it("reports observe-mode health with the current revision and all adapter statuses", async () => {
    const runtime = await readyRuntime();
    const app = buildApp(runtime);
    apps.push(app);

    const response = await app.inject({ method: "GET", url: "/api/health" });

    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.json()).toEqual({
      status: "ok",
      mode: "OBSERVE",
      executionReady: false,
      revision: runtime.getSnapshot().revision,
      providerStatuses: runtime.getSnapshot().providerStatuses
    });
    expect(response.json().providerStatuses).toHaveLength(4);
  });

  it("returns a strict AppSnapshot and disables caching", async () => {
    const runtime = await readyRuntime();
    const app = buildApp(runtime);
    apps.push(app);

    const response = await app.inject({ method: "GET", url: "/api/snapshot" });

    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(AppSnapshotSchema.safeParse(response.json()).success).toBe(true);
    expect(response.json()).toEqual(runtime.getSnapshot());
  });

  it("returns a strict category snapshot and rejects invalid or repeated categories", async () => {
    const runtime = await readyRuntime();
    const app = buildApp(runtime);
    apps.push(app);

    const response = await app.inject({ method: "GET", url: "/api/snapshot?category=LOL" });
    const snapshot = response.json();

    expect(response.statusCode).toBe(200);
    expect(AppSnapshotSchema.safeParse(snapshot).success).toBe(true);
    expect(snapshot.events.every((event: { category: string }) => event.category === "LOL")).toBe(true);
    expect(snapshot.markets.every((market: { category: string }) => market.category === "LOL")).toBe(true);
    expect(snapshot.opportunities.every((opportunity: { category: string }) =>
      opportunity.category === "LOL")).toBe(true);
    expect(snapshot.blockedDiagnostics.every((diagnostic: { category: string }) =>
      diagnostic.category === "LOL")).toBe(true);
    expect(snapshot.providerStatuses.every((status: { category: string }) =>
      status.category === "LOL")).toBe(true);
    expect(snapshot.counts.FOOTBALL).toEqual({ events: 0, markets: 0 });
    expect(snapshot.counts.opportunities).toBe(snapshot.opportunities.length);

    for (const url of [
      "/api/snapshot?category=TENNIS",
      "/api/snapshot?category=LOL&category=FOOTBALL"
    ]) {
      expect((await app.inject({ method: "GET", url })).statusCode).toBe(400);
    }
  });

  it("stays available while degraded without advertising execution readiness", async () => {
    const runtime = await readyRuntime(true);
    const app = buildApp(runtime);
    apps.push(app);

    const response = await app.inject({ method: "GET", url: "/api/health" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      status: "degraded",
      mode: "OBSERVE",
      executionReady: false
    });
    expect(response.json().providerStatuses).toContainEqual(
      expect.objectContaining({ status: "DEGRADED" })
    );
  });

  it("does not report healthy for four live statuses with unexpected identities", async () => {
    const unexpectedAdapters: ProviderAdapter[] = Array.from({ length: 4 }, (_, index) => ({
      id: `unexpected-${index}`,
      categories: ["FOOTBALL"],
      async start(sink): Promise<void> {
        sink.onStatus({
          adapterId: `unexpected-${index}`,
          provider: "SABA",
          category: "FOOTBALL",
          status: "LIVE",
          detail: null,
          updatedAtMs: index
        });
      }
    }));
    const runtime = new Runtime({ adapters: unexpectedAdapters, clock });
    await runtime.start(new AbortController().signal);
    const app = buildApp(runtime);
    apps.push(app);

    const response = await app.inject({ method: "GET", url: "/api/health" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ status: "degraded", executionReady: false });
  });

  it("does not report healthy when an extra adapter duplicates an expected identity", async () => {
    const extraAdapter: ProviderAdapter = {
      id: "extra-saba-football",
      categories: ["FOOTBALL"],
      async start(sink): Promise<void> {
        sink.onStatus({
          adapterId: "extra-saba-football",
          provider: "SABA",
          category: "FOOTBALL",
          status: "LIVE",
          detail: null,
          updatedAtMs: 1
        });
      }
    };
    const runtime = new Runtime({
      adapters: [...fixtureAdapters(), extraAdapter],
      clock,
      mappingPolicy: mappingPolicy()
    });
    await runtime.start(new AbortController().signal);
    const app = buildApp(runtime);
    apps.push(app);

    const response = await app.inject({ method: "GET", url: "/api/health" });

    expect(response.json()).toMatchObject({ status: "degraded", executionReady: false });
    expect(response.json().providerStatuses).toHaveLength(5);
  });

  it("allows only no-origin requests or the independently configured Vite origin", async () => {
    const runtime = await readyRuntime();
    const app = buildApp(runtime, { viteOrigin: "http://127.0.0.1:4311" });
    apps.push(app);

    const noOrigin = await app.inject({ method: "GET", url: "/api/health" });
    expect(noOrigin.statusCode).toBe(200);
    expect(noOrigin.headers["access-control-allow-origin"]).toBeUndefined();

    const vite = await app.inject({
      method: "GET",
      url: "/api/health",
      headers: { origin: "http://127.0.0.1:4311" }
    });
    expect(vite.statusCode).toBe(200);
    expect(vite.headers["access-control-allow-origin"]).toBe("http://127.0.0.1:4311");

    const sameOrigin = await app.inject({
      method: "GET",
      url: "/api/health",
      headers: { host: "127.0.0.1:4310", origin: "http://127.0.0.1:4310" }
    });
    expect(sameOrigin.statusCode).toBe(403);

    const attackerControlledHost = await app.inject({
      method: "GET",
      url: "/api/health",
      headers: {
        host: "attacker.example",
        origin: "http://attacker.example",
        "x-forwarded-host": "127.0.0.1:4310",
        "x-forwarded-proto": "http"
      }
    });
    expect(attackerControlledHost.statusCode).toBe(403);

    const foreign = await app.inject({
      method: "GET",
      url: "/api/health",
      headers: { origin: "https://attacker.example" }
    });
    expect(foreign.statusCode).toBe(403);
    const wrongScheme = await app.inject({
      method: "GET",
      url: "/api/health",
      headers: { host: "127.0.0.1:4310", origin: "https://127.0.0.1:4310" }
    });
    expect(wrongScheme.statusCode).toBe(403);
  });

  it("allows the local dashboard alongside the configured public dashboard", async () => {
    const runtime = await readyRuntime();
    const app = buildApp(runtime, { viteOrigin: "https://live.babiesbo.uk" });
    apps.push(app);
    app.post("/api/test-dashboard-origin", async () => ({ accepted: true }));

    const localDashboard = await app.inject({
      method: "POST",
      url: "/api/test-dashboard-origin",
      headers: { origin: "http://127.0.0.1:4311" }
    });
    expect(localDashboard.statusCode).toBe(200);
    expect(localDashboard.headers["access-control-allow-origin"])
      .toBe("http://127.0.0.1:4311");

    const publicDashboard = await app.inject({
      method: "POST",
      url: "/api/test-dashboard-origin",
      headers: { origin: "https://live.babiesbo.uk" }
    });
    expect(publicDashboard.statusCode).toBe(200);
    expect(publicDashboard.headers["access-control-allow-origin"])
      .toBe("https://live.babiesbo.uk");
  });

  it("sets no-store on every API response including early and generated errors", async () => {
    const runtime = await readyRuntime();
    const app = buildApp(runtime, { viteOrigin: "http://127.0.0.1:4311" });
    apps.push(app);
    app.get("/api/test-server-error", async () => {
      throw new Error("synthetic test failure");
    });

    const responses = await Promise.all([
      app.inject({
        method: "GET",
        url: "/api/health",
        headers: { origin: "http://attacker.example" }
      }),
      app.inject({ method: "GET", url: "/api/snapshot?category=TENNIS" }),
      app.inject({ method: "GET", url: "/api/not-found" }),
      app.inject({ method: "GET", url: "/api/test-server-error" })
    ]);

    expect(responses.map((response) => response.statusCode)).toEqual([403, 400, 404, 500]);
    expect(responses.map((response) => response.headers["cache-control"])).toEqual([
      "no-store",
      "no-store",
      "no-store",
      "no-store"
    ]);
  });
});

describe("Fastify realtime API", () => {
  it("rejects an upgrade whose Origin only matches attacker-controlled host headers", async () => {
    const adapter = new AdvancingFixtureAdapter();
    const runtime = new Runtime({ adapters: [adapter], clock });
    await runtime.start(new AbortController().signal);
    const app = buildApp(runtime, { viteOrigin: "http://127.0.0.1:4311" });
    apps.push(app);
    const address = new URL(await app.listen({ host: "127.0.0.1", port: 0 }));
    address.protocol = "ws:";
    address.pathname = "/api/realtime";

    const statusCode = await new Promise<number>((resolve, reject) => {
      let settled = false;
      const socket = new WebSocketClient(address, {
        origin: "http://attacker.example",
        headers: {
          host: "attacker.example",
          "x-forwarded-host": "127.0.0.1:4310",
          "x-forwarded-proto": "http"
        }
      });
      sockets.push(socket);
      socket.once("unexpected-response", (_request, response) => {
        settled = true;
        resolve(response.statusCode ?? 0);
      });
      socket.once("open", () => {
        if (settled) return;
        settled = true;
        socket.terminate();
        reject(new Error("Attacker-controlled WebSocket origin was accepted"));
      });
      socket.once("error", (error) => {
        if (settled) return;
        settled = true;
        reject(error);
      });
    });

    expect(statusCode).toBe(403);
  });

  it("drops a slow client before queuing another revision", () => {
    let closedWith: number | undefined;
    const socket = {
      readyState: 1,
      bufferedAmount: 900,
      close(code: number): void {
        closedWith = code;
      },
      terminate(): void {},
      send(): never {
        throw new Error("must not queue on a slow client");
      }
    };

    expect(sendBoundedMessage(socket, "x".repeat(200), 1_024)).toBe(false);
    expect(closedWith).toBe(1013);
  });

  it("keeps a client open when ws reports null for a successful send", () => {
    let closed = false;
    const socket = {
      readyState: 1,
      bufferedAmount: 0,
      close(): void {
        closed = true;
      },
      terminate(): void {},
      send(_payload: string, callback?: (error?: Error | null) => void): void {
        callback?.(null);
      }
    };

    expect(sendBoundedMessage(socket, "snapshot", 1_024)).toBe(true);
    expect(closed).toBe(false);
  });

  it("sends a full snapshot, publishes only a higher revision, and recovers on reconnect", async () => {
    const adapter = new AdvancingFixtureAdapter();
    const runtime = new Runtime({ adapters: [adapter], clock });
    await runtime.start(new AbortController().signal);
    const app = buildApp(runtime, { heartbeatIntervalMs: 60_000 });
    apps.push(app);
    await app.ready();

    const firstMessages = collectMessages();
    const firstSocket = await app.injectWS("/api/realtime", {}, { onInit: firstMessages.onInit });
    sockets.push(firstSocket);
    const initial = await firstMessages.next();
    expect(RealtimeMessageSchema.safeParse(initial).success).toBe(true);
    expect(initial).toEqual({
      type: "SNAPSHOT",
      revision: runtime.getSnapshot().revision,
      data: runtime.getSnapshot()
    });

    adapter.advanceClock(1_000);
    const advanced = await firstMessages.next();
    expect(advanced).toEqual({
      type: "SNAPSHOT",
      revision: runtime.getSnapshot().revision,
      data: runtime.getSnapshot()
    });
    expect((advanced as { revision: number }).revision).toBeGreaterThan(
      (initial as { revision: number }).revision
    );

    firstSocket.terminate();
    const reconnectMessages = collectMessages();
    const reconnected = await app.injectWS("/api/realtime", {}, {
      onInit: reconnectMessages.onInit
    });
    sockets.push(reconnected);
    expect(await reconnectMessages.next()).toEqual({
      type: "SNAPSHOT",
      revision: runtime.getSnapshot().revision,
      data: runtime.getSnapshot()
    });
  });

  it("sends a catalog revision baseline and only the accepted changed account", async () => {
    const runtime = await readyRuntime();
    const revisions = new CatalogRevisionStore({ now: () => 1_000 });
    const app = buildApp(runtime, { heartbeatIntervalMs: 60_000, catalogRevisions: revisions });
    apps.push(app);
    await app.ready();
    const messages = collectMessages();
    const socket = await app.injectWS("/api/realtime", {}, { onInit: messages.onInit });
    sockets.push(socket);

    expect(await messages.next()).toMatchObject({ type: "SNAPSHOT" });
    expect(await messages.next()).toEqual({
      type: "CATALOG_REVISION_BASELINE", sequence: 0, entries: []
    });

    const catalog = {
      dataMode: "LIVE" as const, accountId: "catalog-source:SABA:FOOTBALL",
      provider: "SABA" as const, category: "FOOTBALL" as const,
      comparisonState: "AWAITING_SECOND_PROVIDER" as const, observedAtMs: 1_000,
      rejectedMarketCount: 0, events: [], markets: [], quotes: []
    };
    const accepted = revisions.publish(catalog.accountId, catalog, {
      snapshotState: "FRESH", freshnessMs: 20_000
    });

    expect(await messages.next()).toEqual({
      type: "CATALOG_REVISION", sequence: accepted.sequence,
      accountId: accepted.accountId, revision: accepted.revision,
      observedAtMs: accepted.observedAtMs, snapshotState: "FRESH"
    });
  });

  it("emits heartbeats carrying the current revision", async () => {
    const adapter = new AdvancingFixtureAdapter();
    const runtime = new Runtime({ adapters: [adapter], clock });
    await runtime.start(new AbortController().signal);
    const app = buildApp(runtime, { heartbeatIntervalMs: 5 });
    apps.push(app);
    await app.ready();

    const messages = collectMessages();
    const socket = await app.injectWS("/api/realtime", {}, { onInit: messages.onInit });
    sockets.push(socket);
    await messages.next();

    expect(await messages.next()).toMatchObject({
      type: "HEARTBEAT",
      revision: runtime.getSnapshot().revision,
      serverTimeMs: expect.any(Number)
    });
  });

  it("fails closed when the initial full snapshot exceeds the configured cap", async () => {
    const adapter = new AdvancingFixtureAdapter();
    const runtime = new Runtime({ adapters: [adapter], clock });
    await runtime.start(new AbortController().signal);
    const app = buildApp(runtime, { maxBufferedBytes: 1 });
    apps.push(app);
    await app.ready();

    let resolveClose: ((code: number) => void) | undefined;
    const closed = new Promise<number>((resolve) => {
      resolveClose = resolve;
    });
    const socket = await app.injectWS("/api/realtime", {}, {
      onInit(client) {
        client.once("close", (code) => resolveClose?.(code));
      }
    });
    sockets.push(socket);

    await expect(closed).resolves.toBe(1009);
  });
});
