import { createHash } from "node:crypto";
import { join } from "node:path";
import type { SbobetCatalogInputRecord } from "@tool-chenh/adapters";
import { chromium, type BrowserContext, type Page } from "playwright";
import { collectSafeControlShapes } from "../browser-protocol-inspector.js";
import { installCatalogResourcePolicy } from "../browser-resource-policy.js";
import { parseApsportTicketConstraint, type ApsportTicketConstraintSnapshot } from "./apsport-ticket-constraint.js";

export interface ApsportIdentityEvidence {
  readonly hostname: string;
  readonly hasSportsSurface: boolean;
  readonly hasEventSurface: boolean;
}

interface OpenApsportSession {
  readonly context: BrowserContext;
  readonly page: Page;
}

export interface ApsportCatalogSnapshot {
  readonly records: readonly SbobetCatalogInputRecord[];
  readonly observedAtMs: number;
  readonly receivedMonotonicMs: number;
}

export interface ApsportProfileSnapshot {
  readonly displayName: string;
  readonly balanceText: string;
  readonly observedAtMs: number;
}

function safeLaunchUrl(value: string): URL {
  if (value.length === 0 || value.length > 24_000) throw new Error("APSPORT_LAUNCH_URL_INVALID");
  const parsed = new URL(value);
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.hostname.length === 0) {
    throw new Error("APSPORT_LAUNCH_URL_INVALID");
  }
  return parsed;
}

export function isVerifiedApsportIdentity(evidence: ApsportIdentityEvidence): boolean {
  return evidence.hostname === "sport.asportsb.com" && evidence.hasSportsSurface && evidence.hasEventSurface;
}

export async function extractApsportRecords(page: Page): Promise<readonly SbobetCatalogInputRecord[]> {
  return page.locator(".match").evaluateAll((nodes) => nodes.flatMap((node) => {
    const text = (element: Element | null): string => element?.textContent?.trim().replace(/\s+/gu, " ") ?? "";
    const supportedLine = (value: string): string | null => {
      const match = /^(?:[ou]\s*)?([+-]?(?:0|[1-9]\d*)(?:\.(?:25|5|75))?(?:\s*[\/-]\s*(?:0|[1-9]\d*)(?:\.(?:25|5|75))?)?)$/iu
        .exec(value.trim());
      return match?.[1]?.replace(/\s+/gu, "") ?? null;
    };
    const marketTypeFromLabel = (value: string): SbobetCatalogInputRecord["markets"][number]["marketType"] | null => {
      const label = value.normalize("NFD").replace(/[\u0300-\u036f]/gu, "").toLowerCase();
      const isHandicap = /(?:handicap|chap|cuoc chap|\bah\b)/u.test(label) || label.includes("cháº¥p");
      const isTotal = /(?:total|over\s*\/?\s*under|t\s*\/\s*x|tai\s*\/?\s*xiu)/u.test(label);
      if (isHandicap === isTotal) return null;
      const firstHalf = /(?:hiep\s*1|first\s*half|\b1h\b)/u.test(label);
      const secondHalf = /(?:hiep\s*2|second\s*half|\b2h\b)/u.test(label);
      if (firstHalf && secondHalf) return null;
      const corner = /(?:phat\s*goc|corner)/u.test(label);
      const card = /(?:the\s*phat|booking|card)/u.test(label);
      if ((corner && card) || ((corner || card) && secondHalf)) return null;
      const kind = isHandicap ? "AH" : "TOTAL";
      if (corner) return `CORNER_${firstHalf ? "FH" : "FT"}_${kind}` as const;
      if (card) return `CARD_${firstHalf ? "FH" : "FT"}_${kind}` as const;
      return `${firstHalf ? "FH" : secondHalf ? "SH" : "FT"}_${kind}` as const;
    };
    const eventId = node.querySelector(".match-favorite")?.id.match(/eventId-[^-]+-\d+-([0-9]+)$/u)?.[1] ?? "";
    const leagueName = text(node.querySelector(".league-name"));
    const teamNames = [...node.querySelectorAll(".match__team-name")].slice(0, 2).map(text);
    const statusText = text(node.querySelector(".match__status"));
    if (!/(?:live|trực\s*tiếp|hiệp)/iu.test(statusText) || eventId === "" || leagueName === "" || teamNames.length !== 2) return [];
    const scores = [...node.querySelectorAll(".match__team-score")].slice(0, 2).map(text);
    const scoreText = scores.length === 2 && scores.every((score) => /^\d+$/u.test(score)) ? `${scores[0]} - ${scores[1]}` : null;
    const markets = [...node.querySelectorAll(".match-odd-pair-list")].flatMap((group) => {
      const label = text(group.querySelector(".match__odd-pair-list__type"));
      const marketType = /chấp/iu.test(label) ? "FT_AH" as const : /t\/x/iu.test(label) ? "FT_TOTAL" as const : null;
      const resolvedMarketType = marketTypeFromLabel(label) ?? marketType;
      if (resolvedMarketType === null) return [];
      const odds = [...group.querySelectorAll(".match__odd-pair")];
      if (odds.length !== 2) return [];
      const rawTypes = odds.map((odd) => text(odd.querySelector(".match__odd-type")));
      const lines = rawTypes.map(supportedLine);
      const lineText = lines[0] ?? null;
      if (lineText === null || lines.some((line) => line === null)) return [];
      const isHandicap = resolvedMarketType.endsWith("_AH");
      if (!isHandicap && new Set(lines).size !== 1) return [];
      const expected = isHandicap ? ["HOME", "AWAY"] as const : ["OVER", "UNDER"] as const;
      const selections = odds.map((odd, index) => ({
        selectionId: odd.id.replace(/^odd-item-/u, ""),
        selection: expected[index]!,
        priceText: text(odd.querySelector(".match__odd-value")),
        locked: false,
        ...(isHandicap ? { lineText: rawTypes[index] } : {})
      }));
      if (selections.some((selection) => selection.selectionId === "" || selection.priceText === "")) return [];
      return [{ marketId: `${eventId}:${resolvedMarketType}:${lineText}`, marketType: resolvedMarketType, lineText, selections }];
    });
    return [{ eventId, leagueName, timeText: statusText, scoreText, teamNames, markets }];
  })) as Promise<readonly SbobetCatalogInputRecord[]>;
}

