import type {
  AdapterSchemaError,
  ProviderAdapter,
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
  effectiveDecimal,
  mapEvents,
  mapMarkets,
  normalizeName,
  quoteKey,
  resolveAliasForCategory,
  toDecimal,
  type FeeModel,
  type MappingPolicy,
  type MarketMappingResult,
  type NormalizedEvent,
  type NormalizedMarket,
  type OpportunityCandidate,
  type QuoteClockContext,
  type QuoteSnapshot,
  type QuoteTransport,
  type SourceFreshnessPolicy,
  type StakeConstraint
} from "@tool-chenh/core";

export interface RuntimeClock {
  now(): QuoteClockContext;
}

export interface ProviderOpportunityPolicy {
  readonly fee: FeeModel;
  readonly constraint: StakeConstraint;
}

export interface RuntimeOpportunityPolicy {
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
  readonly transports?: Readonly<Record<string, QuoteTransport>>;
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

const defaultProviderPolicy: ProviderOpportunityPolicy = {
  fee: { type: "NONE" },
  constraint: { minStake: "1", maxStake: "1000", stakeStep: "1", balance: "1000" }
};

const defaultOpportunityPolicy: Omit<RuntimeOpportunityPolicy, "providers"> = {
  bankroll: "1000",
  minimumNetMargin: "0",
  minimumWorstCaseProfit: "0",
  minimumRoi: "0",
  minimumRemainingTtlMs: 0
};

function composite(parts: readonly string[]): string {
  return parts.map(encodeURIComponent).join("|");
}

function providerEventKey(value: Pick<ProviderEvent, "provider" | "providerEventId">): string {
  return composite([value.provider, value.providerEventId]);
}

function providerMarketKey(
  value: Pick<ProviderMarket, "provider" | "providerEventId" | "providerMarketId">
): string {
  return composite([value.provider, value.providerEventId, value.providerMarketId]);
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
    rematchCandidate: false,
    fixtureDiscriminator: null,
    liveState: null
  } as const;

  return event.category === "FOOTBALL"
    ? {
        ...common,
        category: "FOOTBALL",
        eventScope: event.eventScope === "REGULATION" ? "REGULAR_TIME" : null,
        bestOf: null,
        isVirtual: false,
        sportVariant: "FOOTBALL"
      }
    : {
        ...common,
        category: "LOL",
        eventScope: event.eventScope === "SERIES" ? "SERIES" : null,
        bestOf: event.bestOf,
        gameVariant: "LOL_PC"
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
    mappingStatus: result.status,
    mappingEvidence: result.evidence
  };
}

