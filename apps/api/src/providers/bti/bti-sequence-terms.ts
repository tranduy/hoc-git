import type { MarketType } from "@tool-chenh/contracts";
import type { BtiNamedSelection } from "./bti-categorical-terms.js";

export interface BtiSequenceTerms {
  readonly marketType: MarketType;
  readonly selection: string;
  readonly lineText: string | null;
}

const terms = (marketType: MarketType, selection: string, lineText: string | null = null): BtiSequenceTerms =>
  ({ marketType, selection, lineText });
const key = (value: string): string => value.normalize("NFD").replace(/[\u0300-\u036f]/gu, "")
  .replace(/đ/giu, "d").toLocaleLowerCase("en").replace(/[^a-z0-9]+/gu, " ").trim();
const yesNo = (value: string): "YES" | "NO" | null => /^(?:co|yes)$/u.test(key(value)) ? "YES"
  : /^(?:khong|no)$/u.test(key(value)) ? "NO" : null;
const namedTeam = (value: string, teams?: readonly [string, string]): "HOME" | "AWAY" | null => {
  if (teams === undefined) return null;
  const home = key(value) === key(teams[0]), away = key(value) === key(teams[1]);
  return home === away ? null : home ? "HOME" : "AWAY";
};
const namedSubject = (label: string, teams?: readonly [string, string]) =>
  label.includes(":") ? namedTeam(label.slice(0, label.indexOf(":")), teams) : null;

const races: Readonly<Record<string, readonly [MarketType, number, "GOALS" | "CORNERS", boolean]>> = {
  QA4460: ["FT_GOAL_RACE", 2, "GOALS", false], QA4461: ["FT_GOAL_RACE", 3, "GOALS", false],
  QA4462: ["FT_GOAL_RACE", 4, "GOALS", false], QA4463: ["FT_GOAL_RACE", 5, "GOALS", false],
  QA4464: ["FT_GOAL_RACE", 6, "GOALS", false],
  QA1473: ["CORNER_FT_RACE", 3, "CORNERS", false], QA1474: ["CORNER_FT_RACE", 5, "CORNERS", false],
  QA1475: ["CORNER_FT_RACE", 7, "CORNERS", false], QA1476: ["CORNER_FT_RACE", 9, "CORNERS", false],
  QA5089: ["CORNER_FT_RACE", 11, "CORNERS", false],
  QA5090: ["CORNER_FH_RACE", 3, "CORNERS", true], QA5091: ["CORNER_FH_RACE", 5, "CORNERS", true]
};
const goalTeam: Readonly<Record<string, readonly [MarketType, MarketType, RegExp]>> = {
  ML235: ["FT_FIRST_GOAL_TEAM", "FT_TOTAL", /\b(?:doi dau tien ghi ban|first team to score)\b/u],
  ML20: ["FT_LAST_GOAL_TEAM", "FT_TOTAL", /\b(?:ghi ban cuoi|last team to score)\b/u],
  ML5188: ["FH_FIRST_GOAL_TEAM", "FH_TOTAL", /\b(?:ghi ban truoc hiep 1|first half first team to score)\b/u],
  ML6073: ["SH_FIRST_GOAL_TEAM", "SH_TOTAL", /\b(?:ghi ban truoc hiep 2|second half first team to score)\b/u]
};
const binary: Readonly<Record<string, readonly [MarketType, RegExp]>> = {
  QA698: ["FT_OWN_GOAL", /\b(?:ban thang phan luoi nha|own goal)\b/u],
  QA4977: ["FT_PENALTY_AWARDED", /\b(?:co phat den duoc trao|penalty awarded)\b/u],
  QA6012: ["FH_PENALTY_AWARDED", /\b(?:co phat den hiep 1|first half penalty awarded)\b/u],
  QA5012: ["FT_BOTH_TEAMS_PENALTY_AWARDED", /\b(?:ca hai doi duoc huong phat den|both teams awarded a penalty)\b/u]
};
const positiveTeam: Readonly<Record<string, readonly [string, RegExp]>> = {
  QA701: ["FT_COMEBACK_WIN", /\b(?:thang loi nguoc dong|comeback win)\b/u],
  QA6015: ["FT_SCORE_PENALTY", /\b(?:doi ghi ban tu phat den|team to score a penalty)\b/u],
  QA6016: ["FT_MISS_PENALTY", /\b(?:doi da hong phat den|team to miss a penalty)\b/u]
};
export const btiSequenceCodes = new Set([
  ...Object.keys(races), ...Object.keys(goalTeam), ...Object.keys(binary), ...Object.keys(positiveTeam),
  "QA4448", "QA4450", "QA65", "QA6017", "QA6018", "QA6053", "QA5088",
  "QA6036", "QA5614", "QA5617", "QA5521", "QA5522", "OU4620", "QA1447", "QA6011",
  "QA5108", "QA5516", "QA6037"
]);

