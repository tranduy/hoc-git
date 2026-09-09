import type { ComparisonRow } from "../catalog/comparison.js";
import { conditionalRoi } from "../watch/conditional-roi.js";
import type { FixedBaseStakePlan } from "../watch/fixed-base-stake.js";
import { formatProfitAmount, formatRoiPercent } from "../watch/roi-tone.js";

export function ConditionalRoiNote({ row, plan }: {
  readonly row: Pick<ComparisonRow, "marketType" | "scope" | "line" | "opposition">;
  readonly plan: FixedBaseStakePlan;
}) {
  const value = conditionalRoi(row, plan);
  if (value === null) return null;
  return <span className="conditional-roi-note">
    <strong>ROI khi không hoàn tiền: {formatRoiPercent(value.roiPercent)}%</strong>
    <small>Lãi tối thiểu khi không hoàn: {formatProfitAmount(value.minimumProfit)} {plan.currency}</small>
    <small>Hoàn đủ hai cược: lãi 0 {plan.currency}</small>
  </span>;
}
