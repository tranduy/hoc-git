import { createHash } from "node:crypto";
import { join } from "node:path";
import type { SbobetCatalogInputRecord } from "@tool-chenh/adapters";
import { chromium, type BrowserContext, type Page, type Response, type WebSocket } from "playwright";
import {
  appendBoundedSbobetSocketPayload, correlateSbobetPublicIds, decodeSbobetJsonBody,
  decodeSbobetStompBodies, isSbobetResponseCandidate
} from "./sbobet-stomp.js";
import { extractSbobetDirectCatalogRecords } from "./sbobet-direct-catalog.js";

interface OpenSession {
  readonly context: BrowserContext;
  readonly page: Page;
  readonly socketPayloads: string[];
  readonly httpPayloads: string[];
  readonly responseTasks: Set<Promise<void>>;
  readonly eventPayloads: string[];
  readonly eventClock: { value: { readonly observedAtMs: number; readonly receivedMonotonicMs: number } | null };
  readonly eventRequest: { value: { readonly url: string; readonly headers: Readonly<Record<string, string>> } | null };
}

export interface SbobetCatalogSnapshot {
  readonly records: readonly SbobetCatalogInputRecord[];
  readonly observedAtMs: number;
  readonly receivedMonotonicMs: number;
}

function safeLaunchUrl(value: string): string {
  if (value.length === 0 || value.length > 24_000) throw new Error("SBOBET_LAUNCH_URL_INVALID");
  const parsed = new URL(value);
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.hostname.length === 0) throw new Error("SBOBET_LAUNCH_URL_INVALID");
  return value;
}

export async function extractSbobetRecords(page: Page): Promise<readonly SbobetCatalogInputRecord[]> {
  return page.locator(".wrapper-match-component").evaluateAll((nodes) => nodes.map((node) => {
    const text = (element: Element | null): string => element?.textContent?.trim().replace(/\s+/gu, " ") ?? "";
    const id = node.getAttribute("id")?.match(/wrapper-match-component-([^\s-]+)/u)?.[1] ?? "";
    const league = text(node.closest(".league-component")?.querySelector(".league-name") ?? null);
    const teams = [...node.querySelectorAll(".row-team-name")].slice(0, 2).map(text);
    const timeText = text(node.querySelector(".game-time"));
    const scoreText = text(node.querySelector(".game-score")) || null;
    const columns = [...node.querySelectorAll(".match-item .promotion-market, .match-item .un-promotion")];
    const market = (column: Element | undefined) => {
      if (column === undefined) return null;
      const odds = [...column.querySelectorAll(".odd-item")];
      const rateLabels = [...column.querySelectorAll(".odd-row .rate-asian")].map(text);
      const marketType: "FT_AH" | "FT_TOTAL" | "FT_1X2" = odds.length >= 3 ? "FT_1X2"
        : rateLabels.some((label) => /^[ou]$/iu.test(label)) ? "FT_TOTAL" : "FT_AH";
      const expected = marketType === "FT_TOTAL" ? ["OVER", "UNDER"] : marketType === "FT_AH"
        ? ["HOME", "AWAY"] : ["HOME", "DRAW", "AWAY"];
      const selections = odds.slice(0, expected.length).map((odd, index) => {
        const selectionId = odd.getAttribute("id")?.replace(/^odd-item-/u, "") ?? "";
        const suffix = selectionId.slice(-1).toLowerCase();
        const selection = marketType === "FT_TOTAL" ? (suffix === "h" ? "OVER" : suffix === "a" ? "UNDER" : expected[index]!)
          : suffix === "h" ? "HOME" : suffix === "d" ? "DRAW" : suffix === "a" ? "AWAY" : expected[index]!;
        const row = odd.closest(".odd-row");
        const lineText = marketType === "FT_AH"
          ? text(row?.querySelector(".rate-asian") ?? null).match(/[+-]?\d+(?:\.\d+)?(?:\s*[\/-]\s*\d+(?:\.\d+)?)?/u)?.[0] ?? null : undefined;
        return { selectionId, selection, priceText: text(odd.querySelector(".odd-val")),
        ...(marketType === "FT_AH" ? { lineText } : {}),
        locked: odd.querySelector(".odd-lock") !== null || text(odd.querySelector(".odd-val")) === ""
      }; });
      let lineText: string | null = null;
      if (marketType === "FT_TOTAL") {
        lineText = rateLabels.map((label) => label.match(/\d+(?:\.\d+)?(?:\s*[-/]\s*\d+(?:\.\d+)?)?/u)?.[0] ?? null)
          .find((value) => value !== null) ?? null;
      } else if (marketType === "FT_AH") {
        lineText = selections.find((selection) => "lineText" in selection && selection.lineText !== null)?.lineText ?? null;
      }
      return { marketId: `${id}:${marketType}:${lineText ?? ""}`, marketType, lineText, selections };
    };
    const extracted = columns.flatMap((column) => {
      const value = market(column);
      return value === null || value.selections.length === 0 ? [] : [value];
    });
    const markets = extracted.filter((candidate, index) =>
      extracted.findIndex((market) => market.marketType === candidate.marketType) === index);
    return { eventId: id, leagueName: league, timeText, scoreText, teamNames: teams, markets };
  })) as Promise<readonly SbobetCatalogInputRecord[]>;
}

