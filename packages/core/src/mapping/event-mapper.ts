import type {
  MappingEvidence,
  MappingStatus,
  ProviderEvent
} from "@tool-chenh/contracts";
import {
  buildFootballEventKey,
  buildLolEventKey
} from "../identity/canonical-key.js";
import {
  resolveAliasForCategory,
  type VersionedAliasRegistry,
  type VersionedAliasResolution
} from "../identity/normalize-name.js";

export interface MappingPolicy {
  readonly prematchToleranceMs: number;
  readonly liveClockToleranceMs: number;
  readonly aliasRegistry: VersionedAliasRegistry;
}

type NormalizedEventBase = Omit<
  ProviderEvent,
  "category" | "seasonStage" | "startAtUtcMs" | "bestOf" | "eventScope"
> & {
  readonly seasonStage: string | null;
  readonly startAtUtcMs: number | null;
  readonly canonicalParticipantA: string | null;
  readonly canonicalParticipantB: string | null;
};

export type FootballEventScope = "REGULAR_TIME" | "FIRST_HALF" | "SECOND_HALF";
export type LolEventScope = "SERIES" | "MAP_1" | "MAP_2" | "MAP_3" | "MAP_4" | "MAP_5";

export interface FootballLiveState {
  readonly period: string | null;
  readonly scoreHome: number | null;
  readonly scoreAway: number | null;
  readonly clockMs: number | null;
}

export interface NormalizedFootballEvent extends NormalizedEventBase {
  readonly category: "FOOTBALL";
  readonly eventScope: FootballEventScope | null;
  readonly bestOf: null;
  readonly isVirtual: boolean | null;
  readonly sportVariant: string | null;
  readonly rematchCandidate: boolean | null;
  readonly fixtureDiscriminator: string | null;
  readonly liveState: FootballLiveState | null;
}

export interface LolLiveState {
  readonly seriesScoreA: number | null;
  readonly seriesScoreB: number | null;
  readonly currentMap: number | null;
  readonly mapState: string | null;
}

export interface NormalizedLolEvent extends NormalizedEventBase {
  readonly category: "LOL";
  readonly eventScope: LolEventScope | null;
  readonly bestOf: number | null;
  readonly gameVariant: string | null;
  readonly rematchCandidate: boolean | null;
  readonly fixtureDiscriminator: string | null;
  readonly liveState: LolLiveState | null;
}

export type NormalizedEvent = NormalizedFootballEvent | NormalizedLolEvent;
export type ParticipantOrientation = "SAME" | "REVERSED";

export interface EventSource {
  readonly provider: string;
  readonly providerEventId: string;
}

export interface EventMappingResult {
  readonly status: MappingStatus;
  readonly canonicalEventId: string | null;
  readonly category: NormalizedEvent["category"] | null;
  readonly participantOrientation: ParticipantOrientation | null;
  readonly canonicalParticipantIds: readonly [string, string] | null;
  readonly leftSource: EventSource;
  readonly rightSource: EventSource;
  readonly evidence: readonly MappingEvidence[];
}

type EventGate = (
  left: NormalizedEvent,
  right: NormalizedEvent,
  policy: MappingPolicy
) => MappingEvidence;

const MISSING_REASON = "MISSING_MANDATORY_EVIDENCE";

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
  expected: string | number | boolean | null,
  actual: string | number | boolean | null
): MappingEvidence {
  if (isMissing(expected) || isMissing(actual)) {
    return missing(gate, expected, actual);
  }

  return expected === actual
    ? passed(gate, expected, actual)
    : contradicted(gate, expected, actual);
}

function sameCategory(left: NormalizedEvent, right: NormalizedEvent): MappingEvidence {
  return compareRequired("sameCategory", left.category, right.category);
}

function validMappingPolicy(
  _left: NormalizedEvent,
  _right: NormalizedEvent,
  policy: MappingPolicy
): MappingEvidence {
  const gate = "validMappingPolicy";
  const values = [policy.prematchToleranceMs, policy.liveClockToleranceMs];
  if (
    policy.aliasRegistry === undefined ||
    isMissing(policy.aliasRegistry.version)
  ) {
    return missing(gate, "versioned alias registry", policy.aliasRegistry?.version);
  }

  const valid = values.every((value) => Number.isSafeInteger(value) && value >= 0);
  return valid
    ? passed(gate, "finite tolerances and versioned aliases", {
        tolerances: values,
        aliasRegistryVersion: policy.aliasRegistry.version
      })
    : contradicted(gate, "finite nonnegative integer tolerances", values);
}

