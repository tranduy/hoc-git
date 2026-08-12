import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AccountStatus, ProviderId } from "@tool-chenh/contracts";
import { AccountApi, type AccountApiLike } from "../api/accounts.js";
import { CatalogApi, catalogRetryDelayMs, type CatalogApiLike, type LiveCatalogResponse } from "../api/catalog.js";
import { defaultProviderPreflightApi, type ProviderPreflightApiLike } from "../api/provider-preflight.js";
import { loadCatalogCache, saveCatalogCache } from "../catalog/catalog-cache.js";
import { buildComparisonEvents, decimalOdds, estimatedLiveStartAtMs, formatCountdown, formatMatchClock,
  isVisibleEvent, observedTicketAsComparisonRow, selectionLabel, ticketMarketLabel, type ComparisonEvent,
  type ComparisonRow } from "../catalog/comparison.js";
import { MatchWatchDetail, type ComparisonBook } from "../components/match-watch-detail.js";
import { ProfitToastStack } from "../components/profit-toast-stack.js";
import { RankedTicketTable } from "../components/ranked-ticket-table.js";
import { buildObservedFixedBaseStakeEstimate,
  type FixedBaseStakePolicy } from "../watch/fixed-base-stake.js";
import { LagSignalTracker, type LagSignal } from "../watch/lag-signal-tracker.js";
import { PriceMovementTracker, type ObservedPriceMovement } from "../watch/price-movement-tracker.js";
import { rankedEvent, sortRankedEvents } from "../watch/ranked-tickets.js";
import { NotificationSound } from "../watch/notification-sound.js";
import { ProfitAlertTracker, type ProfitAlert } from "../watch/profit-alert-tracker.js";
import { loadBaseStake, saveBaseStake } from "../watch/stake-settings.js";
import { TicketPreflightCoordinator, type VerifiedTicketEvidence } from "../watch/ticket-preflight-coordinator.js";

const defaultAccountApi = new AccountApi();
const defaultCatalogApi = new CatalogApi();
const comparisonProviders: readonly ProviderId[] = ["SABA", "IM", "SBOBET", "CMD", "APSPORT", "BTI"];
const catalogRefreshIntervalMs = 250;
const executableProfileMaxAgeMs = 30_000;
const profileRefreshIntervalMs = 15_000;
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

function oneAccountPerProvider(accounts: readonly AccountStatus[]): readonly AccountStatus[] {
  const selected = new Map<ProviderId, AccountStatus>();
  const profileRank = (account: AccountStatus): number => account.profileState === "FRESH" ? 2
    : account.profileState === "STALE" ? 1 : 0;
  const sourceRank = (account: AccountStatus): number => account.reason === null ? 3
    : account.reason === "SCHEMA_CHANGED" ? 2 : account.reason === "UNREACHABLE" ? 1 : 0;
  const launchRank = (account: AccountStatus): number => account.sessionSource === "FABET_LOGIN" ? 1 : 0;
  for (const account of accounts) {
    const current = selected.get(account.provider);
    if (current === undefined || (current.sessionState !== "ACTIVE" && account.sessionState === "ACTIVE") ||
      (current.sessionState === account.sessionState && launchRank(account) > launchRank(current)) ||
      (current.sessionState === account.sessionState && launchRank(account) === launchRank(current) &&
        profileRank(account) > profileRank(current)) ||
      (current.sessionState === account.sessionState && launchRank(account) === launchRank(current) &&
        profileRank(account) === profileRank(current) &&
        sourceRank(account) > sourceRank(current)) ||
      (current.sessionState === account.sessionState && launchRank(account) === launchRank(current) &&
        profileRank(account) === profileRank(current) &&
        sourceRank(account) === sourceRank(current) &&
        account.id.localeCompare(current.id) > 0)) {
      selected.set(account.provider, account);
    }
  }
  return comparisonProviders.flatMap((provider) => {
    const account = selected.get(provider);
    return account === undefined ? [] : [account];
  });
}

function wholeUnits(value: string): bigint | null {
  const match = /^(0|[1-9]\d*)(?:\.\d+)?$/u.exec(value);
  return match === null ? null : BigInt(match[1]!);
}

