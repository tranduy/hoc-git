import { footballBinaryMarketSpec, footballCategoricalMarketSpec, isFootballCategoricalSelection, footballResultMarketSpec, resultComplement, isNoPushFootballLine, playerComparisonKey, sameNativePlayer,
  type MarketType, type ProviderEvent, type ProviderId, type ProviderMarket,
  type ProviderQuote } from "@tool-chenh/contracts";
import type { LiveCatalogResponse } from "../api/catalog.js";
import { compareProviders, sortProviderItems } from "./provider-order.js";
import { observedCompetitionAliases } from "./observed-competition-aliases.js";
import { footballComparisonEquivalents } from "./football-comparison-equivalents.js";

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
  readonly opposition?: ResultOpposition;
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
  readonly opposition?: ResultOpposition;
  readonly key: string;
  readonly marketType: string;
  readonly scope: string;
  readonly line: string | null;
  readonly settlementProfile: string;
  readonly outcomeDomain: readonly string[];
  readonly cells: readonly ComparisonCell[];
}

/** A comparison partition, never a replacement for either native source market. */
export interface ResultOpposition {
  readonly kind: "RESULT_COMPLEMENT";
  readonly single: "HOME" | "DRAW" | "AWAY";
  readonly double: "HOME_DRAW" | "HOME_AWAY" | "DRAW_AWAY";
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
  ["lausanne sports", "lausanne sport"],
  ["rodez af", "rodez aveyron"],
  ["st gilloise", "union saint gilloise"],
  ["union st gilloise", "union saint gilloise"],
  ["sabah", "sabah baku"],
  ["al hussein jor", "al hussein irbid"],
  ["maccabi kiryat gat", "kiryat gat"],
  // Exact variants observed across all six feeds. Include the full prefixed
  // spellings so canonicalizing a short name preserves existing IM matches.
  ["paris saint germain", "paris st germain"],
  ["bayern munchen", "bayern munich"],
  ["olympiacos", "olympiakos"],
  ["helsingborg if", "helsingborg"],
  ["helsingborgs", "helsingborg"],
  ["helsingborgs if", "helsingborg"],
  ["busan ipark", "busan i park"],
  ["sheffield wednesday", "sheffield wed"],
  ["west bromwich albion", "west brom"],
  ["austria wien", "austria vienna"],
  ["rapid wien", "rapid vienna"],
  ["rapid wien 2", "rapid vienna 2"],
  ["sk rapid wien 2", "rapid vienna 2"],
  ["legia warszawa", "legia warsaw"],
  ["kairat almaty", "kayrat almaty"],
  ["grasshopper", "grasshoppers"],
  ["djurgardens", "djurgarden"],
  ["djurgardens if", "djurgarden"],
  ["sparta praha", "sparta prague"],
  ["ac sparta praha", "sparta prague"],
  ["slavia praha", "slavia prague"],
  ["sk slavia praha", "slavia prague"],
  ["st gallen", "sankt gallen"],
  ["el gouna", "el gounah"],
  ["dinamo moscow", "dynamo moscow"],
  ["baniyas", "bani yas"],
  ["estudiantes lp", "estudiantes la plata"],
  ["gimnasia lp", "gimnasia la plata"],
  ["deportivo la coruna", "dep la coruna"],
  ["st patricks athletic", "saint patricks"],
  ["japan w u20", "japan u20 w"],
  ["usa w u20", "usa u20 w"],
  ["st mirren", "saint mirren"],
  ["al ahly egypt", "al ahly cairo"],
  ["operario ferroviario esporte clube", "operario ferroviario ec"],
  ["operario pr", "operario ferroviario ec"],
  ["stade rennes", "stade rennais"],
  ["rennes", "stade rennais"],
  ["ferencvarosi tc", "ferencvaros"],
  ["young violets austria wien", "young violets austria vienna"],
  ["palmeiras sp", "palmeiras"],
  ["sociedade esportiva palmeiras", "palmeiras"],
  ["rc lens", "lens"],
  ["olympique lyonnais", "lyon"],
  ["stade brestois", "brest"],
  ["koln", "cologne"],
  ["hamburger sv", "hamburg"],
  ["nhat ban u23", "japan u23"],
  ["nhat ban nu", "japan w"],
  ["thai lan nu", "thailand w"],
  ["han quoc nu", "south korea w"],
  ["dai bac trung hoa nu", "chinese taipei w"],
  ["viet nam nu", "vietnam w"]
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
  ["scotland premiership", "scotland-premiership"],
  ["scottish premiership", "scotland-premiership"],
  ["giai ngoai hang scotland", "scotland-premiership"],
  ["czech republic first league", "czech-first-league"],
  ["czech republic 1st division", "czech-first-league"],
  ["giai bong da hang nhat quoc gia sec", "czech-first-league"],
  ["giai vo dich quoc gia cong hoa sec", "czech-first-league"],
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
  ["giai bong da hang 2 colombia primera b", "colombia-primera-b"],
  ["giai my mls next pro", "usa-mls-next-pro"],
  ["usa mls next pro", "usa-mls-next-pro"],
  ["giai mls next pro hoa ky", "usa-mls-next-pro"],
  ["brazil campeonato paulista u20", "brazil-paulista-u20"],
  ["giai vo dich paulista u20 cua brazil", "brazil-paulista-u20"],
  ["giai paulista u20 brazil", "brazil-paulista-u20"],
  ["colombia primera a", "colombia-primera-a"],
  ["giai colombia primera a", "colombia-primera-a"],
  ["giai vo dich quoc gia colombia", "colombia-primera-a"],
  ["iceland u19 league a", "iceland-u19-league-a"],
  ["giai u19 iceland a", "iceland-u19-league-a"],
  ["belgium challenger pro league", "belgium-challenger-pro-league"],
  ["giai challenger pro league bi", "belgium-challenger-pro-league"],
  ["el salvador reserve league", "el-salvador-reserve-league"],
  ["giai reserve league el salvador", "el-salvador-reserve-league"],
  ["mexico liga mx", "mexico-liga-mx"],
  ["giai liga mx mexico", "mexico-liga-mx"],
  ["giai vo dich quoc gia mexico liga mx", "mexico-liga-mx"],
  ["indonesia super league", "indonesia-liga-1"],
  ["indonesia liga 1", "indonesia-liga-1"],
  ["giai liga 1 indonesia", "indonesia-liga-1"],
  ["giai uae pro league", "uae-pro-league"],
  ["uae pro league", "uae-pro-league"],
  ["finland veikkausliiga", "finland-veikkausliiga"],
  ["giai ngoai hang phan lan", "finland-veikkausliiga"],
  ["paraguay division intermedia", "paraguay-division-intermedia"],
  ["giai paraguay segunda division", "paraguay-division-intermedia"],
  ["giai vo dich quoc gia paraguay hang trung", "paraguay-division-intermedia"],
  ["japan j2 league", "japan-j2-league"],
  ["japan j league division 2", "japan-j2-league"],
  ["giai bong da hang nhi nhat ban j2 league", "japan-j2-league"],
  ["giai hang nhi nhat ban j2 league", "japan-j2-league"],
  ["china csl", "china-super-league"],
  ["china football super league", "china-super-league"],
  ["giai bong da ngoai hang trung quoc", "china-super-league"],
  ["giai vo dich quoc gia trung quoc", "china-super-league"],
  ["england league two", "england-league-two"],
  ["giai anh league two", "england-league-two"],
  ["el salvador primera division", "el-salvador-primera-division"],
  ["giai hang 1 el salvador", "el-salvador-primera-division"],
  ["giai primera division el salvador", "el-salvador-primera-division"],
  ["copa libertadores", "conmebol-libertadores"],
  ["conmebol libertadores", "conmebol-libertadores"],
  ["giai copa libertadores", "conmebol-libertadores"],
  ["copa sudamericana", "conmebol-sudamericana"],
  ["giai copa sudamericana", "conmebol-sudamericana"],
  ["giai laliga tay ban nha", "spain-la-liga"],
  ["giai la liga tay ban nha", "spain-la-liga"],
  ["giai vo dich quoc gia tay ban nha la liga", "spain-la-liga"],
  ["spain la liga", "spain-la-liga"],
  ["spain primera laliga", "spain-la-liga"],
  ["australia cup", "australia-cup"],
  ["australia ffa cup", "australia-cup"],
  ["cup australia", "australia-cup"],
  ["cup quoc gia uc", "australia-cup"],
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
  ["cup israel", "israel-state-cup"],
  ...observedCompetitionAliases
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

type FootballMarketFamily = "GOALS" | "CORNERS" | "CARDS";
type ComparisonMarketFamily = FootballMarketFamily | "ESPORTS";

function footballMarketFamily(marketType: string): FootballMarketFamily {
  if (marketType.startsWith("CORNER_") || marketType.startsWith("HOME_CORNER_") ||
    marketType.startsWith("AWAY_CORNER_")) return "CORNERS";
  if (marketType.startsWith("CARD_") || marketType.startsWith("YELLOW_CARD_") ||
    marketType.startsWith("HOME_CARD_") || marketType.startsWith("AWAY_CARD_") ||
    marketType === "SENDING_OFF") return "CARDS";
  return "GOALS";
}

function competitionIdentityForFamily(value: string, family: FootballMarketFamily): string {
  let identity = competitionIdentity(value);
  if (family === "CORNERS") {
    identity = identity.replace(/\s+(?:corners?|corner bets?|phat goc|goc)$/u, "").trim();
  }
  if (family === "CARDS") {
    identity = identity.replace(/\s+(?:bookings?|cards?|booking bets?|the phat|phat the)$/u, "").trim();
  }
  // Product suffixes prevent the full label from matching a known league alias.
  // Resolve the remaining base name only after removing this statistic's suffix.
  return footballCompetitionAliases.get(identity) ?? identity;
}

function competitionLinkKey(identity: string, family: FootballMarketFamily): string {
  return `${family}\u0000${identity}`;
}

function linkedCompetitionIdentity(value: string, links: ReadonlyMap<string, string> | undefined,
  family: FootballMarketFamily): string {
  const identity = competitionIdentityForFamily(value, family);
  const key = competitionLinkKey(identity, family);
  return links?.get(key) ?? key;
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
    readonly provider: ProviderId; readonly family: FootballMarketFamily;
    readonly fixtures: LearnedFixture[] }>();
  for (const catalog of catalogs) {
    const marketsByEvent = new Map<string, string[]>();
    for (const market of catalog.markets) {
      (marketsByEvent.get(market.providerEventId) ??
        marketsByEvent.set(market.providerEventId, []).get(market.providerEventId)!)
        .push(market.marketType);
    }
    for (const event of catalog.events) {
      if (event.category !== "FOOTBALL") continue;
      const marketTypes = marketsByEvent.get(event.providerEventId) ?? [];
      const families = marketTypes.length === 0 ? ["GOALS" as const]
        : [...new Set(marketTypes.map(footballMarketFamily))];
      for (const family of families) {
        const identity = competitionIdentityForFamily(event.competition, family);
        if (identity.length === 0) continue;
        const key = `${catalog.provider}\u0000${family}\u0000${identity}`;
        const entry = fixturesByBookCompetition.get(key) ??
          { identity, provider: catalog.provider, family, fixtures: [] };
        entry.fixtures.push({ participantA: event.participantA, participantB: event.participantB,
          startAtUtcMs: event.startAtUtcMs, isLive: event.isLive });
        fixturesByBookCompetition.set(key, entry);
      }
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
    left < right ? `${left}\u0000${right}` : `${right}\u0000${left}`;
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
      if (leftKey.split("\u0000")[0] === rightKey.split("\u0000")[0]) continue;
      if (leftEntry.identity === rightEntry.identity) continue;
      if (leftEntry.family !== rightEntry.family) continue;
      // A pair the memory has watched agree on two fixtures is carrying the
      // same evidence as two sitting on one board, gathered over more than one
      // glance because that is how a 24-hour window shows a league its season.
      const pair = pairKey(leftKey, rightKey);
      const shared = Math.max(sharedFixtures.get(pair)?.size ?? 0, rememberedCounts.get(pair) ?? 0);
      if (shared >= SHARED_FIXTURES_REQUIRED_TO_LINK_COMPETITIONS) {
        union(competitionLinkKey(leftEntry.identity, leftEntry.family),
          competitionLinkKey(rightEntry.identity, rightEntry.family));
      }
    }
  }
  const links = new Map<string, string>();
  for (const { identity, family } of fixturesByBookCompetition.values()) {
    const key = competitionLinkKey(identity, family);
    links.set(key, find(key));
  }
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
  // This observed team name must retain its distinction from Austria Vienna
  // when Wien/Vienna aliases make the remaining club tokens identical.
  const namedTeamQualifiers = /\byoung violets\b/u.test(identity) ? ["young violets"] : [];
  const canonicalQualifier = (token: string): string => ["ladies", "nu", "w", "women"].includes(token)
    ? "women" : ["res", "reserve", "reserves"].includes(token) ? "reserve" : token;
  return { identity,
    qualifiers: [...tokens.filter((token) => footballParticipantQualifiers.has(token)).map(canonicalQualifier),
      ...namedTeamQualifiers].sort(),
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
  // Cached/provider payloads have labelled ET/PEN fixtures as REGULATION.
  // These explicit settlement markers must not become optional name tokens
  // in fuzzy club matching, even when both books made the same scope error.
  const nativeText = decodeHtmlEntities(`${event.competition} ${event.participantA} ${event.participantB}`)
    .normalize("NFKD").replace(/\p{M}+/gu, "");
  const markedScopes = new Set<string>([...nativeText.matchAll(/\(\s*(ET|PEN|HIEP\s+PHU|LUAN\s+LUU)\s*\)/giu)]
    .map(match => /^(?:ET|HIEP\s+PHU)$/iu.test(match[1]!) ? "EXTRA_TIME" : "PENALTY_SHOOTOUT"));
  if (markedScopes.size > 1 || (markedScopes.size === 1 && !markedScopes.has(event.eventScope))) return false;
  const text = competitionIdentity(`${event.competition} ${event.participantA} ${event.participantB}`);
  return !/\b(?:fantasy match|which team advances|team to advance|special market)\b/u.test(text);
}

function unorderedParticipantKey(event: ProviderEvent): string {
  return [participantIdentity(event.category, event.participantA),
    participantIdentity(event.category, event.participantB)].sort().join("|");
}

const footballKickoffCandidateBucketMs = 120_000;

function footballCandidatePrefix(event: ProviderEvent, links: ReadonlyMap<string, string>,
  family: ComparisonMarketFamily): string | null {
  if (event.category !== "FOOTBALL") return null;
  if (family === "ESPORTS") return null;
  const competition = linkedCompetitionIdentity(event.competition, links, family);
  if (competition.length === 0) return null;
  return [event.category, family, event.isLive ? "LIVE" : "PREMATCH", event.eventScope,
    event.isVirtual === true ? "VIRTUAL" : event.isVirtual === false ? "REAL" : "UNKNOWN",
    event.sportVariant ?? "UNKNOWN", competition].join("|");
}

function footballCandidateIndexKey(event: ProviderEvent, links: ReadonlyMap<string, string>,
  family: ComparisonMarketFamily): string | null {
  const prefix = footballCandidatePrefix(event, links, family);
  if (prefix === null) return null;
  return event.isLive ? `${prefix}|LIVE`
    : `${prefix}|${Math.floor(event.startAtUtcMs / footballKickoffCandidateBucketMs)}`;
}

function footballCandidateLookupKeys(event: ProviderEvent, links: ReadonlyMap<string, string>,
  family: ComparisonMarketFamily): readonly string[] {
  const prefix = footballCandidatePrefix(event, links, family);
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
  orientation: EventOrientation, family: ComparisonMarketFamily,
  links?: ReadonlyMap<string, string>): boolean {
  const sameFixture = left.fixtureDiscriminator !== null && left.fixtureDiscriminator.length > 0 &&
    right.fixtureDiscriminator !== null && right.fixtureDiscriminator.length > 0 &&
    left.fixtureDiscriminator === right.fixtureDiscriminator;
  if (sameFixture) return true;
  const sameCompetitionAndKickoff = family !== "ESPORTS" &&
    linkedCompetitionIdentity(left.competition, links, family).length > 0 &&
    linkedCompetitionIdentity(left.competition, links, family) ===
      linkedCompetitionIdentity(right.competition, links, family) &&
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
  family: ComparisonMarketFamily, links?: ReadonlyMap<string, string>): EventOrientation | null {
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
    if (family === "ESPORTS") return null;
    const sameFixture = left.fixtureDiscriminator !== null && left.fixtureDiscriminator.length > 0 &&
      left.fixtureDiscriminator === right.fixtureDiscriminator;
    const leftCompetition = linkedCompetitionIdentity(left.competition, links, family);
    const rightCompetition = linkedCompetitionIdentity(right.competition, links, family);
    if (!sameFixture && (leftCompetition.length === 0 || leftCompetition !== rightCompetition)) return null;
  }
  if (left.isLive && left.category === "FOOTBALL" &&
    !hasIndependentFootballLiveIdentity(left, right, participantMatch.orientation, family, links)) return null;
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

function isFootballHandicapMarketType(marketType: string): boolean {
  return footballBinaryMarketSpec(marketType as MarketType)?.family === "HANDICAP";
}

function isFootballTotalMarketType(marketType: string): boolean {
  return footballBinaryMarketSpec(marketType as MarketType)?.family === "TOTAL";
}

const swappedFootballSubjectMarketType: Readonly<Partial<Record<MarketType, MarketType>>> = {
  HOME_CORNER_FT_TOTAL: "AWAY_CORNER_FT_TOTAL", AWAY_CORNER_FT_TOTAL: "HOME_CORNER_FT_TOTAL",
  HOME_CORNER_FH_TOTAL: "AWAY_CORNER_FH_TOTAL", AWAY_CORNER_FH_TOTAL: "HOME_CORNER_FH_TOTAL",
  HOME_FT_SCORE_BOTH_HALVES: "AWAY_FT_SCORE_BOTH_HALVES", AWAY_FT_SCORE_BOTH_HALVES: "HOME_FT_SCORE_BOTH_HALVES",
  HOME_FT_WIN_BOTH_HALVES: "AWAY_FT_WIN_BOTH_HALVES", AWAY_FT_WIN_BOTH_HALVES: "HOME_FT_WIN_BOTH_HALVES",
  HOME_FT_WIN_EITHER_HALF: "AWAY_FT_WIN_EITHER_HALF", AWAY_FT_WIN_EITHER_HALF: "HOME_FT_WIN_EITHER_HALF",
  HOME_FT_ODD_EVEN: "AWAY_FT_ODD_EVEN", AWAY_FT_ODD_EVEN: "HOME_FT_ODD_EVEN",
  HOME_FH_ODD_EVEN: "AWAY_FH_ODD_EVEN", AWAY_FH_ODD_EVEN: "HOME_FH_ODD_EVEN",
  HOME_SH_ODD_EVEN: "AWAY_SH_ODD_EVEN", AWAY_SH_ODD_EVEN: "HOME_SH_ODD_EVEN",
  HOME_FT_WIN_TO_NIL: "AWAY_FT_WIN_TO_NIL", AWAY_FT_WIN_TO_NIL: "HOME_FT_WIN_TO_NIL",
  HOME_FT_CLEAN_SHEET: "AWAY_FT_CLEAN_SHEET", AWAY_FT_CLEAN_SHEET: "HOME_FT_CLEAN_SHEET",
  HOME_FT_TOTAL: "AWAY_FT_TOTAL", AWAY_FT_TOTAL: "HOME_FT_TOTAL",
  HOME_FH_TOTAL: "AWAY_FH_TOTAL", AWAY_FH_TOTAL: "HOME_FH_TOTAL",
  HOME_SH_TOTAL: "AWAY_SH_TOTAL", AWAY_SH_TOTAL: "HOME_SH_TOTAL",
  HOME_FT_TO_WIN: "AWAY_FT_TO_WIN", AWAY_FT_TO_WIN: "HOME_FT_TO_WIN"
};

function orientFootballMarketType(marketType: MarketType, orientation: EventOrientation): MarketType {
  if (orientation !== "SWAPPED") return marketType;
  const candidate = marketType.replace(/^(HOME|AWAY)_/u, prefix => prefix === "HOME_" ? "AWAY_" : "HOME_") as MarketType;
  return swappedFootballSubjectMarketType[marketType] ??
    (footballBinaryMarketSpec(candidate) !== null || footballCategoricalMarketSpec(candidate) !== null ? candidate : marketType);
}

function orientFootballSelection(type: MarketType, selection: string): string {
  if (footballCategoricalMarketSpec(type) !== null && isFootballCategoricalSelection(type, selection)) {
    const score = /^SCORE_(\d+)_(\d+)$/u.exec(selection);
    if (score !== null) return `SCORE_${score[2]}_${score[1]}`;
    if (selection.startsWith("SCORES_")) return "SCORES_" + selection.slice(7).split("|")
      .map(pair => pair.split("_").reverse().map(Number)).sort((a,b) => a[0]! - b[0]! || a[1]! - b[1]!)
      .map(pair => pair.join("_")).join("|");
    const swapped = selection.replace(/\b(?:HOME|AWAY)\b|(?<=_)(?:HOME|AWAY)(?=_|$)|^(?:HOME|AWAY)(?=_)/gu,
      token => token === "HOME" ? "AWAY" : "HOME");
    return type.includes("DOUBLE_CHANCE") ? swapped.replace(/^AWAY_HOME/u,"HOME_AWAY")
      .replace(/^AWAY_DRAW/u,"DRAW_AWAY").replace(/^DRAW_HOME/u,"HOME_DRAW") : swapped;
  }
  return selection === "HOME" ? "AWAY" : selection === "AWAY" ? "HOME"
    : selection === "HOME_DRAW" ? "DRAW_AWAY" : selection === "DRAW_AWAY" ? "HOME_DRAW" : selection;
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
    (isFootballHandicapMarketType(market.marketType) || market.marketType.endsWith("EUROPEAN_HANDICAP"));
  const marketType = market.category === "FOOTBALL" ? orientFootballMarketType(market.marketType, orientation)
    : market.marketType;
  // Only the registry's known subject-specific profile can be reoriented.
  // A provider-specific rule must not become verified merely by swapping teams.
  const settlementProfile = market.category === "FOOTBALL" && marketType !== market.marketType &&
    market.settlementProfile === (footballBinaryMarketSpec(market.marketType) ?? footballCategoricalMarketSpec(market.marketType))?.settlementProfile
    ? (footballBinaryMarketSpec(marketType) ?? footballCategoricalMarketSpec(marketType))?.settlementProfile ?? market.settlementProfile
    : market.settlementProfile;
  const line = canonicalLine(shouldInvert ? invertLine(market.line) : market.line);
  const player = orientation === "SWAPPED" && market.category === "FOOTBALL" && market.player !== undefined
    ? { ...market.player, teamSide: market.player.teamSide === "HOME" ? "AWAY" as const
      : market.player.teamSide === "AWAY" ? "HOME" as const : null } : market.player;
  // Unchanged canonical and native values can share one immutable record,
  // including through the worker's structured clone.
  return marketType === market.marketType && settlementProfile === market.settlementProfile && line === market.line && player === market.player
    ? market : { ...market, marketType, settlementProfile, line, ...(player === undefined ? {} : { player }) };
}

function orientQuotes(quotes: readonly ProviderQuote[], orientation: EventOrientation): readonly ProviderQuote[] {
  if (orientation !== "SWAPPED") return quotes.map((quote) => {
    const line = canonicalLine(quote.line);
    return line === quote.line ? quote : { ...quote, line };
  });
  return quotes.map((quote) => {
    if (quote.category === "LOL") {
      if (quote.selection === "TEAM_A") return { ...quote, selection: "TEAM_B" };
      if (quote.selection === "TEAM_B") return { ...quote, selection: "TEAM_A" };
      return quote;
    }
    if (quote.category === "FOOTBALL") {
      const selection = orientFootballSelection(quote.marketType, quote.selection);
      const line = canonicalLine(isFootballHandicapMarketType(quote.marketType) || quote.marketType.endsWith("EUROPEAN_HANDICAP") ? invertLine(quote.line) : quote.line);
      const marketType = orientFootballMarketType(quote.marketType, orientation);
      const player = quote.player === undefined ? undefined : { ...quote.player,
        teamSide: quote.player.teamSide === "HOME" ? "AWAY" as const : quote.player.teamSide === "AWAY" ? "HOME" as const : null };
      return marketType === quote.marketType && selection === quote.selection && line === quote.line && player === quote.player
        ? quote : { ...quote, marketType, selection, line, ...(player === undefined ? {} : { player }) };
    }
    return quote;
  }).sort((left, right) => left.selection.localeCompare(right.selection));
}

function marketKey(market: ProviderMarket): string {
  const terms = [market.marketType, market.scope, canonicalLine(market.line) ?? ""];
  if (market.marketType.startsWith("PLAYER_")) terms.push(playerComparisonKey(market.player) ??
    `UNRESOLVED|${JSON.stringify([market.provider, market.providerEventId, market.providerMarketId, market.player ?? null])}`);
  return terms.join("|");
}

/** A full name and oriented team identify a comparison candidate, not an execution registry ID. */
export function sameComparisonPlayer(left: Pick<ProviderMarket, "marketType" | "player">,
  right: Pick<ProviderMarket, "marketType" | "player">): boolean {
  if (!left.marketType.startsWith("PLAYER_") && !right.marketType.startsWith("PLAYER_"))
    return left.player === undefined && right.player === undefined;
  if (!left.marketType.startsWith("PLAYER_") || !right.marketType.startsWith("PLAYER_")) return false;
  const key = playerComparisonKey(left.player);
  return key !== null && key === playerComparisonKey(right.player);
}

export function hasValidComparisonPlayerBinding(cell: ComparisonCell): boolean {
  if (!cell.market.marketType.startsWith("PLAYER_")) return cell.market.player === undefined &&
    cell.quotes.every(quote => quote.player === undefined);
  if (playerComparisonKey(cell.market.player) === null ||
    !cell.quotes.every(quote => sameNativePlayer(cell.market.player, quote.player))) return false;
  const nativeMarket = cell.sourceMarket ?? cell.market;
  const nativeQuotes = cell.sourceQuotes ?? cell.quotes;
  return nativeMarket.player?.providerPlayerId === cell.market.player?.providerPlayerId &&
    nativeMarket.player?.name === cell.market.player?.name &&
    nativeQuotes.every(quote => sameNativePlayer(nativeMarket.player, quote.player)) &&
    cell.quotes.every(quote => nativeQuotes.some(native => native.providerSelectionId === quote.providerSelectionId &&
      native.providerEventId === quote.providerEventId && native.providerMarketId === quote.providerMarketId));
}

function eligibleTwoWayCells(cells: readonly ComparisonCell[], requireSameSettlement = true): readonly ComparisonCell[] {
  const marketType = cells[0]?.market.marketType;
  if (marketType === undefined || marketType === "FT_1X2" || marketType === "FH_1X2") return [];
  const domains = new Map<string, ComparisonCell[]>();
  for (const cell of distinctResultSourceCells(cells)) {
    const selections = exactTwoWayOutcomeDomain(cell.market.marketType, cell.market.scope, cell.market.line)!;
    const signature = [selections.join("|"), requireSameSettlement ? cell.market.settlementProfile : "DISPLAY_ONLY"].join("|");
    const matching = domains.get(signature) ?? [];
    matching.push(cell);
    domains.set(signature, matching);
  }
  return [...domains.values()].map(matching => {
    const pairs = binaryOpposingCellPairs(matching);
    const participating = new Set(pairs.flatMap(pair => [...pair]));
    return matching.filter(cell => participating.has(cell));
  }).filter(matching => matching.length > 0).sort((left, right) =>
    new Set(right.map(cell => cell.provider)).size - new Set(left.map(cell => cell.provider)).size)[0] ?? [];
}

/** Source-market links, not a bookmaker combination count when some offers have one leg. */
export function binaryOpposingCellPairs(cells: readonly ComparisonCell[]): readonly (readonly [ComparisonCell, ComparisonCell])[] {
  const pairs: (readonly [ComparisonCell, ComparisonCell])[] = [];
  for (let left = 0; left < cells.length; left += 1) for (let right = left + 1; right < cells.length; right += 1) {
    const a = cells[left]!, b = cells[right]!;
    const domain = exactTwoWayOutcomeDomain(a.market.marketType, a.market.scope, a.market.line);
    if (a.provider === b.provider || domain === null || a.market.marketType !== b.market.marketType ||
      a.market.scope !== b.market.scope || !sameMarketLine(a.market.line, b.market.line) ||
      a.market.settlementProfile !== b.market.settlementProfile || !sameComparisonPlayer(a.market, b.market) ||
      !hasValidComparisonPlayerBinding(a) || !hasValidComparisonPlayerBinding(b)) continue;
    if (domain.some((selection, index) => a.quotes.some(quote => quote.selection === selection &&
      quote.status === "OPEN" && decimalOdds(quote) !== null) && b.quotes.some(quote =>
        quote.selection === domain[1 - index] && quote.status === "OPEN" && decimalOdds(quote) !== null))) pairs.push([a, b]);
  }
  return pairs;
}

function displayTwoWayCells(cells: readonly ComparisonCell[]): readonly ComparisonCell[] {
  return distinctResultSourceCells(cells.filter(isAvailableTwoWayTicket));
}

export function exactTwoWayOutcomeDomain(marketType: string, scope: string,
  line: string | null): readonly string[] | null {
  const spec = footballBinaryMarketSpec(marketType as MarketType);
  const asianLine = line !== null && /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/u.test(line) &&
    Number.isSafeInteger(Number(line) * 4);
  if (spec !== null && scope === spec.scope &&
    (spec.linePolicy === "NONE" ? line === null : spec.linePolicy === "POSITIVE_INTEGER"
      ? spec.family === "YES_NO" && line !== null && /^[1-9]\d*(?:\.0+)?$/u.test(line) && Number.isSafeInteger(Number(line)) :
      spec.family === "TOTAL" || spec.family === "HANDICAP"
        ? asianLine : isNoPushFootballLine(line))) {
    return [...spec.outcomes].sort();
  }
  if (marketType === "SERIES_WINNER" && scope === "SERIES" && line === null) return ["TEAM_A", "TEAM_B"];
  if (marketType === "MAP_WINNER" && /^MAP_[1-5]$/u.test(scope) && line === null) return ["TEAM_A", "TEAM_B"];
  return null;
}

type OppositionContract = Pick<ComparisonRow, "marketType" | "scope" | "line" | "opposition">;

export function comparisonOutcomeDomain(row: OppositionContract): readonly string[] | null {
  if (row.opposition === undefined) return exactTwoWayOutcomeDomain(row.marketType, row.scope, row.line);
  const spec = footballResultMarketSpec(row.marketType as MarketType);
  return row.opposition.kind === "RESULT_COMPLEMENT" && spec?.family === "RESULT" && spec.scope === row.scope &&
    row.line === null && spec.outcomes.includes(row.opposition.single) && resultComplement(row.opposition.single) === row.opposition.double
    ? [row.opposition.single, row.opposition.double].sort() : null;
}

/** Validates the actual selected native leg; an unrelated missing outcome is not a fabricated quote. */
export function isResultOppositionCell(row: OppositionContract, cell: ComparisonCell): boolean {
  const domain = comparisonOutcomeDomain(row);
  const spec = footballResultMarketSpec(cell.market.marketType);
  if (row.opposition === undefined || domain === null || spec === null || cell.market.category !== "FOOTBALL" ||
    cell.provider !== cell.market.provider || cell.market.scope !== row.scope || cell.market.scope !== spec.scope ||
    cell.market.line !== null || cell.market.status !== "OPEN" ||
    cell.market.settlementProfile !== spec.settlementProfile || cell.quotes.length !== 1) return false;
  const quote = cell.quotes[0]!;
  const selection = spec.family === "RESULT" ? row.opposition.single : row.opposition.double;
  return quote.selection === selection && quote.provider === cell.provider && quote.category === "FOOTBALL" &&
    quote.sequence !== null && quote.sequence !== undefined &&
    quote.providerEventId === cell.market.providerEventId && quote.providerMarketId === cell.market.providerMarketId &&
    quote.marketType === cell.market.marketType && quote.scope === row.scope && quote.line === null &&
    quote.status === "OPEN" && decimalOdds(quote) !== null;
}

/** Only real complementary native source cells can contribute a route. */
export function resultOppositionCellPairs(row: Pick<ComparisonRow, "marketType" | "scope" | "line" | "opposition" | "cells">):
  readonly (readonly [ComparisonCell, ComparisonCell])[] {
  const domain = comparisonOutcomeDomain(row);
  if (row.opposition === undefined || domain === null) return [];
  const eligible = row.cells.filter(cell => isResultOppositionCell(row, cell));
  const unambiguous = distinctResultSourceCells(eligible);
  return unambiguous.filter(cell => cell.quotes[0]!.selection === domain[0]).flatMap(first =>
    unambiguous.filter(second => second.provider !== first.provider && second.quotes[0]!.selection === domain[1] &&
      second.market.settlementProfile === first.market.settlementProfile).map(second => [first, second] as const));
}

export function distinctResultSourceCells(cells: readonly ComparisonCell[]): readonly ComparisonCell[] {
  const players = new Map<string, Set<string>>();
  for (const cell of cells) {
    const playerKey = playerComparisonKey(cell.market.player);
    if (playerKey === null) continue;
    const key = JSON.stringify([cell.provider, cell.market.providerEventId, playerKey]);
    const ids = players.get(key) ?? new Set<string>();
    ids.add(cell.market.player!.providerPlayerId); players.set(key, ids);
  }
  return cells.filter(cell => (players.size === 0 || (players.get(JSON.stringify([cell.provider, cell.market.providerEventId,
    playerComparisonKey(cell.market.player)]))?.size ?? 0) <= 1) && cells.filter(other => other.provider === cell.provider &&
    other.market.providerEventId === cell.market.providerEventId &&
    other.market.providerMarketId === cell.market.providerMarketId).length === 1 &&
    !cells.some(other => other.provider === cell.provider && other.market.providerEventId !== cell.market.providerEventId));
}

function resultOppositionRows(rawCells: readonly ComparisonCell[]): readonly ObservedTicketRow[] {
  const result: ObservedTicketRow[] = [];
  const resultCells = rawCells.filter(cell => footballResultMarketSpec(cell.market.marketType) !== null);
  if (resultCells.length === 0) return result;
  for (const marketType of ["FT_1X2", "FH_1X2", "SH_1X2"] as const) {
    const spec = footballResultMarketSpec(marketType)!;
    for (const single of ["HOME", "DRAW", "AWAY"] as const) {
      const opposition: ResultOpposition = { kind: "RESULT_COMPLEMENT", single,
        double: resultComplement(single) as ResultOpposition["double"] };
      const contract = { marketType, scope: spec.scope, line: null, opposition };
      const candidates = new Map<string, ComparisonCell[]>();
      for (const cell of resultCells) {
        const nativeSpec = footballResultMarketSpec(cell.market.marketType);
        if (nativeSpec === null || nativeSpec.scope !== spec.scope) continue;
        // Reject contradictory or mixed-generation native rows before selecting a leg.
        if (new Set(cell.quotes.map(quote => quote.selection)).size !== cell.quotes.length ||
          new Set(cell.quotes.map(quote => quote.providerSelectionId)).size !== cell.quotes.length ||
          new Set(cell.quotes.map(quote => quote.sequence)).size !== 1 ||
          cell.quotes.some(quote => !nativeSpec.outcomes.includes(quote.selection as never) ||
            quote.provider !== cell.provider || quote.category !== cell.market.category ||
            quote.providerEventId !== cell.market.providerEventId || quote.providerMarketId !== cell.market.providerMarketId ||
            quote.marketType !== cell.market.marketType || quote.scope !== cell.market.scope || quote.line !== null)) continue;
        const selection = nativeSpec.family === "RESULT" ? single : opposition.double;
        const selected = { ...cell, quotes: cell.quotes.filter(quote => quote.selection === selection) };
        if (!isResultOppositionCell(contract, selected)) continue;
        const key = `${cell.provider}|${cell.market.marketType}`;
        candidates.set(key, [...(candidates.get(key) ?? []), selected]);
      }
      const cells = distinctResultSourceCells([...candidates.values()].flat());
      const pairs = resultOppositionCellPairs({ ...contract, cells });
      if (pairs.length === 0) continue;
      const participating = new Set(pairs.flatMap(pair => [...pair]));
      result.push({ ...contract, key: `RESULT_COMPLEMENT|${spec.scope}|${single}|${opposition.double}`,
        settlementProfile: spec.settlementProfile, outcomeDomain: [single, opposition.double].sort(),
        cells: cells.filter(cell => participating.has(cell)) });
    }
  }
  return result;
}

export interface TwoWaySettlementCase {
  readonly kind: "FIRST_WINS" | "SECOND_WINS" | "PUSH" | "SPLIT";
  /** For each canonical outcome: stake fraction won, then fraction refunded. */
  readonly factors: readonly [readonly [number, number], readonly [number, number]];
}

export function twoWaySettlementCases(marketType: string, scope: string,
  line: string | null): readonly TwoWaySettlementCase[] | null {
  if (exactTwoWayOutcomeDomain(marketType, scope, line) === null) return null;
  const extremes: readonly TwoWaySettlementCase[] = [
    { kind: "FIRST_WINS", factors: [[1, 0], [0, 0]] },
    { kind: "SECOND_WINS", factors: [[0, 0], [1, 0]] }
  ];
  if (line === null || isNoPushFootballLine(line) ||
    footballBinaryMarketSpec(marketType as MarketType)?.linePolicy === "POSITIVE_INTEGER") return extremes;
  const value = Number(line);
  if (Number.isInteger(value)) return [...extremes, { kind: "PUSH", factors: [[0, 1], [0, 1]] }];
  const spec = footballBinaryMarketSpec(marketType as MarketType);
  const fraction = Math.abs(value) % 1;
  // Canonical TOTAL order is OVER, UNDER; HANDICAP order is AWAY, HOME.
  const firstHalfWin = spec?.family === "TOTAL" ? fraction === 0.75
    : !((fraction === 0.25 && value > 0) || (fraction === 0.75 && value < 0));
  return [...extremes, { kind: "SPLIT", factors: firstHalfWin
    ? [[0.5, 0.5], [0, 0.5]] : [[0, 0.5], [0.5, 0.5]] }];
}

export function comparisonSettlementCases(row: OppositionContract): readonly TwoWaySettlementCase[] | null {
  if (row.opposition === undefined) return twoWaySettlementCases(row.marketType, row.scope, row.line);
  return comparisonOutcomeDomain(row) === null ? null : [
    { kind: "FIRST_WINS", factors: [[1, 0], [0, 0]] },
    { kind: "SECOND_WINS", factors: [[0, 0], [1, 0]] }
  ];
}

function settlementMargin(marketType: string, scope: string, line: string | null,
  odds: readonly number[]): number | null {
  const scenarios = twoWaySettlementCases(marketType, scope, line);
  if (scenarios === null || odds.length !== 2) return null;
  const payouts = scenarios.map(({ factors }) => factors.map(([won, refunded], index) =>
    won * odds[index]! + refunded));
  const fractions = [0, 1];
  for (let i = 0; i < payouts.length; i += 1) for (let j = i + 1; j < payouts.length; j += 1) {
    const a = payouts[i]!; const b = payouts[j]!;
    const denominator = a[0]! - a[1]! - b[0]! + b[1]!;
    if (denominator === 0) continue;
    const fraction = (b[1]! - a[1]!) / denominator;
    if (fraction >= 0 && fraction <= 1) fractions.push(fraction);
  }
  const margin = Math.max(...fractions.map(fraction => Math.min(...payouts.map(payout =>
    fraction * payout[0]! + (1 - fraction) * payout[1]!)))) - 1;
  // Display arithmetic is binary floating point; an exact zero must not become
  // a profit badge. The constrained stake plan uses Decimal settlement math.
  return Math.abs(margin) < 1e-12 ? 0 : margin;
}

function sameMarketLine(left: string | null, right: string | null): boolean {
  if (left === null || right === null) return left === right;
  const leftValue = Number(left);
  const rightValue = Number(right);
  return Number.isFinite(leftValue) && Number.isFinite(rightValue) && leftValue === rightValue;
}

export function isFocusedTwoWayTicket(cell: ComparisonCell): boolean {
  const expectedDomain = exactTwoWayOutcomeDomain(cell.market.marketType, cell.market.scope, cell.market.line);
  return expectedDomain !== null && cell.quotes.length === expectedDomain.length &&
    availableTwoWayCell(cell)?.quotes.length === expectedDomain.length;
}

export function isAvailableTwoWayTicket(cell: ComparisonCell): boolean {
  return availableTwoWayCell(cell) !== null;
}

function availableTwoWayCell(cell: ComparisonCell): ComparisonCell | null {
  const expectedDomain = exactTwoWayOutcomeDomain(cell.market.marketType, cell.market.scope, cell.market.line);
  if (expectedDomain === null || cell.market.status !== "OPEN" || cell.quotes.length === 0 ||
    cell.quotes.length > expectedDomain.length) return null;
  // Number-based display canonicalization must not turn a fractional source threshold into an integer predicate.
  if (footballBinaryMarketSpec(cell.market.marketType)?.linePolicy === "POSITIVE_INTEGER" &&
    [cell.market, cell.sourceMarket ?? cell.market, ...cell.quotes, ...(cell.sourceQuotes ?? [])].some(item =>
      exactTwoWayOutcomeDomain(item.marketType, item.scope, item.line) === null)) return null;
  const expectedCategory = cell.market.marketType === "SERIES_WINNER" || cell.market.marketType === "MAP_WINNER"
    ? "LOL" : "FOOTBALL";
  if (cell.market.provider !== cell.provider || cell.market.category !== expectedCategory ||
    !hasValidComparisonPlayerBinding(cell)) return null;
  const selections = cell.quotes.map((quote) => quote.selection);
  if (new Set(selections).size !== selections.length || selections.some(selection => !expectedDomain.includes(selection))) return null;
  const selectionIds = cell.quotes.map((quote) => quote.providerSelectionId);
  if (new Set(selectionIds).size !== selectionIds.length) return null;
  const generation = cell.quotes[0]?.sequence ?? null;
  if (generation === null || !cell.quotes.every((quote) => quote.sequence === generation)) return null;
  if (!cell.quotes.every((quote) => quote.provider === cell.provider &&
    quote.category === cell.market.category && quote.providerEventId === cell.market.providerEventId &&
    quote.providerMarketId === cell.market.providerMarketId && quote.marketType === cell.market.marketType &&
    quote.scope === cell.market.scope && sameMarketLine(quote.line, cell.market.line))) return null;
  const quotes = cell.quotes.filter(quote => quote.status === "OPEN");
  return quotes.length === 0 ? null : quotes.length === cell.quotes.length ? cell
    : { ...cell, quotes, sourceQuotes: cell.sourceQuotes ?? cell.quotes };
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
  if (quote.rawFormat === "AMERICAN") {
    if (Math.abs(value) < 100) return null;
    return value > 0 ? 1 + value / 100 : 1 + 100 / Math.abs(value);
  }
  if (quote.rawFormat === "MALAY") {
    if (value === 0 || Math.abs(value) > 1) return null;
    return value > 0 ? 1 + value : 1 + 1 / Math.abs(value);
  }
  return null;
}

export function selectionLabel(event: ProviderEvent, selection: string): string {
  if (selection === "DRAW") return "Hòa";
  if (selection === "HOME_DRAW") return `${event.participantA} hoặc hòa`;
  if (selection === "HOME_AWAY") return `${event.participantA} hoặc ${event.participantB}`;
  if (selection === "DRAW_AWAY") return `Hòa hoặc ${event.participantB}`;
  if (selection === "TEAM_A" || selection === "HOME") return event.participantA;
  if (selection === "TEAM_B" || selection === "AWAY") return event.participantB;
  if (selection === "OVER") return "Over";
  if (selection === "UNDER") return "Under";
  if (selection === "ODD") return "Odd";
  if (selection === "EVEN") return "Even";
  if (selection === "YES") return "Yes";
  if (selection === "NO") return "No";
  return selection;
}

export function ticketMarketLabel(marketType: string): string {
  if (marketType === "FT_1X2") return "1X2 cả trận";
  if (marketType === "FH_1X2") return "1X2 hiệp 1";
  if (marketType === "SH_1X2") return "1X2 hiệp 2";
  if (marketType === "FT_AH") return "Full-time handicap";
  if (marketType === "FT_TOTAL") return "Full-time total";
  if (marketType === "SERIES_WINNER") return "Series winner";
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
  if (marketType === "FT_ODD_EVEN") return "Full-time goals odd/even";
  if (marketType === "FH_ODD_EVEN") return "First-half goals odd/even";
  if (marketType === "SH_ODD_EVEN") return "Second-half goals odd/even";
  if (marketType === "CORNER_FT_ODD_EVEN") return "Full-time corners odd/even";
  if (marketType === "CORNER_FH_ODD_EVEN") return "First-half corners odd/even";
  if (marketType === "FT_BTTS") return "Both teams to score";
  if (marketType === "FT_BOTH_TEAMS_SCORE_BOTH_HALVES") return "Cả hai đội ghi bàn ở cả hai hiệp";
  if (marketType === "FH_BTTS") return "First-half both teams to score";
  if (marketType === "SH_BTTS") return "Second-half both teams to score";
  if (marketType === "SENDING_OFF") return "Sending off";
  if (marketType === "HOME_CORNER_FT_TOTAL") return "Home team corner total";
  if (marketType === "HOME_CORNER_FH_TOTAL") return "First-half home team corner total";
  if (marketType === "AWAY_CORNER_FT_TOTAL") return "Away team corner total";
  if (marketType === "AWAY_CORNER_FH_TOTAL") return "First-half away team corner total";
  if (marketType === "HOME_FT_SCORE_BOTH_HALVES") return "Home team to score in both halves";
  if (marketType === "AWAY_FT_SCORE_BOTH_HALVES") return "Away team to score in both halves";
  if (marketType === "HOME_FT_WIN_BOTH_HALVES") return "Home team to win both halves";
  if (marketType === "AWAY_FT_WIN_BOTH_HALVES") return "Away team to win both halves";
  if (marketType === "HOME_FT_WIN_EITHER_HALF") return "Home team to win either half";
  if (marketType === "AWAY_FT_WIN_EITHER_HALF") return "Away team to win either half";
  if (marketType === "HOME_FT_ODD_EVEN") return "Home team goals odd/even";
  if (marketType === "AWAY_FT_ODD_EVEN") return "Away team goals odd/even";
  if (marketType === "HOME_FT_WIN_TO_NIL") return "Home team to win to nil";
  if (marketType === "AWAY_FT_WIN_TO_NIL") return "Away team to win to nil";
  if (marketType === "HOME_FT_CLEAN_SHEET") return "Home team clean sheet";
  if (marketType === "AWAY_FT_CLEAN_SHEET") return "Away team clean sheet";
  if (marketType === "FT_BOTH_HALVES_OVER_TOTAL") return "Both halves over total";
  if (marketType === "FT_BOTH_HALVES_UNDER_TOTAL") return "Both halves under total";
  if (marketType === "HOME_FT_TOTAL") return "Home team total";
  if (marketType === "AWAY_FT_TOTAL") return "Away team total";
  if (marketType === "HOME_FH_TOTAL") return "Home team total 1H";
  if (marketType === "AWAY_FH_TOTAL") return "Away team total 1H";
  if (marketType === "HOME_FT_TO_WIN") return "Home team to win";
  if (marketType === "AWAY_FT_TO_WIN") return "Away team to win";
  if (marketType === "FT_ANY_TEAM_TO_WIN") return "Either team to win";
  if (marketType === "YELLOW_CARD_FT_TOTAL") return "Yellow-card total";
  return marketType;
}

export function observedTicketAsComparisonRow(ticket: ObservedTicketRow): ComparisonRow {
  if (ticket.opposition !== undefined) {
    const pairs = resultOppositionCellPairs(ticket).map(([first, second]) => {
      const margin = 1 / (1 / decimalOdds(first.quotes[0]!)! + 1 / decimalOdds(second.quotes[0]!)!) - 1;
      return { first, second, margin: Math.abs(margin) < 1e-12 ? 0 : margin };
    }).sort((left, right) => right.margin - left.margin || compareProviders(left.first.provider, right.first.provider) ||
      compareProviders(left.second.provider, right.second.provider));
    const best = pairs[0];
    return { key: ticket.key, marketType: ticket.marketType, scope: ticket.scope, line: ticket.line,
      opposition: ticket.opposition, cells: ticket.cells, crossBook: best !== undefined, margin: best?.margin ?? null,
      bestBySelection: best === undefined ? {} : {
        [best.first.quotes[0]!.selection]: best.first.provider, [best.second.quotes[0]!.selection]: best.second.provider } };
  }
  if (ticket.cells.some(cell => cell.quotes.length < 2) || new Set(ticket.cells.map(cell => cell.provider)).size < ticket.cells.length) {
    const candidates = binaryOpposingCellPairs(ticket.cells).flatMap(([a, b]) => ticket.outcomeDomain.flatMap((selection, index) => {
      const first = a.quotes.find(quote => quote.selection === selection),
        second = b.quotes.find(quote => quote.selection === ticket.outcomeDomain[1 - index]);
      const firstOdds = first === undefined ? null : decimalOdds(first), secondOdds = second === undefined ? null : decimalOdds(second);
      if (firstOdds === null || secondOdds === null) return [];
      const odds = index === 0 ? [firstOdds, secondOdds] : [secondOdds, firstOdds];
      const margin = settlementMargin(ticket.marketType, ticket.scope, ticket.line, odds);
      return margin === null ? [] : [{ margin, bestBySelection: { [selection]: a.provider,
        [ticket.outcomeDomain[1 - index]!]: b.provider } }];
    })).sort((a, b) => b.margin - a.margin);
    const best = candidates[0];
    return { key: ticket.key, marketType: ticket.marketType, scope: ticket.scope, line: ticket.line, cells: ticket.cells,
      bestBySelection: best?.bestBySelection ?? {}, crossBook: best !== undefined, margin: best?.margin ?? null };
  }
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
  const margin = bestOdds.length === 2 && bestOdds.every((value): value is number => value !== null)
    ? settlementMargin(ticket.marketType, ticket.scope, ticket.line, bestOdds) : null;
  const crossBook = new Set(Object.values(bestBySelection)).size >= 2;
  return { key: ticket.key, marketType: ticket.marketType, scope: ticket.scope, line: ticket.line,
    cells: ticket.cells, bestBySelection, crossBook,
    margin: crossBook ? margin : null };
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
  competitionMemory?: CompetitionLinkMemory,
  options: { readonly playerComparisonsOnly?: boolean } = {}): readonly ComparisonEvent[] {
  const orderedCatalogs = sortProviderItems(withScheduledPhase(catalogs), (catalog) => catalog.provider,
    (left, right) => left.accountId.localeCompare(right.accountId));
  const catalogIndexes = new Map<LiveCatalogResponse, {
    readonly marketsByEvent: ReadonlyMap<string, readonly ProviderMarket[]>;
    readonly quotesByMarket: ReadonlyMap<string, readonly ProviderQuote[]>;
    readonly quotedEventIds: ReadonlySet<string>;
    readonly ambiguousPlayers: ReadonlySet<string>;
  }>();
  // Native market identifiers can be local to a fixture (observed in APSPORT).
  const nativeMarketKey = (eventId: string, marketId: string): string =>
    JSON.stringify([eventId, marketId]);
  // This conservative worker-only precheck cannot remove a possible route:
  // matching player markets must first share a type at two distinct books.
  // Keep the source inventories and the default detail projection complete.
  const playerProvidersByType = new Map<MarketType, Set<ProviderId>>();
  for (const catalog of orderedCatalogs) {
    const marketsByEvent = new Map<string, ProviderMarket[]>();
    for (const market of catalog.markets) {
      const values = marketsByEvent.get(market.providerEventId) ?? [];
      values.push(market);
      marketsByEvent.set(market.providerEventId, values);
    }
    const quotesByMarket = new Map<string, ProviderQuote[]>();
    const quotedEventIds = new Set<string>();
    for (const quote of catalog.quotes) {
      quotedEventIds.add(quote.providerEventId);
      const quoteKey = nativeMarketKey(quote.providerEventId, quote.providerMarketId);
      const values = quotesByMarket.get(quoteKey) ?? [];
      values.push(quote);
      quotesByMarket.set(quoteKey, values);
    }
    const playerIds = new Map<string, Set<string>>();
    for (const market of catalog.markets) {
      if (options.playerComparisonsOnly && market.marketType.startsWith("PLAYER_")) {
        const providers = playerProvidersByType.get(market.marketType) ?? new Set<ProviderId>();
        providers.add(catalog.provider);
        playerProvidersByType.set(market.marketType, providers);
      }
      const playerKey = playerComparisonKey(market.player);
      if (playerKey === null) continue;
      const key = JSON.stringify([market.providerEventId, playerKey]);
      const ids = playerIds.get(key) ?? new Set<string>();
      ids.add(market.player!.providerPlayerId); playerIds.set(key, ids);
    }
    const ambiguousPlayers = new Set([...playerIds].filter(([, ids]) => ids.size > 1).map(([key]) => key));
    catalogIndexes.set(catalog, { marketsByEvent, quotesByMarket, quotedEventIds, ambiguousPlayers });
  }
  type EventProjection = { readonly catalog: LiveCatalogResponse; readonly event: ProviderEvent;
    readonly family: ComparisonMarketFamily };
  const projections: EventProjection[] = [];
  for (const catalog of orderedCatalogs) {
    const index = catalogIndexes.get(catalog)!;
    for (const event of catalog.events) {
      // A roster entry with no markets or quotes cannot claim a pairing slot.
      // Keep incomplete market/quote records subject to the ambiguity guard.
      const eventMarkets = index.marketsByEvent.get(event.providerEventId) ?? [];
      if (eventMarkets.length === 0 && !index.quotedEventIds.has(event.providerEventId)) continue;
      if (event.category === "LOL") {
        projections.push({ catalog, event, family: "ESPORTS" });
        continue;
      }
      const families = eventMarkets.length === 0 ? ["GOALS" as const]
        : [...new Set(eventMarkets.map((market) => footballMarketFamily(market.marketType)))];
      for (const family of families) projections.push({ catalog, event, family });
    }
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
  const identityKey = (provider: ProviderId, event: ProviderEvent, family: ComparisonMarketFamily): string =>
    [provider, event.category, family, event.isLive ? "LIVE" : String(event.startAtUtcMs),
      event.category === "FOOTBALL" && family !== "ESPORTS"
        ? competitionIdentityForFamily(event.competition, family)
        : competitionIdentity(event.competition), unorderedParticipantKey(event)].join("|");
  const identityCounts = new Map<string, number>();
  for (const { catalog, event, family } of projections) {
    const key = identityKey(catalog.provider, event, family);
    identityCounts.set(key, (identityCounts.get(key) ?? 0) + 1);
  }
  const ambiguous = (catalog: LiveCatalogResponse, event: ProviderEvent,
    family: ComparisonMarketFamily): boolean =>
    (identityCounts.get(identityKey(catalog.provider, event, family)) ?? 0) > 1;
  type MutableEventGroup = { key: string; event: ProviderEvent; catalogs: LiveCatalogResponse[];
    family: ComparisonMarketFamily;
    ids: Partial<Record<ProviderId, string>>; orientations: Partial<Record<ProviderId, EventOrientation>>;
    sourceEvents: Partial<Record<ProviderId, ProviderEvent>> };
  const groups: MutableEventGroup[] = [];
  const groupsByParticipants = new Map<string, MutableEventGroup[]>();
  const footballGroupsByCandidate = new Map<string, MutableEventGroup[]>();
  for (const { catalog, event, family } of projections) {
      let orientation: EventOrientation | null = null;
      const participantKey = [event.category, family, event.isLive ? "LIVE" : "PREMATCH",
        unorderedParticipantKey(event)].join("|");
      const exactCandidates = groupsByParticipants.get(participantKey) ?? [];
      // An exact spelling can still belong to another competition or kickoff.
      // Consider every candidate before applying identity and ambiguity gates.
      const candidatePool = [...new Set([...exactCandidates,
        ...footballCandidateLookupKeys(event, competitionLinks, family)
          .flatMap((key) => footballGroupsByCandidate.get(key) ?? [])])];
      const matches = candidatePool.flatMap((candidate) => {
        if (candidate.family !== family || candidate.ids[catalog.provider] !== undefined ||
          ambiguous(catalog, event, family) || candidate.catalogs.some((source) =>
            ambiguous(source, candidate.sourceEvents[source.provider] ?? candidate.event, family))) return [];
        const candidateOrientation = compatibleEventOrientation(candidate.event, event, family, competitionLinks);
        return candidateOrientation === null ? [] : [{ candidate, orientation: candidateOrientation }];
      });
      let group = matches.length === 1 ? matches[0]!.candidate : undefined;
      orientation = matches.length === 1 ? matches[0]!.orientation : null;
      if (group === undefined) {
        orientation = "SAME";
        group = { key: `${eventKey(event)}|family:${family}`, event: displayEvent(event), family,
          catalogs: [], ids: {}, orientations: {}, sourceEvents: {} };
        groups.push(group);
        groupsByParticipants.set(participantKey, [...(groupsByParticipants.get(participantKey) ?? []), group]);
        const candidateKey = footballCandidateIndexKey(event, competitionLinks, family);
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
  // Name compatibility need not be transitive: "Huracan" matches both
  // "Huracan (ARG)" and "Club Atletico Huracan", which do not match each other.
  // Preserve missing direct relations without inventing a three-book identity.
  // A relation must be unique in both directions for the opposing provider;
  // competing fixtures from that provider remain ambiguous and are withheld.
  const relationKey = (family: ComparisonMarketFamily,
    sources: readonly (readonly [ProviderId, string])[]): string =>
    JSON.stringify([family, [...sources].sort(([ap, ae], [bp, be]) =>
      compareProviders(ap, bp) || ae.localeCompare(be))]);
  const existingRelations = new Set<string>();
  for (const group of groups) {
    const sources = group.catalogs.map(catalog =>
      [catalog.provider, group.ids[catalog.provider]!] as const);
    for (let left = 0; left < sources.length; left += 1) for (let right = left + 1; right < sources.length; right += 1) {
      existingRelations.add(relationKey(group.family, [sources[left]!, sources[right]!]));
    }
  }
  const projectionsByExact = new Map<string, EventProjection[]>();
  const projectionsByCandidate = new Map<string, EventProjection[]>();
  const relations: { left: EventProjection; right: EventProjection; orientation: EventOrientation }[] = [];
  const peers = new Map<EventProjection, Map<ProviderId, EventProjection[]>>();
  const recordPeer = (source: EventProjection, peer: EventProjection): void => {
    const counts = peers.get(source) ?? new Map<ProviderId, EventProjection[]>();
    const providerPeers = counts.get(peer.catalog.provider) ?? [];
    providerPeers.push(peer);
    counts.set(peer.catalog.provider, providerPeers);
    peers.set(source, counts);
  };
  for (const projection of projections) {
    const { catalog, event, family } = projection;
    if (event.category !== "FOOTBALL" || event.isLive || ambiguous(catalog, event, family)) continue;
    const exactKey = [family, event.isLive ? "LIVE" : "PREMATCH", unorderedParticipantKey(event)].join("|");
    const candidates = new Set([...(projectionsByExact.get(exactKey) ?? []),
      ...footballCandidateLookupKeys(event, competitionLinks, family)
        .flatMap(key => projectionsByCandidate.get(key) ?? [])]);
    for (const other of candidates) {
      if (other.catalog.provider === catalog.provider) continue;
      const orientation = compatibleEventOrientation(other.event, event, family, competitionLinks);
      if (orientation === null) continue;
      relations.push({ left: other, right: projection, orientation });
      recordPeer(other, projection);
      recordPeer(projection, other);
    }
    const exact = projectionsByExact.get(exactKey) ?? [];
    exact.push(projection);
    projectionsByExact.set(exactKey, exact);
    const candidateKey = footballCandidateIndexKey(event, competitionLinks, family);
    if (candidateKey !== null) {
      const candidates = projectionsByCandidate.get(candidateKey) ?? [];
      candidates.push(projection);
      projectionsByCandidate.set(candidateKey, candidates);
    }
  }
  const supplementalKeys = new Set<string>();
  const consistentEvidence = new Map<EventProjection, boolean>();
  const hasConsistentEvidence = (source: EventProjection): boolean => {
    const cached = consistentEvidence.get(source);
    if (cached !== undefined) return cached;
    const events = [source, ...[...(peers.get(source)?.values() ?? [])].flat()].map(item => item.event);
    const kickoffs = events.map(event => event.startAtUtcMs);
    const discriminators = new Set(events.map(event => event.fixtureDiscriminator).filter(value => value !== null));
    const consistent = Math.max(...kickoffs) - Math.min(...kickoffs) <= FOOTBALL_KICKOFF_TOLERANCE_MS &&
      discriminators.size <= 1;
    consistentEvidence.set(source, consistent);
    return consistent;
  };
  for (const { left, right, orientation } of relations) {
    const lp = left.catalog.provider, rp = right.catalog.provider;
    if (peers.get(left)?.get(rp)?.length !== 1 || peers.get(right)?.get(lp)?.length !== 1 ||
      !hasConsistentEvidence(left) || !hasConsistentEvidence(right)) continue;
    const key = relationKey(left.family, [[lp, left.event.providerEventId], [rp, right.event.providerEventId]]);
    if (existingRelations.has(key)) continue;
    existingRelations.add(key);
    const groupKey = `source-relation:${key}`;
    supplementalKeys.add(groupKey);
    groups.push({ key: groupKey, event: displayEvent(left.event), family: left.family,
      catalogs: [left.catalog, right.catalog],
      ids: { [lp]: left.event.providerEventId, [rp]: right.event.providerEventId },
      orientations: { [lp]: "SAME", [rp]: orientation },
      sourceEvents: { [lp]: left.event, [rp]: right.event } });
  }
  return groups.map((group) => {
    const key = group.key;
    const rowGroups = new Map<string, ComparisonCell[]>();
    for (const catalog of group.catalogs) {
      const providerEventId = group.ids[catalog.provider];
      const index = catalogIndexes.get(catalog)!;
      for (const market of index.marketsByEvent.get(providerEventId ?? "") ?? []) {
        if (options.playerComparisonsOnly && market.marketType.startsWith("PLAYER_") &&
          (playerProvidersByType.get(market.marketType)?.size ?? 0) < 2) continue;
        // Source inventory remains in the catalog; ambiguous names cannot establish a comparison route.
        if (index.ambiguousPlayers.size > 0 &&
          index.ambiguousPlayers.has(JSON.stringify([market.providerEventId, playerComparisonKey(market.player)]))) continue;
        const marketFamily: ComparisonMarketFamily = market.category === "LOL"
          ? "ESPORTS" : footballMarketFamily(market.marketType);
        if (marketFamily !== group.family) continue;
        const orientation = group.orientations[catalog.provider] ?? "SAME";
        const orientedMarket = orientMarket(market, orientation);
        const rowKey = marketKey(orientedMarket);
        const cells = rowGroups.get(rowKey) ?? [];
        const phaseQuotes = (index.quotesByMarket.get(nativeMarketKey(market.providerEventId, market.providerMarketId)) ?? [])
          .filter((quote) => quote.isLive === group.event.isLive);
        const sourceCell = { provider: catalog.provider, market: orientedMarket,
          quotes: orientQuotes(phaseQuotes, orientation), sourceEvent: group.sourceEvents[catalog.provider]!,
          sourceMarket: market, sourceQuotes: phaseQuotes };
        cells.push(availableTwoWayCell(sourceCell) ?? sourceCell);
        rowGroups.set(rowKey, cells);
        for (const equivalent of footballComparisonEquivalents(sourceCell)) {
          const equivalentKey = marketKey(equivalent.market);
          const equivalentCells = rowGroups.get(equivalentKey) ?? [];
          equivalentCells.push(availableTwoWayCell(equivalent) ?? equivalent);
          rowGroups.set(equivalentKey, equivalentCells);
        }
      }
    }
    const resultRows = resultOppositionRows([...rowGroups.values()].flat());
    // More than one settlement contract can each have a valid cross-book pair.
    // Keep those independent rows; selecting the largest cluster loses the rest.
    // A lone compatible cluster keeps its existing display/key behavior.
    const rowEntries = [...rowGroups.entries()].flatMap(([rowKey, rawCells]): [string, readonly ComparisonCell[]][] => {
      const profiles = new Map<string, ComparisonCell[]>();
      for (const cell of rawCells) {
        const profile = cell.market.settlementProfile;
        const cells = profiles.get(profile) ?? [];
        cells.push(cell);
        profiles.set(profile, cells);
      }
      if (profiles.size < 2 || [...profiles.values()].filter(cells =>
        eligibleTwoWayCells(cells.filter(isAvailableTwoWayTicket)).length >= 2).length < 2) return [[rowKey, rawCells]];
      return [...profiles.entries()].map(([profile, cells]) => [`${rowKey}|settlement:${JSON.stringify(profile)}`, cells]);
    });
    const observedRows: ObservedTicketRow[] = rowEntries.flatMap(([rowKey, rawCells]) => {
      const cells = displayTwoWayCells(rawCells);
      if (cells.length === 0) return [];
      const outcomeDomain = exactTwoWayOutcomeDomain(cells[0]!.market.marketType, cells[0]!.market.scope, cells[0]!.market.line)!;
      return [{ key: rowKey, marketType: cells[0]!.market.marketType, scope: cells[0]!.market.scope,
        line: cells[0]!.market.line, settlementProfile: cells[0]!.market.settlementProfile,
        outcomeDomain, cells } satisfies ObservedTicketRow];
    }).sort((left, right) => left.key.localeCompare(right.key));
    observedRows.push(...resultRows);
    const rows = rowEntries.map(([rowKey, rawCells]) =>
      [rowKey, eligibleTwoWayCells(rawCells.filter(isAvailableTwoWayTicket))] as const)
      .filter(([, cells]) => cells.length >= 2).map(([rowKey, cells]): ComparisonRow => observedTicketAsComparisonRow({
        key: rowKey, marketType: cells[0]!.market.marketType, scope: cells[0]!.market.scope,
        line: cells[0]!.market.line, settlementProfile: cells[0]!.market.settlementProfile,
        outcomeDomain: exactTwoWayOutcomeDomain(cells[0]!.market.marketType, cells[0]!.market.scope, cells[0]!.market.line)!, cells
      })).concat(resultRows.map(observedTicketAsComparisonRow)).sort((left, right) => (right.margin ?? Number.NEGATIVE_INFINITY) - (left.margin ?? Number.NEGATIVE_INFINITY) || left.key.localeCompare(right.key));
    const bestMargin = rows.reduce<number | null>((best, row) => row.margin === null ? best : Math.max(best ?? row.margin, row.margin), null);
    return { key, event: group.event, providers: group.catalogs.map((catalog) => catalog.provider),
      catalogs: group.catalogs, providerEventIds: group.ids, observedRows, rows, bestMargin };
  }).filter(group => !supplementalKeys.has(group.key) || group.rows.length > 0)
    .sort((left, right) => (right.bestMargin ?? Number.NEGATIVE_INFINITY) - (left.bestMargin ?? Number.NEGATIVE_INFINITY) ||
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
