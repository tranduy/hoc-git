import { chromium, type Browser } from "playwright";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { ChromeBridgeEnvelope } from "@tool-chenh/contracts";
import { NetworkObserver } from "./network-observer.js";
import { buildSabaSelectionPriceExpression } from "./selection-price.js";

describe("SABA direct visible price probe", () => {
  let browser: Browser;
  beforeAll(async () => { browser = await chromium.launch({ headless: true }); });
  afterAll(async () => { await browser.close(); });

  it("reads the top document directly without walking every frame and timing out", async () => {
    const sendCommand = vi.fn(async (_tabId: number, method: string) => method === "Runtime.evaluate"
      ? { result: { value: { ok: true, rawOdds: "-0.88", observedAtMs: 1_100 } } }
      : {});
    const forwarded: ChromeBridgeEnvelope[] = [];
    const observer = new NetworkObserver({ sendCommand, now: () => 1_100,
      forward: async (envelope) => { forwarded.push(envelope); } });

    await observer.probeSelectionPrice({ lobby: "SABA", sourceId: "chrome:SABA:7", tabId: 7 }, {
      requestId: "saba-price", providerEventId: "132625615", providerMarketId: "1052392272",
      providerSelectionId: "1052392272:away", eventLabel: "Home vs Away",
      participantA: "Home", participantB: "Away", marketType: "FT_AH",
      scope: "FULL_TIME", selection: "AWAY", line: "0.25"
    });

    expect(sendCommand.mock.calls.map(([, method]) => method)).toEqual(["Runtime.evaluate"]);
    expect(JSON.parse(forwarded[0]!.payload.body)).toMatchObject({ status: "FOUND", rawOdds: "-0.88",
      method: "DOM" });
  });

  it("falls through to SABA's sports iframe when the launcher document has no odds", async () => {
    const sendCommand = vi.fn(async (_tabId: number, method: string, params?: Record<string, unknown>) => {
      if (method === "Runtime.evaluate") return params?.contextId === 72
        ? { result: { value: { ok: true, rawOdds: "0.93", observedAtMs: 1_100 } } }
        : { result: { value: { ok: false, reason: "VISIBLE_PRICE_NOT_FOUND" } } };
      if (method === "Page.getFrameTree") return { frameTree: { frame: { id: "top" },
        childFrames: [{ frame: { id: "sports" } }] } };
      return {};
    });
    const forwarded: ChromeBridgeEnvelope[] = [];
    const observer = new NetworkObserver({ sendCommand, now: () => 1_100,
      forward: async (envelope) => { forwarded.push(envelope); } });
    await observer.handleEvent({ lobby: "SABA", sourceId: "chrome:SABA:7", tabId: 7 },
      "Runtime.executionContextCreated", { context: { id: 72,
        auxData: { frameId: "sports", isDefault: true } } });

    await observer.probeSelectionPrice({ lobby: "SABA", sourceId: "chrome:SABA:7", tabId: 7 }, {
      requestId: "saba-price-iframe", providerEventId: "132625615", providerMarketId: "1052392272",
      providerSelectionId: "1052392272:home", eventLabel: "Home vs Away",
      participantA: "Home", participantB: "Away", marketType: "FT_TOTAL",
      scope: "FULL_TIME", selection: "OVER", line: "2.5"
    });

    expect(sendCommand.mock.calls.filter(([, method]) => method === "Runtime.evaluate")).toHaveLength(2);
    expect(JSON.parse(forwarded[0]!.payload.body)).toMatchObject({ status: "FOUND", rawOdds: "0.93" });
  });

  it("reads one exact provider event, market and side from the current SABA DOM", async () => {
    const page = await browser.newPage();
    await page.setContent(`<section class="c-match" data-matchid="132625615">
      <i class="c-odds" data-moid="1052392272">1.00</i>
      <i class="c-odds" data-moid="1052392272">-0.88</i></section>`);
    const value = await page.evaluate(buildSabaSelectionPriceExpression({
      providerEventId: "132625615", providerMarketId: "1052392272",
      providerSelectionId: "1052392272:away", eventLabel: "Home vs Away",
      participantA: "Home", participantB: "Away", marketType: "FT_AH",
      scope: "FULL_TIME", selection: "AWAY", line: "-0.25"
    })) as { ok: boolean; rawOdds?: string };
    expect(value).toEqual(expect.objectContaining({ ok: true, rawOdds: "-0.88" }));
    await page.close();
  });

  it("fails closed as ambiguous when duplicate exact event/market candidates are rendered", async () => {
    const page = await browser.newPage();
    await page.setContent(`<section class="c-match" data-matchid="132625615">
      <i class="c-odds" data-moid="1052392272">1.00</i><i class="c-odds" data-moid="1052392272">-0.88</i></section>
      <section class="c-match" data-matchid="132625615">
      <i class="c-odds" data-moid="1052392272">0.91</i><i class="c-odds" data-moid="1052392272">-0.99</i></section>`);
    const value = await page.evaluate(buildSabaSelectionPriceExpression({
      providerEventId: "132625615", providerMarketId: "1052392272",
      providerSelectionId: "1052392272:home", eventLabel: "Home vs Away",
      participantA: "Home", participantB: "Away", marketType: "FT_AH",
      scope: "FULL_TIME", selection: "HOME", line: "-0.25"
    })) as { ok: boolean; reason?: string };
    expect(value).toEqual({ ok: false, reason: "VISIBLE_PRICE_AMBIGUOUS" });
    await page.close();
  });
});
