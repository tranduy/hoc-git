import type {
  MappingEvidence,
  MappingStatus,
  MarketType,
  ProviderMarket,
  Scope
} from "@tool-chenh/contracts";
import { Decimal } from "../odds/convert.js";
import type { EventMappingResult } from "./event-mapper.js";

export interface NormalizedSelection {
  readonly providerSelectionId: string;
  readonly canonicalOutcomeId: string | null;
}

export interface NormalizedMarket extends Omit<ProviderMarket, "settlementProfile"> {
  readonly settlementProfile: string | null;
  readonly selections: readonly NormalizedSelection[] | null;
}

export interface SelectionMapping {
  readonly canonicalOutcomeId: string;
  readonly leftProviderSelectionId: string;
  readonly rightProviderSelectionId: string;
}

export interface MappedMarketSource {
  readonly provider: string;
  readonly providerEventId: string;
  readonly providerMarketId: string;
}

export interface MappedMarketSources {
  readonly left: MappedMarketSource;
  readonly right: MappedMarketSource;
}

export interface MarketMappingResult {
  readonly status: MappingStatus;
  readonly canonicalMarketId: string | null;
  readonly normalizedLine: string | null;
  readonly selectionMappings: readonly SelectionMapping[];
  readonly sourceMarkets: MappedMarketSources;
  readonly executionConfidence: "HIGH" | "BLOCKED";
  readonly evidence: readonly MappingEvidence[];
}

type MarketGate = (
  eventMapping: EventMappingResult,
  left: NormalizedMarket,
  right: NormalizedMarket
) => MappingEvidence;

const MISSING_REASON = "MISSING_MANDATORY_EVIDENCE";
const NO_LINE_MARKET_TYPES = new Set<MarketType>([
  "FT_1X2",
  "FH_1X2",
  "SERIES_WINNER",
  "MAP_WINNER"
]);

function printable(value: unknown): string {
  if (value === null || value === undefined || value === "") {
    return "<missing>";
  }

  return typeof value === "string" ? value : JSON.stringify(value);
}

function passed(gate: string, expected: unknown, actual: unknown): MappingEvidence {
  return {
    gate,
    passed: true,
    expected: printable(expected),
    actual: printable(actual),
    reason: "hard gate passed"
  };
}

function missing(gate: string, expected: unknown, actual: unknown): MappingEvidence {
  return {
    gate,
    passed: false,
    expected: printable(expected),
    actual: printable(actual),
    reason: `${MISSING_REASON}: cannot verify ${gate}`
  };
}

function contradicted(gate: string, expected: unknown, actual: unknown): MappingEvidence {
  return {
    gate,
    passed: false,
    expected: printable(expected),
    actual: printable(actual),
    reason: `CONTRADICTION: ${gate} differs`
  };
}

function isMissing(value: unknown): boolean {
  return value === null ||
    value === undefined ||
    (typeof value === "string" && value.trim() === "");
}

function compareRequired(
  gate: string,
  expected: string | null,
  actual: string | null
): MappingEvidence {
  if (isMissing(expected) || isMissing(actual)) {
    return missing(gate, expected, actual);
  }

  return expected === actual
    ? passed(gate, expected, actual)
    : contradicted(gate, expected, actual);
}

function verifiedEventMapping(
  eventMapping: EventMappingResult
): MappingEvidence {
  const gate = "verifiedEventMapping";
  if (eventMapping.status === "VERIFIED" && eventMapping.canonicalEventId !== null) {
    return passed(gate, "VERIFIED", "VERIFIED");
  }

  return eventMapping.status === "REJECTED"
    ? contradicted(gate, "VERIFIED", eventMapping.status)
    : missing(gate, "VERIFIED", eventMapping.status);
}

function sameEventCategory(
  eventMapping: EventMappingResult,
  left: NormalizedMarket,
  right: NormalizedMarket
): MappingEvidence {
  const gate = "sameEventCategory";
  if (eventMapping.category === null) {
    return missing(gate, "verified event category", [left.category, right.category]);
  }

  const compatible =
    left.category === eventMapping.category && right.category === eventMapping.category;
  return compatible
    ? passed(gate, eventMapping.category, [left.category, right.category])
    : contradicted(gate, eventMapping.category, [left.category, right.category]);
}

