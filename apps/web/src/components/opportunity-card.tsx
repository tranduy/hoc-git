import { useEffect, useMemo, useState } from "react";
import type { CanonicalEvent, Opportunity, StakeLeg } from "@tool-chenh/contracts";

const numberFormat = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2, minimumFractionDigits: 2 });
const percentFormat = new Intl.NumberFormat(undefined, { style: "percent", maximumFractionDigits: 2, minimumFractionDigits: 2 });
const ageFormat = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 });
const timestampFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "medium" });

function formatDecimal(value: string): string {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numberFormat.format(numeric) : value;
}

function formatPercent(value: string): string {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? percentFormat.format(numeric) : value;
}

function scopeLabel(scope: Opportunity["scope"]): string {
  return scope === "FULL_TIME" ? "Full time" : scope === "FIRST_HALF" ? "First half" : scope === "SERIES" ? "Series" : scope.replace("_", " ");
}

function ExactNumber({ value, label }: { readonly value: string; readonly label: string }) {
  return <span title={value} aria-label={`${label}: ${value}`}>{formatDecimal(value)}</span>;
}

function QuoteAge({ ageMs, renderedAtMs }: { readonly ageMs: number; readonly renderedAtMs: number }) {
  const elapsedMs = Math.max(0, Date.now() - renderedAtMs);
  const displayedAgeMs = ageMs + elapsedMs;
  return <span aria-label={`Quote age: ${ageFormat.format(displayedAgeMs)} ms`} title={`${ageMs} ms from the server snapshot`}>{ageFormat.format(displayedAgeMs)} ms</span>;
}

function LegDetails({ leg, renderedAtMs }: { readonly leg: StakeLeg; readonly renderedAtMs: number }) {
  const sourceTimestamp = leg.sourceTimestampMs === null ? "Provider timestamp unavailable" : timestampFormat.format(leg.sourceTimestampMs);
  const sourceLabel = leg.sourceTimestampMs === null ? "Source timestamp unavailable" : `Source timestamp: ${ageFormat.format(leg.sourceTimestampMs)} ms`;
  return (
    <li className="opportunity-leg">
      <h3>{leg.provider} · {leg.selection}</h3>
      <dl>
        <div><dt>Raw odds ({leg.rawFormat})</dt><dd><ExactNumber label={`Raw odds (${leg.rawFormat})`} value={leg.rawOdds} /></dd></div>
        <div><dt>Decimal odds</dt><dd><ExactNumber label="Decimal odds" value={leg.decimalOdds} /></dd></div>
        <div><dt>Effective decimal</dt><dd><ExactNumber label="Effective decimal odds" value={leg.effectiveDecimal} /></dd></div>
        <div><dt>Exact stake</dt><dd><ExactNumber label="Exact stake" value={leg.stake} /></dd></div>
        <div><dt>Outcome payout</dt><dd><ExactNumber label="Outcome payout" value={leg.payout} /></dd></div>
        <div><dt>Stake range</dt><dd><span title={`${leg.minStake}–${leg.maxStake}`} aria-label={`Minimum stake: ${leg.minStake}; maximum stake: ${leg.maxStake}`}>{formatDecimal(leg.minStake)}–{formatDecimal(leg.maxStake)}</span></dd></div>
        <div><dt>Quote age</dt><dd><QuoteAge ageMs={leg.quoteAgeMs} renderedAtMs={renderedAtMs} /></dd></div>
        <div><dt>Source time</dt><dd><span aria-label={sourceLabel} title={leg.sourceTimestampMs === null ? undefined : String(leg.sourceTimestampMs)}>{sourceTimestamp}</span></dd></div>
      </dl>
    </li>
  );
}

export function OpportunityCard({ opportunity, event, revision }: { readonly opportunity: Opportunity; readonly event: CanonicalEvent | undefined; readonly revision: number }) {
  const [, setTick] = useState(0);
  const observedAtMs = useMemo(() => Date.now(), [revision]);

  useEffect(() => {
    const timer = window.setInterval(() => setTick((value) => value + 1), 1_000);
    return () => window.clearInterval(timer);
  }, []);

  const eventLabel = event === undefined ? opportunity.canonicalEventId : `${event.participantA} vs ${event.participantB}`;
  return (
    <article className="opportunity-card" aria-label={eventLabel}>
      <header>
        <div><span className="market-chip">{opportunity.category}</span><span className="market-chip">{opportunity.marketType}</span><span className="market-chip">{scopeLabel(opportunity.scope)}</span></div>
        <span className="read-only-badge">READ ONLY</span>
        <h2>{eventLabel}</h2>
        <p>{event?.competition ?? "Canonical event"} · <span>Line {opportunity.line ?? "None"}</span> · <span>Settlement {opportunity.settlementProfile}</span></p>
      </header>
      <section aria-label="Opportunity result">
        <dl className="opportunity-summary">
          <div><dt>Worst-case profit</dt><dd><ExactNumber label="Worst-case profit" value={opportunity.worstCaseProfit} /></dd></div>
          <div><dt>ROI</dt><dd title={opportunity.roi} aria-label={`ROI: ${opportunity.roi}`}>{formatPercent(opportunity.roi)}</dd></div>
          <div><dt>Confidence</dt><dd className={opportunity.executionConfidence === "HIGH" ? "confidence-high" : "confidence-blocked"}>{opportunity.executionConfidence} confidence</dd></div>
          <div><dt>Server quote age</dt><dd><QuoteAge ageMs={opportunity.quoteAgeMs} renderedAtMs={observedAtMs} /></dd></div>
        </dl>
      </section>
      <ol className="opportunity-legs" aria-label="Exact stakes and outcome payouts">
        {opportunity.legs.map((leg) => <LegDetails key={`${leg.provider}:${leg.providerSelectionId}`} leg={leg} renderedAtMs={observedAtMs} />)}
      </ol>
    </article>
  );
}
