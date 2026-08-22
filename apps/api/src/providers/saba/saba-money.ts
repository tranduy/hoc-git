import { Decimal } from "@tool-chenh/core";

const plainDecimal = /^(?:0|[1-9]\d*)(?:\.\d+)?$/u;

export interface NormalizedSabaMoney {
  readonly currency: "VND";
  readonly amount: string;
  readonly unitScale: "1" | "1000";
}

export function normalizeSabaMoney(input: {
  readonly currency: string;
  readonly amount: string;
}): NormalizedSabaMoney | null {
  if (!plainDecimal.test(input.amount)) return null;
  const unitScale = input.currency === "INH" ? "1000" : input.currency === "VND" ? "1" : null;
  if (unitScale === null) return null;
  const amount = new Decimal(input.amount).mul(unitScale);
  if (!amount.isFinite() || amount.lt(0)) return null;
  return { currency: "VND", amount: amount.toFixed(amount.decimalPlaces()), unitScale };
}
