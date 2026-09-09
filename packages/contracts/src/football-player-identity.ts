import type { ProviderPlayerIdentity } from "./domain.js";

function normalizedName(value: string): string {
  return value.normalize("NFKD").replace(/\p{M}/gu, "").replace(/[đð]/giu, "d")
    .toLowerCase().replace(/['’]/gu, "").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

function isPlayerName(name: string): boolean {
  if (name.length === 0 || name.length > 256 || /[\u0000-\u001f\u007f]/u.test(name)) return false;
  const trimmed = name.normalize("NFC").trim();
  if (!/^[\p{L}\p{M}][\p{L}\p{M} .'’,\-]*(?:\s\([\p{L}\p{M}\d .'’\-]+\))?$/u.test(trimmed)) return false;
  const key = normalizedName(trimmed);
  return !/^(?:no score|no scorer|no goals?|no goalscorer|khong ghi ban|khong ban thang|khong co cau thu ghi ban|own goals?|phan luoi|none|other|any other|unknown|player|home player|away player|team)(?:\s|$)/u.test(key) &&
    !/\b(?:to score|to win|substitute)\b/u.test(key) && !/^(?:over|under)$/u.test(key) && !/\sor(?:\s|$)/u.test(key);
}

/** Valid native identities can still lack enough evidence for a cross-book key. */
export function isValidProviderPlayerIdentity(value: unknown): value is ProviderPlayerIdentity {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const player = value as Partial<ProviderPlayerIdentity>;
  return typeof player.providerPlayerId === "string" && /^[A-Za-z0-9_.:\-]{1,256}$/u.test(player.providerPlayerId) &&
    typeof player.name === "string" && isPlayerName(player.name) &&
    (player.teamSide === null || player.teamSide === "HOME" || player.teamSide === "AWAY");
}

/** Use only within one provider/event: providerPlayerId is never a global ID. */
export function sameNativePlayer(left: unknown, right: unknown): boolean {
  return isValidProviderPlayerIdentity(left) && isValidProviderPlayerIdentity(right) &&
    left.providerPlayerId === right.providerPlayerId && left.name === right.name && left.teamSide === right.teamSide;
}

/** A candidate key within an already-matched event and oriented team.
 * The caller must reject duplicate full names on that event/team before pairing.
 * Initials, mononyms, unknown teams and aliases need independent identity evidence. */
export function playerComparisonKey(value: unknown): string | null {
  if (!isValidProviderPlayerIdentity(value) || value.teamSide === null) return null;
  const baseName = value.name.replace(/\s*\([^)]*\)\s*$/u, "");
  const tokens = normalizedName(baseName).split(" ");
  if (tokens.length < 2 || tokens.some(token => [...token].length < 2) ||
    /(?:^|[\s,\-])\p{L}\./u.test(baseName)) return null;
  return `${value.teamSide}|${normalizedName(value.name)}`;
}
