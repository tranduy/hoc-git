import {
  normalizeName,
  resolveAliasForCategory,
  type VersionedAliasRegistry
} from "./normalize-name.js";

export class CanonicalIdentityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CanonicalIdentityError";
  }
}

export interface FootballIdentity {
  readonly competition: string;
  readonly seasonStage: string;
  readonly kickoffUtc: string;
  readonly home: string;
  readonly away: string;
  readonly eventScope: string;
  /** Optional versioned aliases; without one, participants are canonical IDs. */
  readonly aliasRegistry?: VersionedAliasRegistry;
}

export interface LolIdentity {
  /** Tournament is the LoL equivalent of a Football competition. */
  readonly tournament?: string;
  /** Accepted for callers working directly from ProviderEvent. */
  readonly competition?: string;
  readonly seasonStage: string;
  readonly startAtUtc?: string;
  /** Accepted as an unambiguous synonym for startAtUtc. */
  readonly kickoffUtc?: string;
  readonly teamA?: string;
  readonly teamB?: string;
  /** Accepted for callers working directly from ProviderEvent. */
  readonly participantA?: string;
  readonly participantB?: string;
  readonly bestOf: number;
  /** Optional versioned aliases; without one, participants are canonical IDs. */
  readonly aliasRegistry?: VersionedAliasRegistry;
}

function requiredName(value: string | undefined, field: string): string {
  if (typeof value !== "string") {
    throw new CanonicalIdentityError(`${field} is required`);
  }

  const normalized = normalizeName(value);

  if (!normalized) {
    throw new CanonicalIdentityError(`${field} is required`);
  }

  return normalized;
}

function requiredUtc(value: string | undefined, field: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new CanonicalIdentityError(`${field} is required`);
  }

  if (!/(?:Z|[+-]\d{2}:?\d{2})$/i.test(value)) {
    throw new CanonicalIdentityError(`${field} must include a UTC offset`);
  }

  const timestamp = Date.parse(value);

  if (Number.isNaN(timestamp)) {
    throw new CanonicalIdentityError(`${field} must be a valid UTC timestamp`);
  }

  return new Date(timestamp).toISOString();
}

function requiredBestOf(value: number | undefined): number {
  if (!Number.isInteger(value) || value === undefined || value <= 0) {
    throw new CanonicalIdentityError("bestOf is required and must be a positive integer");
  }

  return value;
}

function canonicalKey(parts: readonly string[]): string {
  return parts.join("|");
}

function canonicalParticipant(
  value: string | undefined,
  field: string,
  category: "FOOTBALL" | "LOL",
  aliasRegistry: VersionedAliasRegistry | undefined
): string {
  const normalized = requiredName(value, field);

  return aliasRegistry
    ? resolveAliasForCategory(normalized, category, aliasRegistry).canonical
    : normalized;
}

function compareCanonicalIds(left: string, right: string): number {
  if (left < right) {
    return -1;
  }

  if (left > right) {
    return 1;
  }

  return 0;
}

/** Preserves provider home/away orientation as part of Football identity. */
export function buildFootballEventKey(input: FootballIdentity): string {
  return canonicalKey([
    "football",
    requiredName(input.competition, "competition"),
    requiredName(input.seasonStage, "seasonStage"),
    requiredUtc(input.kickoffUtc, "kickoffUtc"),
    canonicalParticipant(input.home, "home", "FOOTBALL", input.aliasRegistry),
    canonicalParticipant(input.away, "away", "FOOTBALL", input.aliasRegistry),
    requiredName(input.eventScope, "eventScope")
  ]);
}

/**
 * Sorts teams only for LoL candidate identity; provider side orientation must
 * remain separate mapping evidence and is intentionally absent from this key.
 */
export function buildLolEventKey(input: LolIdentity): string {
  const teamA = canonicalParticipant(
    input.teamA ?? input.participantA,
    "teamA",
    "LOL",
    input.aliasRegistry
  );
  const teamB = canonicalParticipant(
    input.teamB ?? input.participantB,
    "teamB",
    "LOL",
    input.aliasRegistry
  );
  const [firstTeam, secondTeam] =
    compareCanonicalIds(teamA, teamB) <= 0
      ? ([teamA, teamB] as const)
      : ([teamB, teamA] as const);

  return canonicalKey([
    "lol",
    requiredName(input.tournament ?? input.competition, "tournament"),
    requiredName(input.seasonStage, "seasonStage"),
    requiredUtc(input.startAtUtc ?? input.kickoffUtc, "startAtUtc"),
    firstTeam,
    secondTeam,
    String(requiredBestOf(input.bestOf))
  ]);
}
