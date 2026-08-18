import { createHash } from "node:crypto";
import { join } from "node:path";
import type { SbobetCatalogInputRecord } from "@tool-chenh/adapters";
import { chromium, type BrowserContext, type Page } from "playwright";
import { installCatalogResourcePolicy } from "../browser-resource-policy.js";
import { extractBtiCatalogRecords } from "./bti-direct-catalog.js";
import { parseBtiTicketConstraint, type BtiTicketConstraintSnapshot } from "./bti-ticket-constraint.js";
import { exactBtiStakeStep } from "./bti-stake-step.js";

interface OpenSession {
  readonly context: BrowserContext;
  readonly page: Page;
  readonly initialUrl: string;
}

export interface BtiCatalogSnapshot {
  readonly records: readonly SbobetCatalogInputRecord[];
  readonly observedAtMs: number;
  readonly receivedMonotonicMs: number;
}

export interface BtiProfileSnapshot {
  readonly displayName: string;
  readonly balanceText: string;
  readonly currencyCode: string;
  readonly observedAtMs: number;
}

export interface BtiIdentityEvidence {
  readonly hostname: string;
  readonly title: string;
  readonly hasFootball: boolean;
  readonly hasLiveInitial: boolean;
}

function safeLaunch(value: string): URL {
  if (value.length === 0 || value.length > 24_000) throw new Error("BTI_LAUNCH_URL_INVALID");
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password) throw new Error("BTI_LAUNCH_URL_INVALID");
  return url;
}

export function isVerifiedBtiIdentity(value: BtiIdentityEvidence): boolean {
  return /^prod\d+\.fxf\d+\.com$/u.test(value.hostname) && value.title === "Sportsbook" && value.hasFootball && value.hasLiveInitial;
}

export class PlaywrightBtiBrowserManager {
  readonly #profilesRoot: string;
  readonly #headless: boolean;
  readonly #timeoutMs: number;
  readonly #sessions = new Map<string, OpenSession>();
  readonly #opening = new Map<string, Promise<OpenSession>>();
  readonly #reads = new Map<string, Promise<BtiCatalogSnapshot>>();
  readonly #ticketReads = new Map<string, Promise<BtiTicketConstraintSnapshot | null>>();

  constructor(options: { profilesRoot: string; headless?: boolean; startupTimeoutMs?: number }) {
    this.#profilesRoot = options.profilesRoot;
    this.#headless = options.headless ?? false;
    this.#timeoutMs = options.startupTimeoutMs ?? 30_000;
  }

  async verifyLaunch(launchUrl: string): Promise<boolean> {
    try { await this.#get({ sessionId: "validator", launchUrl }); return true; }
    catch { return false; }
  }

  async readCatalog(input: { sessionId: string; launchUrl: string }): Promise<BtiCatalogSnapshot> {
    const active = this.#reads.get(input.sessionId);
    if (active !== undefined) return active;
    const next = this.#read(input).finally(() => {
      if (this.#reads.get(input.sessionId) === next) this.#reads.delete(input.sessionId);
    });
    this.#reads.set(input.sessionId, next);
    return next;
  }

