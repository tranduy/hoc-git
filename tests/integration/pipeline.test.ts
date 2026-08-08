import { readFileSync } from "node:fs";
import { FixtureAdapter, type FixtureSnapshot, type ReplayScheduler } from "@tool-chenh/adapters";
import type { Category } from "@tool-chenh/contracts";
import { describe, expect, it } from "vitest";
import { Runtime, type RuntimeClock } from "../../apps/api/src/runtime.js";

class ManualClock implements RuntimeClock, ReplayScheduler {
  #nowMs = 0;
  readonly #waiters: Array<{
    readonly targetMs: number;
    readonly resolve: () => void;
    readonly reject: (reason: unknown) => void;
    readonly signal: AbortSignal;
  }> = [];

  now() {
    return {
      monotonicNowMs: this.#nowMs,
      wallClockNowMs: 1_800_000_000_000 + this.#nowMs
    };
  }

  wait(delayMs: number, signal: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      this.#waiters.push({ targetMs: this.#nowMs + delayMs, resolve, reject, signal });
    });
  }

  async advanceTo(nowMs: number): Promise<void> {
    this.#nowMs = nowMs;
    for (let pass = 0; pass < 20; pass += 1) {
      const ready = this.#waiters.filter((waiter) => waiter.targetMs <= nowMs);
      if (ready.length === 0) {
        await Promise.resolve();
        if (!this.#waiters.some((waiter) => waiter.targetMs <= nowMs)) return;
        continue;
      }
      for (const waiter of ready) {
        this.#waiters.splice(this.#waiters.indexOf(waiter), 1);
        if (waiter.signal.aborted) waiter.reject(new DOMException("Aborted", "AbortError"));
        else waiter.resolve();
      }
      await Promise.resolve();
    }
    throw new Error("fixture replay did not settle");
  }
}

const fixturePaths = [
  ["football/saba-snapshot.json", "SABA", "FOOTBALL"],
  ["football/im-snapshot.json", "IM", "FOOTBALL"],
  ["lol/saba-snapshot.json", "SABA", "LOL"],
  ["lol/im-snapshot.json", "IM", "LOL"]
] as const;

function fixture(path: string, category: Category): FixtureSnapshot {
  const snapshot = JSON.parse(
    readFileSync(new URL(`../../fixtures/${path}`, import.meta.url), "utf8")
  ) as FixtureSnapshot;
  const records = snapshot.records
    .filter((record) =>
      category === "FOOTBALL" ||
      record.kind !== "QUOTE" ||
      (record.payload as { marketType?: string }).marketType === "MAP_WINNER"
    )
    .map((record) => {
      const offsetMs = record.offsetMs === 90 ? 1_200 : record.offsetMs === 100 ? 1_300 : record.offsetMs;
      const payload = record.payload as {
        provider?: string;
        providerEventId?: string;
        providerMarketId?: string;
        marketType?: string;
      };
      const collisionMarketId = payload.marketType === "MAP_WINNER"
        ? payload.provider === "SABA" ? "saba-fb-total-25" : "im-fb-total-25"
        : payload.providerMarketId;
      const collisionEventId = category === "LOL"
        ? payload.providerEventId?.replace("-lol-", "-fb-")
        : payload.providerEventId;
      const identityAdjustedPayload = collisionEventId !== payload.providerEventId ||
        collisionMarketId !== payload.providerMarketId
        ? {
            ...payload,
            ...(collisionEventId === undefined ? {} : { providerEventId: collisionEventId }),
            ...(collisionMarketId === undefined ? {} : { providerMarketId: collisionMarketId })
          }
        : payload;
      const adjustedPayload = collisionEventId === "im-fb-rejected" && category === "FOOTBALL"
        ? { ...identityAdjustedPayload, startAtUtcMs: 1_786_305_610_000 }
        : identityAdjustedPayload;
      if (record.kind !== "QUOTE" || offsetMs === record.offsetMs) {
        return { ...record, payload: adjustedPayload };
      }
      return {
        ...record,
        offsetMs,
        payload: { ...adjustedPayload, receivedMonotonicMs: offsetMs }
      };
    });
  return { ...snapshot, records };
}

describe("fixture pipeline", () => {
  it("keeps categories separate and gates opportunities by mapping, TTL, and suspension", async () => {
    const clock = new ManualClock();
    const adapters = fixturePaths.map(([path, provider, category]) => {
      const snapshot = fixture(path, category);
      return new FixtureAdapter(snapshot, {
        id: snapshot.adapterId,
        provider,
        category,
        scheduler: clock
      });
    });
    const runtime = new Runtime({
      adapters,
      clock,
      mappingPolicy: {
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
      }
    });
    const controller = new AbortController();
    const revisions: number[] = [];
    runtime.subscribe((snapshot) => revisions.push(snapshot.revision));
    const replay = runtime.start(controller.signal);

    for (const offsetMs of [0, 10, 20, 30, 40, 50, 55, 60, 65, 70]) {
      await clock.advanceTo(offsetMs);
    }
    const initial = runtime.getSnapshot();
    expect(initial.counts.FOOTBALL).toEqual({ events: 2, markets: 2 });
    expect(initial.counts.LOL).toEqual({ events: 2, markets: 2 });
    expect(initial.events.filter((event) => event.mappingStatus === "VERIFIED")).toHaveLength(2);
    expect(initial.events.filter((event) => event.mappingStatus !== "VERIFIED")).toHaveLength(2);
    expect(initial.providerStatuses.map((status) => status.adapterId).sort()).toEqual([
      "im-football",
      "im-lol",
      "saba-football",
      "saba-lol"
    ]);
    expect(initial.opportunities).toHaveLength(1);
    expect(initial.opportunities[0]?.category).toBe("FOOTBALL");

    await clock.advanceTo(1_100);
    expect(runtime.getSnapshot().opportunities).toEqual([]);

    await clock.advanceTo(1_200);
    expect(runtime.getSnapshot().opportunities).toHaveLength(1);

    await clock.advanceTo(1_300);
    expect(runtime.getSnapshot().opportunities).toEqual([]);
    expect(revisions.every((revision, index) => index === 0 || revision > revisions[index - 1]!)).toBe(true);

    await replay;
    controller.abort();
  });
});
