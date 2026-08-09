import type { ProviderConnectionStatus } from "@tool-chenh/contracts";

const iconFor = {
  CONNECTING: "◌",
  LIVE: "●",
  DEGRADED: "▲",
  DISCONNECTED: "×",
  SCHEMA_ERROR: "!"
} as const;

export function StatusStrip({ statuses }: { readonly statuses: readonly ProviderConnectionStatus[] }) {
  return (
    <section className="status-strip" aria-label="Provider status">
      {statuses.map((status) => {
        const label = `${status.provider} ${status.category === "FOOTBALL" ? "Football" : "LoL"}: ${status.status}`;
        return (
          <div className={`provider-status provider-status--${status.status.toLowerCase()} provider-status--${status.provider.toLowerCase()}`} key={`${status.adapterId}:${status.category}`} aria-label={label}>
            <span aria-hidden="true" className="status-icon">{iconFor[status.status]}</span>
            <span className="provider-name">{status.provider} · {status.category === "FOOTBALL" ? "Football" : "LoL"}</span>
            <strong>{status.status}</strong>
            {status.detail === null ? null : <span className="status-detail">{status.detail}</span>}
          </div>
        );
      })}
    </section>
  );
}
