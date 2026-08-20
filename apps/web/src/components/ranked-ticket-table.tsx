import type { ProviderEvent, ProviderId, TicketRealtimeCheckRequest,
  TicketRealtimeCheckResponse } from "@tool-chenh/contracts";
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { decimalOdds, selectionHandicapLine, selectionLabel, ticketMarketLabel } from "../catalog/comparison.js";
import { formatDisplayDecimal } from "../catalog/display-format.js";
import { buildObservedAnchoredStakeEstimate, enumerateOpposingLegPairs,
  type FixedBaseStakePolicy, type OpposingLegPair } from "../watch/fixed-base-stake.js";
import type { RankedTicket } from "../watch/ranked-tickets.js";
import type { ProviderTicketIdentity } from "../api/provider-ticket.js";
import { ProviderBrand } from "./provider-brand.js";
import { RoiBadge } from "./roi-badge.js";
import { sortProviderItems, sortProviders } from "../catalog/provider-order.js";
import type { TicketRealtimeCheckApiLike } from "../api/ticket-realtime-check.js";

export type ProviderCatalogEvidence = Partial<Record<ProviderId, {
  readonly accountId: string;
  readonly observedAtMs: number;
}>>;

function money(value: string): string {
  return `${Number(value).toLocaleString("en-US")} VND`;
}

function displayReason(reason: string): string {
  return reason === "Provider preflight required"
    ? "Chưa kiểm tra lại vé trực tiếp tại sàn"
    : reason;
}

function legId(provider: ProviderId, selection: string): string {
  return `${provider}::${selection}`;
}

function pairForPlan(ticket: RankedTicket, providers: readonly ProviderId[]): OpposingLegPair | null {
  if (ticket.plan === null) return null;
  const wanted = new Set(ticket.plan.legs.map((leg) => legId(leg.provider, leg.selection)));
  return enumerateOpposingLegPairs(ticket.row, new Set(providers)).find((pair) =>
    wanted.has(legId(pair.first.provider, pair.first.quote.selection)) &&
    wanted.has(legId(pair.second.provider, pair.second.quote.selection))) ?? null;
}

export function renderableRankedTickets(tickets: readonly RankedTicket[], providers: readonly ProviderId[]): readonly RankedTicket[] {
  return tickets.filter((ticket) => pairForPlan(ticket, providers) !== null);
}

async function copyTeam(name: string): Promise<void> {
  try { await navigator.clipboard?.writeText(name); } catch { /* clipboard failure must not disrupt realtime UI */ }
}

export function ticketDomId(eventKey: string, ticketKey: string): string {
  return `ticket-${encodeURIComponent(eventKey)}-${encodeURIComponent(ticketKey)}`;
}

