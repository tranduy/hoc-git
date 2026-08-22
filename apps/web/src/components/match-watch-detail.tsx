import { useEffect, useMemo, useRef, useState } from "react";
import type { CatalogApiLike, LiveCatalogResponse } from "../api/catalog.js";
import {
  boundWatchEntries,
  diffMatchSamples,
  sampleMatch,
  type MatchSample,
  type MatchWatchEntry
} from "../watch/match-watch.js";
import { loadWatchEntries, saveWatchEntries } from "../watch/watch-storage.js";
import {
  buildComparisonEvents,
  decimalOdds,
  estimatedLiveStartAtMs,
  formatCountdown,
  formatMatchClock,
  observedTicketAsComparisonRow,
  selectionLabel,
  ticketMarketLabel,
  type ComparisonEvent
} from "../catalog/comparison.js";
import { formatDisplayDecimal } from "../catalog/display-format.js";
import type { ProviderId } from "@tool-chenh/contracts";
import { ArbitrageAlertToast } from "./arbitrage-alert-toast.js";
import { buildObservedFixedBaseStakeEstimate,
  type FixedBaseStakePolicy } from "../watch/fixed-base-stake.js";
import type { LagSignal } from "../watch/lag-signal-tracker.js";
import type { RankedTicket } from "../watch/ranked-tickets.js";
import { RankedTicketTable, renderableRankedTickets } from "./ranked-ticket-table.js";
import { ProviderBrand } from "./provider-brand.js";
import { RoiBadge } from "./roi-badge.js";
import type { ProviderTicketIdentity } from "../api/provider-ticket.js";
import { sortProviderItems } from "../catalog/provider-order.js";
import { defaultTicketRealtimeCheckApi, type TicketRealtimeCheckApiLike } from "../api/ticket-realtime-check.js";
import type { TicketReportApiLike } from "../api/ticket-report.js";

type WatcherState = "WATCHING" | "STALE" | "ERROR" | "STOPPED";
const systemClock = (): number => Date.now();

export interface ComparisonBook {
  readonly provider: ProviderId;
  readonly connected: boolean;
  readonly selected: boolean;
  readonly hasExactEvent: boolean;
}

