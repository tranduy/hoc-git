import { describe, expect, it, vi } from "vitest";
import type { ProviderEvent } from "@tool-chenh/contracts";
import type { LiveCatalogResponse } from "../api/catalog.js";
import { ComparisonWorkerEngine } from "./comparison-worker-engine.js";
import { ComparisonWorkerClient, type WorkerLike } from "./comparison-worker-client.js";

function catalog(accountId: string): LiveCatalogResponse {
  const event: ProviderEvent = { provider: "SABA", category: "FOOTBALL", providerEventId: accountId,
    competition: "League", seasonStage: null, startAtUtcMs: 2_000_000,
    participantA: accountId, participantB: "Opponent", eventScope: "REGULATION", bestOf: null,
    isLive: false, rematchCandidate: false, fixtureDiscriminator: null,
    isVirtual: false, sportVariant: "FOOTBALL", liveState: null };
  return { dataMode: "LIVE", accountId, provider: "SABA", category: "FOOTBALL",
    comparisonState: "AWAITING_SECOND_PROVIDER", snapshotState: "FRESH", observedAtMs: 1,
    rejectedMarketCount: 0, events: [event], markets: [], quotes: [] };
}

class FakeWorker implements WorkerLike {
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  readonly posted: unknown[] = [];
  readonly terminate = vi.fn();
  postMessage(message: unknown): void { this.posted.push(message); }
  emit(data: unknown): void { this.onmessage?.({ data } as MessageEvent); }
  fail(): void { this.onerror?.(new ErrorEvent("error")); }
}

describe("ComparisonWorkerClient", () => {
  it("ignores stale generations and hydrates compact results with current catalog references", () => {
    const worker = new FakeWorker();
    const received: number[] = [];
    const catalogsSeen: Array<readonly LiveCatalogResponse[]> = [];
    const client = new ComparisonWorkerClient({ createWorker: () => worker,
      onResult: (output) => {
        received.push(output.generation);
        catalogsSeen.push(output.displayEvents[0]?.catalogs ?? []);
      } });
    const first = catalog("first");
    const second = catalog("second");
    client.reset([first], []);
    client.upsert(second, false);
    const engine = new ComparisonWorkerEngine();
    const generation1 = engine.apply({ type: "RESET", generation: 1, catalogs: [first], staleAccountIds: [] });
    const generation2 = engine.apply({ type: "UPSERT", generation: 2, catalog: second, stale: false });

    worker.emit(generation1);
    worker.emit(generation2);

    expect(received).toEqual([2]);
    expect(catalogsSeen[0]?.map((item) => item.accountId)).toEqual(["first"]);
    client.stop();
    expect(worker.terminate).toHaveBeenCalledOnce();
  });

  it("recreates a failed worker once and requires a reset generation before accepting output", () => {
    const workers: FakeWorker[] = [];
    const received: number[] = [];
    const errors: string[] = [];
    const client = new ComparisonWorkerClient({
      createWorker: () => { const worker = new FakeWorker(); workers.push(worker); return worker; },
      onResult: (output) => received.push(output.generation),
      onError: (message) => errors.push(message)
    });
    const source = catalog("first");
    client.reset([source], []);
    workers[0]!.fail();

    expect(workers).toHaveLength(2);
    expect(workers[1]!.posted).toEqual([{
      type: "RESET", generation: 2, catalogs: [source], staleAccountIds: []
    }]);
    const output = new ComparisonWorkerEngine().apply({
      type: "RESET", generation: 2, catalogs: [source], staleAccountIds: []
    });
    workers[1]!.emit(output);
    expect(received).toEqual([2]);

    workers[1]!.fail();
    expect(workers).toHaveLength(2);
    expect(errors).toEqual(["COMPARISON_WORKER_FAILED"]);
    client.stop();
  });
});
