import type { ProviderEvent, ProviderId, ProviderMarket, ProviderQuote } from "@tool-chenh/contracts";
import type { LiveCatalogResponse } from "../api/catalog.js";
import { compareProviders, sortProviderItems } from "./provider-order.js";

export interface ComparisonCell {
  readonly provider: ProviderId;
  readonly market: ProviderMarket;
  readonly quotes: readonly ProviderQuote[];
  /** Provider-native identity. Canonical market/quotes above are only for cross-book comparison. */
  readonly sourceEvent?: ProviderEvent;
  readonly sourceMarket?: ProviderMarket;
  readonly sourceQuotes?: readonly ProviderQuote[];
}

export interface ComparisonRow {
  readonly key: string;
  readonly marketType: string;
  readonly scope: string;
  readonly line: string | null;
  readonly cells: readonly ComparisonCell[];
  readonly bestBySelection: Readonly<Record<string, ProviderId>>;
  readonly margin: number | null;
  readonly crossBook: boolean;
}

export interface ObservedTicketRow {
  readonly key: string;
  readonly marketType: string;
  readonly scope: string;
  readonly line: string | null;
  readonly settlementProfile: string;
  readonly outcomeDomain: readonly string[];
  readonly cells: readonly ComparisonCell[];
}

export interface ComparisonEvent {
  readonly key: string;
  readonly event: ProviderEvent;
  readonly providers: readonly ProviderId[];
  readonly catalogs: readonly LiveCatalogResponse[];
  readonly providerEventIds: Readonly<Partial<Record<ProviderId, string>>>;
  readonly observedRows: readonly ObservedTicketRow[];
  readonly rows: readonly ComparisonRow[];
  readonly bestMargin: number | null;
}

type EventOrientation = "SAME" | "SWAPPED";

const footballTeamAliases = new Map<string, string>([
  ["st gilloise", "union saint gilloise"],
  ["union st gilloise", "union saint gilloise"],
  ["sabah", "sabah baku"],
  ["al hussein jor", "al hussein irbid"],
  ["maccabi kiryat gat", "kiryat gat"]
]);

const lolTeamAliases = new Map<string, string>([
  ["giantx academy", "giantx itero"],
  ["los heretics", "heretics academy"],
  ["team heretics academy", "heretics academy"]
]);

