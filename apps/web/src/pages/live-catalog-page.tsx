import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AccountStatus, ProviderId } from "@tool-chenh/contracts";
import { AccountApi, type AccountApiLike } from "../api/accounts.js";
import { CatalogApi, type CatalogApiLike, type LiveCatalogResponse } from "../api/catalog.js";
import { loadCatalogCache, saveCatalogCache } from "../catalog/catalog-cache.js";
import { buildComparisonEvents, estimatedLiveStartAtMs, formatCountdown, formatMatchClock,
  isVisibleEvent, type ComparisonEvent } from "../catalog/comparison.js";
import { MatchWatchDetail, type ComparisonBook } from "../components/match-watch-detail.js";
import { buildFixedBaseStakePlan, type FixedBaseStakePolicy } from "../watch/fixed-base-stake.js";
import { LagSignalTracker, type LagSignal } from "../watch/lag-signal-tracker.js";
import { loadBaseStake, saveBaseStake } from "../watch/stake-settings.js";

const defaultAccountApi = new AccountApi();
const defaultCatalogApi = new CatalogApi();
const comparisonProviders: readonly ProviderId[] = ["SABA", "SBOBET", "CMD", "APSPORT", "BTI"];
const catalogRefreshIntervalMs = 250;

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

function ComparisonTable({ item, baseStake, signals }: { readonly item: ComparisonEvent; readonly baseStake: string;
  readonly signals: readonly LagSignal[] }) {
  const selectedProviders = new Set<ProviderId>(item.providers);
  return <div className="table-wrap comparison-table"><table><thead><tr><th>Loại vé / kèo</th>
    {item.providers.map((provider) => <th key={provider}>{provider}</th>)}<th>Cân tiền / lợi nhuận</th></tr></thead><tbody>
    {item.observedRows.map((observedRow) => {
      const row = item.rows.find((candidate) => candidate.key === observedRow.key);
      const plan = row === undefined ? null : buildFixedBaseStakePlan(row, selectedProviders, stakePolicy(baseStake));
      const signal = signals.find((candidate) => candidate.event.key === item.key && candidate.row.key === observedRow.key);
      return <tr className={signal === undefined ? "ticket-row" : "ticket-row ticket-row--profitable"} key={observedRow.key}>
      <th>Chấp toàn trận<small>{observedRow.line === null ? "" : `Kèo ${observedRow.line}`}</small>
        <b className={signal === undefined ? "edge-badge" : "edge-badge edge-badge--positive"}>
          {signal === undefined ? "ĐANG THEO DÕI" : "ĐỦ ĐIỀU KIỆN · LÃI ≥ 20.000 VND"}</b></th>
      {item.providers.map((provider) => {
        const cell = observedRow.cells.find((candidate) => candidate.provider === provider);
        return <td key={provider}>{cell === undefined ? <span className="rate-missing">Unavailable</span> :
          <div className="rate-cell">{cell.quotes.map((quote) => <span
            className={row?.bestBySelection[quote.selection] === provider ? "rate-quote rate-quote--best" : "rate-quote"}
            key={quote.providerSelectionId}>{quote.selection} {quote.rawOdds} {quote.rawFormat} · {quote.status}</span>)}</div>}</td>;
      })}<td>{plan === null ? <span className="rate-missing">Chưa có cặp 2 sàn cân được</span>
        : <div className="balanced-plan"><strong>{signal === undefined ? "GIÁ HIỆN TẠI" : "SẴN SÀNG (READ-ONLY)"}</strong>{plan.legs.map((leg) => <span key={leg.selection}>
          <small>#{leg.provider} · {leg.selection} @ {leg.decimalOdds}</small><b>{money(leg.stake)} {leg.role.toLowerCase()}</b>
        </span>)}<span>Total {money(plan.totalStake)}</span>{plan.legs.map((leg) => <span key={`${leg.selection}-profit`}>
          <small>{leg.selection}</small><b>Profit {money(leg.profit)}</b></span>)}
          <b>Worst {money(plan.worstCaseProfit)} · ROI {(Number(plan.roi) * 100).toFixed(2)}%</b></div>}</td></tr>;
    })}
  </tbody></table></div>;
}

