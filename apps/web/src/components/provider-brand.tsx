import type { ProviderId } from "@tool-chenh/contracts";
import type { CSSProperties } from "react";

export const PROVIDER_BRANDS: Readonly<Record<ProviderId, { readonly mark: string; readonly color: string }>> = {
  SABA: { mark: "S", color: "#38bdf8" },
  IM: { mark: "IM", color: "#a78bfa" },
  SBOBET: { mark: "SB", color: "#fb7185" },
  CMD: { mark: "C", color: "#fb923c" },
  APSPORT: { mark: "AP", color: "#34d399" },
  BTI: { mark: "BT", color: "#facc15" },
  FABET: { mark: "FB", color: "#60a5fa" }
};

export function ProviderBrand({ provider, compact = false, label }: {
  readonly provider: ProviderId;
  readonly compact?: boolean;
  readonly label?: string;
}) {
  const brand = PROVIDER_BRANDS[provider];
  const style = { "--provider-color": brand.color, color: brand.color } as CSSProperties;
  return <span className={`provider-brand provider-brand--${provider.toLowerCase()}${compact ? " provider-brand--compact" : ""}`}
    data-testid={`provider-brand-${provider}`} style={style}>
    <svg aria-label={`${provider} logo`} className="provider-brand__icon" role="img" viewBox="0 0 32 32">
      <rect height="30" rx="8" width="30" x="1" y="1" />
      <text dominantBaseline="central" textAnchor="middle" x="16" y="16">{brand.mark}</text>
    </svg>
    <span aria-hidden="true" className="provider-brand__separator">-</span>
    <b className="provider-brand__name" style={{ color: brand.color }}>{label ?? `#${provider}`}</b>
  </span>;
}
