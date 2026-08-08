import { normalizeName } from "./normalize-name.js";

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

/** Preserves provider home/away orientation as part of Football identity. */
export function buildFootballEventKey(input: FootballIdentity): string {
  return canonicalKey([
    "football",
    requiredName(input.competition, "competition"),
    requiredName(input.seasonStage, "seasonStage"),
    requiredUtc(input.kickoffUtc, "kickoffUtc"),
    requiredName(input.home, "home"),
    requiredName(input.away, "away"),
    requiredName(input.eventScope, "eventScope")
  ]);
}

/**
 * Sorts teams only for LoL candidate identity; provider side orientation must
 * remain separate mapping evidence and is intentionally absent from this key.
 */
export function buildLolEventKey(input: LolIdentity): string {
  const teamA = requiredName(input.teamA ?? input.participantA, "teamA");
  const teamB = requiredName(input.teamB ?? input.participantB, "teamB");
  const [firstTeam, secondTeam] =
    teamA.localeCompare(teamB) <= 0 ? ([teamA, teamB] as const) : ([teamB, teamA] as const);

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
