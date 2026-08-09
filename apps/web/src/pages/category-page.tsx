import { useMemo, useState } from "react";
import type { AppSnapshot, Category, MappingStatus, MarketType } from "@tool-chenh/contracts";
import { EventTable } from "../components/event-table.js";

const all = "ALL";

export function CategoryPage({ category, snapshot }: { readonly category: Category; readonly snapshot: AppSnapshot }) {
  const [timing, setTiming] = useState<"ALL" | "LIVE" | "PRE_MATCH">(all);
  const [competition, setCompetition] = useState(all);
  const [marketType, setMarketType] = useState<MarketType | "ALL">(all);
  const [mappingStatus, setMappingStatus] = useState<MappingStatus | "ALL">(all);
  const title = category === "FOOTBALL" ? "Football" : "LoL";
  const categoryEvents = snapshot.events.filter((event) => event.category === category);
  const categoryMarkets = snapshot.markets.filter((market) => market.category === category);
  const competitions = [...new Set(categoryEvents.map((event) => event.competition))];
  const marketTypes = [...new Set(categoryMarkets.map((market) => market.marketType))];
  const visibleEvents = useMemo(() => categoryEvents.filter((event) => {
    const relevantMarkets = categoryMarkets.filter((market) => market.canonicalEventId === event.canonicalEventId);
    const matchesMapping = mappingStatus === all || event.mappingStatus === mappingStatus ||
      relevantMarkets.some((market) => market.mappingStatus === mappingStatus);
    return (timing === all || (timing === "LIVE" ? event.isLive === true : event.isLive === false))
      && (competition === all || event.competition === competition)
      && (marketType === all || relevantMarkets.some((market) => market.marketType === marketType))
      && matchesMapping;
  }), [categoryEvents, categoryMarkets, competition, mappingStatus, marketType, timing]);
  const visibleMarketIds = new Set(visibleEvents.map((event) => event.canonicalEventId));
  const visibleMarkets = categoryMarkets.filter((market) =>
    visibleMarketIds.has(market.canonicalEventId)
      && (marketType === all || market.marketType === marketType)
      && (mappingStatus === all || market.mappingStatus === mappingStatus));

  return (
    <>
      <header className="page-header"><p className="eyebrow">{category === "FOOTBALL" ? "Football markets" : "League of Legends markets"}</p><h1>{title}</h1><p>Events remain in the order supplied by the server.</p></header>
      <section className="filters" aria-label={`${title} filters`}>
        <label>Timing<select value={timing} onChange={(event) => setTiming(event.target.value as typeof timing)}><option value={all}>All</option><option value="LIVE">Live</option><option value="PRE_MATCH">Pre-match</option></select></label>
        <label>Competition<select value={competition} onChange={(event) => setCompetition(event.target.value)}><option value={all}>All competitions</option>{competitions.map((value) => <option value={value} key={value}>{value}</option>)}</select></label>
        <label>Market<select value={marketType} onChange={(event) => setMarketType(event.target.value as typeof marketType)}><option value={all}>All markets</option>{marketTypes.map((value) => <option value={value} key={value}>{value}</option>)}</select></label>
        <label>Mapping<select value={mappingStatus} onChange={(event) => setMappingStatus(event.target.value as typeof mappingStatus)}><option value={all}>All mapping states</option><option value="VERIFIED">Verified</option><option value="REVIEW_REQUIRED">Review required</option><option value="REJECTED">Rejected</option></select></label>
      </section>
      <EventTable events={visibleEvents} markets={visibleMarkets} />
    </>
  );
}
