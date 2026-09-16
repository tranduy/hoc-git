import type { ObservedProviderCatalog } from "../providers/cmd/cmd-observed-catalog.js";

/**
 * The revision hasher caches a digest per record, keyed by the record object,
 * so it only pays off while an adapter hands back the rows it did not change.
 * Measured 2026-09-17 on the live stack, per provider:
 *
 *   BTI     record 38,733,898/41,163,567   94%
 *   SBOBET  record  2,806,481/3,625,017    77%
 *   CMD     record    863,770/3,165,421    27%
 *   IM      record          0/87,788        0%
 *   SABA    record          0/208,902       0%
 *   APSPORT record          0/172,388       0%
 *
 * IM, SABA and APSPORT rebuild every row object every round, so every record
 * and every block missed and those three re-serialised their whole catalog on
 * each revision. APSPORT is the busiest book of the six.
 *
 * Rather than change three adapters, put the previous row back where the new
 * one says the same thing. The store already retains the previous catalog per
 * account, so this costs no retention at all - it swaps a reference, never a
 * copy - and the published catalog stays semantically identical because a row
 * is only replaced by one that compares equal field for field.
 */

/** Equal on every own key, and only when every value is a primitive we can
 * compare with ===. Anything nested is left alone: a wrong "unchanged" here
 * would hold a revision still while the prices under it moved, which is the
 * one failure this must never cause. */
function sameRecord(previous: unknown, next: unknown): boolean {
  if (previous === next) return true;
  if (typeof previous !== "object" || previous === null || Array.isArray(previous)) return false;
  if (typeof next !== "object" || next === null || Array.isArray(next)) return false;
  const previousKeys = Object.keys(previous);
  const nextKeys = Object.keys(next);
  if (previousKeys.length !== nextKeys.length) return false;
  const previousRecord = previous as Record<string, unknown>;
  const nextRecord = next as Record<string, unknown>;
  for (const key of previousKeys) {
    if (!Object.prototype.hasOwnProperty.call(nextRecord, key)) return false;
    const left = previousRecord[key];
    const right = nextRecord[key];
    if (left !== right) return false;
    if (left !== null && (typeof left === "object" || typeof left === "function")) return false;
  }
  return true;
}

function reuseRows(previous: unknown, next: unknown): unknown {
  if (!Array.isArray(previous) || !Array.isArray(next)) return next;
  let substituted = 0;
  const rows = next.map((row, index) => {
    const before = previous[index];
    if (before === row || !sameRecord(before, row)) return row;
    substituted += 1;
    return before;
  });
  // Only build a new array when a row actually had to be swapped. An adapter
  // that already hands back the same objects keeps its array identity, which
  // callers downstream compare on, and pays nothing for passing through here.
  return substituted === 0 ? next : rows;
}

/**
 * Returns `next` with each unchanged row replaced by the object `previous`
 * already held. Row order and content are untouched; only identity is restored.
 */
export function reuseUnchangedRecords(previous: ObservedProviderCatalog | undefined,
  next: ObservedProviderCatalog): ObservedProviderCatalog {
  if (previous === undefined || previous === next) return next;
  if (previous.provider !== next.provider || previous.accountId !== next.accountId) return next;
  const previousRecord = previous as unknown as Record<string, unknown>;
  const nextRecord = next as unknown as Record<string, unknown>;
  let changed = false;
  const merged: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(nextRecord)) {
    const rows = reuseRows(previousRecord[key], value);
    if (rows !== value) changed = true;
    merged[key] = rows;
  }
  return changed ? merged as unknown as ObservedProviderCatalog : next;
}