function CompactComparisonGrid({ comparison, selectedProviders, lagSignals, stakePolicy }: {
  readonly comparison: ComparisonEvent;
  readonly selectedProviders: ReadonlySet<ProviderId>;
  readonly lagSignals: readonly LagSignal[];
  readonly stakePolicy: FixedBaseStakePolicy;
}) {
  const money = (value: string): string => `${Number(value).toLocaleString("en-US")} VND`;
  const pairedTickets = comparison.observedRows.flatMap((observedRow) => {
    const verifiedRow = comparison.rows.find((candidate) => candidate.key === observedRow.key);
    const displayRow = verifiedRow ?? observedTicketAsComparisonRow(observedRow);
    const signal = lagSignals.find((candidate) => candidate.row.key === observedRow.key);
    const plan = signal?.plan ?? buildObservedFixedBaseStakeEstimate(displayRow, selectedProviders, stakePolicy);
    if (plan === null || plan.legs.length !== 2 || plan.legs[0]!.provider === plan.legs[1]!.provider ||
      plan.legs[0]!.selection === plan.legs[1]!.selection) return [];
    return [{ observedRow, displayRow, signal, plan }];
  });
  if (pairedTickets.length === 0) return null;
  return <><h2 id="current-prices-heading">Vé chấp 2 cửa giữa các sàn</h2>
    <div className="watch-odds-tickets">{pairedTickets.map(({ observedRow, displayRow, signal, plan }) => {
    const orderedLegs = sortProviderItems(plan.legs, (leg) => leg.provider);
    return <article className={signal === undefined ? "watch-odds-ticket" : "watch-odds-ticket watch-odds-ticket--profitable"}
      key={observedRow.key}>
      <header className="watch-odds-ticket__header">
        <div><strong>{ticketMarketLabel(observedRow.marketType)}</strong>
          <small>{observedRow.line === null ? "Không line" : `Kèo ${observedRow.line}`}</small></div>
        <div className="watch-odds-ticket__edge"><RoiBadge roiPercent={Number(plan.roi) * 100} size="sm" />
          <small>{signal === undefined ? "Đang theo dõi" : "Đủ điều kiện · lãi ≥ 20.000 VND"}</small></div>
      </header>
      <div className="watch-odds-grid">{orderedLegs.map((leg) => {
        const cell = observedRow.cells.find((candidate) => candidate.provider === leg.provider);
        const quotes = cell?.quotes.filter((quote) => quote.selection === leg.selection) ?? [];
        return <section className="watch-odds-provider" key={leg.provider}>
          <header><ProviderBrand compact provider={leg.provider} /></header>
          <div className="rate-cell">{quotes.map((quote) => <span
              className={displayRow.bestBySelection[quote.selection] === leg.provider ? "rate-quote rate-quote--best" : "rate-quote"}
              key={quote.providerSelectionId}><b>{selectionLabel(comparison.event, quote.selection)}</b>
              <span>{formatDisplayDecimal(quote.rawOdds)} {quote.rawFormat}</span>
              <small>{decimalOdds(quote) === null ? quote.status : `decimal ${decimalOdds(quote)!.toFixed(3)} · ${quote.status}`}</small></span>)}</div>
        </section>;
      })}</div>
      <footer className="watch-odds-ticket__plan" aria-label={`Gross preflight ${observedRow.marketType}${observedRow.line === null ? "" : ` line ${observedRow.line}`}`}>
        <><div>{orderedLegs.map((leg) => <span key={leg.selection}><small>#{leg.provider} · {selectionLabel(comparison.event, leg.selection)} @ {formatDisplayDecimal(leg.decimalOdds)}</small>
          <b>{money(leg.stake)} {leg.role.toLowerCase()}</b></span>)}</div><div className="watch-odds-ticket__result"><strong>Worst {money(plan.worstCaseProfit)}</strong><RoiBadge roiPercent={Number(plan.roi) * 100} size="sm" /></div></>
      </footer>
    </article>;
  })}</div></>;
}

function safeFailureEntry(sample: MatchSample, detectedAtMs: number): MatchWatchEntry {
  const event = sample.event;
  return {
    id: `${detectedAtMs}:POLL_FAILED:event:all`, kind: "POLL_FAILED", provider: sample.provider,
    providerEventId: sample.providerEventId, providerMarketId: null, providerSelectionId: null,
    competition: event?.competition ?? "Unknown competition",
    matchLabel: event === null ? "Unknown event" : `${event.participantA} vs ${event.participantB}`,
    marketType: null, scope: null, line: null, selection: null, previousValue: "WATCHING",
    currentValue: "Provider catalog read failed", detectedAtMs,
    providerObservedAtMs: sample.observedAtMs, sampleIntervalMs: 0
  };
}

function safeStaleEntry(sample: MatchSample, detectedAtMs: number, staleAfterMs: number): MatchWatchEntry {
  const event = sample.event;
  return {
    id: `${detectedAtMs}:STALE:event:all`, kind: "STALE", provider: sample.provider,
    providerEventId: sample.providerEventId, providerMarketId: null, providerSelectionId: null,
    competition: event?.competition ?? "Unknown competition",
    matchLabel: event === null ? "Unknown event" : `${event.participantA} vs ${event.participantB}`,
    marketType: null, scope: null, line: null, selection: null, previousValue: "FRESH",
    currentValue: `No accepted provider sample within ${staleAfterMs} ms`, detectedAtMs,
    providerObservedAtMs: sample.observedAtMs, sampleIntervalMs: staleAfterMs
  };
}

