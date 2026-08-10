import { useEffect, useMemo, useRef, useState } from "react";
import type { AccountStatus, ProviderId } from "@tool-chenh/contracts";
import { AccountApi, type AccountApiLike } from "../api/accounts.js";
import { CatalogApi, type CatalogApiLike, type LiveCatalogResponse } from "../api/catalog.js";
import { buildComparisonEvents, estimatedLiveStartAtMs, formatCountdown, formatMatchClock,
  type ComparisonEvent } from "../catalog/comparison.js";
import { MatchWatchDetail, type ComparisonBook } from "../components/match-watch-detail.js";
import { buildFixedBaseStakePlan, type FixedBaseStakePolicy } from "../watch/fixed-base-stake.js";
import { loadBaseStake, saveBaseStake } from "../watch/stake-settings.js";

const defaultAccountApi = new AccountApi();
const defaultCatalogApi = new CatalogApi();
const comparisonProviders: readonly ProviderId[] = ["SABA", "SBOBET", "CMD", "APSPORT", "BTI"];

function ProviderSelector({ accounts, selected, toggle }: {
  readonly accounts: readonly AccountStatus[];
  readonly selected: ReadonlySet<string>;
  readonly toggle: (id: string) => void;
}) {
  return <fieldset className="provider-selector"><legend>Books to compare</legend>{comparisonProviders.flatMap((provider) => {
    const providerAccounts = accounts.filter((account) => account.provider === provider);
    if (providerAccounts.length === 0) return [<label className="provider-selector__unavailable" key={provider}>
      <input aria-label={`${provider} unavailable`} disabled type="checkbox" /><b>#{provider}</b><small>not connected</small></label>];
    return providerAccounts.map((account) => <label key={account.id}><input checked={selected.has(account.id)}
      onChange={() => toggle(account.id)} type="checkbox" /><span>{account.alias}</span><b>#{account.provider}</b></label>);
  })}</fieldset>;
}

function stakePolicy(baseStake: string): FixedBaseStakePolicy {
  return { currency: "VND", baseStake, minStake: "30000", maxStake: baseStake,
    stakeStep: "1000", balance: baseStake };
}

function money(value: string): string {
  return `${Number(value).toLocaleString("en-US")} VND`;
}

function ComparisonTable({ item, baseStake }: { readonly item: ComparisonEvent; readonly baseStake: string }) {
  const selectedProviders = new Set<ProviderId>(item.providers);
  return <div className="table-wrap comparison-table"><table><thead><tr><th>Market / line</th>
    {item.providers.map((provider) => <th key={provider}>{provider}</th>)}<th>Gross preflight</th></tr></thead><tbody>
    {item.rows.map((row) => {
      const plan = buildFixedBaseStakePlan(row, selectedProviders, stakePolicy(baseStake));
      return <tr key={row.key}><th>{row.marketType}<small>{row.line === null ? "" : `Line ${row.line}`}</small>
      {row.margin !== null && <b className={row.margin > 0 ? "edge-badge edge-badge--positive" : "edge-badge"}>
        {row.margin > 0 ? `Edge +${(row.margin * 100).toFixed(2)}%` : `No edge ${(row.margin * 100).toFixed(2)}%`}</b>}</th>
      {item.providers.map((provider) => {
        const cell = row.cells.find((candidate) => candidate.provider === provider);
        return <td key={provider}>{cell === undefined ? <span className="rate-missing">Unavailable</span> :
          <div className="rate-cell">{cell.quotes.map((quote) => <span
            className={row.bestBySelection[quote.selection] === provider ? "rate-quote rate-quote--best" : "rate-quote"}
            key={quote.providerSelectionId}>{quote.selection} {quote.rawOdds}</span>)}</div>}</td>;
      })}<td>{plan === null ? <span className="rate-missing">No profitable two-book balance</span>
        : <div className="balanced-plan"><strong>PROFITABLE</strong>{plan.legs.map((leg) => <span key={leg.selection}>
          <small>#{leg.provider} · {leg.selection} @ {leg.decimalOdds}</small><b>{money(leg.stake)} {leg.role.toLowerCase()}</b>
        </span>)}<span>Total {money(plan.totalStake)}</span>{plan.legs.map((leg) => <span key={`${leg.selection}-profit`}>
          <small>{leg.selection}</small><b>Profit {money(leg.profit)}</b></span>)}
          <b>Worst {money(plan.worstCaseProfit)} · ROI {(Number(plan.roi) * 100).toFixed(2)}%</b></div>}</td></tr>;
    })}
  </tbody></table></div>;
}

export function LiveCatalogPage({ accountApi = defaultAccountApi, catalogApi = defaultCatalogApi }: {
  readonly accountApi?: AccountApiLike;
  readonly catalogApi?: CatalogApiLike;
}) {
  const [accounts, setAccounts] = useState<readonly AccountStatus[]>([]);
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(new Set());
  const [category, setCategory] = useState<"FOOTBALL" | "LOL">("FOOTBALL");
  const [catalogs, setCatalogs] = useState<readonly LiveCatalogResponse[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(Date.now());
  const [baseStake, setBaseStake] = useState(() => loadBaseStake(window.localStorage));
  const [baseStakeInput, setBaseStakeInput] = useState(baseStake);
  const [stakeError, setStakeError] = useState<string | null>(null);
  const requested = useRef({ account: new URLSearchParams(window.location.search).get("account"),
    event: new URLSearchParams(window.location.search).get("event") });
  const autoLoaded = useRef(false);

  const loadIds = async (ids: readonly string[]): Promise<void> => {
    if (ids.length === 0) return;
    setBusy(true); setMessage(null);
    const results = await Promise.allSettled(ids.map(async (id) => catalogApi.read(id)));
    const accepted = results.flatMap((result) => result.status === "fulfilled" ? [result.value] : []);
    setCatalogs(accepted);
    const failed = results.length - accepted.length;
    if (accepted.length === 0) setMessage("Live catalog is unavailable. No selected provider returned a verified catalog.");
    else if (failed > 0) setMessage(`${failed} selected provider(s) unavailable; available books are still shown.`);
    setBusy(false);
  };

  useEffect(() => {
    void accountApi.list().then((items) => {
      const available = items.filter((account) => account.capabilities.includes("CATALOG") && account.sessionState === "ACTIVE");
      const initial = new Set(available.map((account) => account.id));
      setAccounts(available); setSelectedIds(initial);
      if (!autoLoaded.current && available.length > 0) {
        autoLoaded.current = true;
        void loadIds([...initial]);
      }
    }).catch(() => setMessage("Provider accounts are unavailable."));
  }, [accountApi]);

  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);

  const events = useMemo(() => buildComparisonEvents(catalogs), [catalogs]);
  const displayEvents = useMemo(() => [...events].sort((left, right) => {
    const edge = (right.bestMargin ?? Number.NEGATIVE_INFINITY) - (left.bestMargin ?? Number.NEGATIVE_INFINITY);
    if (edge !== 0) return edge;
    if (left.event.isLive !== right.event.isLive) return left.event.isLive ? 1 : -1;
    return left.event.startAtUtcMs - right.event.startAtUtcMs;
  }), [events]);
  useEffect(() => {
    if (requested.current.event === null || events.length === 0 || selectedKey !== null) return;
    const match = events.find((item) => Object.values(item.providerEventIds).includes(requested.current.event!));
    if (match !== undefined) setSelectedKey(match.key);
    else setMessage("The selected event is no longer present in the accepted live catalog.");
  }, [events, selectedKey]);

  const selectedEvent = events.find((item) => item.key === selectedKey);
  if (selectedEvent !== undefined) {
    const primary = selectedEvent.catalogs[0]!;
    const detailBooks: readonly ComparisonBook[] = comparisonProviders.map((provider) => {
      const providerAccounts = accounts.filter((account) => account.provider === provider);
      return { provider, connected: providerAccounts.length > 0,
        selected: providerAccounts.some((account) => selectedIds.has(account.id)),
        hasExactEvent: selectedEvent.providers.includes(provider) };
    });
    return <MatchWatchDetail accountId={primary.accountId} catalogApi={catalogApi} initialCatalog={primary}
      baseStake={baseStake} books={detailBooks} comparisonCatalogs={catalogs} comparisonEvent={selectedEvent}
      onBack={() => { window.history.replaceState({}, "", window.location.pathname); setSelectedKey(null); }}
      providerEventId={selectedEvent.providerEventIds[primary.provider]!} />;
  }

  const toggle = (id: string): void => setSelectedIds((current) => {
    const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next;
  });
  const changeCategory = (next: "FOOTBALL" | "LOL"): void => {
    setCategory(next); setCatalogs([]); setMessage(null); setSelectedKey(null);
    if (next === "FOOTBALL") void loadIds([...selectedIds]);
  };
  const watch = (item: ComparisonEvent): void => {
    const primary = item.catalogs[0]!;
    const eventId = item.providerEventIds[primary.provider]!;
    const query = new URLSearchParams(); query.set("event", eventId); query.set("account", primary.accountId);
    window.history.replaceState({}, "", `${window.location.pathname}?${query.toString()}`); setSelectedKey(item.key);
  };

  return <>
    <header className="page-header"><p className="eyebrow">Verified provider comparison</p><h1>Live Catalog</h1>
      <p>Select the books to compare. Every row is the same mapped market and line.</p></header>
    <section className="catalog-toolbar" aria-label="Catalog controls">
      <div className="category-switch" role="group" aria-label="Category"><button aria-pressed={category === "FOOTBALL"}
        onClick={() => changeCategory("FOOTBALL")} type="button">Football</button><button aria-pressed={category === "LOL"}
        onClick={() => changeCategory("LOL")} type="button">LoL</button></div>
      <ProviderSelector accounts={accounts} selected={selectedIds} toggle={toggle} />
      <label className="stake-config">Base stake for every match (VND)<input aria-label="Base stake for every match (VND)"
        inputMode="numeric" min="30000" step="1000" type="number" value={baseStakeInput} onChange={(event) => {
          const value = event.currentTarget.value; setBaseStakeInput(value);
          if (saveBaseStake(window.localStorage, value)) { setBaseStake(value); setStakeError(null); }
          else setStakeError("Use a whole VND amount of at least 30,000 in 1,000 VND steps.");
        }} />{stakeError === null ? <small>Applied to the lower-odds leg.</small> : <small role="alert">{stakeError}</small>}</label>
      <button aria-label="Load live catalog" disabled={busy || selectedIds.size === 0 || category !== "FOOTBALL"} onClick={() => void loadIds([...selectedIds])} type="button">
        {busy ? "Loading…" : "Compare selected books"}</button>
    </section>
    {category === "LOL" && <p className="stale-warning">No verified live LoL adapter is connected yet.</p>}
    {message !== null && <p className="connection-warning session-message" role="status">{message}</p>}
    {category === "FOOTBALL" && catalogs.length > 0 && <div className="catalog-evidence-bar"><strong>LIVE READ-ONLY</strong>
      <span>{catalogs.length} connected provider(s)</span><span>{events.filter((item) => item.providers.length > 1).length} cross-book match(es)</span></div>}
    <div className="catalog-event-list">{displayEvents.map((item) => {
      const label = `${item.event.participantA} vs ${item.event.participantB}`;
      const observedAtMs = item.catalogs.find((catalog) => catalog.provider === item.event.provider)?.observedAtMs ??
        item.catalogs[0]!.observedAtMs;
      const estimatedStartAtMs = estimatedLiveStartAtMs(observedAtMs, item.event.liveState);
      return <article className="catalog-event" key={item.key}><header><div><span>{item.event.competition}</span><h2>{label}</h2>
        <div className="provider-tags">{item.providers.map((provider) => <b key={provider}>#{provider}</b>)}
          {item.event.category === "FOOTBALL" && item.event.isVirtual === true && <b>#VIRTUAL</b>}</div>
        {item.bestMargin !== null && item.bestMargin > 0 && <strong className="event-edge">Best edge +{(item.bestMargin * 100).toFixed(2)}%</strong>}</div>
        <div className="catalog-event-actions"><strong>{item.event.isLive ? formatMatchClock(item.event.liveState) : formatCountdown(item.event.startAtUtcMs, nowMs)}</strong>
          {item.event.isLive ? <><small>Observed {new Date(observedAtMs).toLocaleString()}</small>
            {estimatedStartAtMs !== null && <small>Approx. started {new Date(estimatedStartAtMs).toLocaleString()}</small>}</>
            : <small>Scheduled {new Date(item.event.startAtUtcMs).toLocaleString()}</small>}
          <button aria-label={`View & watch ${label}`} onClick={() => watch(item)} type="button">View & compare</button></div></header>
        {item.rows.length === 0 ? <p>No supported two-way market in this provider row.</p> : <ComparisonTable item={item} baseStake={baseStake} />}</article>;
    })}</div>
  </>;
}
