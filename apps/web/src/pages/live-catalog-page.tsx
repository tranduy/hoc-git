import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { AccountStatus, CatalogSourceStatus, Category, ProviderId } from "@tool-chenh/contracts";
import { AccountApi, type AccountApiLike } from "../api/accounts.js";
import { CatalogApi, catalogRetryDelayMs, type CatalogApiLike, type CatalogReadResult,
  type LiveCatalogResponse } from "../api/catalog.js";
import type { CatalogRealtimeFeed } from "../api/client.js";
import type { CatalogSourceApiLike } from "../api/catalog-sources.js";
import { ProviderFreshnessStrip } from "../components/provider-freshness-strip.js";
import { defaultProviderPreflightApi, type ProviderPreflightApiLike } from "../api/provider-preflight.js";
import { loadCatalogCache, saveCatalogCache } from "../catalog/catalog-cache.js";
import { decimalOdds, formatCountdown, formatMatchClock,
  isVisibleEvent, matchesEventPhase, observedTicketAsComparisonRow, selectionLabel, ticketMarketLabel,
  type ComparisonEvent, type ComparisonRow, type EventPhase } from "../catalog/comparison.js";
import { formatDisplayDecimal } from "../catalog/display-format.js";
import { PROVIDER_DISPLAY_ORDER, sortProviderItems } from "../catalog/provider-order.js";
import { MatchWatchDetail, type ComparisonBook } from "../components/match-watch-detail.js";
import { ProfitToastStack } from "../components/profit-toast-stack.js";
import { ProviderBrand } from "../components/provider-brand.js";
import { RoiBadge } from "../components/roi-badge.js";
import { MaintenanceControls } from "../components/maintenance-controls.js";
import { buildObservedFixedBaseStakeEstimate,
  type FixedBaseStakePolicy } from "../watch/fixed-base-stake.js";
import { LagSignalTracker, type LagSignal } from "../watch/lag-signal-tracker.js";
import { PriceMovementTracker, type ObservedPriceMovement } from "../watch/price-movement-tracker.js";
import { eventEdgeSummary, rankedEvent, sortRankedEvents, ticketEdgeSummary, topRankedTicketItems,
  type RankedEvent } from "../watch/ranked-tickets.js";
import { roiTone } from "../watch/roi-tone.js";
import { useNotificationSound } from "../watch/use-notification-sound.js";
import { ProfitAlertTracker, type ProfitAlert } from "../watch/profit-alert-tracker.js";
import { loadBaseStake, saveBaseStake } from "../watch/stake-settings.js";
import { loadSoundEnabled, saveSoundEnabled } from "../watch/sound-settings.js";
import { captureScrollAnchor, restoreScrollAnchor, type ScrollAnchor } from "../watch/stable-scroll-anchor.js";
import { TicketPreflightCoordinator, type VerifiedTicketEvidence } from "../watch/ticket-preflight-coordinator.js";
import { ProviderTicketApi, type ProviderTicketApiLike, type ProviderTicketIdentity } from "../api/provider-ticket.js";
import type { TicketReportApiLike } from "../api/ticket-report.js";
import { CatalogRevisionCoordinator } from "../catalog/catalog-revision-coordinator.js";
import { ComparisonWorkerClient, type HydratedComparisonWorkerOutput } from "../catalog/comparison-worker-client.js";

const defaultAccountApi = new AccountApi();
const defaultCatalogApi = new CatalogApi();
const defaultProviderTicketApi = new ProviderTicketApi();
const comparisonProviders: readonly ProviderId[] = PROVIDER_DISPLAY_ORDER.filter((provider) => provider !== "FABET");
const catalogFailureGraceMs = 5_000;
const executableProfileMaxAgeMs = 30_000;
const catalogCategoryStorageKey = "tool-chenh.live-catalog.category.v1";
const eventPhaseStorageKey = "tool-chenh.live-catalog.event-phase.v1";
type CatalogCategory = "FOOTBALL" | "LOL";

/**
 * The comparison key intentionally includes live score evidence, so it can
 * change while a match is in progress.  Keep the user's selection tied to the
 * provider's immutable event id instead of that derived key.
 */
interface PinnedEventIdentity {
  readonly accountId: string;
  readonly provider: ProviderId;
  readonly providerEventId: string;
}

function formatSummaryOdds(value: string): string {
  return formatDisplayDecimal(value);
}

function catalogRevision(catalog: LiveCatalogResponse): string {
  const events = catalog.events.map((event) => [event.providerEventId, event.startAtUtcMs, event.isLive,
    event.participantA, event.participantB].join(":"));
  const markets = catalog.markets.map((market) => [market.providerMarketId, market.status, market.line].join(":"));
  const quotes = catalog.quotes.map((quote) => [quote.providerMarketId, quote.providerSelectionId, quote.rawOdds,
    quote.status, quote.sequence, quote.sourceTimestampMs].join(":"));
  return [catalog.observedAtMs, catalog.snapshotState ?? "FRESH", catalog.rejectedMarketCount,
    ...events, ...markets, ...quotes].join("|");
}

function sameStringSet(left: ReadonlySet<string>, right: ReadonlySet<string>): boolean {
  return left.size === right.size && [...left].every((value) => right.has(value));
}

function catalogReadPriority(id: string): number {
  const provider = /^catalog-source:([^:]+):/u.exec(id)?.[1];
  return ({ APSPORT: 0, SBOBET: 1, IM: 2, BTI: 3, SABA: 4, CMD: 5 } as Readonly<Record<string, number>>)
    [provider ?? ""] ?? 10;
}

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

function loadEventPhases(storage: Storage): ReadonlySet<EventPhase> {
  try {
    const saved = storage.getItem(eventPhaseStorageKey);
    if (saved === null) return new Set<EventPhase>(["LIVE", "PREMATCH"]);
    const phases = new Set<EventPhase>();
    if (saved.includes("LIVE")) phases.add("LIVE");
    if (saved.includes("PREMATCH")) phases.add("PREMATCH");
    return phases;
  } catch {
    return new Set<EventPhase>(["LIVE", "PREMATCH"]);
  }
}