export function MatchWatchDetail({
  accountId,
  catalogApi,
  initialCatalog,
  comparisonEvent,
  comparisonCatalogs,
  lagSignals = [],
  books,
  onBack,
  providerEventId,
  pollDelayMs = 1_000,
  staleAfterMs = 10_000,
  baseStake = "100000",
  rankedTickets = [],
  highlightTicketKey = null,
  onOpenProviderTicket,
  ticketRealtimeCheckApi = defaultTicketRealtimeCheckApi,
  ticketReportApi,
  externallyRefreshed = false,
  storage = window.localStorage,
  clock = systemClock
}: {
  readonly accountId: string;
  readonly catalogApi: CatalogApiLike;
  readonly initialCatalog: LiveCatalogResponse;
  readonly comparisonEvent?: ComparisonEvent;
  readonly comparisonCatalogs?: readonly LiveCatalogResponse[];
  readonly lagSignals?: readonly LagSignal[];
  readonly books?: readonly ComparisonBook[];
  readonly onBack: () => void;
  readonly providerEventId: string;
  readonly pollDelayMs?: number;
  readonly staleAfterMs?: number;
  readonly baseStake?: string;
  readonly rankedTickets?: readonly RankedTicket[];
  readonly highlightTicketKey?: string | null;
  readonly onOpenProviderTicket?: ((identity: ProviderTicketIdentity) => void) | undefined;
  readonly ticketRealtimeCheckApi?: TicketRealtimeCheckApiLike;
  readonly ticketReportApi?: TicketReportApiLike | undefined;
  readonly externallyRefreshed?: boolean;
  readonly storage?: Storage;
  readonly clock?: () => number;
}) {
  const initialSample = useMemo(() => sampleMatch(initialCatalog, providerEventId), [initialCatalog, providerEventId]);
  const [currentSample, setCurrentSample] = useState(initialSample);
  const [currentComparison, setCurrentComparison] = useState(comparisonEvent);
  const sampleRef = useRef(initialSample);
  const [entries, setEntries] = useState<readonly MatchWatchEntry[]>(() =>
    loadWatchEntries(storage, initialCatalog.provider, providerEventId));
  const [watching, setWatching] = useState(true);
  const [watcherState, setWatcherState] = useState<WatcherState>("WATCHING");
  const [successfulSamples, setSuccessfulSamples] = useState(1);
  const visibleBooks = sortProviderItems(books ?? (comparisonEvent?.providers ?? [initialCatalog.provider]).map((provider) => ({
    provider, connected: true, selected: true, hasExactEvent: true
  })), (book) => book.provider);
  const effectiveBooks = visibleBooks.map((book) => ({ ...book,
    hasExactEvent: currentComparison?.providers.includes(book.provider) ?? book.hasExactEvent }));
  const catalogSources = useMemo(() => comparisonCatalogs ?? comparisonEvent?.catalogs ?? [initialCatalog],
    [comparisonCatalogs, comparisonEvent, initialCatalog]);
  const providerCatalogEvidence = useMemo(() => Object.fromEntries(catalogSources.map((catalog) =>
    [catalog.provider, { accountId: catalog.accountId, observedAtMs: catalog.observedAtMs }])), [catalogSources]);
  const providerSamplesRef = useRef<Map<string, MatchSample> | null>(null);
  if (providerSamplesRef.current === null) {
    providerSamplesRef.current = new Map(catalogSources.flatMap((catalog) => {
      const eventId = comparisonEvent?.providerEventIds[catalog.provider] ??
        (catalog.accountId === accountId ? providerEventId : undefined);
      return eventId === undefined ? [] : [[catalog.provider, sampleMatch(catalog, eventId)] as const];
    }));
  }
  const [selectedProviders, setSelectedProviders] = useState<ReadonlySet<ProviderId>>(() =>
    new Set<ProviderId>(visibleBooks.filter((book) => book.connected && book.selected).map((book) => book.provider)));
  const selectedBookKey = visibleBooks.filter((book) => book.connected && book.selected)
    .map((book) => book.provider).join("|");

  useEffect(() => {
    setSelectedProviders(new Set<ProviderId>(visibleBooks.filter((book) => book.connected && book.selected)
      .map((book) => book.provider)));
  }, [providerEventId, selectedBookKey]);

  const appendEntries = (newEntries: readonly MatchWatchEntry[]): void => {
    if (newEntries.length === 0) return;
    setEntries((current) => {
      const next = boundWatchEntries([...current, ...newEntries]);
      saveWatchEntries(storage, initialCatalog.provider, providerEventId, next);
      return next;
    });
  };

  useEffect(() => {
    sampleRef.current = initialSample;
    setCurrentSample(initialSample);
    setCurrentComparison(comparisonEvent);
    for (const catalog of catalogSources) {
      const eventId = comparisonEvent?.providerEventIds[catalog.provider] ??
        (catalog.accountId === accountId ? providerEventId : undefined);
      if (eventId !== undefined) providerSamplesRef.current?.set(catalog.provider, sampleMatch(catalog, eventId));
    }
  }, [accountId, catalogSources, comparisonEvent, initialSample, providerEventId]);

  useEffect(() => {
    if (!watching) {
      setWatcherState("STOPPED");
      return;
    }
    // The catalog page already owns the high-frequency refresh loop and passes
    // fresh snapshots through comparisonCatalogs. Polling again here doubles
    // provider traffic and can show a false ERROR from a transient secondary
    // read even while the parent stream is healthy.
    if (externallyRefreshed) {
      setWatcherState("WATCHING");
      return;
    }
    let active = true;
    let timer: number | undefined;
    let staleTimer: number | undefined;
    let staleReported = false;
    const armStaleTimer = (): void => {
      if (staleTimer !== undefined) window.clearTimeout(staleTimer);
      staleTimer = window.setTimeout(() => {
        if (!active || staleReported) return;
        staleReported = true;
        setWatcherState("STALE");
        appendEntries([safeStaleEntry(sampleRef.current, clock(), staleAfterMs)]);
      }, staleAfterMs);
    };
    const schedule = (): void => {
      if (!active) return;
      timer = window.setTimeout(() => { void poll(); }, pollDelayMs);
    };
    const poll = async (): Promise<void> => {
      try {
        const results = await Promise.allSettled(catalogSources.map(async (catalog) => catalogApi.read(catalog.accountId)));
        const catalogs = results.flatMap((result) => result.status === "fulfilled" ? [result.value] : []);
        const catalog = catalogs.find((candidate) => candidate.accountId === accountId);
        if (catalog === undefined) throw new Error("PRIMARY_PROVIDER_CATALOG_UNAVAILABLE");
        if (!active) return;
        const nextComparison = buildComparisonEvents(catalogs).find((candidate) =>
          candidate.providerEventIds[initialCatalog.provider] === providerEventId);
        setCurrentComparison(nextComparison);
        const nextSample = sampleMatch(catalog, providerEventId);
        const detectedAtMs = clock();
        const comparisonEntries: MatchWatchEntry[] = [];
        for (const refreshed of catalogs) {
          const previous = providerSamplesRef.current?.get(refreshed.provider);
          const mappedEventId = nextComparison?.providerEventIds[refreshed.provider] ?? previous?.providerEventId;
          if (mappedEventId === undefined) continue;
          const refreshedSample = sampleMatch(refreshed, mappedEventId);
          if (previous !== undefined) comparisonEntries.push(...diffMatchSamples(previous, refreshedSample, detectedAtMs));
          providerSamplesRef.current?.set(refreshed.provider, refreshedSample);
        }
        appendEntries(comparisonEntries);
        sampleRef.current = nextSample;
        setCurrentSample(nextSample);
        setSuccessfulSamples((count) => count + 1);
        staleReported = false;
        setWatcherState("WATCHING");
        armStaleTimer();
      } catch {
        if (!active) return;
        appendEntries([safeFailureEntry(sampleRef.current, clock())]);
        setWatcherState("ERROR");
      } finally {
        schedule();
      }
    };
    setWatcherState("WATCHING");
    armStaleTimer();
    schedule();
    return () => {
      active = false;
      if (timer !== undefined) window.clearTimeout(timer);
      if (staleTimer !== undefined) window.clearTimeout(staleTimer);
    };
  }, [accountId, catalogApi, catalogSources, clock, externallyRefreshed, initialCatalog.provider, pollDelayMs,
    providerEventId, staleAfterMs, storage, watching]);

  const event = currentSample.event ?? initialSample.event;
  const matchLabel = event === null ? "Selected event unavailable" : `${event.participantA} vs ${event.participantB}`;
  const estimatedStartAtMs = event?.isLive
    ? estimatedLiveStartAtMs(currentSample.observedAtMs, event.liveState)
    : null;
  // Read-only stake estimates must remain calculable when the balanced leg is
  // below a bookmaker's unverified/assumed minimum. Real provider limits are
  // enforced separately by preflight before anything can be executable.
  const stakePolicy: FixedBaseStakePolicy = { currency: "VND", baseStake, minStake: "1000",
    maxStake: "1000000000000", stakeStep: "1", balance: "1000000000000" };
  const selectedTicketProviders = currentComparison?.providers.filter((provider) => selectedProviders.has(provider)) ?? [];
  const visibleRankedTickets = renderableRankedTickets(rankedTickets, selectedTicketProviders);
  const currentAlert = useMemo(() => {
    const observationAgeMs = clock() - currentSample.observedAtMs;
    if (!watching || watcherState !== "WATCHING" || currentComparison === undefined || lagSignals.length === 0 ||
      observationAgeMs < 0 || observationAgeMs > staleAfterMs) return null;
    const signal = lagSignals[0]!;
    return { fingerprint: `${signal.plan.fingerprint}:${signal.triggeredAtMs}`, marketType: signal.row.marketType,
      scope: signal.row.scope, line: signal.row.line, currency: signal.plan.currency, legs: signal.plan.legs,
      totalStake: signal.plan.totalStake,
      worstCasePayout: String(Math.min(...signal.plan.legs.map((leg) => Number(leg.payout)))),
      worstCaseProfit: signal.plan.worstCaseProfit, roi: signal.plan.roi };
  }, [clock, currentComparison, currentSample.observedAtMs, lagSignals, staleAfterMs, watcherState, watching]);
  return (
    <section className="match-watch match-watch--compact" aria-label={`Watching ${matchLabel}`}>
      <ArbitrageAlertToast alert={currentAlert} matchLabel={matchLabel} />
      <button className="watch-back" onClick={onBack} type="button">Back to matches</button>
      <header className="match-watch__header match-watch__header--compact">
        <div><p className="eyebrow">{event?.competition ?? "Provider event"}</p><h1>{matchLabel}</h1>
          {event === null ? <p>Event unavailable</p> : event.isLive ? <div className="match-timing">
            <p>{formatMatchClock(event.liveState)}</p>
            <small>Observed {new Date(currentSample.observedAtMs).toLocaleString()}</small>
            {estimatedStartAtMs === null ? null
              : <small>Approx. started {new Date(estimatedStartAtMs).toLocaleString()}</small>}
          </div> : <div className="match-timing">
            <p>{formatCountdown(event.startAtUtcMs, clock())}</p>
            <small>Scheduled {new Date(event.startAtUtcMs).toLocaleString()}</small>
          </div>}</div>
        <div className="watch-health"><span className={`watch-state watch-state--${watcherState.toLowerCase()}`}>{watcherState}</span>
          <span>{successfulSamples} accepted sample(s)</span><span>Observed {new Date(currentSample.observedAtMs).toLocaleTimeString()}</span></div>
      </header>

      <fieldset className="provider-selector provider-selector--detail"><legend>Books shown in this comparison</legend>
        {effectiveBooks.map((book) => <label className={book.connected ? undefined : "provider-selector__unavailable"} key={book.provider}>
          <input aria-label={`${book.provider} ${!book.connected ? "not connected" : book.hasExactEvent ? "available for this match" : "no exact event match"}`}
            checked={book.connected && selectedProviders.has(book.provider)} disabled={!book.connected} onChange={() => setSelectedProviders((current) => {
            const next = new Set(current);
            if (next.has(book.provider)) next.delete(book.provider); else next.add(book.provider);
            return next;
          })} type="checkbox" /><ProviderBrand compact provider={book.provider} /><small>{!book.connected ? "not connected" : book.hasExactEvent ? "matched" : "event not found"}</small>
        </label>)}
      </fieldset>
      <p className="watch-latency-note">{currentComparison !== undefined && currentComparison.providers.filter((provider) => selectedProviders.has(provider)).length > 1
        ? `Comparing ${currentComparison.providers.filter((provider) => selectedProviders.has(provider)).join(" vs ")}`
        : `Cross-book comparison unavailable — ${effectiveBooks.filter((book) => book.connected && selectedProviders.has(book.provider) && !book.hasExactEvent)
          .map((book) => `${book.provider}: no exact event match`).join("; ") || "only one selected provider has this exact event"}`}</p>
      <div className="watch-controls">
        {watching ? <button onClick={() => setWatching(false)} type="button">Stop watching</button>
          : <button onClick={() => setWatching(true)} type="button">Resume watching</button>}
      </div>

      {currentComparison !== undefined && event !== null && visibleRankedTickets.length > 0 && <section className="watch-ranked-tickets"
        aria-label="Exact ranked tickets">
        <h2>Top exact two-book tickets</h2>
        {highlightTicketKey !== null && !rankedTickets.some((ticket) => ticket.key === highlightTicketKey) &&
          <p className="connection-warning" role="status">The exact ticket expired before it could be opened.</p>}
        <RankedTicketTable event={event} providers={selectedTicketProviders}
          compact tickets={visibleRankedTickets} highlightTicketKey={highlightTicketKey} stakePolicy={stakePolicy}
          onOpenProviderTicket={onOpenProviderTicket} providerCatalogEvidence={providerCatalogEvidence}
          realtimeCheckApi={ticketRealtimeCheckApi} ticketReportApi={ticketReportApi} />
      </section>}

      <div className="match-watch__layout">
        <section className="watch-prices watch-prices--compact-grid" aria-labelledby="current-prices-heading">
          {currentComparison !== undefined && effectiveBooks.some((book) => book.connected && selectedProviders.has(book.provider))
            ? <CompactComparisonGrid comparison={currentComparison} lagSignals={lagSignals}
              selectedProviders={selectedProviders} stakePolicy={stakePolicy} /> : <><h2 id="current-prices-heading">Vé chấp 2 cửa giữa các sàn</h2>
            <div className="provider-columns">
            <article className="provider-column">
              <header><strong>{initialCatalog.provider} live feed</strong><span>Read-only</span></header>
              {currentSample.markets.length === 0 ? <p>No accepted markets for this event.</p> : currentSample.markets.map((market) => {
                const quotes = currentSample.quotes.filter((quote) => quote.providerMarketId === market.providerMarketId);
                return <section className={`watch-market watch-market--${market.status.toLowerCase()}`} key={market.providerMarketId}>
                  <header><strong>{market.marketType}</strong><span>Line {market.line ?? "—"}</span><span>{market.status}</span></header>
                  <div className="watch-quote-grid">{quotes.map((quote) => <div className={`watch-quote watch-quote--${quote.status.toLowerCase()}`} key={quote.providerSelectionId}>
                    <span>{quote.selection}</span><strong>{formatDisplayDecimal(quote.rawOdds)}</strong><small>{quote.rawFormat} · {quote.status}</small>
                  </div>)}</div>
                </section>;
              })}
            </article>
            <article className="provider-column provider-column--empty"><strong>Awaiting verified second provider</strong>
              <p>No values are copied or estimated. Exact event and market mapping is required.</p></article>
          </div></>}
        </section>

      </div>
    </section>
  );
}
