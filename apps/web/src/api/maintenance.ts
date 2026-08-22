export type MaintenanceLevel = "INFO" | "WARN" | "ERROR";
export interface MaintenanceNotification { readonly id: string; readonly atMs: number;
  readonly level: MaintenanceLevel; readonly message: string }
export interface MaintenanceStatus { readonly running: boolean; readonly scheduledHour: 3;
  readonly lastStartedAtMs: number | null; readonly lastCompletedAtMs: number | null;
  readonly lastResult: "SUCCESS" | "FAILED" | null; readonly notifications: readonly MaintenanceNotification[] }

function parseStatus(value: unknown): MaintenanceStatus {
  if (typeof value !== "object" || value === null) throw new Error("Invalid maintenance response");
  const input = value as Partial<MaintenanceStatus>;
  if (typeof input.running !== "boolean" || input.scheduledHour !== 3 || !Array.isArray(input.notifications)) {
    throw new Error("Invalid maintenance response");
  }
  return value as MaintenanceStatus;
}

export class MaintenanceApi {
  readonly #fetch: typeof fetch;
  constructor(fetcher: typeof fetch = window.fetch.bind(window)) { this.#fetch = fetcher; }
  async status(): Promise<MaintenanceStatus> { return this.#request("GET"); }
  async refreshAll(): Promise<MaintenanceStatus> { return this.#request("POST"); }
  async #request(method: "GET" | "POST"): Promise<MaintenanceStatus> {
    const response = await this.#fetch(method === "GET" ? "/api/maintenance" : "/api/maintenance/refresh-all",
      { method, cache: "no-store" });
    if (!response.ok) throw new Error(`Maintenance request failed (${response.status})`);
    return parseStatus(await response.json());
  }
}