function marketEventProvenance(
  eventMapping: EventMappingResult,
  left: NormalizedMarket,
  right: NormalizedMarket
): MappingEvidence {
  const gate = "marketEventProvenance";
  const expected = [eventMapping.leftSource, eventMapping.rightSource];
  const actual = [
    { provider: left.provider, providerEventId: left.providerEventId },
    { provider: right.provider, providerEventId: right.providerEventId }
  ];

  if (
    [
      eventMapping.leftSource.provider,
      eventMapping.leftSource.providerEventId,
      eventMapping.rightSource.provider,
      eventMapping.rightSource.providerEventId,
      left.provider,
      left.providerEventId,
      right.provider,
      right.providerEventId
    ].some(isMissing)
  ) {
    return missing(gate, expected, actual);
  }

  const compatible =
    left.provider === eventMapping.leftSource.provider &&
    left.providerEventId === eventMapping.leftSource.providerEventId &&
    right.provider === eventMapping.rightSource.provider &&
    right.providerEventId === eventMapping.rightSource.providerEventId;
  return compatible
    ? passed(gate, expected, actual)
    : contradicted(gate, expected, actual);
}

function distinctMarketSources(
  _eventMapping: EventMappingResult,
  left: NormalizedMarket,
  right: NormalizedMarket
): MappingEvidence {
  const gate = "distinctMarketSources";
  const expected = [
    { provider: left.provider, providerMarketId: left.providerMarketId },
    { provider: right.provider, providerMarketId: right.providerMarketId }
  ];
  if ([left.providerMarketId, right.providerMarketId].some(isMissing)) {
    return missing(gate, "two complete provider market identities", expected);
  }

  const leftIdentity = `${left.provider}\u0000${left.providerMarketId}`;
  const rightIdentity = `${right.provider}\u0000${right.providerMarketId}`;
  return leftIdentity !== rightIdentity
    ? passed(gate, "distinct provider market identities", expected)
    : contradicted(gate, "distinct provider market identities", expected);
}

function validScopeFor(category: NormalizedMarket["category"], marketType: MarketType): readonly Scope[] {
  if (marketType === "OBSERVE_ONLY") {
    return category === "FOOTBALL"
      ? ["FULL_TIME", "FIRST_HALF"]
      : ["SERIES", "MAP_1", "MAP_2", "MAP_3", "MAP_4", "MAP_5"];
  }

  if (
    marketType.startsWith("FT_") ||
    marketType.startsWith("CORNER_FT_") ||
    marketType.startsWith("CARD_FT_")
  ) {
    return category === "FOOTBALL" ? ["FULL_TIME"] : [];
  }

  if (
    marketType.startsWith("FH_") ||
    marketType.startsWith("CORNER_FH_") ||
    marketType.startsWith("CARD_FH_")
  ) {
    return category === "FOOTBALL" ? ["FIRST_HALF"] : [];
  }

  if (marketType === "SH_AH" || marketType === "SH_TOTAL") {
    return category === "FOOTBALL" ? ["SECOND_HALF"] : [];
  }

  if (marketType === "SERIES_WINNER") {
    return category === "LOL" ? ["SERIES"] : [];
  }

  if (marketType.startsWith("MAP_")) {
    return category === "LOL" ? ["MAP_1", "MAP_2", "MAP_3", "MAP_4", "MAP_5"] : [];
  }

  return [];
}

function validCategoryMarketScope(
  _eventMapping: EventMappingResult,
  left: NormalizedMarket,
  right: NormalizedMarket
): MappingEvidence {
  const gate = "validCategoryMarketScope";
  const leftValid = validScopeFor(left.category, left.marketType).includes(left.scope);
  const rightValid = validScopeFor(right.category, right.marketType).includes(right.scope);
  const expected = "category-compatible market type and scope";
  const actual = [
    `${left.category}/${left.marketType}/${left.scope}`,
    `${right.category}/${right.marketType}/${right.scope}`
  ];

  return leftValid && rightValid
    ? passed(gate, expected, actual)
    : contradicted(gate, expected, actual);
}

function sameScope(
  _eventMapping: EventMappingResult,
  left: NormalizedMarket,
  right: NormalizedMarket
): MappingEvidence {
  return compareRequired("sameScope", left.scope, right.scope);
}

function sameMarketType(
  _eventMapping: EventMappingResult,
  left: NormalizedMarket,
  right: NormalizedMarket
): MappingEvidence {
  return compareRequired("sameMarketType", left.marketType, right.marketType);
}

type NormalizedLine =
  | { readonly kind: "VALUE"; readonly value: string }
  | { readonly kind: "NONE" }
  | { readonly kind: "MISSING" }
  | { readonly kind: "INVALID"; readonly raw: string };

function normalizeLine(market: NormalizedMarket): NormalizedLine {
  if (market.line === null) {
    if (NO_LINE_MARKET_TYPES.has(market.marketType) || market.marketType === "OBSERVE_ONLY") {
      return { kind: "NONE" };
    }

    return { kind: "MISSING" };
  }

  if (NO_LINE_MARKET_TYPES.has(market.marketType)) {
    return { kind: "INVALID", raw: market.line };
  }

  try {
    const value = new Decimal(market.line);
    return value.isFinite()
      ? { kind: "VALUE", value: value.toFixed() }
      : { kind: "INVALID", raw: market.line };
  } catch {
    return { kind: "INVALID", raw: market.line };
  }
}