export async function extractApsportProfile(page: Page): Promise<Omit<ApsportProfileSnapshot, "observedAtMs">> {
  const displayName = (await page.locator(".user-name").first().textContent().catch(() => null))?.trim() ?? "";
  const balanceText = (await page.locator(".user-balance").first().textContent().catch(() => null))?.trim() ?? "";
  if (displayName.length === 0 || balanceText.length === 0) throw new Error("APSPORT_PROFILE_UNAVAILABLE");
  return { displayName, balanceText };
}

export class PlaywrightApsportBrowserManager {
  readonly #profilesRoot: string;
  readonly #headless: boolean;
  readonly #timeoutMs: number;
  readonly #sessions = new Map<string, OpenApsportSession>();
  readonly #opening = new Map<string, Promise<OpenApsportSession>>();
  readonly #reads = new Map<string, Promise<ApsportCatalogSnapshot>>();
  readonly #ticketReads = new Map<string, Promise<ApsportTicketConstraintSnapshot | null>>();

  constructor(options: { profilesRoot: string; headless?: boolean; startupTimeoutMs?: number }) {
    this.#profilesRoot = options.profilesRoot;
    this.#headless = options.headless ?? false;
    this.#timeoutMs = options.startupTimeoutMs ?? 30_000;
  }

  async verifyLaunch(launchUrl: string): Promise<boolean> {
    try { await this.#get(launchUrl); return true; } catch { return false; }
  }

  async readCatalog(input: { sessionId: string; launchUrl: string }): Promise<ApsportCatalogSnapshot> {
    const active = this.#reads.get(input.sessionId);
    if (active !== undefined) return active;
    const next = this.#readCatalog(input.launchUrl).finally(() => {
      if (this.#reads.get(input.sessionId) === next) this.#reads.delete(input.sessionId);
    });
    this.#reads.set(input.sessionId, next);
    return next;
  }

  async readProfile(input: { sessionId: string; launchUrl: string }): Promise<ApsportProfileSnapshot> {
    const session = await this.#get(input.launchUrl);
    return { ...await extractApsportProfile(session.page), observedAtMs: Date.now() };
  }

