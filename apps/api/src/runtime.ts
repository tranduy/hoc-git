import type {
  AdapterSchemaError,
  ProviderAdapter,
  ProviderQuoteUpdate,
  ProviderSink
} from "@tool-chenh/adapters";
import type {
  AppSnapshot,
  BlockedDiagnostic,
  CanonicalEvent,
  CanonicalMarket,
  Category,
  MappingStatus,
  Opportunity,
  ProviderConnectionStatus,
  ProviderEvent,
  ProviderMarket,
  ProviderQuote
} from "@tool-chenh/contracts";
import {
  OpportunityEngine,
  QuoteBook,
  Decimal,
  effectiveDecimal,
  mapEvents,
  mapMarkets,
  normalizeName,
  quoteKey,
  resolveAliasForCategory,
  toDecimal,
  type FeeModel,
  type FinancialFxPolicy,
  type MappingPolicy,
  type MarketMappingResult,
  type NormalizedEvent,
  type NormalizedMarket,
  type OpportunityCandidate,
  type QuoteClockContext,
  type QuoteSnapshot,
  type SourceFreshnessPolicy,
  type StakeConstraint
} from "@tool-chenh/core";

export interface RuntimeClock {
  now(): QuoteClockContext;
}

export interface ProviderOpportunityPolicy {
  readonly fee: FeeModel;
  readonly constraint: StakeConstraint;
  readonly fx: FinancialFxPolicy;
}

export interface RuntimeOpportunityPolicy {
  readonly baseCurrency: string;
  readonly bankroll: string;
  readonly minimumNetMargin: string;
  readonly minimumWorstCaseProfit: string;
  readonly minimumRoi: string;
  readonly minimumRemainingTtlMs: number;
  readonly providers: Readonly<Record<string, ProviderOpportunityPolicy>>;
}

export interface RuntimeOptions {
  readonly adapters: readonly ProviderAdapter[];
  readonly clock?: RuntimeClock;
  readonly mappingPolicy?: MappingPolicy;
  readonly freshnessPolicies?: Readonly<Record<string, SourceFreshnessPolicy>>;
  readonly opportunityPolicy?: RuntimeOpportunityPolicy;
}

export interface RuntimeDiagnostic {
  readonly timestampMs: number;
  readonly code: string;
  readonly adapterId: string | null;
  readonly provider: string | null;
  readonly category: Category | null;
  readonly canonicalMarketId: string | null;
  readonly reason: string;
}

export type SnapshotListener = (snapshot: AppSnapshot) => void;

interface EventCandidate {
  readonly key: string;
  readonly left: NormalizedEvent;
  readonly right: NormalizedEvent;
  readonly result: ReturnType<typeof mapEvents>;
  readonly canonical: CanonicalEvent;
}

interface MarketCandidate {
  readonly key: string;
  readonly event: EventCandidate;
  readonly left: ProviderMarket;
  readonly right: ProviderMarket;
  readonly result: MarketMappingResult;
  readonly canonical: CanonicalMarket;
}

const compareText = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;

const defaultClock: RuntimeClock = {
  now: () => ({ monotonicNowMs: performance.now(), wallClockNowMs: Date.now() })
};

const defaultMappingPolicy: MappingPolicy = {
  prematchToleranceMs: 120_000,
  liveClockToleranceMs: 20_000,
  aliasRegistry: {
    version: "runtime-default-v1",
    aliases: { FOOTBALL: {}, LOL: {} }
  }
};

const defaultFreshnessPolicy: SourceFreshnessPolicy = {
  websocketTtlMs: 1_000,
  pollingTtlMs: 1_000,
  maxFutureClockSkewMs: 100,
  missingSourceTimestamp: "USE_RECEIVED_TIME"
};

const defaultOpportunityPolicy: Omit<RuntimeOpportunityPolicy, "providers"> = {
  baseCurrency: "",
  bankroll: "1000",
  minimumNetMargin: "0",
  minimumWorstCaseProfit: "0",
  minimumRoi: "0",
  minimumRemainingTtlMs: 0
};

function composite(parts: readonly string[]): string {
  return parts.map(encodeURIComponent).join("|");
}

function providerEventKey(
  value: Pick<ProviderEvent, "provider" | "category" | "providerEventId">
): string {
  return composite([value.provider, value.category, value.providerEventId]);
}

function providerMarketKey(
  value: Pick<ProviderMarket, "provider" | "category" | "providerEventId" | "providerMarketId">
): string {
  return composite([value.provider, value.category, value.providerEventId, value.providerMarketId]);
}