export function filterAccountBackedSignals(
  signals: readonly LagSignal[], acceptedCatalogs: readonly LiveCatalogResponse[],
  accounts: readonly AccountStatus[], observedAtMs: number
): readonly LagSignal[] {
  const accountById = new Map(accounts.map((account) => [account.id, account]));
  const accountByProvider = new Map<ProviderId, AccountStatus>();
  for (const catalog of acceptedCatalogs) {
    const account = accountById.get(catalog.accountId);
    if (account !== undefined && account.provider === catalog.provider) accountByProvider.set(catalog.provider, account);
  }
  return signals.filter((signal) => {
    const legAccounts = signal.plan.legs.map((leg) => accountByProvider.get(leg.provider));
    if (legAccounts.some((account) => account === undefined) ||
      new Set(legAccounts.map((account) => account!.id)).size !== 2) return false;
    return signal.plan.legs.every((leg, index) => {
      const account = legAccounts[index]!;
      const balance = account.balance === null ? null : wholeUnits(account.balance);
      const stake = wholeUnits(leg.stake);
      return account.sessionState === "ACTIVE" && account.profileState === "FRESH" &&
        account.capabilities.includes("PROFILE") && account.capabilities.includes("PREFLIGHT") &&
        account.currency === signal.plan.currency &&
        account.balanceAsOfMs !== null && observedAtMs >= account.balanceAsOfMs &&
        observedAtMs - account.balanceAsOfMs <= executableProfileMaxAgeMs &&
        balance !== null && stake !== null && balance >= stake;
    });
  });
}

