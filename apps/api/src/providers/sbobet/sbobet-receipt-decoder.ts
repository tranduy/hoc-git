export interface DecodedSbobetReceipt {
  readonly purchaseId: string;
  readonly placementDate: string;
  readonly sportId: string;
  readonly leagueName: string;
  readonly eventDisplayName: string;
  readonly marketDisplayName: string;
  readonly selectionDisplayName: string;
  readonly points: string;
  readonly displayOdds: string;
  readonly totalStake: string;
  readonly potentialReturns: string;
  readonly settlementStatus: string;
  readonly status: string;
  readonly marketTypeId: string;
  readonly startTime: string;
  readonly currency: string;
  readonly oddsStyle: string;
  readonly timePeriod: string;
  readonly betType: string;
}

export interface DecodedSbobetReceiptPage {
  readonly total: number;
  readonly unsupportedCount: number;
  readonly receipts: readonly DecodedSbobetReceipt[];
}

function schemaChanged(): never { throw new Error("SBOBET_RECEIPT_SCHEMA_CHANGED"); }

function unwrapJson(value: unknown): unknown {
  let current = value;
  for (let depth = 0; depth < 3 && typeof current === "string"; depth += 1) {
    const candidate = current.trim();
    if (!candidate.startsWith("{") && !candidate.startsWith("[") && !candidate.startsWith('"')) break;
    try { current = JSON.parse(candidate); } catch { schemaChanged(); }
  }
  return current;
}

function scalar(value: unknown, options: { optional?: boolean; uppercase?: boolean } = {}): string {
  if (value === null || value === undefined) {
    if (options.optional === true) return "";
    return schemaChanged();
  }
  if (typeof value !== "string" && typeof value !== "number") return schemaChanged();
  const result = String(value).trim();
  if (result.length === 0 || result.length > 1_024) {
    if (options.optional === true && result.length === 0) return "";
    return schemaChanged();
  }
  return options.uppercase === true ? result.toUpperCase() : result;
}

function decodeRow(row: unknown[]): DecodedSbobetReceipt | null {
  if (row.length < 38) return schemaChanged();
  const betType = scalar(row[37]);
  if (betType !== "1") return null;
  const currency = scalar(row[19], { uppercase: true });
  if (!/^[A-Z]{3,8}$/u.test(currency)) return schemaChanged();
  return {
    purchaseId: scalar(row[0]), placementDate: scalar(row[1]), sportId: scalar(row[2]),
    leagueName: scalar(row[3]), eventDisplayName: scalar(row[4]), marketDisplayName: scalar(row[5]),
    selectionDisplayName: scalar(row[6]), points: scalar(row[7]), displayOdds: scalar(row[8]),
    totalStake: scalar(row[9]), potentialReturns: scalar(row[10]),
    settlementStatus: scalar(row[11], { optional: true }), status: scalar(row[12]),
    marketTypeId: scalar(row[15]), startTime: scalar(row[18]), currency,
    oddsStyle: scalar(row[25]), timePeriod: scalar(row[35], { optional: true }), betType
  };
}

export function decodeSbobetReceiptHistory(raw: unknown): DecodedSbobetReceiptPage {
  const value = unwrapJson(raw);
  if (value === null || typeof value !== "object" || Array.isArray(value)) return schemaChanged();
  const record = value as Record<string, unknown>;
  if (!Array.isArray(record.betReportingDtos) || !Number.isInteger(record.total) ||
    (record.total as number) < record.betReportingDtos.length || (record.total as number) < 0) return schemaChanged();
  const receipts: DecodedSbobetReceipt[] = [];
  let unsupportedCount = 0;
  for (const item of record.betReportingDtos) {
    if (!Array.isArray(item)) return schemaChanged();
    const decoded = decodeRow(item);
    if (decoded === null) unsupportedCount += 1;
    else receipts.push(decoded);
  }
  return { total: record.total as number, unsupportedCount, receipts };
}