function SignalCard({ signal, strongest = false }: { readonly signal: LagSignal; readonly strongest?: boolean }) {
  const label = `${signal.event.event.participantA} vs ${signal.event.event.participantB}`;
  return <article className={strongest ? "lag-signal lag-signal--strongest" : "lag-signal"}>
    <header><div>{strongest && <p className="eyebrow">Best live lag signal</p>}<h2>{label}</h2>
      <p>{signal.row.marketType}{signal.row.line === null ? "" : ` · Line ${signal.row.line}`}</p></div>
      <div className="lag-signal__score"><b>ROI {(Number(signal.plan.roi) * 100).toFixed(2)}%</b>
        <span>Worst profit {money(signal.plan.worstCaseProfit)}</span><small>Immediate move {signal.movementMagnitude} · Quote age {signal.quoteAgeMs} ms</small></div></header>
    <div className="lag-signal__movement">{signal.movements.map((movement) => <span
      aria-label={`Movement #${movement.provider} ${movement.selection} ${movement.previousDecimal} to ${movement.currentDecimal}`}
      key={`${movement.provider}-${movement.selection}`}><b>#{movement.provider} · {movement.selection}</b>
      {movement.previousDecimal} → {movement.currentDecimal}</span>)}</div>
    <div className="lag-signal__legs">{signal.plan.legs.map((leg) => <div
      aria-label={`Leg #${leg.provider} ${leg.selection} at ${leg.decimalOdds}`} key={`${leg.provider}-${leg.selection}`}>
      <small>{leg.role}</small><b>#{leg.provider} · {leg.selection} @ {leg.decimalOdds}</b>
      <strong>Stake {money(leg.stake)}</strong><span>Profit if wins {money(leg.profit)}</span></div>)}</div>
    <footer><b>Total stake {money(signal.plan.totalStake)}</b><span>Both prices OPEN · exact two-outcome match</span>
      <strong>READ-ONLY</strong></footer>
  </article>;
}

function LagSignalPanel({ signals }: { readonly signals: readonly LagSignal[] }) {
  if (signals.length === 0) return <section className="lag-monitor lag-monitor--waiting" aria-live="polite">
    <h2>Monitoring exact two-book prices</h2><p>Waiting for a provider price change that creates profit on both outcomes.</p>
  </section>;
  return <section className="lag-monitor" aria-label="Live lag signals" aria-live="polite">
    <SignalCard signal={signals[0]!} strongest />
    {signals.length > 1 && <div className="lag-signal-list"><h2>Other live signals</h2>
      {signals.slice(1, 5).map((signal) => <SignalCard key={signal.key} signal={signal} />)}</div>}
  </section>;
}

function LagSignalToast({ signal }: { readonly signal: LagSignal | null }) {
  const [visible, setVisible] = useState<LagSignal | null>(null);
  useEffect(() => {
    if (signal === null) { setVisible(null); return; }
    setVisible(signal);
    const timer = window.setTimeout(() => setVisible(null), 10_000);
    return () => window.clearTimeout(timer);
  }, [signal?.key, signal?.triggeredAtMs]);
  if (visible === null) return null;
  return <aside className="arbitrage-toast lag-alert-toast" aria-live="assertive">
    <header><strong>PRICE GAP DETECTED</strong><span>10-second alert</span></header>
    <h2>{visible.event.event.participantA} vs {visible.event.event.participantB}</h2>
    <p>{visible.row.marketType}{visible.row.line === null ? "" : ` · Line ${visible.row.line}`} · ROI {(Number(visible.plan.roi) * 100).toFixed(2)}%</p>
    <p>Worst profit {money(visible.plan.worstCaseProfit)} · verify both legs before execution</p>
  </aside>;
}

