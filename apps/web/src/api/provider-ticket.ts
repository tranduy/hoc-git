import type { ProviderId } from "@tool-chenh/contracts";

export interface ProviderTicketIdentity {
  readonly provider: ProviderId;
  readonly providerEventId: string;
  readonly providerMarketId: string;
  readonly providerSelectionId: string;
}

export interface ProviderTicketApiLike {
  features(): Promise<{ readonly openProviderTicket: boolean }>;
  focus(identity: ProviderTicketIdentity): Promise<void>;
}

interface SourceRow { readonly lobby: string; readonly sourceId: string; readonly state: string }

const providerLobbies: Readonly<Partial<Record<ProviderId, readonly string[]>>> = {
  SABA: ["SABA"], IM: ["IM"], SBOBET: ["KSPORT", "SBO"], CMD: ["CMD"],
  APSPORT: ["TSPORT"], BTI: ["BTI"]
};

export class ProviderTicketApi implements ProviderTicketApiLike {
  readonly #fetch: typeof fetch;
  constructor(fetcher: typeof fetch = window.fetch.bind(window)) { this.#fetch = fetcher; }

  async features(): Promise<{ readonly openProviderTicket: boolean }> {
    const response = await this.#fetch("/api/chrome-bridge/features", { cache: "no-store" });
    if (!response.ok) return { openProviderTicket: false };
    const value: unknown = await response.json();
    return { openProviderTicket: typeof value === "object" && value !== null &&
      (value as Record<string, unknown>).openProviderTicket === true };
  }

  async focus(identity: ProviderTicketIdentity): Promise<void> {
    const sourcesResponse = await this.#fetch("/api/chrome-bridge/sources", { cache: "no-store" });
    if (!sourcesResponse.ok) throw new Error("Không đọc được trạng thái tab nhà cái.");
    const payload: unknown = await sourcesResponse.json();
    const sources = typeof payload === "object" && payload !== null &&
      Array.isArray((payload as Record<string, unknown>).sources)
      ? (payload as { sources: SourceRow[] }).sources : [];
    const lobbies = providerLobbies[identity.provider] ?? [];
    const providerSources = sources.filter((item) => lobbies.includes(item.lobby));
    const source = providerSources.find((item) => item.state === "LIVE") ??
      providerSources.find((item) => !["ERROR", "DISCONNECTED"].includes(item.state));
    if (!source) throw new Error(`Tab ${identity.provider} chưa được attach hoặc đã ngắt kết nối.`);
    const response = await this.#fetch("/api/chrome-bridge/focus-selection", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ sourceId: source.sourceId, providerEventId: identity.providerEventId,
        providerMarketId: identity.providerMarketId, providerSelectionId: identity.providerSelectionId })
    });
    if (!response.ok) throw new Error(`Không thể mở kèo trên tab ${identity.provider}.`);
  }
}
