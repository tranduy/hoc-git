import {
  ProviderQuoteSchema,
  type ProviderQuote
} from "@tool-chenh/contracts";

export type QuoteTransport = "WEBSOCKET" | "POLLING";
export type QuoteUpdateKind = "FULL_SNAPSHOT" | "DELTA";
export type QuoteIneligibilityReason =
  | "STALE"
  | "SUSPENDED"
  | "CLOSED"
  | "OUT_OF_ORDER"
  | "SEQUENCE_GAP"
  | "NEEDS_SNAPSHOT"
  | "SCHEMA_ERROR"
  | "CLOCK_SKEW"
  | "MISSING_TIMESTAMP"
  | "POLICY_MISSING";

export interface SourceFreshnessPolicy {
  readonly websocketTtlMs: number;
  readonly pollingTtlMs: number;
  readonly maxFutureClockSkewMs: number;
  readonly missingSourceTimestamp: "USE_RECEIVED_TIME" | "REJECT";
}

export interface QuoteUpdate {
  readonly kind: QuoteUpdateKind;
  readonly transport: QuoteTransport;
  readonly nowMs: number;
  readonly quotes: readonly unknown[];
}

export interface QuoteDiagnostic {
  readonly reason: QuoteIneligibilityReason;
  readonly marketKey: string | null;
  readonly quoteKey: string | null;
  readonly detail: string;
}

export interface ApplyResult {
  readonly accepted: boolean;
  readonly reason: QuoteIneligibilityReason | null;
  readonly marketKey: string | null;
  readonly acceptedCount: number;
  readonly diagnostics: readonly QuoteDiagnostic[];
}

export interface QuoteSnapshotEntry {
  readonly key: string;
  readonly marketKey: string;
  readonly quote: ProviderQuote;
  readonly transport: QuoteTransport;
  readonly quoteAgeMs: number;
  readonly expiresAtMs: number;
  readonly eligible: boolean;
  readonly ineligibilityReasons: readonly QuoteIneligibilityReason[];
}

export interface QuoteSnapshot {
  readonly generatedAtMs: number;
  readonly quotes: readonly QuoteSnapshotEntry[];
  readonly byKey: Readonly<Record<string, QuoteSnapshotEntry>>;
  readonly diagnostics: readonly QuoteDiagnostic[];
}

interface StoredQuote {
  readonly quote: ProviderQuote;
  readonly transport: QuoteTransport;
  readonly baseReasons: readonly QuoteIneligibilityReason[];
}

interface MarketState {
  lastSequence: number | null;
  needsSnapshot: boolean;
  schemaError: boolean;
  quoteKeys: Set<string>;
}

const compareText = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;

function compositeKey(parts: readonly string[]): string {
  return parts.map((part) => encodeURIComponent(part)).join("|");
}

export function quoteMarketKey(
  quote: Pick<ProviderQuote, "provider" | "providerEventId" | "providerMarketId">
): string {
  return compositeKey([quote.provider, quote.providerEventId, quote.providerMarketId]);
}

export function quoteKey(
  quote: Pick<
    ProviderQuote,
    "provider" | "providerEventId" | "providerMarketId" | "providerSelectionId"
  >
): string {
  return compositeKey([
    quote.provider,
    quote.providerEventId,
    quote.providerMarketId,
    quote.providerSelectionId
  ]);
}

function validPolicy(policy: SourceFreshnessPolicy | undefined): policy is SourceFreshnessPolicy {
  return policy !== undefined &&
    Number.isFinite(policy.websocketTtlMs) &&
    policy.websocketTtlMs > 0 &&
    Number.isFinite(policy.pollingTtlMs) &&
    policy.pollingTtlMs > 0 &&
    Number.isFinite(policy.maxFutureClockSkewMs) &&
    policy.maxFutureClockSkewMs >= 0 &&
    (policy.missingSourceTimestamp === "USE_RECEIVED_TIME" ||
      policy.missingSourceTimestamp === "REJECT");
}

function validQuoteShape(quote: ProviderQuote): boolean {
  return [
    quote.provider,
    quote.providerEventId,
    quote.providerMarketId,
    quote.providerSelectionId,
    quote.selection
  ].every((value) => value.trim().length > 0) &&
    Number.isFinite(quote.receivedMonotonicMs) &&
    (quote.sourceTimestampMs === null || Number.isFinite(quote.sourceTimestampMs)) &&
    (quote.sequence === null || (Number.isSafeInteger(quote.sequence) && quote.sequence >= 0));
}