export function LiveCatalogPage({ accountApi = defaultAccountApi, catalogApi = defaultCatalogApi }: {
  readonly accountApi?: AccountApiLike;
  readonly catalogApi?: CatalogApiLike;
}) {
  const [accounts, setAccounts] = useState<readonly AccountStatus[]>([]);
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(new Set());
  const [category, setCategory] = useState<"FOOTBALL" | "LOL">("FOOTBALL");
  const [catalogs, setCatalogs] = useState<readonly LiveCatalogResponse[]>([]);
  const [staleAccountIds, setStaleAccountIds] = useState<ReadonlySet<string>>(new Set());
  const [signals, setSignals] = useState<readonly LagSignal[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(Date.now());
  const [baseStake, setBaseStake] = useState(() => loadBaseStake(window.localStorage));
  const [baseStakeInput, setBaseStakeInput] = useState(baseStake);
  const [stakeError, setStakeError] = useState<string | null>(null);
  const baseStakeRef = useRef(baseStake);
  baseStakeRef.current = baseStake;
  const signalTracker = useRef(new LagSignalTracker());
  const catalogsRef = useRef<readonly LiveCatalogResponse[]>([]);
  const refreshInFlight = useRef(false);
  const requested = useRef({ account: new URLSearchParams(window.location.search).get("account"),
    event: new URLSearchParams(window.location.search).get("event") });
  const autoLoaded = useRef(false);
  const categoryAccounts = useMemo(() => accounts.filter((account) =>
    account.category === null || account.category === category), [accounts, category]);
  const categorySelectedIds = useMemo(() => categoryAccounts.filter((account) => selectedIds.has(account.id))
    .map((account) => account.id), [categoryAccounts, selectedIds]);

  const loadIds = useCallback(async (
    ids: readonly string[], foreground = false, expectedCategory: "FOOTBALL" | "LOL" = category
  ): Promise<void> => {
    if (ids.length === 0 || refreshInFlight.current) return;
    refreshInFlight.current = true;
    if (foreground) setBusy(true);
    try {
      const results = await Promise.allSettled(ids.map(async (id) => catalogApi.read(id)));
      const accepted = results.flatMap((result) => result.status === "fulfilled" &&
        result.value.category === expectedCategory ? [result.value] : []);
      const failedIds = new Set(ids.filter((_id, index) => results[index]?.status === "rejected"));
      const preserved = catalogsRef.current.filter((catalog) => failedIds.has(catalog.accountId) &&
        !accepted.some((candidate) => candidate.accountId === catalog.accountId));
      const nextCatalogs = [...accepted, ...preserved];
      catalogsRef.current = nextCatalogs;
      saveCatalogCache(window.localStorage, nextCatalogs);
      setCatalogs(nextCatalogs);
      setStaleAccountIds(new Set(preserved.map((catalog) => catalog.accountId)));
      const nextEvents = buildComparisonEvents(nextCatalogs);
      const providers = new Set<ProviderId>(accepted.map((catalog) => catalog.provider));
      const observedAtMs = accepted.reduce((latest, catalog) => Math.max(latest, catalog.observedAtMs), 0) || Date.now();
      setSignals(signalTracker.current.update(nextEvents, providers, stakePolicy(baseStakeRef.current), observedAtMs));
      const failed = results.length - accepted.length;
      if (accepted.length === 0 && preserved.length > 0) setMessage(`${failed} selected provider(s) unavailable; last verified snapshots are retained as stale. Signals are disabled until a fresh read succeeds.`);
      else if (accepted.length === 0) setMessage("Live catalog is unavailable. No selected provider returned a verified catalog.");
      else if (failed > 0 && preserved.length > 0) setMessage(`${failed} selected provider(s) unavailable; last verified snapshot is retained as stale.`);
      else if (failed > 0) setMessage(`${failed} selected provider(s) unavailable; available books are still shown.`);
      else setMessage(null);
    } finally {
      refreshInFlight.current = false;
      if (foreground) setBusy(false);
    }
  }, [catalogApi, category]);

  useEffect(() => {
    void accountApi.list().then((items) => {
      const available = items.filter((account) => account.capabilities.includes("CATALOG") && account.sessionState === "ACTIVE");
      const initial = new Set(available.map((account) => account.id));
      const cached = loadCatalogCache(window.localStorage).filter((catalog) => initial.has(catalog.accountId));
      catalogsRef.current = cached;
      setCatalogs(cached);
      setStaleAccountIds(new Set(cached.map((catalog) => catalog.accountId)));
      setAccounts(available); setSelectedIds(initial);
      if (!autoLoaded.current && available.length > 0) {
        autoLoaded.current = true;
        void loadIds([...initial], true);
      }
    }).catch(() => setMessage("Provider accounts are unavailable."));
  }, [accountApi, loadIds]);

  useEffect(() => {
    if (categorySelectedIds.length === 0) return;
    const timer = window.setInterval(() => void loadIds(categorySelectedIds), catalogRefreshIntervalMs);
    return () => window.clearInterval(timer);
  }, [categorySelectedIds, loadIds]);

  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);

  const events = useMemo(() => buildComparisonEvents(catalogs).filter((item) => item.event.category === category), [catalogs, category]);
  const visibleEvents = useMemo(() => events.filter((item) => isVisibleEvent(item.event, nowMs)), [events, nowMs]);
  const displayEvents = useMemo(() => visibleEvents.filter((item) => item.observedRows.length > 0).sort((left, right) => {
    const leftSignalRank = signals.findIndex((signal) => signal.event.key === left.key);
    const rightSignalRank = signals.findIndex((signal) => signal.event.key === right.key);
    if (leftSignalRank >= 0 || rightSignalRank >= 0) {
      if (leftSignalRank < 0) return 1;
      if (rightSignalRank < 0) return -1;
      if (leftSignalRank !== rightSignalRank) return leftSignalRank - rightSignalRank;
    }
    const edge = (right.bestMargin ?? Number.NEGATIVE_INFINITY) - (left.bestMargin ?? Number.NEGATIVE_INFINITY);
    if (edge !== 0) return edge;
    if (left.event.isLive !== right.event.isLive) return left.event.isLive ? 1 : -1;
    return left.event.startAtUtcMs - right.event.startAtUtcMs;
  }), [signals, visibleEvents]);
  const hiddenNonComparableCount = visibleEvents.length - displayEvents.length;
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
      lagSignals={signals.filter((signal) => signal.event.key === selectedEvent.key)}
      onBack={() => { window.history.replaceState({}, "", window.location.pathname); setSelectedKey(null); }}
      providerEventId={selectedEvent.providerEventIds[primary.provider]!} />;
  }

  const toggle = (id: string): void => setSelectedIds((current) => {
    const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next;
  });
  const changeCategory = (next: "FOOTBALL" | "LOL"): void => {
    setCategory(next); setCatalogs([]); catalogsRef.current = []; setStaleAccountIds(new Set());
    setSignals([]); setMessage(null); setSelectedKey(null);
    signalTracker.current = new LagSignalTracker();
    const nextIds = accounts.filter((account) => account.category === null || account.category === next)
      .map((account) => account.id).filter((id) => selectedIds.has(id));
    if (nextIds.length > 0) void loadIds(nextIds, true, next);
  };
  const watch = (item: ComparisonEvent): void => {
    const primary = item.catalogs[0]!;
    const eventId = item.providerEventIds[primary.provider]!;
    const query = new URLSearchParams(); query.set("event", eventId); query.set("account", primary.accountId);
    window.history.replaceState({}, "", `${window.location.pathname}?${query.toString()}`); setSelectedKey(item.key);
  };

  return <>
    <header className="page-header"><p className="eyebrow">Immediate two-book lag monitor</p><h1>Live Price Gaps</h1>
      <p>Only exact two-outcome markets shared by at least two selected books can produce a signal.</p></header>
    <section className="catalog-toolbar" aria-label="Catalog controls">
      <div className="category-switch" role="group" aria-label="Category"><button aria-pressed={category === "FOOTBALL"}
        onClick={() => changeCategory("FOOTBALL")} type="button">Football</button><button aria-pressed={category === "LOL"}
        onClick={() => changeCategory("LOL")} type="button">LoL</button></div>
      <ProviderSelector accounts={categoryAccounts} selected={selectedIds} toggle={toggle} />
      <label className="stake-config">Base stake for every match (VND)<input aria-label="Base stake for every match (VND)"
        inputMode="numeric" min="30000" step="1000" type="number" value={baseStakeInput} onChange={(event) => {
          const value = event.currentTarget.value; setBaseStakeInput(value);
          if (saveBaseStake(window.localStorage, value)) { setBaseStake(value); setStakeError(null); }
          else setStakeError("Use a whole VND amount of at least 30,000 in 1,000 VND steps.");
        }} />{stakeError === null ? <small>Applied to the lower-odds leg.</small> : <small role="alert">{stakeError}</small>}</label>
      <button aria-label="Load live catalog" disabled={busy || categorySelectedIds.length === 0} onClick={() => void loadIds(categorySelectedIds, true)} type="button">
        {busy ? "Loading…" : "Compare selected books"}</button>
    </section>
    {message !== null && <p className="connection-warning session-message" role="status">{message}</p>}
    {catalogs.length > 0 && <div className="catalog-evidence-bar"><strong>LIVE READ-ONLY</strong>
      <span>{catalogs.length - staleAccountIds.size} fresh provider(s)</span>
      {staleAccountIds.size > 0 && <span>{staleAccountIds.size} stale snapshot{staleAccountIds.size === 1 ? "" : "s"} retained</span>}
      <span>{displayEvents.length} cross-book match(es)</span>
      <span>{hiddenNonComparableCount} event{hiddenNonComparableCount === 1 ? "" : "s"} without an exact two-book ticket hidden · review mappings</span></div>}
    {catalogs.length > 0 && <LagSignalPanel signals={signals} />}
    <LagSignalToast signal={signals[0] ?? null} />
    <div className="catalog-event-list">{displayEvents.map((item) => {
      const label = `${item.event.participantA} vs ${item.event.participantB}`;
      const observedAtMs = item.catalogs.find((catalog) => catalog.provider === item.event.provider)?.observedAtMs ??
        item.catalogs[0]!.observedAtMs;
      const estimatedStartAtMs = estimatedLiveStartAtMs(observedAtMs, item.event.liveState);
      const comparisonCount = item.observedRows.length;
      return <article className="catalog-event" key={item.key}><header><div><span>{item.event.competition}</span><h2>{label}</h2>
        <div className="provider-tags">{item.providers.map((provider) => <b key={provider}>#{provider}</b>)}
          {item.event.category === "FOOTBALL" && item.event.isVirtual === true && <b>#VIRTUAL</b>}</div>
        <small>{comparisonCount > 0 ? `${comparisonCount} vé chấp 2 cửa đang hiển thị` : "Chưa có vé chấp 0.5 phù hợp"}</small></div>
        <div className="catalog-event-actions"><strong>{item.event.isLive ? formatMatchClock(item.event.liveState) : formatCountdown(item.event.startAtUtcMs, nowMs)}</strong>
          {item.event.isLive ? <><small>Observed {new Date(observedAtMs).toLocaleString()}</small>
            {estimatedStartAtMs !== null && <small>Approx. started {new Date(estimatedStartAtMs).toLocaleString()}</small>}</>
            : <small>Scheduled {new Date(item.event.startAtUtcMs).toLocaleString()}</small>}
          <button aria-label={`View & watch ${label}`} onClick={() => watch(item)} type="button">View & compare</button></div></header>
        {comparisonCount > 0 && <details className="catalog-market-details" open><summary>Vé chấp 2 cửa đang theo dõi</summary>
          <ComparisonTable item={item} baseStake={baseStake} signals={signals} /></details>}</article>;
    })}</div>
  </>;
}
