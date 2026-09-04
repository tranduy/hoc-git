interface CoverageState {
  acceptedEventIds: ReadonlySet<string>;
  comparableAuthoritativeOrders: ReadonlyMap<string, ComparableAuthoritativeOrder>;
  opaqueAuthoritativeGenerations: ReadonlySet<string>;
}

type ComparableAuthoritativeOrder = readonly [major: number, minor: number];

// Measured 2026-08-26: a SABA recovery replaced a 269-event catalog with 12 and
// then with 0. The old catalog was correct; the replacement was a viewport-sized
// snapshot. Ordinary attrition as fixtures finish is far gentler than that, and a
// new day's card arrives at a comparable size, so a baseline keeping less than
// this share of a populated catalog is refused and the last good one is kept.
const MIN_RETAINED_BASELINE_SHARE = 0.5;
// APSPORT's all-future roster is large and a transient detail/context failure
// has repeatedly returned a superficially valid but incomplete generation
// (measured live: 638 -> 558 events, 3,719 -> 2,762 markets). Normal fixture
// attrition is much smaller between its one-minute generations.
const APSPORT_MIN_RETAINED_BASELINE_SHARE = 0.9;
const COVERAGE_COLLAPSE_FLOOR = 20;
const MAX_COMPARABLE_AUTHORITATIVE_LINEAGES = 32;
const MAX_OPAQUE_AUTHORITATIVE_GENERATIONS = 256;

export interface CatalogCoverageCandidate {
  readonly generation: string;
  readonly authoritativeBaseline: boolean;
  readonly providerEventIds: readonly string[];
}

export interface CatalogCoverageCheckpoint {
  readonly owner: CatalogCoverageGuard;
  readonly states: ReadonlyMap<string, CoverageState>;
}

function collapsesCoverage(sourceKey: string, current: CoverageState,
  candidate: CatalogCoverageCandidate): boolean {
  const accepted = current.acceptedEventIds.size;
  if (accepted < COVERAGE_COLLAPSE_FLOOR) return false;
  const retainedShare = sourceKey === "catalog-source:APSPORT:FOOTBALL"
    ? APSPORT_MIN_RETAINED_BASELINE_SHARE : MIN_RETAINED_BASELINE_SHARE;
  return candidate.providerEventIds.length < accepted * retainedShare;
}

export class CatalogCoverageGuard {
  readonly #states = new Map<string, CoverageState>();

  accept(sourceKey: string, candidate: CatalogCoverageCandidate): boolean {
    if (!this.allows(sourceKey, candidate)) return false;
    this.commit(sourceKey, candidate);
    return true;
  }

  allows(sourceKey: string, candidate: CatalogCoverageCandidate): boolean {
    const current = this.#states.get(sourceKey);
    if (current === undefined) return true;
    if (candidate.authoritativeBaseline) {
      return allowsAuthoritativeGeneration(current, candidate.generation) &&
        !collapsesCoverage(sourceKey, current, candidate);
    }
    const proposed = new Set(candidate.providerEventIds);
    return [...current.acceptedEventIds].every((eventId) => proposed.has(eventId));
  }

  commit(sourceKey: string, candidate: CatalogCoverageCandidate): void {
    this.#states.set(sourceKey, stateAfter(this.#states.get(sourceKey) ?? null, candidate));
  }

  reset(sourceKey: string): void {
    this.#states.delete(sourceKey);
  }

  checkpoint(): CatalogCoverageCheckpoint {
    return { owner: this, states: new Map([...this.#states].map(([key, state]) => [key, {
      acceptedEventIds: new Set(state.acceptedEventIds),
      comparableAuthoritativeOrders: new Map(state.comparableAuthoritativeOrders),
      opaqueAuthoritativeGenerations: new Set(state.opaqueAuthoritativeGenerations)
    }])) };
  }

  restoreCheckpoint(checkpoint: CatalogCoverageCheckpoint): void {
    if (checkpoint.owner !== this) throw new Error("CATALOG_COVERAGE_CHECKPOINT_OWNER_MISMATCH");
    this.#states.clear();
    for (const [key, state] of checkpoint.states) {
      this.#states.set(key, { acceptedEventIds: new Set(state.acceptedEventIds),
        comparableAuthoritativeOrders: new Map(state.comparableAuthoritativeOrders),
        opaqueAuthoritativeGenerations: new Set(state.opaqueAuthoritativeGenerations) });
    }
  }
}

