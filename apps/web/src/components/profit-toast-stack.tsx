import { useEffect, useRef, useState } from "react";
import type { ProfitAlert } from "../watch/profit-alert-tracker.js";

interface SoundLike { play(): Promise<void> | void }

function money(value: string): string {
  return `${Number(value).toLocaleString("en-US")} VND`;
}

export function ProfitToastStack({ alerts, onOpen, sound }: {
  readonly alerts: readonly ProfitAlert[];
  readonly onOpen: (alert: ProfitAlert) => void;
  readonly sound: SoundLike;
}) {
  const [visible, setVisible] = useState<readonly ProfitAlert[]>([]);
  const seen = useRef(new Set<string>());
  const timers = useRef(new Map<string, number>());

  useEffect(() => {
    const incoming = alerts.filter((alert) => !seen.current.has(alert.id));
    if (incoming.length === 0) return;
    for (const alert of incoming) {
      seen.current.add(alert.id);
      void sound.play();
      timers.current.set(alert.id, window.setTimeout(() => {
        setVisible((current) => current.filter((candidate) => candidate.id !== alert.id));
        timers.current.delete(alert.id);
      }, 5_000));
    }
    setVisible((current) => [...current, ...incoming].slice(-5));
  }, [alerts, sound]);

  useEffect(() => () => {
    for (const timer of timers.current.values()) window.clearTimeout(timer);
    timers.current.clear();
  }, []);

  return <aside className="profit-toast-stack" aria-label="Profitable ticket alerts" aria-live="assertive">
    {visible.map((alert) => <button aria-label={`Open profitable ticket ${alert.event.event.participantA} vs ${alert.event.event.participantB}`}
      className="profit-toast" key={alert.id} onClick={() => onOpen(alert)} type="button">
      <strong>{alert.event.event.participantA} vs {alert.event.event.participantB}</strong>
      <span>Guaranteed {money(alert.ticket.plan!.worstCaseProfit)}</span>
      <small>ROI {(Number(alert.ticket.plan!.roi) * 100).toFixed(2)}% · click for exact ticket</small>
    </button>)}
  </aside>;
}