function sideAndYesNo(suffix: string, item: BtiNamedSelection): "YES" | "NO" | null {
  const outcome = yesNo(item.name);
  return outcome !== null && suffix === (outcome === "YES" ? "Q0Q1" : "Q0Q0") &&
    item.side === (outcome === "YES" ? 1 : 3) ? outcome : null;
}
function seconds(minutes: string, remainder: string): number | null {
  const value = Number(minutes) * 60 + Number(remainder);
  return Number.isSafeInteger(value) && value >= 0 && value <= 86_400 && Number(remainder) < 60 ? value : null;
}

/** Native ID suffixes and labels jointly establish these sequence predicates.
 * A missing native complement never becomes an invented YES/NO quote. */
export function decodeBtiSequenceTerms(code: string, marketId: string, item: BtiNamedSelection,
  label: string, teams?: readonly [string, string]): BtiSequenceTerms | null {
  if (!btiSequenceCodes.has(code) || marketId === "" || !item.id.startsWith(marketId)) return null;
  const suffix = item.id.slice(marketId.length), name = key(item.name), evidence = key(label);
  if (code === "OU4620") {
    if (item.lineWasMissing || item.line !== 0.5 || !/\bban thang trong 10 phut dau\b/u.test(evidence) ||
      !/\b00:00\s*-\s*09:59\b/u.test(label)) return null;
    if (suffix === "OMM" && item.side === 1 && /^(?:tai|over)$/u.test(name)) return terms("FT_FIRST_GOAL_BEFORE", "YES", "600");
    if (suffix === "UMM" && item.side === 3 && /^(?:xiu|under)$/u.test(name)) return terms("FT_FIRST_GOAL_BEFORE", "NO", "600");
    return null;
  }
  if (!item.lineWasMissing && item.line !== 0) return null;

  if (code === "QA4448" || code === "QA4450") {
    const subject = code === "QA4450" ? namedSubject(label, teams) : null;
    if (code === "QA4450" && subject === null || !(code === "QA4448"
      ? /\b(?:hiep ghi ban thang dau|first scoring half)\b/u : /\b(?:hiep ghi ban dau tien cua doi|team first scoring half)\b/u).test(evidence)) return null;
    const offset = subject === "AWAY" ? 10 : 0;
    const first = suffix === `Q0Q${offset + 1}` && item.side === 1 && /^(?:hiep 1|first half|1st half)$/u.test(name);
    const none = suffix === `Q0Q${offset}` && item.side === 2 && /^(?:khong|none|no goal)$/u.test(name);
    const second = suffix === `Q0Q${offset + 2}` && item.side === 3 && /^(?:hiep 2|second half|2nd half)$/u.test(name);
    if (first) return terms(subject === null ? "FH_TOTAL" : `${subject}_FH_TOTAL`, "OVER", "0.5");
    if (none) return terms(subject === null ? "FT_TOTAL" : `${subject}_FT_TOTAL`, "UNDER", "0.5");
    return second ? terms(subject === null ? "FT_FIRST_SCORING_HALF" : `${subject}_FT_FIRST_SCORING_HALF`, "SECOND_HALF") : null;
  }

  const race = races[code];
  if (race !== undefined) {
    if (teams === undefined || !new RegExp(`\\b(?:dua toi|cham moc|race to) ${race[1]}\\b`, "u").test(evidence) ||
      !(race[2] === "GOALS" ? /\b(?:ban thang|goals)\b/u : /\b(?:phat goc|corners)\b/u).test(evidence) ||
      /\b(?:hiep 1|first half|1st half)\b/u.test(evidence) !== race[3]) return null;
    if (suffix === "Q0Q0" && item.side === 2 && /^(?:cung khong|neither|none)$/u.test(name)) return terms(race[0], "NEITHER", String(race[1]));
    const expected = suffix === "Q0Q1" && item.side === 1 ? "HOME" : suffix === "Q0Q2" && item.side === 3 ? "AWAY" : null;
    return expected !== null && namedTeam(item.name, teams) === expected ? terms(race[0], expected, String(race[1])) : null;
  }

  const firstOrLast = goalTeam[code];
  if (firstOrLast !== undefined) {
    if (teams === undefined || !firstOrLast[2].test(evidence)) return null;
    const noneLabel = code === "ML6073" ? /^(?:hoa|draw|tie|cung khong|neither|none)$/u : /^(?:cung khong|neither|none)$/u;
    if (suffix === "D" && item.side === 2 && noneLabel.test(name)) return terms(firstOrLast[1], "UNDER", "0.5");
    const expected = suffix === "H" && item.side === 1 ? "HOME" : suffix === "A" && item.side === 3 ? "AWAY" : null;
    return expected !== null && namedTeam(item.name, teams) === expected ? terms(firstOrLast[0], expected) : null;
  }

  const positive = positiveTeam[code];
  if (positive !== undefined) {
    if (!positive[1].test(evidence)) return null;
    const expected = suffix === "Q0Q0" && item.side === 1 ? "HOME" : suffix === "Q0Q1" && item.side === 3 ? "AWAY" : null;
    return expected !== null && namedTeam(item.name, teams) === expected ? terms(`${expected}_${positive[0]}` as MarketType, "YES") : null;
  }
  const proposition = binary[code];
  if (proposition !== undefined) {
    const outcome = sideAndYesNo(suffix, item);
    return outcome !== null && proposition[1].test(evidence) ? terms(proposition[0], outcome) : null;
  }

  if (code === "QA65") {
    const range = /^(\d+)\s*-\s*(\d+)\s+(?:phút|minutes?)$/iu.exec(item.name.trim());
    if (range === null || item.side !== 1 || !/\b(?:thoi gian ghi ban thang dau tien|first goal time)\b/u.test(evidence)) return null;
    const lower = Number(range[1]), upper = Number(range[2]);
    return lower >= 1 && upper <= 90 && lower % 10 === 1 && upper === lower + 9 && suffix === `Q0Q${lower}${upper}`
      ? terms("FT_FIRST_GOAL_MINUTE_RANGE", `MINUTES_${lower}_${upper}`) : null;
  }
  if (["QA6017", "QA6018", "QA6053", "QA5088"].includes(code)) {
    const subject = code === "QA6018" ? "HOME" : code === "QA6053" ? "AWAY" : null;
    if (subject !== null && (namedSubject(label, teams) !== subject || !/\bphut ghi ban thu nhat cua doi\b/u.test(evidence))) return null;
    if (subject === null && !(code === "QA5088" ? /\bphut ghi ban cuoi cung\b/u : /\bphut ghi ban dau tien\b/u).test(evidence)) return null;
    if (item.side !== 0) return null;
    if (code === "QA5088" && suffix === "Q0Q0" && /^(?:khong ghi ban|no goals?)$/u.test(name)) return terms("FT_TOTAL", "UNDER", "0.5");
    const bounds = /^Q(\d+)Q(\d+)$/u.exec(suffix), clock = /^(\d{1,3}):([0-5]\d)\s*-\s*(\d{1,3}):([0-5]\d)$/u.exec(item.name.trim());
    if (bounds === null || clock === null) return null;
    const lower = seconds(clock[1]!, clock[2]!), upper = seconds(clock[3]!, clock[4]!);
    if (lower === null || upper === null || lower > upper || String(lower) !== bounds[1] || String(upper) !== bounds[2]) return null;
    if (code !== "QA5088" && lower === 0 && upper < 86_400) return terms(subject === null ? "FT_FIRST_GOAL_BEFORE" : `${subject}_FT_FIRST_GOAL_BEFORE`, "YES", String(upper + 1));
    return terms(code === "QA5088" ? "FT_LAST_GOAL_SECONDS_RANGE" : subject === null ? "FT_FIRST_GOAL_SECONDS_RANGE" : `${subject}_FT_FIRST_GOAL_SECONDS_RANGE`, `SECONDS_${lower}_${upper}`);
  }

  if (code === "QA6036" || code === "QA5614" || code === "QA5617") {
    const subject = code === "QA5614" ? "HOME" : code === "QA5617" ? "AWAY" : null;
    if (subject !== null && (namedSubject(label, teams) !== subject || !/\bdoi ghi ban thu nhat truoc\b/u.test(evidence))) return null;
    if (subject === null && !/\bban thang dau tien truoc phut\b/u.test(evidence)) return null;
    const id = /^Q(\d+)Q([01])$/u.exec(suffix), caption = /^(\d{1,3}):([0-5]\d)\s*-\s*(.+)$/u.exec(item.name.trim());
    if (id === null || caption === null) return null;
    const threshold = seconds(caption[1]!, caption[2]!), outcome = yesNo(caption[3]!);
    if (threshold === null || threshold === 0 || String(threshold) !== id[1] || outcome === null ||
      id[2] !== (outcome === "YES" ? "1" : "0") || item.side !== (outcome === "YES" ? 1 : 3)) return null;
    return terms(subject === null ? "FT_FIRST_GOAL_BEFORE" : `${subject}_FT_FIRST_GOAL_BEFORE`, outcome, String(threshold));
  }
  if (code === "QA5521" || code === "QA5522") {
    const outcome = sideAndYesNo(suffix, item);
    const caption = code === "QA5521" ? /\bban thang dau tien truoc phut 33 00\b/u : /\bco ban thang sau phut 68 00\b/u;
    return outcome !== null && caption.test(evidence) ? terms(code === "QA5521" ? "FT_FIRST_GOAL_BEFORE" : "FT_GOAL_AFTER", outcome, code === "QA5521" ? "1980" : "4080") : null;
  }
  if (code === "QA5108") {
    if (item.side !== 0 || !/\b(?:thoi diem phat goc dau tien|first corner time)\b/u.test(evidence)) return null;
    const id = /^Q(\d+)Q(\d+)$/u.exec(suffix), caption = /^(\d{1,3}):([0-5]\d)\s*-\s*(\d{1,3}):([0-5]\d)$/u.exec(item.name.trim());
    if (id === null || caption === null) return null;
    const lower = seconds(caption[1]!, caption[2]!), upper = seconds(caption[3]!, caption[4]!);
    return lower !== null && upper !== null && lower < upper && String(lower) === id[1] && String(upper) === id[2]
      ? terms("CORNER_FT_FIRST_SECONDS_RANGE", `SECONDS_${lower}_${upper}`) : null;
  }
  if (code === "QA5516") {
    const outcome = sideAndYesNo(suffix, item);
    return outcome !== null && /\b(?:the dau tien xuat hien truoc phut 27 00|first card before 27 00)\b/u.test(evidence)
      ? terms("CARD_FT_FIRST_BEFORE", outcome, "1620") : null;
  }
  if (code === "QA6037") {
    if (!/\b(?:ca hai doi se theo phut|both teams will time intervals)\b/u.test(evidence)) return null;
    const caption = /^(.+?)\s*\((\d{1,3}):([0-5]\d)\s*-\s*(\d{1,3}):([0-5]\d)\)$/u.exec(item.name.trim());
    if (caption === null) return null;
    const action = /^(?:nem bien trong|throw in in)$/u.test(key(caption[1]!)) ? "THROW_IN"
      : /^(?:da phat|free kick)$/u.test(key(caption[1]!)) ? "FREE_KICK" : null;
    const lower = seconds(caption[2]!, caption[3]!), upper = seconds(caption[4]!, caption[5]!);
    const nativeAction = action === "THROW_IN" ? 1 : 3;
    if (action === null || lower === null || upper === null || lower % 60 !== 0 || upper !== lower + 59 ||
      item.side !== nativeAction || suffix !== `Q${lower}Q${nativeAction}${upper}`) return null;
    return terms("FT_BOTH_TEAMS_WINDOW_ACTION", `${action}_SECONDS_${lower}_${upper}`);
  }

  if (code === "QA1447" || code === "QA6011") {
    if (!/\b(?:cach ghi ban thang dau|cach ghi ban dau tien|first goal method)\b/u.test(evidence)) return null;
    const methods: Readonly<Record<string, readonly [string, number, RegExp]>> = {
      Q0Q1: ["SHOT", 3, /^(?:sut|shot)$/u], Q0Q2: ["HEADER", 1, /^(?:danh dau|header)$/u],
      Q0Q3: ["PENALTY", 2, /^(?:phat den|penalty)$/u], Q0Q4: ["FREE_KICK", 3, /^free kick$/u],
      Q0Q5: ["OWN_GOAL", 2, /^own goal$/u], Q0Q6: ["NO_GOAL", 1, /^no goal$/u]
    };
    const method = methods[suffix];
    if (method === undefined || method[1] !== item.side || !method[2].test(name)) return null;
    return method[0] === "NO_GOAL" ? terms("FT_TOTAL", "UNDER", "0.5") : terms("FT_FIRST_GOAL_METHOD", method[0]);
  }
  return null;
}