function requiredOutcomeDomain(
  marketType: ProviderMarket["marketType"],
  event: NormalizedEvent
): readonly string[] | null {
  if (marketType === "FT_1X2" || marketType === "FH_1X2") {
    return ["HOME", "DRAW", "AWAY"];
  }
  if (
    marketType === "FT_TOTAL" ||
    marketType === "FH_TOTAL" ||
    marketType === "MAP_TOTAL_KILLS" ||
    marketType === "MAP_DURATION"
  ) {
    return ["OVER", "UNDER"];
  }
  if (marketType === "OBSERVE_ONLY") return null;
  if (
    event.canonicalParticipantA === null ||
    event.canonicalParticipantB === null ||
    event.canonicalParticipantA === event.canonicalParticipantB
  ) {
    return null;
  }
  return [event.canonicalParticipantA, event.canonicalParticipantB];
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

function safeCloneFreeze<T>(value: T): T {
  return deepFreeze(structuredClone(value));
}

function normalizedEvent(event: ProviderEvent, policy: MappingPolicy): NormalizedEvent {
  const participantA = resolveAliasForCategory(event.participantA, event.category, policy.aliasRegistry).canonical;
  const participantB = resolveAliasForCategory(event.participantB, event.category, policy.aliasRegistry).canonical;
  const common = {
    provider: event.provider,
    providerEventId: event.providerEventId,
    competition: normalizeName(event.competition),
    seasonStage: event.seasonStage === null ? null : normalizeName(event.seasonStage),
    startAtUtcMs: event.startAtUtcMs,
    participantA: event.participantA,
    participantB: event.participantB,
    canonicalParticipantA: participantA,
    canonicalParticipantB: participantB,
    isLive: event.isLive,
    rematchCandidate: event.rematchCandidate,
    fixtureDiscriminator: event.fixtureDiscriminator
  } as const;

  return event.category === "FOOTBALL"
    ? {
        ...common,
        category: "FOOTBALL",
        eventScope: event.eventScope === "REGULATION" ? "REGULAR_TIME" : null,
        bestOf: null,
        liveState: event.liveState,
        isVirtual: event.isVirtual,
        sportVariant: event.sportVariant
      }
    : {
        ...common,
        category: "LOL",
        eventScope: event.eventScope === "SERIES" ? "SERIES" : null,
        bestOf: event.bestOf,
        liveState: event.liveState,
        gameVariant: event.gameVariant
      };
}

function candidateEventId(left: NormalizedEvent, right: NormalizedEvent): string {
  return `candidate-event|${composite([
    left.category,
    left.provider,
    left.providerEventId,
    right.provider,
    right.providerEventId
  ])}`;
}

function canonicalEvent(candidate: Omit<EventCandidate, "canonical">): CanonicalEvent {
  const { left, right, result } = candidate;
  return {
    canonicalEventId: result.canonicalEventId ?? candidateEventId(left, right),
    category: left.category,
    competition: left.competition,
    seasonStage: left.seasonStage,
    startAtUtcMs: Math.min(left.startAtUtcMs ?? 0, right.startAtUtcMs ?? 0),
    participantA: left.canonicalParticipantA ?? normalizeName(left.participantA),
    participantB: left.canonicalParticipantB ?? normalizeName(left.participantB),
    providerEventIds: [left.providerEventId, right.providerEventId],
    isLive: left.isLive === right.isLive ? left.isLive : null,
    mappingStatus: result.status,
    mappingEvidence: result.evidence
  };
}

function canonicalOutcome(quote: ProviderQuote, event: NormalizedEvent): string | null {
  if (["OVER", "UNDER", "DRAW"].includes(quote.selection)) {
    return quote.selection;
  }
  if (quote.selection === "HOME") {
    return quote.marketType === "FT_1X2" || quote.marketType === "FH_1X2"
      ? "HOME" : event.canonicalParticipantA;
  }
  if (quote.selection === "AWAY") {
    return quote.marketType === "FT_1X2" || quote.marketType === "FH_1X2"
      ? "AWAY" : event.canonicalParticipantB;
  }
  if (quote.selection === "TEAM_A") return event.canonicalParticipantA;
  if (quote.selection === "TEAM_B") return event.canonicalParticipantB;
  return null;
}

export class Runtime {
  readonly #adapters: readonly ProviderAdapter[];
  readonly #clock: RuntimeClock;
  readonly #mappingPolicy: MappingPolicy;
  readonly #freshnessPolicies: Readonly<Record<string, SourceFreshnessPolicy>>;
  readonly #opportunityPolicy: RuntimeOpportunityPolicy;
  readonly #events = new Map<string, ProviderEvent>();
  readonly #eventsByAdapter = new Map<string, Map<string, ProviderEvent>>();
  readonly #activeEventAdapters = new Map<string, string>();
  readonly #markets = new Map<string, ProviderMarket>();
  readonly #marketsByAdapter = new Map<string, Map<string, ProviderMarket>>();
  readonly #quotesByAdapter = new Map<string, Map<string, ProviderQuote>>();
  readonly #activeMarketAdapters = new Map<string, string>();
  readonly #providerStatuses = new Map<string, ProviderConnectionStatus>();
  readonly #listeners = new Set<SnapshotListener>();
  readonly #diagnostics: RuntimeDiagnostic[] = [];
  readonly #quarantinedAdapters = new Set<string>();
  readonly #controllers = new Map<string, AbortController>();
  readonly #quoteBooks = new Map<string, QuoteBook>();
  readonly #opportunityEngine = new OpportunityEngine();
  readonly #opportunitiesByMarket = new Map<string, Opportunity>();
  readonly #blockedByMarket = new Map<string, BlockedDiagnostic>();
  readonly #runtimeBlockedBySource = new Map<string, BlockedDiagnostic>();
  #eventCandidates: readonly EventCandidate[] = [];
  #marketCandidates: readonly MarketCandidate[] = [];
  #lastEvaluationClock: QuoteClockContext | null = null;
  #snapshot: AppSnapshot;
  #revision = 0;
  #started = false;

  constructor(options: RuntimeOptions) {
    this.#adapters = [...options.adapters];
    this.#clock = options.clock ?? defaultClock;
    this.#mappingPolicy = options.mappingPolicy ?? defaultMappingPolicy;
    const providers = new Set([
      "SABA",
      "IM",
      ...this.#adapters.map((adapter) => adapter.id.split("-")[0]!.toUpperCase())
    ]);
    this.#freshnessPolicies = options.freshnessPolicies ?? Object.fromEntries(
      [...providers].map((provider) => [provider, defaultFreshnessPolicy])
    );
    this.#opportunityPolicy = options.opportunityPolicy ?? {
      ...defaultOpportunityPolicy,
      providers: {}
    };
    this.#snapshot = safeCloneFreeze(this.#emptySnapshot());
  }

  async start(signal: AbortSignal): Promise<void> {
    if (this.#started) throw new Error("Runtime has already been started");
    this.#started = true;
    const stop = (): void => {
      for (const controller of this.#controllers.values()) controller.abort();
    };
    signal.addEventListener("abort", stop, { once: true });
    if (signal.aborted) stop();

    const runs = this.#adapters.map(async (adapter) => {
      const controller = new AbortController();
      this.#controllers.set(adapter.id, controller);
      if (signal.aborted) controller.abort();
      try {
        await adapter.start(this.#sink(adapter.id), controller.signal);
      } catch {
        if (signal.aborted || controller.signal.aborted) return;
        this.#recordDiagnostic({
          code: "ADAPTER_FAILURE",
          adapterId: adapter.id,
          provider: null,
          category: adapter.categories.length === 1 ? adapter.categories[0]! : null,
          canonicalMarketId: null,
          reason: "adapter stopped after an internal failure"
        });
        this.#publish();
      }
    });
    try {
      await Promise.all(runs);
    } finally {
      signal.removeEventListener("abort", stop);
      this.#controllers.clear();
    }
  }

  getSnapshot(): AppSnapshot {
    this.#refreshForClock();
    return this.#snapshot;
  }

  subscribe(listener: SnapshotListener): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  getDiagnostics(): readonly RuntimeDiagnostic[] {
    return safeCloneFreeze(this.#diagnostics);
  }

  #sink(adapterId: string): ProviderSink {
    return {
      onEvent: (event) => this.#onEvent(adapterId, event),
      onMarket: (market) => this.#onMarket(adapterId, market),
      onQuoteUpdate: (update) => this.#onQuoteUpdate(adapterId, update),
      onStatus: (status) => this.#onStatus(adapterId, status),
      onSchemaError: (error) => this.#onSchemaError(error, adapterId)
    };
  }

  #onEvent(adapterId: string, event: ProviderEvent): void {
    if (this.#isQuarantined(adapterId, event.category)) return;
    const adapterEvents = this.#eventsByAdapter.get(adapterId) ?? new Map<string, ProviderEvent>();
    adapterEvents.set(providerEventKey(event), event);
    this.#eventsByAdapter.set(adapterId, adapterEvents);
    this.#reconcileEvent(event, adapterId);
    this.#publish();
  }

  #onMarket(adapterId: string, market: ProviderMarket): void {
    if (this.#isQuarantined(adapterId, market.category)) return;
    const key = providerMarketKey(market);
    const adapterMarkets = this.#marketsByAdapter.get(adapterId) ?? new Map<string, ProviderMarket>();
    adapterMarkets.set(key, market);
    this.#marketsByAdapter.set(adapterId, adapterMarkets);
    this.#reconcileEvent(market, adapterId, key);
    this.#publish();
  }

  #onQuoteUpdate(adapterId: string, update: ProviderQuoteUpdate): void {
    if (this.#isQuarantined(adapterId, update.source.category)) return;
    const quoteBook = this.#quoteBooks.get(adapterId) ?? new QuoteBook(this.#freshnessPolicies);
    this.#quoteBooks.set(adapterId, quoteBook);
    const result = quoteBook.apply(update);
    if (!result.accepted) {
      this.#recordDiagnostic({
        code: result.reason ?? "QUOTE_REJECTED",
        adapterId,
        provider: update.source.provider,
        category: update.source.category,
        canonicalMarketId: null,
        reason: "quote update was rejected"
      });
      this.#evaluateMarkets();
      this.#publish();
      return;
    }
    const first = update.quotes[0]!;
    const marketKey = providerMarketKey(first);
    const adapterQuotes = this.#quotesByAdapter.get(adapterId) ?? new Map<string, ProviderQuote>();
    if (update.kind === "FULL_SNAPSHOT") {
      for (const [key, quote] of adapterQuotes) {
        if (providerMarketKey(quote) === marketKey) adapterQuotes.delete(key);
      }
    }
    for (const quote of update.quotes) {
      const key = quoteKey(quote);
      adapterQuotes.set(key, quote);
    }
    this.#quotesByAdapter.set(adapterId, adapterQuotes);
    this.#reconcileEvent(first, adapterId, marketKey);
    this.#publish();
  }

  #onStatus(adapterId: string, status: ProviderConnectionStatus): void {
    if (this.#isQuarantined(adapterId, status.category)) return;
    this.#providerStatuses.set(composite([adapterId, status.category]), {
      ...status,
      adapterId,
      detail: status.detail === null ? null : "provider status update"
    });
    this.#publish();
  }

  #onSchemaError(error: AdapterSchemaError, adapterId: string): void {
    const clock = this.#clock.now();
    this.#quarantinedAdapters.add(composite([adapterId, error.category]));
    this.#providerStatuses.set(composite([adapterId, error.category]), {
      adapterId,
      provider: error.provider,
      category: error.category,
      status: "SCHEMA_ERROR",
      detail: "adapter/category quarantined after schema validation failure",
      updatedAtMs: clock.wallClockNowMs
    });
    this.#runtimeBlockedBySource.set(composite([adapterId, error.category]), {
      code: "QUOTE_SCHEMA_ERROR",
      category: error.category,
      canonicalMarketId: null,
      reason: "adapter/category quarantined after schema validation failure",
      mappingEvidence: []
    });
    const affectedEvents = new Map<string, Pick<ProviderEvent, "provider" | "category" | "providerEventId">>();
    for (const event of this.#eventsByAdapter.get(adapterId)?.values() ?? []) {
      if (event.category === error.category) affectedEvents.set(providerEventKey(event), event);
    }
    for (const market of this.#marketsByAdapter.get(adapterId)?.values() ?? []) {
      if (market.category === error.category) affectedEvents.set(providerEventKey(market), market);
    }
    for (const quote of this.#quotesByAdapter.get(adapterId)?.values() ?? []) {
      if (quote.category === error.category) affectedEvents.set(providerEventKey(quote), quote);
    }
    for (const event of affectedEvents.values()) this.#reconcileEvent(event, adapterId);
    this.#recordDiagnostic({
      code: "SCHEMA_ERROR",
      adapterId,
      provider: error.provider,
      category: error.category,
      canonicalMarketId: null,
      reason: `${error.recordKind.toLowerCase()} record failed strict schema validation`
    });
    this.#publish();
  }

  #reconcileEvent(
    identity: Pick<ProviderEvent, "provider" | "category" | "providerEventId">,
    changedAdapterId: string,
    touchedMarketKey?: string
  ): void {
    const eventKey = providerEventKey(identity);
    const previousOwner = this.#activeEventAdapters.get(eventKey);
    const previousEvent = this.#events.get(eventKey);
    const selected = [...this.#eventsByAdapter.entries()]
      .map(([owner, events]) => {
        const event = events.get(eventKey);
        const normalizedOwnerEvent = event === undefined
          ? undefined
          : normalizedEvent(event, this.#mappingPolicy);
        const completeMarketCount = event === undefined || normalizedOwnerEvent === undefined ? 0 :
          [...(this.#marketsByAdapter.get(owner)?.values() ?? [])]
            .filter((market) => providerEventKey(market) === eventKey)
            .filter((market) => {
              const required = requiredOutcomeDomain(market.marketType, normalizedOwnerEvent);
              if (required === null || market.status !== "OPEN") return false;
              const outcomes = [...(this.#quotesByAdapter.get(owner)?.values() ?? [])]
                .filter((quote) =>
                  providerMarketKey(quote) === providerMarketKey(market) &&
                  quote.marketType === market.marketType &&
                  quote.scope === market.scope &&
                  quote.line === market.line &&
                  quote.status === "OPEN" &&
                  quote.isLive === event.isLive
                )
                .map((quote) => canonicalOutcome(quote, normalizedOwnerEvent));
              const uniqueOutcomes = new Set(outcomes);
              return outcomes.length === required.length &&
                !outcomes.includes(null) &&
                uniqueOutcomes.size === outcomes.length &&
                required.every((outcome) => uniqueOutcomes.has(outcome));
            }).length;
        return { owner, event, completeMarketCount };
      })
      .filter((candidate): candidate is {
        owner: string;
        event: ProviderEvent;
        completeMarketCount: number;
      } =>
        candidate.event !== undefined && !this.#isQuarantined(candidate.owner, identity.category))
      .sort((left, right) =>
        right.completeMarketCount - left.completeMarketCount ||
        compareText(left.owner, right.owner))[0];

    const previousMarketKeys = [...this.#activeMarketAdapters.entries()]
      .filter(([marketKey, owner]) => {
        const market = this.#marketsByAdapter.get(owner)?.get(marketKey);
        return market !== undefined && providerEventKey(market) === eventKey;
      })
      .map(([marketKey]) => marketKey);
    for (const marketKey of previousMarketKeys) {
      this.#markets.delete(marketKey);
      this.#activeMarketAdapters.delete(marketKey);
    }

    if (selected === undefined) {
      this.#events.delete(eventKey);
      this.#activeEventAdapters.delete(eventKey);
      if (previousEvent !== undefined || previousMarketKeys.length > 0) {
        this.#rebuildCategory(identity.category);
        this.#evaluateMarkets(new Set(this.#marketCandidates
          .filter((candidate) => candidate.canonical.category === identity.category)
          .map((candidate) => candidate.key)));
      }
      return;
    }

    this.#events.set(eventKey, selected.event);
    this.#activeEventAdapters.set(eventKey, selected.owner);
    const selectedMarkets = [...(this.#marketsByAdapter.get(selected.owner)?.values() ?? [])]
      .filter((market) => providerEventKey(market) === eventKey)
      .map((market) => ({
        market,
        key: providerMarketKey(market),
        quotes: [...(this.#quotesByAdapter.get(selected.owner)?.values() ?? [])]
          .filter((quote) => providerMarketKey(quote) === providerMarketKey(market))
      }));
    for (const candidate of selectedMarkets) {
      this.#markets.set(candidate.key, candidate.market);
      this.#activeMarketAdapters.set(candidate.key, selected.owner);
    }

    const eventChanged = previousEvent === undefined ||
      JSON.stringify(previousEvent) !== JSON.stringify(selected.event);
    if (previousOwner !== selected.owner || eventChanged) {
      this.#rebuildCategory(identity.category);
      this.#evaluateMarkets(new Set(this.#marketCandidates
        .filter((candidate) => candidate.canonical.category === identity.category)
        .map((candidate) => candidate.key)));
      return;
    }
    if (touchedMarketKey !== undefined) {
      const activeMarket = this.#markets.get(touchedMarketKey);
      if (activeMarket !== undefined) this.#rebuildTouchedMarket(activeMarket);
      this.#evaluateMarkets(new Set(this.#marketCandidates
        .filter((candidate) =>
          providerMarketKey(candidate.left) === touchedMarketKey ||
          providerMarketKey(candidate.right) === touchedMarketKey)
        .map((candidate) => candidate.key)));
    }
  }

  #rebuildCategory(categoryToRebuild: Category): void {
    const normalized = [...this.#events.values()]
      .filter((event) => event.category === categoryToRebuild)
      .map((event) => normalizedEvent(event, this.#mappingPolicy));
    const eventCandidates: EventCandidate[] = [];
    const sourcePairs = new Set<string>();
    for (const left of normalized) {
      for (const right of normalized) {
        if (left.category !== right.category || compareText(left.provider, right.provider) >= 0) continue;
        sourcePairs.add(composite([left.category, left.provider, right.provider]));
      }
    }
    for (const sourcePair of [...sourcePairs].sort(compareText)) {
      const [category, leftProvider, rightProvider] = sourcePair.split("|").map(decodeURIComponent) as [Category, string, string];
      const leftEvents = normalized.filter((event) => event.category === category && event.provider === leftProvider);
      const rightEvents = normalized.filter((event) => event.category === category && event.provider === rightProvider);
      const edges = leftEvents.flatMap((left) => rightEvents.map((right) => ({
        left,
        right,
        result: mapEvents(left, right, this.#mappingPolicy),
        distanceMs: Math.abs((left.startAtUtcMs ?? 0) - (right.startAtUtcMs ?? 0))
      }))).sort((first, second) => first.distanceMs - second.distanceMs ||
        compareText(first.left.providerEventId, second.left.providerEventId) ||
        compareText(first.right.providerEventId, second.right.providerEventId));
      const usedLeft = new Set<string>();
      const usedRight = new Set<string>();
      const selected: typeof edges = [];
      for (const status of ["VERIFIED", "REVIEW_REQUIRED", "REJECTED"] as const) {
        const available = edges.filter((edge) =>
          edge.result.status === status &&
          !usedLeft.has(edge.left.providerEventId) &&
          !usedRight.has(edge.right.providerEventId)
        );
        const byLeft = new Map<string, typeof available>();
        for (const edge of available) {
          byLeft.set(edge.left.providerEventId, [...(byLeft.get(edge.left.providerEventId) ?? []), edge]);
        }
        const matchedByRight = new Map<string, (typeof available)[number]>();
        const assign = (leftId: string, seenRight: Set<string>): boolean => {
          for (const edge of byLeft.get(leftId) ?? []) {
            const rightId = edge.right.providerEventId;
            if (seenRight.has(rightId)) continue;
            seenRight.add(rightId);
            const existing = matchedByRight.get(rightId);
            if (existing === undefined || assign(existing.left.providerEventId, seenRight)) {
              matchedByRight.set(rightId, edge);
              return true;
            }
          }
          return false;
        };
        for (const leftId of [...byLeft.keys()].sort(compareText)) assign(leftId, new Set());
        const matches = [...matchedByRight.values()].sort((first, second) =>
          compareText(first.left.providerEventId, second.left.providerEventId) ||
          compareText(first.right.providerEventId, second.right.providerEventId)
        );
        selected.push(...matches);
        for (const edge of matches) {
          usedLeft.add(edge.left.providerEventId);
          usedRight.add(edge.right.providerEventId);
        }
      }
      for (const { left, right, result } of selected) {
        const ordered = [left, right] as const;
        const key = composite([
          ordered[0].category,
          ordered[0].provider,
          ordered[0].providerEventId,
          ordered[1].provider,
          ordered[1].providerEventId
        ]);
        const partial = { key, left: ordered[0], right: ordered[1], result };
        eventCandidates.push({ ...partial, canonical: canonicalEvent(partial) });
      }
    }
    this.#eventCandidates = [
      ...this.#eventCandidates.filter((candidate) => candidate.canonical.category !== categoryToRebuild),
      ...eventCandidates
    ].sort((a, b) => compareText(a.key, b.key));

    this.#marketCandidates = [
      ...this.#marketCandidates.filter((candidate) => candidate.canonical.category !== categoryToRebuild),
      ...this.#buildMarketCandidates(eventCandidates)
    ].sort((a, b) => compareText(a.key, b.key));
  }

  #rebuildTouchedMarket(
    market: Pick<ProviderMarket, "provider" | "category" | "providerEventId" | "providerMarketId">
  ): void {
    const touches = (candidate: Pick<MarketCandidate, "left" | "right">): boolean =>
      (candidate.left.category === market.category &&
        candidate.left.provider === market.provider &&
        candidate.left.providerEventId === market.providerEventId &&
        candidate.left.providerMarketId === market.providerMarketId) ||
      (candidate.right.category === market.category &&
        candidate.right.provider === market.provider &&
        candidate.right.providerEventId === market.providerEventId &&
        candidate.right.providerMarketId === market.providerMarketId);
    const events = this.#eventCandidates.filter((candidate) =>
      candidate.result.status === "VERIFIED" &&
      candidate.canonical.category === market.category &&
      ((candidate.left.provider === market.provider && candidate.left.providerEventId === market.providerEventId) ||
        (candidate.right.provider === market.provider && candidate.right.providerEventId === market.providerEventId))
    );
    this.#marketCandidates = [
      ...this.#marketCandidates.filter((candidate) => !touches(candidate)),
      ...this.#buildMarketCandidates(events, touches)
    ].sort((left, right) => compareText(left.key, right.key));
  }

  #buildMarketCandidates(
    events: readonly EventCandidate[],
    include: (candidate: Pick<MarketCandidate, "left" | "right">) => boolean = () => true
  ): readonly MarketCandidate[] {
    const marketCandidates: MarketCandidate[] = [];
    for (const event of events.filter((candidate) => candidate.result.status === "VERIFIED")) {
      const leftMarkets = [...this.#markets.values()].filter((market) =>
        market.category === event.left.category &&
        market.provider === event.left.provider && market.providerEventId === event.left.providerEventId
      );
      const rightMarkets = [...this.#markets.values()].filter((market) =>
        market.category === event.right.category &&
        market.provider === event.right.provider && market.providerEventId === event.right.providerEventId
      );
      for (const left of leftMarkets) {
        for (const right of rightMarkets) {
          if (left.marketType !== right.marketType || left.scope !== right.scope) continue;
          if (!include({ left, right })) continue;
          const result = mapMarkets(
            event.result,
            this.#normalizedMarket(left, event.left),
            this.#normalizedMarket(right, event.right)
          );
          const id = result.canonicalMarketId ?? `candidate-market|${composite([
            event.key,
            left.providerMarketId,
            right.providerMarketId
          ])}`;
          const canonical: CanonicalMarket = {
            canonicalMarketId: id,
            canonicalEventId: event.canonical.canonicalEventId,
            category: left.category,
            marketType: left.marketType,
            scope: left.scope,
            line: result.normalizedLine,
            settlementProfile: left.settlementProfile,
            providerMarketIds: [left.providerMarketId, right.providerMarketId],
            mappingStatus: result.status,
            mappingEvidence: result.evidence
          };
          marketCandidates.push({ key: id, event, left, right, result, canonical });
        }
      }
    }
    return marketCandidates;
  }

  #normalizedMarket(market: ProviderMarket, event: NormalizedEvent): NormalizedMarket {
    const owner = this.#activeMarketAdapters.get(providerMarketKey(market));
    const sourceQuotes = owner !== undefined && !this.#isQuarantined(owner, market.category)
      ? [...(this.#quotesByAdapter.get(owner)?.values() ?? [])]
      : [];
    const selections = sourceQuotes
      .filter((quote) =>
        quote.category === market.category &&
        quote.provider === market.provider &&
        quote.providerEventId === market.providerEventId &&
        quote.providerMarketId === market.providerMarketId &&
        quote.isLive === event.isLive
      )
      .map((quote) => ({
        providerSelectionId: quote.providerSelectionId,
        canonicalOutcomeId: canonicalOutcome(quote, event)
      }));
    return {
      ...market,
      settlementProfile: market.settlementProfile,
      selections: selections.length === 0 ? null : selections
    };
  }

  #opportunityCandidates(
    quoteSnapshot: QuoteSnapshot,
    marketCandidates: readonly MarketCandidate[]
  ): readonly OpportunityCandidate[] {
    return marketCandidates.map((candidate): OpportunityCandidate => {
      const legs = candidate.result.selectionMappings.flatMap((mapping) => {
        const entries = quoteSnapshot.quotes.filter((entry) => {
          const source = entry.quote.provider === candidate.left.provider
            ? candidate.result.sourceMarkets.left
            : candidate.result.sourceMarkets.right;
          const selectionId = entry.quote.provider === candidate.left.provider
            ? mapping.leftProviderSelectionId
            : mapping.rightProviderSelectionId;
          return entry.quote.category === candidate.canonical.category &&
            entry.quote.provider === source.provider &&
            entry.quote.providerEventId === source.providerEventId &&
            entry.quote.providerMarketId === source.providerMarketId &&
            entry.quote.providerSelectionId === selectionId;
        });
        if (entries.length === 0) return [];
        const best = entries.reduce((winner, current) => {
          const winnerPolicy = this.#providerPolicy(winner.quote.provider);
          const currentPolicy = this.#providerPolicy(current.quote.provider);
          if (winnerPolicy === null || currentPolicy === null) return winner;
          try {
            const winnerOdds = effectiveDecimal(toDecimal(winner.quote.rawOdds, winner.quote.rawFormat), winnerPolicy.fee);
            const currentOdds = effectiveDecimal(toDecimal(current.quote.rawOdds, current.quote.rawFormat), currentPolicy.fee);
            return currentOdds.gt(winnerOdds) ? current : winner;
          } catch {
            return winner;
          }
        });
        const policy = this.#providerPolicy(best.quote.provider);
        return [{
          canonicalOutcomeId: mapping.canonicalOutcomeId,
          quoteKey: best.key,
          fee: policy?.fee ?? null,
          constraint: policy?.constraint ?? null,
          fx: policy?.fx ?? null
        }];
      });
      return {
        market: candidate.canonical,
        mapping: candidate.result,
        eventIsLive: candidate.event.canonical.isLive,
        legs
      };
    });
  }

  #providerPolicy(provider: string): ProviderOpportunityPolicy | null {
    return this.#opportunityPolicy.providers[provider] ?? null;
  }

  #refreshForClock(): void {
    const clock = this.#clock.now();
    if (
      this.#lastEvaluationClock?.monotonicNowMs === clock.monotonicNowMs &&
      this.#lastEvaluationClock.wallClockNowMs === clock.wallClockNowMs
    ) return;
    const before = JSON.stringify({
      opportunities: [...this.#opportunitiesByMarket.values()],
      blocked: [...this.#blockedByMarket.values()]
    });
    this.#evaluateMarkets();
    const after = JSON.stringify({
      opportunities: [...this.#opportunitiesByMarket.values()],
      blocked: [...this.#blockedByMarket.values()]
    });
    if (after !== before) this.#publish();
  }

  #publish(prebuilt?: AppSnapshot): void {
    const snapshot = safeCloneFreeze(prebuilt ?? this.#buildSnapshot(this.#revision + 1));
    this.#revision = snapshot.revision;
    this.#snapshot = snapshot;
    for (const listener of this.#listeners) {
      try {
        listener(snapshot);
      } catch {
        this.#recordDiagnostic({
          code: "SUBSCRIBER_FAILURE",
          adapterId: null,
          provider: null,
          category: null,
          canonicalMarketId: null,
          reason: "snapshot subscriber failed"
        });
      }
    }
  }

  #buildSnapshot(revision: number): AppSnapshot {
    const clock = this.#clock.now();
    const opportunities = [...this.#opportunitiesByMarket.values()].sort((left, right) =>
      new Decimal(right.netMargin).comparedTo(left.netMargin) ||
      new Decimal(right.worstCaseProfit).comparedTo(left.worstCaseProfit) ||
      left.quoteAgeMs - right.quoteAgeMs ||
      compareText(left.canonicalMarketId, right.canonicalMarketId)
    );
    const events = this.#eventCandidates.map((candidate) => candidate.canonical);
    const markets = this.#marketCandidates.map((candidate) => candidate.canonical);
    const statuses = [...this.#providerStatuses.values()].sort((left, right) =>
      compareText(
        composite([left.category, left.provider, left.adapterId]),
        composite([right.category, right.provider, right.adapterId])
      )
    );
    const statusCounts = (items: readonly { readonly mappingStatus: MappingStatus }[]) => ({
      VERIFIED: items.filter((item) => item.mappingStatus === "VERIFIED").length,
      REVIEW_REQUIRED: items.filter((item) => item.mappingStatus === "REVIEW_REQUIRED").length,
      REJECTED: items.filter((item) => item.mappingStatus === "REJECTED").length
    });
    const eventMappingCounts = statusCounts(events);
    const marketMappingCounts = statusCounts(markets);
    const blockedDiagnostics = [
      ...[...this.#blockedByMarket.entries()].map(([sourceIdentity, diagnostic]) => ({
        diagnostic,
        sourceIdentity: composite(["MARKET", sourceIdentity])
      })),
      ...[...this.#runtimeBlockedBySource.entries()].map(([sourceIdentity, diagnostic]) => ({
        diagnostic,
        sourceIdentity: composite(["ADAPTER_CATEGORY", sourceIdentity])
      }))
    ].sort((left, right) =>
      compareText(left.diagnostic.category, right.diagnostic.category) ||
      compareText(left.diagnostic.code, right.diagnostic.code) ||
      compareText(
        left.diagnostic.canonicalMarketId ?? "",
        right.diagnostic.canonicalMarketId ?? ""
      ) ||
      compareText(left.sourceIdentity, right.sourceIdentity) ||
      compareText(left.diagnostic.reason, right.diagnostic.reason) ||
      compareText(
        JSON.stringify(left.diagnostic.mappingEvidence),
        JSON.stringify(right.diagnostic.mappingEvidence)
      )
    ).map(({ diagnostic }) => diagnostic);
    return {
      revision,
      generatedAtMs: clock.wallClockNowMs,
      providerStatuses: statuses,
      counts: {
        FOOTBALL: {
          events: events.filter((event) => event.category === "FOOTBALL").length,
          markets: markets.filter((market) => market.category === "FOOTBALL").length
        },
        LOL: {
          events: events.filter((event) => event.category === "LOL").length,
          markets: markets.filter((market) => market.category === "LOL").length
        },
        mappings: {
          VERIFIED: eventMappingCounts.VERIFIED + marketMappingCounts.VERIFIED,
          REVIEW_REQUIRED: eventMappingCounts.REVIEW_REQUIRED + marketMappingCounts.REVIEW_REQUIRED,
          REJECTED: eventMappingCounts.REJECTED + marketMappingCounts.REJECTED
        },
        opportunities: opportunities.length
      },
      events,
      markets,
      opportunities,
      blockedDiagnostics
    };
  }

  #emptySnapshot(): AppSnapshot {
    const clock = this.#clock.now();
    return {
      revision: 0,
      generatedAtMs: clock.wallClockNowMs,
      providerStatuses: [],
      counts: {
        FOOTBALL: { events: 0, markets: 0 },
        LOL: { events: 0, markets: 0 },
        mappings: { VERIFIED: 0, REVIEW_REQUIRED: 0, REJECTED: 0 },
        opportunities: 0
      },
      events: [],
      markets: [],
      opportunities: [],
      blockedDiagnostics: []
    };
  }

  #recordDiagnostic(diagnostic: Omit<RuntimeDiagnostic, "timestampMs">): void {
    this.#diagnostics.push({ timestampMs: this.#clock.now().wallClockNowMs, ...diagnostic });
  }

  #isQuarantined(adapterId: string, category: Category): boolean {
    return this.#quarantinedAdapters.has(composite([adapterId, category]));
  }

  #quoteSnapshot(clock: QuoteClockContext): QuoteSnapshot {
    const snapshots = [...this.#quoteBooks.entries()].map(([owner, book]) => ({
      owner,
      snapshot: book.snapshot(clock)
    }));
    const quotes = snapshots.flatMap(({ owner, snapshot }) => snapshot.quotes.flatMap((entry) => {
      const quote = this.#quotesByAdapter.get(owner)?.get(entry.key) ?? entry.quote;
      const ownerInactive = owner === "" ||
        this.#activeMarketAdapters.get(entry.marketKey) !== owner ||
        this.#activeEventAdapters.get(providerEventKey(quote)) !== owner;
      const quarantined = ownerInactive || this.#isQuarantined(owner, quote.category);
      return quarantined ? [] : [{ ...entry, quote }];
    }));
    return {
      monotonicGeneratedAtMs: clock.monotonicNowMs,
      wallClockGeneratedAtMs: clock.wallClockNowMs,
      quotes,
      byKey: Object.fromEntries(quotes.map((entry) => [entry.key, entry])),
      diagnostics: snapshots.flatMap(({ snapshot }) => snapshot.diagnostics)
    };
  }

  #evaluateMarkets(touched?: ReadonlySet<string>): void {
    const candidateIds = new Set(this.#marketCandidates.map((candidate) => candidate.key));
    for (const key of this.#opportunitiesByMarket.keys()) {
      if (!candidateIds.has(key)) this.#opportunitiesByMarket.delete(key);
    }
    for (const key of this.#blockedByMarket.keys()) {
      if (!candidateIds.has(key)) this.#blockedByMarket.delete(key);
    }

    const clock = this.#clock.now();
    const quoteSnapshot = this.#quoteSnapshot(clock);
    const marketsToEvaluate = touched === undefined
      ? this.#marketCandidates
      : this.#marketCandidates.filter((candidate) => touched.has(candidate.key));
    const candidates = this.#opportunityCandidates(quoteSnapshot, marketsToEvaluate);
    for (const candidate of candidates) {
      const key = candidate.market.canonicalMarketId;
      const opportunities = this.#opportunityEngine.evaluate(quoteSnapshot, {
        candidates: [candidate],
        bankroll: this.#opportunityPolicy.bankroll,
        minimumNetMargin: this.#opportunityPolicy.minimumNetMargin,
        minimumWorstCaseProfit: this.#opportunityPolicy.minimumWorstCaseProfit,
        minimumRoi: this.#opportunityPolicy.minimumRoi,
        minimumRemainingTtlMs: this.#opportunityPolicy.minimumRemainingTtlMs,
        baseCurrency: this.#opportunityPolicy.baseCurrency,
        evaluatedAtMs: clock.wallClockNowMs
      });
      const opportunity = opportunities[0];
      const blocked = this.#opportunityEngine.blockedDiagnostics[0];
      if (opportunity === undefined) this.#opportunitiesByMarket.delete(key);
      else this.#opportunitiesByMarket.set(key, opportunity);
      if (blocked === undefined) this.#blockedByMarket.delete(key);
      else this.#blockedByMarket.set(key, blocked);
    }
    this.#lastEvaluationClock = clock;
  }
}
