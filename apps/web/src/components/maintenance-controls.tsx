import { useEffect, useRef, useState } from "react";
import { MaintenanceApi, type MaintenanceStatus } from "../api/maintenance.js";

interface MaintenanceApiLike {
  status(): Promise<MaintenanceStatus>;
  refreshAll(): Promise<MaintenanceStatus>;
}

const defaultApi = new MaintenanceApi();

function RestartIcon() {
  return <svg aria-hidden="true" className="maintenance-restart-icon" viewBox="0 0 24 24">
    <path d="M20 11a8 8 0 1 0-2.34 5.66M20 4v7h-7" fill="none" stroke="currentColor"
      strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" />
  </svg>;
}

export function MaintenanceControls({ api = defaultApi }: { readonly api?: MaintenanceApiLike }) {
  const [status, setStatus] = useState<MaintenanceStatus | null>(null);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [progress, setProgress] = useState(0);
  const notificationLayer = useRef<HTMLDivElement>(null);
  const running = starting || status?.running === true;

  useEffect(() => {
    let active = true;
    const refresh = (): void => { void api.status().then((value) => {
      if (active) { setStatus(value); setError(null); }
    }).catch(() => { if (active) setError("Không đọc được trạng thái bảo trì"); }); };
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
    try { setStatus(await api.refreshAll()); setError(null); }
    catch { setError("Không thể bắt đầu làm mới các sảnh"); }
    finally { setStarting(false); }
  };

  const notifications = status?.notifications ?? [];
  return <>
    <div className="maintenance-inline-actions" ref={notificationLayer}>
      <button aria-busy={running} aria-label="Reset sàn" className="maintenance-restart-button"
        disabled={running} onClick={() => void run()} title="Kiểm tra và khôi phục tất cả nguồn" type="button">
        <RestartIcon /><span>{running ? "Đang reset…" : "Reset sàn"}</span>
      </button>
      <button aria-expanded={notificationsOpen} aria-label={`Thông báo hệ thống (${notifications.length})`}
        className="maintenance-bell" onClick={() => setNotificationsOpen((value) => !value)} type="button">
        🔔{notifications.length > 0 && <span>{notifications.length}</span>}
      </button>
      {notificationsOpen && <aside className="maintenance-popover" aria-label="10 thông báo hệ thống gần nhất">
        <header><strong>Thông báo hệ thống</strong><small>Tự chạy mỗi ngày lúc 03:00</small></header>
        {notifications.length === 0 ? <p>Chưa có thông báo.</p> : notifications.map((item) =>
          <div className={`maintenance-notice maintenance-notice--${item.level.toLowerCase()}`} key={item.id}>
            <time>{new Date(item.atMs).toLocaleString("vi-VN")}</time><span>{item.message}</span>
          </div>)}
        {error !== null && <p role="alert">{error}</p>}
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
