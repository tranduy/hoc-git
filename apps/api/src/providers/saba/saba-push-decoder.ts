export interface SabaPushFrame {
  readonly bridgeId: string;
  readonly rows: unknown;
  readonly revision: string | null;
}

export interface SabaPushChange {
  readonly operation: "UPSERT" | "DELETE" | "RESET" | "DONE";
  readonly key: string | null;
  readonly record: Readonly<Record<string, unknown>> | null;
}

export interface SabaPushApplyResult {
  readonly bridgeId: string;
  readonly revision: string | null;
  readonly duplicate: boolean;
  readonly fullSnapshot: boolean;
  readonly changes: readonly SabaPushChange[];
  readonly records: readonly Readonly<Record<string, unknown>>[];
}

interface ChannelState {
  readonly fields: readonly (string | undefined)[];
  readonly records: ReadonlyMap<string, Readonly<Record<string, unknown>>>;
  readonly lastRevision: string | null;
  readonly pending: PendingSnapshot | null;
}

interface PendingSnapshot {
  readonly fields: readonly (string | undefined)[];
  readonly records: ReadonlyMap<string, Readonly<Record<string, unknown>>>;
  readonly changes: readonly SabaPushChange[];
  readonly lastRevision: string | null;
}

const typeKeys: Readonly<Record<string, readonly string[]>> = {
  m: ["matchid"],
  ls: ["matchid"],
  o: ["oddsid"],
  b: ["bettype"],
  "12": ["tid"],
  sp: ["tid"],
  "13": ["policyid"],
  "15": ["siteid"],
  "16": ["sportId", "leagueGroupId", "betTypes"],
  l: ["leagueid"],
  c: ["Mode", "MarketId", "SportType", "BetTypeGroup"],
  st: ["matchid", "streamingsrc", "siteid"]
};

function protocolError(reason = "INVALID"): never {
  throw new Error(`SABA_PUSH_SCHEMA_CHANGED:${reason}`);
}

function publicRecord(value: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> {
  return { ...value };
}

function recordKey(record: Readonly<Record<string, unknown>>): { readonly key: string; readonly deleted: boolean } {
  const rawType = record.type;
  if (typeof rawType !== "string" || rawType.length === 0) protocolError("TYPE");
  const deleted = rawType.startsWith("-") || rawType === "dm" || rawType === "do";
  const type = deleted ? rawType.slice(1) : rawType;
  const keys = typeKeys[type];
  if (keys === undefined) protocolError(`UNKNOWN_TYPE:${type}`);
  const values = keys.map((key) => record[key]);
  if (values.some((value) => value === undefined || value === null || String(value).length === 0)) {
    protocolError(`MISSING_KEY:${type}:${keys.join(",")}`);
  }
  return { key: `${type}:${values.map(String).join(".")}`, deleted };
}

export class SabaPushDecoder {
  readonly #channels = new Map<string, ChannelState>();

  apply(frame: SabaPushFrame): SabaPushApplyResult {
    if (!/^b\d+$/u.test(frame.bridgeId) || (frame.revision !== null && frame.revision.length === 0) ||
      !Array.isArray(frame.rows)) protocolError();
    const current = this.#channels.get(frame.bridgeId) ?? {
      fields: [], records: new Map(), lastRevision: null, pending: null
    };
    if (current.pending === null && frame.revision !== null && frame.revision === current.lastRevision) {
      return {
        bridgeId: frame.bridgeId,
        revision: frame.revision,
        duplicate: true,
        fullSnapshot: false,
        changes: [],
        records: [...current.records.values()].map(publicRecord)
      };
    }

    const base = current.pending ?? current;
    const fields = [...base.fields];
    const records = new Map([...base.records].map(([key, value]) => [key, publicRecord(value)]));
    const changes: SabaPushChange[] = current.pending === null ? [] : [...current.pending.changes];
    let sawReset = false;
    let sawDone = false;

    for (const rawRow of frame.rows) {
      if (!Array.isArray(rawRow) || rawRow.length === 0) protocolError();
      if (rawRow[0] === "c") continue;
      if (rawRow[0] === "f") {
        const offset = rawRow[1];
        const names = rawRow[2];
        if (!Number.isSafeInteger(offset) || (offset as number) < 0 || !Array.isArray(names)) protocolError();
        names.forEach((rawName, index) => {
          let name = rawName;
          if (typeof name === "number") name = fields[name - (offset as number) - index];
          if (typeof name !== "string" || name.length === 0) protocolError();
          fields[(offset as number) + index] = name;
        });
        continue;
      }
      if (rawRow.length % 2 !== 0) protocolError();
      const decoded: Record<string, unknown> = {};
      for (let index = 0; index < rawRow.length; index += 2) {
        const fieldIndex = rawRow[index];
        if (!Number.isSafeInteger(fieldIndex)) protocolError();
        const name = fields[fieldIndex as number];
        if (name === undefined) protocolError();
        decoded[name] = rawRow[index + 1];
      }
      const action = decoded.type;
      if (action === "reset" || action === "empty") {
        records.clear();
        changes.length = 0;
        sawReset = true;
        changes.push({ operation: "RESET", key: null, record: null });
        continue;
      }
      if (action === "done") {
        sawDone = true;
        changes.push({ operation: "DONE", key: null, record: null });
        continue;
      }
      const identity = recordKey(decoded);
      if (identity.deleted) {
        records.delete(identity.key);
        changes.push({ operation: "DELETE", key: identity.key, record: publicRecord(decoded) });
        continue;
      }
      const merged = { ...(records.get(identity.key) ?? {}), ...decoded };
      records.set(identity.key, merged);
      changes.push({ operation: "UPSERT", key: identity.key, record: publicRecord(merged) });
    }

    const snapshotOpen = current.pending !== null || sawReset;
    if (snapshotOpen && !sawDone) {
      const pending: PendingSnapshot = { fields, records, changes, lastRevision: frame.revision };
      this.#channels.set(frame.bridgeId, { ...current, pending });
      return {
        bridgeId: frame.bridgeId,
        revision: frame.revision,
        duplicate: false,
        fullSnapshot: false,
        changes: [],
        records: [...current.records.values()].map(publicRecord)
      };
    }
    if (!snapshotOpen && sawDone) protocolError("UNEXPECTED_DONE");
    const committedRevision = frame.revision ?? current.pending?.lastRevision ?? null;
    const next: ChannelState = { fields, records, lastRevision: committedRevision, pending: null };
    this.#channels.set(frame.bridgeId, next);
    return {
      bridgeId: frame.bridgeId,
      revision: committedRevision,
      duplicate: false,
      fullSnapshot: snapshotOpen && sawDone,
      changes,
      records: [...records.values()].map(publicRecord)
    };
  }
}
