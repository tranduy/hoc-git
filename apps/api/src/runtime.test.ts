import { readFileSync } from "node:fs";
import {
  FixtureAdapter,
  type FixtureSnapshot,
  type ProviderAdapter,
  type ProviderSink,
  type ReplayScheduler
} from "@tool-chenh/adapters";
import {
  AppSnapshotSchema,
  type Category,
  type ProviderConnectionStatus,
  type ProviderEvent,
  type ProviderMarket,
  type ProviderQuote
} from "@tool-chenh/contracts";
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

function emitRecord(
  sink: ProviderSink,
  record: FixtureSnapshot["records"][number],
  quoteIdPrefix = ""
): void {
  switch (record.kind) {
    case "STATUS":
      sink.onStatus(record.payload as ProviderConnectionStatus);
      return;
    case "EVENT":
      sink.onEvent(record.payload as ProviderEvent);
      return;
    case "MARKET":
      sink.onMarket(record.payload as ProviderMarket);
      return;
    case "QUOTE": {
      const quote = record.payload as ProviderQuote;
      sink.onQuote({
        ...quote,
        providerSelectionId: `${quoteIdPrefix}${quote.providerSelectionId}`
      });
    }
  }
}

describe("Runtime", () => {
  it("isolates subscriber failures without leaking or misclassifying them", async () => {
    const secret = "subscriber-secret-must-not-escape";
    const runtime = new Runtime({ adapters: adapters(), clock, mappingPolicy: mappingPolicy() });
    const received: number[] = [];
    runtime.subscribe(() => {
      throw new Error(secret);
    });
    runtime.subscribe((snapshot) => received.push(snapshot.revision));

    await expect(runtime.start(new AbortController().signal)).resolves.toBeUndefined();

    expect(received.length).toBeGreaterThan(1);
    expect(received.every((revision, index) => index === 0 || revision > received[index - 1]!)).toBe(true);
    expect(runtime.getSnapshot().opportunities).toHaveLength(2);
    const diagnostics = runtime.getDiagnostics();
    expect(diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "SUBSCRIBER_FAILURE", reason: "snapshot subscriber failed" })
    ]));
    expect(diagnostics.some((item) => item.code === "ADAPTER_FAILURE")).toBe(false);
    expect(JSON.stringify(diagnostics)).not.toContain(secret);
  });

  it("quarantines one adapter without suppressing a healthy sibling source", async () => {
    const saba = loadFixture("football/saba-snapshot.json");
    const hiddenEvent = {
      ...(saba.records.find((record) => record.kind === "EVENT")!.payload as ProviderEvent),
      providerEventId: "must-stay-quarantined"
    };
    const failing: ProviderAdapter = {
      id: "failing-saba-football",
      categories: ["FOOTBALL"],
      async start(sink): Promise<void> {
        for (const record of saba.records.filter((item) => item.offsetMs <= 70)) {
          if (record.kind === "MARKET") {
            sink.onMarket({ ...(record.payload as ProviderMarket), status: "SUSPENDED" });
          } else {
            emitRecord(sink, record, "failing-");
          }
        }
        sink.onSchemaError({
          code: "SCHEMA_ERROR",
          adapterId: this.id,
          provider: "SABA",
          category: "FOOTBALL",
          recordKind: "EVENT",
          offsetMs: 1,
          issues: [{ code: "unrecognized_keys", path: ["authorization"] }]
        });
        sink.onEvent(hiddenEvent);
      }
    };
    const healthySibling: ProviderAdapter = {
      id: "healthy-saba-football",
      categories: ["FOOTBALL"],
      async start(sink): Promise<void> {
        for (const record of saba.records.filter((item) => item.offsetMs <= 90)) {
          emitRecord(sink, record);
        }
      }
    };
    const im = loadFixture("football/im-snapshot.json");
    const healthyIm: ProviderAdapter = {
      id: "im-football",
      categories: ["FOOTBALL"],
      async start(sink): Promise<void> {
        for (const record of im.records.filter((item) => item.offsetMs <= 90)) {
          emitRecord(sink, record);
        }
      }
    };
    for (const siblings of [
      [failing, healthySibling],
      [healthySibling, failing]
    ]) {
      const runtime = new Runtime({
        adapters: [healthyIm, ...siblings],
        clock,
        mappingPolicy: mappingPolicy()
      });

      await runtime.start(new AbortController().signal);

      const snapshot = runtime.getSnapshot();
      expect(snapshot.counts.FOOTBALL).toEqual({ events: 2, markets: 2 });
      expect(snapshot.opportunities.map((opportunity) => opportunity.category)).toEqual(["FOOTBALL"]);
      expect(snapshot.events.flatMap((event) => event.providerEventIds)).not.toContain("must-stay-quarantined");
      expect(snapshot.providerStatuses.filter((status) =>
        status.provider === "SABA" && status.category === "FOOTBALL"
      ).map((status) => ({ adapterId: status.adapterId, status: status.status }))).toEqual([
        { adapterId: "failing-saba-football", status: "SCHEMA_ERROR" },
        { adapterId: "healthy-saba-football", status: "LIVE" }
      ]);
      expect(runtime.getDiagnostics()).toEqual(expect.arrayContaining([
        expect.objectContaining({ code: "SCHEMA_ERROR", adapterId: "failing-saba-football" })
      ]));
    }
  });

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
