import type { MarketType } from "@tool-chenh/contracts";
import type { BtiNamedSelection } from "./bti-categorical-terms.js";

export interface BtiCombinationTerms {
  readonly marketType: MarketType;
  readonly selection: string;
  readonly lineText: string | null;
}
const terms = (marketType: MarketType, selection: string, lineText: string | null = null): BtiCombinationTerms =>
  ({ marketType, selection, lineText });
const key = (value: string): string => value.normalize("NFD").replace(/[\u0300-\u036f]/gu, "")
  .replace(/đ/giu, "d").toLocaleLowerCase("en").replace(/[^a-z0-9]+/gu, " ").trim();
const yesNo = (value: string): "YES" | "NO" | null => /^(?:co|yes)$/u.test(key(value)) ? "YES"
  : /^(?:khong|no)$/u.test(key(value)) ? "NO" : null;
const isDraw = (value: string): boolean => /^(?:hoa|draw|tie)$/u.test(key(value));
function namedTeam(value: string, teams?: readonly [string, string]): "HOME" | "AWAY" | null {
  if (teams === undefined || key(value) === "") return null;
  const home = key(value) === key(teams[0]), away = key(value) === key(teams[1]);
  return home === away ? null : home ? "HOME" : "AWAY";
}
const namedSubject = (label: string, teams?: readonly [string, string]) =>
  label.includes(":") ? namedTeam(label.slice(0, label.indexOf(":")), teams) : null;
function nativeYesNo(suffix: string, item: BtiNamedSelection, noSuffix = "Q0Q0"): "YES" | "NO" | null {
  const outcome = yesNo(item.name);
  return outcome !== null && suffix === (outcome === "YES" ? "Q0Q1" : noSuffix) &&
    item.side === (outcome === "YES" ? 1 : 3) ? outcome : null;
}

const binary: Readonly<Record<string, readonly [MarketType, RegExp, string | null]>> = {
  QA5505: ["FT_BTTS_OR_OVER_TOTAL", /\b(?:ca hai doi ghi ban hoac tai 2 5|both teams to score or over 2 5)\b/u, "2.5"],
  QA5081: ["FT_BOTH_TEAMS_SCORE_MINIMUM", /\b(?:ca hai doi ghi tu 2 ban tro len|both teams to score 2 or more)\b/u, "2"],
  QA4200: ["FT_BOTH_TEAMS_CARD_MINIMUM", /\b(?:ca 2 doi deu nhan the phat|both teams to receive a card)\b/u, "1"],
  QA5152: ["FT_RED_CARD_OR_PENALTY", /\b(?:co the do hoac phat den|red card or penalty)\b/u, null],
  QA6038: ["FT_CARDS_BOTH_HALVES", /\b(?:co the o ca hai hiep|cards in both halves)\b/u, null],
  QA5151: ["FT_BOTH_TEAMS_CARDS_BOTH_HALVES", /\b(?:ca hai doi nhan the o moi hiep|both teams carded in each half)\b/u, null],
  QA5536: ["FT_DIRECT_RED_CARD", /\b(?:the do truc tiep|direct red card)\b/u, null],
  QA5540: ["FH_RED_CARD", /\b(?:co the do hiep 1|first half red card)\b/u, null],
  QA6025: ["FH_STOPPAGE_GOAL", /\b(?:co ban trong bu gio hiep 1|first half stoppage time goal)\b/u, null],
  QA6337: ["FT_DECIDED_EXTRA_TIME", /\b(?:tran dau duoc dinh doat trong hiep phu|match decided in extra time)\b/u, null],
  QA5302: ["FT_PENALTY_SHOOTOUT", /\b(?:co loat sut luan luu hay khong|penalty shootout)\b/u, null]
};
const halfFull: Readonly<Record<number, readonly ["HOME" | "DRAW" | "AWAY", "HOME" | "DRAW" | "AWAY", number]>> = {
  9: ["HOME", "HOME", 1], 10: ["HOME", "AWAY", 1], 11: ["HOME", "DRAW", 1],
  12: ["AWAY", "HOME", 3], 13: ["AWAY", "AWAY", 3], 14: ["AWAY", "DRAW", 3],
  15: ["DRAW", "HOME", 2], 16: ["DRAW", "DRAW", 2], 17: ["DRAW", "AWAY", 2]
};
const doubleChance: Readonly<Record<number, readonly [string, number, string]>> = {
  1: ["HOME_AWAY", 3, "home or away"], 2: ["HOME_DRAW", 1, "home or tie"], 3: ["DRAW_AWAY", 2, "tie or away"]
};
export const btiCombinationCodes = new Set([
  ...Object.keys(binary), "QA5103", "QA5194", "QA5197", "QA5200", "QA6021",
  "QA6096", "QA6097", "QA6098", "QA6099", "QA5534", "QA5104", "QA5105", "QA5100", "QA5537", "QA4280"
]);