function lineValue(line: NormalizedLine): string {
  if (line.kind === "VALUE") {
    return line.value;
  }

  if (line.kind === "NONE") {
    return "none";
  }

  return line.kind === "INVALID" ? line.raw : "<missing>";
}

function sameLine(
  _eventMapping: EventMappingResult,
  left: NormalizedMarket,
  right: NormalizedMarket
): MappingEvidence {
  const gate = "sameLine";
  const expected = normalizeLine(left);
  const actual = normalizeLine(right);

  if (expected.kind === "MISSING" || actual.kind === "MISSING") {
    return missing(gate, lineValue(expected), lineValue(actual));
  }

  if (expected.kind === "INVALID" || actual.kind === "INVALID") {
    return contradicted(gate, lineValue(expected), lineValue(actual));
  }

  return lineValue(expected) === lineValue(actual)
    ? passed(gate, lineValue(expected), lineValue(actual))
    : contradicted(gate, lineValue(expected), lineValue(actual));
}

function sameSettlementProfile(
  _eventMapping: EventMappingResult,
  left: NormalizedMarket,
  right: NormalizedMarket
): MappingEvidence {
  return compareRequired(
    "sameSettlementProfile",
    left.settlementProfile,
    right.settlementProfile
  );
}

function sameQuoteStatus(
  _eventMapping: EventMappingResult,
  left: NormalizedMarket,
  right: NormalizedMarket
): MappingEvidence {
  return compareRequired("sameQuoteStatus", left.status, right.status);
}

function selectionListMissing(selections: readonly NormalizedSelection[] | null): boolean {
  return selections === null ||
    selections.length === 0 ||
    selections.some(
      (selection) =>
        isMissing(selection.providerSelectionId) || isMissing(selection.canonicalOutcomeId)
    );
}

function canonicalOutcomes(selections: readonly NormalizedSelection[]): readonly string[] {
  return selections
    .map((selection) => selection.canonicalOutcomeId!)
    .sort((left, right) => left < right ? -1 : left > right ? 1 : 0);
}

function hasDuplicates(values: readonly string[]): boolean {
  return new Set(values).size !== values.length;
}

function sameSelections(
  _eventMapping: EventMappingResult,
  left: NormalizedMarket,
  right: NormalizedMarket
): MappingEvidence {
  const gate = "sameSelections";
  if (selectionListMissing(left.selections) || selectionListMissing(right.selections)) {
    return missing(gate, left.selections, right.selections);
  }

  const expected = canonicalOutcomes(left.selections!);
  const actual = canonicalOutcomes(right.selections!);
  const leftProviderIds = left.selections!.map((selection) => selection.providerSelectionId);
  const rightProviderIds = right.selections!.map((selection) => selection.providerSelectionId);
  if (
    hasDuplicates(expected) ||
    hasDuplicates(actual) ||
    hasDuplicates(leftProviderIds) ||
    hasDuplicates(rightProviderIds)
  ) {
    return contradicted(gate, expected, actual);
  }

  const compatible =
    expected.length === actual.length &&
    expected.every((outcome, index) => outcome === actual[index]);
  return compatible
    ? passed(gate, expected, actual)
    : contradicted(gate, expected, actual);
}

function expectedOutcomeDomain(
  eventMapping: EventMappingResult,
  marketType: MarketType
): readonly string[] | null {
  if (marketType === "FT_1X2" || marketType === "FH_1X2") {
    return ["AWAY", "DRAW", "HOME"];
  }

  if (
    marketType === "FT_TOTAL" ||
    marketType === "FH_TOTAL" ||
    marketType === "SH_TOTAL" ||
    marketType === "CORNER_FT_TOTAL" ||
    marketType === "CORNER_FH_TOTAL" ||
    marketType === "CARD_FT_TOTAL" ||
    marketType === "CARD_FH_TOTAL" ||
    marketType === "MAP_TOTAL_KILLS" ||
    marketType === "MAP_DURATION"
  ) {
    return ["OVER", "UNDER"];
  }

  if (marketType === "OBSERVE_ONLY") {
    return [];
  }

  if (eventMapping.canonicalParticipantIds === null) {
    return null;
  }

  return [...eventMapping.canonicalParticipantIds]
    .sort((left, right) => left < right ? -1 : left > right ? 1 : 0);
}

