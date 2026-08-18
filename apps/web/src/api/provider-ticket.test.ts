import { describe, expect, it, vi } from "vitest";
import { ProviderTicketApi } from "./provider-ticket.js";

describe("ProviderTicketApi", () => {
  it("resolves an attached CMD source and sends only opaque identity", async () => {
    const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith("/sources")) return new Response(JSON.stringify({ sources: [
        { lobby: "CMD", sourceId: "chrome:CMD:9", state: "LIVE" }
      ] }), { status: 200 });
      expect(JSON.parse(String(init?.body))).toEqual({ sourceId: "chrome:CMD:9", providerEventId: "e",
        providerMarketId: "m", providerSelectionId: "m:home" });
      return new Response(JSON.stringify({ accepted: true }), { status: 202 });
    });
    await new ProviderTicketApi(fetcher as typeof fetch).focus({ provider: "CMD", providerEventId: "e",
      providerMarketId: "m", providerSelectionId: "m:home" });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("maps every provider to its attached lobby before sending the opaque identity", async () => {
    const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith("/sources")) return new Response(JSON.stringify({ sources: [
        { lobby: "SABA", sourceId: "chrome:SABA:7", state: "LIVE" }
      ] }), { status: 200 });
      expect(JSON.parse(String(init?.body))).toEqual({ sourceId: "chrome:SABA:7", providerEventId: "e",
        providerMarketId: "m", providerSelectionId: "s" });
      return new Response(JSON.stringify({ accepted: true }), { status: 202 });
    });
    await new ProviderTicketApi(fetcher as typeof fetch).focus({ provider: "SABA",
      providerEventId: "e", providerMarketId: "m", providerSelectionId: "s" });
  });

  it("fails closed when the requested provider tab is not attached", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ sources: [] }), { status: 200 }));
    await expect(new ProviderTicketApi(fetcher as typeof fetch).focus({ provider: "SABA",
      providerEventId: "e", providerMarketId: "m", providerSelectionId: "s" }))
      .rejects.toThrow("SABA");
  });
});
