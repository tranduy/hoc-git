import { roiTone } from "../watch/roi-tone.js";

export type RoiBadgeSize = "sm" | "md" | "lg";

export function RoiBadge({ roiPercent, className = "", size = "md", ariaLabel }: {
  readonly roiPercent: string | number;
  readonly className?: string;
  /** @deprecated ROI labels are intentionally always visible for consistency. */
  readonly showLabel?: boolean;
  readonly size?: RoiBadgeSize;
  readonly ariaLabel?: string;
}) {
  const value = Number(roiPercent);
  const tone = roiTone(value);
  return <div aria-label={ariaLabel} className={`roi-badge roi-badge--${tone} roi-badge--${size}${className === "" ? "" : ` ${className}`}`}>
    ROI {value.toFixed(2)}%
  </div>;
}