function validSelectionDomain(
  eventMapping: EventMappingResult,
  left: NormalizedMarket,
  right: NormalizedMarket
): MappingEvidence {
  const gate = "validSelectionDomain";
  if (selectionListMissing(left.selections) || selectionListMissing(right.selections)) {
    return missing(gate, "complete canonical outcome domain", [left.selections, right.selections]);
  }

  if (left.marketType === "OBSERVE_ONLY" && right.marketType === "OBSERVE_ONLY") {
    return passed(gate, "matching observe-only outcomes", canonicalOutcomes(left.selections!));
  }

  const expected = expectedOutcomeDomain(eventMapping, left.marketType);
  if (expected === null) {
    return missing(gate, "mapped canonical participants", eventMapping.canonicalParticipantIds);
  }

  const leftOutcomes = canonicalOutcomes(left.selections!);
  const rightOutcomes = canonicalOutcomes(right.selections!);
  const matches = (actual: readonly string[]) =>
    expected.length === actual.length &&
    expected.every((outcome, index) => outcome === actual[index]);

  return matches(leftOutcomes) && matches(rightOutcomes)
    ? passed(gate, expected, [leftOutcomes, rightOutcomes])
    : contradicted(gate, expected, [leftOutcomes, rightOutcomes]);
}

const marketGates: readonly MarketGate[] = [
  verifiedEventMapping,
  sameEventCategory,
  marketEventProvenance,
  distinctMarketSources,
  validCategoryMarketScope,
  sameScope,
  sameMarketType,
  sameLine,
  sameSettlementProfile,
  sameQuoteStatus,
  sameSelections,
  validSelectionDomain
];

function mappingStatus(evidence: readonly MappingEvidence[]): MappingStatus {
  if (evidence.every((item) => item.passed)) {
    return "VERIFIED";
  }

  return evidence.some((item) => !item.passed && !item.reason.startsWith(MISSING_REASON))
    ? "REJECTED"
    : "REVIEW_REQUIRED";
}

function buildSelectionMappings(
  status: MappingStatus,
  left: NormalizedMarket,
  right: NormalizedMarket
): readonly SelectionMapping[] {
  if (status !== "VERIFIED" || left.selections === null || right.selections === null) {
    return [];
  }

  const rightByOutcome = new Map(
    right.selections.map((selection) => [selection.canonicalOutcomeId!, selection.providerSelectionId])
  );

  return [...left.selections]
    .sort((first, second) => {
      const leftId = first.canonicalOutcomeId!;
      const rightId = second.canonicalOutcomeId!;
      return leftId < rightId ? -1 : leftId > rightId ? 1 : 0;
    })
    .map((selection) => ({
      canonicalOutcomeId: selection.canonicalOutcomeId!,
      leftProviderSelectionId: selection.providerSelectionId,
      rightProviderSelectionId: rightByOutcome.get(selection.canonicalOutcomeId!)!
    }));
}

function canonicalMarketId(
  status: MappingStatus,
  eventMapping: EventMappingResult,
  market: NormalizedMarket,
  normalizedLine: string | null
): string | null {
  if (
    status !== "VERIFIED" ||
    eventMapping.canonicalEventId === null ||
    market.settlementProfile === null
  ) {
    return null;
  }

  return [
    "market",
    encodeURIComponent(eventMapping.canonicalEventId),
    market.scope,
    market.marketType,
    normalizedLine ?? "none",
    encodeURIComponent(market.settlementProfile)
  ].join("|");
}

export function mapMarkets(
  eventMapping: EventMappingResult,
  left: NormalizedMarket,
  right: NormalizedMarket
): MarketMappingResult {
  const eventEvidence = eventMapping.evidence.map((item) => ({
    ...item,
    gate: `event.${item.gate}`
  }));
  const evidence = [
    ...eventEvidence,
    ...marketGates.map((gate) => gate(eventMapping, left, right))
  ];
  const status = mappingStatus(evidence);
  const leftLine = normalizeLine(left);
  const normalizedLine = leftLine.kind === "VALUE" ? leftLine.value : null;
  const executionConfidence =
    status === "VERIFIED" &&
    left.status === "OPEN" &&
    right.status === "OPEN" &&
    left.marketType !== "OBSERVE_ONLY"
      ? "HIGH"
      : "BLOCKED";

  return {
    status,
    canonicalMarketId: canonicalMarketId(status, eventMapping, left, normalizedLine),
    normalizedLine,
    selectionMappings: buildSelectionMappings(status, left, right),
    sourceMarkets: {
      left: {
        provider: left.provider,
        providerEventId: left.providerEventId,
        providerMarketId: left.providerMarketId
      },
      right: {
        provider: right.provider,
        providerEventId: right.providerEventId,
        providerMarketId: right.providerMarketId
      }
    },
    executionConfidence,
    evidence
  };
}
