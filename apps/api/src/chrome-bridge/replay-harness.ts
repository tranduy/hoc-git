import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { ChromeBridgeEnvelopeSchema, type ChromeBridgeEnvelope, type ProviderQuote } from "@tool-chenh/contracts";
import type { ObservedProviderCatalog } from "../providers/cmd/cmd-observed-catalog.js";
import { ChromeCatalogDataPlane } from "./chrome-catalog-data-plane.js";
import { chromeBridgeProviderAccountIdForKey, type ChromeBridgeAccountKey } from "./chrome-bridge-account.js";
import { ProviderFeedRegistry } from "./provider-feed-registry.js";

export type ReplayProvider = ChromeBridgeAccountKey;

export interface ReplayHarnessResult {
  readonly provider: ReplayProvider;
  readonly capture: string;
  readonly envelopes: number;
  readonly baselines: number;
  readonly deltas: number;
  readonly rejected: { readonly total: number; readonly reasons: Readonly<Record<string, number>> };
  readonly semanticChanges: number;
}

const providerLobbies: Readonly<Record<ReplayProvider, ReadonlySet<ChromeBridgeEnvelope["lobby"]>>> = {
  CMD: new Set(["CMD"]), IM: new Set(["IM"]), SABA: new Set(["SABA"]),
  SBOBET: new Set(["KSPORT", "SBO"]), APSPORT: new Set(["TSPORT"]), BTI: new Set(["BTI"])
};

export async function replayCaptureWithProductionAdapters(options: {
  readonly capturePath: string;
  readonly provider: ReplayProvider;
}): Promise<ReplayHarnessResult> {
  const text = await readFile(options.capturePath, "utf8");
  const envelopes = text.split(/\r?\n/u).filter((line) => line.trim().length > 0)
    .map((line) => ChromeBridgeEnvelopeSchema.parse(JSON.parse(line)))
    .filter((envelope) => providerLobbies[options.provider].has(envelope.lobby));
  let nowMs = envelopes[0]?.observedAtMs ?? 0;
  const accountId = chromeBridgeProviderAccountIdForKey(options.provider);
  const feeds = new ProviderFeedRegistry({ now: () => nowMs });
  let baselines = 0;
  let deltas = 0;
  let semanticChanges = 0;
  const rejectedReasons: Record<string, number> = {};
  let rejectionReason: string | null = null;
  const selections = new Map<string, Pick<ProviderQuote, "rawOdds" | "status">>();
  const observeCatalog = (catalog: ObservedProviderCatalog): void => {
    const next = new Map<string, Pick<ProviderQuote, "rawOdds" | "status">>();
    for (const quote of catalog.quotes) {
      const key = [quote.provider, quote.providerEventId, quote.providerMarketId, quote.providerSelectionId].join(":");
      const value = { rawOdds: quote.rawOdds, status: quote.status };
      next.set(key, value);
      const previous = selections.get(key);
      if (previous !== undefined && (previous.rawOdds !== value.rawOdds || previous.status !== value.status)) {
        semanticChanges += 1;
      }
    }
    selections.clear();
    for (const [key, value] of next) selections.set(key, value);
  };
  const plane = new ChromeCatalogDataPlane({ now: () => nowMs, feedRegistry: feeds,
    maxEnvelopeAgeMs: 300_000, publish: observeCatalog,
    onIngestRejected: (_envelope, reason) => { rejectionReason = reason; } });
  for (const envelope of envelopes) {
    nowMs = envelope.observedAtMs;
    rejectionReason = null;
    const before = feeds.snapshot(accountId);
    const applied = plane.ingest(envelope);
    const after = feeds.snapshot(accountId);
    if (after.lastCompleteBaselineAtMs !== null &&
      after.lastCompleteBaselineAtMs !== before.lastCompleteBaselineAtMs) baselines += 1;
    if (after.lastDeltaAtMs !== null && after.lastDeltaAtMs !== before.lastDeltaAtMs) deltas += 1;
    if (!applied) {
      const reason = rejectionReason ?? "INGEST_REJECTION_REASON_MISSING";
      rejectedReasons[reason] = (rejectedReasons[reason] ?? 0) + 1;
    }
  }
  return {
    provider: options.provider, capture: basename(options.capturePath), envelopes: envelopes.length,
    baselines, deltas,
    rejected: { total: Object.values(rejectedReasons).reduce((sum, count) => sum + count, 0),
      reasons: rejectedReasons }, semanticChanges
  };
}
