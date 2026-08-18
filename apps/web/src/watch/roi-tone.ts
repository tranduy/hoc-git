export type RoiTone = "high" | "medium" | "negative";

export function roiTone(roiPercent: string | number): RoiTone {
  const value = Number(roiPercent);
  if (value > 5) return "high";
  if (value >= 0) return "medium";
  return "negative";
}
