import { describe, expect, it } from "vitest";
import { CatalogCoverageGuard } from "./catalog-coverage-guard.js";

describe("CatalogCoverageGuard", () => {
  const candidate = (generation: string, authoritativeBaseline: boolean, providerEventIds: readonly string[]) =>
    ({ generation, authoritativeBaseline, providerEventIds });

  it("rejects a ten-to-nine identity shrink", () => {
    const guard = new CatalogCoverageGuard();
    expect(guard.accept("source", candidate("A", true,
      ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10"]))).toBe(true);
    expect(guard.accept("source", candidate("A", false,
      ["1", "2", "3", "4", "5", "6", "7", "8", "9"]))).toBe(false);
  });

  it("rejects equal-count identity replacement", () => {
    const guard = new CatalogCoverageGuard();
    expect(guard.accept("source", candidate("A", true, ["1", "2", "3"]))).toBe(true);
    expect(guard.accept("source", candidate("A", false, ["4", "5", "6"]))).toBe(false);
  });

  it("does not permit incremental shrink across accepted candidates", () => {
    const guard = new CatalogCoverageGuard();
    expect(guard.accept("source", candidate("A", true,
      ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10"]))).toBe(true);
    expect(guard.accept("source", candidate("A", false,
      ["1", "2", "3", "4", "5", "6", "7", "8", "9"]))).toBe(false);
    expect(guard.accept("source", candidate("A", false,
      ["1", "2", "3", "4", "5", "6", "7", "8"]))).toBe(false);
  });

  it("does not let a repeated authoritative generation shrink twice", () => {
    const guard = new CatalogCoverageGuard();
    expect(guard.accept("source", candidate("A", true, ["1", "2", "3"]))).toBe(true);
    expect(guard.accept("source", candidate("A", true, ["1", "2"]))).toBe(false);
  });

  it("rejects replay of authoritative generation A after A to B", () => {
    const guard = new CatalogCoverageGuard();
    expect(guard.accept("source", candidate("A", true, ["a1", "a2"]))).toBe(true);
    expect(guard.accept("source", candidate("B", true, ["b1"]))).toBe(true);
    expect(guard.accept("source", candidate("A", true, ["a1", "a2"]))).toBe(false);
  });

  it("rejects an old authoritative generation replay that is a superset of current coverage", () => {
    const guard = new CatalogCoverageGuard();
    expect(guard.accept("source", candidate("A", true, ["a", "b"]))).toBe(true);
    expect(guard.accept("source", candidate("B", true, ["b"]))).toBe(true);
    expect(guard.accept("source", candidate("A", true, ["a", "b"]))).toBe(false);
  });

  it("tracks CMD cursors and same-cursor observations with one monotonic lineage", () => {
    const guard = new CatalogCoverageGuard();
    for (let cursor = 0; cursor < 50_000; cursor += 1) {
      if (!guard.accept("source", candidate(`cmd:${cursor}`, true, [`event-${cursor}`]))) {
        throw new Error(`CMD cursor ${cursor} was unexpectedly rejected`);
      }
    }
    for (let observation = 0; observation < 50_000; observation += 1) {
      if (!guard.accept("source", candidate(
        `cmd:49999:observation:${observation}`, true, [`observation-${observation}`]
      ))) throw new Error(`CMD observation ${observation} was unexpectedly rejected`);
    }

    expect(guard.accept("source", candidate("cmd:49998:observation:90000", true, ["old-cursor"]))).toBe(false);
    expect(guard.accept("source", candidate("cmd:49999:observation:49999", true, ["repeat"]))).toBe(false);
    expect(guard.accept("source", candidate("cmd:50000", true, ["next-cursor"]))).toBe(true);
    expect(guard.checkpoint().states.get("source")?.comparableAuthoritativeOrders.size).toBe(1);
    guard.reset("source");
    expect(guard.accept("source", candidate("cmd:1", true, ["after-reset"]))).toBe(true);
  });

  it("tracks IM snapshot ordinals without exhausting history", () => {
    const guard = new CatalogCoverageGuard();
    for (let ordinal = 1; ordinal <= 50_000; ordinal += 1) {
      if (!guard.accept("source", candidate(`im:8:${ordinal}`, true, [`event-${ordinal}`]))) {
        throw new Error(`IM generation ${ordinal} was unexpectedly rejected`);
      }
    }

    expect(guard.accept("source", candidate("im:8:1", true, ["old"]))).toBe(false);
    expect(guard.accept("source", candidate("im:8:50000", true, ["repeat"]))).toBe(false);
    expect(guard.accept("source", candidate("im:8:50001", true, ["next"]))).toBe(true);
    expect(guard.checkpoint().states.get("source")?.comparableAuthoritativeOrders.size).toBe(1);
    guard.reset("source");
    expect(guard.accept("source", candidate("im:8:1", true, ["after-reset"]))).toBe(true);
  });

  it("tracks BTI timestamp generations without exhausting lineage history", () => {
    const guard = new CatalogCoverageGuard();
    for (let index = 1; index <= 50_000; index += 1) {
      if (!guard.accept("source", candidate(`bti:${1_788_520_000_000 + index}:${index}`, true,
        [`event-${index}`]))) throw new Error(`BTI generation ${index} was unexpectedly rejected`);
    }

    expect(guard.accept("source", candidate("bti:1788520000001:999999", true, ["old"]))).toBe(false);
    expect(guard.accept("source", candidate("bti:1788520050000:50000", true, ["repeat"]))).toBe(false);
    expect(guard.accept("source", candidate("bti:1788520050001:1", true, ["next"]))).toBe(true);
    expect(guard.checkpoint().states.get("source")?.comparableAuthoritativeOrders.size).toBe(1);
    guard.reset("source");
    expect(guard.accept("source", candidate("bti:1788520000001:1", true, ["after-reset"]))).toBe(true);
  });

  it("tracks canonical source-epoch fallback sequences without exhausting history", () => {
    const guard = new CatalogCoverageGuard();
    for (let sequence = 0; sequence < 50_000; sequence += 1) {
      if (!guard.accept("source", candidate(`worker-a:0:${sequence}`, true, [`event-${sequence}`]))) {
        throw new Error(`fallback sequence ${sequence} was unexpectedly rejected`);
      }
    }

    expect(guard.accept("source", candidate("worker-a:0:1", true, ["old"]))).toBe(false);
    expect(guard.accept("source", candidate("worker-a:0:49999", true, ["repeat"]))).toBe(false);
    expect(guard.accept("source", candidate("worker-a:0:50000", true, ["next"]))).toBe(true);
    expect(guard.checkpoint().states.get("source")?.comparableAuthoritativeOrders.size).toBe(1);
    guard.reset("source");
    expect(guard.accept("source", candidate("worker-a:0:1", true, ["after-reset"]))).toBe(true);
  });

  it("tracks SABA streams and frame sequences with one epoch lineage", () => {
    const guard = new CatalogCoverageGuard();
    for (let stream = 1; stream <= 50_000; stream += 1) {
      if (!guard.accept("source", candidate(
        `worker-a:0:saba:${stream}:1`, true, [`event-${stream}`]
      ))) throw new Error(`SABA stream ${stream} was unexpectedly rejected`);
    }

    expect(guard.accept("source", candidate("worker-a:0:saba:1:999999", true, ["old-stream"]))).toBe(false);
    expect(guard.accept("source", candidate("worker-a:0:saba:50000:1", true, ["repeat"]))).toBe(false);
    expect(guard.accept("source", candidate("worker-a:0:saba:50000:2", true, ["same-stream-next"]))).toBe(true);
    expect(guard.accept("source", candidate("worker-a:0:saba:50001:0", true, ["next-stream"]))).toBe(true);
    expect(guard.checkpoint().states.get("source")?.comparableAuthoritativeOrders.size).toBe(1);
    guard.reset("source");
    expect(guard.accept("source", candidate("worker-a:0:saba:1:1", true, ["after-reset"]))).toBe(true);
  });

  it("tracks TSPORT JSON stream identities by their monotonic open sequence", () => {
    const guard = new CatalogCoverageGuard();
    const generation = (streamId: string, sequence: number): string =>
      JSON.stringify(["TSPORT", "chrome:TSPORT:7", "worker-a:0", streamId, sequence]);
    for (let sequence = 0; sequence < 50_000; sequence += 1) {
      if (!guard.accept("source", candidate(generation(String(sequence + 1), sequence), true,
        [`event-${sequence}`]))) throw new Error(`TSPORT sequence ${sequence} was unexpectedly rejected`);
    }

    expect(guard.accept("source", candidate(generation("old-stream", 1), true, ["old"]))).toBe(false);
    expect(guard.accept("source", candidate(generation("different-stream", 49_999), true, ["same-order"])))
      .toBe(false);
    expect(guard.accept("source", candidate(generation("50001", 50_000), true, ["next"]))).toBe(true);
    expect(guard.checkpoint().states.get("source")?.comparableAuthoritativeOrders.size).toBe(1);
    guard.reset("source");
    expect(guard.accept("source", candidate(generation("old-stream", 1), true, ["after-reset"]))).toBe(true);
  });

  it("tracks fifty thousand canonical KSPORT HTTP generations by monotonic ordinal", () => {
    const guard = new CatalogCoverageGuard();
    for (let ordinal = 1; ordinal <= 50_000; ordinal += 1) {
      if (!guard.accept("source", candidate(
        `worker-a:0:ksport-http:8:${ordinal}`, true, [`event-${ordinal}`]
      ))) throw new Error(`canonical generation ${ordinal} was unexpectedly rejected`);
    }

    const checkpoint = guard.checkpoint();
    expect(guard.accept("source", candidate("worker-a:0:ksport-http:8:1", true, ["old"]))).toBe(false);
    expect(guard.accept("source", candidate("worker-a:0:ksport-http:8:50000", true, ["repeat"]))).toBe(false);
    expect(guard.accept("source", candidate("worker-a:0:ksport-http:8:50001", true, ["new"]))).toBe(true);
    guard.restoreCheckpoint(checkpoint);
    expect(guard.accept("source", candidate("worker-a:0:ksport-http:8:50001", true, ["new"]))).toBe(true);
    expect(guard.checkpoint().states.get("source")?.comparableAuthoritativeOrders.size).toBe(1);
    guard.reset("source");
    expect(guard.accept("source", candidate("worker-a:0:ksport-http:8:1", true, ["after-reset"]))).toBe(true);
  });

  it("tracks fifty thousand canonical KSPORT WS stream generations without exhausting history", () => {
    const guard = new CatalogCoverageGuard();
    for (let streamOrdinal = 1; streamOrdinal <= 50_000; streamOrdinal += 1) {
      if (!guard.accept("source", candidate(
        `worker-a:0:ksport-ws:${streamOrdinal}:1`, true, [`event-${streamOrdinal}`]
      ))) throw new Error(`canonical WS stream ${streamOrdinal} was unexpectedly rejected`);
    }

    expect(guard.accept("source", candidate("worker-a:0:ksport-ws:1:999999", true, ["old-stream"])))
      .toBe(false);
    expect(guard.accept("source", candidate("worker-a:0:ksport-ws:50000:1", true, ["repeat"])))
      .toBe(false);
    expect(guard.accept("source", candidate("worker-a:0:ksport-ws:50000:2", true, ["recovery"])))
      .toBe(true);
    expect(guard.accept("source", candidate("worker-a:0:ksport-ws:50001:1", true, ["new-stream"])))
      .toBe(true);
    expect(guard.checkpoint().states.get("source")?.comparableAuthoritativeOrders.size).toBe(1);
    guard.reset("source");
    expect(guard.accept("source", candidate("worker-a:0:ksport-ws:1:1", true, ["after-reset"]))).toBe(true);
  });

  it("normalizes the exact legacy KSPORT stream alias into the same WS ordering lineage", () => {
    const guard = new CatalogCoverageGuard();
    expect(guard.accept("source", candidate("legacy:ksport-ws:ksport-stream-1:1", true, ["first"])))
      .toBe(true);
    expect(guard.accept("source", candidate("legacy:ksport-ws:1:1", true, ["alias-replay"])))
      .toBe(false);
    expect(guard.accept("source", candidate("legacy:ksport-ws:1:2", true, ["next"]))).toBe(true);
    expect(guard.accept("source", candidate("legacy:ksport-ws:ksport-stream-1:2", true, ["repeat"])))
      .toBe(false);
  });

  it("orders KSPORT WS generations lexicographically within each source epoch", () => {
    const guard = new CatalogCoverageGuard();
    expect(guard.accept("source", candidate("worker-a:0:ksport-ws:2:2", true, ["a-2-2"]))).toBe(true);
    expect(guard.accept("source", candidate("worker-b:0:ksport-ws:1:1", true, ["b-1-1"]))).toBe(true);
    expect(guard.accept("source", candidate("worker-a:0:ksport-ws:1:99", true, ["a-old-stream"])))
      .toBe(false);
    expect(guard.accept("source", candidate("worker-a:0:ksport-ws:2:1", true, ["a-old-recovery"])))
      .toBe(false);
    expect(guard.accept("source", candidate("worker-a:0:ksport-ws:2:3", true, ["a-next"]))).toBe(true);
  });

  it("rejects lower and repeated canonical ordinals after lineage A to B to A", () => {
    const guard = new CatalogCoverageGuard();
    expect(guard.accept("source", candidate("worker-a:0:ksport-http:8:2", true, ["a2"]))).toBe(true);
    expect(guard.accept("source", candidate("worker-b:0:ksport-http:8:2", true, ["b2"]))).toBe(true);
    expect(guard.accept("source", candidate("worker-a:0:ksport-http:8:1", true, ["a1"]))).toBe(false);
    expect(guard.accept("source", candidate("worker-a:0:ksport-http:8:2", true, ["a2-repeat"]))).toBe(false);
    expect(guard.accept("source", candidate("worker-a:0:ksport-http:8:3", true, ["a3"]))).toBe(true);
  });

  it("bounds canonical lineage history and fail-closes unseen lineages without blocking a known lineage", () => {
    const guard = new CatalogCoverageGuard();
    let firstRejectedLineage: number | null = null;
    for (let index = 0; index < 128; index += 1) {
      if (!guard.accept("source", candidate(`worker-${index}:0:ksport-http:8:1`, true, [String(index)]))) {
        firstRejectedLineage = index;
        break;
      }
    }

    expect(firstRejectedLineage).not.toBeNull();
    expect(guard.accept("source", candidate("worker-0:0:ksport-http:8:2", true, ["known"]))).toBe(true);
    expect(guard.accept("source", candidate("worker-unseen:0:ksport-http:8:1", true, ["unseen"]))).toBe(false);
    guard.reset("source");
    expect(guard.accept("source", candidate("worker-unseen:0:ksport-http:8:1", true, ["recovered"]))).toBe(true);
  });

  it("bounds unrecognized opaque generations and fail-closes until an explicit reset", () => {
    const guard = new CatalogCoverageGuard();
    for (let index = 0; index < 256; index += 1) {
      if (!guard.accept("source", candidate(`opaque-${index}`, true, [String(index)]))) {
        throw new Error(`opaque generation ${index} was unexpectedly rejected before the bound`);
      }
    }

    expect(guard.accept("source", candidate("opaque-0", true, ["replay"]))).toBe(false);
    expect(guard.accept("source", candidate("opaque-256", true, ["unrecognized-after-bound"]))).toBe(false);
    expect(guard.checkpoint().states.get("source")?.opaqueAuthoritativeGenerations.size).toBe(256);
    guard.reset("source");
    expect(guard.accept("source", candidate("opaque-256", true, ["after-reset"]))).toBe(true);
  });

  it("does not let malformed reserved provider generations bypass the opaque bound", () => {
    const malformedCases = [
      ["CMD", (index: number) => `cmd:${index}:0`],
      ["IM", (index: number) => `im:${index}:0`],
      ["BTI", (index: number) => `bti:${index}:invalid`],
      ["KSPORT HTTP", (index: number) => `worker-a:0:ksport-http:${index}:0`],
      ["KSPORT WS", (index: number) => `worker-a:0:ksport-ws:0:${index + 1}`],
      ["SABA", (index: number) => `worker-a:0:saba:0:${index}`]
    ] as const;

    for (const [provider, malformed] of malformedCases) {
      const guard = new CatalogCoverageGuard();
      for (let index = 0; index < 256; index += 1) {
        if (!guard.accept("source", candidate(malformed(index), true, [String(index)]))) {
          throw new Error(`${provider} malformed generation ${index} was rejected before the opaque bound`);
        }
      }
      expect(guard.accept("source", candidate(malformed(256), true, ["after-bound"]))).toBe(false);
      expect(guard.checkpoint().states.get("source")?.comparableAuthoritativeOrders.size).toBe(0);
    }
  });

  it("starts a fresh opaque replay lineage only after an explicit coverage reset", () => {
    const guard = new CatalogCoverageGuard();
    expect(guard.accept("source", candidate("opaque-current", true, ["first"]))).toBe(true);
    expect(guard.accept("source", candidate("opaque-current", true, ["replay"]))).toBe(false);
    guard.reset("source");
    expect(guard.accept("source", candidate("opaque-current", true, ["recovered"]))).toBe(true);
  });

  it("accepts an incremental DELTA that preserves current coverage", () => {
    const guard = new CatalogCoverageGuard();
    expect(guard.accept("source", candidate("A", true, ["a"]))).toBe(true);
    expect(guard.accept("source", candidate("A", false, ["a", "b"]))).toBe(true);
  });

  it("rejects a smaller non-authoritative candidate", () => {
    const guard = new CatalogCoverageGuard();
    const ids = (count: number) => Array.from({ length: count }, (_, index) => `event-${index}`);

    expect(guard.accept("SABA|FOOTBALL", { generation: "reset-1", authoritativeBaseline: true,
      providerEventIds: ids(293) })).toBe(true);
    expect(guard.accept("SABA|FOOTBALL", { generation: "reset-1", authoritativeBaseline: false,
      providerEventIds: ids(100) })).toBe(false);
  });

  it("lets a new authoritative generation remove old events exactly once", () => {
    const guard = new CatalogCoverageGuard();
    const ids = (count: number) => Array.from({ length: count }, (_, index) => `event-${index}`);

    expect(guard.accept("catalog-source:SABA:FOOTBALL", { generation: "reset-1", authoritativeBaseline: true,
      providerEventIds: ids(10) })).toBe(true);
    expect(guard.accept("catalog-source:SABA:FOOTBALL", { generation: "reset-2", authoritativeBaseline: true,
      providerEventIds: ids(1) })).toBe(true);
    expect(guard.accept("catalog-source:SABA:FOOTBALL", { generation: "reset-2", authoritativeBaseline: true,
      providerEventIds: [] })).toBe(false);
  });

  it("forgets prior coverage on an explicit reset", () => {
    const guard = new CatalogCoverageGuard();
    const candidate = { generation: "reset-1", authoritativeBaseline: false,
      providerEventIds: ["event-1", "event-2"] } as const;
    expect(guard.accept("catalog-source:SABA:FOOTBALL", candidate)).toBe(true);
    guard.reset("catalog-source:SABA:FOOTBALL");
    expect(guard.accept("catalog-source:SABA:FOOTBALL", { ...candidate,
      providerEventIds: ["event-1"] })).toBe(true);
  });
});

describe("SABA DOM fallback generations", () => {
  // Measured 2026-09-01: every `<epoch>:dom:<sequence>` baseline was opaque to
  // the guard, and after 256 of them every later DOM snapshot was refused,
  // freezing SABA for minutes at a time while its socket never resent reset.
  it("keeps accepting hundreds of successive DOM snapshots within one source epoch", () => {
    const guard = new CatalogCoverageGuard();
    const ids = Array.from({ length: 110 }, (_, index) => `saba-${index}`);
    for (let sequence = 1; sequence <= 600; sequence += 1) {
      expect(guard.accept("SABA", { generation: `22b762de-aaaa:1:dom:${sequence * 3}`,
        authoritativeBaseline: true, providerEventIds: ids })).toBe(true);
    }
  });

  it("still refuses a DOM snapshot that replays an older sequence of the same epoch", () => {
    const guard = new CatalogCoverageGuard();
    const ids = Array.from({ length: 110 }, (_, index) => `saba-${index}`);
    expect(guard.accept("SABA", { generation: "22b762de-aaaa:1:dom:300", authoritativeBaseline: true,
      providerEventIds: ids })).toBe(true);
    expect(guard.accept("SABA", { generation: "22b762de-aaaa:1:dom:299", authoritativeBaseline: true,
      providerEventIds: ids })).toBe(false);
    // A new source epoch is a new lineage and starts over.
    expect(guard.accept("SABA", { generation: "22b762de-aaaa:2:dom:5", authoritativeBaseline: true,
      providerEventIds: ids })).toBe(true);
  });
});

describe("an authoritative baseline must not collapse a populated catalog", () => {
  const ids = (count: number, offset = 0): string[] =>
    Array.from({ length: count }, (_, index) => `event-${index + offset}`);

  it("refuses a baseline that drops almost every event it had accepted", () => {
    // Measured 2026-08-26 on the live stack: SABA held 269 events, a recovery
    // baseline replaced it with 12, and the next one with 0. The old catalog was
    // correct and the replacement was a viewport-sized snapshot. Keeping the
    // last good catalog stale is strictly better than serving a collapsed one.
    const guard = new CatalogCoverageGuard();
    guard.commit("saba", { generation: "gen-1", authoritativeBaseline: true,
      providerEventIds: ids(269) });

    expect(guard.allows("saba", { generation: "gen-2", authoritativeBaseline: true,
      providerEventIds: ids(12) })).toBe(false);
    expect(guard.allows("saba", { generation: "gen-3", authoritativeBaseline: true,
      providerEventIds: [] })).toBe(false);
  });

  it("still accepts the ordinary shrink of finished fixtures", () => {
    const guard = new CatalogCoverageGuard();
    guard.commit("saba", { generation: "gen-1", authoritativeBaseline: true,
      providerEventIds: ids(100) });

    expect(guard.allows("saba", { generation: "gen-2", authoritativeBaseline: true,
      providerEventIds: ids(70) })).toBe(true);
  });

  it("accepts a baseline that replaces the card entirely with a comparable size", () => {
    // A new day's fixtures share no ids with yesterday's and must still land.
    const guard = new CatalogCoverageGuard();
    guard.commit("saba", { generation: "gen-1", authoritativeBaseline: true,
      providerEventIds: ids(100) });

    expect(guard.allows("saba", { generation: "gen-2", authoritativeBaseline: true,
      providerEventIds: ids(100, 500) })).toBe(true);
  });
});
