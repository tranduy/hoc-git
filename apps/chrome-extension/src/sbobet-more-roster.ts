export interface SbobetMoreOwner {
  readonly eventId: string;
  readonly leagueId: string;
  readonly startAtUtcMs: number;
  readonly phase: "PREMATCH" | "LIVE";
  readonly home: string;
  readonly away: string;
}

/** Structural owners only. The caller establishes the source partition and receipt authority. */
export function extractSbobetMoreRoster(body: unknown,
  phase: "PREMATCH" | "LIVE"): readonly SbobetMoreOwner[] | null {
  const limit = 20_000;
  if (phase !== "PREMATCH" && phase !== "LIVE" || !Array.isArray(body) || body.length > limit) return null;
  const dateWrapped = body.some(Array.isArray);
  if (dateWrapped && !body.every(Array.isArray)) return null;
  const leagues: unknown[] = [];
  if (dateWrapped) {
    for (const date of body as unknown[][]) {
      if (leagues.length + date.length > limit) return null;
      leagues.push(...date);
    }
  } else leagues.push(...body);
  const owners = new Map<string, SbobetMoreOwner>();
  let eventCount = 0;
  for (const league of leagues) {
    if (!nativeRecord(league) || !["0", "1", "2"].every(key => Object.hasOwn(league, key)) ||
      typeof league["0"] !== "number" || !Number.isSafeInteger(league["0"]) || league["0"] < 1 ||
      typeof league["1"] !== "string" || !league["1"].trim() || !Array.isArray(league["2"])) return null;
    const leagueId = String(league["0"]);
    if ((eventCount += league["2"].length) > limit) return null;
    for (const event of league["2"]) {
      if (!nativeRecord(event) || !["0", "2", "3", "7", "8"].every(key => Object.hasOwn(event, key))) return null;
      const id = event["8"];
      if (typeof id !== "string" && (typeof id !== "number" || !Number.isSafeInteger(id)) ||
        !/^[1-9]\d{0,19}$/u.test(String(id))) return null;
      const kickoff = event["0"];
      if (typeof kickoff !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})$/u.test(kickoff)) return null;
      const startAtUtcMs = Date.parse(kickoff);
      if (!Number.isSafeInteger(startAtUtcMs) || startAtUtcMs < 0 ||
        typeof event["2"] !== "string" || typeof event["3"] !== "string") return null;
      const home = event["2"].trim();
      const away = event["3"].trim();
      if (!home || !away || home === away || !nativeRecord(event["7"])) return null;
      const groups = Object.entries(event["7"]);
      if (groups.length > 256 || groups.some(([key, rows]) => !/^\d{1,4}$/u.test(key) || !Array.isArray(rows)) ||
        groups.reduce((count, [, rows]) => count + (rows as unknown[]).length, 0) > limit) return null;
      const eventId = String(id);
      const prior = owners.get(eventId);
      if (prior !== undefined && (prior.leagueId !== leagueId || prior.home !== home ||
        prior.away !== away || prior.startAtUtcMs !== startAtUtcMs)) return null;
      if (prior === undefined) owners.set(eventId, { eventId, leagueId, startAtUtcMs, phase, home, away });
    }
  }
  return [...owners.values()];
}

function nativeRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) &&
    !Object.hasOwn(value, "error") && !Object.hasOwn(value, "errors") &&
    !Object.hasOwn(value, "errorCode") && (value as Record<string, unknown>).success !== false;
}
