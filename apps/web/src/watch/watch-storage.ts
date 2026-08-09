import { boundWatchEntries, type MatchWatchEntry, type MatchWatchKind } from "./match-watch.js";

const entryKeys = [
  "id", "kind", "provider", "providerEventId", "providerMarketId", "providerSelectionId",
  "competition", "matchLabel", "marketType", "scope", "line", "selection", "previousValue",
  "currentValue", "detectedAtMs", "providerObservedAtMs", "sampleIntervalMs"
] as const;
const entryKeySet = new Set<string>(entryKeys);
const kinds = new Set<MatchWatchKind>([
  "ODDS_CHANGED", "MARKET_SUSPENDED", "MARKET_REOPENED", "QUOTE_SUSPENDED", "QUOTE_REOPENED",
  "EVENT_MISSING", "POLL_FAILED", "STALE"
]);

function isStringOrNull(value: unknown): value is string | null {
  return typeof value === "string" || value === null;
}

function parseEntry(value: unknown, provider: string, providerEventId: string): MatchWatchEntry | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  if (keys.length !== entryKeys.length || keys.some((key) => !entryKeySet.has(key))) return null;
  if (
    typeof record.id !== "string" || typeof record.kind !== "string" || !kinds.has(record.kind as MatchWatchKind) ||
    record.provider !== provider || record.providerEventId !== providerEventId ||
    !isStringOrNull(record.providerMarketId) || !isStringOrNull(record.providerSelectionId) ||
    typeof record.competition !== "string" || typeof record.matchLabel !== "string" ||
    !isStringOrNull(record.marketType) || !isStringOrNull(record.scope) || !isStringOrNull(record.line) ||
    !isStringOrNull(record.selection) || !isStringOrNull(record.previousValue) || !isStringOrNull(record.currentValue) ||
    typeof record.detectedAtMs !== "number" || !Number.isFinite(record.detectedAtMs) ||
    typeof record.providerObservedAtMs !== "number" || !Number.isFinite(record.providerObservedAtMs) ||
    typeof record.sampleIntervalMs !== "number" || !Number.isFinite(record.sampleIntervalMs) || record.sampleIntervalMs < 0
  ) return null;
  return record as unknown as MatchWatchEntry;
}

function safeEntry(entry: MatchWatchEntry): MatchWatchEntry {
  return {
    id: entry.id, kind: entry.kind, provider: entry.provider, providerEventId: entry.providerEventId,
    providerMarketId: entry.providerMarketId, providerSelectionId: entry.providerSelectionId,
    competition: entry.competition, matchLabel: entry.matchLabel, marketType: entry.marketType,
    scope: entry.scope, line: entry.line, selection: entry.selection, previousValue: entry.previousValue,
    currentValue: entry.currentValue, detectedAtMs: entry.detectedAtMs,
    providerObservedAtMs: entry.providerObservedAtMs, sampleIntervalMs: entry.sampleIntervalMs
  };
}

export function watchStorageKey(provider: string, providerEventId: string): string {
  return `fieldline:match-watch:v1:${encodeURIComponent(provider)}:${encodeURIComponent(providerEventId)}`;
}

export function loadWatchEntries(storage: Storage, provider: string, providerEventId: string): readonly MatchWatchEntry[] {
  const raw = storage.getItem(watchStorageKey(provider, providerEventId));
  if (raw === null) return [];
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(value)) return [];
  const parsed = value.map((candidate) => parseEntry(candidate, provider, providerEventId));
  if (parsed.some((candidate) => candidate === null)) return [];
  return boundWatchEntries(parsed as MatchWatchEntry[]);
}

export function saveWatchEntries(
  storage: Storage,
  provider: string,
  providerEventId: string,
  entries: readonly MatchWatchEntry[]
): void {
  const safe = boundWatchEntries(entries)
    .filter((entry) => entry.provider === provider && entry.providerEventId === providerEventId)
    .map(safeEntry);
  storage.setItem(watchStorageKey(provider, providerEventId), JSON.stringify(safe));
}

export function clearWatchEntries(storage: Storage, provider: string, providerEventId: string): void {
  storage.removeItem(watchStorageKey(provider, providerEventId));
}