function saveEventPhases(storage: Storage, phases: ReadonlySet<EventPhase>): void {
  try { storage.setItem(eventPhaseStorageKey, [...phases].sort().join(",")); } catch { /* storage is optional */ }
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

export function selectBettingAccount(
  accounts: readonly AccountStatus[], provider: ProviderId, category: Category
): AccountStatus | null {
  return [...accounts].filter((account) => account.provider === provider && account.category === category &&
    account.sessionState === "ACTIVE" && account.profileState === "FRESH" &&
    account.capabilities.includes("PROFILE") && account.capabilities.includes("PREFLIGHT") &&
    account.currency !== null && account.balance !== null && account.balanceAsOfMs !== null)
    .sort((left, right) => right.balanceAsOfMs! - left.balanceAsOfMs! || right.id.localeCompare(left.id))[0] ?? null;
}

function selectProfileAccount(
  accounts: readonly AccountStatus[], provider: ProviderId, category: Category
): AccountStatus | null {
  return [...accounts].filter((account) => account.provider === provider && account.category === category &&
    account.sessionState === "ACTIVE" && account.capabilities.includes("PROFILE"))
    .sort((left, right) => (right.balanceAsOfMs ?? -1) - (left.balanceAsOfMs ?? -1) ||
      right.id.localeCompare(left.id))[0] ?? null;
}

function legacyCatalogSources(accounts: readonly AccountStatus[]): readonly CatalogSourceStatus[] {
  return oneAccountPerProvider(accounts).map((account) => ({
    id: account.id,
    alias: account.alias,
    provider: account.provider as Exclude<ProviderId, "FABET">,
    category: account.category!,
    sessionState: account.sessionState,
    acquiredAtMs: account.balanceAsOfMs,
    reason: account.reason
  }));
}

function wholeUnits(value: string): bigint | null {
  const match = /^(0|[1-9]\d*)(?:\.\d+)?$/u.exec(value);
  return match === null ? null : BigInt(match[1]!);
}

export function filterAccountBackedSignals(
  signals: readonly LagSignal[], acceptedCatalogs: readonly LiveCatalogResponse[],
  accounts: readonly AccountStatus[], observedAtMs: number
): readonly LagSignal[] {
  const accountByProvider = new Map<ProviderId, AccountStatus>();
  for (const catalog of acceptedCatalogs) {
    const account = selectBettingAccount(accounts, catalog.provider, catalog.category);
    if (account !== null) accountByProvider.set(catalog.provider, account);
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

function matchCountLabel(count: number): string {
  return `${count} ${count === 1 ? "match" : "matches"}`;
}

function ProviderSelector({ accounts, eventCounts, loaded, selected, toggle }: {
  readonly accounts: readonly CatalogSourceStatus[];
  readonly eventCounts: ReadonlyMap<string, number>;
  readonly loaded: boolean;
  readonly selected: ReadonlySet<string>;
  readonly toggle: (id: string) => void;
}) {
  return <fieldset className="provider-selector"><legend>Books to compare</legend>{comparisonProviders.flatMap((provider) => {
    const providerAccounts = accounts.filter((account) => account.provider === provider);
    if (providerAccounts.length === 0) return [<label className="provider-selector__unavailable" key={provider}>
      <input aria-label={`${provider} ${loaded ? "unavailable" : "loading"}`} disabled type="checkbox" />
      <ProviderBrand compact provider={provider} /><span className="provider-selector__match-count">(0 matches)</span>
      <small>{loaded ? "not connected" : "loading source…"}</small></label>];
    const activeAccounts = providerAccounts.filter((account) => account.sessionState === "ACTIVE");
    if (activeAccounts.length === 0) {
      const detail = providerAccounts.some((account) => account.reason === "EXPIRED") ? "nguồn hết hạn"
        : providerAccounts.some((account) => account.reason === "SCHEMA_CHANGED") ? "lỗi schema nguồn"
        : "nguồn không hoạt động";
      const count = providerAccounts.reduce((total, account) => total + (eventCounts.get(account.id) ?? 0), 0);
      return [<label className="provider-selector__unavailable" key={provider}>
        <input aria-label={`${provider} ${detail}`} disabled type="checkbox" />
        <ProviderBrand compact provider={provider} /><span className="provider-selector__match-count">({matchCountLabel(count)})</span>
        <small>{detail}</small></label>];
    }
    return activeAccounts.map((account) => <label key={account.id}><input checked={selected.has(account.id)}
      onChange={() => toggle(account.id)} type="checkbox" /><ProviderBrand compact label={account.alias} provider={account.provider} />
      <span className="provider-selector__match-count">({matchCountLabel(eventCounts.get(account.id) ?? 0)})</span></label>);
  })}</fieldset>;
}

function ProviderSourceStatus({ accounts, bettingAccounts, category, selected }: {
  readonly accounts: readonly CatalogSourceStatus[]; readonly bettingAccounts: readonly AccountStatus[];
  readonly category: CatalogCategory; readonly selected: ReadonlySet<string> }) {
  const activeCount = comparisonProviders.filter((provider) => accounts.some((account) =>
    account.provider === provider && account.sessionState === "ACTIVE" && selected.has(account.id))).length;
  return <details className="provider-source-status-panel"><summary>Nguồn dữ liệu · {activeCount}/{comparisonProviders.length} sàn đang chọn</summary>
    <section className="provider-source-status" aria-label="Trạng thái nguồn dữ liệu">{comparisonProviders.map((provider) => {
    const matches = accounts.filter((account) => account.provider === provider);
    const active = matches.filter((account) => account.sessionState === "ACTIVE" && selected.has(account.id)).length;
    const selectedSource = active > 0;
    const profile = selectProfileAccount(bettingAccounts, provider, category);
    const profileReady = selectedSource && profile?.profileState === "FRESH" &&
      profile.currency !== null && profile.balance !== null;
    const bettingReady = selectedSource && selectBettingAccount(bettingAccounts, provider, category) !== null;
    const state = active > 0 ? bettingReady
      ? `${active} nguồn giá + profile cược đã xác minh`
      : profileReady ? `${active} nguồn giá + profile đã xác minh; preflight vé chưa có`
      : `${active} nguồn giá; đăng nhập cược/số dư chưa xác minh`
      : matches.some((account) => account.reason === "EXPIRED") ? "Nguồn hết hạn — cần đăng nhập/lấy launch mới"
      : matches.some((account) => account.reason === "SCHEMA_CHANGED") ? "Lỗi nguồn/schema — không phải không có trận"
      : matches.length > 0 ? "Nguồn không hoạt động — không phải không có trận" : "Chưa cấu hình nguồn";
    return <span className={active > 0 && bettingReady ? "source-state source-state--active" : "source-state source-state--error"}
      key={provider}><ProviderBrand compact provider={provider} />{state}</span>;
  })}</section></details>;
}

function observedStakePolicy(baseStake: string): FixedBaseStakePolicy {
  // This policy powers the read-only calculator only. Do not apply an assumed
  // provider minimum here: the balanced opposite leg can legitimately be
  // smaller than the user's anchor stake. Executable plans still fail closed
  // against the separately verified provider constraints below.
  return { currency: "VND", baseStake, minStake: "1000", maxStake: "1000000000000",
    stakeStep: "1", balance: "1000000000000" };
}

function executableStakePolicy(baseStake: string): FixedBaseStakePolicy {
  return { ...observedStakePolicy(baseStake), requireProviderConstraints: true, providerConstraints: {} };
}

function money(value: string): string {
  return `${Number(value).toLocaleString("en-US")} VND`;
}

function SelectedTicketBalance({ ranked }: { readonly ranked: RankedEvent }) {
  const edge = eventEdgeSummary(ranked);
  const ticket = edge === null ? null : ranked.tickets.find((item) => item.key === edge.ticketKey);
  const plan = ticket?.plan ?? null;
  if (edge === null || ticket === undefined || plan === null) return null;
  const orderedLegs = sortProviderItems(plan.legs, (leg) => leg.provider);
  return <section aria-label="Selected ticket balance" className="selected-ticket-balance">
    <header><div><small>Selected exact two-book ticket</small>
      <h2>{ranked.event.event.participantA} vs {ranked.event.event.participantB}</h2>
      <p>{edge.marketType} · {edge.line === null ? "No line" : `Line ${edge.line}`}</p></div>
      <div className={`selected-ticket-balance__roi ${edge.state === "VERIFIED_PROFIT" ? "selected-ticket-balance__roi--verified" : ""}`}>
        <RoiBadge roiPercent={edge.roiPercent} size="lg" />
        <small>{edge.state === "OBSERVATION" ? "READ-ONLY ESTIMATE" : "PREFLIGHT VERIFIED"}</small>
      </div></header>
    <div className="selected-ticket-balance__legs">{orderedLegs.map((leg) => <article key={`${leg.provider}-${leg.selection}`}>
      <ProviderBrand compact provider={leg.provider} /><strong>{selectionLabel(ranked.event.event, leg.selection)} @ {formatDisplayDecimal(leg.decimalOdds)}</strong>
      <span>Stake {money(leg.stake)}</span><small>If this outcome wins: {money(leg.profit)}</small>
    </article>)}</div>
    <footer><span>Total stake {money(plan.totalStake)}</span><strong>Worst-case: {money(plan.worstCaseProfit)}</strong>
      <small>No order is submitted from this screen.</small></footer>
  </section>;
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
            key={quote.providerSelectionId}>{selectionLabel(item.event, quote.selection)} · {formatDisplayDecimal(quote.rawOdds)} {quote.rawFormat}
              {decimalOdds(quote) === null ? "" : ` · decimal ${decimalOdds(quote)!.toFixed(3)}`} · {quote.status}</span>)}</div>}</td>;
      })}<td><RateGapSummary event={item.event} row={displayRow} />{plan === null ? <span className="rate-missing">Chưa đủ hai giá đối nghịch từ hai sàn để tính tiền</span>
        : <div className={verifiedPlan === null ? "balanced-plan balanced-plan--estimate" : "balanced-plan"}><strong>{verifiedPlan === null ? "ƯỚC TÍNH QUAN SÁT · SETTLEMENT CHƯA XÁC MINH" :
          signal === undefined ? "GIÁ HIỆN TẠI" : "SẴN SÀNG (READ-ONLY)"}</strong>{plan.legs.map((leg) => <span key={leg.selection}>
          <small>#{leg.provider} · {selectionLabel(item.event, leg.selection)} @ {formatDisplayDecimal(leg.decimalOdds)}</small><b>{money(leg.stake)} {leg.role.toLowerCase()}</b>
        </span>)}<span>Total {money(plan.totalStake)}</span>{plan.legs.map((leg) => <span key={`${leg.selection}-profit`}>
          <small>Nếu {selectionLabel(item.event, leg.selection)} thắng</small><b>Lãi/lỗ {money(leg.profit)}</b></span>)}
          <b>Worst {money(plan.worstCaseProfit)}</b><RoiBadge roiPercent={Number(plan.roi) * 100} size="sm" /></div>}</td></tr>;
    })}
  </tbody></table></div>;
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
    <div className="lag-alert-toast__market">{visible.row.marketType}{visible.row.line === null ? "" : ` · Line ${visible.row.line}`} <RoiBadge roiPercent={Number(visible.plan.roi) * 100} size="sm" /></div>
    <p>Worst profit {money(visible.plan.worstCaseProfit)} · verify both legs before execution</p>
  </aside>;
}

