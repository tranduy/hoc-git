import { createHash } from "node:crypto";
import { join } from "node:path";
import { normalizeSabaFootballRecords } from "@tool-chenh/adapters";
import { chromium, type BrowserContext, type Page, type WebSocket } from "playwright";
import { clickSafeLiveCatalog, clickSafeStructuralCategory, findCmdCatalogPage } from "../browser-protocol-inspector.js";
import { validateCmdLaunchUrl } from "../cmd/cmd-browser-manager.js";
import { SabaPushDecoder, type SabaPushFrame } from "./saba-push-decoder.js";
import { parseSabaSocketFrame } from "./saba-socket-frame.js";

interface OpenSession {
  readonly context: BrowserContext;
  readonly page: Page;
  readonly snapshots: SabaSocketSnapshots;
}

export function isSabaPushSocketUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (url.protocol === "wss:" || url.protocol === "ws:") && /\/socket\.io\/?$/u.test(url.pathname);
  } catch { return false; }
}

export class SabaSocketSnapshots {
  #generation = 0;
  readonly #records = new Map<string, {
    readonly records: readonly Readonly<Record<string, unknown>>[];
    readonly observedAtMs: number;
    readonly receivedMonotonicMs: number;
  }>();

  beginSocket(): number {
    this.#generation += 1;
    this.#records.clear();
    return this.#generation;
  }

  endSocket(generation: number): boolean {
    if (generation !== this.#generation) return false;
    this.#generation += 1;
    this.#records.clear();
    return true;
  }

  replace(
    generation: number,
    bridgeId: string,
    records: readonly Readonly<Record<string, unknown>>[],
    observedAtMs = Date.now(),
    receivedMonotonicMs = performance.now()
  ): boolean {
    if (generation !== this.#generation) return false;
    this.#records.set(`${generation}:${bridgeId}`, { records, observedAtMs, receivedMonotonicMs });
    return true;
  }

  discard(generation: number, bridgeId: string): boolean {
    if (generation !== this.#generation) return false;
    return this.#records.delete(`${generation}:${bridgeId}`);
  }

  clear(): void { this.#records.clear(); }
  records(): readonly Readonly<Record<string, unknown>>[] {
    return [...this.#records.values()].flatMap((snapshot) => snapshot.records);
  }
  latestClock(): { readonly observedAtMs: number; readonly receivedMonotonicMs: number } | null {
    const snapshots = [...this.#records.values()].filter((snapshot) => snapshot.records.some((record) =>
      typeof record.type === "string" && ["l", "m", "ls", "o", "b"].includes(record.type)));
    if (snapshots.length === 0) return null;
    const latest = snapshots.reduce((left, right) => right.observedAtMs > left.observedAtMs ? right : left);
    return { observedAtMs: latest.observedAtMs, receivedMonotonicMs: latest.receivedMonotonicMs };
  }
}

export class SabaViewDecoder {
  #viewGeneration = -1;
  #decoder = new SabaPushDecoder();

  apply(viewGeneration: number, frame: SabaPushFrame): ReturnType<SabaPushDecoder["apply"]> {
    if (viewGeneration !== this.#viewGeneration) {
      this.#viewGeneration = viewGeneration;
      this.#decoder = new SabaPushDecoder();
    }
    return this.#decoder.apply(frame);
  }
}

export function markSabaLiveContextRecords(
  records: readonly Readonly<Record<string, unknown>>[]
): readonly Readonly<Record<string, unknown>>[] {
  return records.map((record) => record.type === "m" ? { ...record, marketid: "L" } : record);
}

export class PlaywrightSabaFootballPushBrowserManager {
  readonly #profilesRoot: string;
  readonly #headless: boolean;
  readonly #timeoutMs: number;
  readonly #sessions = new Map<string, OpenSession>();
  readonly #opening = new Map<string, Promise<OpenSession>>();
  readonly #reading = new Map<string, Promise<readonly Readonly<Record<string, unknown>>[]>>();

  constructor(options: { readonly profilesRoot: string; readonly headless?: boolean; readonly startupTimeoutMs?: number }) {
    if (options.profilesRoot.trim().length === 0) throw new Error("SABA_FOOTBALL_BROWSER_OPTIONS_INVALID");
    this.#profilesRoot = options.profilesRoot;
    this.#headless = options.headless ?? false;
    this.#timeoutMs = options.startupTimeoutMs ?? 30_000;
  }

  async verifyLaunch(launchUrl: string): Promise<boolean> {
    const sessionId = `verify-${createHash("sha256").update(launchUrl).digest("hex").slice(0, 20)}`;
    try {
      const session = await this.#open({ sessionId, launchUrl });
      await this.#waitForCatalog(session);
      return true;
    } catch {
      return false;
    } finally {
      await this.#invalidate(sessionId);
    }
  }

  async readCatalog(input: {
    readonly sessionId: string;
    readonly launchUrl: string;
  }): Promise<readonly Readonly<Record<string, unknown>>[]> {
    const pending = this.#reading.get(input.sessionId);
    if (pending !== undefined) return pending;
    const operation = this.#readWithRecovery(input).finally(() => this.#reading.delete(input.sessionId));
    this.#reading.set(input.sessionId, operation);
    return operation;
  }

  async close(): Promise<void> {
    const sessions = [...this.#sessions.values()];
    this.#sessions.clear();
    await Promise.allSettled(sessions.map(async (session) => session.context.close()));
  }

  async #readWithRecovery(input: { readonly sessionId: string; readonly launchUrl: string }): Promise<readonly Readonly<Record<string, unknown>>[]> {
    let session = await this.#get(input);
    try {
      return await this.#waitForCatalog(session);
    } catch {
      await this.#invalidate(input.sessionId, session);
      session = await this.#get(input);
      return this.#waitForCatalog(session);
    }
  }

  async #get(input: { readonly sessionId: string; readonly launchUrl: string }): Promise<OpenSession> {
    const current = this.#sessions.get(input.sessionId);
    if (current !== undefined && !current.page.isClosed()) return current;
    const pending = this.#opening.get(input.sessionId);
    if (pending !== undefined) return pending;
    const operation = this.#open(input).finally(() => this.#opening.delete(input.sessionId));
    this.#opening.set(input.sessionId, operation);
    return operation;
  }

  async #open(input: { readonly sessionId: string; readonly launchUrl: string }): Promise<OpenSession> {
    const launchUrl = validateCmdLaunchUrl(input.launchUrl);
    const profile = `saba-football-push-${createHash("sha256").update(input.sessionId).digest("hex").slice(0, 24)}`;
    const context = await chromium.launchPersistentContext(join(this.#profilesRoot, profile), {
      headless: this.#headless, acceptDownloads: false
    });
    const snapshots = new SabaSocketSnapshots();
    let viewGeneration = 0;
    const attachSocket = (socket: WebSocket): void => {
      if (!isSabaPushSocketUrl(socket.url())) return;
      const generation = snapshots.beginSocket();
      // A reconnect must not mix an old snapshot with deltas from a new socket.
      const decoder = new SabaViewDecoder();
      socket.on("framereceived", (event) => {
        let frame = null;
        try {
          frame = parseSabaSocketFrame(event.payload);
          if (frame === null) return;
          const applied = decoder.apply(viewGeneration, frame);
          snapshots.replace(generation, frame.bridgeId, applied.records, Date.now(), performance.now());
        } catch {
          // Never keep publishing stale values from a channel after a malformed
          // frame or sequence gap. Other independently valid channels survive.
          if (frame !== null) snapshots.discard(generation, frame.bridgeId);
        }
      });
      socket.on("close", () => { snapshots.endSocket(generation); });
      socket.on("socketerror", () => { snapshots.endSocket(generation); });
    };
    const attachPage = (page: Page): void => { page.on("websocket", attachSocket); };
    context.pages().forEach(attachPage);
    context.on("page", attachPage);
    try {
      let page = context.pages()[0] ?? await context.newPage();
      await page.goto(launchUrl, { waitUntil: "domcontentloaded", timeout: this.#timeoutMs });
      await page.waitForTimeout(1_500);
      page = await findCmdCatalogPage(context.pages()) ?? page;
      await clickSafeStructuralCategory(page, "1", 1_500).catch(() => false);
      const liveSelected = await clickSafeLiveCatalog(page, 1_500).catch(() => false);
      if (!liveSelected) throw new Error("SABA_FOOTBALL_LIVE_NAVIGATION_UNAVAILABLE");
      // Establish the new epoch only after the Live control confirms selection.
      // Frames received while the click is in flight still belong to the old
      // view; clearing here and resetting on the next frame prevents carry-over.
      viewGeneration += 1;
      snapshots.clear();
      const session = { context, page, snapshots };
      this.#sessions.set(input.sessionId, session);
      return session;
    } catch {
      await context.close().catch(() => undefined);
      throw new Error("SABA_FOOTBALL_BROWSER_UNAVAILABLE");
    }
  }

  async #waitForCatalog(session: OpenSession): Promise<readonly Readonly<Record<string, unknown>>[]> {
    const deadline = Date.now() + this.#timeoutMs;
    while (Date.now() < deadline) {
      const records = markSabaLiveContextRecords(session.snapshots.records());
      const clock = session.snapshots.latestClock();
      if (clock === null) {
        await session.page.waitForTimeout(100);
        continue;
      }
      const normalized = normalizeSabaFootballRecords(records, {
        observedAtMs: clock.observedAtMs, receivedMonotonicMs: clock.receivedMonotonicMs, sequence: 1
      });
      if (normalized.events.length > 0 && normalized.markets.length > 0) return records;
      await session.page.waitForTimeout(50);
    }
    throw new Error("SABA_FOOTBALL_CATALOG_UNAVAILABLE");
  }

  async #invalidate(sessionId: string, expected?: OpenSession): Promise<void> {
    const current = this.#sessions.get(sessionId);
    if (current === undefined || (expected !== undefined && current !== expected)) return;
    this.#sessions.delete(sessionId);
    await current.context.close().catch(() => undefined);
  }
}
