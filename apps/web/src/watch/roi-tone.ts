import { Decimal } from "@tool-chenh/core";

export type RoiTone = "high" | "medium" | "neutral" | "negative";

function finiteDecimal(value: string | number): Decimal | null {
  try { const decimal = new Decimal(value); return decimal.isFinite() ? decimal : null; }
  catch { return null; }
}

export function roiTone(roiPercent: string | number, worstCaseProfit?: string): RoiTone {
  const value = finiteDecimal(roiPercent);
  const profit = worstCaseProfit === undefined ? value : finiteDecimal(worstCaseProfit);
  if (profit === null || profit.isZero()) return "neutral";
  if (profit.lt(0)) return "negative";
  if (value === null || !value.gt(0)) return "neutral";
  return value.gt(5) ? "high" : "medium";
}

export function roiPercentFromRatio(roi: string): string {
  return finiteDecimal(roi)?.mul(100).toString() ?? "NaN";
}

export function formatRoiPercent(roiPercent: string | number): string {
  const value = finiteDecimal(roiPercent);
  if (value === null) return "—";
  return !value.isZero() && value.abs().lt("0.01")
    ? value.isNegative() ? ">-0.01" : "<0.01" : value.toFixed(2);
}

export function formatProfitAmount(amount: string, locale = "en-US"): string {
  const value = finiteDecimal(amount);
  if (value === null) return "—";
  return !value.isZero() && value.abs().lt("0.01")
    ? value.isNegative() ? ">-0.01" : "<0.01" : value.toNumber().toLocaleString(locale);
}
