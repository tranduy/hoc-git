import { describe, expect, it, vi } from "vitest";
import { ImFootballDirectTransport, type ImFootballRequestTemplate } from "./im-football-direct-transport.js";

const template = (overrides: Partial<ImFootballRequestTemplate> = {}): ImFootballRequestTemplate => ({
  url: "https://imsports.directsb.net/api/EventV6/GetSE",
  headers: { "content-type": "application/json", cookie: "provider-session=private" },
  body: { SportId: 1, Market: 2, BetTypeIds: [1], GamePeriods: [1], OddsType: 2 },
  ...overrides
});

describe("IM Football direct transport", () => {
  it("replays an exact authenticated provider request outside the browser", async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => new Response(JSON.stringify({
      StatusCode: 100, sel: []
    }), { status: 200, headers: { "content-type": "application/json" } }));
    const transport = new ImFootballDirectTransport({ fetchImpl, timeoutMs: 250 });

    await expect(transport.read(template())).resolves.toEqual({ StatusCode: 100, sel: [] });
    expect(fetchImpl).toHaveBeenCalledWith("https://imsports.directsb.net/api/EventV6/GetSE", expect.objectContaining({
      method: "POST",
      body: JSON.stringify(template().body),
      headers: expect.objectContaining({ cookie: "provider-session=private", "content-type": "application/json" })
    }));
  });

  it("is single-flight for the same request template", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const fetchImpl = vi.fn(async () => {
      await gate;
      return new Response(JSON.stringify({ StatusCode: 100, sel: [] }), { status: 200 });
    });
    const transport = new ImFootballDirectTransport({ fetchImpl, timeoutMs: 250 });

    const first = transport.read(template());
    const second = transport.read(template());
    release();

    await expect(Promise.all([first, second])).resolves.toHaveLength(2);
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("fails closed for wrong endpoints, expired auth envelopes and timeouts without leaking secrets", async () => {
    const authFailure = new ImFootballDirectTransport({
      fetchImpl: async () => new Response(JSON.stringify({ StatusCode: 500, sel: [] }), { status: 200 }),
      timeoutMs: 250
    });
    await expect(authFailure.read(template())).rejects.toThrow("IM_FOOTBALL_DIRECT_UNAVAILABLE");
    await expect(authFailure.read(template({ url: "https://evil.test/api/EventV6/GetSE" })))
      .rejects.toThrow("IM_FOOTBALL_DIRECT_UNAVAILABLE");

    const timedOut = new ImFootballDirectTransport({
      fetchImpl: async (_url, init) => new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("provider-session=private", "AbortError")));
      }),
      timeoutMs: 5
    });
    const error = await timedOut.read(template()).catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe("IM_FOOTBALL_DIRECT_UNAVAILABLE");
  });

  it("accepts only the exact snapshot and delta response schemas", async () => {
    const deltaTransport = new ImFootballDirectTransport({
      fetchImpl: async () => new Response(JSON.stringify({ StatusCode: 100, dc: [] }), { status: 200 }),
      timeoutMs: 250
    });
    await expect(deltaTransport.read(template({ url: "https://imsports.directsb.net/api/EventV6/GetSEDelta" })))
      .resolves.toEqual({ StatusCode: 100, dc: [] });
    await expect(deltaTransport.read(template())).rejects.toThrow("IM_FOOTBALL_DIRECT_UNAVAILABLE");
  });
});
