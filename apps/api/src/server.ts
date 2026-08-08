import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { FixtureAdapter, type FixtureSnapshot } from "@tool-chenh/adapters";
import type { Category } from "@tool-chenh/contracts";
import { buildApp, validateViteOrigin } from "./app.js";
import { Runtime } from "./runtime.js";

export interface ServerConfig {
  readonly host: string;
  readonly port: number;
  readonly viteOrigin: string;
  readonly fixtureReplaySpeed: number;
}

const fixtureSources = [
  ["football/saba-snapshot.json", "SABA", "FOOTBALL"],
  ["football/im-snapshot.json", "IM", "FOOTBALL"],
  ["lol/saba-snapshot.json", "SABA", "LOL"],
  ["lol/im-snapshot.json", "IM", "LOL"]
] as const;

const fixtureMappingPolicy = {
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

const inspectableFixtureEndMs = 90;

function positiveNumber(value: string | undefined, fallback: number, name: string): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`${name} must be positive`);
  return parsed;
}

function portNumber(value: string | undefined): number {
  const port = positiveNumber(value, 4310, "API_PORT");
  if (!Number.isSafeInteger(port) || port > 65_535) {
    throw new Error("API_PORT must be an integer between 1 and 65535");
  }
  return port;
}

function loopbackHost(value: string | undefined): string {
  const host = value ?? "127.0.0.1";
  if (!["127.0.0.1", "localhost", "::1"].includes(host)) {
    throw new Error("API_HOST must be a loopback host");
  }
  return host;
}

export function resolveServerConfig(env: Readonly<Record<string, string | undefined>>): ServerConfig {
  return {
    host: loopbackHost(env.API_HOST),
    port: portNumber(env.API_PORT),
    viteOrigin: validateViteOrigin(env.VITE_ORIGIN ?? "http://127.0.0.1:4311"),
    fixtureReplaySpeed: positiveNumber(env.FIXTURE_REPLAY_SPEED, 1, "FIXTURE_REPLAY_SPEED")
  };
}

export function createFixtureRuntime(speed: number): Runtime {
  const adapters = fixtureSources.map(([path, provider, category]) => {
    const sourceFixture = JSON.parse(
      readFileSync(new URL(`../../../fixtures/${path}`, import.meta.url), "utf8")
    ) as FixtureSnapshot;
    const fixture: FixtureSnapshot = {
      ...sourceFixture,
      records: sourceFixture.records.filter((record) => record.offsetMs <= inspectableFixtureEndMs)
    };
    return new FixtureAdapter(fixture, {
      id: fixture.adapterId,
      provider,
      category: category as Category,
      speed
    });
  });
  return new Runtime({
    adapters,
    mappingPolicy: fixtureMappingPolicy,
    clock: {
      now: () => ({ monotonicNowMs: 100, wallClockNowMs: Date.now() })
    }
  });
}

export async function startServer(env: Readonly<Record<string, string | undefined>> = process.env) {
  const config = resolveServerConfig(env);
  const runtime = createFixtureRuntime(config.fixtureReplaySpeed);
  const controller = new AbortController();
  await runtime.start(controller.signal);
  const app = buildApp(runtime, { viteOrigin: config.viteOrigin });
  await app.listen({ host: config.host, port: config.port });
  return {
    app,
    runtime,
    async stop(): Promise<void> {
      controller.abort();
      await app.close();
    }
  };
}

const entryPath = process.argv[1];
if (entryPath !== undefined && import.meta.url === pathToFileURL(entryPath).href) {
  startServer().then(({ stop }) => {
    const shutdown = (): void => {
      void stop().then(() => process.exit(0), () => process.exit(1));
    };
    process.once("SIGINT", shutdown);
    process.once("SIGTERM", shutdown);
  }, () => {
    process.stderr.write("API failed to start\n");
    process.exitCode = 1;
  });
}
