import { PreflightTicketSchema, TwoLegExecutionResultSchema, type ExecutionRequest,
  type PreflightRequest, type PreflightTicket, type TwoLegExecutionResult } from "@tool-chenh/contracts";

export interface ExecutionApiLike {
  preflight(request: PreflightRequest): Promise<PreflightTicket>;
  dryRun(request: ExecutionRequest): Promise<TwoLegExecutionResult>;
}

export class ExecutionApi implements ExecutionApiLike {
  readonly #fetch: typeof fetch;
  constructor(fetcher: typeof fetch = window.fetch.bind(window)) { this.#fetch = fetcher; }

  async preflight(request: PreflightRequest): Promise<PreflightTicket> {
    const value = await this.#post("/api/preflight", request);
    if (typeof value !== "object" || value === null || !("ticket" in value)) throw new Error("Invalid preflight response");
    const parsed = PreflightTicketSchema.safeParse((value as { ticket: unknown }).ticket);
    if (!parsed.success) throw new Error("Invalid preflight response");
    return parsed.data;
  }

  async dryRun(request: ExecutionRequest): Promise<TwoLegExecutionResult> {
    const parsed = TwoLegExecutionResultSchema.safeParse(await this.#post("/api/execution/dry-run", request));
    if (!parsed.success) throw new Error("Invalid dry-run response");
    return parsed.data;
  }

  async #post(url: string, body: object): Promise<unknown> {
    const response = await this.#fetch(url, { method: "POST", cache: "no-store",
      headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    if (!response.ok) {
      const value = await response.json().catch(() => null) as { error?: unknown } | null;
      throw new Error(typeof value?.error === "string" ? value.error : `Request failed (${response.status})`);
    }
    return response.json();
  }
}

export const defaultExecutionApi = new ExecutionApi();
