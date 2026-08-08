import { readFileSync } from "node:fs";
import { FixtureAdapter, type FixtureSnapshot, type ReplayScheduler } from "@tool-chenh/adapters";
import { AppSnapshotSchema, type Category } from "@tool-chenh/contracts";
import { describe, expect, it } from "vitest";
import { Runtime, type RuntimeClock } from "./runtime.js";

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

function adapters(secret?: string) {
  return fixturePaths.map(([path, provider, category]) => {
    const original = loadFixture(path);
    const records = original.records.filter((record) => record.offsetMs <= 90);
    const snapshot: FixtureSnapshot = secret !== undefined && path === "football/saba-snapshot.json"
      ? {
          ...original,
          records: [...records, {
            offsetMs: 75,
            kind: "EVENT",
            payload: { authorization: secret }
          }]
        }
      : { ...original, records };
    return new FixtureAdapter(snapshot, {
      id: snapshot.adapterId,
      provider,
      category: category as Category,
      scheduler: immediateScheduler
    });
  });
}

describe("Runtime", () => {
  it("maximizes verified event pairs instead of consuming the shortest edge greedily", async () => {
    const baseMs = 1_786_305_600_000;
    const times: Readonly<Record<string, number>> = {
      "saba-fb-verified": baseMs,
      "saba-fb-rejected": baseMs + 100_000,
      "im-fb-verified": baseMs + 40_000,
      "im-fb-rejected": baseMs - 100_000
    };
    const repeated = fixturePaths.slice(0, 2).map(([path, provider, category]) => {
      const original = loadFixture(path);
      const records = original.records
        .filter((record) => record.kind === "STATUS" || record.kind === "EVENT")
        .map((record) => record.kind !== "EVENT" ? record : {
          ...record,
          payload: {
            ...(record.payload as object),
            startAtUtcMs: times[(record.payload as { providerEventId: string }).providerEventId],
            participantA: "Northbridge FC",
            participantB: "Riverside United"
          }
        });
      const snapshot = { ...original, records };
      return new FixtureAdapter(snapshot, {
        id: snapshot.adapterId,
        provider,
        category,
        scheduler: immediateScheduler
      });
    });
    const runtime = new Runtime({ adapters: repeated, clock, mappingPolicy: mappingPolicy() });

    await runtime.start(new AbortController().signal);

    expect(runtime.getSnapshot().events.filter((event) => event.mappingStatus === "VERIFIED")).toHaveLength(2);
  });

  it("quarantines only the adapter category that emits a schema error", async () => {
    const secret = "Bearer never-expose-runtime-secret";
    const runtime = new Runtime({ adapters: adapters(secret), clock, mappingPolicy: mappingPolicy() });

    await runtime.start(new AbortController().signal);

    const snapshot = runtime.getSnapshot();
    expect(AppSnapshotSchema.safeParse(snapshot).success).toBe(true);
    expect(snapshot.opportunities.map((opportunity) => opportunity.category)).toEqual(["LOL"]);
    expect(snapshot.providerStatuses).toEqual(expect.arrayContaining([
      expect.objectContaining({ provider: "SABA", category: "FOOTBALL", status: "SCHEMA_ERROR" }),
      expect.objectContaining({ provider: "SABA", category: "LOL", status: "LIVE" })
    ]));
    expect(snapshot.blockedDiagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ category: "FOOTBALL", code: "QUOTE_SCHEMA_ERROR" })
    ]));
    expect(snapshot.counts.LOL).toEqual({ events: 2, markets: 2 });

    const observable = JSON.stringify({ snapshot, diagnostics: runtime.getDiagnostics() });
    expect(observable).not.toContain(secret);
    expect(runtime.getDiagnostics()).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "SCHEMA_ERROR", provider: "SABA", category: "FOOTBALL" })
    ]));
  });

  it("publishes frozen snapshots with strictly increasing revisions", async () => {
    const runtime = new Runtime({ adapters: adapters(), clock, mappingPolicy: mappingPolicy() });
    const revisions: number[] = [];
    const unsubscribe = runtime.subscribe((snapshot) => revisions.push(snapshot.revision));

    await runtime.start(new AbortController().signal);
    unsubscribe();

    const snapshot = runtime.getSnapshot();
    expect(AppSnapshotSchema.safeParse(snapshot).success).toBe(true);
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.events)).toBe(true);
    expect(revisions.length).toBeGreaterThan(1);
    expect(revisions.every((revision, index) => index === 0 || revision > revisions[index - 1]!)).toBe(true);
  });
});