  async readProfile(input: { sessionId: string; launchUrl: string }): Promise<BtiProfileSnapshot> {
    const session = await this.#get(input);
    const profile = await session.page.evaluate(() => {
      const token = localStorage.getItem("CT_APP_AUTHORIZATION");
      if (token === null) return null;
      try {
        const encoded = token.split(".")[1];
        if (encoded === undefined) return null;
        const normalized = encoded.replace(/-/gu, "+").replace(/_/gu, "/");
        const payload: unknown = JSON.parse(atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=")));
        if (typeof payload !== "object" || payload === null || Array.isArray(payload)) return null;
        const claims = payload as Record<string, unknown>;
        if (typeof claims.customerLogin !== "string" || typeof claims.currencyCode !== "string" ||
          typeof claims.balance !== "number" || !Number.isFinite(claims.balance) || claims.balance < 0) return null;
        return { displayName: claims.customerLogin, balanceText: `${claims.balance} K`, currencyCode: claims.currencyCode };
      } catch { return null; }
    });
    if (profile === null) throw new Error("BTI_PROFILE_UNAVAILABLE");
    return { ...profile, observedAtMs: Date.now() };
  }

  async readTicketConstraint(input: { sessionId: string; launchUrl: string; providerEventId: string;
    providerMarketId: string; providerSelectionId: string; participantA: string; participantB: string;
    marketType: string; selection: string; line: string | null; rawOdds: string;
    decimalOdds: string }): Promise<BtiTicketConstraintSnapshot | null> {
    const active = this.#ticketReads.get(input.sessionId);
    if (active !== undefined) return active;
    const next = this.#readTicketConstraint(input).finally(() => {
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

  async #readTicketConstraint(input: { sessionId: string; launchUrl: string; providerEventId: string;
    providerMarketId: string; providerSelectionId: string; participantA: string; participantB: string;
    marketType: string; selection: string; line: string | null; rawOdds: string;
    decimalOdds: string }): Promise<BtiTicketConstraintSnapshot | null> {
    const session = await this.#get(input);
    const opened = await session.page.evaluate((identity) => {
      const candidates = [...document.querySelectorAll<HTMLElement>("*")].filter((element) =>
        [...element.attributes].some((attribute) => attribute.value === identity.providerSelectionId));
      const exact = candidates.sort((left, right) => left.outerHTML.length - right.outerHTML.length)[0];
      if (exact !== undefined) {
        const clickable = exact.closest<HTMLElement>("button,[role=button],a,[tabindex]") ?? exact;
        clickable.click();
        return true;
      }
      window.postMessage(JSON.stringify({ eventType: "selectionId",
        eventData: { value: identity.providerSelectionId } }), "*");
      return true;
    }, { providerSelectionId: input.providerSelectionId }).catch(() => false);
    if (!opened) return null;

    const deadline = Date.now() + 1_500;
    while (Date.now() < deadline) {
      const raw = await session.page.evaluate((identity) => {
        const normalize = (value: string) => value.normalize("NFKD").replace(/[\u0300-\u036f]/gu, "")
          .replace(/\s+/gu, " ").trim().toLocaleLowerCase("en");
        const inputs = [...document.querySelectorAll<HTMLInputElement>("input")].filter((candidate) => {
          const style = getComputedStyle(candidate);
          return !candidate.disabled && style.display !== "none" && style.visibility !== "hidden" &&
            candidate.getBoundingClientRect().width > 0 && candidate.getBoundingClientRect().height > 0;
        });
        const selectionNeedles = identity.selection === "HOME" ? [normalize(identity.participantA)]
          : identity.selection === "AWAY" ? [normalize(identity.participantB)]
          : identity.selection === "OVER" ? ["over", "tren", "tai"]
          : identity.selection === "UNDER" ? ["under", "duoi", "xiu"] : [];
        const lineNumber = identity.line === null ? Number.NaN : Math.abs(Number(identity.line));
        const lineNeedles = Number.isFinite(lineNumber) ? new Set([normalize(String(lineNumber)),
          normalize(identity.line ?? "")]) : new Set<string>();
        const oddsNeedles = new Set([normalize(identity.rawOdds), normalize(identity.decimalOdds)]);
        const matches = inputs.flatMap((stakeInput) => {
          let root: HTMLElement | null = stakeInput.parentElement;
          while (root !== null) {
            const text = root.innerText;
            const normalized = normalize(text);
            const limitLine = text.split(/\r?\n/u).find((line) =>
              /T\u1ed1i\s*thi\u1ec3u\s*-\s*T\u1ed1i\s*\u0111a/iu.test(line)) ?? "";
            if (limitLine !== "" && selectionNeedles.some((needle) => normalized.includes(needle)) &&
              [...lineNeedles].some((needle) => needle !== "" && normalized.includes(needle)) &&
              [...oddsNeedles].some((needle) => needle !== "" && normalized.includes(needle))) {
              return [{ stakeInput, limitLine, size: text.length }];
            }
            root = root.parentElement;
          }
          return [];
        }).sort((left, right) => left.size - right.size);
        const exact = matches[0];
        if (exact === undefined || (matches[1] !== undefined && matches[1].size === exact.size &&
          matches[1].stakeInput !== exact.stakeInput)) return null;
        const stepEvidence: { key: string; value: string }[] = [];
        for (const attribute of exact.stakeInput.attributes) stepEvidence.push({ key: attribute.name, value: attribute.value });
        const visited = new Set<unknown>();
        const visit = (value: unknown, depth: number): void => {
          if (depth > 4 || value === null || (typeof value !== "object" && typeof value !== "function") || visited.has(value)) return;
          visited.add(value);
          for (const key of Object.getOwnPropertyNames(value)) {
            let child: unknown;
            try { child = (value as Record<string, unknown>)[key]; } catch { continue; }
            if (/^(?:step|stake[-_]?step|amount[-_]?step|increment)$/iu.test(key) &&
              (typeof child === "string" || typeof child === "number")) stepEvidence.push({ key, value: String(child) });
            if (key.startsWith("__react") || key === "props" || key === "memoizedProps" || key === "pendingProps")
              visit(child, depth + 1);
          }
        };
        visit(exact.stakeInput, 0);
        const token = localStorage.getItem("CT_APP_AUTHORIZATION");
        let balanceText = "";
        let currencyCode = "";
        if (token !== null) {
          try {
            const encoded = token.split(".")[1] ?? "";
            const normalized = encoded.replace(/-/gu, "+").replace(/_/gu, "/");
            const claims = JSON.parse(atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "="))) as Record<string, unknown>;
            if (typeof claims.balance === "number" && Number.isFinite(claims.balance)) balanceText = `${claims.balance} K`;
            if (typeof claims.currencyCode === "string") currencyCode = claims.currencyCode;
          } catch { /* Invalid auth evidence is handled fail-closed. */ }
        }
        return { providerSelectionId: identity.providerSelectionId, selectionMatched: true, limitText: exact.limitLine,
          stepEvidence, balanceText, currencyCode, observedAtMs: Date.now() };
      }, { providerSelectionId: input.providerSelectionId, participantA: input.participantA,
        participantB: input.participantB, selection: input.selection, line: input.line,
        rawOdds: input.rawOdds, decimalOdds: input.decimalOdds }).catch(() => null);
      if (raw !== null) {
        const stakeStepText = exactBtiStakeStep(raw.stepEvidence);
        const parsed = parseBtiTicketConstraint({ ...raw, stakeStepText: stakeStepText ?? "" });
        if (parsed !== null) return parsed;
      }
      await session.page.waitForTimeout(50);
    }
    return null;
  }

  async #read(input: { sessionId: string; launchUrl: string }): Promise<BtiCatalogSnapshot> {
    const session = await this.#get(input);
    const payload: unknown = await session.page.evaluate(async (url) => {
      const response = await fetch(url, { credentials: "include" });
      if (!response.ok) throw new Error("BTI_CATALOG_UNAVAILABLE");
      return response.json();
    }, session.initialUrl);
    const records = extractBtiCatalogRecords(payload);
    if (records.length === 0) throw new Error("BTI_CATALOG_EMPTY");
    return { records, observedAtMs: Date.now(), receivedMonotonicMs: performance.now() };
  }

  async #get(input: { sessionId: string; launchUrl: string }): Promise<OpenSession> {
    const key = createHash("sha256").update(input.launchUrl).digest("hex").slice(0, 24);
    const current = this.#sessions.get(key);
    if (current !== undefined && !current.page.isClosed()) return current;
    const pending = this.#opening.get(key);
    if (pending !== undefined) return pending;
    const next = this.#open(input.launchUrl, key).finally(() => this.#opening.delete(key));
    this.#opening.set(key, next);
    return next;
  }

  async #open(launchUrl: string, key: string): Promise<OpenSession> {
    const launch = safeLaunch(launchUrl);
    let context: BrowserContext | null = null;
    try {
      context = await chromium.launchPersistentContext(join(this.#profilesRoot,
        `bti-${key}`), {
        headless: this.#headless, acceptDownloads: false
      });
      await installCatalogResourcePolicy(context);
      const page = context.pages()[0] ?? await context.newPage();
      let initialUrl = "";
      page.on("response", (response) => {
        try {
          const url = new URL(response.url());
          if (url.pathname === "/api/eventlist/asia/leagues/v2/1/live/initial" && response.status() === 200) initialUrl = url.toString();
        } catch { /* Ignore malformed third-party URLs. */ }
      });
      await page.goto(launch.toString(), { waitUntil: "domcontentloaded", timeout: this.#timeoutMs });
      const deadline = Date.now() + this.#timeoutMs;
      let evidence: BtiIdentityEvidence = { hostname: launch.hostname, title: "", hasFootball: false, hasLiveInitial: false };
      while (!isVerifiedBtiIdentity(evidence) && Date.now() < deadline) {
        evidence = {
          hostname: new URL(page.url()).hostname.toLowerCase(),
          title: await page.title(),
          hasFootball: await page.locator(".navigation_asia_fe_Sport_sportName").first().isVisible().catch(() => false),
          hasLiveInitial: initialUrl !== ""
        };
        if (!isVerifiedBtiIdentity(evidence)) await page.waitForTimeout(100);
      }
      if (!isVerifiedBtiIdentity(evidence) || initialUrl === "") throw new Error("BTI_SCHEMA_CHANGED");
      const session = { context, page, initialUrl };
      this.#sessions.set(key, session);
      context = null;
      return session;
    } catch {
      throw new Error("BTI_BROWSER_UNAVAILABLE");
    } finally {
      await context?.close().catch(() => undefined);
    }
  }
}
