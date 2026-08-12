import { useState } from "react";
import type { AppSnapshot, BlockedDiagnostic, Opportunity, TwoLegExecutionResult } from "@tool-chenh/contracts";
import type { ConnectionState } from "../api/client.js";
import { AccountApi, type AccountApiLike } from "../api/accounts.js";
import { defaultExecutionApi, type ExecutionApiLike } from "../api/execution.js";
import { OpportunityCard } from "../components/opportunity-card.js";
import { isStaleDiagnostic } from "./diagnostics.js";

const defaultAccountApi = new AccountApi();

function isEligibleOpportunity(opportunity: Opportunity): boolean {
  return opportunity.executionConfidence === "HIGH" && opportunity.legs.every((leg) => leg.quoteStatus === "OPEN" && leg.eligible && leg.ineligibleReasons.length === 0);
}

function blocksOpportunity(diagnostic: BlockedDiagnostic, opportunity: Opportunity): boolean {
  return diagnostic.canonicalMarketId === opportunity.canonicalMarketId || (diagnostic.canonicalMarketId === null && diagnostic.category === opportunity.category);
}

function DryRunPanel({ opportunity, accountApi, executionApi }: { readonly opportunity: Opportunity;
  readonly accountApi: AccountApiLike; readonly executionApi: ExecutionApiLike }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<TwoLegExecutionResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const run = async (): Promise<void> => {
    setBusy(true); setResult(null); setError(null);
    try {
      const accounts = await accountApi.list();
      const selected = opportunity.legs.map((leg) => accounts.find((account) => account.provider === leg.provider &&
        account.sessionState === "ACTIVE" && account.profileState === "FRESH" &&
        (account.category === null || account.category === opportunity.category) &&
        account.capabilities.includes("PREFLIGHT")));
      if (selected[0] === undefined || selected[1] === undefined || selected[0].id === selected[1].id) {
        throw new Error("MISSING_FRESH_PREFLIGHT_ACCOUNTS");
      }
      const ticket = await executionApi.preflight({ opportunityId: opportunity.opportunityId,
        accountAId: selected[0].id, accountBId: selected[1].id, maxOddsDriftBps: 25 });
      const idempotencyKey = globalThis.crypto?.randomUUID?.() ??
        `dry-run-${Date.now()}-${Math.random().toString(16).slice(2)}`;
      setResult(await executionApi.dryRun({ ticket, idempotencyKey, mode: "DRY_RUN" }));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "DRY_RUN_UNAVAILABLE");
    } finally { setBusy(false); }
  };
  return <section className="dry-run-panel" aria-label={`Dry run ${opportunity.opportunityId}`}>
    <button disabled={busy} onClick={() => void run()} type="button">{busy ? "Checking both legs…" : "Run two-leg dry check"}</button>
    <small>Read-only revalidation. This button cannot submit a wager.</small>
    {result === null ? null : <div role="status"><strong>DRY RUN: {result.status}</strong>
      <ul>{result.legs.map((leg) => <li key={`${leg.provider}:${leg.providerSelectionId}`}>
        {leg.provider}: {leg.status}{leg.reason === null ? "" : ` (${leg.reason})`}</li>)}</ul></div>}
    {error === null ? null : <p role="alert">Dry check blocked: {error}</p>}
  </section>;
}

export function OpportunitiesPage({ snapshot, connectionState, accountApi = defaultAccountApi,
  executionApi = defaultExecutionApi }: { readonly snapshot: AppSnapshot; readonly connectionState: ConnectionState;
    readonly accountApi?: AccountApiLike; readonly executionApi?: ExecutionApiLike }) {
  const events = new Map(snapshot.events.map((event) => [event.canonicalEventId, event]));
  const staleDiagnostics = snapshot.blockedDiagnostics.filter(isStaleDiagnostic);
  const visibleOpportunities = snapshot.opportunities.filter((opportunity) => isEligibleOpportunity(opportunity) && !snapshot.blockedDiagnostics.some((diagnostic) => blocksOpportunity(diagnostic, opportunity)));
  return (
    <>
      <header className="page-header"><p className="eyebrow">Read-only inspection</p><h1>Opportunities</h1><p>Calculated by the server from verified mappings. A dry check reopens both exact tickets for validation but never submits a wager.</p></header>
      {connectionState !== "LIVE" ? (
        <section className="empty-state connection-warning" role="alert">
          <h2>{connectionState === "DISCONNECTED" ? "Connection disconnected" : "Validating live connection"}</h2>
          <p>{connectionState === "DISCONNECTED"
            ? "All opportunities are ineligible until fresh snapshots return. Reconnect to the local feed and wait for a validated fresh snapshot."
            : "Cached opportunities remain ineligible until a validated fresh snapshot returns."}</p>
        </section>
      ) : visibleOpportunities.length > 0 ? (
        <>
          {staleDiagnostics.length > 0 ? <p className="stale-warning" role="status">Stale server diagnostics: {staleDiagnostics.map((diagnostic) => diagnostic.reason).join("; ")}. Affected markets are hidden; wait for a fresh server snapshot.</p> : null}
          <section className="opportunity-list" aria-label="Verified opportunities">
            {visibleOpportunities.map((opportunity) => <div key={opportunity.opportunityId}>
              <OpportunityCard opportunity={opportunity} event={events.get(opportunity.canonicalEventId)} revision={snapshot.revision} />
              <DryRunPanel opportunity={opportunity} accountApi={accountApi} executionApi={executionApi} />
            </div>)}
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
