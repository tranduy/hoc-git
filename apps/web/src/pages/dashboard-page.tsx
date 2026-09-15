import type { AppSnapshot } from "@tool-chenh/contracts";
import type { CatalogSourceApiLike } from "../api/catalog-sources.js";
import type { ConnectionState } from "../api/client.js";
import { ProviderFreshnessStrip } from "../components/provider-freshness-strip.js";
import { StatusStrip } from "../components/status-strip.js";

function maximumQuoteAge(snapshot: AppSnapshot): number {
  return Math.max(0, ...snapshot.opportunities.flatMap((opportunity) => opportunity.legs.map((leg) => leg.quoteAgeMs)));
}

/**
 * Two health indicators sit here and they answer different questions.
 *
 * StatusStrip reports the adapter's last connection status, which only changes
 * when a catalog arrives - so a book that stops sending anything keeps saying
 * LIVE for as long as it stays quiet. That is how BTI sat dead for hours on
 * 2026-09-15 while the dashboard showed nothing wrong.
 *
 * The freshness strip polls the age of each book's last catalog, so silence is
 * exactly what it does notice. It was already on the live catalog page; the
 * dashboard is where somebody looks first.
 */
export function DashboardPage({ snapshot, connectionState, freshnessApi }: {
  readonly snapshot: AppSnapshot;
  readonly connectionState: ConnectionState;
  readonly freshnessApi?: CatalogSourceApiLike;
}) {
  const ageMs = maximumQuoteAge(snapshot);
  return (
    <>
      <header className="page-header"><p className="eyebrow">Read-only market monitor</p><h1>Dashboard</h1><p aria-live="polite">Local feed: <strong>{connectionState}</strong></p></header>
      {freshnessApi === undefined ? null : <ProviderFreshnessStrip api={freshnessApi} category="FOOTBALL" />}
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
