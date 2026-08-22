import type { ProviderAdapter, ProviderSink } from "../provider-adapter.js";
import { normalizeCmdCatalog, type CmdCatalogInputRecord, type CmdCatalogOptions } from "./cmd-normalizer.js";

export interface CmdCatalogSnapshot extends CmdCatalogOptions {
  readonly records: readonly CmdCatalogInputRecord[];
}

export interface CmdCatalogSource {
  snapshots(signal: AbortSignal): AsyncIterable<CmdCatalogSnapshot>;
}

export interface CmdAdapterOptions {
  readonly source: CmdCatalogSource;
}

export class CmdAdapter implements ProviderAdapter {
  readonly id = "cmd-football";
  readonly categories = ["FOOTBALL"] as const;
  readonly #source: CmdCatalogSource;

  constructor(options: CmdAdapterOptions) {
    this.#source = options.source;
  }

  async start(sink: ProviderSink, signal: AbortSignal): Promise<void> {
    sink.onStatus({
      adapterId: this.id, provider: "CMD", category: "FOOTBALL", status: "CONNECTING",
      detail: null, updatedAtMs: Date.now()
    });
    try {
      for await (const snapshot of this.#source.snapshots(signal)) {
        if (signal.aborted) break;
        const normalized = normalizeCmdCatalog(snapshot.records, snapshot);
        if (normalized.diagnostics.length > 0) {
          sink.onSchemaError({
            code: "SCHEMA_ERROR", adapterId: this.id, provider: "CMD", category: "FOOTBALL",
            recordKind: "UNKNOWN", offsetMs: 0,
            issues: [{ code: "CMD_CATALOG_RECORD_REJECTED", path: [] }]
          });
          sink.onStatus({
            adapterId: this.id, provider: "CMD", category: "FOOTBALL", status: "SCHEMA_ERROR",
            detail: "catalog record rejected", updatedAtMs: snapshot.observedAtMs
          });
          continue;
        }
        for (const event of normalized.events) sink.onEvent(event);
        for (const market of normalized.markets) sink.onMarket(market);
        sink.onQuoteUpdate({
          source: { provider: "CMD", category: "FOOTBALL" }, kind: "FULL_SNAPSHOT",
          transport: "POLLING", sequence: snapshot.sequence,
          clock: {
            monotonicNowMs: snapshot.receivedMonotonicMs,
            wallClockNowMs: snapshot.observedAtMs
          },
          quotes: normalized.quotes
        });
        sink.onStatus({
          adapterId: this.id, provider: "CMD", category: "FOOTBALL", status: "LIVE",
          detail: null, updatedAtMs: snapshot.observedAtMs
        });
      }
      sink.onStatus({
        adapterId: this.id, provider: "CMD", category: "FOOTBALL", status: "DISCONNECTED",
        detail: signal.aborted ? "stopped" : "source ended", updatedAtMs: Date.now()
      });
    } catch {
      sink.onStatus({
        adapterId: this.id, provider: "CMD", category: "FOOTBALL", status: "DEGRADED",
        detail: "catalog source unavailable", updatedAtMs: Date.now()
      });
    }
  }
}
