export function formatDisplayDecimal(value: string | number, maximumFractionDigits = 5): string {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) return String(value);
  return numeric.toFixed(maximumFractionDigits).replace(/\.?0+$/u, "");
}
