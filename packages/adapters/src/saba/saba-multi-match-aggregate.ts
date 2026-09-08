function foldSabaAggregateText(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/gu, "")
    .replace(/Đ/gu, "D").replace(/đ/gu, "d")
    .replace(/\s+/gu, " ").trim().toUpperCase();
}

interface AggregateParticipant {
  readonly role: "HOME" | "AWAY";
  readonly bucket: string;
  readonly count: number;
}

function parseParticipant(value: string): AggregateParticipant | null {
  const match = /^(DOI NHA|DOI KHACH)\s*-\s*(\S(?:.*\S)?)\s*-\s*(\d+)\s+TRAN DAU$/u
    .exec(foldSabaAggregateText(value));
  if (!match) return null;
  const count = Number(match[3]);
  if (!Number.isSafeInteger(count)) return null;
  return { role: match[1] === "DOI NHA" ? "HOME" : "AWAY", bucket: match[2]!, count };
}

export function hasSabaMultiMatchAggregateParticipants(participants: readonly string[]): boolean {
  if (participants.length !== 2) return false;
  const home = parseParticipant(participants[0]!);
  const away = parseParticipant(participants[1]!);
  return home?.role === "HOME" && away?.role === "AWAY" && home.count >= 2 &&
    home.count === away.count && home.bucket === away.bucket;
}

export function isSabaMultiMatchAggregate(
  competition: string,
  participants: readonly string[]
): boolean {
  const normalized = foldSabaAggregateText(competition);
  const match = /^(.*?)\s*-\s*DOI NHA\s*\/\s*DOI KHACH$/u.exec(normalized);
  if (!match) return false;
  const prefix = match[1]!.replace(/^\*\s*/u, "").trim();
  return prefix.length > 0 && hasSabaMultiMatchAggregateParticipants(participants);
}