function TicketRow({ event, providers, ticket, compact, highlighted, stakePolicy, onOpenProviderTicket,
  providerCatalogEvidence, realtimeCheckApi }: {
  readonly event: ProviderEvent;
  readonly providers: readonly ProviderId[];
  readonly ticket: RankedTicket;
  readonly compact: boolean;
  readonly highlighted: boolean;
  readonly stakePolicy?: FixedBaseStakePolicy | undefined;
  readonly onOpenProviderTicket?: ((identity: ProviderTicketIdentity) => void) | undefined;
  readonly providerCatalogEvidence?: ProviderCatalogEvidence | undefined;
  readonly realtimeCheckApi?: TicketRealtimeCheckApiLike | undefined;
}) {
  const [anchor, setAnchor] = useState<{ readonly provider: ProviderId; readonly selection: string;
    readonly stake: string } | null>(null);
  const [audit, setAudit] = useState<{ readonly request: TicketRealtimeCheckRequest;
    readonly response: TicketRealtimeCheckResponse | null; readonly error: string | null;
    readonly pending: boolean } | null>(null);
  const pair = useMemo(() => pairForPlan(ticket, providers), [providers, ticket]);
  const adjustedPlan = useMemo(() => anchor === null ? ticket.plan : stakePolicy === undefined || pair === null ? null :
    buildObservedAnchoredStakeEstimate(ticket.row, pair, stakePolicy, anchor), [anchor, pair, stakePolicy, ticket]);
  const plan = anchor === null ? ticket.plan : adjustedPlan;
  const quotePlan = plan ?? ticket.plan;
  const orderedProviders = useMemo(() => sortProviders(providers), [providers]);
  const orderedQuoteLegs = useMemo(() => sortProviderItems(quotePlan?.legs ?? [], (leg) => leg.provider), [quotePlan]);
  const orderedOriginalLegs = useMemo(() => sortProviderItems(ticket.plan?.legs ?? [], (leg) => leg.provider), [ticket.plan]);
  const profitable = ticket.state === "VERIFIED_PROFIT" && plan !== null && Number(plan.worstCaseProfit) >= 20_000;
  const selections = [...new Set(ticket.row.cells.flatMap((cell) => cell.quotes.map((quote) => quote.selection)))].sort();
  const rowProviders = compact && quotePlan !== null
    ? orderedProviders.filter((provider) => orderedQuoteLegs.some((leg) => leg.provider === provider)) : orderedProviders;
  const openableLegs = orderedQuoteLegs.flatMap((leg) => {
    const quote = ticket.row.cells.find((cell) => cell.provider === leg.provider)
      ?.quotes.find((candidate) => candidate.selection === leg.selection);
    return quote === undefined ? [] : [{ leg, quote }];
  }) ?? [];
  const displayedStake = (provider: ProviderId, selection: string): string => {
    if (anchor?.provider === provider && anchor.selection === selection) return anchor.stake;
    return plan?.legs.find((leg) => leg.provider === provider && leg.selection === selection)?.stake ??
      ticket.plan?.legs.find((leg) => leg.provider === provider && leg.selection === selection)?.stake ?? "";
  };
  const canCheckRealtime = realtimeCheckApi !== undefined && openableLegs.length === 2 && openableLegs.every(({ leg }) =>
    providerCatalogEvidence?.[leg.provider] !== undefined && displayedStake(leg.provider, leg.selection) !== "");
  const checkRealtime = async (): Promise<void> => {
    if (!canCheckRealtime || realtimeCheckApi === undefined) return;
    const capturedAtMs = Date.now();
    const toDisplayedLeg = ({ leg, quote }: (typeof openableLegs)[number]): TicketRealtimeCheckRequest["legs"][number] => {
      const evidence = providerCatalogEvidence![leg.provider]!;
      const normalized = decimalOdds(quote);
      if (normalized === null) throw new Error("DISPLAYED_ODDS_INVALID");
      return { provider: leg.provider, accountId: evidence.accountId, providerEventId: quote.providerEventId,
        providerMarketId: quote.providerMarketId, providerSelectionId: quote.providerSelectionId,
        selection: quote.selection, line: quote.line, rawOdds: quote.rawOdds, rawFormat: quote.rawFormat,
        decimalOdds: normalized.toString(), quoteStatus: quote.status, providerObservedAtMs: evidence.observedAtMs,
        receivedMonotonicMs: quote.receivedMonotonicMs, sequence: quote.sequence,
        requestedStake: displayedStake(leg.provider, leg.selection) };
    };
    const legs: TicketRealtimeCheckRequest["legs"] = [toDisplayedLeg(openableLegs[0]!),
      toDisplayedLeg(openableLegs[1]!)];
    const request: TicketRealtimeCheckRequest = { eventLabel: `${event.participantA} vs ${event.participantB}`,
      marketType: ticket.row.marketType as TicketRealtimeCheckRequest["marketType"],
      scope: ticket.row.scope as TicketRealtimeCheckRequest["scope"], capturedAtMs, legs };
    setAudit({ request, response: null, error: null, pending: true });
    try {
      const response = await realtimeCheckApi.check(request);
      setAudit((current) => current?.request === request
        ? { request, response, error: null, pending: false } : current);
    } catch (error) {
      const message = error instanceof Error ? error.message : "REALTIME_CHECK_UNAVAILABLE";
      setAudit((current) => current?.request === request
        ? { request, response: null, error: message, pending: false } : current);
    }
  };
  return <><tr aria-label={`Ticket ${ticket.key}`}
    className={`${profitable ? "ranked-ticket-row ranked-ticket-row--profitable" :
      "ranked-ticket-row ranked-ticket-row--neutral"}${compact ? " ranked-ticket-row--compact" : ""}${highlighted ? " ranked-ticket-row--highlight" : ""}`}
    id={ticketDomId(ticket.eventKey, ticket.key)} tabIndex={-1}
    style={compact ? { "--ticket-provider-count": rowProviders.length } as CSSProperties : undefined}>
    <th><strong>{ticketMarketLabel(ticket.row.marketType)}</strong><span>{ticket.row.line === null ? "No line" : `Line ${ticket.row.line}`}</span>
      {plan !== null && <RoiBadge className="ranked-ticket-roi" roiPercent={Number(plan.roi) * 100} size="sm" />}
      <small>{ticket.key}</small>{openableLegs.length > 0 && onOpenProviderTicket !== undefined &&
        <div className="open-provider-ticket-group">{openableLegs.map(({ leg, quote }) =>
          <button aria-label={`Mở kèo ${leg.provider} tại sàn`} className="open-provider-ticket"
            key={leg.provider} onClick={(clickEvent) => { clickEvent.stopPropagation(); onOpenProviderTicket({
              provider: leg.provider, providerEventId: quote.providerEventId,
              providerMarketId: quote.providerMarketId, providerSelectionId: quote.providerSelectionId
            }); }} type="button">Mở {leg.provider}</button>)}</div>}</th>
    {rowProviders.map((provider, providerIndex) => {
      const cell = ticket.row.cells.find((candidate) => candidate.provider === provider);
      const selectedLeg = compact ? quotePlan?.legs.find((leg) => leg.provider === provider) : undefined;
      const visibleQuotes = selectedLeg === undefined ? cell?.quotes :
        cell?.quotes.filter((quote) => quote.selection === selectedLeg.selection);
      return <td data-label={`#${provider} prices`} key={provider}>{compact &&
        <header className="ranked-ticket-provider-heading"><ProviderBrand compact provider={provider} /></header>}
        {cell === undefined ? <span className="rate-missing">Unavailable</span> :
        <div className="ranked-ticket-prices">{visibleQuotes?.map((quote, quoteIndex) => {
          const normalized = decimalOdds(quote);
          const best = ticket.row.bestBySelection[quote.selection] === provider;
          const handicap = selectionHandicapLine(ticket.row, quote.selection);
          const label = selectionLabel(event, quote.selection);
          const copyName = compact
            ? (providerIndex === 0 ? event.participantA : event.participantB)
            : (quoteIndex === 0 ? event.participantA : event.participantB);
          return <span className={best ? "ranked-ticket-price ranked-ticket-price--best" : "ranked-ticket-price"}
            key={quote.providerSelectionId}><span className="ranked-ticket-price__team"><b>{label}{handicap === null ? "" : ` · AH ${handicap}`}</b>
              <button aria-label={`Copy ${copyName}`} className="ticket-team-copy-icon" onClick={() => { void copyTeam(copyName); }}
                title={`Copy ${copyName}`} type="button"><svg aria-hidden="true" viewBox="0 0 20 20"><path d="M7 6V4h9v9h-2V6H7Zm-3 1h9v9H4V7Zm2 2v5h5V9H6Z" /></svg></button>
            </span>
            <strong>{formatDisplayDecimal(quote.rawOdds)} {quote.rawFormat}</strong>
            <small>{normalized === null ? "invalid" : `decimal ${normalized.toFixed(3)}`} · {quote.status}</small></span>;
        })}</div>}</td>;
    })}
    <td data-label="Selected opposing legs">{quotePlan === null ? <span className="rate-missing">No opposing pair</span> :
      <div className="ranked-ticket-legs">{orderedQuoteLegs.map((leg) => <span key={legId(leg.provider, leg.selection)}>
        <b>#{leg.provider} · {selectionLabel(event, leg.selection)}</b><small>@ {formatDisplayDecimal(leg.decimalOdds)}</small></span>)}</div>}</td>
    <td data-label="Stakes">{ticket.plan === null ? "—" : <div className="ranked-ticket-stakes">
      {orderedOriginalLegs.map((leg) => <label key={`${legId(leg.provider, leg.selection)}-stake`}>
        <span className="ranked-ticket-stake-control">
          <span className="ranked-ticket-stake-provider" style={{ minWidth: 112, width: 112 }}>
            <ProviderBrand compact provider={leg.provider} />
          </span>
          <input aria-label={`Stake ${leg.provider} ${selectionLabel(event, leg.selection)}`} inputMode="numeric" min="0"
            onChange={(changeEvent) => setAnchor({ provider: leg.provider, selection: leg.selection,
              stake: changeEvent.currentTarget.value })} step={stakePolicy?.stakeStep ?? "1"} type="number"
            value={displayedStake(leg.provider, leg.selection)} />
        </span>
      </label>)}
      {plan === null ? <strong className="stake-calculation-error">Không thể cân với số tiền này</strong>
        : <strong>Total {money(plan.totalStake)}</strong>}
    </div>}</td>
    <td data-label="Outcome profit">{plan === null ? "—" : <div className="ranked-ticket-profits">{selections.map((selection) =>
      <span key={selection}>If {selectionLabel(event, selection)} wins <b>{money(plan.profitsBySelection[selection] ?? "0")}</b></span>)}</div>}</td>
    <td data-label="Guaranteed / ROI">{plan === null ? <span className="rate-missing">Cannot calculate</span> : <div className="ranked-ticket-result">
      <strong>Guaranteed {money(plan.worstCaseProfit)}</strong><RoiBadge roiPercent={Number(plan.roi) * 100} size="md" />
      {Object.entries(ticket.gapsBySelection).map(([selection, gap]) => <small key={selection}>
        {selectionLabel(event, selection)}: Gap {formatDisplayDecimal(gap.absolute)} · {Number(gap.percent).toFixed(2)}%
      </small>)}
      <small>Move {ticket.movementMagnitude}</small></div>}
      {ticket.reason !== null && <p className="ranked-ticket-reason">{displayReason(ticket.reason)}</p>}</td>
  </tr>{canCheckRealtime && <tr className="ticket-realtime-audit-row"><td colSpan={rowProviders.length + 5}>
    <button className="ticket-realtime-check" disabled={audit?.pending === true}
      onClick={() => { void checkRealtime(); }} type="button">{audit?.pending === true ? "Đang kiểm tra…" : "Kiểm tra giá thật"}</button>
    {audit !== null && <section aria-label={`Kiểm tra giá thật ${ticket.key}`} className="ticket-realtime-audit">
      {audit.request.legs.map((displayed, index) => {
        const checked = audit.response?.legs[index];
        return <article className="ticket-realtime-audit__leg" key={`${displayed.provider}:${displayed.providerSelectionId}`}>
          <strong>TOOL · {displayed.provider} — {displayed.rawOdds} {displayed.rawFormat} · decimal {displayed.decimalOdds} · seq {displayed.sequence}</strong>
          {checked?.direct !== undefined && checked.direct !== null
            ? <strong>SÀN · {checked.direct.provider} — {checked.direct.rawOdds} {checked.direct.rawFormat} · decimal {checked.direct.decimalOdds} · seq {checked.direct.sequence} · {checked.elapsedMs} ms</strong>
            : <span>{audit.pending ? "Đang đọc trực tiếp…" : `SÀN · ${displayed.provider} — ${checked?.error ?? audit.error ?? "Không có dữ liệu"}`}</span>}
          {checked !== undefined && <b className={`ticket-realtime-audit__status ticket-realtime-audit__status--${checked.status.toLowerCase()}`}>{checked.status}</b>}
        </article>;
      })}
      {audit.response !== null && <small>{audit.response.persisted ? "Đã ghi JSONL" : "Không ghi được JSONL"} · {audit.response.checkId}</small>}
      {audit.error !== null && <small className="ticket-realtime-audit__error">{audit.error}</small>}
    </section>}
  </td></tr>}</>;
}

export function RankedTicketTable({ event, providers, tickets, compact = false, highlightTicketKey, stakePolicy,
  onOpenProviderTicket, providerCatalogEvidence, realtimeCheckApi }: {
  readonly event: ProviderEvent;
  readonly providers: readonly ProviderId[];
  readonly tickets: readonly RankedTicket[];
  readonly compact?: boolean;
  readonly highlightTicketKey?: string | null;
  readonly stakePolicy?: FixedBaseStakePolicy;
  readonly onOpenProviderTicket?: ((identity: ProviderTicketIdentity) => void) | undefined;
  readonly providerCatalogEvidence?: ProviderCatalogEvidence | undefined;
  readonly realtimeCheckApi?: TicketRealtimeCheckApiLike | undefined;
}) {
  const orderedProviders = useMemo(() => sortProviders(providers), [providers]);
  const visible = renderableRankedTickets(tickets, orderedProviders).slice(0, 5);
  const autoFocusedHighlight = useRef<string | null>(null);
  useEffect(() => {
    if (highlightTicketKey === null || highlightTicketKey === undefined) {
      autoFocusedHighlight.current = null;
      return;
    }
    const eventKey = tickets[0]?.eventKey ?? "";
    const focusIdentity = `${eventKey}::${highlightTicketKey}`;
    if (autoFocusedHighlight.current === focusIdentity) return;
    const row = document.getElementById(ticketDomId(eventKey, highlightTicketKey));
    if (row === null) return;
    autoFocusedHighlight.current = focusIdentity;
    row.scrollIntoView?.({ block: "center" });
    row.focus();
  }, [highlightTicketKey, tickets]);
  if (visible.length === 0) return null;
  return <div className={`ranked-ticket-table-wrap${compact ? " ranked-ticket-table-wrap--compact" : ""}`}>
    <table className={`ranked-ticket-table${compact ? " ranked-ticket-table--compact" : ""}`}
      aria-label={`Top exact tickets for ${event.participantA} vs ${event.participantB}`}>
      <thead><tr><th>Ticket / line</th>{orderedProviders.map((provider) => <th aria-label={provider} key={provider}><ProviderBrand compact provider={provider} /><small>prices</small></th>)}
        <th>Selected opposing legs</th><th>Stakes</th><th>Outcome profit</th><th>Guaranteed / ROI</th></tr></thead>
      <tbody>{visible.map((ticket) => <TicketRow compact={compact} event={event} highlighted={highlightTicketKey === ticket.key}
        key={ticket.key} onOpenProviderTicket={onOpenProviderTicket} providers={orderedProviders} stakePolicy={stakePolicy}
        providerCatalogEvidence={providerCatalogEvidence} realtimeCheckApi={realtimeCheckApi} ticket={ticket} />)}</tbody>
    </table>
  </div>;
}
