import type { AppSnapshot } from "@tool-chenh/contracts";
import type { ConnectionState } from "../api/client.js";
import { StatusStrip } from "../components/status-strip.js";

function maximumQuoteAge(snapshot: AppSnapshot): number {
  return Math.max(0, ...snapshot.opportunities.flatMap((opportunity) => opportunity.legs.map((leg) => leg.quoteAgeMs)));
}

export function DashboardPage({ snapshot, connectionState }: { readonly snapshot: AppSnapshot; readonly connectionState: ConnectionState }) {
  const ageMs = maximumQuoteAge(snapshot);
  return (
    <>
      <header className="page-header"><p className="eyebrow">Read-only market monitor</p><h1>Dashboard</h1><p aria-live="polite">Local feed: <strong>{connectionState}</strong></p></header>
      <StatusStrip statuses={snapshot.providerStatuses} />
      <section className="metric-grid" aria-label="Market summary">
        <article><span>Football events</span><strong>{snapshot.counts.FOOTBALL.events}</strong></article>
        <article><span>LoL events</span><strong>{snapshot.counts.LOL.events}</strong></article>
        <article><span>Verified mappings</span><strong>{snapshot.counts.mappings.VERIFIED}</strong></article>
        <article><span>Needs review</span><strong>{snapshot.counts.mappings.REVIEW_REQUIRED}</strong></article>
        <article><span>Rejected mappings</span><strong>{snapshot.counts.mappings.REJECTED}</strong></article>
        <article><span>Opportunities</span><strong>{snapshot.counts.opportunities}</strong></article>
        <article><span>Maximum quote age</span><strong>{ageMs} ms</strong></article>
      </section>
    </>
  );
}
