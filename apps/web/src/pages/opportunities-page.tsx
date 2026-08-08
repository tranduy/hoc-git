import type { AppSnapshot, BlockedDiagnostic, Opportunity } from "@tool-chenh/contracts";
import type { ConnectionState } from "../api/client.js";
import { OpportunityCard } from "../components/opportunity-card.js";

function isEligibleOpportunity(opportunity: Opportunity): boolean {
  return opportunity.executionConfidence === "HIGH" && opportunity.legs.every((leg) => leg.quoteStatus === "OPEN" && leg.eligible && leg.ineligibleReasons.length === 0);
}

function blocksOpportunity(diagnostic: BlockedDiagnostic, opportunity: Opportunity): boolean {
  return diagnostic.canonicalMarketId === opportunity.canonicalMarketId || (diagnostic.canonicalMarketId === null && diagnostic.category === opportunity.category);
}

export function OpportunitiesPage({ snapshot, connectionState }: { readonly snapshot: AppSnapshot; readonly connectionState: ConnectionState }) {
  const events = new Map(snapshot.events.map((event) => [event.canonicalEventId, event]));
  const staleDiagnostics = snapshot.blockedDiagnostics.filter((diagnostic) => diagnostic.code === "STALE");
  const visibleOpportunities = snapshot.opportunities.filter((opportunity) => isEligibleOpportunity(opportunity) && !snapshot.blockedDiagnostics.some((diagnostic) => blocksOpportunity(diagnostic, opportunity)));
  return (
    <>
      <header className="page-header"><p className="eyebrow">Read-only inspection</p><h1>Opportunities</h1><p>Calculated by the server from verified mappings. Values here never place or prepare a wager.</p></header>
      {connectionState === "DISCONNECTED" ? (
        <section className="empty-state connection-warning" role="alert"><h2>Connection disconnected</h2><p>All opportunities are ineligible until fresh snapshots return. Reconnect to the local feed and wait for a new server snapshot.</p></section>
      ) : visibleOpportunities.length > 0 ? (
        <>
          {staleDiagnostics.length > 0 ? <p className="stale-warning" role="status">Stale server diagnostics: {staleDiagnostics.map((diagnostic) => diagnostic.reason).join("; ")}. Affected markets are hidden; wait for a fresh server snapshot.</p> : null}
          <section className="opportunity-list" aria-label="Verified opportunities">
            {visibleOpportunities.map((opportunity) => <OpportunityCard key={opportunity.opportunityId} opportunity={opportunity} event={events.get(opportunity.canonicalEventId)} revision={snapshot.revision} />)}
          </section>
        </>
      ) : staleDiagnostics.length > 0 ? (
        <section className="empty-state" role="status"><h2>Stale market data</h2><p>Server diagnostics report stale quotes, so no verified opportunity can be shown. Wait for a fresh server snapshot.</p></section>
      ) : (
        <section className="empty-state" role="status"><h2>No verified opportunities</h2><p>There are no server-verified opportunities in this snapshot. Keep this read-only view open for the next fresh snapshot.</p></section>
      )}
    </>
  );
}
