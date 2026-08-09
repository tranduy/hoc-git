import type { CanonicalEvent, CanonicalMarket } from "@tool-chenh/contracts";

function lifecycleLabel(isLive: CanonicalEvent["isLive"]): string {
  if (isLive === true) return "Live";
  if (isLive === false) return "Pre-match";
  return "Unknown";
}

export function EventTable({
  events,
  markets
}: {
  readonly events: readonly CanonicalEvent[];
  readonly markets: readonly CanonicalMarket[];
}) {
  const marketsByEvent = new Map<string, CanonicalMarket[]>();
  for (const market of markets) {
    const eventMarkets = marketsByEvent.get(market.canonicalEventId) ?? [];
    eventMarkets.push(market);
    marketsByEvent.set(market.canonicalEventId, eventMarkets);
  }

  if (events.length === 0) return <p className="empty-state">No events match these filters.</p>;

  return (
    <div className="table-wrap">
      <table>
        <caption className="visually-hidden">Events in server-provided order</caption>
        <thead><tr><th>Event</th><th>Competition</th><th>Timing</th><th>Markets</th><th>Mapping</th></tr></thead>
        <tbody>
          {events.map((event) => {
            const eventMarkets = marketsByEvent.get(event.canonicalEventId) ?? [];
            return (
              <tr key={event.canonicalEventId}>
                <td><strong>{event.participantA}</strong><span className="versus">vs</span><strong>{event.participantB}</strong></td>
                <td>{event.competition}</td>
                <td>{lifecycleLabel(event.isLive)}</td>
                <td>{eventMarkets.map((market) => <span className="market-chip" key={market.canonicalMarketId}>{market.scope} · {market.marketType}</span>)}</td>
                <td><span className={`mapping mapping--${event.mappingStatus.toLowerCase()}`}>{event.mappingStatus.replace("_", " ")}</span></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
