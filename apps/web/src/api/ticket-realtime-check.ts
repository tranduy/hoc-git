import { TicketRealtimeCheckRequestSchema, TicketRealtimeCheckResponseSchema,
  type TicketRealtimeCheckRequest, type TicketRealtimeCheckResponse } from "@tool-chenh/contracts";

export interface TicketRealtimeCheckApiLike {
  check(request: TicketRealtimeCheckRequest): Promise<TicketRealtimeCheckResponse>;
}

export class TicketRealtimeCheckApi implements TicketRealtimeCheckApiLike {
  readonly #fetch: typeof fetch;
  constructor(fetcher: typeof fetch = globalThis.fetch.bind(globalThis)) { this.#fetch = fetcher; }

  async check(input: TicketRealtimeCheckRequest): Promise<TicketRealtimeCheckResponse> {
    const request = TicketRealtimeCheckRequestSchema.safeParse(input);
    if (!request.success) throw new Error("Invalid realtime ticket check request");
    const response = await this.#fetch("/api/preflight/realtime-check", { method: "POST", cache: "no-store",
      headers: { "content-type": "application/json" }, body: JSON.stringify(request.data) });
    const value = await response.json().catch(() => null) as unknown;
    if (!response.ok) {
      const error = typeof value === "object" && value !== null && "error" in value &&
        typeof (value as { error: unknown }).error === "string" ? (value as { error: string }).error
        : `Realtime ticket check failed (${response.status})`;
      throw new Error(error);
    }
    const parsed = TicketRealtimeCheckResponseSchema.safeParse(value);
    if (!parsed.success) throw new Error("Invalid realtime ticket check response");
    return parsed.data;
  }
}

export const defaultTicketRealtimeCheckApi = new TicketRealtimeCheckApi();