function stateAfter(current: CoverageState | null, candidate: CatalogCoverageCandidate): CoverageState {
  const comparable = new Map(current?.comparableAuthoritativeOrders ?? []);
  const opaque = new Set(current?.opaqueAuthoritativeGenerations ?? []);
  if (candidate.authoritativeBaseline) {
    const generation = comparableAuthoritativeGeneration(candidate.generation);
    if (generation === null) {
      rememberOpaqueGeneration(opaque, candidate.generation);
    } else {
      const currentOrder = comparable.get(generation.lineage);
      if ((currentOrder !== undefined || comparable.size < MAX_COMPARABLE_AUTHORITATIVE_LINEAGES) &&
        (currentOrder === undefined || compareOrder(generation.order, currentOrder) > 0)) {
        comparable.set(generation.lineage, generation.order);
      }
    }
  }
  return { acceptedEventIds: new Set(candidate.providerEventIds),
    comparableAuthoritativeOrders: comparable, opaqueAuthoritativeGenerations: opaque };
}

function allowsAuthoritativeGeneration(current: CoverageState, generation: string): boolean {
  const comparable = comparableAuthoritativeGeneration(generation);
  if (comparable === null) {
    return !current.opaqueAuthoritativeGenerations.has(generation) &&
      current.opaqueAuthoritativeGenerations.size < MAX_OPAQUE_AUTHORITATIVE_GENERATIONS;
  }
  const highWatermark = current.comparableAuthoritativeOrders.get(comparable.lineage);
  if (highWatermark !== undefined) return compareOrder(comparable.order, highWatermark) > 0;
  return current.comparableAuthoritativeOrders.size < MAX_COMPARABLE_AUTHORITATIVE_LINEAGES;
}

interface ComparableAuthoritativeGeneration {
  readonly lineage: string;
  readonly order: ComparableAuthoritativeOrder;
}

function comparableAuthoritativeGeneration(generation: string): ComparableAuthoritativeGeneration | null {
  const parsers = [comparableCmdGeneration, comparableImGeneration, comparableBtiGeneration,
    comparableKsportGeneration,
    comparableSabaGeneration, comparableSabaDomGeneration, comparableTsportGeneration] as const;
  for (const parse of parsers) {
    const comparable = parse(generation);
    if (comparable !== null) return comparable;
  }
  if (hasReservedGenerationSyntax(generation)) return null;
  return comparableFallbackGeneration(generation);
}

function comparableCmdGeneration(generation: string): ComparableAuthoritativeGeneration | null {
  const match = /^cmd:(0|[1-9]\d*)(?::observation:(0|[1-9]\d*))?$/u.exec(generation);
  if (match === null) return null;
  const cursor = Number(match[1]);
  const observation = match[2] === undefined ? -1 : Number(match[2]);
  if (!Number.isSafeInteger(cursor) || !Number.isSafeInteger(observation)) return null;
  return { lineage: lineageKey("CMD"), order: [cursor, observation] };
}

function comparableImGeneration(generation: string): ComparableAuthoritativeGeneration | null {
  const match = /^im:(0|[1-9]\d*):([1-9]\d*)$/u.exec(generation);
  if (match === null) return null;
  const tabId = Number(match[1]);
  const ordinal = Number(match[2]);
  if (!Number.isSafeInteger(tabId) || !Number.isSafeInteger(ordinal)) return null;
  return { lineage: lineageKey("IM", match[1]!), order: [ordinal, 0] };
}

function comparableBtiGeneration(generation: string): ComparableAuthoritativeGeneration | null {
  const match = /^bti:(0|[1-9]\d*):(0|[1-9]\d*)$/u.exec(generation);
  if (match === null) return null;
  const timestamp = Number(match[1]);
  const ordinal = Number(match[2]);
  if (!Number.isSafeInteger(timestamp) || !Number.isSafeInteger(ordinal)) return null;
  return { lineage: lineageKey("BTI"), order: [timestamp, ordinal] };
}

function comparableKsportGeneration(generation: string): ComparableAuthoritativeGeneration | null {
  const http = /^(?:(.+):)?ksport-http:(0|[1-9]\d*):([1-9]\d*)$/u.exec(generation);
  if (http !== null) {
    const tabId = Number(http[2]);
    const ordinal = Number(http[3]);
    if (!Number.isSafeInteger(tabId) || !Number.isSafeInteger(ordinal)) return null;
    return { lineage: lineageKey("KSPORT_HTTP", http[1] ?? "", http[2]!), order: [ordinal, 0] };
  }

  const ws = /^(.+):ksport-ws:(?:ksport-stream-)?([1-9]\d*):([1-9]\d*)$/u.exec(generation);
  if (ws === null) return null;
  const streamOrdinal = Number(ws[2]);
  const recoveryOrdinal = Number(ws[3]);
  if (!Number.isSafeInteger(streamOrdinal) || !Number.isSafeInteger(recoveryOrdinal)) return null;
  return { lineage: lineageKey("KSPORT_WS", ws[1]!), order: [streamOrdinal, recoveryOrdinal] };
}

