import type { Category, CatalogSourceStatus, ProviderId } from "@tool-chenh/contracts";
import { useEffect, useState } from "react";
import type { CatalogSourceApiLike } from "../api/catalog-sources.js";
import { sortProviderItems } from "../catalog/provider-order.js";
import { ProviderBrand } from "./provider-brand.js";

export type FreshnessTone = "LIVE" | "SLOW" | "STALE" | "NONE";

export interface ProviderFreshness {
  readonly provider: ProviderId;
  readonly tone: FreshnessTone;
  readonly ageMs: number | null;
  readonly sessionState: CatalogSourceStatus["sessionState"];
  readonly reason: string | null;
}

export const TONE_LABELS: Readonly<Record<FreshnessTone, string>> = {
  LIVE: "Fresh", SLOW: "Lagging", STALE: "Outdated", NONE: "No data"
};

// The operator contract is 30 s: past that a book is not answering, so the
// strip must call it out rather than shade it as merely slow.
export const FRESHNESS_LIVE_MS = 15_000;
export const FRESHNESS_SLOW_MS = 30_000;

/**
 * Pure classification so the thresholds are testable: LIVE while the data
 * plane published within the catalog freshness window, SLOW up to a minute,
 * STALE beyond that, NONE when the provider never delivered a catalog.
 */
export function classifyFreshness(status: CatalogSourceStatus, nowMs: number): ProviderFreshness {
  const ageMs = status.acquiredAtMs === null ? null : Math.max(0, nowMs - status.acquiredAtMs);
  const tone: FreshnessTone = ageMs === null ? "NONE"
    : ageMs <= FRESHNESS_LIVE_MS ? "LIVE"
    : ageMs <= FRESHNESS_SLOW_MS ? "SLOW" : "STALE";
  return { provider: status.provider, tone, ageMs, sessionState: status.sessionState, reason: status.reason };
}

export function formatAge(ageMs: number | null): string {
  if (ageMs === null) return "no data yet";
  const seconds = Math.floor(ageMs / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s ago`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m ago`;
}

function formatClock(atMs: number): string {
  return new Date(atMs).toLocaleTimeString("en-GB", { hour12: false });
}

export function ProviderFreshnessStrip({ api, category, pollMs = 2_000, now = () => Date.now() }: {
  readonly api: CatalogSourceApiLike;
  readonly category: Category;
  readonly pollMs?: number;
  readonly now?: () => number;
}) {
  const [statuses, setStatuses] = useState<readonly CatalogSourceStatus[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    let timer: number | null = null;
    const poll = async () => {
      try {
        const next = await api.list();
        if (cancelled) return;
        setStatuses(next);
        setError(null);
      } catch (cause) {
        if (cancelled) return;
        setError(cause instanceof Error ? cause.message : "Catalog source request failed");
      } finally {
        if (!cancelled) timer = window.setTimeout(() => { void poll(); }, pollMs);
      }
    };
    void poll();
    return () => {
      cancelled = true;
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [api, pollMs]);

  // Re-render once a second so the displayed age keeps counting between polls.
  useEffect(() => {
    const interval = window.setInterval(() => setTick((value) => value + 1), 1_000);
    return () => window.clearInterval(interval);
  }, []);

  const nowMs = now();
  const items = sortProviderItems(statuses.filter((status) => status.category === category),
    (status) => status.provider).map((status) => ({ status, freshness: classifyFreshness(status, nowMs) }));

  return (
    <section className="provider-freshness" aria-label="Provider data freshness" data-tick={tick}>
      {items.length === 0 && error === null ? <span className="provider-freshness__empty">Waiting for provider statuses…</span> : null}
      {items.map(({ status, freshness }) => (
        <div className={`provider-freshness__item provider-freshness__item--${freshness.tone.toLowerCase()}`}
          key={status.id} data-testid={`provider-freshness-${status.provider}`}
          title={status.acquiredAtMs === null ? `${status.provider}: no catalog received yet`
            : `${status.provider}: last catalog at ${formatClock(status.acquiredAtMs)} · ${status.sessionState}${status.reason ? ` · ${status.reason}` : ""}`}>
          <ProviderBrand provider={status.provider} compact />
          <span aria-hidden="true" className="provider-freshness__dot" />
          <strong className="provider-freshness__tone">{TONE_LABELS[freshness.tone]}</strong>
          <span className="provider-freshness__age">{formatAge(freshness.ageMs)}</span>
        </div>
      ))}
      {error === null ? null : <span className="provider-freshness__error" role="status">{error}</span>}
    </section>
  );
}
