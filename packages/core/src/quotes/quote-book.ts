import {
  ProviderQuoteSchema,
  type Category,
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
  readonly source: QuoteUpdateSource;
  readonly kind: QuoteUpdateKind;
  readonly transport: QuoteTransport;
  readonly clock: QuoteClockContext;
  readonly quotes: readonly unknown[];
}

export interface QuoteClockContext {
  readonly monotonicNowMs: number;
  readonly wallClockNowMs: number;
}

export interface QuoteUpdateSource {
  readonly provider: string;
  readonly category: Category;
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
  readonly expiresAtMonotonicMs: number;
  readonly eligible: boolean;
  readonly ineligibilityReasons: readonly QuoteIneligibilityReason[];
}

export interface QuoteSnapshot {
  readonly monotonicGeneratedAtMs: number;
  readonly wallClockGeneratedAtMs: number;
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
  readonly source: QuoteUpdateSource;
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

function validSource(value: unknown): value is QuoteUpdateSource {
  if (typeof value !== "object" || value === null) return false;
  const source = value as Record<string, unknown>;
  return typeof source.provider === "string" && source.provider.trim() !== "" &&
    (source.category === "FOOTBALL" || source.category === "LOL");
}

function validClock(value: unknown): value is QuoteClockContext {
  if (typeof value !== "object" || value === null) return false;
  const clock = value as Record<string, unknown>;
  return typeof clock.monotonicNowMs === "number" &&
    Number.isFinite(clock.monotonicNowMs) && clock.monotonicNowMs >= 0 &&
    typeof clock.wallClockNowMs === "number" &&
    Number.isFinite(clock.wallClockNowMs) && clock.wallClockNowMs >= 0;
}

function sourceKey(source: QuoteUpdateSource): string {
  return compositeKey([source.provider, source.category]);
}

function untrustedSourceConflicts(value: unknown, source: QuoteUpdateSource): boolean {
  if (typeof value !== "object" || value === null) return false;
  const item = value as Record<string, unknown>;
  return (typeof item.provider === "string" && item.provider !== source.provider) ||
    (typeof item.category === "string" && item.category !== source.category);
}

export class QuoteBook {
  readonly #policies: Readonly<Record<string, SourceFreshnessPolicy>>;
  readonly #quotes = new Map<string, StoredQuote>();
  readonly #markets = new Map<string, MarketState>();
  readonly #diagnostics: QuoteDiagnostic[] = [];
  readonly #quarantinedSources = new Set<string>();
  #globallyQuarantined = false;

  constructor(policies: Readonly<Record<string, SourceFreshnessPolicy>>) {
    this.#policies = policies;
  }

  apply(update: QuoteUpdate): ApplyResult {
    if (typeof update !== "object" || update === null || !validSource(update.source)) {
      this.#quarantineGlobally();
      return this.#reject("SCHEMA_ERROR", null, null, "quote update source envelope is invalid");
    }
    const trustedSource = update.source;
    if (
      (update.kind !== "DELTA" && update.kind !== "FULL_SNAPSHOT") ||
      (update.transport !== "WEBSOCKET" && update.transport !== "POLLING") ||
      !validClock(update.clock) ||
      !Array.isArray(update.quotes) ||
      update.quotes.length === 0
    ) {
      this.#quarantineSource(trustedSource);
      return this.#reject("SCHEMA_ERROR", null, null, "invalid quote update envelope");
    }

    const parsed: ProviderQuote[] = [];
    const implicatedMarketKeys = new Set<string>();
    let hasSchemaError = false;
    let hasUnscopedSchemaError = false;
    let hasSourceMismatch = false;
    for (const rawQuote of update.quotes) {
      const sourceMismatch = untrustedSourceConflicts(rawQuote, trustedSource);
      if (sourceMismatch) hasSourceMismatch = true;
      const untrustedKey = untrustedMarketKey(rawQuote);
      if (untrustedKey !== null && !sourceMismatch) implicatedMarketKeys.add(untrustedKey);
      const result = ProviderQuoteSchema.safeParse(rawQuote);
      if (!result.success || !validQuoteShape(result.data)) {
        hasSchemaError = true;
        if (untrustedKey === null) hasUnscopedSchemaError = true;
        continue;
      }
      parsed.push(result.data);
      if (
        result.data.provider !== trustedSource.provider ||
        result.data.category !== trustedSource.category
      ) {
        hasSchemaError = true;
        hasSourceMismatch = true;
      } else {
        implicatedMarketKeys.add(quoteMarketKey(result.data));
      }
    }
    if (hasSchemaError) {
      const marketKeys = [...implicatedMarketKeys].sort(compareText);
      for (const marketKey of marketKeys) this.#quarantineSchemaError(marketKey, trustedSource);
      if (hasUnscopedSchemaError || hasSourceMismatch) this.#quarantineSource(trustedSource);
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
      for (const item of parsed) {
        this.#quarantineSchemaError(quoteMarketKey(item), trustedSource);
      }
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

    const existingMarket = this.#markets.get(marketKey);
    if (
      existingMarket !== undefined &&
      (existingMarket.source.provider !== trustedSource.provider ||
        existingMarket.source.category !== trustedSource.category)
    ) {
      this.#quarantineSource(trustedSource);
      return this.#reject(
        "SCHEMA_ERROR",
        marketKey,
        null,
        "market identity conflicts with the trusted source envelope"
      );
    }
    const market = existingMarket ?? {
      source: trustedSource,
      lastSequence: null,
      needsSnapshot: false,
      schemaError: false,
      quoteKeys: new Set<string>()
    };

    if (update.kind === "DELTA" && sequence === null) {
      market.needsSnapshot = true;
      this.#markets.set(marketKey, market);
      return this.#reject(
        "NEEDS_SNAPSHOT",
        marketKey,
        null,
        "delta updates require a non-null sequence"
      );
    }

