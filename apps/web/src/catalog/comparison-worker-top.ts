import type { ProviderId } from "@tool-chenh/contracts";
import { Decimal } from "@tool-chenh/core";
import type { ComparisonProjection } from "./comparison-worker-protocol.js";
import { summarizeComparisonCounts, type ComparisonCounts } from "./comparison-counts.js";
import { buildObservedFixedBaseStakeEstimate, type FixedBaseStakePolicy } from "../watch/fixed-base-stake.js";

/** Enough candidates for the UI top-20 list after local filter/rank. */
export const COMPARISON_WORKER_TOP_TICKET_LIMIT = 48;

const defaultTopPolicy: FixedBaseStakePolicy = {
  currency: "VND", baseStake: "500000", minStake: "1000", maxStake: "1000000000000",
  stakeStep: "1", balance: "1000000000000"
};

function numberOf(value: string | null | undefined): Decimal {
  try { return value == null || value === "" ? new Decimal(0) : new Decimal(value); }
  catch { return new Decimal(0); }
}

/**
 * Full matching still runs upstream. This only bounds what crosses postMessage:
 * keep the best-rate opposing tickets (and their events), plus full counts.
 */
export function selectTopRateWorkerOutput(
  displayEvents: readonly ComparisonProjection[],
  freshEvents: readonly ComparisonProjection[],
  options?: { readonly limit?: number; readonly policy?: FixedBaseStakePolicy }
): {
  readonly displayEvents: readonly ComparisonProjection[];
  readonly freshEvents: readonly ComparisonProjection[];
  readonly comparisonCounts: ComparisonCounts;
} {
  const limit = options?.limit ?? COMPARISON_WORKER_TOP_TICKET_LIMIT;
  const policy = options?.policy ?? defaultTopPolicy;
  return {
    comparisonCounts: summarizeComparisonCounts(freshEvents),
    displayEvents: selectTopRateProjections(displayEvents, limit, policy),
    freshEvents: selectTopRateProjections(freshEvents, limit, policy)
  };
}

export function selectTopRateProjections(
  events: readonly ComparisonProjection[],
  limit: number,
  policy: FixedBaseStakePolicy = defaultTopPolicy
): readonly ComparisonProjection[] {
  if (events.length === 0 || limit <= 0) return events;
  type Candidate = {
    readonly eventKey: string;
    readonly rowKey: string;
    readonly roi: Decimal;
    readonly profit: Decimal;
    readonly hasPlan: boolean;
  };
  const candidates: Candidate[] = [];
  for (const event of events) {
    const providers = new Set(event.providers as ProviderId[]);
    for (const row of event.rows) {
      const plan = buildObservedFixedBaseStakeEstimate(row, providers, policy);
      candidates.push({
        eventKey: event.key,
        rowKey: row.key,
        hasPlan: plan !== null,
        roi: numberOf(plan?.roi),
        profit: numberOf(plan?.worstCaseProfit)
      });
    }
  }
  if (candidates.length <= limit) return events;
  candidates.sort((left, right) => Number(right.hasPlan) - Number(left.hasPlan) ||
    right.roi.comparedTo(left.roi) || right.profit.comparedTo(left.profit) ||
    left.eventKey.localeCompare(right.eventKey) || left.rowKey.localeCompare(right.rowKey));
  const keptRows = new Map<string, Set<string>>();
  for (const candidate of candidates.slice(0, limit)) {
    const rows = keptRows.get(candidate.eventKey) ?? new Set<string>();
    rows.add(candidate.rowKey);
    keptRows.set(candidate.eventKey, rows);
  }
  return events.flatMap((event) => {
    const rows = keptRows.get(event.key);
    if (rows === undefined) return [];
    const selectedRows = event.rows.filter((row) => rows.has(row.key));
    if (selectedRows.length === 0) return [];
    return [{ ...event, rows: selectedRows }];
  });
}