  async readTicketConstraint(input: { sessionId: string; launchUrl: string;
    providerSelectionId: string }): Promise<ApsportTicketConstraintSnapshot | null> {
    const active = this.#ticketReads.get(input.sessionId);
    if (active !== undefined) return active;
    const next = this.#readTicketConstraint(input.launchUrl, input.providerSelectionId).finally(() => {
      if (this.#ticketReads.get(input.sessionId) === next) this.#ticketReads.delete(input.sessionId);
    });
    this.#ticketReads.set(input.sessionId, next);
    return next;
  }

  async close(): Promise<void> {
    const sessions = [...this.#sessions.values()];
    this.#sessions.clear();
    this.#reads.clear();
    this.#ticketReads.clear();
    await Promise.allSettled(sessions.map((session) => session.context.close()));
  }

  async #readTicketConstraint(launchUrl: string, providerSelectionId: string): Promise<ApsportTicketConstraintSnapshot | null> {
    const session = await this.#get(launchUrl);
    const clicked = await session.page.evaluate((selectionId) => {
      const element = document.getElementById(`odd-item-${selectionId}`) as HTMLElement | null;
      if (element === null) return false;
      element.click();
      return true;
    }, providerSelectionId).catch(() => false);
    if (!clicked) return null;
    const deadline = Date.now() + 1_500;
    while (Date.now() < deadline) {
      const evidence = await session.page.evaluate((selectionId) => {
        const bodyText = document.body.innerText;
        const lines = bodyText.split(/\r?\n/u);
        const input = [...document.querySelectorAll<HTMLInputElement>("input.input-stake")].find((candidate) => {
          const style = getComputedStyle(candidate); const bounds = candidate.getBoundingClientRect();
          return !candidate.disabled && style.display !== "none" && style.visibility !== "hidden" &&
            bounds.width > 0 && bounds.height > 0;
        });
        const placeholderLimits = input === undefined ? null : /^\s*([1-9]\d{0,2}(?:,\d{3})*|[1-9]\d*)\s*-\s*([1-9]\d{0,2}(?:,\d{3})*|[1-9]\d*)\s*$/u.exec(input.placeholder);
        const visibleLimit = lines.find((line) => /(?:Tối\s*thiểu\s*-\s*Tối\s*đa\s*)?[\d,.]+\s*-\s*[\d,.]+\s*K\b/iu.test(line));
        const limitText = visibleLimit ?? (placeholderLimits === null ? "" : `${placeholderLimits[1]} - ${placeholderLimits[2]} K`);
        const balanceText = document.querySelector(".user-balance")?.textContent?.trim() ?? "";
        return { providerSelectionId: selectionId,
          selectionMatched: document.getElementById(`odd-item-${selectionId}`) !== null && limitText !== "",
          limitText, stakeStepText: input?.step || (placeholderLimits === null ? "" : "1"),
          balanceText, observedAtMs: Date.now() };
      }, providerSelectionId).catch(() => null);
      if (evidence !== null) {
        const parsed = parseApsportTicketConstraint(evidence);
        if (parsed !== null) return parsed;
      }
      await session.page.waitForTimeout(50);
    }
    return null;
  }

  async #readCatalog(launchUrl: string): Promise<ApsportCatalogSnapshot> {
    const session = await this.#get(launchUrl);
    const records = await extractApsportRecords(session.page);
    if (records.length === 0) throw new Error("APSPORT_CATALOG_EMPTY");
    return { records, observedAtMs: Date.now(), receivedMonotonicMs: performance.now() };
  }

  async #get(launchUrl: string): Promise<OpenApsportSession> {
    const key = createHash("sha256").update(launchUrl).digest("hex").slice(0, 24);
    const current = this.#sessions.get(key);
    if (current !== undefined && !current.page.isClosed()) return current;
    const opening = this.#opening.get(key);
    if (opening !== undefined) return opening;
    const next = this.#open(launchUrl, key).finally(() => this.#opening.delete(key));
    this.#opening.set(key, next);
    return next;
  }

  async #open(launchUrl: string, key: string): Promise<OpenApsportSession> {
    const parsed = safeLaunchUrl(launchUrl);
    let context: BrowserContext | null = null;
    try {
      const profile = `apsport-${key}`;
      context = await chromium.launchPersistentContext(join(this.#profilesRoot, profile), {
        headless: this.#headless,
        acceptDownloads: false
      });
      await installCatalogResourcePolicy(context);
      const launcher = context.pages()[0] ?? await context.newPage();
      await launcher.goto(parsed.toString(), { waitUntil: "domcontentloaded", timeout: this.#timeoutMs });
      const deadline = Date.now() + this.#timeoutMs;
      let evidence: ApsportIdentityEvidence = {
        hostname: parsed.hostname.toLowerCase(), hasSportsSurface: false, hasEventSurface: false
      };
      let latestShapes = (await Promise.all(context.pages().map((page) => collectSafeControlShapes(page, 400)))).flat();
      while (!isVerifiedApsportIdentity(evidence) && Date.now() < deadline) {
        latestShapes = (await Promise.all(context.pages().map((page) => collectSafeControlShapes(page, 400)))).flat();
        evidence = {
          ...evidence,
          hasSportsSurface: evidence.hasSportsSurface || latestShapes.some((shape) => shape.classTokens.some((token) =>
            /sport|live/iu.test(token))),
          hasEventSurface: evidence.hasEventSurface || latestShapes.some((shape) => shape.classTokens.some((token) =>
            /event|market|league|odd/iu.test(token)))
        };
        if (!isVerifiedApsportIdentity(evidence)) await launcher.waitForTimeout(100);
      }
      process.stderr.write(`APSPORT identity evidence: ${JSON.stringify(evidence)}\n`);
      if (!isVerifiedApsportIdentity(evidence)) throw new Error("APSPORT_SCHEMA_CHANGED");
      const page = context.pages().find((candidate) => !candidate.isClosed()) ?? launcher;
      const session = { context, page };
      this.#sessions.set(key, session);
      context = null;
      return session;
    } catch {
      throw new Error("APSPORT_BROWSER_UNAVAILABLE");
    } finally {
      await context?.close().catch(() => undefined);
    }
  }
}