    if (
      update.kind === "DELTA" &&
      sequence !== null &&
      market.lastSequence !== null &&
      sequence <= market.lastSequence
    ) {
      return this.#reject("OUT_OF_ORDER", marketKey, null, "sequence did not increase");
    }

    const umbrellaQuarantined = this.#globallyQuarantined ||
      this.#quarantinedSources.has(sourceKey(trustedSource));
    const hasRecoveredSnapshot = market.quoteKeys.size > 0 &&
      !market.needsSnapshot &&
      !market.schemaError;
    if (
      (market.needsSnapshot || market.schemaError ||
        (umbrellaQuarantined && !hasRecoveredSnapshot)) &&
      update.kind !== "FULL_SNAPSHOT"
    ) {
      market.needsSnapshot = true;
      this.#markets.set(marketKey, market);
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
        item.sourceTimestampMs > update.clock.wallClockNowMs + policy.maxFutureClockSkewMs
      ) {
        reasons.push("CLOCK_SKEW");
      }
      if (
        item.receivedMonotonicMs >
        update.clock.monotonicNowMs + policy.maxFutureClockSkewMs
      ) {
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
    else if (update.kind === "FULL_SNAPSHOT") market.lastSequence = null;
    this.#markets.set(marketKey, market);
    if (update.kind === "FULL_SNAPSHOT") this.#refreshQuarantines(trustedSource);

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

  snapshot(clock: QuoteClockContext): QuoteSnapshot {
    if (!validClock(clock)) throw new Error("quote clock context must be finite and non-negative");

    const quotes = [...this.#quotes.entries()]
      .sort(([left], [right]) => compareText(left, right))
      .map(([key, stored]): QuoteSnapshotEntry => {
        const policy = this.#policies[stored.quote.provider]!;
        const ttlMs = stored.transport === "WEBSOCKET"
          ? policy.websocketTtlMs
          : policy.pollingTtlMs;
        const receivedAgeMs = Math.max(
          0,
          clock.monotonicNowMs - stored.quote.receivedMonotonicMs
        );
        const sourceAgeMs = stored.quote.sourceTimestampMs === null
          ? 0
          : Math.max(0, clock.wallClockNowMs - stored.quote.sourceTimestampMs);
        const quoteAgeMs = Math.max(receivedAgeMs, sourceAgeMs);
        const remainingTtlMs = Math.min(
          ttlMs - receivedAgeMs,
          stored.quote.sourceTimestampMs === null
            ? Number.POSITIVE_INFINITY
            : ttlMs - sourceAgeMs
        );
        const expiresAtMonotonicMs = clock.monotonicNowMs + remainingTtlMs;
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
          expiresAtMonotonicMs,
          eligible: ineligibilityReasons.length === 0,
          ineligibilityReasons
        };
      });
    const byKey = Object.fromEntries(quotes.map((item) => [item.key, item]));
    return {
      monotonicGeneratedAtMs: clock.monotonicNowMs,
      wallClockGeneratedAtMs: clock.wallClockNowMs,
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

  #quarantineSchemaError(
    marketKey: string | null,
    source: QuoteUpdateSource
  ): void {
    if (marketKey === null) return;
    const existing = this.#markets.get(marketKey);
    if (
      existing !== undefined &&
      (existing.source.provider !== source.provider ||
        existing.source.category !== source.category)
    ) {
      return;
    }
    const market = existing ?? {
      source,
      lastSequence: null,
      needsSnapshot: false,
      schemaError: true,
      quoteKeys: new Set<string>()
    };
    market.schemaError = true;
    this.#markets.set(marketKey, market);
  }

  #quarantineSource(source: QuoteUpdateSource): void {
    this.#quarantinedSources.add(sourceKey(source));
    for (const market of this.#markets.values()) {
      if (
        market.source.provider === source.provider &&
        market.source.category === source.category
      ) {
        market.schemaError = true;
      }
    }
  }

  #quarantineGlobally(): void {
    this.#globallyQuarantined = true;
    for (const market of this.#markets.values()) market.schemaError = true;
  }

  #refreshQuarantines(source: QuoteUpdateSource): void {
    const sourceStillQuarantined = [...this.#markets.values()].some(
      (market) => market.schemaError &&
        market.source.provider === source.provider &&
        market.source.category === source.category
    );
    if (!sourceStillQuarantined) this.#quarantinedSources.delete(sourceKey(source));
    if (![...this.#markets.values()].some((market) => market.schemaError)) {
      this.#globallyQuarantined = false;
    }
  }
}