function distinctEventSources(left: NormalizedEvent, right: NormalizedEvent): MappingEvidence {
  const gate = "distinctEventSources";
  const expected = [
    { provider: left.provider, providerEventId: left.providerEventId },
    { provider: right.provider, providerEventId: right.providerEventId }
  ];

  if (
    [left.provider, left.providerEventId, right.provider, right.providerEventId].some(isMissing)
  ) {
    return missing(gate, "two complete provider event identities", expected);
  }

  return left.provider !== right.provider
    ? passed(gate, "distinct providers", expected)
    : contradicted(gate, "distinct providers", expected);
}

function nonnegativeInteger(value: unknown): boolean {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function positiveInteger(value: unknown): boolean {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function validCommonSemantics(event: NormalizedEvent): "VALID" | "MISSING" | "INVALID" {
  const required = [
    event.competition,
    event.seasonStage,
    event.eventScope,
    event.participantA,
    event.participantB,
    event.canonicalParticipantA,
    event.canonicalParticipantB,
    event.startAtUtcMs
  ];
  if (required.some(isMissing)) {
    return "MISSING";
  }

  const validTimestamp =
    nonnegativeInteger(event.startAtUtcMs) &&
    event.startAtUtcMs! <= 8_640_000_000_000_000;
  const distinctParticipants =
    event.canonicalParticipantA !== event.canonicalParticipantB &&
    event.participantA.trim() !== event.participantB.trim();
  if (!validTimestamp || !distinctParticipants) {
    return "INVALID";
  }

  if (!event.isLive) {
    return event.category === "LOL" && !positiveInteger(event.bestOf)
      ? "INVALID"
      : "VALID";
  }

  if (event.liveState === null) {
    return "MISSING";
  }

  if (event.category === "FOOTBALL") {
    const state = event.liveState;
    if ([state.period, state.scoreHome, state.scoreAway, state.clockMs].some(isMissing)) {
      return "MISSING";
    }

    return nonnegativeInteger(state.scoreHome) &&
      nonnegativeInteger(state.scoreAway) &&
      nonnegativeInteger(state.clockMs)
      ? "VALID"
      : "INVALID";
  }

  const state = event.liveState;
  if (
    [
      event.bestOf,
      state.seriesScoreA,
      state.seriesScoreB,
      state.currentMap,
      state.mapState
    ].some(isMissing)
  ) {
    return "MISSING";
  }

  const knownMapStates = new Set([
    "NOT_STARTED",
    "IN_PROGRESS",
    "PAUSED",
    "SUSPENDED",
    "FINISHED"
  ]);
  const bestOf = event.bestOf!;
  const scoreA = state.seriesScoreA!;
  const scoreB = state.seriesScoreB!;
  const currentMap = state.currentMap!;
  const mapFinished = state.mapState === "FINISHED";
  const completedMaps = mapFinished ? currentMap : currentMap - 1;
  const winsRequired = Math.ceil(bestOf / 2);
  const scoreLimit = mapFinished ? winsRequired : winsRequired - 1;

  return positiveInteger(bestOf) &&
    nonnegativeInteger(scoreA) &&
    nonnegativeInteger(scoreB) &&
    positiveInteger(currentMap) &&
    currentMap <= bestOf &&
    knownMapStates.has(state.mapState!) &&
    scoreA <= scoreLimit &&
    scoreB <= scoreLimit &&
    scoreA + scoreB === completedMaps
    ? "VALID"
    : "INVALID";
}

function validEventSemantics(left: NormalizedEvent, right: NormalizedEvent): MappingEvidence {
  const gate = "validEventSemantics";
  const expected = "valid timestamps, distinct participants, format and live-state values";
  const actual = [validCommonSemantics(left), validCommonSemantics(right)];
  if (actual.includes("INVALID")) {
    return contradicted(gate, expected, actual);
  }

  if (actual.includes("MISSING")) {
    return missing(gate, expected, actual);
  }

  return passed(gate, expected, actual);
}

function sameNonVirtualSport(left: NormalizedEvent, right: NormalizedEvent): MappingEvidence {
  const gate = "sameNonVirtualSport";

  if (left.category !== "FOOTBALL" || right.category !== "FOOTBALL") {
    return contradicted(gate, "FOOTBALL/non-virtual", `${left.category}/${right.category}`);
  }

  const values = [left.sportVariant, right.sportVariant, left.isVirtual, right.isVirtual];
  if (values.some(isMissing)) {
    return missing(gate, "FOOTBALL/non-virtual", values);
  }

  const compatible =
    left.sportVariant === "FOOTBALL" &&
    right.sportVariant === "FOOTBALL" &&
    left.isVirtual === false &&
    right.isVirtual === false;

  return compatible
    ? passed(gate, "FOOTBALL/non-virtual", "FOOTBALL/non-virtual")
    : contradicted(gate, "FOOTBALL/non-virtual", values);
}

function sameCompetitionAndStage(left: NormalizedEvent, right: NormalizedEvent): MappingEvidence {
  const gate = "sameCompetitionAndStage";
  const expected = [left.competition, left.seasonStage];
  const actual = [right.competition, right.seasonStage];

  if ([...expected, ...actual].some(isMissing)) {
    return missing(gate, expected, actual);
  }

  return left.competition === right.competition && left.seasonStage === right.seasonStage
    ? passed(gate, expected, actual)
    : contradicted(gate, expected, actual);
}

interface ParticipantAliasProof {
  readonly provider: string;
  readonly side: "A" | "B";
  readonly raw: string;
  readonly claimedCanonical: string;
  readonly resolution: VersionedAliasResolution;
}

function participantProofs(
  left: NormalizedEvent,
  right: NormalizedEvent,
  policy: MappingPolicy
): readonly ParticipantAliasProof[] | null {
  if (
    policy.aliasRegistry === undefined ||
    [
      left.participantA,
      left.participantB,
      right.participantA,
      right.participantB,
      left.canonicalParticipantA,
      left.canonicalParticipantB,
      right.canonicalParticipantA,
      right.canonicalParticipantB
    ].some(isMissing)
  ) {
    return null;
  }

  return [
    {
      provider: left.provider,
      side: "A",
      raw: left.participantA,
      claimedCanonical: left.canonicalParticipantA!,
      resolution: resolveAliasForCategory(left.participantA, left.category, policy.aliasRegistry)
    },
    {
      provider: left.provider,
      side: "B",
      raw: left.participantB,
      claimedCanonical: left.canonicalParticipantB!,
      resolution: resolveAliasForCategory(left.participantB, left.category, policy.aliasRegistry)
    },
    {
      provider: right.provider,
      side: "A",
      raw: right.participantA,
      claimedCanonical: right.canonicalParticipantA!,
      resolution: resolveAliasForCategory(right.participantA, right.category, policy.aliasRegistry)
    },
    {
      provider: right.provider,
      side: "B",
      raw: right.participantB,
      claimedCanonical: right.canonicalParticipantB!,
      resolution: resolveAliasForCategory(right.participantB, right.category, policy.aliasRegistry)
    }
  ];
}

function participantAliasEvidence(
  gate: string,
  left: NormalizedEvent,
  right: NormalizedEvent,
  policy: MappingPolicy,
  ordered: boolean
): MappingEvidence {
  let proofs: readonly ParticipantAliasProof[] | null;
  try {
    proofs = participantProofs(left, right, policy);
  } catch (error) {
    return contradicted(
      gate,
      "valid explicit alias evidence",
      error instanceof Error ? error.message : String(error)
    );
  }

  if (proofs === null) {
    return missing(gate, "complete explicit alias evidence", "<missing>");
  }

  if (
    proofs.some(
      (proof) => proof.resolution.canonical !== proof.claimedCanonical
    )
  ) {
    return contradicted(gate, "claimed canonical IDs match explicit aliases", proofs);
  }

  const leftCanonical = [proofs[0]!.resolution.canonical, proofs[1]!.resolution.canonical];
  const rightCanonical = [proofs[2]!.resolution.canonical, proofs[3]!.resolution.canonical];
  const same = leftCanonical[0] === rightCanonical[0] && leftCanonical[1] === rightCanonical[1];
  const reversed = leftCanonical[0] === rightCanonical[1] && leftCanonical[1] === rightCanonical[0];
  const compatible = ordered ? same : same || reversed;

  if (!compatible) {
    return contradicted(gate, { ordered, canonical: leftCanonical }, proofs);
  }

  if (proofs.some((proof) => proof.resolution.source !== "EXPLICIT_ALIAS")) {
    return missing(gate, "EXPLICIT_ALIAS for every participant", proofs);
  }

  return passed(gate, { ordered, canonical: leftCanonical }, proofs);
}

function sameHomeAway(
  left: NormalizedEvent,
  right: NormalizedEvent,
  policy: MappingPolicy
): MappingEvidence {
  const gate = "sameHomeAway";

  if (left.category !== "FOOTBALL" || right.category !== "FOOTBALL") {
    return contradicted(gate, "ordered Football participants", `${left.category}/${right.category}`);
  }

  return participantAliasEvidence(gate, left, right, policy, true);
}

function compatibleKickoff(
  left: NormalizedEvent,
  right: NormalizedEvent,
  policy: MappingPolicy
): MappingEvidence {
  const gate = "compatibleKickoff";
  if (isMissing(left.startAtUtcMs) || isMissing(right.startAtUtcMs)) {
    return missing(gate, left.startAtUtcMs, right.startAtUtcMs);
  }

  const delta = Math.abs(left.startAtUtcMs! - right.startAtUtcMs!);
  return delta <= policy.prematchToleranceMs
    ? passed(gate, `<=${policy.prematchToleranceMs}ms`, `${delta}ms`)
    : contradicted(gate, `<=${policy.prematchToleranceMs}ms`, `${delta}ms`);
}

function compatibleRematchEvidence(left: NormalizedEvent, right: NormalizedEvent): MappingEvidence {
  const gate = "compatibleRematchEvidence";
  if (left.category !== right.category) {
    return contradicted(gate, "same-category rematch evidence", `${left.category}/${right.category}`);
  }

  if (left.rematchCandidate === null || right.rematchCandidate === null) {
    return missing(gate, left.rematchCandidate, right.rematchCandidate);
  }

  if (left.rematchCandidate !== right.rematchCandidate) {
    return contradicted(gate, left.rematchCandidate, right.rematchCandidate);
  }

  if (!left.rematchCandidate) {
    return passed(gate, "ordinary fixture", "ordinary fixture");
  }

  if (isMissing(left.fixtureDiscriminator) || isMissing(right.fixtureDiscriminator)) {
    return missing(gate, left.fixtureDiscriminator, right.fixtureDiscriminator);
  }

  return left.fixtureDiscriminator === right.fixtureDiscriminator
    ? passed(gate, left.fixtureDiscriminator, right.fixtureDiscriminator)
    : contradicted(gate, left.fixtureDiscriminator, right.fixtureDiscriminator);
}

function compatibleLiveState(
  left: NormalizedEvent,
  right: NormalizedEvent,
  policy: MappingPolicy
): MappingEvidence {
  const gate = "compatibleLiveState";
  if (left.category !== "FOOTBALL" || right.category !== "FOOTBALL") {
    return contradicted(gate, "Football live state", `${left.category}/${right.category}`);
  }

  if (left.isLive !== right.isLive) {
    return contradicted(gate, left.isLive, right.isLive);
  }

  if (!left.isLive) {
    return passed(gate, "PREMATCH", "PREMATCH");
  }

  if (left.liveState === null || right.liveState === null) {
    return missing(gate, left.liveState, right.liveState);
  }

  const required = [
    left.liveState.period,
    left.liveState.scoreHome,
    left.liveState.scoreAway,
    left.liveState.clockMs,
    right.liveState.period,
    right.liveState.scoreHome,
    right.liveState.scoreAway,
    right.liveState.clockMs
  ];
  if (required.some(isMissing)) {
    return missing(gate, left.liveState, right.liveState);
  }

  const clockDelta = Math.abs(left.liveState.clockMs! - right.liveState.clockMs!);
  const compatible =
    left.liveState.period === right.liveState.period &&
    left.liveState.scoreHome === right.liveState.scoreHome &&
    left.liveState.scoreAway === right.liveState.scoreAway &&
    clockDelta <= policy.liveClockToleranceMs;

  return compatible
    ? passed(gate, left.liveState, right.liveState)
    : contradicted(gate, left.liveState, right.liveState);
}

const footballEventScopes = new Set<string>(["REGULAR_TIME", "FIRST_HALF", "SECOND_HALF"]);
const lolEventScopes = new Set<string>(["SERIES", "MAP_1", "MAP_2", "MAP_3", "MAP_4", "MAP_5"]);

function validCategoryEventScope(left: NormalizedEvent, right: NormalizedEvent): MappingEvidence {
  const gate = "validCategoryEventScope";
  if (isMissing(left.eventScope) || isMissing(right.eventScope)) {
    return missing(gate, "category-specific event scopes", [left.eventScope, right.eventScope]);
  }

  const leftAllowed = left.category === "FOOTBALL" ? footballEventScopes : lolEventScopes;
  const rightAllowed = right.category === "FOOTBALL" ? footballEventScopes : lolEventScopes;
  const valid = leftAllowed.has(left.eventScope!) && rightAllowed.has(right.eventScope!);
  return valid
    ? passed(gate, "category-specific event scopes", [left.eventScope, right.eventScope])
    : contradicted(gate, "category-specific event scopes", [left.eventScope, right.eventScope]);
}

function compatibleEventScope(left: NormalizedEvent, right: NormalizedEvent): MappingEvidence {
  return compareRequired("compatibleEventScope", left.eventScope, right.eventScope);
}

function sameLolPcGame(left: NormalizedEvent, right: NormalizedEvent): MappingEvidence {
  const gate = "sameLolPcGame";
  if (left.category !== "LOL" || right.category !== "LOL") {
    return contradicted(gate, "LOL_PC", `${left.category}/${right.category}`);
  }

  if (isMissing(left.gameVariant) || isMissing(right.gameVariant)) {
    return missing(gate, "LOL_PC", [left.gameVariant, right.gameVariant]);
  }

  return left.gameVariant === "LOL_PC" && right.gameVariant === "LOL_PC"
    ? passed(gate, "LOL_PC", "LOL_PC")
    : contradicted(gate, "LOL_PC", [left.gameVariant, right.gameVariant]);
}

function sameTournamentAndStage(left: NormalizedEvent, right: NormalizedEvent): MappingEvidence {
  const evidence = sameCompetitionAndStage(left, right);
  return { ...evidence, gate: "sameTournamentAndStage" };
}

function orientationOf(
  left: NormalizedEvent,
  right: NormalizedEvent
): ParticipantOrientation | null {
  const values = [
    left.canonicalParticipantA,
    left.canonicalParticipantB,
    right.canonicalParticipantA,
    right.canonicalParticipantB
  ];
  if (values.some(isMissing)) {
    return null;
  }

  if (
    left.canonicalParticipantA === right.canonicalParticipantA &&
    left.canonicalParticipantB === right.canonicalParticipantB
  ) {
    return "SAME";
  }

  if (
    left.canonicalParticipantA === right.canonicalParticipantB &&
    left.canonicalParticipantB === right.canonicalParticipantA
  ) {
    return "REVERSED";
  }

  return null;
}

function sameLolTeams(
  left: NormalizedEvent,
  right: NormalizedEvent,
  policy: MappingPolicy
): MappingEvidence {
  const gate = "sameLolTeams";
  if (left.category !== "LOL" || right.category !== "LOL") {
    return contradicted(gate, "same LoL teams", `${left.category}/${right.category}`);
  }

  return participantAliasEvidence(gate, left, right, policy, false);
}

function sameBestOf(left: NormalizedEvent, right: NormalizedEvent): MappingEvidence {
  const gate = "sameBestOf";
  if (left.category !== "LOL" || right.category !== "LOL") {
    return contradicted(gate, "LoL best-of", `${left.category}/${right.category}`);
  }

  return compareRequired(gate, left.bestOf, right.bestOf);
}

function compatibleLolLiveState(left: NormalizedEvent, right: NormalizedEvent): MappingEvidence {
  const gate = "compatibleLolLiveState";
  if (left.category !== "LOL" || right.category !== "LOL") {
    return contradicted(gate, "LoL live state", `${left.category}/${right.category}`);
  }

  if (left.isLive !== right.isLive) {
    return contradicted(gate, left.isLive, right.isLive);
  }

  if (!left.isLive) {
    return passed(gate, "PREMATCH", "PREMATCH");
  }

  if (left.liveState === null || right.liveState === null) {
    return missing(gate, left.liveState, right.liveState);
  }

  const required = [
    left.liveState.seriesScoreA,
    left.liveState.seriesScoreB,
    left.liveState.currentMap,
    left.liveState.mapState,
    right.liveState.seriesScoreA,
    right.liveState.seriesScoreB,
    right.liveState.currentMap,
    right.liveState.mapState
  ];
  if (required.some(isMissing)) {
    return missing(gate, left.liveState, right.liveState);
  }

  const orientation = orientationOf(left, right);
  if (orientation === null) {
    return contradicted(gate, left.liveState, right.liveState);
  }

  const rightScoreA = orientation === "SAME"
    ? right.liveState.seriesScoreA
    : right.liveState.seriesScoreB;
  const rightScoreB = orientation === "SAME"
    ? right.liveState.seriesScoreB
    : right.liveState.seriesScoreA;
  const compatible =
    left.liveState.seriesScoreA === rightScoreA &&
    left.liveState.seriesScoreB === rightScoreB &&
    left.liveState.currentMap === right.liveState.currentMap &&
    left.liveState.mapState === right.liveState.mapState;

  return compatible
    ? passed(gate, left.liveState, right.liveState)
    : contradicted(gate, left.liveState, right.liveState);
}

const footballGates: readonly EventGate[] = [
  sameCategory,
  validMappingPolicy,
  distinctEventSources,
  validEventSemantics,
  sameNonVirtualSport,
  sameCompetitionAndStage,
  sameHomeAway,
  compatibleKickoff,
  compatibleRematchEvidence,
  compatibleLiveState,
  validCategoryEventScope,
  compatibleEventScope
];

const lolGates: readonly EventGate[] = [
  sameCategory,
  validMappingPolicy,
  distinctEventSources,
  validEventSemantics,
  sameLolPcGame,
  sameTournamentAndStage,
  sameLolTeams,
  compatibleKickoff,
  compatibleRematchEvidence,
  sameBestOf,
  compatibleLolLiveState,
  validCategoryEventScope,
  compatibleEventScope
];

function mappingStatus(evidence: readonly MappingEvidence[]): MappingStatus {
  if (evidence.every((item) => item.passed)) {
    return "VERIFIED";
  }

  return evidence.some((item) => !item.passed && !item.reason.startsWith(MISSING_REASON))
    ? "REJECTED"
    : "REVIEW_REQUIRED";
}

function canonicalEventId(
  status: MappingStatus,
  left: NormalizedEvent,
  right: NormalizedEvent
): string | null {
  if (status !== "VERIFIED" || left.category !== right.category) {
    return null;
  }

  const startAtUtc = new Date(Math.min(left.startAtUtcMs!, right.startAtUtcMs!)).toISOString();

  if (left.category === "FOOTBALL") {
    const baseId = buildFootballEventKey({
      competition: left.competition,
      seasonStage: left.seasonStage!,
      kickoffUtc: startAtUtc,
      home: left.canonicalParticipantA!,
      away: left.canonicalParticipantB!,
      eventScope: left.eventScope!
    });

    return left.rematchCandidate
      ? `${baseId}|fixture:${encodeURIComponent(left.fixtureDiscriminator!.trim())}`
      : baseId;
  }

  const baseId = buildLolEventKey({
    tournament: left.competition,
    seasonStage: left.seasonStage!,
    startAtUtc,
    teamA: left.canonicalParticipantA!,
    teamB: left.canonicalParticipantB!,
    bestOf: left.bestOf!
  });

  return left.rematchCandidate
    ? `${baseId}|fixture:${encodeURIComponent(left.fixtureDiscriminator!.trim())}`
    : baseId;
}

export function mapEvents(
  left: NormalizedEvent,
  right: NormalizedEvent,
  policy: MappingPolicy
): EventMappingResult {
  const gates = left.category === "FOOTBALL" ? footballGates : lolGates;
  const evidence = gates.map((gate) => gate(left, right, policy));
  const status = mappingStatus(evidence);

  return {
    status,
    canonicalEventId: canonicalEventId(status, left, right),
    category: status === "VERIFIED" ? left.category : null,
    participantOrientation: status === "VERIFIED" ? orientationOf(left, right) : null,
    canonicalParticipantIds: status === "VERIFIED"
      ? [left.canonicalParticipantA!, left.canonicalParticipantB!]
      : null,
    leftSource: {
      provider: left.provider,
      providerEventId: left.providerEventId
    },
    rightSource: {
      provider: right.provider,
      providerEventId: right.providerEventId
    },
    evidence
  };
}
