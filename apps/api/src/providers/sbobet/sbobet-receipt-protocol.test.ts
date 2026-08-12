import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser } from "playwright";
import {
  inspectReadOnlyReceiptProtocol,
  isSafeReceiptHistoryLabel,
  safeReceiptResponseCandidate
} from "./sbobet-receipt-protocol.js";

describe("SBOBET read-only receipt protocol", () => {
  let browser: Browser;
  let server: Server;
  let origin: string;

  beforeAll(async () => {
    server = createServer((request, response) => {
      if (request.url?.startsWith("/api/bet-history") === true) {
        response.setHeader("content-type", "application/json");
        response.end(JSON.stringify({
          byId: { "secret-ticket": { status: "accepted" } },
          rows: [{ ticketId: "secret-ticket", stake: 100_000, status: "accepted" }]
        }));
        return;
      }
      if (request.url === "/api/v2/member/report") {
        response.setHeader("content-type", "application/json");
        response.end(JSON.stringify({ entries: [{ reference: "secret-reference", result: "won" }] }));
        return;
      }
      if (request.url?.startsWith("/api/v2/bet/getBetsReporting") === true) {
        response.setHeader("content-type", "application/json");
        const settled = new URL(request.url, "http://127.0.0.1").searchParams.get("status") === "Settled";
        response.end(JSON.stringify(JSON.stringify(settled
          ? { betReportingDtos: [["secret-ticket", "2026-08-12", 1, "league", "home vs away",
            "handicap", "home", "-0.5", "1.8", "100000", "180000", null, "Settled", null,
            "1-0", 1, "0-0", null, "2026-08-12", "VND"]], total: 1 }
          : { betReportingDtos: [], total: 0 })));
        return;
      }
      response.setHeader("content-type", "text/html; charset=utf-8");
      response.end(`<!doctype html><button id="history">Lịch sử cược</button><button id="submit">Đặt cược</button>
        <script>document.querySelector('#history').onclick=()=>fetch('/api/bet-history?token=secret-token')</script>`);
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("server did not bind");
    origin = `http://127.0.0.1:${address.port}`;
    browser = await chromium.launch({ headless: true });
  });

  afterAll(async () => {
    await browser.close();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  });

  it("allows only an exact read-only history control", () => {
    expect(isSafeReceiptHistoryLabel("Lịch sử cược")).toBe(true);
    expect(isSafeReceiptHistoryLabel("LỊCH SỬ CƯỢC")).toBe(true);
    expect(isSafeReceiptHistoryLabel("Bet history")).toBe(true);
    expect(isSafeReceiptHistoryLabel("Đặt cược")).toBe(false);
    expect(isSafeReceiptHistoryLabel("Phiếu đặt cược")).toBe(false);
    expect(isSafeReceiptHistoryLabel("Bet history and place bet")).toBe(false);
  });

  it("accepts case variants while still requiring the whole history label", async () => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.setContent("<button>LỊCH SỬ CƯỢC</button>");
    await expect(inspectReadOnlyReceiptProtocol(context, page, { waitMs: 0 }))
      .resolves.toEqual({ controlLabel: "Lịch sử cược", observations: [] });
    await context.close();
  });

  it("rejects state-changing response paths even when they mention history", () => {
    expect(safeReceiptResponseCandidate("GET", `${origin}/api/bet-history?token=secret`)).toBe(true);
    expect(safeReceiptResponseCandidate("POST", `${origin}/api/bet-history`)).toBe(true);
    expect(safeReceiptResponseCandidate("POST", `${origin}/api/bet-history/submit`)).toBe(false);
    expect(safeReceiptResponseCandidate("POST", `${origin}/api/place-wager-history`)).toBe(false);
    expect(safeReceiptResponseCandidate("GET", `${origin}/npm.historyc8ed28.js`)).toBe(false);
  });

  it("clicks only history and returns structural metadata without secret values", async () => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(origin);

    const result = await inspectReadOnlyReceiptProtocol(context, page, { waitMs: 100 });

    expect(result.controlLabel).toBe("Lịch sử cược");
    expect(result.observations).toEqual([expect.objectContaining({
      hostname: "127.0.0.1",
      method: "GET",
      pathTemplate: "/api/bet-history",
      status: 200,
      contentType: "application/json",
      shape: "object{byId:object{:key:object{status:string}},rows:array<object{stake:number,status:string,ticketId:string}>}"
    })]);
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("secret-token");
    expect(serialized).not.toContain("secret-ticket");
    expect(serialized).not.toContain("100000");
    expect(serialized).not.toContain("accepted");
    await context.close();
  });

  it("captures an opaque XHR endpoint caused by the exact history control", async () => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(origin);
    await page.setContent(`<button id="history">Bet history</button>
      <script>document.querySelector('#history').onclick=()=>fetch('/api/v2/member/report')</script>`);

    const result = await inspectReadOnlyReceiptProtocol(context, page, { waitMs: 100 });

    expect(result.observations).toEqual([expect.objectContaining({
      method: "GET", pathTemplate: "/api/v2/member/report",
      shape: "object{entries:array<object{reference:string,result:string}>}"
    })]);
    expect(JSON.stringify(result)).not.toContain("secret-reference");
    await context.close();
  });

  it("also inspects settled history read-only without exposing request credentials or row values", async () => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(origin);
    await page.setContent(`<button id="history">Bet history</button>
      <script>document.querySelector('#history').onclick=()=>fetch('/api/v2/bet/getBetsReporting')</script>`);

    const result = await inspectReadOnlyReceiptProtocol(context, page, { waitMs: 100 });

    expect(result.observations).toEqual(expect.arrayContaining([
      expect.objectContaining({
        pathTemplate: "/api/v2/bet/getBetsReporting",
        shape: "json-string<object{betReportingDtos:array<empty>,total:number}>"
      }),
      expect.objectContaining({
        pathTemplate: "/api/v2/bet/getBetsReporting",
        shape: expect.stringContaining("betReportingDtos:array<array<")
      })
    ]));
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("secret-ticket");
    expect(serialized).not.toContain("100000");
    expect(serialized).not.toContain("status=Settled");
    await context.close();
  });

  it("fails closed without an exact history control", async () => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.setContent("<button>Bet slip</button><button>Place bet</button>");
    await expect(inspectReadOnlyReceiptProtocol(context, page, { waitMs: 0 }))
      .rejects.toThrow("SBOBET_HISTORY_CONTROL_UNAVAILABLE");
    await context.close();
  });

  it("finds the exact history control on another page in the authenticated context", async () => {
    const context = await browser.newContext();
    const catalog = await context.newPage();
    await catalog.setContent("<main>Sports catalog</main>");
    const shell = await context.newPage();
    await shell.goto(origin);

    const result = await inspectReadOnlyReceiptProtocol(context, catalog, { waitMs: 100 });

    expect(result.controlLabel).toBe("Lịch sử cược");
    expect(result.observations).toHaveLength(1);
    await context.close();
  });

  it("uses an exact history label nested inside a provider clickable container", async () => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.setContent(`<div onclick="document.body.dataset.opened='history'"><span>Lịch sử cược</span></div>
      <div onclick="document.body.dataset.opened='slip'"><span>Phiếu đặt cược</span></div>`);

    const result = await inspectReadOnlyReceiptProtocol(context, page, { waitMs: 0 });

    expect(result.controlLabel).toBe("Lịch sử cược");
    expect(await page.locator("body").getAttribute("data-opened")).toBe("history");
    await context.close();
  });

  it("clicks an exact history label wired by a framework without DOM click attributes", async () => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.setContent("<div><span id='history-label'>Lịch sử cược</span></div><script>document.querySelector('#history-label').addEventListener('click',()=>document.body.dataset.opened='history')</script>");

    await inspectReadOnlyReceiptProtocol(context, page, { waitMs: 0 });

    expect(await page.locator("body").getAttribute("data-opened")).toBe("history");
    await context.close();
  });
});
