type Row = Record<string, unknown>;
const scalar = (value: unknown): string | null => typeof value === "string" || typeof value === "number" ? String(value) : null;

/** Public semantic fields only: never persist request/page/session objects in native inventory. */
export function tsportNativeContext(groupId: string, group: Row, odd: Row): string | undefined {
  const context: Record<string, unknown> = { schemaVersion: 1 };
  const omittedFields: string[] = [];
  for (const [field, name, limit] of [["15", "playerId", 128], ["16", "playerName", 256], ["17", "timeRange", 32]] as const) {
    const value = scalar(odd[field]);
    if (value === null) { if (odd[field] != null) omittedFields.push(name); continue; }
    if (value.length > limit) omittedFields.push(name);
    else context[name] = value;
  }
  if ((groupId === "10" || groupId === "11") && scalar(odd["7"]) === "9:9" && Array.isArray(group["9"])) {
    const scores = new Set<string>();
    for (const value of group["9"]) {
      if (typeof value !== "object" || value === null) continue;
      const line = scalar((value as Row)["7"]);
      if (line !== null && line !== "9:9" && /^(?:0|[1-9]\d?):(?:0|[1-9]\d?)$/u.test(line)) scores.add(line);
    }
    const sorted = [...scores].sort((a, b) => {
      const [ah, aa] = a.split(":").map(Number), [bh, ba] = b.split(":").map(Number);
      return ah! - bh! || aa! - ba!;
    });
    context.observedScoreDomain = sorted.slice(0, 256);
    // A visible/open offer list does not prove the bookmaker's AOS settlement domain.
    context.scoreDomainComplete = false;
    if (sorted.length > 256) context.observedScoreDomainTruncated = true;
  }
  if (omittedFields.length > 0) context.omittedFields = omittedFields;
  if (Object.keys(context).length === 1) return undefined;
  let serialized = JSON.stringify(context);
  // Escaping can expand control characters sixfold; bound the serialized field too.
  if (serialized.length > 4096) {
    for (const field of ["playerId", "playerName", "timeRange"]) {
      if (field in context) { delete context[field]; omittedFields.push(field); }
    }
    context.omittedFields = omittedFields;
    serialized = JSON.stringify(context);
  }
  return serialized;
}