export async function isSbobetCatalogReady(page: Page): Promise<boolean> {
  return page.locator(".wrapper-match-component").evaluateAll((nodes) => nodes.some((node) => {
    const text = (element: Element | null): string => element?.textContent?.trim().replace(/\s+/gu, " ") ?? "";
    const eventId = node.getAttribute("id")?.match(/wrapper-match-component-([^\s-]+)/u)?.[1] ?? "";
    const league = text(node.closest(".league-component")?.querySelector(".league-name") ?? null);
    const teams = [...node.querySelectorAll(".row-team-name")].slice(0, 2).map(text).filter(Boolean);
    const hasPrice = [...node.querySelectorAll(".odd-item .odd-val")].some((odd) => text(odd).length > 0);
    return eventId.length > 0 && league.length > 0 && teams.length === 2 && hasPrice;
  }));
}

export class PlaywrightSbobetBrowserManager {
  readonly #profilesRoot: string; readonly #headless: boolean; readonly #timeout: number;
  readonly #sessions = new Map<string, OpenSession>(); readonly #opening = new Map<string, Promise<OpenSession>>();
  readonly #reads = new Map<string, Promise<SbobetCatalogSnapshot>>();
  readonly #correlationReported = new Set<string>();
  readonly #correlationSummaryReported = new Set<string>();
  constructor(options: { profilesRoot: string; headless?: boolean; startupTimeoutMs?: number }) {
    this.#profilesRoot = options.profilesRoot; this.#headless = options.headless ?? false; this.#timeout = options.startupTimeoutMs ?? 30_000;
  }
  async verifyLaunch(launchUrl: string): Promise<boolean> {
    const id = `verify-${createHash("sha256").update(launchUrl).digest("hex").slice(0, 20)}`;
    try { const session = await this.#open({ sessionId: id, launchUrl });
      return await session.page.locator(".wrapper-match-component .odd-item").first().isVisible({ timeout: this.#timeout });
    } catch { return false; } finally { const session = this.#sessions.get(id); this.#sessions.delete(id); await session?.context.close().catch(() => undefined); }
  }
  async readCatalog(input: { sessionId: string; launchUrl: string }): Promise<SbobetCatalogSnapshot> {
    const active = this.#reads.get(input.sessionId);
    if (active !== undefined) return active;
    const next = this.#readCatalog(input).finally(() => {
      if (this.#reads.get(input.sessionId) === next) this.#reads.delete(input.sessionId);
    });
    this.#reads.set(input.sessionId, next);
    return next;
  }
  async #readCatalog(input: { sessionId: string; launchUrl: string }): Promise<SbobetCatalogSnapshot> {
    let session = await this.#get(input);
    try {
      return await this.#readDirectCatalog(input.sessionId, session);
    }
    catch {
      await session.context.close().catch(() => undefined); this.#sessions.delete(input.sessionId);
      session = await this.#get(input);
      return this.#readDirectCatalog(input.sessionId, session);
    }
  }
  async close(): Promise<void> { const all = [...this.#sessions.values()]; this.#sessions.clear(); await Promise.allSettled(all.map((item) => item.context.close())); }
  async #get(input: { sessionId: string; launchUrl: string }): Promise<OpenSession> {
    const existing = this.#sessions.get(input.sessionId); if (existing !== undefined && !existing.page.isClosed()) return existing;
    const opening = this.#opening.get(input.sessionId); if (opening !== undefined) return opening;
    const next = this.#open(input).finally(() => this.#opening.delete(input.sessionId)); this.#opening.set(input.sessionId, next); return next;
  }
  async #open(input: { sessionId: string; launchUrl: string }): Promise<OpenSession> {
    const context = await chromium.launchPersistentContext(join(this.#profilesRoot,
      `sbobet-${createHash("sha256").update(input.sessionId).digest("hex").slice(0, 24)}`),
    { headless: this.#headless, acceptDownloads: false });
    const socketPayloads: string[] = [];
    const httpPayloads: string[] = [];
    const responseTasks = new Set<Promise<void>>();
    const eventPayloads: string[] = [];
    const eventClock = { value: null as { readonly observedAtMs: number; readonly receivedMonotonicMs: number } | null };
    const eventRequest = {
      value: null as { readonly url: string; readonly headers: Readonly<Record<string, string>> } | null
    };
    const attachSocket = (socket: WebSocket): void => {
      socket.on("framereceived", (event) => {
        if (typeof event.payload !== "string") return;
        appendBoundedSbobetSocketPayload(socketPayloads, event.payload);
      });
    };
    const captureResponse = async (response: Response): Promise<void> => {
      if (response.status() !== 200 ||
        !isSbobetResponseCandidate(response.url(), response.request().resourceType())) return;
      try {
        const payload = await response.text();
        appendBoundedSbobetSocketPayload(httpPayloads, payload);
        const url = new URL(response.url());
        if (url.pathname === "/api/v2/getEvent") {
          appendBoundedSbobetSocketPayload(eventPayloads, payload, {
            maxFrameChars: 4_000_000, maxTotalChars: 8_000_000, maxFrames: 2
          });
          eventClock.value = { observedAtMs: Date.now(), receivedMonotonicMs: performance.now() };
          eventRequest.value = { url: response.url(), headers: await response.request().allHeaders() };
        }
      } catch { /* fail closed */ }
    };
    context.on("response", (response) => {
      const task = captureResponse(response).finally(() => responseTasks.delete(task));
      responseTasks.add(task);
    });
    const attachPage = (page: Page): void => { page.on("websocket", attachSocket); };
    context.pages().forEach(attachPage);
    context.on("page", attachPage);
    try { const launcher = context.pages()[0] ?? await context.newPage();
      await launcher.goto(safeLaunchUrl(input.launchUrl), { waitUntil: "domcontentloaded", timeout: this.#timeout });
      const deadline = Date.now() + this.#timeout; let found: Page | null = null;
      while (found === null && Date.now() < deadline) {
        for (const page of context.pages()) if (await isSbobetCatalogReady(page)) { found = page; break; }
        if (found === null) await launcher.waitForTimeout(250);
      }
      if (found === null) throw new Error("SBOBET_CATALOG_UNAVAILABLE");
      const session = {
        context, page: found, socketPayloads, httpPayloads, responseTasks, eventPayloads, eventClock,
        eventRequest
      };
      this.#sessions.set(input.sessionId, session); return session;
    } catch { await context.close().catch(() => undefined); throw new Error("SBOBET_BROWSER_UNAVAILABLE"); }
  }

  async #refreshDirectEvent(session: OpenSession): Promise<void> {
    const request = session.eventRequest.value;
    const clock = session.eventClock.value;
    if (request === null || clock === null || Date.now() - clock.observedAtMs < 500) return;
    try {
      const headers = Object.fromEntries(Object.entries(request.headers).filter(([name]) =>
        !/^(?:cookie|host|content-length|accept-encoding|connection|origin|referer|user-agent|sec-|:)/iu.test(name)));
      const response = await session.page.evaluate(async (input) => {
        const result = await fetch(input.url, {
          method: "GET", headers: input.headers, credentials: "include", cache: "no-store"
        });
        return { status: result.status, url: result.url, payload: await result.text() };
      }, { url: request.url, headers });
      if (response.status !== 200 || new URL(response.url).pathname !== "/api/v2/getEvent") {
        throw new Error("SBOBET_DIRECT_REFRESH_UNAVAILABLE");
      }
      const payload = response.payload;
      if (decodeSbobetJsonBody(payload).length !== 1) throw new Error("SBOBET_DIRECT_REFRESH_SCHEMA_ERROR");
      appendBoundedSbobetSocketPayload(session.eventPayloads, payload, {
        maxFrameChars: 4_000_000, maxTotalChars: 8_000_000, maxFrames: 2
      });
      session.eventClock.value = { observedAtMs: Date.now(), receivedMonotonicMs: performance.now() };
    } catch { throw new Error("SBOBET_DIRECT_REFRESH_UNAVAILABLE"); }
  }

  async #readDirectCatalog(sessionId: string, session: OpenSession): Promise<SbobetCatalogSnapshot> {
    await Promise.allSettled([...session.responseTasks]);
    await this.#refreshDirectEvent(session);
    const fallbackRecords = await extractSbobetRecords(session.page);
    await this.#reportSafeCorrelation(sessionId, session, fallbackRecords);
    const latest = session.eventPayloads.at(-1);
    const clock = session.eventClock.value;
    if (latest === undefined || clock === null) throw new Error("SBOBET_DIRECT_CATALOG_UNAVAILABLE");
    const body = decodeSbobetJsonBody(latest)[0];
    if (body === undefined) throw new Error("SBOBET_DIRECT_CATALOG_SCHEMA_ERROR");
    const records = extractSbobetDirectCatalogRecords(body, fallbackRecords);
    if (records.length === 0) throw new Error("SBOBET_DIRECT_CATALOG_EMPTY");
    return { records, ...clock };
  }

  async #reportSafeCorrelation(
    sessionId: string, session: OpenSession, records: readonly SbobetCatalogInputRecord[]
  ): Promise<void> {
    if (this.#correlationReported.has(sessionId)) return;
    await Promise.allSettled([...session.responseTasks]);
    if (session.socketPayloads.length === 0 && session.httpPayloads.length === 0) return;
    const socketBodies = session.socketPayloads.flatMap((payload) => decodeSbobetStompBodies(payload));
    const httpBodies = session.httpPayloads.flatMap((payload) => decodeSbobetJsonBody(payload));
    const bodies = [...socketBodies, ...httpBodies];
    const eventIds = new Set(records.map((record) => record.eventId));
    const selectionIds = new Set(records.flatMap((record) => record.markets.flatMap((market) =>
      market.selections.map((selection) => selection.selectionId.replace(/[had]$/iu, "")))));
    const publicIds = [...eventIds, ...selectionIds];
    const evidence = correlateSbobetPublicIds(bodies, publicIds);
    const eventEvidence = evidence.filter((item) => eventIds.has(item.target));
    const selectionEvidence = evidence.filter((item) => selectionIds.has(item.target));
    if (bodies.length > 0 && !this.#correlationSummaryReported.has(sessionId)) {
      this.#correlationSummaryReported.add(sessionId);
      process.stderr.write(`SBOBET direct-feed correlation summary: ${JSON.stringify({
        capturedFrames: session.socketPayloads.length,
        decodedSocketBodies: socketBodies.length,
        capturedHttpBodies: httpBodies.length,
        publicEventTargets: eventIds.size,
        publicSelectionTargets: selectionIds.size,
        correlatedEvents: eventEvidence.length,
        correlatedSelections: selectionEvidence.length
      })}\n`);
    }
    if (evidence.length === 0) return;
    this.#correlationReported.add(sessionId);
    process.stderr.write(`SBOBET direct-feed public ID correlation: ${JSON.stringify({
      events: eventEvidence.slice(0, 10), selections: selectionEvidence.slice(0, 10)
    })}\n`);
  }
}
