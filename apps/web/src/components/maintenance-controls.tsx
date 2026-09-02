import { useEffect, useRef, useState } from "react";
import { MaintenanceApi, type MaintenanceStatus } from "../api/maintenance.js";
import type { ProfitAlert } from "../watch/profit-alert-tracker.js";

interface MaintenanceApiLike {
  status(): Promise<MaintenanceStatus>;
  refreshAll(): Promise<MaintenanceStatus>;
}

const defaultApi = new MaintenanceApi();
const money = new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 0 });

function RestartIcon() {
  return <svg aria-hidden="true" className="maintenance-restart-icon" viewBox="0 0 24 24">
    <path d="M20 11a8 8 0 1 0-2.34 5.66M20 4v7h-7" fill="none" stroke="currentColor"
      strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" />
  </svg>;
}

export function MaintenanceControls({ api = defaultApi, profitAlerts = [] }: {
  readonly api?: MaintenanceApiLike;
  readonly profitAlerts?: readonly ProfitAlert[];
}) {
  const [status, setStatus] = useState<MaintenanceStatus | null>(null);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [starting, setStarting] = useState(false);
  const [progress, setProgress] = useState(0);
  const notificationLayer = useRef<HTMLDivElement>(null);
  const running = starting || status?.running === true;

  useEffect(() => {
    let active = true;
    const refresh = (): void => { void api.status().then((value) => {
      if (active) setStatus(value);
    }).catch(() => undefined); };
    refresh();
    const timer = window.setInterval(refresh, status?.running === true ? 1_000 : 10_000);
    return () => { active = false; window.clearInterval(timer); };
  }, [api, status?.running]);

  useEffect(() => {
    if (!notificationsOpen) return;
    const closeOutside = (event: PointerEvent): void => {
      if (event.target instanceof Node && !notificationLayer.current?.contains(event.target)) {
        setNotificationsOpen(false);
      }
    };
    document.addEventListener("pointerdown", closeOutside, true);
    return () => document.removeEventListener("pointerdown", closeOutside, true);
  }, [notificationsOpen]);

  useEffect(() => {
    if (!running) { setProgress(0); return; }
    setProgress(5);
    const timer = window.setInterval(() => setProgress((value) => Math.min(90, value + (value < 50 ? 5 : 2))), 450);
    return () => window.clearInterval(timer);
  }, [running]);

  const run = async (): Promise<void> => {
    setStarting(true);
    try { setStatus(await api.refreshAll()); }
    catch { /* reset failures are not notification history */ }
    finally { setStarting(false); }
  };

  const notifications = profitAlerts.slice(0, 100);
  return <>
    <div className="maintenance-inline-actions" ref={notificationLayer}>
      <button aria-busy={running} aria-label="Reset sàn" className="maintenance-restart-button"
        disabled={running} onClick={() => void run()} title="Kiểm tra và khôi phục tất cả nguồn" type="button">
        <RestartIcon /><span>{running ? "Đang reset…" : "Reset sàn"}</span>
      </button>
      <button aria-expanded={notificationsOpen} aria-label={`Kèo profit (${notifications.length})`}
        className="maintenance-bell" onClick={() => setNotificationsOpen((value) => !value)} type="button">
        🔔{notifications.length > 0 && <span>{notifications.length}</span>}
      </button>
      {notificationsOpen && <aside className="maintenance-popover profit-history" aria-label="100 kèo profit gần nhất">
        <header><strong>Kèo profit trên 5%</strong><small>{notifications.length}/100 kèo</small></header>
        {notifications.length === 0 ? <p>Chưa có kèo profit trên 5%.</p> : notifications.map((item) =>
          <article className="maintenance-notice profit-history__item" key={item.id}>
            <time>{new Date(item.observedAtMs).toLocaleString("vi-VN")}</time>
            <strong>{item.matchName}</strong>
            <span>{item.marketName}{item.line === null ? "" : ` · Line ${item.line}`}</span>
            <span>{item.legs.map((leg) => `${leg.provider}: ${leg.selection}`).join(" ↔ ")}</span>
            <b>ROI {(Number(item.roi) * 100).toFixed(2)}% · {money.format(Number(item.worstCaseProfit))} {item.currency}</b>
          </article>)}
      </aside>}
    </div>

    {running && <div aria-label="Đang làm mới tất cả sảnh" aria-live="assertive"
      className="maintenance-fullscreen-progress" role="status">
      <div className="maintenance-progress-card">
        <span className="maintenance-progress-restart"><RestartIcon /></span>
        <strong>Đang làm mới tất cả sảnh</strong>
        <p>Đang làm mới session và khởi động lại các reader. Vui lòng chờ hoàn tất.</p>
        <div aria-valuemax={100} aria-valuemin={0} aria-valuenow={progress} className="maintenance-progress-track" role="progressbar">
          <span style={{ width: `${progress}%` }} />
        </div>
        <b>{progress}%</b>
      </div>
    </div>}
  </>;
}
