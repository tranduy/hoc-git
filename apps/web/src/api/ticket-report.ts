import type { TicketRealtimeCheckRequest, TicketRealtimeCheckResponse } from "@tool-chenh/contracts";

export interface TicketReportRequest {
  readonly eventKey: string;
  readonly ticketKey: string;
  readonly reason: string;
  readonly reportedAtMs: number;
  readonly competition: string;
  readonly startAtUtcMs: number;
  readonly display: TicketRealtimeCheckRequest;
  readonly estimate: { readonly state: string; readonly roi: string | null;
    readonly worstCaseProfit: string | null; readonly totalStake: string | null;
    readonly movementMagnitude: string };
  readonly realtimeCheck: TicketRealtimeCheckResponse | null;
}

export interface TicketReportEntry {
  readonly reportId: string;
  readonly createdAtMs: number;
  readonly request: TicketReportRequest;
}

export interface TicketReportApiLike {
  create(request: TicketReportRequest): Promise<TicketReportEntry>;
  list(eventKey: string): Promise<{ readonly reports: readonly TicketReportEntry[] }>;
}

function errorCode(value: unknown, fallback: string): string {
  return typeof value === "object" && value !== null && "error" in value &&
    typeof (value as { error?: unknown }).error === "string" ? (value as { error: string }).error : fallback;
}

function isEntry(value: unknown): value is TicketReportEntry {
  return typeof value === "object" && value !== null && typeof (value as { reportId?: unknown }).reportId === "string" &&
    typeof (value as { createdAtMs?: unknown }).createdAtMs === "number" &&
    typeof (value as { request?: unknown }).request === "object" && (value as { request?: unknown }).request !== null;
}

export class TicketReportApi implements TicketReportApiLike {
  readonly #fetch: typeof fetch;
  constructor(fetcher: typeof fetch = globalThis.fetch.bind(globalThis)) { this.#fetch = fetcher; }

  async create(request: TicketReportRequest): Promise<TicketReportEntry> {
    const response = await this.#fetch("/api/ticket-reports", { method: "POST", cache: "no-store",
      headers: { "content-type": "application/json" }, body: JSON.stringify(request) });
    const value: unknown = await response.json().catch(() => null);
    if (!response.ok) throw new Error(errorCode(value, `Ticket report failed (${response.status})`));
    if (!isEntry(value)) throw new Error("INVALID_TICKET_REPORT_RESPONSE");
    return value;
  }

  async list(eventKey: string): Promise<{ readonly reports: readonly TicketReportEntry[] }> {
    const response = await this.#fetch(`/api/ticket-reports?eventKey=${encodeURIComponent(eventKey)}`,
      { cache: "no-store" });
    const value: unknown = await response.json().catch(() => null);
    if (!response.ok) throw new Error(errorCode(value, `Ticket reports failed (${response.status})`));
    if (typeof value !== "object" || value === null || !("reports" in value) ||
      !Array.isArray((value as { reports?: unknown }).reports) ||
      !(value as { reports: unknown[] }).reports.every(isEntry)) throw new Error("INVALID_TICKET_REPORTS_RESPONSE");
    return { reports: (value as { reports: TicketReportEntry[] }).reports };
  }
}

export const defaultTicketReportApi = new TicketReportApi();
