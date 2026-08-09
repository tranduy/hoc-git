import { useEffect, useMemo, useRef, useState } from "react";
import type { AccountStatus } from "@tool-chenh/contracts";
import { AccountApi, type AccountApiLike } from "../api/accounts.js";
import { CatalogApi, type CatalogApiLike, type LiveCatalogResponse } from "../api/catalog.js";
import { MatchWatchDetail } from "../components/match-watch-detail.js";

const defaultAccountApi = new AccountApi();
const defaultCatalogApi = new CatalogApi();

function displayTime(timestamp: number, live: boolean): string {
  return live ? "Live now" : new Date(timestamp).toLocaleString();
}

export function LiveCatalogPage({
  accountApi = defaultAccountApi,
  catalogApi = defaultCatalogApi
}: {
  readonly accountApi?: AccountApiLike;
  readonly catalogApi?: CatalogApiLike;
}) {
  const [accounts, setAccounts] = useState<readonly AccountStatus[]>([]);
  const [accountId, setAccountId] = useState("");
  const [category, setCategory] = useState<"FOOTBALL" | "LOL">("FOOTBALL");
  const [catalog, setCatalog] = useState<LiveCatalogResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const requestedSelection = useRef({
    accountId: new URLSearchParams(window.location.search).get("account"),
    eventId: new URLSearchParams(window.location.search).get("event")
  });
  const lastAutoLoadedAccount = useRef<string | null>(null);

  useEffect(() => {
    void accountApi.list().then((items) => {
      const available = items.filter((account) => account.capabilities.includes("CATALOG"));
      setAccounts(available);
      setAccountId((current) => current || available.find((account) => account.id === requestedSelection.current.accountId)?.id || available[0]?.id || "");
    }).catch(() => setMessage("Provider accounts are unavailable."));
  }, [accountApi]);

  useEffect(() => {
    const requested = requestedSelection.current;
    if (accountId.length === 0 || lastAutoLoadedAccount.current === accountId) return;
    lastAutoLoadedAccount.current = accountId;
    setBusy(true);
    setMessage(null);
    void catalogApi.read(accountId).then((response) => {
      setCatalog(response);
      if (requested.eventId === null || (requested.accountId !== null && requested.accountId !== accountId)) return;
      if (response.events.some((event) => event.providerEventId === requested.eventId)) {
        setSelectedEventId(requested.eventId);
      } else {
        setMessage("The selected event is no longer present in the accepted live catalog.");
      }
    }).catch(() => {
      setMessage("Live catalog is unavailable. Session, provider identity, and schema must all validate first.");
    }).finally(() => setBusy(false));
  }, [accountId, catalogApi]);

  const events = useMemo(() => catalog === null ? [] : [...catalog.events].sort((left, right) => {
    if (left.isLive !== right.isLive) return left.isLive ? -1 : 1;
    return left.startAtUtcMs - right.startAtUtcMs;
  }), [catalog]);

  const load = (): void => {
    if (accountId.length === 0 || category !== "FOOTBALL") return;
    setBusy(true);
    setMessage(null);
    setCatalog(null);
    void catalogApi.read(accountId).then(setCatalog).catch(() => {
      setMessage("Live catalog is unavailable. Session, provider identity, and schema must all validate first.");
    }).finally(() => setBusy(false));
  };

  const watch = (providerEventId: string): void => {
    const query = new URLSearchParams(window.location.search);
    query.set("event", providerEventId);
    query.set("account", accountId);
    window.history.replaceState({}, "", `${window.location.pathname}?${query.toString()}`);
    setSelectedEventId(providerEventId);
  };
  const backToMatches = (): void => {
    window.history.replaceState({}, "", window.location.pathname);
    setSelectedEventId(null);
  };

  if (catalog !== null && selectedEventId !== null) {
    return <MatchWatchDetail accountId={accountId} catalogApi={catalogApi} initialCatalog={catalog}
      onBack={backToMatches} providerEventId={selectedEventId} />;
  }

  return (
    <>
      <header className="page-header">
        <p className="eyebrow">Read-only provider feed</p>
        <h1>Live Catalog</h1>
        <p>Real provider rows are shown here before cross-provider matching. They are not arbitrage opportunities.</p>
      </header>
      <section className="catalog-toolbar" aria-label="Catalog controls">
        <div className="category-switch" role="group" aria-label="Category">
          <button aria-pressed={category === "FOOTBALL"} onClick={() => { setCategory("FOOTBALL"); setCatalog(null); }} type="button">Football</button>
          <button aria-pressed={category === "LOL"} onClick={() => { setCategory("LOL"); setCatalog(null); }} type="button">LoL</button>
        </div>
        <label>Provider account<select value={accountId} onChange={(event) => { setAccountId(event.target.value); setCatalog(null); }}>
          {accounts.length === 0 && <option value="">No catalog-capable account</option>}
          {accounts.map((account) => <option key={account.id} value={account.id}>{account.alias} · {account.provider}</option>)}
        </select></label>
        <button disabled={busy || accountId.length === 0 || category !== "FOOTBALL"} onClick={load} type="button">{busy ? "Loading…" : "Load live catalog"}</button>
      </section>

      {category === "LOL" && <p className="stale-warning">No verified live LoL adapter is connected yet.</p>}
      {message !== null && <p className="connection-warning session-message" role="status">{message}</p>}
      {catalog !== null && (
        <>
          <div className="catalog-evidence-bar">
            <strong>LIVE · {catalog.provider}</strong>
            <span>Observed {new Date(catalog.observedAtMs).toLocaleString()}</span>
            <span className="mapping mapping--review_required">Awaiting second provider</span>
            {catalog.rejectedMarketCount > 0 && <span>{catalog.rejectedMarketCount} market(s) rejected as incomplete</span>}
          </div>
          {events.length === 0 ? <p className="empty-state">CMD returned no accepted Football events in the current view.</p> : (
            <div className="catalog-event-list">{events.map((event) => {
              const markets = catalog.markets.filter((market) => market.providerEventId === event.providerEventId);
              const matchLabel = `${event.participantA} vs ${event.participantB}`;
              return <article className="catalog-event" key={event.providerEventId}>
                <header><div><span>{event.competition}</span><h2>{matchLabel}</h2></div><div className="catalog-event-actions"><strong>{displayTime(event.startAtUtcMs, event.isLive)}</strong><button aria-label={`View & watch ${matchLabel}`} onClick={() => watch(event.providerEventId)} type="button">View & watch</button></div></header>
                {markets.length === 0 ? <p>No supported market in this provider row.</p> : <div className="table-wrap"><table><thead><tr><th>Market</th><th>Line</th><th>Status</th><th>Selections / provider odds</th></tr></thead><tbody>
                  {markets.map((market) => {
                    const quotes = catalog.quotes.filter((quote) => quote.providerMarketId === market.providerMarketId);
                    return <tr key={market.providerMarketId}><td>{market.marketType}</td><td>{market.line ?? "—"}</td><td>{market.status}</td><td>{quotes.map((quote) => (
                      <span className="catalog-quote" key={quote.providerSelectionId}>{quote.selection}: {quote.rawOdds} {quote.rawFormat}</span>
                    ))}</td></tr>;
                  })}
                </tbody></table></div>}
              </article>;
            })}</div>
          )}
        </>
      )}
    </>
  );
}