function diagnostic(
  reason: QuoteIneligibilityReason,
  marketKey: string | null,
  key: string | null,
  detail: string
): QuoteDiagnostic {
  return { reason, marketKey, quoteKey: key, detail };
}

function untrustedMarketKey(value: unknown): string | null {
  if (typeof value !== "object" || value === null) return null;
  const item = value as Record<string, unknown>;
  if (
    typeof item.provider !== "string" || item.provider.trim() === "" ||
    typeof item.providerEventId !== "string" || item.providerEventId.trim() === "" ||
    typeof item.providerMarketId !== "string" || item.providerMarketId.trim() === ""
  ) {
    return null;
  }
  return compositeKey([item.provider, item.providerEventId, item.providerMarketId]);
}

export class QuoteBook {
  readonly #policies: Readonly<Record<string, SourceFreshnessPolicy>>;
  readonly #quotes = new Map<string, StoredQuote>();
  readonly #markets = new Map<string, MarketState>();
  readonly #diagnostics: QuoteDiagnostic[] = [];

  constructor(policies: Readonly<Record<string, SourceFreshnessPolicy>>) {
    this.#policies = policies;
  }

  apply(update: QuoteUpdate): ApplyResult {
    if (
      (update.kind !== "DELTA" && update.kind !== "FULL_SNAPSHOT") ||
      (update.transport !== "WEBSOCKET" && update.transport !== "POLLING") ||
      !Number.isFinite(update.nowMs) ||
      !Array.isArray(update.quotes) ||
      update.quotes.length === 0
    ) {
      return this.#reject("SCHEMA_ERROR", null, null, "invalid quote update envelope");
    }

    const parsed: ProviderQuote[] = [];
    const implicatedMarketKeys = new Set<string>();
    let hasSchemaError = false;
    for (const rawQuote of update.quotes) {
      const untrustedKey = untrustedMarketKey(rawQuote);
      if (untrustedKey !== null) implicatedMarketKeys.add(untrustedKey);
      const result = ProviderQuoteSchema.safeParse(rawQuote);
      if (!result.success || !validQuoteShape(result.data)) {
        hasSchemaError = true;
        continue;
      }
      parsed.push(result.data);
      implicatedMarketKeys.add(quoteMarketKey(result.data));
    }
    if (hasSchemaError) {
      const marketKeys = [...implicatedMarketKeys].sort(compareText);
      for (const marketKey of marketKeys) this.#quarantineSchemaError(marketKey);
      return this.#reject(
        "SCHEMA_ERROR",
        marketKeys[0] ?? null,
        null,
        "quote failed strict schema validation"
      );
    }

