import { useEffect, useRef, useState } from "react";
import type { WatchArbitrageAlert } from "../watch/arbitrage-alert.js";

function money(value: string, currency: string): string {
  return `${Number(value).toLocaleString("en-US")} ${currency}`;
}

export function ArbitrageAlertToast({
  alert,
  matchLabel,
  durationMs = 10_000
}: {
  readonly alert: WatchArbitrageAlert | null;
  readonly matchLabel: string;
  readonly durationMs?: number;
}) {
  const [visibleAlert, setVisibleAlert] = useState<WatchArbitrageAlert | null>(null);
  const lastShownFingerprint = useRef<string | null>(null);

  useEffect(() => {
    if (alert === null) {
      setVisibleAlert(null);
      return;
    }
    if (lastShownFingerprint.current === alert.fingerprint) return;
    lastShownFingerprint.current = alert.fingerprint;
    setVisibleAlert(alert);
    const timer = window.setTimeout(() => setVisibleAlert(null), durationMs);
    return () => window.clearTimeout(timer);
  }, [alert?.fingerprint, durationMs]);

  if (visibleAlert === null) return null;
  return <aside className="arbitrage-toast" role="alert">
    <header><strong>READY TO PREFLIGHT</strong><span>Auto closes in 10s</span></header>
    <h2>{matchLabel}</h2>
    <p>{visibleAlert.marketType} · {visibleAlert.scope}{visibleAlert.line === null ? "" : ` · Line ${visibleAlert.line}`}</p>
    <ol>{visibleAlert.legs.map((leg) => <li key={`${leg.provider}-${leg.selection}`}>
      <b>#{leg.provider}</b> · {leg.selection} · odds {leg.decimalOdds} · stake {money(leg.stake, visibleAlert.currency)}
    </li>)}</ol>
    <p><b>Total stake {money(visibleAlert.totalStake, visibleAlert.currency)}</b> · Worst-case profit {money(visibleAlert.worstCaseProfit, visibleAlert.currency)} · ROI {(Number(visibleAlert.roi) * 100).toFixed(2)}%</p>
    <small>Provider preflight is required before placement.</small>
  </aside>;
}
