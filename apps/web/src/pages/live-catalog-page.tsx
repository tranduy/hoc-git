import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AccountStatus, ProviderId } from "@tool-chenh/contracts";
import { AccountApi, type AccountApiLike } from "../api/accounts.js";
import { CatalogApi, type CatalogApiLike, type LiveCatalogResponse } from "../api/catalog.js";
import { loadCatalogCache, saveCatalogCache } from "../catalog/catalog-cache.js";
import { buildComparisonEvents, decimalOdds, estimatedLiveStartAtMs, formatCountdown, formatMatchClock,
  isVisibleEvent, observedTicketAsComparisonRow, selectionLabel, type ComparisonEvent,
  type ComparisonRow } from "../catalog/comparison.js";
import { MatchWatchDetail, type ComparisonBook } from "../components/match-watch-detail.js";
import { buildFixedBaseStakePlan, buildObservedFixedBaseStakeEstimate,
  type FixedBaseStakePolicy } from "../watch/fixed-base-stake.js";
import { LagSignalTracker, type LagSignal } from "../watch/lag-signal-tracker.js";
import { PriceMovementTracker, type ObservedPriceMovement } from "../watch/price-movement-tracker.js";
import { loadBaseStake, saveBaseStake } from "../watch/stake-settings.js";

const defaultAccountApi = new AccountApi();
const defaultCatalogApi = new CatalogApi();
const comparisonProviders: readonly ProviderId[] = ["SABA", "IM", "SBOBET", "CMD", "APSPORT", "BTI"];
const catalogRefreshIntervalMs = 250;
const catalogCategoryStorageKey = "tool-chenh.live-catalog.category.v1";
type CatalogCategory = "FOOTBALL" | "LOL";

function loadCatalogCategory(storage: Storage): CatalogCategory {
  try {
    return storage.getItem(catalogCategoryStorageKey) === "LOL" ? "LOL" : "FOOTBALL";
  } catch {
    return "FOOTBALL";
  }
}

function saveCatalogCategory(storage: Storage, category: CatalogCategory): void {
  try { storage.setItem(catalogCategoryStorageKey, category); } catch { /* storage is optional */ }
}

