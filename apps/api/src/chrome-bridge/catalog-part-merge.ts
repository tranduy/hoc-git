import type { ProviderId } from "@tool-chenh/contracts";
import type { ObservedProviderCatalog } from "../providers/cmd/cmd-observed-catalog.js";

export interface NormalizedCatalogPart {
  readonly diagnostics: readonly unknown[];
  readonly events: ObservedProviderCatalog["events"];
  readonly markets: ObservedProviderCatalog["markets"];
  readonly quotes: ObservedProviderCatalog["quotes"];
}

export type CatalogEvent = ObservedProviderCatalog["events"][number];

function fixtureIdentity(event: CatalogEvent, reconcileFeeds = false): string {
  const participant = (value: string): string => value.normalize("NFKD").replace(/\p{M}+/gu, "")
    .toLocaleLowerCase("en").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  const variant = event.category === "FOOTBALL"
    ? `${event.sportVariant ?? ""}/${String(event.isVirtual)}`
    : `${event.gameVariant ?? ""}/${String(event.bestOf)}`;
  // Reconciling one provider's two feeds cannot key on live phase or
  // competition: the page labels its whole live section live and names the
  // competition in the site language, while the socket carries the real phase
  // and the English name. Inside a single provider, the same two participants
  // at the same scope are the same fixture.
  return [event.category, reconcileFeeds ? "ANY" : event.isLive ? "LIVE" : "PREMATCH",
    event.eventScope, variant,
    reconcileFeeds ? "ANY" : participant(event.competition),
    [participant(event.participantA), participant(event.participantB)].sort().join("~")].join("|");
}

/**
 * A provider that publishes one fixture under several providerEventIds splits
 * that fixture's markets across records. The comparison layer then reads the
 * repeated identity as ambiguous and drops the fixture from every cross-book
 * pairing. Collapsing is scoped to one provider's own catalog, where a shared
 * competition string is reliable, and never merges records that disagree on
 * live phase, scope, variant or competition.
 */
function collapseDuplicates(
  events: Map<string, CatalogEvent>,
  markets: Map<string, ObservedProviderCatalog["markets"][number]>,
  quotes: Map<string, ObservedProviderCatalog["quotes"][number]>,
  options: { readonly reconcileFeeds: boolean;
    readonly selectEvent?: (current: CatalogEvent, candidate: CatalogEvent) => CatalogEvent } = { reconcileFeeds: false }
): void {
  const canonicalByFixture = new Map<string, string>();
  const rewrite = new Map<string, string>();
  for (const [providerEventId, event] of events) {
    const identity = fixtureIdentity(event, options.reconcileFeeds);
    const canonical = canonicalByFixture.get(identity);
    if (canonical === undefined) {
      canonicalByFixture.set(identity, providerEventId);
      continue;
    }
    // Keep the canonical id so markets survive, but let the provider's own
    // selection rule decide which record's fields win.
    const kept = events.get(canonical);
    if (kept !== undefined && options.selectEvent !== undefined) {
      const winner = options.selectEvent(kept, event);
      events.set(canonical, { ...winner, providerEventId: canonical });
    }
    rewrite.set(providerEventId, canonical);
    events.delete(providerEventId);
  }
  if (rewrite.size === 0) return;
  for (const [key, market] of [...markets]) {
    const canonical = rewrite.get(market.providerEventId);
    if (canonical === undefined) continue;
    markets.delete(key);
    markets.set(`${canonical}|${market.providerMarketId}`, { ...market, providerEventId: canonical });
  }
  for (const [key, quote] of [...quotes]) {
    const canonical = rewrite.get(quote.providerEventId);
    if (canonical === undefined) continue;
    quotes.delete(key);
    quotes.set(`${canonical}|${quote.providerMarketId}|${quote.providerSelectionId}`,
      { ...quote, providerEventId: canonical });
  }
}

/**
 * A catalog merged from several parts can keep the event record from one part
 * and its quotes from another. When those parts disagree about live phase, the
 * comparison layer — which only shows a quote whose phase equals its event's —
 * discards every quote, and the fixture pairs across books while displaying no
 * ticket at all. The event record owns the phase, so quotes follow it.
 */
/** A kickoff must sit this far ahead before it can contradict a live claim, so a
 * fixture seconds from kick-off is not read as one that starts later. */
const SCHEDULED_KICKOFF_MARGIN_MS = 300_000;

function participantsKey(event: CatalogEvent): string {
  const participant = (value: string): string => value.normalize("NFKD").replace(/\p{M}+/gu, "")
    .toLocaleLowerCase("en").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  return [event.category, event.eventScope,
    [participant(event.participantA), participant(event.participantB)].sort().join("~")].join("|");
}

/**
 * A provider whose live section is really "live and about to be" claims fixtures
 * that have not kicked off. SABA stamps every event in that section with the
 * moment the snapshot was built rather than a kickoff - 63 of 66 shared one
 * timestamp to the second - so the section's own evidence that a match has
 * started is always true and never means anything.
 *
 * Its day list carries the same fixtures with real, whole-minute kickoffs hours
 * away, and the two only meet once the parts are merged. A fixture that starts
 * later is not running now: take the scheduled kickoff as the truth on both
 * counts, which also puts the event in the pre-match window where the books that
 * price the same fixture can reach it. A live event is never compared against
 * another book's pre-match one, so believing the claim strands exactly the
 * markets worth comparing.
 */
