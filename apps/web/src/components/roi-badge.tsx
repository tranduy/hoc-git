import { roiTone } from "../watch/roi-tone.js";

export function RoiBadge({ roiPercent, className = "", showLabel = true }: {
  readonly roiPercent: string | number;
  readonly className?: string;
  readonly showLabel?: boolean;
}) {
  const value = Number(roiPercent);
  const tone = roiTone(value);
  return <strong className={`roi-badge roi-badge--${tone}${className === "" ? "" : ` ${className}`}`}>
    {showLabel ? "ROI " : ""}{value.toFixed(2)}%
  </strong>;
}