function canonicalOutcome(quote: ProviderQuote, event: NormalizedEvent): string | null {
  if (["OVER", "UNDER", "HOME", "DRAW", "AWAY"].includes(quote.selection)) {
    return quote.selection;
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
  readonly #transports: Readonly<Record<string, QuoteTransport>>;
  readonly #opportunityPolicy: RuntimeOpportunityPolicy;
  readonly #events = new Map<string, ProviderEvent>();
  readonly #markets = new Map<string, ProviderMarket>();
  readonly #quotes = new Map<string, ProviderQuote>();
  readonly #providerStatuses = new Map<string, ProviderConnectionStatus>();
  readonly #listeners = new Set<SnapshotListener>();
  readonly #diagnostics: RuntimeDiagnostic[] = [];
  readonly #quarantinedSources = new Set<string>();
  readonly #controllers = new Map<string, AbortController>();
  readonly #quoteBook: QuoteBook;
  readonly #opportunityEngine = new OpportunityEngine();
  readonly #opportunitiesByMarket = new Map<string, Opportunity>();
  readonly #blockedByMarket = new Map<string, BlockedDiagnostic>();
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
    this.#transports = options.transports ?? {};
    this.#opportunityPolicy = options.opportunityPolicy ?? {
      ...defaultOpportunityPolicy,
      providers: Object.fromEntries([...providers].map((provider) => [provider, defaultProviderPolicy]))
    };
    this.#quoteBook = new QuoteBook(this.#freshnessPolicies);
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
      onEvent: (event) => this.#onEvent(event),
      onMarket: (market) => this.#onMarket(market),
      onQuote: (quote) => this.#onQuote(quote),
      onStatus: (status) => this.#onStatus(status),
      onSchemaError: (error) => this.#onSchemaError(error, adapterId)
    };
  }

  #onEvent(event: ProviderEvent): void {
    if (this.#isQuarantined(event.provider, event.category)) return;
    this.#events.set(providerEventKey(event), event);
    this.#rebuildCategory(event.category);
    this.#evaluateMarkets(new Set(this.#marketCandidates
      .filter((candidate) => candidate.canonical.category === event.category)
      .map((candidate) => candidate.key)));
    this.#publish();
  }

  #onMarket(market: ProviderMarket): void {
    if (this.#isQuarantined(market.provider, market.category)) return;
    this.#markets.set(providerMarketKey(market), market);
    this.#rebuildTouchedMarket(market);
    this.#evaluateMarkets(new Set(this.#marketCandidates
      .filter((candidate) =>
        (candidate.left.provider === market.provider && candidate.left.providerEventId === market.providerEventId && candidate.left.providerMarketId === market.providerMarketId) ||
        (candidate.right.provider === market.provider && candidate.right.providerEventId === market.providerEventId && candidate.right.providerMarketId === market.providerMarketId)
      )
      .map((candidate) => candidate.key)));
    this.#publish();
  }

  #onQuote(quote: ProviderQuote): void {
    if (this.#isQuarantined(quote.provider, quote.category)) return;
    this.#quotes.set(quoteKey(quote), quote);
    const marketQuotes = [...this.#quotes.values()].filter((item) =>
      item.provider === quote.provider &&
      item.providerEventId === quote.providerEventId &&
      item.providerMarketId === quote.providerMarketId
    );
    const result = this.#quoteBook.apply({
      source: { provider: quote.provider, category: quote.category },
      kind: "FULL_SNAPSHOT",
      transport: this.#transports[quote.provider] ?? "WEBSOCKET",
      clock: this.#clock.now(),
      quotes: marketQuotes.map((item) => ({ ...item, sequence: null }))
    });
    if (!result.accepted) {
      this.#recordDiagnostic({
        code: result.reason ?? "QUOTE_REJECTED",
        adapterId: null,
        provider: quote.provider,
        category: quote.category,
        canonicalMarketId: null,
        reason: "quote update was rejected"
      });
    }
    this.#rebuildTouchedMarket(quote);
    this.#evaluateMarkets(new Set(this.#marketCandidates
      .filter((candidate) =>
        (candidate.left.provider === quote.provider && candidate.left.providerEventId === quote.providerEventId && candidate.left.providerMarketId === quote.providerMarketId) ||
        (candidate.right.provider === quote.provider && candidate.right.providerEventId === quote.providerEventId && candidate.right.providerMarketId === quote.providerMarketId)
      )
      .map((candidate) => candidate.key)));
    this.#publish();
  }

  #onStatus(status: ProviderConnectionStatus): void {
    if (this.#isQuarantined(status.provider, status.category)) return;
    this.#providerStatuses.set(composite([status.provider, status.category]), {
      ...status,
      detail: status.detail === null ? null : "provider status update"
    });
    this.#publish();
  }

  #onSchemaError(error: AdapterSchemaError, adapterId: string): void {
    const clock = this.#clock.now();
    this.#quarantinedSources.add(composite([error.provider, error.category]));
    this.#providerStatuses.set(composite([error.provider, error.category]), {
      provider: error.provider,
      category: error.category,
      status: "SCHEMA_ERROR",
      detail: "adapter/category quarantined after schema validation failure",
      updatedAtMs: clock.wallClockNowMs
    });
    this.#quoteBook.apply({
      source: { provider: error.provider, category: error.category },
      kind: "FULL_SNAPSHOT",
      transport: this.#transports[error.provider] ?? "WEBSOCKET",
      clock,
      quotes: [{}]
    });
    this.#recordDiagnostic({
      code: "SCHEMA_ERROR",
      adapterId,
      provider: error.provider,
      category: error.category,
      canonicalMarketId: null,
      reason: `${error.recordKind.toLowerCase()} record failed strict schema validation`
    });
    this.#evaluateMarkets(new Set(this.#marketCandidates
      .filter((candidate) =>
        (candidate.left.provider === error.provider && candidate.left.category === error.category) ||
        (candidate.right.provider === error.provider && candidate.right.category === error.category)
      )
      .map((candidate) => candidate.key)));
    this.#publish();
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
    market: Pick<ProviderMarket, "provider" | "providerEventId" | "providerMarketId">
  ): void {
    const touches = (candidate: Pick<MarketCandidate, "left" | "right">): boolean =>
      (candidate.left.provider === market.provider &&
        candidate.left.providerEventId === market.providerEventId &&
        candidate.left.providerMarketId === market.providerMarketId) ||
      (candidate.right.provider === market.provider &&
        candidate.right.providerEventId === market.providerEventId &&
        candidate.right.providerMarketId === market.providerMarketId);
    const events = this.#eventCandidates.filter((candidate) =>
      candidate.result.status === "VERIFIED" &&
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
        market.provider === event.left.provider && market.providerEventId === event.left.providerEventId
      );
      const rightMarkets = [...this.#markets.values()].filter((market) =>
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
    const selections = [...this.#quotes.values()]
      .filter((quote) =>
        quote.provider === market.provider &&
        quote.providerEventId === market.providerEventId &&
        quote.providerMarketId === market.providerMarketId
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
          return entry.quote.provider === source.provider &&
            entry.quote.providerEventId === source.providerEventId &&
            entry.quote.providerMarketId === source.providerMarketId &&
            entry.quote.providerSelectionId === selectionId;
        });
        if (entries.length === 0) return [];
        const best = entries.reduce((winner, current) => {
          const winnerPolicy = this.#providerPolicy(winner.quote.provider);
          const currentPolicy = this.#providerPolicy(current.quote.provider);
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
          fee: policy.fee,
          constraint: policy.constraint
        }];
      });
      return { market: candidate.canonical, mapping: candidate.result, legs };
    });
  }

  #providerPolicy(provider: string): ProviderOpportunityPolicy {
    return this.#opportunityPolicy.providers[provider] ?? defaultProviderPolicy;
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
    for (const listener of this.#listeners) listener(snapshot);
  }

  #buildSnapshot(revision: number): AppSnapshot {
    const clock = this.#clock.now();
    const opportunities = [...this.#opportunitiesByMarket.values()].sort((left, right) =>
      Number(right.netMargin) - Number(left.netMargin) ||
      Number(right.worstCaseProfit) - Number(left.worstCaseProfit) ||
      left.quoteAgeMs - right.quoteAgeMs ||
      compareText(left.canonicalMarketId, right.canonicalMarketId)
    );
    const events = this.#eventCandidates.map((candidate) => candidate.canonical);
    const markets = this.#marketCandidates.map((candidate) => candidate.canonical);
    const statuses = [...this.#providerStatuses.values()].sort((left, right) =>
      compareText(`${left.category}|${left.provider}`, `${right.category}|${right.provider}`)
    );
    const statusCounts = (items: readonly { readonly mappingStatus: MappingStatus }[]) => ({
      VERIFIED: items.filter((item) => item.mappingStatus === "VERIFIED").length,
      REVIEW_REQUIRED: items.filter((item) => item.mappingStatus === "REVIEW_REQUIRED").length,
      REJECTED: items.filter((item) => item.mappingStatus === "REJECTED").length
    });
    const eventMappingCounts = statusCounts(events);
    const marketMappingCounts = statusCounts(markets);
    const blockedDiagnostics = [...this.#blockedByMarket.values()].sort((left, right) =>
      compareText(left.canonicalMarketId ?? "", right.canonicalMarketId ?? "") ||
      compareText(left.code, right.code)
    );
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

  #isQuarantined(provider: string, category: Category): boolean {
    return this.#quarantinedSources.has(composite([provider, category]));
  }

  #quoteSnapshot(clock: QuoteClockContext): QuoteSnapshot {
    const storedSnapshot = this.#quoteBook.snapshot(clock);
    const quotes = storedSnapshot.quotes.map((entry) => ({
      ...entry,
      quote: this.#quotes.get(entry.key) ?? entry.quote
    }));
    return {
      ...storedSnapshot,
      quotes,
      byKey: Object.fromEntries(quotes.map((entry) => [entry.key, entry]))
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
        minimumRemainingTtlMs: this.#opportunityPolicy.minimumRemainingTtlMs
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
