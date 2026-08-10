import { useEffect, useMemo, useRef, useState } from "react";
import type { CatalogApiLike, LiveCatalogResponse } from "../api/catalog.js";
import {
  boundWatchEntries,
  diffMatchSamples,
  sampleMatch,
  type MatchSample,
  type MatchWatchEntry
} from "../watch/match-watch.js";
import { clearWatchEntries, loadWatchEntries, saveWatchEntries } from "../watch/watch-storage.js";
import {
  buildComparisonEvents,
  estimatedLiveStartAtMs,
  formatCountdown,
  formatMatchClock,
  type ComparisonEvent
} from "../catalog/comparison.js";
import type { ProviderId } from "@tool-chenh/contracts";
import { buildArbitrageAlert } from "../watch/arbitrage-alert.js";
import { ArbitrageAlertToast } from "./arbitrage-alert-toast.js";
import { buildFixedBaseStakePlan, type FixedBaseStakePolicy } from "../watch/fixed-base-stake.js";

type WatcherState = "WATCHING" | "STALE" | "ERROR" | "STOPPED";
const systemClock = (): number => Date.now();

export interface ComparisonBook {
  readonly provider: ProviderId;
  readonly connected: boolean;
  readonly selected: boolean;
  readonly hasExactEvent: boolean;
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

function entryLabel(entry: MatchWatchEntry): string {
  if (entry.kind === "POLL_FAILED") return "Provider catalog read failed";
  if (entry.kind === "STALE") return entry.currentValue ?? "Provider sample is stale";
  if (entry.kind === "EVENT_MISSING") return "Event disappeared from the accepted catalog";
  return `${entry.previousValue ?? "—"} → ${entry.currentValue ?? "—"}`;
}

export function MatchWatchDetail({
  accountId,
  catalogApi,
  initialCatalog,
  comparisonEvent,
  comparisonCatalogs,
  books,
  onBack,
  providerEventId,
  pollDelayMs = 1_000,
  staleAfterMs = 10_000,
  baseStake = "100000",
  storage = window.localStorage,
  clock = systemClock
}: {
  readonly accountId: string;
  readonly catalogApi: CatalogApiLike;
  readonly initialCatalog: LiveCatalogResponse;
  readonly comparisonEvent?: ComparisonEvent;
  readonly comparisonCatalogs?: readonly LiveCatalogResponse[];
  readonly books?: readonly ComparisonBook[];
  readonly onBack: () => void;
  readonly providerEventId: string;
  readonly pollDelayMs?: number;
  readonly staleAfterMs?: number;
  readonly baseStake?: string;
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
  const visibleBooks = books ?? (comparisonEvent?.providers ?? [initialCatalog.provider]).map((provider) => ({
    provider, connected: true, selected: true, hasExactEvent: true
  }));
  const effectiveBooks = visibleBooks.map((book) => ({ ...book,
    hasExactEvent: currentComparison?.providers.includes(book.provider) ?? book.hasExactEvent }));
  const catalogSources = useMemo(() => comparisonCatalogs ?? comparisonEvent?.catalogs ?? [initialCatalog],
    [comparisonCatalogs, comparisonEvent, initialCatalog]);
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

  const appendEntries = (newEntries: readonly MatchWatchEntry[]): void => {
    if (newEntries.length === 0) return;
    setEntries((current) => {
      const next = boundWatchEntries([...current, ...newEntries]);
      saveWatchEntries(storage, initialCatalog.provider, providerEventId, next);
      return next;
    });
  };

  useEffect(() => {
    if (!watching) {
      setWatcherState("STOPPED");
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
  }, [accountId, catalogApi, catalogSources, clock, initialCatalog.provider, pollDelayMs, providerEventId, staleAfterMs, storage, watching]);

  const event = currentSample.event ?? initialSample.event;
  const matchLabel = event === null ? "Selected event unavailable" : `${event.participantA} vs ${event.participantB}`;
  const estimatedStartAtMs = event?.isLive
    ? estimatedLiveStartAtMs(currentSample.observedAtMs, event.liveState)
    : null;
  const stakePolicy: FixedBaseStakePolicy = { currency: "VND", baseStake, minStake: "30000",
    maxStake: baseStake, stakeStep: "1000", balance: baseStake };
  const currentAlert = useMemo(() => {
    const observationAgeMs = clock() - currentSample.observedAtMs;
    if (!watching || watcherState !== "WATCHING" || currentComparison === undefined ||
      observationAgeMs < 0 || observationAgeMs > staleAfterMs) return null;
    return currentComparison.rows
      .map((row) => buildArbitrageAlert(row, selectedProviders, stakePolicy))
      .filter((alert) => alert !== null)
      .sort((left, right) => Number(right.roi) - Number(left.roi) ||
        Number(right.worstCaseProfit) - Number(left.worstCaseProfit))[0] ?? null;
  }, [baseStake, clock, currentComparison, currentSample.observedAtMs, selectedProviders, staleAfterMs, watcherState, watching]);
  const newestEntries = [...entries].reverse();
  const clearLog = (): void => {
    clearWatchEntries(storage, initialCatalog.provider, providerEventId);
    setEntries([]);
  };

  return (
    <section className="match-watch" aria-label={`Watching ${matchLabel}`}>
      <ArbitrageAlertToast alert={currentAlert} matchLabel={matchLabel} />
      <button className="watch-back" onClick={onBack} type="button">Back to matches</button>
      <header className="match-watch__header">
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
          })} type="checkbox" /><b>#{book.provider}</b><small>{!book.connected ? "not connected" : book.hasExactEvent ? "matched" : "event not found"}</small>
        </label>)}
      </fieldset>
      <p className="watch-latency-note">{currentComparison !== undefined && currentComparison.providers.filter((provider) => selectedProviders.has(provider)).length > 1
        ? `Comparing ${currentComparison.providers.filter((provider) => selectedProviders.has(provider)).join(" vs ")}`
        : `Cross-book comparison unavailable — ${effectiveBooks.filter((book) => book.connected && selectedProviders.has(book.provider) && !book.hasExactEvent)
          .map((book) => `${book.provider}: no exact event match`).join("; ") || "only one selected provider has this exact event"}`}</p>
      <div className="watch-controls">
        {watching ? <button onClick={() => setWatching(false)} type="button">Stop watching</button>
          : <button onClick={() => setWatching(true)} type="button">Resume watching</button>}
        <button onClick={clearLog} type="button">Clear log</button>
      </div>

      <div className="match-watch__layout">
        <section className="watch-prices" aria-labelledby="current-prices-heading">
          <h2 id="current-prices-heading">Current markets</h2>
          {currentComparison !== undefined && effectiveBooks.some((book) => book.connected && selectedProviders.has(book.provider)) ? <div className="table-wrap comparison-table"><table>
            <thead><tr><th>Market / line</th>{effectiveBooks.filter((book) => book.connected && selectedProviders.has(book.provider)).map((book) => <th key={book.provider}>{book.provider}<small>{book.hasExactEvent ? "exact match" : "event not found"}</small></th>)}<th>Gross preflight</th></tr></thead>
            <tbody>{currentComparison.rows.map((row) => {
              const plan = buildFixedBaseStakePlan(row, selectedProviders, stakePolicy);
              const money = (value: string): string => `${Number(value).toLocaleString("en-US")} VND`;
              return <tr key={row.key}><th>{row.marketType}<small>{row.line === null ? "" : `Line ${row.line}`}</small>
              {row.margin !== null && <b className={row.margin > 0 ? "edge-badge edge-badge--positive" : "edge-badge"}>
                {row.margin > 0 ? `Edge +${(row.margin * 100).toFixed(2)}%` : `No edge ${(row.margin * 100).toFixed(2)}%`}</b>}</th>
              {effectiveBooks.filter((book) => book.connected && selectedProviders.has(book.provider)).map((book) => {
                const cell = row.cells.find((candidate) => candidate.provider === book.provider);
                return <td key={book.provider}>{cell === undefined ? <span className="rate-missing">{book.hasExactEvent ? "Market unavailable" : "No exact event match"}</span> : <div className="rate-cell">{cell.quotes.map((quote) => <span
                  className={row.bestBySelection[quote.selection] === book.provider ? "rate-quote rate-quote--best" : "rate-quote"}
                  key={quote.providerSelectionId}>{quote.selection} {quote.rawOdds}</span>)}</div>}</td>;
              })}<td aria-label={`Gross preflight ${row.marketType}${row.line === null ? "" : ` line ${row.line}`}`}>
                {plan === null ? <span className="rate-missing">No profitable two-book balance</span> : <div className="balanced-plan">
                  <strong>PROFITABLE</strong>{plan.legs.map((leg) => <span key={leg.selection}><small>#{leg.provider} · {leg.selection} @ {leg.decimalOdds}</small>
                    <b>{money(leg.stake)} {leg.role.toLowerCase()}</b><b>Profit {money(leg.profit)}</b></span>)}
                  <span>Total {money(plan.totalStake)}</span><b>Worst {money(plan.worstCaseProfit)} · ROI {(Number(plan.roi) * 100).toFixed(2)}%</b>
                </div>}</td></tr>;
            })}</tbody></table></div> : <div className="provider-columns">
            <article className="provider-column">
              <header><strong>{initialCatalog.provider} live feed</strong><span>Read-only</span></header>
              {currentSample.markets.length === 0 ? <p>No accepted markets for this event.</p> : currentSample.markets.map((market) => {
                const quotes = currentSample.quotes.filter((quote) => quote.providerMarketId === market.providerMarketId);
                return <section className={`watch-market watch-market--${market.status.toLowerCase()}`} key={market.providerMarketId}>
                  <header><strong>{market.marketType}</strong><span>Line {market.line ?? "—"}</span><span>{market.status}</span></header>
                  <div className="watch-quote-grid">{quotes.map((quote) => <div className={`watch-quote watch-quote--${quote.status.toLowerCase()}`} key={quote.providerSelectionId}>
                    <span>{quote.selection}</span><strong>{quote.rawOdds}</strong><small>{quote.rawFormat} · {quote.status}</small>
                  </div>)}</div>
                </section>;
              })}
            </article>
            <article className="provider-column provider-column--empty"><strong>Awaiting verified second provider</strong>
              <p>No values are copied or estimated. Exact event and market mapping is required.</p></article>
          </div>}
        </section>

        <section className="watch-timeline" aria-labelledby="change-log-heading">
          <header><div><h2 id="change-log-heading">Change log</h2><p>Newest first · maximum 200 rows</p></div></header>
          <div aria-live="polite">{newestEntries.length === 0 ? <p className="empty-state">No changes detected yet.</p> : <ol>
            {newestEntries.map((entry) => <li className={`watch-entry watch-entry--${entry.kind.toLowerCase()}`} key={entry.id}>
              <div><strong>#{entry.provider} · {entry.kind.replaceAll("_", " ")}</strong><time dateTime={new Date(entry.detectedAtMs).toISOString()}>{new Date(entry.detectedAtMs).toLocaleTimeString()}</time></div>
              <p>{entry.marketType ?? "Event"}{entry.line === null ? "" : ` · line ${entry.line}`}{entry.selection === null ? "" : ` · ${entry.selection}`}</p>
              <b>{entryLabel(entry)}</b><small>Provider sample interval: {entry.sampleIntervalMs} ms</small>
            </li>)}
          </ol>}</div>
        </section>
      </div>
    </section>
  );
}