    const first = parsed[0]!;
    const marketKey = quoteMarketKey(first);
    const sequence = first.sequence;
    if (
      parsed.some(
        (item) => quoteMarketKey(item) !== marketKey || item.sequence !== sequence
      ) ||
      new Set(parsed.map(quoteKey)).size !== parsed.length
    ) {
      for (const item of parsed) this.#quarantineSchemaError(quoteMarketKey(item));
      return this.#reject(
        "SCHEMA_ERROR",
        marketKey,
        null,
        "a quote update must contain one market, one sequence, and unique selections"
      );
    }

    const policy = this.#policies[first.provider];
    if (!validPolicy(policy)) {
      return this.#reject("POLICY_MISSING", marketKey, null, "source freshness policy missing or invalid");
    }

    const market = this.#markets.get(marketKey) ?? {
      lastSequence: null,
      needsSnapshot: false,
      schemaError: false,
      quoteKeys: new Set<string>()
    };

    if (
      sequence !== null &&
      market.lastSequence !== null &&
      sequence <= market.lastSequence
    ) {
      return this.#reject("OUT_OF_ORDER", marketKey, null, "sequence did not increase");
    }

    if ((market.needsSnapshot || market.schemaError) && update.kind !== "FULL_SNAPSHOT") {
      return this.#reject(
        "NEEDS_SNAPSHOT",
        marketKey,
        null,
        "market is quarantined until a validated full snapshot"
      );
    }

    if (
      update.kind === "DELTA" &&
      sequence !== null &&
      market.lastSequence !== null &&
      sequence !== market.lastSequence + 1
    ) {
      market.needsSnapshot = true;
      this.#markets.set(marketKey, market);
      return this.#reject("SEQUENCE_GAP", marketKey, null, "delta sequence skipped one or more values");
    }

    const stored = parsed.map((item): [string, StoredQuote] => {
      const reasons: QuoteIneligibilityReason[] = [];
      if (item.status === "SUSPENDED") reasons.push("SUSPENDED");
      if (item.status === "CLOSED") reasons.push("CLOSED");
      if (item.sourceTimestampMs === null && policy.missingSourceTimestamp === "REJECT") {
        reasons.push("MISSING_TIMESTAMP");
      }
      if (
        item.sourceTimestampMs !== null &&
        item.sourceTimestampMs > update.nowMs + policy.maxFutureClockSkewMs
      ) {
        reasons.push("CLOCK_SKEW");
      }
      if (item.receivedMonotonicMs > update.nowMs + policy.maxFutureClockSkewMs) {
        reasons.push("CLOCK_SKEW");
      }
      return [quoteKey(item), { quote: item, transport: update.transport, baseReasons: [...new Set(reasons)] }];
    });

    if (update.kind === "FULL_SNAPSHOT") {
      for (const oldKey of market.quoteKeys) this.#quotes.delete(oldKey);
      market.quoteKeys.clear();
      market.needsSnapshot = false;
      market.schemaError = false;
    }
    for (const [key, value] of stored) {
      this.#quotes.set(key, value);
      market.quoteKeys.add(key);
    }
    if (sequence !== null) market.lastSequence = sequence;
    this.#markets.set(marketKey, market);

    const firstReason = stored
      .flatMap(([, value]) => value.baseReasons)
      .sort(compareText)[0] ?? null;
    return {
      accepted: true,
      reason: firstReason,
      marketKey,
      acceptedCount: stored.length,
      diagnostics: firstReason === null
        ? []
        : stored.flatMap(([key, value]) =>
          value.baseReasons.map((reason) => diagnostic(reason, marketKey, key, "quote is ineligible"))
        )
    };
  }

  snapshot(nowMs: number): QuoteSnapshot {
    if (!Number.isFinite(nowMs)) throw new Error("nowMs must be finite");

    const quotes = [...this.#quotes.entries()]
      .sort(([left], [right]) => compareText(left, right))
      .map(([key, stored]): QuoteSnapshotEntry => {
        const policy = this.#policies[stored.quote.provider]!;
        const ttlMs = stored.transport === "WEBSOCKET"
          ? policy.websocketTtlMs
          : policy.pollingTtlMs;
        const receivedAgeMs = Math.max(0, nowMs - stored.quote.receivedMonotonicMs);
        const sourceAgeMs = stored.quote.sourceTimestampMs === null
          ? 0
          : Math.max(0, nowMs - stored.quote.sourceTimestampMs);
        const quoteAgeMs = Math.max(receivedAgeMs, sourceAgeMs);
        const expiresAtMs = Math.min(
          stored.quote.receivedMonotonicMs + ttlMs,
          stored.quote.sourceTimestampMs === null
            ? Number.POSITIVE_INFINITY
            : stored.quote.sourceTimestampMs + ttlMs
        );
        const marketKey = quoteMarketKey(stored.quote);
        const market = this.#markets.get(marketKey)!;
        const reasons = [...stored.baseReasons];
        if (market.needsSnapshot) reasons.push("NEEDS_SNAPSHOT");
        if (market.schemaError) reasons.push("SCHEMA_ERROR");
        if (quoteAgeMs >= ttlMs) reasons.push("STALE");
        const ineligibilityReasons = [...new Set(reasons)].sort(compareText);
        return {
          key,
          marketKey,
          quote: stored.quote,
          transport: stored.transport,
          quoteAgeMs,
          expiresAtMs,
          eligible: ineligibilityReasons.length === 0,
          ineligibilityReasons
        };
      });
    const byKey = Object.fromEntries(quotes.map((item) => [item.key, item]));
    return {
      generatedAtMs: nowMs,
      quotes,
      byKey,
      diagnostics: [...this.#diagnostics]
    };
  }

  #reject(
    reason: QuoteIneligibilityReason,
    marketKey: string | null,
    key: string | null,
    detail: string
  ): ApplyResult {
    const item = diagnostic(reason, marketKey, key, detail);
    this.#diagnostics.push(item);
    return {
      accepted: false,
      reason,
      marketKey,
      acceptedCount: 0,
      diagnostics: [item]
    };
  }

  #quarantineSchemaError(marketKey: string | null): void {
    if (marketKey === null) return;
    const market = this.#markets.get(marketKey) ?? {
      lastSequence: null,
      needsSnapshot: false,
      schemaError: true,
      quoteKeys: new Set<string>()
    };
    market.schemaError = true;
    this.#markets.set(marketKey, market);
  }
}