/** Each quote keeps the proposition offered by BTI, including OR, anytime,
 * direct-red and the explicit no-bet refund subject. Names and suffixes must agree. */
export function decodeBtiCombinationTerms(code: string, marketId: string, item: BtiNamedSelection,
  label: string, teams?: readonly [string, string]): BtiCombinationTerms | null {
  if (!btiCombinationCodes.has(code) || marketId === "" || !item.id.startsWith(marketId) ||
    !item.lineWasMissing && item.line !== 0) return null;
  const suffix = item.id.slice(marketId.length), name = key(item.name), evidence = key(label);
  const proposition = binary[code];
  if (proposition !== undefined) {
    const outcome = nativeYesNo(suffix, item);
    return outcome !== null && proposition[1].test(evidence) ? terms(proposition[0], outcome, proposition[2]) : null;
  }
  if (code === "QA5103") {
    if (item.side !== 0 || !/\b(?:doi nao se ghi ban|which teams will score)\b/u.test(evidence)) return null;
    if (suffix === "Q0Q0" && /^(?:khong|neither|none)$/u.test(name)) return terms("FT_TOTAL", "UNDER", "0.5");
    if (suffix === "Q1Q1" && /^(?:both team|both teams)$/u.test(name)) return terms("FT_BTTS", "YES");
    const only = /^Only\s+(.+)$/iu.exec(item.name.trim());
    const expected = suffix === "Q1Q0" ? "HOME" : suffix === "Q0Q1" ? "AWAY" : null;
    return only !== null && expected !== null && namedTeam(only[1]!, teams) === expected
      ? terms(`${expected}_FT_WIN_TO_NIL`, "YES") : null;
  }
  if (code === "QA5194" || code === "QA5197" || code === "QA5200") {
    const outcome = nativeYesNo(suffix, item);
    if (outcome === null) return null;
    if (code === "QA5200") return /\b(?:hoa hoac ca hai doi ghi ban|draw or both teams to score)\b/u.test(evidence)
      ? terms("FT_RESULT_OR_BTTS", `DRAW_YES_${outcome}`) : null;
    const over = code === "QA5194";
    const caption = over ? /\b(?:hoa hoac tai 2 5|draw or over 2 5)\b/u : /\b(?:hoa hoac xiu 2 5|draw or under 2 5)\b/u;
    return caption.test(evidence) ? terms("FT_RESULT_OR_TOTAL", `DRAW_${over ? "OVER" : "UNDER"}_${outcome}`, "2.5") : null;
  }
  if (code === "QA6021") {
    if (teams === undefined || key(teams[0]) === "" || key(teams[0]) === key(teams[1]) ||
      !/\b(?:hiep 1 ca tran va tai xiu ban thang|half time full time and total goals)\b/u.test(evidence)) return null;
    const id = /^Q(9|1[0-7])Q(-?[1-5]50)$/u.exec(suffix);
    const caption = /^(.+?)\s+and\s+(Over|Under)\s+([1-5]\.5)$/iu.exec(item.name.trim());
    if (id === null || caption === null) return null;
    const pair = halfFull[Number(id[1])]!, value = Number(id[2]);
    const direction = value > 0 ? "OVER" : "UNDER", threshold = Math.abs(value) / 100;
    if (item.side !== pair[2] || caption[2]!.toUpperCase() !== direction || Number(caption[3]) !== threshold) return null;
    const names = (side: "HOME" | "DRAW" | "AWAY") => side === "DRAW" ? ["Hoà", "Draw", "Tie"] : [teams[side === "HOME" ? 0 : 1]];
    // A slash may belong to a team name (Bodo/Glimt), so compose the expected
    // named pair from the ID instead of splitting the provider's text in two.
    const composedKey = (value: string) => value.replace(/[^/]+/gu, (part) => key(part));
    const matches = names(pair[0]).some((first) => names(pair[1]).some((second) =>
      composedKey(caption[1]!) === composedKey(`${first}/${second}`)));
    return matches ? terms("FT_HALF_FULL_RESULT_TOTAL", `${pair[0]}_${pair[1]}_${direction}`, String(threshold)) : null;
  }
  if (["QA6096", "QA6097", "QA6098", "QA6099"].includes(code)) {
    const threshold = Number(code.slice(2)) - 6096 + 2.5;
    const labelPattern = new RegExp(`\\b(?:co hoi kep va tong ban|double chance and total goals) ${String(threshold).replace(".", " ")}\\b`, "u");
    const id = /^Q([123])Q(-?[2-5]50)$/u.exec(suffix);
    const caption = /^(Home or Away|Home or Tie|Tie or Away)\s*&\s*(Over|Under)\s+([2-5]\.5)$/iu.exec(item.name.trim());
    if (!labelPattern.test(evidence) || id === null || caption === null) return null;
    const pair = doubleChance[Number(id[1])]!, value = Number(id[2]), direction = value > 0 ? "OVER" : "UNDER";
    return item.side === pair[1] && key(caption[1]!) === pair[2] && Math.abs(value) === threshold * 100 &&
      caption[2]!.toUpperCase() === direction && Number(caption[3]) === threshold
      ? terms("FT_DOUBLE_CHANCE_TOTAL", `${pair[0]}_${direction}`, String(threshold)) : null;
  }
  if (code === "QA5534") {
    if (!/\b(?:ty so chinh xac tai bat ky thoi diem nao|correct score at any time)\b/u.test(evidence)) return null;
    const id = /^Q(\d{1,2})Q(\d{1,2})$/u.exec(suffix), caption = /^(\d{1,2})\s*:\s*(\d{1,2})$/u.exec(item.name.trim());
    if (id === null || caption === null || id[1] !== caption[1] || id[2] !== caption[2]) return null;
    const home = Number(id[1]), away = Number(id[2]);
    return item.side === (home > away ? 1 : home === away ? 2 : 3) ? terms("FT_SCORE_ANYTIME", `SCORE_${home}_${away}`) : null;
  }
  if (code === "QA5104" || code === "QA5105") {
    const subject = code === "QA5104" ? "HOME" : "AWAY", other = subject === "HOME" ? "AWAY" : "HOME";
    if (namedSubject(label, teams) !== subject || !/\b(?:khong cuoc|no bet)\b/u.test(evidence)) return null;
    if (suffix === "Q0Q0" && item.side === (subject === "HOME" ? 1 : 3) && isDraw(item.name)) return terms(`FT_${subject}_NO_BET`, "DRAW");
    return suffix === "Q1Q1" && item.side === (other === "HOME" ? 1 : 3) && namedTeam(item.name, teams) === other
      ? terms(`FT_${subject}_NO_BET`, other) : null;
  }
  if (code === "QA5100") {
    if (!/\b(?:ca hai doi nhan 1 2 3 the tro len|both teams receive 1 2 3 or more cards)\b/u.test(evidence)) return null;
    const id = /^Q([123])Q([01])$/u.exec(suffix), caption = /^([123]) or more (yes|no)$/iu.exec(item.name.trim());
    if (id === null || caption === null || id[1] !== caption[1]) return null;
    const outcome = caption[2]!.toUpperCase();
    return id[2] === (outcome === "YES" ? "1" : "0") && item.side === (outcome === "YES" ? 1 : 3)
      ? terms("FT_BOTH_TEAMS_CARD_MINIMUM", outcome, id[1]!) : null;
  }
  if (code === "QA5537") {
    const outcome = nativeYesNo(suffix, item, "Q0Q2");
    return outcome !== null && namedSubject(label, teams) === "HOME" && /\b(?:co the do|red card)\b/u.test(evidence)
      ? terms("HOME_FT_RED_CARD", outcome) : null;
  }
  if (code === "QA4280") {
    if (teams === undefined || !/\b(?:cach thuc gianh quyen di tiep chien thang|method of qualification winning)\b/u.test(evidence)) return null;
    const id = /^Q([01])Q([012])$/u.exec(suffix);
    if (id === null) return null;
    const subject = id[1] === "0" ? "HOME" : "AWAY", team = teams[subject === "HOME" ? 0 : 1];
    if (item.side !== (subject === "HOME" ? 1 : 3) || namedTeam(team, teams) !== subject) return null;
    const methods = [
      ["REGULATION", ["90 Minutes"]], ["EXTRA_TIME", ["Hiệp phụ", "Extra time"]],
      ["PENALTIES", ["Phạt đền", "Penalties"]]
    ] as const;
    const method = methods[Number(id[2])]!;
    return method[1].some((caption) => key(`${team} ${caption}`) === name)
      ? terms("FT_QUALIFICATION_METHOD", `${subject}_${method[0]}`) : null;
  }
  return null;
}
