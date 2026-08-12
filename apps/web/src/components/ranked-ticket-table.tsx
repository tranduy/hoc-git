import type { ProviderEvent, ProviderId } from "@tool-chenh/contracts";
import { decimalOdds, selectionLabel } from "../catalog/comparison.js";
import type { RankedTicket } from "../watch/ranked-tickets.js";

function money(value: string): string {
  return `${Number(value).toLocaleString("en-US")} VND`;
}

function marketLabel(ticket: RankedTicket): string {
  if (ticket.row.marketType === "SERIES_WINNER") return "Series winner";
  if (ticket.row.marketType === "FT_AH") return "Full-time handicap";
  return ticket.row.marketType;
}

export function ticketDomId(eventKey: string, ticketKey: string): string {
  return `ticket-${encodeURIComponent(eventKey)}-${encodeURIComponent(ticketKey)}`;
}

export function RankedTicketTable({ event, providers, tickets, highlightTicketKey }: {
  readonly event: ProviderEvent;
  readonly providers: readonly ProviderId[];
  readonly tickets: readonly RankedTicket[];
  readonly highlightTicketKey?: string | null;
}) {
  const visible = tickets.slice(0, 5);
  return <div className="ranked-ticket-table-wrap"><table className="ranked-ticket-table"
    aria-label={`Top exact tickets for ${event.participantA} vs ${event.participantB}`}>
    <thead><tr><th>Ticket / line</th>{providers.map((provider) => <th aria-label={provider} key={provider}>#{provider} prices</th>)}
      <th>Selected opposing legs</th><th>Stakes</th><th>Outcome profit</th><th>Guaranteed / ROI</th></tr></thead>
    <tbody>{visible.map((ticket) => {
      const profitable = ticket.state === "VERIFIED_PROFIT" && ticket.plan !== null &&
        Number(ticket.plan.worstCaseProfit) >= 20_000;
      const selections = [...new Set(ticket.row.cells.flatMap((cell) => cell.quotes.map((quote) => quote.selection)))].sort();
      return <tr aria-label={`Ticket ${ticket.key}`}
        className={`${profitable ? "ranked-ticket-row ranked-ticket-row--profitable" :
          "ranked-ticket-row ranked-ticket-row--neutral"}${highlightTicketKey === ticket.key ? " ranked-ticket-row--highlight" : ""}`}
        id={ticketDomId(ticket.eventKey, ticket.key)} key={ticket.key} tabIndex={-1}>
        <th><strong>{marketLabel(ticket)}</strong><span>{ticket.row.line === null ? "No line" : `Line ${ticket.row.line}`}</span>
          <small>{ticket.key}</small></th>
        {providers.map((provider) => {
          const cell = ticket.row.cells.find((candidate) => candidate.provider === provider);
          return <td key={provider}>{cell === undefined ? <span className="rate-missing">Unavailable</span> :
            <div className="ranked-ticket-prices">{cell.quotes.map((quote) => {
              const normalized = decimalOdds(quote);
              const best = ticket.row.bestBySelection[quote.selection] === provider;
              return <span className={best ? "ranked-ticket-price ranked-ticket-price--best" : "ranked-ticket-price"}
                key={quote.providerSelectionId}><b>{selectionLabel(event, quote.selection)}</b>
                <strong>{quote.rawOdds} {quote.rawFormat}</strong>
                <small>{normalized === null ? "invalid" : `decimal ${normalized.toFixed(3)}`} · {quote.status}</small></span>;
            })}</div>}</td>;
        })}
        <td>{ticket.plan === null ? <span className="rate-missing">No opposing pair</span> :
          <div className="ranked-ticket-legs">{ticket.plan.legs.map((leg) => <span key={`${leg.provider}-${leg.selection}`}>
            <b>#{leg.provider} · {selectionLabel(event, leg.selection)}</b><small>@ {leg.decimalOdds}</small></span>)}</div>}</td>
        <td>{ticket.plan === null ? "—" : <div className="ranked-ticket-stakes">{ticket.plan.legs.map((leg) =>
          <span key={`${leg.provider}-stake`}><b>#{leg.provider}</b> Stake {money(leg.stake)}</span>)}
          <strong>Total {money(ticket.plan.totalStake)}</strong></div>}</td>
        <td>{ticket.plan === null ? "—" : <div className="ranked-ticket-profits">{selections.map((selection) =>
          <span key={selection}>If {selectionLabel(event, selection)} wins <b>{money(ticket.plan!.profitsBySelection[selection] ?? "0")}</b></span>)}</div>}</td>
        <td>{ticket.plan === null ? <span className="rate-missing">Cannot calculate</span> : <div className="ranked-ticket-result">
          <strong>Guaranteed {money(ticket.plan.worstCaseProfit)}</strong><b>ROI {(Number(ticket.plan.roi) * 100).toFixed(2)}%</b>
          {Object.entries(ticket.gapsBySelection).map(([selection, gap]) => <small key={selection}>
            {selectionLabel(event, selection)}: Gap {gap.absolute} · {Number(gap.percent).toFixed(2)}%
          </small>)}
          <small>Move {ticket.movementMagnitude}</small></div>}
          {ticket.reason !== null && <p className="ranked-ticket-reason">{ticket.reason}</p>}</td>
      </tr>;
    })}</tbody>
  </table></div>;
}