function ProviderSelector({ accounts, selected, toggle }: {
  readonly accounts: readonly AccountStatus[];
  readonly selected: ReadonlySet<string>;
  readonly toggle: (id: string) => void;
}) {
  return <fieldset className="provider-selector"><legend>Books to compare</legend>{comparisonProviders.flatMap((provider) => {
    const providerAccounts = accounts.filter((account) => account.provider === provider);
    if (providerAccounts.length === 0) return [<label className="provider-selector__unavailable" key={provider}>
      <input aria-label={`${provider} unavailable`} disabled type="checkbox" /><b>#{provider}</b><small>not connected</small></label>];
    const activeAccounts = providerAccounts.filter((account) => account.sessionState === "ACTIVE");
    if (activeAccounts.length === 0) {
      const detail = providerAccounts.some((account) => account.reason === "EXPIRED") ? "nguồn hết hạn"
        : providerAccounts.some((account) => account.reason === "SCHEMA_CHANGED") ? "lỗi schema nguồn"
        : "nguồn không hoạt động";
      return [<label className="provider-selector__unavailable" key={provider}>
        <input aria-label={`${provider} ${detail}`} disabled type="checkbox" /><b>#{provider}</b><small>{detail}</small></label>];
    }
    return activeAccounts.map((account) => <label key={account.id}><input checked={selected.has(account.id)}
      onChange={() => toggle(account.id)} type="checkbox" /><span>{account.alias}</span><b>#{account.provider}</b></label>);
  })}</fieldset>;
}

function ProviderSourceStatus({ accounts, selected }: { readonly accounts: readonly AccountStatus[];
  readonly selected: ReadonlySet<string> }) {
  return <section className="provider-source-status" aria-label="Trạng thái nguồn dữ liệu">{comparisonProviders.map((provider) => {
    const matches = accounts.filter((account) => account.provider === provider);
    const active = matches.filter((account) => account.sessionState === "ACTIVE" && selected.has(account.id)).length;
    const state = active > 0 ? `${active} nguồn đang hoạt động`
      : matches.some((account) => account.reason === "EXPIRED") ? "Nguồn hết hạn — cần đăng nhập/lấy launch mới"
      : matches.some((account) => account.reason === "SCHEMA_CHANGED") ? "Lỗi nguồn/schema — không phải không có trận"
      : matches.length > 0 ? "Nguồn không hoạt động — không phải không có trận" : "Chưa cấu hình nguồn";
    return <span className={active > 0 ? "source-state source-state--active" : "source-state source-state--error"}
      key={provider}><b>#{provider}</b>{state}</span>;
  })}</section>;
}

function stakePolicy(baseStake: string): FixedBaseStakePolicy {
  return { currency: "VND", baseStake, minStake: "30000", maxStake: baseStake,
    stakeStep: "1000", balance: baseStake };
}

function money(value: string): string {
  return `${Number(value).toLocaleString("en-US")} VND`;
}

function RateGapSummary({ event, row }: { readonly event: ComparisonEvent["event"]; readonly row: ComparisonRow }) {
  const selections = [...new Set(row.cells.flatMap((cell) => cell.quotes.map((quote) => quote.selection)))].sort();
  return <div className="rate-gap-summary">{selections.map((selection) => {
    const odds = row.cells.flatMap((cell) => cell.quotes.filter((quote) => quote.selection === selection)
      .flatMap((quote) => { const value = decimalOdds(quote); return value === null ? [] : [value]; }));
    const low = Math.min(...odds);
    const high = Math.max(...odds);
    const gap = Number.isFinite(low) && Number.isFinite(high) ? high - low : null;
    return <small key={selection}>{selectionLabel(event, selection)}: {gap === null ? "chưa đủ giá" :
      `lệch ${gap.toFixed(3)} (${((gap / low) * 100).toFixed(2)}%)`}</small>;
  })}<b>Biên cân hiện tại: {row.margin === null ? "không có cặp chéo" : `${(row.margin * 100).toFixed(2)}%`}</b></div>;
}

function ComparisonTable({ item, baseStake, signals }: { readonly item: ComparisonEvent; readonly baseStake: string;
  readonly signals: readonly LagSignal[] }) {
  const selectedProviders = new Set<ProviderId>(item.providers);
  return <div className="table-wrap comparison-table"><table><thead><tr><th>Loại vé / kèo</th>
    {item.providers.map((provider) => <th key={provider}>{provider}</th>)}<th>Cân tiền / lợi nhuận</th></tr></thead><tbody>
    {item.observedRows.map((observedRow) => {
      const verifiedRow = item.rows.find((candidate) => candidate.key === observedRow.key);
      const displayRow = verifiedRow ?? observedTicketAsComparisonRow(observedRow);
      const verifiedPlan = verifiedRow === undefined ? null : buildFixedBaseStakePlan(verifiedRow, selectedProviders, stakePolicy(baseStake));
      const plan = verifiedPlan ?? buildObservedFixedBaseStakeEstimate(displayRow, selectedProviders, stakePolicy(baseStake));
      const signal = signals.find((candidate) => candidate.event.key === item.key && candidate.row.key === observedRow.key);
      return <tr className={signal === undefined ? "ticket-row" : "ticket-row ticket-row--profitable"} key={observedRow.key}>
      <th>{observedRow.marketType === "SERIES_WINNER" ? "Thắng series" : "Chấp toàn trận"}
        <small>{observedRow.line === null ? "" : `Kèo ${observedRow.line}`}</small>
        <b className={signal === undefined ? "edge-badge" : "edge-badge edge-badge--positive"}>
          {signal === undefined ? "ĐANG THEO DÕI" : "ĐỦ ĐIỀU KIỆN · LÃI ≥ 20.000 VND"}</b></th>
      {item.providers.map((provider) => {
        const cell = observedRow.cells.find((candidate) => candidate.provider === provider);
        return <td key={provider}>{cell === undefined ? <span className="rate-missing">Unavailable</span> :
          <div className="rate-cell">{cell.quotes.map((quote) => <span
            className={displayRow.bestBySelection[quote.selection] === provider ? "rate-quote rate-quote--best" : "rate-quote"}
            key={quote.providerSelectionId}>{selectionLabel(item.event, quote.selection)} · {quote.rawOdds} {quote.rawFormat}
              {decimalOdds(quote) === null ? "" : ` · decimal ${decimalOdds(quote)!.toFixed(3)}`} · {quote.status}</span>)}</div>}</td>;
      })}<td><RateGapSummary event={item.event} row={displayRow} />{plan === null ? <span className="rate-missing">Chưa đủ hai giá đối nghịch từ hai sàn để tính tiền</span>
        : <div className={verifiedPlan === null ? "balanced-plan balanced-plan--estimate" : "balanced-plan"}><strong>{verifiedPlan === null ? "ƯỚC TÍNH QUAN SÁT · SETTLEMENT CHƯA XÁC MINH" :
          signal === undefined ? "GIÁ HIỆN TẠI" : "SẴN SÀNG (READ-ONLY)"}</strong>{plan.legs.map((leg) => <span key={leg.selection}>
          <small>#{leg.provider} · {selectionLabel(item.event, leg.selection)} @ {leg.decimalOdds}</small><b>{money(leg.stake)} {leg.role.toLowerCase()}</b>
        </span>)}<span>Total {money(plan.totalStake)}</span>{plan.legs.map((leg) => <span key={`${leg.selection}-profit`}>
          <small>Nếu {selectionLabel(item.event, leg.selection)} thắng</small><b>Lãi/lỗ {money(leg.profit)}</b></span>)}
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
      key={`${movement.provider}-${movement.selection}`}><b>#{movement.provider} · {selectionLabel(signal.event.event, movement.selection)}</b>
      {movement.previousDecimal} → {movement.currentDecimal}</span>)}</div>
    <div className="lag-signal__legs">{signal.plan.legs.map((leg) => <div
      aria-label={`Leg #${leg.provider} ${leg.selection} at ${leg.decimalOdds}`} key={`${leg.provider}-${leg.selection}`}>
      <small>{leg.role}</small><b>#{leg.provider} · {selectionLabel(signal.event.event, leg.selection)} @ {leg.decimalOdds}</b>
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

function PriceMovementPanel({ movements }: { readonly movements: readonly ObservedPriceMovement[] }) {
  return <section className="price-movement-panel" aria-label="Recent observed price movements" aria-live="polite">
    <header><h2>Biến động giá gần nhất</h2><small>Đo ngay trên mỗi snapshot mới · không chờ cửa sổ 5 phút</small></header>
    {movements.length === 0 ? <p>Chưa phát hiện odds thay đổi trên các vé chung đang hiển thị.</p> :
      <div className="price-movement-list">{movements.slice(0, 5).map((movement, index) => <article
        className={index === 0 ? "price-movement price-movement--strongest" : "price-movement"} key={movement.key}>
        <b>{index === 0 ? "MẠNH NHẤT · " : ""}{movement.event.event.participantA} vs {movement.event.event.participantB}</b>
        <span>#{movement.provider} · {selectionLabel(movement.event.event, movement.selection)}</span>
        <strong>{movement.previousDecimal} → {movement.currentDecimal}</strong>
        <small>Độ dịch chuyển {movement.magnitude} · {new Date(movement.changedAtMs).toLocaleTimeString()}</small>
      </article>)}</div>}
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

export function LiveCatalogPage({ accountApi = defaultAccountApi, catalogApi = defaultCatalogApi, fixedCategory }: {
  readonly accountApi?: AccountApiLike;
  readonly catalogApi?: CatalogApiLike;
  readonly fixedCategory?: CatalogCategory;
}) {
  const [accounts, setAccounts] = useState<readonly AccountStatus[]>([]);
  const [accountsLoaded, setAccountsLoaded] = useState(false);
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(new Set());
  const [category, setCategory] = useState<CatalogCategory>(() => fixedCategory ?? loadCatalogCategory(window.localStorage));
  const [catalogs, setCatalogs] = useState<readonly LiveCatalogResponse[]>([]);
  const [staleAccountIds, setStaleAccountIds] = useState<ReadonlySet<string>>(new Set());
  const [signals, setSignals] = useState<readonly LagSignal[]>([]);
  const [movements, setMovements] = useState<readonly ObservedPriceMovement[]>([]);
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
  const movementTracker = useRef(new PriceMovementTracker());
  const catalogsRef = useRef<readonly LiveCatalogResponse[]>([]);
  const refreshInFlight = useRef(false);
  const retryAfterMs = useRef(new Map<string, number>());
  const requested = useRef({ account: new URLSearchParams(window.location.search).get("account"),
    event: new URLSearchParams(window.location.search).get("event") });
  const autoLoaded = useRef(false);
  const categoryAccounts = useMemo(() => accounts.filter((account) =>
    account.category === category), [accounts, category]);
  const categorySelectedIds = useMemo(() => categoryAccounts.filter((account) => selectedIds.has(account.id))
    .map((account) => account.id), [categoryAccounts, selectedIds]);

  const loadIds = useCallback(async (
    ids: readonly string[], foreground: boolean, expectedCategory: CatalogCategory
  ): Promise<void> => {
    const requestedIds = foreground ? ids : ids.filter((id) => (retryAfterMs.current.get(id) ?? 0) <= Date.now());
    if (requestedIds.length === 0 || refreshInFlight.current) return;
    refreshInFlight.current = true;
    if (foreground) setBusy(true);
    try {
      const results = await Promise.allSettled(requestedIds.map(async (id) => catalogApi.read(id)));
      const accepted = results.flatMap((result) => result.status === "fulfilled" &&
        result.value.category === expectedCategory ? [result.value] : []);
      const failedIds = new Set(requestedIds.filter((_id, index) => {
        const result = results[index];
        return result?.status !== "fulfilled" || result.value.category !== expectedCategory;
      }));
      for (const id of requestedIds) {
        if (failedIds.has(id)) retryAfterMs.current.set(id, Date.now() + 30_000);
        else retryAfterMs.current.delete(id);
      }
      const preserved = catalogsRef.current.filter((catalog) =>
        (!requestedIds.includes(catalog.accountId) || failedIds.has(catalog.accountId)) &&
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
      setMovements(movementTracker.current.update(nextEvents, observedAtMs));
      const failed = results.length - accepted.length;
      if (accepted.length === 0 && preserved.length > 0) setMessage(`${failed} selected provider(s) unavailable; last verified snapshots are retained as stale. Signals are disabled until a fresh read succeeds.`);
      else if (accepted.length === 0) setMessage("Nguồn đã chọn đang lỗi hoặc trả sai category — chưa thể kết luận là không có trận.");
      else if (failed > 0 && preserved.length > 0) setMessage(`${failed} selected provider(s) unavailable; last verified snapshot is retained as stale.`);
      else if (failed > 0) setMessage(`${failed} selected provider(s) unavailable; available books are still shown.`);
      else if (accepted.every((catalog) => catalog.events.length === 0)) setMessage("Nguồn hoạt động bình thường nhưng hiện không có trận trong catalog.");
      else setMessage(null);
    } finally {
      refreshInFlight.current = false;
      if (foreground) setBusy(false);
    }
  }, [catalogApi]);

  useEffect(() => {
    void accountApi.list().then((items) => {
      const catalogAccounts = items.filter((account) => account.capabilities.includes("CATALOG"));
      const availableCandidates = catalogAccounts.filter((account) => account.sessionState === "ACTIVE");
      const targetCategory = fixedCategory ?? category;
      const available = availableCandidates.filter((account) => account.category !== null);
      const requestedAccount = available.find((account) => account.id === requested.current.account &&
        account.category === targetCategory);
      let initialCategory: CatalogCategory = fixedCategory ?? (requestedAccount?.category === "LOL" ? "LOL" : category);
      const hasInitialCategory = available.some((account) => account.category === initialCategory);
      if (!hasInitialCategory && available.some((account) => account.category === "LOL")) initialCategory = "LOL";
      const initial = new Set(available.filter((account) => account.category === initialCategory)
        .map((account) => account.id));
      const cached = loadCatalogCache(window.localStorage).filter((catalog) => initial.has(catalog.accountId));
      catalogsRef.current = cached;
      setCatalogs(cached);
      setStaleAccountIds(new Set(cached.map((catalog) => catalog.accountId)));
      setAccounts(catalogAccounts); setAccountsLoaded(true); setSelectedIds(new Set(available.map((account) => account.id)));
      setCategory(initialCategory); saveCatalogCategory(window.localStorage, initialCategory);
      if (!autoLoaded.current && initial.size > 0) {
        autoLoaded.current = true;
        void loadIds([...initial], true, initialCategory);
      }
    }).catch(() => { setAccountsLoaded(true); setMessage("Không đọc được trạng thái account/provider."); });
  }, [accountApi, fixedCategory, loadIds]);

  useEffect(() => {
    if (categorySelectedIds.length === 0) return;
    const timer = window.setInterval(() => void loadIds(categorySelectedIds, false, category), catalogRefreshIntervalMs);
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
    const leftMovementRank = movements.findIndex((movement) => movement.event.key === left.key);
    const rightMovementRank = movements.findIndex((movement) => movement.event.key === right.key);
    if (leftMovementRank >= 0 || rightMovementRank >= 0) {
      if (leftMovementRank < 0) return 1;
      if (rightMovementRank < 0) return -1;
      if (leftMovementRank !== rightMovementRank) return leftMovementRank - rightMovementRank;
    }
    const edge = (right.bestMargin ?? Number.NEGATIVE_INFINITY) - (left.bestMargin ?? Number.NEGATIVE_INFINITY);
    if (edge !== 0) return edge;
    if (left.event.isLive !== right.event.isLive) return left.event.isLive ? 1 : -1;
    return left.event.startAtUtcMs - right.event.startAtUtcMs;
  }), [movements, signals, visibleEvents]);
  const hiddenNonComparableCount = visibleEvents.length - displayEvents.length;
  const crossBookEventCount = displayEvents.filter((item) => item.observedRows.some((row) =>
    new Set(row.cells.map((cell) => cell.provider)).size >= 2)).length;
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
      const providerAccounts = accounts.filter((account) => account.provider === provider && account.category === category);
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
  const changeCategory = (next: CatalogCategory): void => {
    setCategory(next); setCatalogs([]); catalogsRef.current = []; setStaleAccountIds(new Set());
    saveCatalogCategory(window.localStorage, next);
    setSignals([]); setMovements([]); setMessage(null); setSelectedKey(null);
    signalTracker.current = new LagSignalTracker();
    movementTracker.current = new PriceMovementTracker();
    const nextIds = accounts.filter((account) => account.category === next)
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
    <header className="page-header"><p className="eyebrow">{category === "FOOTBALL" ? "Football" : "League of Legends"} · immediate two-book lag monitor</p>
      <h1>{category === "FOOTBALL" ? "Football Live Price Gaps" : "LoL Live Price Gaps"}</h1>
      <p>Only exact two-outcome markets shared by at least two selected books can produce a signal.</p></header>
    <section className="catalog-toolbar" aria-label="Catalog controls">
      {fixedCategory === undefined && <div className="category-switch" role="group" aria-label="Category"><button aria-pressed={category === "FOOTBALL"}
        onClick={() => changeCategory("FOOTBALL")} type="button">Football</button><button aria-pressed={category === "LOL"}
        onClick={() => changeCategory("LOL")} type="button">LoL</button></div>}
      <ProviderSelector accounts={categoryAccounts} selected={selectedIds} toggle={toggle} />
      <label className="stake-config">Base stake for every match (VND)<input aria-label="Base stake for every match (VND)"
        inputMode="numeric" min="30000" step="1000" type="number" value={baseStakeInput} onChange={(event) => {
          const value = event.currentTarget.value; setBaseStakeInput(value);
          if (saveBaseStake(window.localStorage, value)) { setBaseStake(value); setStakeError(null); }
          else setStakeError("Use a whole VND amount of at least 30,000 in 1,000 VND steps.");
        }} />{stakeError === null ? <small>Applied to the lower-odds leg.</small> : <small role="alert">{stakeError}</small>}</label>
      <button aria-label="Load live catalog" disabled={busy || categorySelectedIds.length === 0} onClick={() => void loadIds(categorySelectedIds, true, category)} type="button">
        {busy ? "Loading…" : "Compare selected books"}</button>
    </section>
    {accountsLoaded && <ProviderSourceStatus accounts={categoryAccounts} selected={selectedIds} />}
    {message !== null && <p className="connection-warning session-message" role="status">{message}</p>}
    {catalogs.length > 0 && <div className="catalog-evidence-bar"><strong>LIVE READ-ONLY</strong>
      <span>{catalogs.length - staleAccountIds.size} fresh provider(s)</span>
      {staleAccountIds.size > 0 && <span>{staleAccountIds.size} stale snapshot{staleAccountIds.size === 1 ? "" : "s"} retained</span>}
      <span>{displayEvents.length} match(es) with supported two-way tickets</span>
      <span>{crossBookEventCount} exact cross-book match(es)</span>
      <span>{hiddenNonComparableCount} event{hiddenNonComparableCount === 1 ? "" : "s"} without a supported two-way ticket hidden · review mappings</span></div>}
    {catalogs.length > 0 && <LagSignalPanel signals={signals} />}
    {catalogs.length > 0 && <PriceMovementPanel movements={movements} />}
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