function resolveScheduledPhase(events: Map<string, CatalogEvent>, observedAtMs: number): void {
  const scheduledByFixture = new Map<string, number>();
  for (const event of events.values()) {
    if (event.startAtUtcMs <= observedAtMs + SCHEDULED_KICKOFF_MARGIN_MS) continue;
    const key = participantsKey(event);
    const previous = scheduledByFixture.get(key);
    if (previous === undefined || event.startAtUtcMs < previous) {
      scheduledByFixture.set(key, event.startAtUtcMs);
    }
  }
  if (scheduledByFixture.size === 0) return;
  for (const [id, event] of events) {
    if (!event.isLive) continue;
    const scheduled = scheduledByFixture.get(participantsKey(event));
    if (scheduled === undefined) continue;
    events.set(id, { ...event, isLive: false, startAtUtcMs: scheduled,
      rematchCandidate: false, liveState: null });
  }
}

/** Same rule applied to a whole catalog, for the overlay path that unions
 *  SABA's retained catalog with a newer one: its live section and its day list
 *  can arrive in separate snapshots, and only the union holds both. */
export function withScheduledPhaseResolved(
  catalog: ObservedProviderCatalog, observedAtMs = catalog.observedAtMs
): ObservedProviderCatalog {
  const events = new Map(catalog.events.map((event) => [event.providerEventId, event]));
  resolveScheduledPhase(events, observedAtMs);
  return withAlignedQuotePhase({ ...catalog, events: [...events.values()] });
}

function alignQuotePhase(
  events: ReadonlyMap<string, CatalogEvent>,
  quotes: Map<string, ObservedProviderCatalog["quotes"][number]>
): void {
  for (const [key, quote] of quotes) {
    const event = events.get(quote.providerEventId);
    if (event === undefined || event.isLive === quote.isLive) continue;
    quotes.set(key, { ...quote, isLive: event.isLive });
  }
}

/** Same rule applied to a whole catalog, for the overlay paths that union a
 *  retained catalog with a newer one after the parts were merged. */
export function withAlignedQuotePhase(catalog: ObservedProviderCatalog): ObservedProviderCatalog {
  const phase = new Map(catalog.events.map((event) => [event.providerEventId, event.isLive]));
  let changed = false;
  const quotes = catalog.quotes.map((quote) => {
    const isLive = phase.get(quote.providerEventId);
    if (isLive === undefined || isLive === quote.isLive) return quote;
    changed = true;
    return { ...quote, isLive };
  });
  return changed ? { ...catalog, quotes } : catalog;
}

export function mergeObservedCatalogParts(input: {
  readonly accountId: string;
  readonly provider: ProviderId;
  readonly observedAtMs: number;
  readonly parts: readonly NormalizedCatalogPart[];
  readonly selectEvent?: (current: CatalogEvent, candidate: CatalogEvent) => CatalogEvent;
  readonly collapseDuplicateEvents?: boolean;
  /** Let a scheduled kickoff overrule a live section that also lists fixtures
   *  which have not started. */
  readonly resolveScheduledPhase?: boolean;
}): ObservedProviderCatalog {
  const events = new Map<string, ObservedProviderCatalog["events"][number]>();
  const markets = new Map<string, ObservedProviderCatalog["markets"][number]>();
  const quotes = new Map<string, ObservedProviderCatalog["quotes"][number]>();
  for (const part of input.parts) {
    for (const event of part.events) {
      const current = events.get(event.providerEventId);
      events.set(event.providerEventId,
        current === undefined ? event : (input.selectEvent?.(current, event) ?? event));
    }
    for (const market of part.markets) markets.set(`${market.providerEventId}|${market.providerMarketId}`, market);
    for (const quote of part.quotes) {
      quotes.set(`${quote.providerEventId}|${quote.providerMarketId}|${quote.providerSelectionId}`, quote);
    }
  }
  if (input.collapseDuplicateEvents === true) {
    collapseDuplicates(events, markets, quotes, {
      reconcileFeeds: false,
      ...(input.selectEvent === undefined ? {} : { selectEvent: input.selectEvent })
    });
  }
  if (input.resolveScheduledPhase === true) resolveScheduledPhase(events, input.observedAtMs);
  alignQuotePhase(events, quotes);
  return {
    dataMode: "LIVE",
    accountId: input.accountId,
    provider: input.provider,
    category: "FOOTBALL",
    comparisonState: "AWAITING_SECOND_PROVIDER",
    observedAtMs: input.observedAtMs,
    rejectedMarketCount: input.parts.reduce((total, part) => total + part.diagnostics.length, 0),
    events: [...events.values()],
    markets: [...markets.values()],
    quotes: [...quotes.values()]
  };
}
