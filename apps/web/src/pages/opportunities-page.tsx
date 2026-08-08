import type { AppSnapshot } from "@tool-chenh/contracts";
import type { ConnectionState } from "../api/client.js";
import { OpportunityCard } from "../components/opportunity-card.js";

function hasStaleDiagnostic(snapshot: AppSnapshot): boolean {
  return snapshot.blockedDiagnostics.some((diagnostic) => diagnostic.code === "STALE");
}

export function OpportunitiesPage({ snapshot, connectionState }: { readonly snapshot: AppSnapshot; readonly connectionState: ConnectionState }) {
  const events = new Map(snapshot.events.map((event) => [event.canonicalEventId, event]));
  const stale = hasStaleDiagnostic(snapshot);
  return (
    <>
      <header className="page-header"><p className="eyebrow">Read-only inspection</p><h1>Opportunities</h1><p>Calculated by the server from verified mappings. Values here never place or prepare a wager.</p></header>
      {connectionState === "DISCONNECTED" ? (
        <section className="empty-state connection-warning" role="alert"><h2>Connection disconnected</h2><p>All opportunities are ineligible until fresh snapshots return. Reconnect to the local feed and wait for a new server snapshot.</p></section>
      ) : snapshot.opportunities.length > 0 ? (
        <>
          {stale ? <p className="stale-warning" role="status">Some blocked markets have stale server quotes. Published opportunities remain eligible only as stated by their current server snapshot.</p> : null}
          <section className="opportunity-list" aria-label="Verified opportunities">
            {snapshot.opportunities.map((opportunity) => <OpportunityCard key={opportunity.opportunityId} opportunity={opportunity} event={events.get(opportunity.canonicalEventId)} />)}
          </section>
        </>
      ) : stale ? (
        <section className="empty-state" role="status"><h2>Stale market data</h2><p>Server diagnostics report stale quotes, so no verified opportunity can be shown. Wait for a fresh server snapshot.</p></section>
      ) : (
        <section className="empty-state" role="status"><h2>No verified opportunities</h2><p>There are no server-verified opportunities in this snapshot. Keep this read-only view open for the next fresh snapshot.</p></section>
      )}
    </>
  );
}