function ProviderSelector({ accounts, loaded, selected, toggle }: {
  readonly accounts: readonly AccountStatus[];
  readonly loaded: boolean;
  readonly selected: ReadonlySet<string>;
  readonly toggle: (id: string) => void;
}) {
  return <fieldset className="provider-selector"><legend>Books to compare</legend>{comparisonProviders.flatMap((provider) => {
    const providerAccounts = accounts.filter((account) => account.provider === provider);
    if (providerAccounts.length === 0) return [<label className="provider-selector__unavailable" key={provider}>
      <input aria-label={`${provider} ${loaded ? "unavailable" : "loading"}`} disabled type="checkbox" />
      <b>#{provider}</b><small>{loaded ? "not connected" : "loading source…"}</small></label>];
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
    const profileReady = matches.some((account) => account.sessionState === "ACTIVE" && selected.has(account.id) &&
      account.profileState === "FRESH" && account.capabilities.includes("PROFILE") &&
      account.currency !== null && account.balance !== null);
    const bettingReady = matches.some((account) => account.sessionState === "ACTIVE" && selected.has(account.id) &&
      account.profileState === "FRESH" && account.capabilities.includes("PROFILE") && account.capabilities.includes("PREFLIGHT") &&
      account.currency !== null && account.balance !== null);
    const state = active > 0 ? bettingReady
      ? `${active} nguồn giá + profile cược đã xác minh`
      : profileReady ? `${active} nguồn giá + profile đã xác minh; preflight vé chưa có`
      : `${active} nguồn giá; đăng nhập cược/số dư chưa xác minh`
      : matches.some((account) => account.reason === "EXPIRED") ? "Nguồn hết hạn — cần đăng nhập/lấy launch mới"
      : matches.some((account) => account.reason === "SCHEMA_CHANGED") ? "Lỗi nguồn/schema — không phải không có trận"
      : matches.length > 0 ? "Nguồn không hoạt động — không phải không có trận" : "Chưa cấu hình nguồn";
    return <span className={active > 0 && bettingReady ? "source-state source-state--active" : "source-state source-state--error"}
      key={provider}><b>#{provider}</b>{state}</span>;
  })}</section>;
}

function observedStakePolicy(baseStake: string): FixedBaseStakePolicy {
  return { currency: "VND", baseStake, minStake: "30000", maxStake: baseStake,
    stakeStep: "1000", balance: baseStake };
}

function executableStakePolicy(baseStake: string): FixedBaseStakePolicy {
  return { ...observedStakePolicy(baseStake), requireProviderConstraints: true, providerConstraints: {} };
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
      const signal = signals.find((candidate) => candidate.event.key === item.key && candidate.row.key === observedRow.key);
      const verifiedPlan = signal?.plan ?? null;
      const plan = verifiedPlan ?? buildObservedFixedBaseStakeEstimate(displayRow, selectedProviders, observedStakePolicy(baseStake));
      return <tr className={signal === undefined ? "ticket-row" : "ticket-row ticket-row--profitable"} key={observedRow.key}>
      <th>{ticketMarketLabel(observedRow.marketType)}
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

export function LiveCatalogPage({ accountApi = defaultAccountApi, catalogApi = defaultCatalogApi,
  providerPreflightApi = defaultProviderPreflightApi, fixedCategory }: {
  readonly accountApi?: AccountApiLike;
  readonly catalogApi?: CatalogApiLike;
  readonly providerPreflightApi?: ProviderPreflightApiLike;
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
  const [verifiedTickets, setVerifiedTickets] = useState<ReadonlyMap<string, VerifiedTicketEvidence>>(new Map());
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [highlightTicketKey, setHighlightTicketKey] = useState<string | null>(() =>
    new URLSearchParams(window.location.search).get("ticket"));
  const [profitAlerts, setProfitAlerts] = useState<readonly ProfitAlert[]>([]);
  const [nowMs, setNowMs] = useState(Date.now());
  const [baseStake, setBaseStake] = useState(() => loadBaseStake(window.localStorage));
  const [baseStakeInput, setBaseStakeInput] = useState(baseStake);
  const [stakeError, setStakeError] = useState<string | null>(null);
  const baseStakeRef = useRef(baseStake);
  baseStakeRef.current = baseStake;
  const signalTracker = useRef(new LagSignalTracker());
  const movementTracker = useRef(new PriceMovementTracker());
  const preflightCoordinator = useRef(new TicketPreflightCoordinator(providerPreflightApi));
  const profitAlertTracker = useRef(new ProfitAlertTracker());
  const notificationSound = useRef<NotificationSound | null>(null);
  if (notificationSound.current === null) notificationSound.current = new NotificationSound();
  const catalogsRef = useRef<readonly LiveCatalogResponse[]>([]);
  const accountsRef = useRef<readonly AccountStatus[]>([]);
  const refreshInFlight = useRef(false);
  const retryAfterMs = useRef(new Map<string, number>());
  const workingAccountIds = useRef(new Map<ProviderId, string>());
  const requested = useRef({ account: new URLSearchParams(window.location.search).get("account"),
    event: new URLSearchParams(window.location.search).get("event"),
    ticket: new URLSearchParams(window.location.search).get("ticket") });
  const autoLoaded = useRef(false);
  const categoryAccounts = useMemo(() => oneAccountPerProvider(accounts.filter((account) =>
    account.category === category)), [accounts, category]);
  const categorySelectedIds = useMemo(() => categoryAccounts.filter((account) => selectedIds.has(account.id))
    .map((account) => account.id), [categoryAccounts, selectedIds]);
  const profileRefreshKey = useMemo(() => categoryAccounts.filter((account) => selectedIds.has(account.id) &&
    account.sessionState === "ACTIVE" && account.capabilities.includes("PROFILE"))
    .map((account) => account.id).sort().join("|"), [categoryAccounts, selectedIds]);

  const loadIds = useCallback(async (
    ids: readonly string[], foreground: boolean, expectedCategory: CatalogCategory
  ): Promise<void> => {
    const requestedIds = foreground ? ids : ids.filter((id) => (retryAfterMs.current.get(id) ?? 0) <= Date.now());
    if (requestedIds.length === 0 || refreshInFlight.current) return;
    refreshInFlight.current = true;
    if (foreground) setBusy(true);
    try {
      const results = await Promise.allSettled(requestedIds.map(async (id) => {
        const requestedAccount = accountsRef.current.find((account) => account.id === id);
        const fallbackAccounts = requestedAccount === undefined ? [] : accountsRef.current.filter((account) =>
          account.id !== id && account.provider === requestedAccount.provider && account.category === expectedCategory &&
          account.sessionState === "ACTIVE" && account.capabilities.includes("CATALOG"));
        const workingId = requestedAccount === undefined ? undefined : workingAccountIds.current.get(requestedAccount.provider);
        const candidateIds = [...new Set([
          ...(workingId === undefined ? [] : [workingId]), id, ...fallbackAccounts.map((account) => account.id)
        ])].slice(0, 3);
        let value: LiveCatalogResponse | null = null;
        let lastError: unknown = new Error("No active catalog account");
        for (const candidateId of candidateIds) {
          try {
            const candidate = await catalogApi.read(candidateId);
            if (candidate.category !== expectedCategory ||
              (requestedAccount !== undefined && candidate.provider !== requestedAccount.provider)) {
              throw new Error("Catalog identity mismatch");
            }
            value = candidate;
            workingAccountIds.current.set(candidate.provider, candidate.accountId);
            break;
          } catch (error) {
            lastError = error;
          }
        }
        if (value === null) throw lastError;
        if (value.category === expectedCategory) {
          const nextCatalogs = [value, ...catalogsRef.current.filter((catalog) => catalog.accountId !== id)];
          catalogsRef.current = nextCatalogs;
          saveCatalogCache(window.localStorage, nextCatalogs);
          setCatalogs(nextCatalogs);
          setStaleAccountIds((current) => {
            const next = new Set(current);
            next.delete(id);
            return next;
          });
        }
        return value;
      }));
      const accepted = results.flatMap((result) => result.status === "fulfilled" &&
        result.value.category === expectedCategory ? [result.value] : []);
      const failedIds = new Set(requestedIds.filter((_id, index) => {
        const result = results[index];
        return result?.status !== "fulfilled" || result.value.category !== expectedCategory;
      }));
      for (const [index, id] of requestedIds.entries()) {
        if (failedIds.has(id)) {
          const result = results[index];
          retryAfterMs.current.set(id, Date.now() + catalogRetryDelayMs(result?.status === "rejected" ? result.reason : undefined));
        }
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
      const candidates = signalTracker.current.update(nextEvents, providers, executableStakePolicy(baseStakeRef.current), observedAtMs);
      setSignals(filterAccountBackedSignals(candidates, accepted, accountsRef.current, observedAtMs));
      const nextMovements = movementTracker.current.update(nextEvents, observedAtMs);
      setMovements(nextMovements);
      const acceptedAccountIds = new Set(accepted.map((catalog) => catalog.accountId));
      const selectedAccounts = accountsRef.current.filter((account) => acceptedAccountIds.has(account.id));
      const nextVerified = await preflightCoordinator.current.refresh({ events: nextEvents,
        selectedAccounts, selectedProviders: providers, policy: observedStakePolicy(baseStakeRef.current) });
      setVerifiedTickets(nextVerified);
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
    let cancelled = false;
    let retryTimer: number | undefined;
    const discoverAccounts = (): void => { void accountApi.list().then((items) => {
      if (cancelled) return;
      const catalogAccounts = items.filter((account) => account.capabilities.includes("CATALOG"));
      accountsRef.current = catalogAccounts;
      const availableCandidates = catalogAccounts.filter((account) => account.sessionState === "ACTIVE");
      const targetCategory = fixedCategory ?? category;
      const available = availableCandidates.filter((account) => account.category !== null);
      const requestedAccount = available.find((account) => account.id === requested.current.account &&
        account.category === targetCategory);
      let initialCategory: CatalogCategory = fixedCategory ?? (requestedAccount?.category === "LOL" ? "LOL" : category);
      const hasInitialCategory = available.some((account) => account.category === initialCategory);
      if (!hasInitialCategory && available.some((account) => account.category === "LOL")) initialCategory = "LOL";
      const initial = new Set(oneAccountPerProvider(available.filter((account) => account.category === initialCategory))
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
    }).catch(() => {
      if (cancelled) return;
      setAccountsLoaded(true);
      setMessage("Không đọc được trạng thái account/provider. Đang tự thử lại…");
      retryTimer = window.setTimeout(discoverAccounts, 2_000);
    }); };
    discoverAccounts();
    return () => { cancelled = true; if (retryTimer !== undefined) window.clearTimeout(retryTimer); };
  }, [accountApi, fixedCategory, loadIds]);

  useEffect(() => {
    if (categorySelectedIds.length === 0) return;
    const timer = window.setInterval(() => void loadIds(categorySelectedIds, false, category), catalogRefreshIntervalMs);
    return () => window.clearInterval(timer);
  }, [categorySelectedIds, loadIds]);

  useEffect(() => {
    const ids = profileRefreshKey === "" ? [] : profileRefreshKey.split("|");
    if (ids.length === 0) return;
    let cancelled = false;
    const refreshProfiles = async (): Promise<void> => {
      if (refreshInFlight.current) return;
      const results = await Promise.allSettled(ids.map((id) => accountApi.refresh(id)));
      if (cancelled) return;
      const refreshed = new Map(results.flatMap((result, index) => result.status === "fulfilled" &&
        result.value.id === ids[index] ? [[result.value.id, result.value] as const] : []));
      if (refreshed.size === 0) return;
      setAccounts((current) => {
        const next = current.map((account) => refreshed.get(account.id) ?? account);
        accountsRef.current = next;
        return next;
      });
    };
    void refreshProfiles();
    const timer = window.setInterval(() => void refreshProfiles(), profileRefreshIntervalMs);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [accountApi, profileRefreshKey]);

  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);

  const events = useMemo(() => buildComparisonEvents(catalogs).filter((item) => item.event.category === category), [catalogs, category]);
  const visibleEvents = useMemo(() => events.filter((item) => isVisibleEvent(item.event, nowMs)), [events, nowMs]);
  const selectedProviderIds = useMemo(() => new Set<ProviderId>(categoryAccounts.filter((account) =>
    selectedIds.has(account.id) && account.sessionState === "ACTIVE").map((account) => account.provider)),
  [categoryAccounts, selectedIds]);
  const rankedEvents = useMemo(() => sortRankedEvents(visibleEvents.filter((item) => item.observedRows.length > 0)
    .map((item) => rankedEvent({ event: item, verified: verifiedTickets, movements,
      selectedProviders: selectedProviderIds, observationPolicy: observedStakePolicy(baseStake), nowMs }))),
  [baseStake, movements, nowMs, selectedProviderIds, verifiedTickets, visibleEvents]);
  const displayEvents = rankedEvents.map((item) => item.event);
  const rankedByEvent = new Map(rankedEvents.map((item) => [item.event.key, item]));
  const hiddenNonComparableCount = visibleEvents.length - rankedEvents.length;
  const crossBookEventCount = rankedEvents.filter((item) => item.tickets.length > 0).length;
  useEffect(() => {
    const emitted = profitAlertTracker.current.update(rankedEvents, Date.now());
    if (emitted.length > 0) setProfitAlerts((current) => [...current, ...emitted].slice(-20));
  }, [rankedEvents]);
  useEffect(() => () => notificationSound.current?.dispose(), []);
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
      highlightTicketKey={highlightTicketKey} rankedTickets={rankedByEvent.get(selectedEvent.key)?.tickets ?? []}
      lagSignals={signals.filter((signal) => signal.event.key === selectedEvent.key)}
      onBack={() => { window.history.replaceState({}, "", window.location.pathname); setSelectedKey(null); setHighlightTicketKey(null); }}
      providerEventId={selectedEvent.providerEventIds[primary.provider]!} />;
  }

  const invalidateVerifiedTickets = (): void => {
    preflightCoordinator.current.clear();
    setVerifiedTickets(new Map());
  };
  const toggle = (id: string): void => {
    invalidateVerifiedTickets();
    setSelectedIds((current) => {
    const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next;
    });
  };
  const changeCategory = (next: CatalogCategory): void => {
    setCategory(next); setCatalogs([]); catalogsRef.current = []; setStaleAccountIds(new Set());
    saveCatalogCategory(window.localStorage, next);
    setSignals([]); setMovements([]); setMessage(null); setSelectedKey(null); setVerifiedTickets(new Map());
    preflightCoordinator.current.clear();
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
    setHighlightTicketKey(null);
  };
  const openProfitAlert = (alert: ProfitAlert): void => {
    const primary = alert.event.catalogs[0];
    if (primary === undefined) return;
    const eventId = alert.event.providerEventIds[primary.provider];
    if (eventId === undefined) return;
    const query = new URLSearchParams({ event: eventId, account: primary.accountId, ticket: alert.ticket.key });
    window.history.replaceState({}, "", `${window.location.pathname}?${query.toString()}`);
    setHighlightTicketKey(alert.ticket.key);
    setSelectedKey(alert.event.key);
  };

  return <>
    <header className="page-header"><p className="eyebrow">{category === "FOOTBALL" ? "Football" : "League of Legends"} · immediate two-book lag monitor</p>
      <h1>{category === "FOOTBALL" ? "Football Live Price Gaps" : "LoL Live Price Gaps"}</h1>
      <p>Only exact two-outcome markets shared by at least two selected books can produce a signal.</p></header>
    <section className="catalog-toolbar" aria-label="Catalog controls">
      {fixedCategory === undefined && <div className="category-switch" role="group" aria-label="Category"><button aria-pressed={category === "FOOTBALL"}
        onClick={() => changeCategory("FOOTBALL")} type="button">Football</button><button aria-pressed={category === "LOL"}
        onClick={() => changeCategory("LOL")} type="button">LoL</button></div>}
      <ProviderSelector accounts={categoryAccounts} loaded={accountsLoaded} selected={selectedIds} toggle={toggle} />
      <label className="stake-config">Base stake for every match (VND)<input aria-label="Base stake for every match (VND)"
        inputMode="numeric" min="30000" step="1000" type="number" value={baseStakeInput} onChange={(event) => {
          const value = event.currentTarget.value; setBaseStakeInput(value);
          if (saveBaseStake(window.localStorage, value)) {
            invalidateVerifiedTickets(); setBaseStake(value); setStakeError(null);
          }
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
    <ProfitToastStack alerts={profitAlerts} onOpen={openProfitAlert} sound={notificationSound.current} />
    <div className="catalog-event-list">{displayEvents.map((item) => {
      const ranked = rankedByEvent.get(item.key)!;
      const label = `${item.event.participantA} vs ${item.event.participantB}`;
      const observedAtMs = item.catalogs.find((catalog) => catalog.provider === item.event.provider)?.observedAtMs ??
        item.catalogs[0]!.observedAtMs;
      const estimatedStartAtMs = estimatedLiveStartAtMs(observedAtMs, item.event.liveState);
      const comparisonCount = ranked.tickets.length;
      return <article className="catalog-event" key={item.key}><header><div><span>{item.event.competition}</span><h2>{label}</h2>
        <div className="provider-tags">{item.providers.map((provider) => <b key={provider}>#{provider}</b>)}
          {item.event.category === "FOOTBALL" && item.event.isVirtual === true && <b>#VIRTUAL</b>}</div>
        <small>{comparisonCount > 0 ? `${comparisonCount} exact two-outcome ticket(s) · top 5 by guaranteed profit` :
          "No exact two-book ticket shared by the selected providers"}</small>
        {ranked.bestVerifiedProfit !== null && <strong>Best guaranteed {money(ranked.bestVerifiedProfit)}</strong>}</div>
        <div className="catalog-event-actions"><strong>{item.event.isLive ? formatMatchClock(item.event.liveState) : formatCountdown(item.event.startAtUtcMs, nowMs)}</strong>
          {item.event.isLive ? <><small>Observed {new Date(observedAtMs).toLocaleString()}</small>
            {estimatedStartAtMs !== null && <small>Approx. started {new Date(estimatedStartAtMs).toLocaleString()}</small>}</>
            : <small>Scheduled {new Date(item.event.startAtUtcMs).toLocaleString()}</small>}
          <button aria-label={`View & watch ${label}`} onClick={() => watch(item)} type="button">View & compare</button></div></header>
        {comparisonCount > 0 && <details className="catalog-market-details" open><summary>Exact tickets being monitored</summary>
          <RankedTicketTable event={item.event} providers={item.providers} tickets={ranked.tickets} /></details>}</article>;
    })}</div>
  </>;
}
