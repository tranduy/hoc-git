import { utf8ByteLength } from "./utf8-length.js";

const MAX_BODY_BYTES = 4 * 1024 * 1024;
const MAX_CONTEXTS = 64;
const MAX_COLUMNS = 512;
const MAX_RAW_ROWS = 65_536;
const MAX_FIELD_ROWS = 512;
const MAX_RESTORED_ROWS = 512;
const BRIDGE_ID = /^b\d{1,32}$/u;
const CHANNEL_ID = /^(?:b|c)\d+$/u;
const FIELD_NAME = /^[A-Za-z][A-Za-z0-9_]{0,79}$/u;

export interface SabaSchemaContext {
  readonly bridgeId: string;
  readonly rows: readonly unknown[];
  readonly revision: null;
}

type FieldTable = readonly (string | undefined)[];

function boundedId(value: unknown, pattern: RegExp): value is string {
  return typeof value === "string" && value.length <= 64 && pattern.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isCatalogTable(fields: FieldTable): boolean {
  return fields.includes("type") &&
    fields.some((name) => name === "matchid" || name === "oddsid" || name === "leagueid");
}

function applyFieldRows(base: FieldTable, rows: readonly unknown[][]): FieldTable | null {
  const fields = [...base];
  for (const row of rows) {
    if (row.length !== 3 || row[0] !== "f" || !Number.isSafeInteger(row[1]) ||
      Number(row[1]) < 0 || !Array.isArray(row[2])) return null;
    const offset = Number(row[1]);
    const names = row[2];
    if (names.length === 0 || offset > MAX_COLUMNS || names.length > MAX_COLUMNS - offset) return null;
    for (let index = 0; index < names.length; index += 1) {
      const rawName = names[index];
      const name = typeof rawName === "number" && Number.isSafeInteger(rawName)
        ? fields[rawName - offset - index] : rawName;
      if (typeof name !== "string" || !FIELD_NAME.test(name)) return null;
      fields[offset + index] = name;
    }
  }
  return fields.length <= MAX_COLUMNS ? fields : null;
}

function tableRows(channelId: string, fields: FieldTable): readonly unknown[] {
  const rows: unknown[] = [["c", channelId]];
  let index = 0;
  while (index < fields.length) {
    while (index < fields.length && fields[index] === undefined) index += 1;
    if (index >= fields.length) break;
    const offset = index;
    const names: string[] = [];
    while (index < fields.length && fields[index] !== undefined) {
      names.push(fields[index]!);
      index += 1;
    }
    rows.push(["f", offset, names]);
  }
  return rows;
}

function uniqueCatalogShapeChannel(fieldTables: ReadonlyMap<string, FieldTable>): string | undefined {
  const shapes = new Map<string, string>();
  for (const [channelId, fields] of fieldTables) {
    if (!isCatalogTable(fields)) continue;
    const shape = JSON.stringify(fields);
    if (!shapes.has(shape)) shapes.set(shape, channelId);
  }
  return shapes.size === 1 ? shapes.values().next().value : undefined;
}

export class SabaSchemaContextCache {
  #bridgeChannels = new Map<string, string>();
  #fieldTables = new Map<string, FieldTable>();

  get size(): number {
    return this.#bridgeChannels.size;
  }

  hasBridgeContext(bridgeId: string): boolean {
    if (!boundedId(bridgeId, BRIDGE_ID)) return false;
    const channelId = this.#bridgeChannels.get(bridgeId);
    return channelId !== undefined && isCatalogTable(this.#fieldTables.get(channelId) ?? []);
  }

  remember(body: string): void {
    if (utf8ByteLength(body) > MAX_BODY_BYTES || !body.startsWith("42")) return;
    let frame: unknown;
    try { frame = JSON.parse(body.slice(2)); } catch { return; }
    if (!Array.isArray(frame) || frame.length !== 4 || frame[0] !== "m" ||
      !boundedId(frame[1], BRIDGE_ID) || !Array.isArray(frame[2]) || frame[2].length > MAX_RAW_ROWS) return;
    const bridgeId = frame[1];
    let announcedChannel: string | undefined;
    const fieldRows: unknown[][] = [];
    for (const value of frame[2]) {
      if (!Array.isArray(value) || value.length === 0) return;
      if (value[0] === "c") {
        if (value.length < 2 || !boundedId(value[1], CHANNEL_ID) ||
          (announcedChannel !== undefined && announcedChannel !== value[1])) return;
        announcedChannel = value[1];
      } else if (value[0] === "f") {
        fieldRows.push(value);
        if (fieldRows.length > MAX_FIELD_ROWS) return;
      } else if (typeof value[0] !== "number" || !Number.isSafeInteger(value[0])) {
        return;
      }
    }
    const mappedChannel = this.#bridgeChannels.get(bridgeId);
    const inferredChannel = announcedChannel === undefined && mappedChannel === undefined
      ? uniqueCatalogShapeChannel(this.#fieldTables) : undefined;
    const channelId = announcedChannel ?? mappedChannel ?? inferredChannel ?? bridgeId;
    if (!boundedId(channelId, CHANNEL_ID)) return;
    const existingTable = this.#fieldTables.get(channelId);
    if (fieldRows.length === 0) {
      if (existingTable === undefined) {
        if (announcedChannel !== undefined && mappedChannel !== announcedChannel) {
          this.#bridgeChannels.delete(bridgeId);
        }
        return;
      }
      if (!this.#bridgeChannels.has(bridgeId) && this.#bridgeChannels.size >= MAX_CONTEXTS) return;
      this.#bridgeChannels.set(bridgeId, channelId);
      return;
    }
    const fields = applyFieldRows(existingTable ?? [], fieldRows);
    if (fields === null) return;
    if (!isCatalogTable(fields)) {
      if (announcedChannel !== undefined && mappedChannel !== announcedChannel) {
        this.#bridgeChannels.delete(bridgeId);
      }
      return;
    }
    if (!this.#fieldTables.has(channelId) && this.#fieldTables.size >= MAX_CONTEXTS) return;
    if (!this.#bridgeChannels.has(bridgeId) && this.#bridgeChannels.size >= MAX_CONTEXTS) return;
    this.#fieldTables.set(channelId, [...fields]);
    this.#bridgeChannels.set(bridgeId, channelId);
  }

  exportContexts(): readonly SabaSchemaContext[] {
    const contexts: SabaSchemaContext[] = [];
    for (const [bridgeId, channelId] of this.#bridgeChannels) {
      const fields = this.#fieldTables.get(channelId);
      if (fields === undefined || !isCatalogTable(fields)) continue;
      contexts.push({ bridgeId, rows: tableRows(channelId, fields), revision: null });
    }
    return contexts;
  }

  restore(contexts: unknown): void {
    if (!Array.isArray(contexts) || contexts.length > MAX_CONTEXTS) return;
    const bridgeChannels = new Map<string, string>();
    const fieldTables = new Map<string, FieldTable>();
    for (const context of contexts) {
      if (!isRecord(context) || Object.keys(context).sort().join(",") !== "bridgeId,revision,rows" ||
        !boundedId(context.bridgeId, BRIDGE_ID) || context.revision !== null || !Array.isArray(context.rows) ||
        context.rows.length < 2 || context.rows.length > MAX_RESTORED_ROWS) return;
      const channelRow = context.rows[0];
      if (!Array.isArray(channelRow) || channelRow.length !== 2 || channelRow[0] !== "c" ||
        !boundedId(channelRow[1], CHANNEL_ID) || bridgeChannels.has(context.bridgeId)) return;
      const channelId = channelRow[1];
      const fieldRows: unknown[][] = [];
      for (const row of context.rows.slice(1)) {
        if (!Array.isArray(row) || row.length !== 3 || row[0] !== "f" ||
          !Array.isArray(row[2]) || row[2].some((name) => typeof name !== "string")) return;
        fieldRows.push(row);
      }
      const fields = applyFieldRows([], fieldRows);
      if (fields === null || !isCatalogTable(fields)) return;
      const prior = fieldTables.get(channelId);
      if (prior !== undefined && JSON.stringify(prior) !== JSON.stringify(fields)) return;
      if (prior === undefined && fieldTables.size >= MAX_CONTEXTS) return;
      fieldTables.set(channelId, [...fields]);
      bridgeChannels.set(context.bridgeId, channelId);
    }
    this.#fieldTables = fieldTables;
    this.#bridgeChannels = bridgeChannels;
  }
}