function comparableSabaGeneration(generation: string): ComparableAuthoritativeGeneration | null {
  const match = /^(.+):saba:([1-9]\d*):(0|[1-9]\d*)$/u.exec(generation);
  if (match === null) return null;
  const streamOrdinal = Number(match[2]);
  const sequence = Number(match[3]);
  if (!Number.isSafeInteger(streamOrdinal) || !Number.isSafeInteger(sequence)) return null;
  return { lineage: lineageKey("SABA", match[1]!), order: [streamOrdinal, sequence] };
}

// SABA's DOM fallback publishes one authoritative generation per accepted
// snapshot, `<sourceEpoch>:dom:<sequence>`, every few seconds. The fallback
// parser cannot read it (the segment before the sequence ends in `dom`), so
// each one landed in the opaque set and, 256 snapshots later, every further
// DOM baseline was refused as CATALOG_COVERAGE_REJECTED. Measured 2026-09-01:
// SABA froze for five minutes at a time, ten to fifteen minutes after every
// fresh epoch, while its socket never resent reset. Sequence order within one
// source epoch is the lineage that was always intended.
function comparableSabaDomGeneration(generation: string): ComparableAuthoritativeGeneration | null {
  const match = /^(.+):dom:(0|[1-9]\d*)$/u.exec(generation);
  if (match === null) return null;
  const sequence = Number(match[2]);
  if (!Number.isSafeInteger(sequence)) return null;
  return { lineage: lineageKey("SABA_DOM", match[1]!), order: [sequence, 0] };
}

function comparableTsportGeneration(generation: string): ComparableAuthoritativeGeneration | null {
  if (!generation.startsWith('["TSPORT",')) return null;
  let parsed: unknown;
  try { parsed = JSON.parse(generation); } catch { return null; }
  if (!Array.isArray(parsed) || parsed.length !== 5 || parsed[0] !== "TSPORT" ||
    typeof parsed[1] !== "string" || parsed[1].length === 0 ||
    typeof parsed[2] !== "string" || parsed[2].length === 0 ||
    typeof parsed[3] !== "string" || parsed[3].length === 0 ||
    typeof parsed[4] !== "number" || !Number.isSafeInteger(parsed[4]) || parsed[4] < 0) return null;
  return { lineage: lineageKey("TSPORT", parsed[1], parsed[2]), order: [parsed[4], 0] };
}

function comparableFallbackGeneration(generation: string): ComparableAuthoritativeGeneration | null {
  const match = /^(.+):(0|[1-9]\d*)$/u.exec(generation);
  if (match === null) return null;
  const sourceEpoch = match[1]!;
  const canonicalEpoch = /^(.+):(0|[1-9]\d*)$/u.exec(sourceEpoch);
  if (canonicalEpoch === null) return null;
  const epochGeneration = Number(canonicalEpoch[2]);
  const sequence = Number(match[2]);
  if (!Number.isSafeInteger(epochGeneration) || !Number.isSafeInteger(sequence)) return null;
  return { lineage: lineageKey("FALLBACK", sourceEpoch), order: [sequence, 0] };
}

function hasReservedGenerationSyntax(generation: string): boolean {
  return generation.startsWith("cmd:") || generation.startsWith("im:") || generation.startsWith("bti:") ||
    generation.startsWith("ksport-http:") || generation.includes(":ksport-http:") ||
    generation.includes(":ksport-ws:") || generation.includes(":saba:") || generation.includes(":dom:") ||
    generation.startsWith("[") || generation.startsWith("{");
}

function lineageKey(kind: string, ...parts: readonly string[]): string {
  return JSON.stringify([kind, ...parts]);
}

function compareOrder(left: ComparableAuthoritativeOrder, right: ComparableAuthoritativeOrder): number {
  if (left[0] !== right[0]) return left[0] < right[0] ? -1 : 1;
  if (left[1] !== right[1]) return left[1] < right[1] ? -1 : 1;
  return 0;
}

function rememberOpaqueGeneration(generations: Set<string>, generation: string): void {
  if (!generations.has(generation) && generations.size < MAX_OPAQUE_AUTHORITATIVE_GENERATIONS) {
    generations.add(generation);
  }
}
