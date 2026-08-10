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
import type { ComparisonEvent } from "../catalog/comparison.js";

type WatcherState = "WATCHING" | "STALE" | "ERROR" | "STOPPED";
const systemClock = (): number => Date.now();

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
  onBack,
  providerEventId,
  pollDelayMs = 1_000,
  staleAfterMs = 10_000,
  storage = window.localStorage,
  clock = systemClock
}: {
  readonly accountId: string;
  readonly catalogApi: CatalogApiLike;
  readonly initialCatalog: LiveCatalogResponse;
  readonly comparisonEvent?: ComparisonEvent;
  readonly onBack: () => void;
  readonly providerEventId: string;
  readonly pollDelayMs?: number;
  readonly staleAfterMs?: number;
  readonly storage?: Storage;
  readonly clock?: () => number;
}) {
  const initialSample = useMemo(() => sampleMatch(initialCatalog, providerEventId), [initialCatalog, providerEventId]);
  const [currentSample, setCurrentSample] = useState(initialSample);
  const sampleRef = useRef(initialSample);
  const [entries, setEntries] = useState<readonly MatchWatchEntry[]>(() =>
    loadWatchEntries(storage, initialCatalog.provider, providerEventId));
  const [watching, setWatching] = useState(true);
  const [watcherState, setWatcherState] = useState<WatcherState>("WATCHING");
  const [successfulSamples, setSuccessfulSamples] = useState(1);
  const [selectedProviders, setSelectedProviders] = useState<ReadonlySet<string>>(() =>
    new Set(comparisonEvent?.providers ?? [initialCatalog.provider]));

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
        const catalog = await catalogApi.read(accountId);
        if (!active) return;
        const nextSample = sampleMatch(catalog, providerEventId);
        appendEntries(diffMatchSamples(sampleRef.current, nextSample, clock()));
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
  }, [accountId, catalogApi, clock, initialCatalog.provider, pollDelayMs, providerEventId, staleAfterMs, storage, watching]);

  const event = currentSample.event ?? initialSample.event;
  const matchLabel = event === null ? "Selected event unavailable" : `${event.participantA} vs ${event.participantB}`;
  const newestEntries = [...entries].reverse();
  const clearLog = (): void => {
    clearWatchEntries(storage, initialCatalog.provider, providerEventId);
    setEntries([]);
  };

  return (
    <section className="match-watch" aria-label={`Watching ${matchLabel}`}>
      <button className="watch-back" onClick={onBack} type="button">Back to matches</button>
      <header className="match-watch__header">
        <div><p className="eyebrow">{event?.competition ?? "Provider event"}</p><h1>{matchLabel}</h1>
          <p>{event?.isLive ? "Live now" : event === null ? "Event unavailable" : new Date(event.startAtUtcMs).toLocaleString()}</p></div>
        <div className="watch-health"><span className={`watch-state watch-state--${watcherState.toLowerCase()}`}>{watcherState}</span>
          <span>{successfulSamples} accepted sample(s)</span><span>Observed {new Date(currentSample.observedAtMs).toLocaleTimeString()}</span></div>
      </header>

      <fieldset className="provider-selector provider-selector--detail"><legend>Books shown in this comparison</legend>
        {(comparisonEvent?.providers ?? [initialCatalog.provider]).map((provider) => <label key={provider}>
          <input checked={selectedProviders.has(provider)} onChange={() => setSelectedProviders((current) => {
            const next = new Set(current);
            if (next.has(provider)) next.delete(provider); else next.add(provider);
            return next;
          })} type="checkbox" /><b>#{provider}</b>
        </label>)}
      </fieldset>
      <p className="watch-latency-note">{comparisonEvent !== undefined && comparisonEvent.providers.length > 1
        ? `Comparing ${comparisonEvent.providers.filter((provider) => selectedProviders.has(provider)).join(" vs ")}`
        : "Single-provider observation — cross-book timing unavailable"}</p>
      <div className="watch-controls">
        {watching ? <button onClick={() => setWatching(false)} type="button">Stop watching</button>
          : <button onClick={() => setWatching(true)} type="button">Resume watching</button>}
        <button onClick={clearLog} type="button">Clear log</button>
      </div>

      <div className="match-watch__layout">
        <section className="watch-prices" aria-labelledby="current-prices-heading">
          <h2 id="current-prices-heading">Current markets</h2>
          {comparisonEvent !== undefined && comparisonEvent.providers.length > 1 ? <div className="table-wrap comparison-table"><table>
            <thead><tr><th>Market / line</th>{comparisonEvent.providers.filter((provider) => selectedProviders.has(provider)).map((provider) => <th key={provider}>{provider}</th>)}</tr></thead>
            <tbody>{comparisonEvent.rows.map((row) => <tr key={row.key}><th>{row.marketType}<small>{row.line === null ? "" : `Line ${row.line}`}</small>
              {row.margin !== null && <b className={row.margin > 0 ? "edge-badge edge-badge--positive" : "edge-badge"}>
                {row.margin > 0 ? `Edge +${(row.margin * 100).toFixed(2)}%` : `No edge ${(row.margin * 100).toFixed(2)}%`}</b>}</th>
              {comparisonEvent.providers.filter((provider) => selectedProviders.has(provider)).map((provider) => {
                const cell = row.cells.find((candidate) => candidate.provider === provider);
                return <td key={provider}>{cell === undefined ? <span className="rate-missing">Unavailable</span> : <div className="rate-cell">{cell.quotes.map((quote) => <span
                  className={row.bestBySelection[quote.selection] === provider ? "rate-quote rate-quote--best" : "rate-quote"}
                  key={quote.providerSelectionId}>{quote.selection} {quote.rawOdds}</span>)}</div>}</td>;
              })}</tr>)}</tbody></table></div> : <div className="provider-columns">
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
              <div><strong>{entry.kind.replaceAll("_", " ")}</strong><time dateTime={new Date(entry.detectedAtMs).toISOString()}>{new Date(entry.detectedAtMs).toLocaleTimeString()}</time></div>
              <p>{entry.marketType ?? "Event"}{entry.line === null ? "" : ` · line ${entry.line}`}{entry.selection === null ? "" : ` · ${entry.selection}`}</p>
              <b>{entryLabel(entry)}</b><small>Provider sample interval: {entry.sampleIntervalMs} ms</small>
            </li>)}
          </ol>}</div>
        </section>
      </div>
    </section>
  );
}
