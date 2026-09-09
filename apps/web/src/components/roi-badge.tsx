import { formatRoiPercent, roiTone } from "../watch/roi-tone.js";

export type RoiBadgeSize = "sm" | "md" | "lg";

export function RoiBadge({ roiPercent, worstCaseProfit, className = "", size = "md", ariaLabel }: {
  readonly roiPercent: string | number;
  readonly worstCaseProfit?: string;
  readonly className?: string;
  /** @deprecated ROI labels are intentionally always visible for consistency. */
  readonly showLabel?: boolean;
  readonly size?: RoiBadgeSize;
  readonly ariaLabel?: string;
}) {
  const tone = roiTone(roiPercent, worstCaseProfit);
  return <div aria-label={ariaLabel} className={`roi-badge roi-badge--${tone} roi-badge--${size}${className === "" ? "" : ` ${className}`}`}>
    ROI {formatRoiPercent(roiPercent)}%
  </div>;
}
