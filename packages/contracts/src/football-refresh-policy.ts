export type FootballCollectionPlan = {
  readonly revision: number;
  readonly events: readonly {
    readonly eventId: string;
    readonly startAtUtcMs: number | null;
    readonly isLive: boolean;
    readonly urgent: boolean;
  }[];
  readonly manualRequestId?: string;
};

/** Self-contained so collectors can install the same policy in native pages. */
export function footballRefreshPolicy(startAtUtcMs: number | null, isLive: boolean,
  urgent: boolean, nowMs: number): { tier: string; refreshMs: number | null;
    quoteMaxAgeMs: number; nextBoundaryAtMs: number | null } {
  if (isLive) return { tier: "LIVE", refreshMs: 5000, quoteMaxAgeMs: 5000, nextBoundaryAtMs: null };
  if (startAtUtcMs === null || !Number.isFinite(startAtUtcMs) || startAtUtcMs <= 0) {
    return { tier: "UNKNOWN", refreshMs: 60000, quoteMaxAgeMs: 15000, nextBoundaryAtMs: null };
  }
  const remaining = startAtUtcMs - nowMs;
  const hour = 3600000;
  if (remaining < 3 * hour) return { tier: urgent && remaining > 0 ? "URGENT" : "NEAR",
    refreshMs: urgent && remaining > 0 ? 10000 : 30000,
    quoteMaxAgeMs: urgent && remaining > 0 ? 15000 : 60000,
    nextBoundaryAtMs: remaining > 0 ? startAtUtcMs : null };
  if (remaining < 6 * hour) return { tier: "3_6H", refreshMs: 60000, quoteMaxAgeMs: 120000,
    nextBoundaryAtMs: startAtUtcMs - 3 * hour + 1 };
  if (remaining < 13 * hour) return { tier: "6_13H", refreshMs: 120000, quoteMaxAgeMs: 300000,
    nextBoundaryAtMs: startAtUtcMs - 6 * hour + 1 };
  if (remaining < 24 * hour) return { tier: "13_24H", refreshMs: 600000, quoteMaxAgeMs: 900000,
    nextBoundaryAtMs: startAtUtcMs - 13 * hour + 1 };
  if (remaining <= 72 * hour) return { tier: "24_72H", refreshMs: 3600000, quoteMaxAgeMs: 4500000,
    nextBoundaryAtMs: startAtUtcMs - 24 * hour + 1 };
  return { tier: "PASSIVE", refreshMs: null, quoteMaxAgeMs: 4500000,
    nextBoundaryAtMs: startAtUtcMs - 72 * hour };
}