export function LiveCatalogPage({ accountApi = defaultAccountApi, catalogApi = defaultCatalogApi,
  catalogSourceApi, providerPreflightApi = defaultProviderPreflightApi,
  providerTicketApi = defaultProviderTicketApi, ticketReportApi, fixedCategory, catalogRealtime, freshnessApi }: {
  readonly accountApi?: AccountApiLike;
  readonly catalogApi?: CatalogApiLike;
  readonly catalogSourceApi?: CatalogSourceApiLike;
  readonly providerPreflightApi?: ProviderPreflightApiLike;
  readonly providerTicketApi?: ProviderTicketApiLike;
  readonly ticketReportApi?: TicketReportApiLike;
  readonly fixedCategory?: CatalogCategory;
  readonly catalogRealtime?: CatalogRealtimeFeed;
  /**
   * Optional dedicated client for the provider freshness strip. It polls
   * independently of the comparison read loop so it never competes with or
   * alters the catalog source reads above.
   */
  readonly freshnessApi?: CatalogSourceApiLike;
}) {
  const [accounts, setAccounts] = useState<readonly AccountStatus[]>([]);
  const [sources, setSources] = useState<readonly CatalogSourceStatus[]>([]);
  const [accountsLoaded, setAccountsLoaded] = useState(false);
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(new Set());
  const [category, setCategory] = useState<CatalogCategory>(() => fixedCategory ?? loadCatalogCategory(window.localStorage));
  const [eventPhases, setEventPhases] = useState<ReadonlySet<EventPhase>>(() => loadEventPhases(window.localStorage));
  const [catalogs, setCatalogs] = useState<readonly LiveCatalogResponse[]>([]);
  const [comparisonEvents, setComparisonEvents] = useState<readonly ComparisonEvent[]>([]);
  const [staleAccountIds, setStaleAccountIds] = useState<ReadonlySet<string>>(new Set());
  const [signals, setSignals] = useState<readonly LagSignal[]>([]);
  const [movements, setMovements] = useState<readonly ObservedPriceMovement[]>([]);
  const [verifiedTickets, setVerifiedTickets] = useState<ReadonlyMap<string, VerifiedTicketEvidence>>(new Map());
  const [busy, setBusy] = useState(false);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [pinnedEvent, setPinnedEvent] = useState<ComparisonEvent | null>(null);
  const [pinnedEventIdentity, setPinnedEventIdentity] = useState<PinnedEventIdentity | null>(null);
  const [highlightTicketKey, setHighlightTicketKey] = useState<string | null>(() =>
    new URLSearchParams(window.location.search).get("ticket"));
  const [profitAlerts, setProfitAlerts] = useState<readonly ProfitAlert[]>([]);
  const [nowMs, setNowMs] = useState(Date.now());
  const [baseStake, setBaseStake] = useState(() => loadBaseStake(window.localStorage));
  const [baseStakeInput, setBaseStakeInput] = useState(baseStake);
  const [stakeError, setStakeError] = useState<string | null>(null);
  const [openProviderTicketEnabled, setOpenProviderTicketEnabled] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(() => loadSoundEnabled(window.localStorage));
  const baseStakeRef = useRef(baseStake);
  baseStakeRef.current = baseStake;
  const signalTracker = useRef(new LagSignalTracker());
  const movementTracker = useRef(new PriceMovementTracker());
  const preflightCoordinator = useRef(new TicketPreflightCoordinator(providerPreflightApi));
  const profitAlertTracker = useRef(new ProfitAlertTracker());
  const notificationSound = useNotificationSound();
  const catalogsRef = useRef<readonly LiveCatalogResponse[]>([]);
  const matchListRef = useRef<HTMLDivElement>(null);
  const matchListAnchorRef = useRef<ScrollAnchor | null>(null);
  const staleAccountIdsRef = useRef<ReadonlySet<string>>(new Set());
  const accountsRef = useRef<readonly AccountStatus[]>([]);
  const sourcesRef = useRef<readonly CatalogSourceStatus[]>([]);
  const catalogRefreshesInFlight = useRef(new Set<string>());
  const foregroundLoadsInFlight = useRef(0);
  const retryAfterMs = useRef(new Map<string, number>());
  const comparisonWorkerRef = useRef<ComparisonWorkerClient | null>(null);
  const revisionCoordinatorRef = useRef<CatalogRevisionCoordinator | null>(null);
  const latestPreflightGeneration = useRef(0);
  const requested = useRef({ account: new URLSearchParams(window.location.search).get("account"),
    event: new URLSearchParams(window.location.search).get("event"),
    ticket: new URLSearchParams(window.location.search).get("ticket") });
  const autoLoaded = useRef(false);
  const sourcesInitialized = useRef(false);
  const categorySources = useMemo(() => sources.filter((source) => source.category === category), [sources, category]);
  const categorySelectedIds = useMemo(() => categorySources.filter((source) => selectedIds.has(source.id))
    .map((source) => source.id), [categorySources, selectedIds]);

  useEffect(() => {
    const worker = new ComparisonWorkerClient({
      onResult: (output: HydratedComparisonWorkerOutput) => {
        setComparisonEvents(output.displayEvents);
        latestPreflightGeneration.current = output.generation;
        const freshCatalogs = catalogsRef.current.filter((catalog) =>
          !staleAccountIdsRef.current.has(catalog.accountId));
        const providers = new Set<ProviderId>(freshCatalogs.map((catalog) => catalog.provider));
        const observedAtMs = freshCatalogs.reduce((latest, catalog) =>
          Math.max(latest, catalog.observedAtMs), 0) || Date.now();
        const candidates = signalTracker.current.update(output.freshEvents, providers,
          executableStakePolicy(baseStakeRef.current), observedAtMs);
        setSignals(filterAccountBackedSignals(candidates, freshCatalogs, accountsRef.current, observedAtMs));
        setMovements(movementTracker.current.update(output.freshEvents, observedAtMs));
        const selectedAccounts = freshCatalogs.flatMap((catalog) => {
          const bettor = selectBettingAccount(accountsRef.current, catalog.provider, catalog.category);
          return bettor === null ? [] : [bettor];
        });
        void preflightCoordinator.current.refresh({ events: output.freshEvents,
          selectedAccounts, selectedProviders: providers,
          policy: observedStakePolicy(baseStakeRef.current) }).then((verified) => {
          if (latestPreflightGeneration.current === output.generation) setVerifiedTickets(verified);
        });
      }
    });
    comparisonWorkerRef.current = worker;
    worker.reset(catalogsRef.current, [...staleAccountIdsRef.current]);
    return () => {
      comparisonWorkerRef.current = null;
      worker.stop();
    };
  }, []);

  useEffect(() => {
    let active = true;
    void providerTicketApi.features().then((features) => {
      if (active) setOpenProviderTicketEnabled(features.openProviderTicket);
    }).catch(() => { if (active) setOpenProviderTicketEnabled(false); });
    return () => { active = false; };
  }, [providerTicketApi]);

  const openProviderTicket = (identity: ProviderTicketIdentity): void => {
    void providerTicketApi.focus(identity).catch(() => undefined);
  };

  const readCatalog = useCallback(async (accountId: string): Promise<CatalogReadResult> => {
    if (catalogApi.readRevision !== undefined) return catalogApi.readRevision(accountId);
    const catalog = await catalogApi.read(accountId);
    return { catalog, revision: catalogRevision(catalog) };
  }, [catalogApi]);

  const acceptRealtimeCatalog = useCallback((result: CatalogReadResult): void => {
    const catalog = result.catalog;
    const source = sourcesRef.current.find((candidate) => candidate.id === catalog.accountId);
    if (source === undefined || source.category !== catalog.category || source.provider !== catalog.provider) return;
    const previous = catalogsRef.current.find((candidate) => candidate.accountId === catalog.accountId);
    if (previous !== undefined && catalog.observedAtMs < previous.observedAtMs) return;
    const nextCatalogs = [catalog, ...catalogsRef.current.filter((candidate) =>
      candidate.accountId !== catalog.accountId)];
    const nextStale = new Set(staleAccountIdsRef.current);
    if (catalog.snapshotState === "STALE") nextStale.add(catalog.accountId);
    else nextStale.delete(catalog.accountId);
    const changed = previous === undefined || catalogRevision(previous) !== catalogRevision(catalog) ||
      !sameStringSet(staleAccountIdsRef.current, nextStale);
    if (!changed) return;
    catalogsRef.current = nextCatalogs;
    staleAccountIdsRef.current = nextStale;
    retryAfterMs.current.delete(catalog.accountId);
    saveCatalogCache(window.localStorage, nextCatalogs);
    setCatalogs(nextCatalogs);
    setStaleAccountIds(nextStale);
    comparisonWorkerRef.current?.upsert(catalog, nextStale.has(catalog.accountId));
  }, []);
  const readCatalogRef = useRef(readCatalog);
  const acceptRealtimeCatalogRef = useRef(acceptRealtimeCatalog);
  readCatalogRef.current = readCatalog;
  acceptRealtimeCatalogRef.current = acceptRealtimeCatalog;

  useEffect(() => {
    const coordinator = new CatalogRevisionCoordinator({
      read: (accountId) => readCatalogRef.current(accountId),
      onCatalog: (result) => acceptRealtimeCatalogRef.current(result),
      onError: (accountId, error) => retryAfterMs.current.set(accountId,
        Date.now() + catalogRetryDelayMs(error))
    });
    revisionCoordinatorRef.current = coordinator;
    return () => {
      if (revisionCoordinatorRef.current === coordinator) revisionCoordinatorRef.current = null;
      coordinator.stop();
    };
  }, []);

  const loadIds = useCallback(async (
    ids: readonly string[], foreground: boolean, expectedCategory: CatalogCategory
  ): Promise<void> => {
    const requestedIds = ids.filter((id) => !catalogRefreshesInFlight.current.has(id) &&
      (foreground || (retryAfterMs.current.get(id) ?? 0) <= Date.now()))
      .sort((left, right) => catalogReadPriority(left) - catalogReadPriority(right));
    if (requestedIds.length === 0) return;
    for (const id of requestedIds) catalogRefreshesInFlight.current.add(id);
    if (foreground) {
      foregroundLoadsInFlight.current += 1;
      setBusy(true);
    }
    try {
      const results = await Promise.allSettled(requestedIds.map((id) => (async () => {
        const requestedSource = sourcesRef.current.find((source) => source.id === id);
        if (requestedSource === undefined) throw new Error("Catalog source is unavailable");
        const legacyFallbackIds = catalogSourceApi === undefined ? accountsRef.current.filter((account) =>
          account.id !== id && account.provider === requestedSource.provider && account.category === expectedCategory &&
          account.sessionState === "ACTIVE" && account.capabilities.includes("CATALOG")).map((account) => account.id) : [];
        let value: CatalogReadResult | null = null;
        let lastError: unknown = new Error("Catalog source is unavailable");
        for (const candidateId of [id, ...legacyFallbackIds].slice(0, 3)) {
          try {
            const candidateResult = await readCatalog(candidateId);
            const candidate = candidateResult.catalog;
            if (candidate.category !== expectedCategory || candidate.provider !== requestedSource.provider ||
              (catalogSourceApi !== undefined && candidate.accountId !== id)) throw new Error("Catalog identity mismatch");
            value = candidateResult;
            break;
          } catch (error) {
            lastError = error;
          }
        }
        if (value === null) throw lastError;
        return value;
      })().finally(() => catalogRefreshesInFlight.current.delete(id))));
      const completedResults = results.flatMap((result) => result.status === "fulfilled" &&
        result.value.catalog.category === expectedCategory ? [result.value] : []);
      for (const result of completedResults) {
        revisionCoordinatorRef.current?.setHeldRevision(result.catalog.accountId, result.revision);
      }
      const completed = completedResults.map((result) => result.catalog);
      const previousByAccount = new Map(catalogsRef.current.map((catalog) => [catalog.accountId, catalog]));
      // Provider reads overlap intentionally so a fast book is not blocked by a
      // slow one. A slower, older batch must never roll an account back after a
      // newer poll has already committed, otherwise exact pairs blink out and
      // back in on every alternating response.
      const accepted = completed.filter((candidate) => {
        const previous = previousByAccount.get(candidate.accountId);
        if (previous === undefined || candidate.observedAtMs > previous.observedAtMs) return true;
        return candidate.observedAtMs === previous.observedAtMs &&
          catalogRevision(candidate) === catalogRevision(previous);
      });
      const supersededIds = new Set(completed.filter((candidate) => !accepted.includes(candidate))
        .map((candidate) => candidate.accountId));
      const failedIds = new Set(requestedIds.filter((_id, index) => {
        const result = results[index];
        return result?.status !== "fulfilled" || result.value.catalog.category !== expectedCategory;
      }));
      for (const [index, id] of requestedIds.entries()) {
        if (failedIds.has(id)) {
          const result = results[index];
          retryAfterMs.current.set(id, Date.now() + catalogRetryDelayMs(result?.status === "rejected" ? result.reason : undefined));
        }
        else retryAfterMs.current.delete(id);
      }
      const preserved = catalogsRef.current.filter((catalog) =>
        (!requestedIds.includes(catalog.accountId) || failedIds.has(catalog.accountId) ||
          supersededIds.has(catalog.accountId)) &&
        !accepted.some((candidate) => candidate.accountId === catalog.accountId));
      const nextCatalogs = [...accepted, ...preserved];
      const nextStale = new Set(staleAccountIdsRef.current);
      for (const catalog of accepted) {
        if (catalog.snapshotState === "STALE") nextStale.add(catalog.accountId);
        else nextStale.delete(catalog.accountId);
      }
      for (const id of failedIds) {
        const previous = nextCatalogs.find((catalog) => catalog.accountId === id);
        const ageMs = previous === undefined ? Number.POSITIVE_INFINITY : Date.now() - previous.observedAtMs;
        if (previous !== undefined && (!Number.isFinite(ageMs) || ageMs < 0 || ageMs > catalogFailureGraceMs)) {
          nextStale.add(id);
        }
      }
      const catalogsChanged = nextCatalogs.length !== catalogsRef.current.length || nextCatalogs.some((catalog) => {
        const previous = previousByAccount.get(catalog.accountId);
        return previous === undefined || catalogRevision(previous) !== catalogRevision(catalog);
      });
      const freshnessChanged = !sameStringSet(staleAccountIdsRef.current, nextStale);
      if (!catalogsChanged && !freshnessChanged) return;
      catalogsRef.current = nextCatalogs;
      saveCatalogCache(window.localStorage, nextCatalogs);
      setCatalogs(nextCatalogs);
      staleAccountIdsRef.current = nextStale;
      setStaleAccountIds(nextStale);
      if (accepted.length === 1 && requestedIds.length === 1) {
        comparisonWorkerRef.current?.upsert(accepted[0]!, nextStale.has(accepted[0]!.accountId));
      } else comparisonWorkerRef.current?.reset(nextCatalogs, [...nextStale]);
    } finally {
      for (const id of requestedIds) catalogRefreshesInFlight.current.delete(id);
      if (foreground) {
        foregroundLoadsInFlight.current = Math.max(0, foregroundLoadsInFlight.current - 1);
        setBusy(foregroundLoadsInFlight.current > 0);
      }
    }
  }, [catalogSourceApi, readCatalog]);

  useEffect(() => {
    let cancelled = false;
    let sourceRetryTimer: number | undefined;
    let accountRetryTimer: number | undefined;
    const activateSources = (nextSources: readonly CatalogSourceStatus[]): void => {
      if (cancelled) return;
      const previousSources = sourcesRef.current;
      sourcesRef.current = nextSources;
      setSources(nextSources); setAccountsLoaded(true);
      const availableCandidates = nextSources.filter((source) => source.sessionState === "ACTIVE");
      const targetCategory = fixedCategory ?? category;
      if (sourcesInitialized.current) {
        const previousActive = new Set(previousSources.filter((source) => source.category === targetCategory &&
          source.sessionState === "ACTIVE").map((source) => source.id));
        const newlyActive = availableCandidates.filter((source) => source.category === targetCategory &&
          !previousActive.has(source.id));
        if (newlyActive.length > 0) {
          setSelectedIds((current) => new Set([...current, ...newlyActive.map((source) => source.id)]));
          void loadIds(newlyActive.map((source) => source.id), false, targetCategory);
        }
        return;
      }
      sourcesInitialized.current = true;
      const requestedSource = availableCandidates.find((source) => source.id === requested.current.account &&
        source.category === targetCategory);
      let initialCategory: CatalogCategory = fixedCategory ?? (requestedSource?.category === "LOL" ? "LOL" : category);
      const hasInitialCategory = availableCandidates.some((source) => source.category === initialCategory);
      if (!hasInitialCategory && availableCandidates.some((source) => source.category === "LOL")) initialCategory = "LOL";
      const initial = new Set(availableCandidates.filter((source) => source.category === initialCategory)
        .map((source) => source.id));
      const cached = loadCatalogCache(window.localStorage).filter((catalog) => initial.has(catalog.accountId));
      catalogsRef.current = cached;
      setCatalogs(cached);
      const cachedStale = new Set(cached.map((catalog) => catalog.accountId));
      staleAccountIdsRef.current = cachedStale;
      setStaleAccountIds(cachedStale);
      comparisonWorkerRef.current?.reset(cached, [...cachedStale]);
      setSelectedIds(new Set(availableCandidates.map((source) => source.id)));
      setCategory(initialCategory); saveCatalogCategory(window.localStorage, initialCategory);
      if (!autoLoaded.current && initial.size > 0) {
        autoLoaded.current = true;
        for (const id of [...initial].sort((left, right) =>
          catalogReadPriority(left) - catalogReadPriority(right))) {
          void loadIds([id], true, initialCategory);
        }
      }
    };
    const discoverSources = (): void => {
      if (catalogSourceApi === undefined) return;
      void catalogSourceApi.list().then((nextSources) => {
        activateSources(nextSources);
        if (!cancelled) sourceRetryTimer = window.setTimeout(discoverSources, 2_000);
      }).catch(() => {
        if (cancelled) return;
        setAccountsLoaded(true);
        sourceRetryTimer = window.setTimeout(discoverSources, 2_000);
      });
    };
    const discoverAccounts = (): void => { void accountApi.list().then((items) => {
      if (cancelled) return;
      accountsRef.current = items;
      setAccounts(items);
      if (catalogSourceApi === undefined) {
        activateSources(legacyCatalogSources(items.filter((account) =>
          account.capabilities.includes("CATALOG") && account.category !== null)));
      }
    }).catch(() => {
      if (cancelled) return;
      if (catalogSourceApi === undefined) setAccountsLoaded(true);
      accountRetryTimer = window.setTimeout(discoverAccounts, 2_000);
    }); };
    discoverSources();
    discoverAccounts();
    return () => {
      cancelled = true;
      if (sourceRetryTimer !== undefined) window.clearTimeout(sourceRetryTimer);
      if (accountRetryTimer !== undefined) window.clearTimeout(accountRetryTimer);
    };
  }, [accountApi, catalogSourceApi, fixedCategory, loadIds]);

  useEffect(() => {
    const updateSelection = (): void => revisionCoordinatorRef.current?.setSelected(
      document.visibilityState === "visible" ? categorySelectedIds : []);
    updateSelection();
    document.addEventListener("visibilitychange", updateSelection);
    return () => document.removeEventListener("visibilitychange", updateSelection);
  }, [categorySelectedIds]);

  useEffect(() => {
    if (catalogRealtime?.connectionState === "LIVE" && catalogRealtime.baseline !== null) {
      revisionCoordinatorRef.current?.acceptBaseline(catalogRealtime.baseline.entries, catalogRealtime.baseline.sequence);
    } else revisionCoordinatorRef.current?.setRealtimeUnavailable();
  }, [catalogRealtime?.baseline, catalogRealtime?.connectionState]);

  useEffect(() => {
    const revision = catalogRealtime?.revision;
    if (revision !== null && revision !== undefined) {
      revisionCoordinatorRef.current?.acceptRevision(revision.entry, revision.sequence);
    }
  }, [catalogRealtime?.revision]);

  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);

  const freshCatalogs = useMemo(() => catalogs.filter((catalog) => !staleAccountIds.has(catalog.accountId)),
    [catalogs, staleAccountIds]);
  const eventCounts = useMemo(() => new Map(catalogs.map((catalog) => [catalog.accountId,
    new Set(catalog.events.filter((candidate) => candidate.category === category &&
      (candidate.category !== "FOOTBALL" || candidate.isVirtual === false))
      .map((candidate) => candidate.providerEventId)).size
  ])), [catalogs, category]);
  // Keep the last verified comparison visible through a provider refresh or
  // restart. Stale rows are display-only: signals and preflight above continue
  // to use freshCatalogs exclusively.
  const events = useMemo(() => comparisonEvents.filter((item) =>
    item.event.category === category && !(item.event.category === "FOOTBALL" && item.event.isVirtual !== false)),
  [comparisonEvents, category]);
  const visibleEvents = useMemo(() => events.filter((item) => isVisibleEvent(item.event, nowMs) &&
    matchesEventPhase(item.event, eventPhases)), [events, eventPhases, nowMs]);
  const selectedProviderIds = useMemo(() => new Set<ProviderId>(categorySources.filter((source) =>
    selectedIds.has(source.id)).map((source) => source.provider)),
  [categorySources, selectedIds]);
  const rankedEvents = useMemo(() => {
    const sorted = sortRankedEvents(visibleEvents.filter((item) => item.rows.length > 0)
      .map((item) => rankedEvent({ event: item, verified: verifiedTickets, movements,
        selectedProviders: selectedProviderIds, observationPolicy: observedStakePolicy(baseStake), nowMs }))
      .filter((item) => eventEdgeSummary(item) !== null));
    const seen = new Set<string>();
    return sorted.filter((item) => seen.has(item.event.key) ? false : (seen.add(item.event.key), true));
  }, [baseStake, movements, nowMs, selectedProviderIds, verifiedTickets, visibleEvents]);
  const rankedByEvent = new Map(rankedEvents.map((item) => [item.event.key, item]));
  // This workspace is an exact cross-book comparison list. Never pad it with
  // one-book observations: those rows cannot be balanced across two providers.
  const displayTicketItems = useMemo(() => topRankedTicketItems(rankedEvents, 25), [rankedEvents]);
  const crossBookEventCount = displayTicketItems.length;
  useLayoutEffect(() => {
    const list = matchListRef.current;
    if (list === null) return;
    restoreScrollAnchor(list, matchListAnchorRef.current);
    matchListAnchorRef.current = captureScrollAnchor(list);
  });
  useEffect(() => {
    const freshAccountIds = new Set(freshCatalogs.map((catalog) => catalog.accountId));
    const emitted = profitAlertTracker.current.update(rankedEvents, Date.now(), freshAccountIds);
    if (emitted.length > 0) setProfitAlerts((current) => [...current, ...emitted].slice(-20));
  }, [freshCatalogs, rankedEvents]);
  useEffect(() => {
    if (requested.current.event === null || events.length === 0 || selectedKey !== null) return;
    const match = events.find((item) => Object.values(item.providerEventIds).includes(requested.current.event!));
    if (match !== undefined) {
      const primary = match.catalogs[0]!;
      setSelectedKey(match.key);
      setPinnedEvent(match);
      setPinnedEventIdentity({ accountId: primary.accountId, provider: primary.provider,
        providerEventId: match.providerEventIds[primary.provider]! });
    }
    else setSelectedKey(null);
  }, [events, selectedKey]);

  const selectedEvent = useMemo(() => {
    if (pinnedEventIdentity === null) return undefined;
    return events.find((item) => item.providerEventIds[pinnedEventIdentity.provider] === pinnedEventIdentity.providerEventId &&
      item.catalogs.some((catalog) => catalog.accountId === pinnedEventIdentity.accountId)) ?? pinnedEvent ?? undefined;
  }, [events, pinnedEvent, pinnedEventIdentity]);
  const isPinnedEvent = (item: ComparisonEvent): boolean => pinnedEventIdentity !== null &&
    item.providerEventIds[pinnedEventIdentity.provider] === pinnedEventIdentity.providerEventId &&
    item.catalogs.some((catalog) => catalog.accountId === pinnedEventIdentity.accountId);

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
  const toggleEventPhase = (phase: EventPhase): void => {
    setEventPhases((current) => {
      const next = new Set(current);
      if (next.has(phase)) next.delete(phase); else next.add(phase);
      saveEventPhases(window.localStorage, next);
      return next;
    });
  };
  const changeCategory = (next: CatalogCategory): void => {
    setCategory(next); setCatalogs([]); catalogsRef.current = []; staleAccountIdsRef.current = new Set();
    setStaleAccountIds(new Set());
    saveCatalogCategory(window.localStorage, next);
    setSignals([]); setMovements([]); setSelectedKey(null); setPinnedEvent(null); setPinnedEventIdentity(null); setVerifiedTickets(new Map());
    preflightCoordinator.current.clear();
    signalTracker.current = new LagSignalTracker();
    movementTracker.current = new PriceMovementTracker();
    const nextIds = sources.filter((source) => source.category === next)
      .map((source) => source.id).filter((id) => selectedIds.has(id));
    if (nextIds.length > 0) void loadIds(nextIds, true, next);
  };
  const watch = (item: ComparisonEvent, ticketKey: string): void => {
    const primary = item.catalogs[0]!;
    const eventId = item.providerEventIds[primary.provider]!;
    const query = new URLSearchParams(); query.set("event", eventId); query.set("account", primary.accountId);
    query.set("ticket", ticketKey);
    window.history.replaceState({}, "", `${window.location.pathname}?${query.toString()}`); setSelectedKey(item.key);
    setPinnedEvent(item);
    setPinnedEventIdentity({ accountId: primary.accountId, provider: primary.provider, providerEventId: eventId });
    setHighlightTicketKey(ticketKey);
  };
  const selectedDetail = selectedEvent === undefined ? null : (() => {
    const primary = selectedEvent.catalogs[0]!;
    const detailBooks: readonly ComparisonBook[] = comparisonProviders.map((provider) => {
      const providerSources = sources.filter((source) => source.provider === provider && source.category === category);
      return { provider, connected: providerSources.length > 0,
        selected: providerSources.some((source) => selectedIds.has(source.id)),
        hasExactEvent: selectedEvent.providers.includes(provider) };
    });
    return <MatchWatchDetail accountId={primary.accountId} catalogApi={catalogApi} initialCatalog={primary}
      baseStake={baseStake} books={detailBooks} comparisonCatalogs={freshCatalogs} comparisonEvent={selectedEvent} externallyRefreshed
      highlightTicketKey={highlightTicketKey} rankedTickets={rankedByEvent.get(selectedEvent.key)?.tickets ?? []}
      onOpenProviderTicket={openProviderTicketEnabled ? openProviderTicket : undefined}
      ticketReportApi={ticketReportApi}
      lagSignals={signals.filter((signal) => signal.event.key === selectedEvent.key)}
      onBack={() => { window.history.replaceState({}, "", window.location.pathname); setSelectedKey(null); setPinnedEvent(null); setPinnedEventIdentity(null); setHighlightTicketKey(null); }}
      providerEventId={selectedEvent.providerEventIds[primary.provider]!} />;
  })();

  return <>
    <header className="page-header page-header--compact"><p className="eyebrow">{category === "FOOTBALL" ? "Football" : "League of Legends"} · live gaps</p>
      <h1>{category === "FOOTBALL" ? "Football Live Price Gaps" : "LoL Live Price Gaps"}</h1>
    </header>
    {freshnessApi === undefined ? null : <ProviderFreshnessStrip api={freshnessApi} category={category} />}
    <section className="catalog-toolbar" aria-label="Catalog controls">
      {fixedCategory === undefined && <div className="category-switch" role="group" aria-label="Category"><button aria-pressed={category === "FOOTBALL"}
        onClick={() => changeCategory("FOOTBALL")} type="button">Football</button><button aria-pressed={category === "LOL"}
        onClick={() => changeCategory("LOL")} type="button">LoL</button></div>}
      <fieldset className="event-phase-filter" aria-label="Thời điểm trận">
        <legend>Trận</legend>
        <label><input checked={eventPhases.has("LIVE")} onChange={() => toggleEventPhase("LIVE")} type="checkbox" /> Live</label>
        <label><input checked={eventPhases.has("PREMATCH")} onChange={() => toggleEventPhase("PREMATCH")} type="checkbox" /> Pre-match</label>
      </fieldset>
      <ProviderSelector accounts={categorySources} eventCounts={eventCounts} loaded={accountsLoaded}
        selected={selectedIds} toggle={toggle} />
      <MaintenanceControls />
      <button aria-label="Load live catalog" disabled={busy || categorySelectedIds.length === 0} onClick={() => void loadIds(categorySelectedIds, true, category)} type="button">
        {busy ? "Loading…" : "Compare selected books"}</button>
      <button aria-label={`Âm thanh: ${soundEnabled ? "Bật" : "Tắt"}`} aria-pressed={soundEnabled}
        className="sound-toggle" onClick={() => setSoundEnabled((current) => {
          const next = !current; saveSoundEnabled(window.localStorage, next); return next;
        })} type="button">{soundEnabled ? "🔊 Âm thanh: Bật" : "🔇 Âm thanh: Tắt"}</button>
      <section aria-label="Cấu hình tiền cược" className="stake-panel stake-panel--compact">
        <label className="stake-config">Tiền cơ bản (VND)<input aria-label="Base stake for every match (VND)"
          inputMode="numeric" min="30000" step="1000" type="number" value={baseStakeInput} onChange={(event) => {
            const value = event.currentTarget.value; setBaseStakeInput(value);
            if (saveBaseStake(window.localStorage, value)) {
              invalidateVerifiedTickets(); setBaseStake(value); setStakeError(null);
            }
            else setStakeError("Số tiền tối thiểu 30.000 VND và phải chia hết cho 1.000 VND.");
          }} />{stakeError !== null && <small role="alert">{stakeError}</small>}</label>
      </section>
    </section>
    <ProfitToastStack alerts={profitAlerts} enabled={soundEnabled} sound={notificationSound} />
    <section aria-label="Live comparison workspace" className={selectedDetail === null ?
      "catalog-workspace catalog-workspace--stable" :
      "catalog-workspace catalog-workspace--stable catalog-workspace--selected"}>
      <div className="catalog-workspace__list catalog-workspace__list--locked" onScroll={(event) => {
        matchListAnchorRef.current = captureScrollAnchor(event.currentTarget);
      }} ref={matchListRef}><div className="catalog-workspace__list-heading">
        <h2>Exact two-book matches</h2>
      </div>
      {crossBookEventCount === 0 && <div className="catalog-workspace__empty catalog-workspace__empty--compact">
        <h3>No exact two-book comparison is currently available</h3>
        <p>Only events with the same exact opposing ticket at two different books are listed here.</p></div>}
      <div className="catalog-event-list">
      {displayTicketItems.length === 0 && <div className="catalog-workspace__empty"><h3>No supported two-way match is currently available</h3>
        <p>The source returned no open supported two-outcome ticket in the current time window.</p></div>}
      {displayTicketItems.map(({ event: ranked, ticket }) => {
      const item = ranked.event;
      const edge = ticketEdgeSummary(ticket);
      const label = `${item.event.participantA} vs ${item.event.participantB}`;
      const displayOnly = item.catalogs.some((catalog) => staleAccountIds.has(catalog.accountId));
      // Observation/stale controls whether the ticket is executable, not how
      // its displayed ROI is coloured.  Always colour every numeric ROI by
      // its sign so a negative display-only estimate can never look neutral.
      const edgeTone = edge === null ? null : roiTone(edge.roiPercent);
      return <article aria-label={`${edge === null ? "Observe" : "Compare"} ${label}`} aria-pressed={isPinnedEvent(item)}
        className={`catalog-event catalog-event--stable catalog-event--dense${isPinnedEvent(item) ? " catalog-event--selected" : ""}${
          edgeTone === null ? "" : ` catalog-event--roi-${edgeTone}`}`}
        data-scroll-key={`${item.key}::${ticket.key}`} key={`${item.key}::${ticket.key}`} onClick={() => watch(item, ticket.key)} onKeyDown={(event) => {
          if (event.key !== "Enter" && event.key !== " ") return;
          event.preventDefault(); watch(item, ticket.key);
        }} role="button" tabIndex={0}><header><div className="catalog-event__identity"><span>{item.event.competition}</span><h3>{label}</h3>
        <div className="provider-tags">{(edge?.providers ?? item.providers.slice(0, 2)).map((provider) =>
          <ProviderBrand compact key={provider} provider={provider} />)}
          {displayOnly && <strong className="catalog-event__stale">STALE</strong>}</div></div>
        {edge === null ? <div className="event-edge-summary event-edge-summary--waiting">
          <strong>WAITING</strong><small>ONE BOOK / NO EXACT PAIR</small>
          <span>{item.observedRows.length} supported two-way ticket(s)</span>
          <b>{item.providers.map((provider) => `#${provider}`).join(" · ")}</b>
        </div> : <div className={`event-edge-summary event-edge-summary--roi-${edgeTone}`}>
          <RoiBadge className="event-edge-summary__roi" roiPercent={edge.roiPercent} size="lg" />
          <span>Estimated balanced profit {money(edge.worstCaseProfit)}</span>
          <span>{edge.marketType} · {edge.line === null ? "No line" : `Line ${edge.line}`}</span>
          <span>{edge.odds.map(formatSummaryOdds).join(" / ")}</span>
        </div>}
        <div className="catalog-event-actions"><strong>{item.event.isLive ? formatMatchClock(item.event.liveState) : formatCountdown(item.event.startAtUtcMs, nowMs)}</strong>
          <span className="catalog-event__detail-cue">Xem chi tiết 2 cửa</span>
          </div></header>
        </article>;
      })}</div></div>
      <aside aria-label="Selected match detail" className="catalog-workspace__detail">{selectedDetail ??
        (rankedEvents[0] === undefined ? <div className="catalog-workspace__empty"><h2>Waiting for an exact pair</h2>
          <p>The balance panel appears only after the same event, market, line and opposing outcomes exist at two books.</p></div>
          : <SelectedTicketBalance ranked={rankedEvents[0]} />)}</aside>
    </section>
  </>;
}