function decodeHtmlEntities(value: string): string {
  const namedEntities: Readonly<Record<string, string>> = {
    amp: "&", apos: "'", gt: ">", lt: "<", quot: "\""
  };
  return value.replace(/&(?:#x([0-9a-f]+)|#([0-9]+)|([a-z]+));/giu,
    (entity, hex: string | undefined, decimal: string | undefined, named: string | undefined) => {
      if (named !== undefined) return namedEntities[named.toLocaleLowerCase("en")] ?? entity;
      const codePoint = Number.parseInt(hex ?? decimal ?? "", hex === undefined ? 10 : 16);
      return Number.isInteger(codePoint) && codePoint >= 0 && codePoint <= 0x10ffff
        ? String.fromCodePoint(codePoint) : entity;
    });
}

function displayEvent(event: ProviderEvent): ProviderEvent {
  return { ...event, participantA: decodeHtmlEntities(event.participantA),
    participantB: decodeHtmlEntities(event.participantB) };
}

function identityText(value: string): string {
  const normalized = decodeHtmlEntities(value).normalize("NFKD").replace(/\p{M}+/gu, "").toLocaleLowerCase("en")
    .replace(/đ/gu, "d").replace(/\s*\((?:n|neutral)\)\s*$/u, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ").trim()
    .replace(/^(?:(?:clb|fc|sc|scu|afc|cf|jk|fa)\s+)+/u, "")
    .replace(/\s+(?:fc|sc|scu|afc|cf)$/u, "")
    .replace(/\butd\b/gu, "united").replace(/\bii\b/gu, "2").replace(/\s+/gu, " ");
  return footballTeamAliases.get(normalized) ?? normalized;
}

const footballCompetitionAliases = new Map<string, string>([
  ["vong loai cup c3 chau au play off", "uefa-conference-league-qualification"],
  ["vong loai cup c3 chau au", "uefa-conference-league-qualification"],
  ["uefa europa conference league qualification", "uefa-conference-league-qualification"],
  ["giai hang 4 iceland", "iceland-fourth-division"],
  ["giai hang tu iceland", "iceland-fourth-division"],
  ["iceland fourth division", "iceland-fourth-division"],
  ["mexico liga de expansion", "mexico-liga-expansion"],
  ["mexico liga expansion mx", "mexico-liga-expansion"],
  ["giai hang nhi mexico expansion mx", "mexico-liga-expansion"],
  ["colombia primera b", "colombia-primera-b"],
  ["giai hang nhi colombia", "colombia-primera-b"],
  ["giai laliga tay ban nha", "spain-la-liga"],
  ["giai la liga tay ban nha", "spain-la-liga"],
  ["giai vo dich quoc gia tay ban nha la liga", "spain-la-liga"],
  ["spain la liga", "spain-la-liga"],
  ["spain primera laliga", "spain-la-liga"],
  ["australia cup", "australia-cup"],
  ["australia ffa cup", "australia-cup"],
  ["cup australia", "australia-cup"],
  ["giai vo dich cup uc", "australia-cup"],
  ["new zealand nrfl premier division women", "new-zealand-nrfl-women"],
  ["new zealand nrfl women premiership", "new-zealand-nrfl-women"],
  ["vong loai cup c2 chau au play off", "uefa-europa-league-qualification"],
  ["vong loai cup c2 chau au", "uefa-europa-league-qualification"],
  ["uefa europa league qualification", "uefa-europa-league-qualification"],
  ["giai ligue 3 phap", "france-national-1"],
  ["giai hang ba phap", "france-national-1"],
  ["france ligue 3", "france-national-1"],
  ["france national 1", "france-national-1"],
  ["cup quoc gia ecuador", "ecuador-cup"],
  ["ecuador cup", "ecuador-cup"],
  ["ecuador serie b", "ecuador-primera-b"],
  ["giai hang nhi quoc gia ecuador", "ecuador-primera-b"],
  ["ecuador primera b", "ecuador-primera-b"],
  // Competitions two books both priced on 2026-08-28 and could not link, each
  // holding a single fixture in the window - one is never proof, so the pair
  // waited on a second that a 24-hour horizon rarely offers. Verified by hand
  // against the fixture both books were showing. Names carrying a region, a
  // stage or a side product are deliberately absent: Germany Regional League
  // Northeast against a bare Giai Khu vuc Duc would fold Bavaria and Southwest
  // in with it, and English Premier League - Injury Time Awarded would price
  // added-time goals against match odds.
  ["english premier league", "england-premier-league"],
  ["giai bong da ngoai hang anh", "england-premier-league"],
  ["giai ngoai hang anh", "england-premier-league"],
  ["english league championship", "england-championship"],
  ["england league championship", "england-championship"],
  ["giai vo dich anh", "england-championship"],
  ["giai vo dich bong da anh", "england-championship"],
  ["france ligue 2", "france-ligue-2"],
  ["giai hang nhi phap", "france-ligue-2"],
  ["germany bundesliga i", "germany-bundesliga"],
  ["giai vo dich quoc gia duc", "germany-bundesliga"],
  ["giai bong da vo dich quoc gia duc", "germany-bundesliga"],
  ["germany bundesliga 2", "germany-bundesliga-2"],
  ["giai hang nhi duc", "germany-bundesliga-2"],
  ["germany 3rd liga", "germany-3-liga"],
  ["giai hang ba duc", "germany-3-liga"],
  ["germany regional league bavaria", "germany-regionalliga-bavaria"],
  ["germany regionalliga bavaria", "germany-regionalliga-bavaria"],
  ["germany regional league southwest", "germany-regionalliga-southwest"],
  ["germany regionalliga southwest", "germany-regionalliga-southwest"],
  ["germany women bundesliga", "germany-women-bundesliga"],
  ["germany women bundesliga 1", "germany-women-bundesliga"],
  ["italy serie a", "italy-serie-a"],
  ["giai vo dich quoc gia y serie a", "italy-serie-a"],
  ["giai serie a y", "italy-serie-a"],
  ["italy serie b", "italy-serie-b"],
  ["giai hang nhi y serie b", "italy-serie-b"],
  ["giai serie b y", "italy-serie-b"],
  ["italy serie c", "italy-serie-c"],
  ["giai hang ba y serie c", "italy-serie-c"],
  ["spain segunda division", "spain-segunda"],
  ["giai hang nhi tay ban nha", "spain-segunda"],
  ["giai segunda tay ban nha", "spain-segunda"],
  ["spain la liga 2", "spain-segunda"],
  ["netherlands eredivisie", "netherlands-eredivisie"],
  ["ha lan eredivisie", "netherlands-eredivisie"],
  ["giai vo dich quoc gia ha lan", "netherlands-eredivisie"],
  ["portugal primeira liga", "portugal-primeira-liga"],
  ["giai vo dich quoc gia bo dao nha", "portugal-primeira-liga"],
  ["giai dau bo dao nha primeira liga", "portugal-primeira-liga"],
  ["ukraine premier league", "ukraine-premier-league"],
  ["giai vo dich quoc gia ukraina", "ukraine-premier-league"],
  ["malaysia super league", "malaysia-super-league"],
  ["giai vo dich quoc gia malaysia", "malaysia-super-league"],
  ["giai vo dich bong da malaysia", "malaysia-super-league"],
  ["hong kong premier league", "hong-kong-premier-league"],
  ["giai bong da ngoai hang hong kong", "hong-kong-premier-league"],
  ["argentina liga profesional", "argentina-liga-profesional"],
  ["giai vo dich quoc gia argentina", "argentina-liga-profesional"],
  ["argentina primera b nacional", "argentina-primera-b-nacional"],
  ["giai hang nhi argentina", "argentina-primera-b-nacional"],
  ["bahrain premier league", "bahrain-premier-league"],
  ["giai vo dich quoc gia bahrain", "bahrain-premier-league"],
  ["bulgaria first professional league", "bulgaria-first-league"],
  ["bulgaria first professional football league", "bulgaria-first-league"],
  ["canadian premier league", "canada-premier-league"],
  ["canada premier league", "canada-premier-league"],
  ["giai vo dich quoc gia canada", "canada-premier-league"],
  ["chile primera division", "chile-primera-division"],
  ["giai vo dich quoc gia chile hang nhat", "chile-primera-division"],
  ["denmark super league", "denmark-superliga"],
  ["dan mach super league", "denmark-superliga"],
  ["ecuador serie a", "ecuador-serie-a"],
  ["giai vo dich quoc gia ecuador", "ecuador-serie-a"],
  ["egyptian premier league", "egypt-premier-league"],
  ["giai ngoai hang ai cap", "egypt-premier-league"],
  ["costa rica primera division", "costa-rica-primera-division"],
  ["giai ngoai hang costa rica", "costa-rica-primera-division"],
  ["hungary nb i", "hungary-nb-i"],
  ["giai hungary nb i", "hungary-nb-i"],
  ["iceland 1st division", "iceland-first-division"],
  ["giai hang nhat iceland", "iceland-first-division"],
  ["kosovo super liga", "kosovo-superliga"],
  ["kosovo superliga", "kosovo-superliga"],
  ["north macedonia 1st league", "north-macedonia-first-league"],
  ["republic of north macedonia first football league", "north-macedonia-first-league"],
  ["paraguay primera division", "paraguay-primera-division"],
  ["giai vo dich chuyen nghiep paraguay", "paraguay-primera-division"],
  ["peru liga 1", "peru-liga-1"],
  ["giai vo dich quoc gia peru", "peru-liga-1"],
  ["poland 2nd division", "poland-second-division"],
  ["giai hang nhi ba lan", "poland-second-division"],
  ["slovenia prva liga", "slovenia-prvaliga"],
  ["slovenia prvaliga", "slovenia-prvaliga"],
  ["swiss challenge league", "switzerland-challenge-league"],
  ["switzerland challenge league", "switzerland-challenge-league"],
  ["finland ykkosliiga", "finland-ykkosliiga"],
  ["giai hang nhat phan lan", "finland-ykkosliiga"],
  ["cup quoc gia israel", "israel-state-cup"],
  ["cup israel", "israel-state-cup"]
]);

function competitionIdentity(value: string): string {
  // The Vietnamese d-with-stroke survives NFKD, which decomposes accents but
  // leaves alone a letter that was never a composition. Every alias for a
  // Vietnamese competition therefore had to be spelled with a character no
  // keyboard here produces, and the two written without it - giai vo dich quoc
  // gia tay ban nha la liga and giai vo dich cup uc - could never match a
  // thing. participantIdentity has folded it since it was written; this is that
  // same fold, so an alias can be typed the way it reads.
  const normalized = decodeHtmlEntities(value).normalize("NFKD").replace(/\p{M}+/gu, "").toLocaleLowerCase("en")
    .replace(/đ/gu, "d")
    .replace(/[^\p{L}\p{N}]+/gu, " ").trim().replace(/\s+/gu, " ");
  return footballCompetitionAliases.get(normalized) ?? normalized;
}

/**
 * Books name the same competition by their own convention and language
 * ("english league cup" / "england league cup", "japan emperor cup" /
 * "cup thien hoang nhat ban"), so equal text is not evidence that is actually
 * available. Two competitions in different books that agree on more than one
 * exact fixture are the same competition; one shared fixture stays unlinked.
 */
const SHARED_FIXTURES_REQUIRED_TO_LINK_COMPETITIONS = 2;

/** How far two books may disagree on a kickoff and still mean one fixture. */
const FOOTBALL_KICKOFF_TOLERANCE_MS = 120_000;

function linkedCompetitionIdentity(value: string, links?: ReadonlyMap<string, string>): string {
  const identity = competitionIdentity(value);
  return links?.get(identity) ?? identity;
}

/**
 * Fixtures a competition holds, kept whole rather than folded into one key.
 *
 * The evidence that two books mean the same competition used to be fixtures
 * whose participants matched to the character, while pairing those same
 * fixtures accepts the far looser rule footballParticipantSimilarity applies -
 * one book writing Lille where another writes Lille OSC, or Nancy for AS Nancy
 * Lorraine, pairs happily but counted for nothing here. That made learning
 * stricter than the thing it exists to enable, and the two deadlocked: a
 * pre-match fixture is only paired once its competition is linked, and the
 * competition only linked once two fixtures had matched under a rule most of
 * them fail.
 *
 * Measured 2026-08-28 against the live stack: 270 fixture pairs that two books
 * both held, agreed on to the kickoff and named with the same teams were
 * dropped, every one because its competition never linked. France Ligue 2
 * against Giai hang Nhi Phap is the shape of it - three fixtures in common,
 * one of them spelled identically, so the whole league was lost.
 */
interface LearnedFixture {
  readonly participantA: string;
  readonly participantB: string;
  readonly startAtUtcMs: number;
  readonly isLive: boolean;
}

/**
 * Whether one fixture is the other, judged the way pairing judges it.
 *
 * Kickoff is checked here and was not checked at all before, so two
 * competitions that merely shared team names - a league and a cup a week apart
 * - counted as evidence of being the same competition. Pre-match fixtures now
 * have to agree on kickoff as closely as a pair of them would to be compared
 * at all. A running fixture reports observation time rather than kickoff, so
 * there the participants stand alone, exactly as compatibleEventOrientation
 * has it.
 */
function learnedFixturesMatch(left: LearnedFixture, right: LearnedFixture): boolean {
  if (left.isLive !== right.isLive) return false;
  if (!left.isLive &&
    Math.abs(left.startAtUtcMs - right.startAtUtcMs) > FOOTBALL_KICKOFF_TOLERANCE_MS) return false;
  return footballOrientationScore(left.participantA, left.participantB,
    right.participantA, right.participantB) !== null ||
    footballOrientationScore(left.participantA, left.participantB,
      right.participantB, right.participantA) !== null;
}

/**
 * The buckets a fixture could be matched in.
 *
 * Comparing every fixture against every other across six books is work the
 * shape of the rule makes unnecessary: a match only scores when the shorter
 * side's meaningful tokens are all present in the longer, so any two fixtures
 * that match share at least one token from each participant. Indexing on those
 * token pairs - sorted, because a match may be the two sides swapped - keeps
 * the comparison to fixtures that could actually be the same one.
 */
function fixtureBlockKeys(fixture: LearnedFixture): readonly string[] {
  const left = footballParticipantFingerprint(fixture.participantA).meaningful;
  const right = footballParticipantFingerprint(fixture.participantB).meaningful;
  const keys: string[] = [];
  for (const leftToken of left) {
    for (const rightToken of right) {
      keys.push(leftToken < rightToken ? `${leftToken}~${rightToken}` : `${rightToken}~${leftToken}`);
    }
  }
  return keys;
}

/**
 * Which book a competition keeps: the fixture's own result, its corners, or its
 * cards. A book publishes all three under names that can differ only by a
 * suffix it may not carry at all, and every one of them lists the same teams at
 * the same kickoff - so fixtures in common cannot tell them apart, and linking
 * on those alone would let one book's corner line be priced against another
 * book's match odds.
 */
function competitionMarketFamily(marketTypes: Iterable<string>): "GOALS" | "CORNERS" | "CARDS" {
  let corners = 0;
  let cards = 0;
  let goals = 0;
  for (const marketType of marketTypes) {
    if (marketType.startsWith("CORNER_")) corners += 1;
    else if (marketType.startsWith("CARD_")) cards += 1;
    else goals += 1;
  }
  if (corners > goals && corners >= cards) return "CORNERS";
  if (cards > goals && cards > corners) return "CARDS";
  return "GOALS";
}

/**
 * Fixtures two books have been seen to share, kept between snapshots.
 *
 * Two competitions are the same when more than one fixture agrees, and that
 * rule is why a book naming its Emperor Cup differently from its rival's Some
 * Other Cup does not fold into it on the one fixture they share. What the rule
 * did not need was for both fixtures to be on the board at once: measured
 * 2026-08-29, 104 of the 124 competition pairs with any fixture in common had
 * exactly one, because a 24-hour window usually holds one match per league, and
 * every one of those leagues stayed unlinked with the fixture both books were
 * pricing sitting between them.
 *
 * Counting distinct fixtures rather than sightings is what keeps the rule
 * intact: a league seen a thousand times with the same single fixture is still
 * one fixture and still does not link. Two entries per pair is all that is ever
 * needed, so that is all that is kept.
 */
export interface CompetitionLinkMemory {
  /** Records a fixture for a pair and returns how many distinct ones it holds. */
  record(pairKey: string, fixtureKey: string, atMs: number): number;
  /**
   * Restores pairs a previous session proved. A league's second fixture is
   * usually a match day away, so evidence that only lives as long as a page is
   * evidence that never arrives: measured over four and a half hours of
   * snapshots it linked four rows, because the fixtures on the board barely
   * turn over in an afternoon.
   */
  seed(pairKeys: Iterable<string>): void;
  /** Pairs that have reached the threshold, for a later session to seed with. */
  confirmed(): readonly string[];
}

const MAX_REMEMBERED_COMPETITION_PAIRS = 4_000;

export function createCompetitionLinkMemory(
  maxPairs = MAX_REMEMBERED_COMPETITION_PAIRS
): CompetitionLinkMemory {
  const pairs = new Map<string, { readonly fixtures: Set<string>; lastSeenAtMs: number }>();
  // A seeded pair is one an earlier session already proved, so it carries the
  // threshold rather than a fixture it can no longer name.
  const seeded = new Set<string>();
  return {
    seed(pairKeys) { for (const pairKey of pairKeys) seeded.add(pairKey); },
    confirmed() {
      const reached = [...pairs].filter(([, entry]) =>
        entry.fixtures.size >= SHARED_FIXTURES_REQUIRED_TO_LINK_COMPETITIONS).map(([pairKey]) => pairKey);
      return [...new Set([...seeded, ...reached])];
    },
    record(pairKey, fixtureKey, atMs) {
      if (seeded.has(pairKey)) return SHARED_FIXTURES_REQUIRED_TO_LINK_COMPETITIONS;
      const entry = pairs.get(pairKey) ?? { fixtures: new Set<string>(), lastSeenAtMs: atMs };
      entry.lastSeenAtMs = atMs;
      // Two is the threshold, so a third fixture would only cost memory.
      if (entry.fixtures.size < SHARED_FIXTURES_REQUIRED_TO_LINK_COMPETITIONS) {
        entry.fixtures.add(fixtureKey);
      }
      pairs.delete(pairKey);
      pairs.set(pairKey, entry);
      if (pairs.size > maxPairs) {
        // Insertion order is recency here, so the front of the map is the pair
        // longest unseen.
        for (const oldest of pairs.keys()) { pairs.delete(oldest); break; }
      }
      return entry.fixtures.size;
    }
  };
}

/**
 * What identifies a fixture across snapshots: who is playing and when. A
 * running fixture reports the moment it was observed rather than its kickoff,
 * so it drifts and cannot name itself twice - and it does not need to, because
 * a live fixture pairs on its own evidence without its competition being linked.
 */
function rememberedFixtureKey(fixture: LearnedFixture): string | null {
  if (fixture.isLive || !Number.isFinite(fixture.startAtUtcMs)) return null;
  return [participantIdentity("FOOTBALL", fixture.participantA),
    participantIdentity("FOOTBALL", fixture.participantB)].sort()
    .concat(String(Math.round(fixture.startAtUtcMs / FOOTBALL_KICKOFF_TOLERANCE_MS))).join("|");
}

function learnCompetitionLinks(catalogs: readonly LiveCatalogResponse[],
  memory?: CompetitionLinkMemory): ReadonlyMap<string, string> {
  const fixturesByBookCompetition = new Map<string, { readonly identity: string;
    readonly provider: ProviderId; readonly fixtures: LearnedFixture[];
    readonly marketTypes: string[] }>();
  for (const catalog of catalogs) {
    const marketsByEvent = new Map<string, string[]>();
    for (const market of catalog.markets) {
      (marketsByEvent.get(market.providerEventId) ??
        marketsByEvent.set(market.providerEventId, []).get(market.providerEventId)!)
        .push(market.marketType);
    }
    for (const event of catalog.events) {
      if (event.category !== "FOOTBALL") continue;
      const identity = competitionIdentity(event.competition);
      if (identity.length === 0) continue;
      const key = `${catalog.provider} ${identity}`;
      const entry = fixturesByBookCompetition.get(key) ??
        { identity, provider: catalog.provider, fixtures: [], marketTypes: [] };
      entry.fixtures.push({ participantA: event.participantA, participantB: event.participantB,
        startAtUtcMs: event.startAtUtcMs, isLive: event.isLive });
      entry.marketTypes.push(...(marketsByEvent.get(event.providerEventId) ?? []));
      fixturesByBookCompetition.set(key, entry);
    }
  }
  // How many of its own fixtures each pair of book-competitions holds in
  // common. Counting the left side's fixtures rather than the matches keeps one
  // fixture that matches two entries on the far side from reading as two.
  const observedAtMs = catalogs.reduce((latest, catalog) =>
    Math.max(latest, catalog.observedAtMs), 0);
  const sharedFixtures = new Map<string, Set<number>>();
  const rememberedCounts = new Map<string, number>();
  const pairKey = (left: string, right: string): string =>
    left < right ? `${left} ${right}` : `${right} ${left}`;
  const blocks = new Map<string, { key: string; index: number; fixture: LearnedFixture }[]>();
  for (const [key, entry] of fixturesByBookCompetition) {
    for (const [index, fixture] of entry.fixtures.entries()) {
      for (const block of fixtureBlockKeys(fixture)) {
        const bucket = blocks.get(block) ?? blocks.set(block, []).get(block)!;
        for (const other of bucket) {
          if (fixturesByBookCompetition.get(other.key)?.provider === entry.provider) continue;
          if (!learnedFixturesMatch(fixture, other.fixture)) continue;
          const pair = pairKey(key, other.key);
          (sharedFixtures.get(pair) ?? sharedFixtures.set(pair, new Set()).get(pair)!)
            .add(key < other.key ? index : other.index);
          const remembered = rememberedFixtureKey(fixture);
          if (memory !== undefined && remembered !== null) {
            rememberedCounts.set(pair, Math.max(rememberedCounts.get(pair) ?? 0,
              memory.record(pair, remembered, observedAtMs)));
          }
        }
        bucket.push({ key, index, fixture });
      }
    }
  }
  const familyByKey = new Map<string, "GOALS" | "CORNERS" | "CARDS">();
  for (const [key, entry] of fixturesByBookCompetition) {
    familyByKey.set(key, competitionMarketFamily(entry.marketTypes));
  }
  const parent = new Map<string, string>();
  const find = (value: string): string => {
    let root = value;
    while ((parent.get(root) ?? root) !== root) root = parent.get(root)!;
    return root;
  };
  const union = (left: string, right: string): void => {
    const [leftRoot, rightRoot] = [find(left), find(right)];
    if (leftRoot === rightRoot) return;
    // Keep the lexicographically smallest identity so every book resolves to
    // the same canonical value regardless of catalog ordering.
    const [keep, drop] = leftRoot < rightRoot ? [leftRoot, rightRoot] : [rightRoot, leftRoot];
    parent.set(drop, keep);
  };
  const entries = [...fixturesByBookCompetition.entries()];
  for (let left = 0; left < entries.length; left += 1) {
    for (let right = left + 1; right < entries.length; right += 1) {
      const [leftKey, leftEntry] = entries[left]!;
      const [rightKey, rightEntry] = entries[right]!;
      if (leftKey.split(" ")[0] === rightKey.split(" ")[0]) continue;
      if (leftEntry.identity === rightEntry.identity) continue;
      if (familyByKey.get(leftKey) !== familyByKey.get(rightKey)) continue;
      // A pair the memory has watched agree on two fixtures is carrying the
      // same evidence as two sitting on one board, gathered over more than one
      // glance because that is how a 24-hour window shows a league its season.
      const pair = pairKey(leftKey, rightKey);
      const shared = Math.max(sharedFixtures.get(pair)?.size ?? 0, rememberedCounts.get(pair) ?? 0);
      if (shared >= SHARED_FIXTURES_REQUIRED_TO_LINK_COMPETITIONS) {
        union(leftEntry.identity, rightEntry.identity);
      }
    }
  }
  const links = new Map<string, string>();
  for (const { identity } of fixturesByBookCompetition.values()) links.set(identity, find(identity));
  return links;
}

function participantIdentity(category: ProviderEvent["category"], value: string): string {
  const normalized = identityText(value);
  // Esports feeds commonly disagree only on brand spacing (for example
  // ThunderTalk vs Thunder Talk). Both participants, scope, variant, BO and
  // kickoff evidence still have to agree before an event can be paired.
  return category === "LOL" ? (lolTeamAliases.get(normalized) ?? normalized).replace(/\s+/gu, "") : normalized;
}

const footballClubDesignators = new Set([
  "ac", "afc", "bk", "ca", "cd", "cf", "clb", "club", "fc", "fa", "fk", "if", "il", "jk", "nk",
  "pfc", "rb", "sc", "scu", "sk"
]);
const footballParticipantQualifiers = new Set([
  "academy", "b", "ladies", "nu", "res", "reserve", "reserves", "u17", "u18", "u19", "u20", "u21", "u23",
  "w", "women", "2"
]);
const unsafeSingleFootballTokens = new Set([
  "athletic", "city", "dynamo", "real", "racing", "sporting", "united"
]);

interface FootballParticipantFingerprint {
  readonly identity: string;
  readonly meaningful: readonly string[];
  readonly qualifiers: readonly string[];
}

function footballParticipantFingerprint(value: string): FootballParticipantFingerprint {
  const identity = participantIdentity("FOOTBALL", value);
  const tokens = identity.split(" ").filter(Boolean);
  const canonicalQualifier = (token: string): string => ["ladies", "nu", "w", "women"].includes(token)
    ? "women" : ["res", "reserve", "reserves"].includes(token) ? "reserve" : token;
  return { identity,
    qualifiers: tokens.filter((token) => footballParticipantQualifiers.has(token)).map(canonicalQualifier).sort(),
    meaningful: tokens.filter((token) => !footballClubDesignators.has(token) &&
      !footballParticipantQualifiers.has(token)) };
}

function footballParticipantSimilarity(left: string, right: string): number {
  const leftFingerprint = footballParticipantFingerprint(left);
  const rightFingerprint = footballParticipantFingerprint(right);
  if (leftFingerprint.identity === rightFingerprint.identity) return 1;
  if (leftFingerprint.qualifiers.join("|") !== rightFingerprint.qualifiers.join("|")) return 0;
  const [shorter, longer] = leftFingerprint.meaningful.length <= rightFingerprint.meaningful.length
    ? [leftFingerprint.meaningful, rightFingerprint.meaningful]
    : [rightFingerprint.meaningful, leftFingerprint.meaningful];
  if (shorter.length === 0 || !shorter.every((token) => longer.includes(token))) return 0;
  if (shorter.length >= 2) return 0.95;
  return (shorter[0]?.length ?? 0) >= 5 && !unsafeSingleFootballTokens.has(shorter[0]!) ? 0.8 : 0;
}

interface ParticipantOrientationMatch {
  readonly orientation: EventOrientation;
  readonly exact: boolean;
  readonly score: number;
}

function footballOrientationScore(leftA: string, leftB: string, rightA: string, rightB: string): number | null {
  const scores = [footballParticipantSimilarity(leftA, rightA), footballParticipantSimilarity(leftB, rightB)];
  return Math.min(...scores) >= 0.8
    ? (scores[0]! + scores[1]!) / 2 : null;
}

function comparableFootballProduct(event: ProviderEvent): boolean {
  if (event.category !== "FOOTBALL") return true;
  const text = competitionIdentity(`${event.competition} ${event.participantA} ${event.participantB}`);
  return !/\b(?:fantasy match|which team advances|team to advance|special market)\b/u.test(text);
}

function unorderedParticipantKey(event: ProviderEvent): string {
  return [participantIdentity(event.category, event.participantA),
    participantIdentity(event.category, event.participantB)].sort().join("|");
}

const footballKickoffCandidateBucketMs = 120_000;

function footballCandidatePrefix(event: ProviderEvent, links: ReadonlyMap<string, string>): string | null {
  if (event.category !== "FOOTBALL") return null;
  const competition = linkedCompetitionIdentity(event.competition, links);
  if (competition.length === 0) return null;
  return [event.category, event.isLive ? "LIVE" : "PREMATCH", event.eventScope,
    event.isVirtual === true ? "VIRTUAL" : event.isVirtual === false ? "REAL" : "UNKNOWN",
    event.sportVariant ?? "UNKNOWN", competition].join("|");
}

function footballCandidateIndexKey(event: ProviderEvent, links: ReadonlyMap<string, string>): string | null {
  const prefix = footballCandidatePrefix(event, links);
  if (prefix === null) return null;
  return event.isLive ? `${prefix}|LIVE`
    : `${prefix}|${Math.floor(event.startAtUtcMs / footballKickoffCandidateBucketMs)}`;
}

function footballCandidateLookupKeys(event: ProviderEvent, links: ReadonlyMap<string, string>): readonly string[] {
  const prefix = footballCandidatePrefix(event, links);
  if (prefix === null) return [];
  if (event.isLive) return [`${prefix}|LIVE`];
  const bucket = Math.floor(event.startAtUtcMs / footballKickoffCandidateBucketMs);
  return [bucket - 1, bucket, bucket + 1].map((value) => `${prefix}|${value}`);
}

function eventKey(event: ProviderEvent): string {
  const liveEvidence = event.category === "FOOTBALL" && event.liveState !== null
    ? `${event.liveState.period}|${event.liveState.scoreHome}|${event.liveState.scoreAway}` : "LIVE";
  const variantEvidence = event.category === "FOOTBALL"
    ? [event.isVirtual === true ? "VIRTUAL" : event.isVirtual === false ? "REAL" : "UNKNOWN", event.sportVariant ?? "UNKNOWN"]
    : [event.gameVariant ?? "UNKNOWN"];
  return [event.category, event.eventScope, ...variantEvidence,
    participantIdentity(event.category, event.participantA), participantIdentity(event.category, event.participantB),
    event.isLive && event.category === "FOOTBALL" ? competitionIdentity(event.competition) : "",
    event.isLive && event.category === "FOOTBALL"
      ? event.fixtureDiscriminator ?? event.providerEventId
      : event.isLive ? liveEvidence : String(event.startAtUtcMs)]
    .join("|");
}

function eventSemanticKey(event: ProviderEvent): string {
  const liveEvidence = event.category === "FOOTBALL" && event.liveState !== null
    ? `${event.liveState.period}|${event.liveState.scoreHome}|${event.liveState.scoreAway}` : "LIVE";
  const variantEvidence = event.category === "FOOTBALL"
    ? [event.isVirtual === true ? "VIRTUAL" : event.isVirtual === false ? "REAL" : "UNKNOWN", event.sportVariant ?? "UNKNOWN"]
    : [event.gameVariant ?? "UNKNOWN"];
  return [event.category, event.eventScope, ...variantEvidence,
    participantIdentity(event.category, event.participantA), participantIdentity(event.category, event.participantB),
    event.rematchCandidate ? event.fixtureDiscriminator ?? "AMBIGUOUS_REMATCH" : "ORDINARY",
    event.isLive ? liveEvidence : "PREMATCH"].join("|");
}

function swapLolEvent(event: ProviderEvent): ProviderEvent {
  if (event.category !== "LOL") return event;
  return { ...event, participantA: event.participantB, participantB: event.participantA,
    liveState: event.liveState === null ? null : { ...event.liveState,
      seriesScoreA: event.liveState.seriesScoreB, seriesScoreB: event.liveState.seriesScoreA } };
}

function sameEventVariant(left: ProviderEvent, right: ProviderEvent): boolean {
  if (left.category !== right.category || left.eventScope !== right.eventScope) return false;
  if (left.category === "FOOTBALL" && right.category === "FOOTBALL") {
    return left.isVirtual === right.isVirtual && left.sportVariant === right.sportVariant;
  }
  return left.category === "LOL" && right.category === "LOL" && left.gameVariant === right.gameVariant;
}

function footballLiveEvidenceCompatible(left: ProviderEvent, right: ProviderEvent,
  orientation: EventOrientation): boolean {
  if (left.category !== "FOOTBALL" || right.category !== "FOOTBALL") return true;
  const leftState = left.liveState; const rightState = right.liveState;
  if (leftState === null || rightState === null) return true;
  if (leftState.period !== null && rightState.period !== null && leftState.period !== rightState.period) return false;
  const leftScoreKnown = leftState.scoreHome !== null && leftState.scoreAway !== null;
  const rightScoreKnown = rightState.scoreHome !== null && rightState.scoreAway !== null;
  if (!leftScoreKnown || !rightScoreKnown) return true;
  return orientation === "SAME"
    ? leftState.scoreHome === rightState.scoreHome && leftState.scoreAway === rightState.scoreAway
    : leftState.scoreHome === rightState.scoreAway && leftState.scoreAway === rightState.scoreHome;
}

function completeFootballLiveEvidenceMatches(left: ProviderEvent, right: ProviderEvent,
  orientation: EventOrientation): boolean {
  if (left.category !== "FOOTBALL" || right.category !== "FOOTBALL") return false;
  const leftState = left.liveState; const rightState = right.liveState;
  if (leftState === null || rightState === null || leftState.period === null || rightState.period === null ||
    leftState.scoreHome === null || leftState.scoreAway === null ||
    rightState.scoreHome === null || rightState.scoreAway === null) return false;
  return footballLiveEvidenceCompatible(left, right, orientation);
}

function hasIndependentFootballLiveIdentity(left: ProviderEvent, right: ProviderEvent,
  orientation: EventOrientation, links?: ReadonlyMap<string, string>): boolean {
  const sameFixture = left.fixtureDiscriminator !== null && left.fixtureDiscriminator.length > 0 &&
    right.fixtureDiscriminator !== null && right.fixtureDiscriminator.length > 0 &&
    left.fixtureDiscriminator === right.fixtureDiscriminator;
  if (sameFixture) return true;
  const sameCompetitionAndKickoff = linkedCompetitionIdentity(left.competition, links).length > 0 &&
    linkedCompetitionIdentity(left.competition, links) === linkedCompetitionIdentity(right.competition, links) &&
    Math.abs(left.startAtUtcMs - right.startAtUtcMs) <= 120_000;
  return sameCompetitionAndKickoff || completeFootballLiveEvidenceMatches(left, right, orientation);
}

function participantOrientation(left: ProviderEvent, right: ProviderEvent): ParticipantOrientationMatch | null {
  const same = participantIdentity(left.category, left.participantA) ===
    participantIdentity(right.category, right.participantA) &&
    participantIdentity(left.category, left.participantB) === participantIdentity(right.category, right.participantB);
  if (same) return { orientation: "SAME", exact: true, score: 1 };
  const swapped = participantIdentity(left.category, left.participantA) ===
    participantIdentity(right.category, right.participantB) &&
    participantIdentity(left.category, left.participantB) === participantIdentity(right.category, right.participantA);
  if (swapped && (left.category === "FOOTBALL" || left.category === "LOL")) {
    return { orientation: "SWAPPED", exact: true, score: 1 };
  }
  if (left.category !== "FOOTBALL" || right.category !== "FOOTBALL") return null;
  const sameScore = footballOrientationScore(left.participantA, left.participantB,
    right.participantA, right.participantB);
  const swappedScore = footballOrientationScore(left.participantA, left.participantB,
    right.participantB, right.participantA);
  if (sameScore === null && swappedScore === null) return null;
  if (sameScore !== null && swappedScore !== null && sameScore === swappedScore) return null;
  return sameScore !== null && (swappedScore === null || sameScore > swappedScore)
    ? { orientation: "SAME", exact: false, score: sameScore }
    : { orientation: "SWAPPED", exact: false, score: swappedScore! };
}

function compatibleEventOrientation(left: ProviderEvent, right: ProviderEvent,
  links?: ReadonlyMap<string, string>): EventOrientation | null {
  if (left.category !== right.category || left.isLive !== right.isLive) return null;
  if (!sameEventVariant(left, right)) return null;
  if (left.category === "LOL" && right.category === "LOL" && left.bestOf !== null && right.bestOf !== null &&
    left.bestOf !== right.bestOf) return null;
  if (left.fixtureDiscriminator !== null && right.fixtureDiscriminator !== null &&
    left.fixtureDiscriminator !== right.fixtureDiscriminator) return null;
  if (!comparableFootballProduct(left) || !comparableFootballProduct(right)) return null;
  const participantMatch = participantOrientation(left, right);
  if (participantMatch === null || !footballLiveEvidenceCompatible(left, right, participantMatch.orientation)) return null;
  if (!left.isLive && left.category === "FOOTBALL") {
    const sameFixture = left.fixtureDiscriminator !== null && left.fixtureDiscriminator.length > 0 &&
      left.fixtureDiscriminator === right.fixtureDiscriminator;
    const leftCompetition = linkedCompetitionIdentity(left.competition, links);
    const rightCompetition = linkedCompetitionIdentity(right.competition, links);
    if (!sameFixture && (leftCompetition.length === 0 || leftCompetition !== rightCompetition)) return null;
  }
  if (left.isLive && left.category === "FOOTBALL" &&
    !hasIndependentFootballLiveIdentity(left, right, participantMatch.orientation, links)) return null;
  const kickoffToleranceMs = left.category === "LOL" ? 30 * 60_000 : FOOTBALL_KICKOFF_TOLERANCE_MS;
  if (!left.isLive && Math.abs(left.startAtUtcMs - right.startAtUtcMs) > kickoffToleranceMs) return null;
  if (left.category === "LOL" && eventSemanticKey(left) !==
    eventSemanticKey(participantMatch.orientation === "SWAPPED" ? swapLolEvent(right) : right)) return null;
  return participantMatch.orientation;
}

function invertLine(line: string | null): string | null {
  if (line === null) return null;
  const value = Number(line);
  if (!Number.isFinite(value)) return line;
  return String(Object.is(-value, -0) ? 0 : -value);
}

function canonicalLine(line: string | null): string | null {
  if (line === null) return null;
  const value = Number(line);
  if (!Number.isFinite(value)) return line;
  return String(Object.is(value, -0) ? 0 : value);
}

const footballHandicapMarketTypes = new Set([
  "FT_AH", "FH_AH", "SH_AH", "CORNER_FT_AH", "CORNER_FH_AH", "CARD_FT_AH", "CARD_FH_AH"
]);
const footballTotalMarketTypes = new Set([
  "FT_TOTAL", "FH_TOTAL", "SH_TOTAL", "CORNER_FT_TOTAL", "CORNER_FH_TOTAL", "CARD_FT_TOTAL", "CARD_FH_TOTAL"
]);

function isFootballHandicapMarketType(marketType: string): boolean {
  return footballHandicapMarketTypes.has(marketType);
}

function isFootballTotalMarketType(marketType: string): boolean {
  return footballTotalMarketTypes.has(marketType);
}

export function selectionHandicapLine(
  row: Pick<ComparisonRow, "marketType" | "line">,
  selection: string
): string | null {
  if (!isFootballHandicapMarketType(row.marketType) || row.line === null) return null;
  if (selection !== "HOME" && selection !== "AWAY") return null;
  const line = selection === "HOME" ? row.line : invertLine(row.line);
  if (line === null || !Number.isFinite(Number(line))) return null;
  return Number(line) > 0 ? `+${line}` : line;
}

function orientMarket(market: ProviderMarket, orientation: EventOrientation): ProviderMarket {
  const shouldInvert = orientation === "SWAPPED" && market.category === "FOOTBALL" &&
    isFootballHandicapMarketType(market.marketType);
  return { ...market, line: canonicalLine(shouldInvert ? invertLine(market.line) : market.line) };
}

function orientQuotes(quotes: readonly ProviderQuote[], orientation: EventOrientation): readonly ProviderQuote[] {
  if (orientation !== "SWAPPED") return quotes.map((quote) => ({ ...quote, line: canonicalLine(quote.line) }));
  return quotes.map((quote) => {
    if (quote.category === "LOL") {
      if (quote.selection === "TEAM_A") return { ...quote, selection: "TEAM_B" };
      if (quote.selection === "TEAM_B") return { ...quote, selection: "TEAM_A" };
      return quote;
    }
    if (quote.category === "FOOTBALL") {
      const selection = quote.selection === "HOME" ? "AWAY" : quote.selection === "AWAY" ? "HOME" : quote.selection;
      const line = canonicalLine(isFootballHandicapMarketType(quote.marketType) ? invertLine(quote.line) : quote.line);
      return { ...quote, selection, line };
    }
    return quote;
  }).sort((left, right) => left.selection.localeCompare(right.selection));
}

function marketKey(market: ProviderMarket): string {
  return [market.marketType, market.scope, canonicalLine(market.line) ?? ""].join("|");
}

function eligibleTwoWayCells(cells: readonly ComparisonCell[], requireSameSettlement = true): readonly ComparisonCell[] {
  const marketType = cells[0]?.market.marketType;
  if (marketType === undefined || marketType === "FT_1X2" || marketType === "FH_1X2") return [];
  const domains = new Map<string, ComparisonCell[]>();
  const byProvider = new Map<ProviderId, ComparisonCell[]>();
  for (const cell of cells) byProvider.set(cell.provider, [...(byProvider.get(cell.provider) ?? []), cell]);
  for (const candidates of byProvider.values()) {
    if (candidates.length !== 1) continue;
    const cell = candidates[0]!;
    const selections = [...new Set(cell.quotes.map((quote) => quote.selection))].sort();
    if (selections.length !== 2) continue;
    const signature = [selections.join("|"), requireSameSettlement ? cell.market.settlementProfile : "DISPLAY_ONLY"].join("|");
    const matching = domains.get(signature) ?? [];
    matching.push(cell);
    domains.set(signature, matching);
  }
  return [...domains.values()].filter((matching) => new Set(matching.map((cell) => cell.provider)).size >= 2)
    .sort((left, right) => right.length - left.length)[0] ?? [];
}

function displayTwoWayCells(cells: readonly ComparisonCell[]): readonly ComparisonCell[] {
  const accepted: ComparisonCell[] = [];
  let outcomeDomain: string | null = null;
  const byProvider = new Map<ProviderId, ComparisonCell[]>();
  for (const cell of cells.filter(isFocusedTwoWayTicket)) {
    byProvider.set(cell.provider, [...(byProvider.get(cell.provider) ?? []), cell]);
  }
  for (const candidates of byProvider.values()) {
    if (candidates.length !== 1) continue;
    const cell = candidates[0]!;
    const selections = [...new Set(cell.quotes.map((quote) => quote.selection))].sort().join("|");
    if (outcomeDomain !== null && selections !== outcomeDomain) continue;
    outcomeDomain ??= selections;
    accepted.push(cell);
  }
  return accepted;
}

function isSupportedAsianLine(line: string | null): boolean {
  if (line === null) return false;
  const value = Math.abs(Number(line));
  if (!Number.isFinite(value)) return false;
  const fraction = value % 1;
  return [0.25, 0.5, 0.75].some((supported) => Math.abs(fraction - supported) < 1e-9);
}

export function exactTwoWayOutcomeDomain(marketType: string, scope: string,
  line: string | null): readonly string[] | null {
  const expectedScope = marketType === "SH_AH" || marketType === "SH_TOTAL" ? "SECOND_HALF"
    : marketType.includes("_FH_") || marketType === "FH_AH" || marketType === "FH_TOTAL" ? "FIRST_HALF"
    : isFootballHandicapMarketType(marketType) || isFootballTotalMarketType(marketType) ? "FULL_TIME" : null;
  if (expectedScope !== null && scope === expectedScope && isSupportedAsianLine(line)) {
    return isFootballTotalMarketType(marketType) ? ["OVER", "UNDER"] : ["AWAY", "HOME"];
  }
  if (marketType === "SERIES_WINNER" && scope === "SERIES" && line === null) return ["TEAM_A", "TEAM_B"];
  if (marketType === "MAP_WINNER" && /^MAP_[1-5]$/u.test(scope) && line === null) return ["TEAM_A", "TEAM_B"];
  return null;
}

function sameMarketLine(left: string | null, right: string | null): boolean {
  if (left === null || right === null) return left === right;
  const leftValue = Number(left);
  const rightValue = Number(right);
  return Number.isFinite(leftValue) && Number.isFinite(rightValue) && leftValue === rightValue;
}

export function isFocusedTwoWayTicket(cell: ComparisonCell): boolean {
  const expectedDomain = exactTwoWayOutcomeDomain(cell.market.marketType, cell.market.scope, cell.market.line);
  if (expectedDomain === null || cell.market.status !== "OPEN" || cell.quotes.length !== expectedDomain.length) return false;
  const expectedCategory = cell.market.marketType === "SERIES_WINNER" || cell.market.marketType === "MAP_WINNER"
    ? "LOL" : "FOOTBALL";
  if (cell.market.provider !== cell.provider || cell.market.category !== expectedCategory) return false;
  const selections = cell.quotes.map((quote) => quote.selection);
  if (new Set(selections).size !== selections.length || [...selections].sort().join("|") !== expectedDomain.join("|")) return false;
  const selectionIds = cell.quotes.map((quote) => quote.providerSelectionId);
  if (new Set(selectionIds).size !== selectionIds.length) return false;
  const generation = cell.quotes[0]?.sequence ?? null;
  if (generation === null || !cell.quotes.every((quote) => quote.sequence === generation)) return false;
  return cell.quotes.every((quote) => quote.status === "OPEN" && quote.provider === cell.provider &&
    quote.category === cell.market.category && quote.providerEventId === cell.market.providerEventId &&
    quote.providerMarketId === cell.market.providerMarketId && quote.marketType === cell.market.marketType &&
    quote.scope === cell.market.scope && sameMarketLine(quote.line, cell.market.line));
}

export function isVisibleEvent(event: ProviderEvent, nowMs: number): boolean {
  return event.isLive || event.startAtUtcMs >= nowMs;
}

export type EventPhase = "LIVE" | "PREMATCH";

export function matchesEventPhase(event: ProviderEvent, phases: ReadonlySet<EventPhase>): boolean {
  return phases.has(event.isLive ? "LIVE" : "PREMATCH");
}

export function decimalOdds(quote: ProviderQuote): number | null {
  const value = Number(quote.rawOdds);
  if (!Number.isFinite(value)) return null;
  if (quote.rawFormat === "DECIMAL") return value > 1 ? value : null;
  if (quote.rawFormat === "HK") return value > 0 ? value + 1 : null;
  if (quote.rawFormat === "MALAY") {
    if (value === 0 || Math.abs(value) > 1) return null;
    return value > 0 ? 1 + value : 1 + 1 / Math.abs(value);
  }
  return null;
}

export function selectionLabel(event: ProviderEvent, selection: string): string {
  if (selection === "TEAM_A" || selection === "HOME") return event.participantA;
  if (selection === "TEAM_B" || selection === "AWAY") return event.participantB;
  if (selection === "OVER") return "Tài";
  if (selection === "UNDER") return "Xỉu";
  return selection;
}

export function ticketMarketLabel(marketType: string): string {
  if (marketType === "FT_AH") return "Chấp toàn trận";
  if (marketType === "FT_TOTAL") return "Tài/Xỉu toàn trận";
  if (marketType === "SERIES_WINNER") return "Thắng series";
  if (marketType === "MAP_WINNER") return "Map winner";
  if (marketType === "FH_AH") return "First-half handicap";
  if (marketType === "FH_TOTAL") return "First-half total";
  if (marketType === "SH_AH") return "Second-half handicap";
  if (marketType === "SH_TOTAL") return "Second-half total";
  if (marketType === "CORNER_FT_AH") return "Corner handicap";
  if (marketType === "CORNER_FT_TOTAL") return "Corner total";
  if (marketType === "CORNER_FH_AH") return "First-half corner handicap";
  if (marketType === "CORNER_FH_TOTAL") return "First-half corner total";
  if (marketType === "CARD_FT_AH") return "Card handicap";
  if (marketType === "CARD_FT_TOTAL") return "Card total";
  if (marketType === "CARD_FH_AH") return "First-half card handicap";
  if (marketType === "CARD_FH_TOTAL") return "First-half card total";
  return marketType;
}

export function observedTicketAsComparisonRow(ticket: ObservedTicketRow): ComparisonRow {
  const bestBySelection: Record<string, ProviderId> = {};
  for (const selection of ticket.outcomeDomain) {
    const best = ticket.cells.flatMap((cell) => cell.quotes.filter((quote) => quote.selection === selection &&
      quote.status === "OPEN" && cell.market.status === "OPEN").flatMap((quote) => {
      const odds = decimalOdds(quote);
      return odds === null ? [] : [{ provider: cell.provider, odds }];
    })).sort((left, right) => right.odds - left.odds || compareProviders(left.provider, right.provider))[0];
    if (best !== undefined) bestBySelection[selection] = best.provider;
  }
  const bestOdds = ticket.outcomeDomain.map((selection) => {
    const provider = bestBySelection[selection];
    const quote = ticket.cells.find((cell) => cell.provider === provider)?.quotes.find((item) => item.selection === selection);
    return quote === undefined ? null : decimalOdds(quote);
  });
  const inverseSum = bestOdds.length === 2 && bestOdds.every((value): value is number => value !== null)
    ? bestOdds.reduce((sum, value) => sum + 1 / value, 0) : null;
  const crossBook = new Set(Object.values(bestBySelection)).size >= 2;
  return { key: ticket.key, marketType: ticket.marketType, scope: ticket.scope, line: ticket.line,
    cells: ticket.cells, bestBySelection, crossBook,
    margin: crossBook && inverseSum !== null ? (1 / inverseSum) - 1 : null };
}

/** A kickoff must sit this far ahead before it can contradict a live claim, so a
 *  fixture minutes from kick-off is not read as one that starts later. */
const SCHEDULED_KICKOFF_MARGIN_MS = 300_000;

/**
 * A book claiming a fixture is running, when another book schedules that same
 * fixture hours away.
 *
 * Measured 2026-08-27: every phase disagreement on the board was SABA calling a
 * fixture live while CMD, IM and BTI placed its kickoff 224 to 375 minutes out,
 * and a live event is never compared with a pre-match one - so 35 of the 37
 * fixtures that two books both held could not be paired at all.
 *
 * A kickoff is a fact about the fixture, not a price, and the correction is
 * only sound because of what it implies: the match has not started, so what
 * both books are quoting are pre-match prices whatever section they sit in.
 */
function withScheduledPhase(
  catalogs: readonly LiveCatalogResponse[]
): readonly LiveCatalogResponse[] {
  const nowMs = Math.max(...catalogs.map((catalog) => catalog.observedAtMs), 0);
  const scheduled = new Map<string, number>();
  for (const catalog of catalogs) {
    for (const event of catalog.events) {
      if (event.category !== "FOOTBALL" || event.isLive ||
        event.startAtUtcMs <= nowMs + SCHEDULED_KICKOFF_MARGIN_MS) continue;
      const key = unorderedParticipantKey(event);
      const previous = scheduled.get(key);
      if (previous === undefined || event.startAtUtcMs < previous) {
        scheduled.set(key, event.startAtUtcMs);
      }
    }
  }
  if (scheduled.size === 0) return catalogs;
  // One book alone against a schedule is a mislabel; two books agreeing that a
  // fixture is running are evidence, and a third listing it later is more
  // likely naming a different meeting than contradicting them. Overruling both
  // cost more pairings than it won: 24 fixtures that priced against each other
  // fell to 5.
  const liveBooks = new Map<string, Set<ProviderId>>();
  for (const catalog of catalogs) {
    for (const event of catalog.events) {
      if (event.category !== "FOOTBALL" || !event.isLive) continue;
      const key = unorderedParticipantKey(event);
      (liveBooks.get(key) ?? liveBooks.set(key, new Set()).get(key)!).add(catalog.provider);
    }
  }
  return catalogs.map((catalog) => {
    const corrected = new Set<string>();
    const events = catalog.events.map((event) => {
      if (event.category !== "FOOTBALL" || !event.isLive) return event;
      const key = unorderedParticipantKey(event);
      const startAtUtcMs = scheduled.get(key);
      if (startAtUtcMs === undefined || (liveBooks.get(key)?.size ?? 0) > 1) return event;
      corrected.add(event.providerEventId);
      return { ...event, isLive: false, startAtUtcMs, liveState: null, rematchCandidate: false };
    });
    if (corrected.size === 0) return catalog;
    // A quote is only shown when its phase matches its event's, so the prices
    // have to move with it or the corrected fixture arrives with none.
    return { ...catalog, events, quotes: catalog.quotes.map((quote) =>
      corrected.has(quote.providerEventId) && quote.isLive ? { ...quote, isLive: false } : quote) };
  });
}

export function buildComparisonEvents(catalogs: readonly LiveCatalogResponse[],
  competitionMemory?: CompetitionLinkMemory): readonly ComparisonEvent[] {
  const orderedCatalogs = sortProviderItems(withScheduledPhase(catalogs), (catalog) => catalog.provider,
    (left, right) => left.accountId.localeCompare(right.accountId));
  const catalogIndexes = new Map<LiveCatalogResponse, {
    readonly marketsByEvent: ReadonlyMap<string, readonly ProviderMarket[]>;
    readonly quotesByMarket: ReadonlyMap<string, readonly ProviderQuote[]>;
  }>();
  for (const catalog of orderedCatalogs) {
    const marketsByEvent = new Map<string, ProviderMarket[]>();
    for (const market of catalog.markets) {
      const values = marketsByEvent.get(market.providerEventId) ?? [];
      values.push(market);
      marketsByEvent.set(market.providerEventId, values);
    }
    const quotesByMarket = new Map<string, ProviderQuote[]>();
    for (const quote of catalog.quotes) {
      const values = quotesByMarket.get(quote.providerMarketId) ?? [];
      values.push(quote);
      quotesByMarket.set(quote.providerMarketId, values);
    }
    catalogIndexes.set(catalog, { marketsByEvent, quotesByMarket });
  }
  const competitionLinks = learnCompetitionLinks(orderedCatalogs, competitionMemory);
  // A book listing one fixture twice cannot say which entry a rival's price
  // belongs to, so both are withheld. Its own competition string is what tells
  // a repeat apart from a separate product: SABA carries Celta Vigo v Osasuna
  // four times over - the main match, its corners, its cards and a combined
  // corner-and-goal book - all with the same participants and kickoff. Judged on
  // participants alone every one of them looks ambiguous and the main match, the
  // only entry another book can price against, is withheld with them. The raw
  // string is deliberate: linking it first would fold those products back into
  // one identity and lose the distinction again.
  const identityKey = (provider: ProviderId, event: ProviderEvent): string =>
    [provider, event.category, event.isLive ? "LIVE" : String(event.startAtUtcMs),
      competitionIdentity(event.competition), unorderedParticipantKey(event)].join("|");
  const identityCounts = new Map<string, number>();
  for (const catalog of orderedCatalogs) for (const event of catalog.events) {
    const key = identityKey(catalog.provider, event);
    identityCounts.set(key, (identityCounts.get(key) ?? 0) + 1);
  }
  const ambiguous = (catalog: LiveCatalogResponse, event: ProviderEvent): boolean =>
    (identityCounts.get(identityKey(catalog.provider, event)) ?? 0) > 1;
  type MutableEventGroup = { key: string; event: ProviderEvent; catalogs: LiveCatalogResponse[];
    ids: Partial<Record<ProviderId, string>>; orientations: Partial<Record<ProviderId, EventOrientation>>;
    sourceEvents: Partial<Record<ProviderId, ProviderEvent>> };
  const groups: MutableEventGroup[] = [];
  const groupsByParticipants = new Map<string, MutableEventGroup[]>();
  const footballGroupsByCandidate = new Map<string, MutableEventGroup[]>();
  for (const catalog of orderedCatalogs) {
    for (const event of catalog.events) {
      let orientation: EventOrientation | null = null;
      const participantKey = [event.category, event.isLive ? "LIVE" : "PREMATCH",
        unorderedParticipantKey(event)].join("|");
      const exactCandidates = groupsByParticipants.get(participantKey) ?? [];
      const candidatePool = exactCandidates.length > 0 ? exactCandidates : [...new Set(
        footballCandidateLookupKeys(event, competitionLinks)
          .flatMap((key) => footballGroupsByCandidate.get(key) ?? []))];
      const matches = candidatePool.flatMap((candidate) => {
        if (candidate.ids[catalog.provider] !== undefined || ambiguous(catalog, event) ||
          candidate.catalogs.some((source) => ambiguous(source, candidate.sourceEvents[source.provider] ?? candidate.event))) return [];
        const candidateOrientation = compatibleEventOrientation(candidate.event, event, competitionLinks);
        return candidateOrientation === null ? [] : [{ candidate, orientation: candidateOrientation }];
      });
      let group = matches.length === 1 ? matches[0]!.candidate : undefined;
      orientation = matches.length === 1 ? matches[0]!.orientation : null;
      if (group === undefined) {
        orientation = "SAME";
        group = { key: eventKey(event), event: displayEvent(event), catalogs: [], ids: {}, orientations: {},
          sourceEvents: {} };
        groups.push(group);
        groupsByParticipants.set(participantKey, [...(groupsByParticipants.get(participantKey) ?? []), group]);
        const candidateKey = footballCandidateIndexKey(event, competitionLinks);
        if (candidateKey !== null) {
          footballGroupsByCandidate.set(candidateKey,
            [...(footballGroupsByCandidate.get(candidateKey) ?? []), group]);
        }
      }
      if (!group.catalogs.some((candidate) => candidate.provider === catalog.provider)) group.catalogs.push(catalog);
      group.ids[catalog.provider] = event.providerEventId;
      group.orientations[catalog.provider] = orientation ?? "SAME";
      group.sourceEvents[catalog.provider] = event;
    }
  }
  return groups.map((group) => {
    const key = group.key;
    const rowGroups = new Map<string, ComparisonCell[]>();
    for (const catalog of group.catalogs) {
      const providerEventId = group.ids[catalog.provider];
      const index = catalogIndexes.get(catalog)!;
      for (const market of index.marketsByEvent.get(providerEventId ?? "") ?? []) {
        const orientation = group.orientations[catalog.provider] ?? "SAME";
        const orientedMarket = orientMarket(market, orientation);
        const rowKey = marketKey(orientedMarket);
        const cells = rowGroups.get(rowKey) ?? [];
        const phaseQuotes = (index.quotesByMarket.get(market.providerMarketId) ?? [])
          .filter((quote) => quote.isLive === group.event.isLive);
        cells.push({ provider: catalog.provider, market: orientedMarket,
          quotes: orientQuotes(phaseQuotes, orientation), sourceEvent: group.sourceEvents[catalog.provider]!,
          sourceMarket: market, sourceQuotes: phaseQuotes });
        rowGroups.set(rowKey, cells);
      }
    }
    const observedRows = [...rowGroups.entries()].flatMap(([rowKey, rawCells]) => {
      const cells = displayTwoWayCells(rawCells);
      if (cells.length === 0) return [];
      const outcomeDomain = [...new Set(cells[0]!.quotes.map((quote) => quote.selection))].sort();
      return [{ key: rowKey, marketType: cells[0]!.market.marketType, scope: cells[0]!.market.scope,
        line: cells[0]!.market.line, settlementProfile: cells[0]!.market.settlementProfile,
        outcomeDomain, cells } satisfies ObservedTicketRow];
    }).sort((left, right) => left.key.localeCompare(right.key));
    const rows = [...rowGroups.entries()].map(([rowKey, rawCells]) =>
      [rowKey, eligibleTwoWayCells(rawCells.filter(isFocusedTwoWayTicket))] as const)
      .filter(([, cells]) => cells.length >= 2).map(([rowKey, cells]): ComparisonRow => observedTicketAsComparisonRow({
        key: rowKey, marketType: cells[0]!.market.marketType, scope: cells[0]!.market.scope,
        line: cells[0]!.market.line, settlementProfile: cells[0]!.market.settlementProfile,
        outcomeDomain: [...new Set(cells[0]!.quotes.map((quote) => quote.selection))].sort(), cells
      })).sort((left, right) => (right.margin ?? Number.NEGATIVE_INFINITY) - (left.margin ?? Number.NEGATIVE_INFINITY) || left.key.localeCompare(right.key));
    const bestMargin = rows.reduce<number | null>((best, row) => row.margin === null ? best : Math.max(best ?? row.margin, row.margin), null);
    return { key, event: group.event, providers: group.catalogs.map((catalog) => catalog.provider),
      catalogs: group.catalogs, providerEventIds: group.ids, observedRows, rows, bestMargin };
  }).sort((left, right) => (right.bestMargin ?? Number.NEGATIVE_INFINITY) - (left.bestMargin ?? Number.NEGATIVE_INFINITY) ||
    left.event.startAtUtcMs - right.event.startAtUtcMs);
}

export function formatCountdown(startAtUtcMs: number, nowMs: number): string {
  const remainingSeconds = Math.max(0, Math.floor((startAtUtcMs - nowMs) / 1_000));
  if (remainingSeconds === 0) return "Starting / refresh pending";
  const days = Math.floor(remainingSeconds / 86_400);
  const hours = Math.floor((remainingSeconds % 86_400) / 3_600);
  const minutes = Math.floor((remainingSeconds % 3_600) / 60);
  const seconds = remainingSeconds % 60;
  const two = (value: number): string => String(value).padStart(2, "0");
  return `Starts in ${two(days)}:${two(hours)}:${two(minutes)}:${two(seconds)}`;
}

type DisplayLiveState = ProviderEvent["liveState"];

export function formatMatchClock(liveState: DisplayLiveState | null): string {
  if (liveState === null || !("clockMs" in liveState) || liveState.clockMs === null ||
    !Number.isFinite(liveState.clockMs) || liveState.clockMs < 0) {
    return "LIVE · clock unavailable";
  }
  const totalSeconds = Math.floor(liveState.clockMs / 1_000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const clock = `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  return `LIVE${liveState.period === null ? "" : ` · ${liveState.period}`} · ${clock} elapsed`;
}

export function estimatedLiveStartAtMs(observedAtMs: number, liveState: DisplayLiveState | null): number | null {
  if (!Number.isFinite(observedAtMs) || liveState === null || !("clockMs" in liveState) || liveState.clockMs === null ||
    !Number.isFinite(liveState.clockMs) || liveState.clockMs < 0) return null;
  const estimated = observedAtMs - liveState.clockMs;
  return Number.isFinite(estimated) && estimated >= 0 ? estimated : null;
}
