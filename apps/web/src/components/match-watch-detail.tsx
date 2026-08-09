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

type WatcherState = "WATCHING" | "ERROR" | "STOPPED";
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

function entryLabel(entry: MatchWatchEntry): string {
  if (entry.kind === "POLL_FAILED") return "Provider catalog read failed";
  if (entry.kind === "EVENT_MISSING") return "Event disappeared from the accepted catalog";
  return `${entry.previousValue ?? "—"} → ${entry.currentValue ?? "—"}`;
}

export function MatchWatchDetail({
  accountId,
  catalogApi,
  initialCatalog,
  onBack,
  providerEventId,
  pollDelayMs = 1_000,
  storage = window.localStorage,
  clock = systemClock
}: {
  readonly accountId: string;
  readonly catalogApi: CatalogApiLike;
  readonly initialCatalog: LiveCatalogResponse;
  readonly onBack: () => void;
  readonly providerEventId: string;
  readonly pollDelayMs?: number;
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
        setWatcherState("WATCHING");
      } catch {
        if (!active) return;
        appendEntries([safeFailureEntry(sampleRef.current, clock())]);
        setWatcherState("ERROR");
      } finally {
        schedule();
      }
    };
    setWatcherState("WATCHING");
    schedule();
    return () => {
      active = false;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [accountId, catalogApi, clock, initialCatalog.provider, pollDelayMs, providerEventId, storage, watching]);

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

      <p className="watch-latency-note">Single-provider observation — cross-book timing unavailable</p>
      <div className="watch-controls">
        {watching ? <button onClick={() => setWatching(false)} type="button">Stop watching</button>
          : <button onClick={() => setWatching(true)} type="button">Resume watching</button>}
        <button onClick={clearLog} type="button">Clear log</button>
      </div>

      <div className="match-watch__layout">
        <section className="watch-prices" aria-labelledby="current-prices-heading">
          <h2 id="current-prices-heading">Current markets</h2>
          <div className="provider-columns">
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
          </div>
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
