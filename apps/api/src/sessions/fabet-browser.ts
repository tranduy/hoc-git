import { rm } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { chromium, type BrowserContext, type Page } from "playwright";
import type { Category } from "@tool-chenh/contracts";
import { SecretVault } from "./secret-vault.js";
import { TrustedDomainStore } from "./trusted-domain-store.js";
import { observeProtocolMetadata } from "../providers/protocol-inspector.js";

export interface CapturedNavigation {
  readonly url: string;
  readonly label: string;
}

export interface FabetBrowserAutomation {
  login(input: { readonly entryUrl: string; readonly username: string; readonly password: string }): Promise<void>;
  captureNavigations(lobbyUrl: string): Promise<readonly CapturedNavigation[]>;
  isAuthenticated(): Promise<boolean>;
  close(): Promise<void>;
}

export interface LaunchCandidate {
  readonly category: Category;
  readonly providerHint: string;
  readonly hostname: string;
  readonly capturedAtMs: number;
  readonly vaultRecordId: string;
}

export type FabetBrowserErrorCode =
  | "DOMAIN_APPROVAL_REQUIRED"
  | "INVALID_URL"
  | "UNAUTHORIZED"
  | "NOT_AUTHENTICATED";

export class FabetBrowserError extends Error {
  readonly code: FabetBrowserErrorCode;

  constructor(code: FabetBrowserErrorCode) {
    super(code);
    this.name = "FabetBrowserError";
    this.code = code;
  }
}

const launcherPattern = /^(?:SABA(?:-SPORTS)?|CMD|C-SPORTS|SBOBET|APSPORT|APS?PORT|BTI|K-SPORTS|T-SPORTS|I-SPORTS|ESPORTS)$/iu;
const forbiddenPattern = /(?:\bbet\b|wager|đặt\s*cược|xác\s*nhận\s*cược|nạp\s*tiền|rút\s*tiền)/iu;

export function launcherTextIsSafe(label: string): boolean {
  const normalized = label.trim().replace(/\s+/gu, " ");
  return normalized.length > 0 && !forbiddenPattern.test(normalized) && launcherPattern.test(normalized);
}

export function capturedTopLevelNavigation(lobbyOrigin: string, label: string, value: string): CapturedNavigation | null {
  if (!launcherTextIsSafe(label)) return null;
  const observation = observeProtocolMetadata({
    url: value, method: "GET", transport: "NAVIGATION", status: null, contentType: null
  });
  if (observation === null) return null;
  try {
    const url = new URL(value);
    if (url.origin === lobbyOrigin) return null;
    return { url: value, label: label.trim().replace(/\s+/gu, " ") };
  } catch {
    return null;
  }
}

function providerHint(label: string): string {
  const upper = label.trim().toUpperCase();
  if (upper.includes("SABA")) return "SABA";
  if (upper === "CMD" || upper === "C-SPORTS") return "CMD";
  if (upper.includes("SBOBET")) return "SBOBET";
  if (/^APS?PORT$/u.test(upper)) return "APSPORT";
  if (upper === "BTI") return "BTI";
  if (upper === "I-SPORTS") return "IM";
  return "UNKNOWN";
}

function safeHttpsUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new FabetBrowserError("INVALID_URL");
  }
  if (url.protocol !== "https:" || url.username !== "" || url.password !== "") {
    throw new FabetBrowserError("INVALID_URL");
  }
  return url;
}

export interface FabetBrowserDriverOptions {
  readonly vault: SecretVault;
  readonly trustStore: TrustedDomainStore;
  readonly automation: FabetBrowserAutomation;
  readonly profilesRoot: string;
  readonly clock: { nowMs(): number };
  readonly idFactory: () => string;
}

export class FabetBrowserDriver {
  readonly #vault: SecretVault;
  readonly #trustStore: TrustedDomainStore;
  readonly #automation: FabetBrowserAutomation;
  readonly #profilesRoot: string;
  readonly #profilePath: string;
  readonly #clock: { nowMs(): number };
  readonly #idFactory: () => string;
  #baseOrigin: string | null = null;
  #diagnostics: LaunchCandidate[] = [];

  constructor(options: FabetBrowserDriverOptions) {
    this.#vault = options.vault;
    this.#trustStore = options.trustStore;
    this.#automation = options.automation;
    this.#profilesRoot = resolve(options.profilesRoot);
    this.#profilePath = resolve(join(this.#profilesRoot, "fabet"));
    this.#clock = options.clock;
    this.#idFactory = options.idFactory;
  }

  async login(input: { readonly entryUrl: string; readonly username: string; readonly password: string }): Promise<void> {
    const entry = safeHttpsUrl(input.entryUrl);
    if (!(await this.#trustStore.isTrusted(entry.hostname))) {
      throw new FabetBrowserError("DOMAIN_APPROVAL_REQUIRED");
    }
    await this.#automation.login(input);
    if (!(await this.#automation.isAuthenticated())) throw new FabetBrowserError("UNAUTHORIZED");
    this.#baseOrigin = entry.origin;
  }

  async captureLobbyLaunches(): Promise<readonly LaunchCandidate[]> {
    if (this.#baseOrigin === null) throw new FabetBrowserError("NOT_AUTHENTICATED");
    const lobbies: ReadonlyArray<{ category: Category; url: string }> = [
      { category: "FOOTBALL", url: `${this.#baseOrigin}/lobby-the-thao?type=livesports` },
      { category: "LOL", url: `${this.#baseOrigin}/lobby-the-thao?type=esports` }
    ];
    const candidates: LaunchCandidate[] = [];
    const seen = new Set<string>();
    for (const lobby of lobbies) {
      const navigations = await this.#automation.captureNavigations(lobby.url);
      for (const navigation of navigations) {
        if (seen.has(navigation.url)) continue;
        const launch = safeHttpsUrl(navigation.url);
        if (launch.origin === this.#baseOrigin) continue;
        seen.add(navigation.url);
        const capturedAtMs = this.#clock.nowMs();
        const vaultRecordId = `launch-${this.#idFactory()}`;
        await this.#vault.save(vaultRecordId, {
          kind: "LAUNCH_URL",
          value: navigation.url,
          capturedAtMs
        });
        candidates.push({
          category: lobby.category,
          providerHint: providerHint(navigation.label),
          hostname: launch.hostname,
          capturedAtMs,
          vaultRecordId
        });
      }
    }
    this.#diagnostics = candidates;
    return candidates;
  }

  redactedDiagnostics(): readonly LaunchCandidate[] {
    return this.#diagnostics.map((candidate) => ({ ...candidate }));
  }

  async resetProfile(): Promise<void> {
    const relativePath = relative(this.#profilesRoot, this.#profilePath);
    if (relativePath.startsWith("..") || relativePath === "" || relativePath.includes(":")) {
      throw new Error("Invalid browser profile path");
    }
    await this.#automation.close();
    await rm(this.#profilePath, { recursive: true, force: true });
    this.#baseOrigin = null;
    this.#diagnostics = [];
  }
}

export interface PlaywrightFabetAutomationOptions {
  readonly profilePath: string;
  readonly headless?: boolean;
}

export class PlaywrightFabetAutomation implements FabetBrowserAutomation {
  readonly #profilePath: string;
  readonly #headless: boolean;
  #context: BrowserContext | null = null;
  #page: Page | null = null;

  constructor(options: PlaywrightFabetAutomationOptions) {
    this.#profilePath = options.profilePath;
    this.#headless = options.headless ?? false;
  }

  async login(input: { readonly entryUrl: string; readonly username: string; readonly password: string }): Promise<void> {
    const page = await this.#getPage();
    await page.goto(input.entryUrl, { waitUntil: "domcontentloaded" });
    const username = page.locator([
      "input[autocomplete='username']",
      "input[name*='user' i]",
      "input[type='text']",
      "input[type='tel']"
    ].join(", ")).first();
    const password = page.locator("input[type='password']").first();
    const loginButtons = page.getByRole("button", { name: /đăng\s*nhập|login/iu });
    if (await password.count() === 0 || !(await password.isVisible().catch(() => false))) {
      const opener = loginButtons.first();
      if (await opener.count() === 0 || !(await opener.isVisible().catch(() => false))) return;
      await opener.click();
      await password.waitFor({ state: "visible", timeout: 5_000 }).catch(() => undefined);
    }
    if (
      await username.count() === 0 ||
      await password.count() === 0 ||
      !(await username.isVisible().catch(() => false)) ||
      !(await password.isVisible().catch(() => false))
    ) return;
    await username.fill(input.username);
    await password.fill(input.password);
    await loginButtons.last().click();
    await page.waitForLoadState("domcontentloaded").catch(() => undefined);
  }

  async captureNavigations(lobbyUrl: string): Promise<readonly CapturedNavigation[]> {
    const context = await this.#getContext();
    const page = await this.#getPage();
    const lobbyOrigin = new URL(lobbyUrl).origin;
    const captured = new Map<string, CapturedNavigation>();
    const record = (url: string, label: string): void => {
      const navigation = capturedTopLevelNavigation(lobbyOrigin, label, url);
      if (navigation !== null) captured.set(navigation.url, navigation);
    };
    await page.goto(lobbyUrl, { waitUntil: "domcontentloaded" });
    const controls = page.locator("a, button, [role='button'], [onclick]");
    const count = Math.min(await controls.count(), 200);
    for (let index = 0; index < count; index += 1) {
        const control = controls.nth(index);
        const label = (await control.innerText().catch(() => "")).trim();
        if (!launcherTextIsSafe(label) || !(await control.isVisible().catch(() => false))) continue;
        const popups: Page[] = [];
        const onPage = (popup: Page): void => { popups.push(popup); };
        context.on("page", onPage);
        try {
          await control.click({ timeout: 2_000 }).catch(() => undefined);
          await page.waitForTimeout(750);
        } finally {
          context.off("page", onPage);
        }
        for (const popup of popups) {
          await popup.waitForLoadState("domcontentloaded", { timeout: 5_000 }).catch(() => undefined);
          record(popup.url(), label);
          await popup.close().catch(() => undefined);
        }
        if (page.url() !== lobbyUrl && new URL(page.url()).origin !== lobbyOrigin) {
          record(page.url(), label);
          await page.goto(lobbyUrl, { waitUntil: "domcontentloaded" });
        }
    }
    return [...captured.values()];
  }

  async isAuthenticated(): Promise<boolean> {
    const page = await this.#getPage();
    const password = page.locator("input[type='password']");
    if (await password.count() > 0 && await password.first().isVisible().catch(() => false)) return false;
    const loginButtons = page.getByRole("button", { name: /đăng\s*nhập|login/iu });
    for (let index = 0; index < await loginButtons.count(); index += 1) {
      if (await loginButtons.nth(index).isVisible().catch(() => false)) return false;
    }
    return true;
  }

  async close(): Promise<void> {
    await this.#context?.close();
    this.#context = null;
    this.#page = null;
  }

  async #getContext(): Promise<BrowserContext> {
    this.#context ??= await chromium.launchPersistentContext(this.#profilePath, {
      headless: this.#headless,
      acceptDownloads: false
    });
    return this.#context;
  }

  async #getPage(): Promise<Page> {
    const context = await this.#getContext();
    this.#page ??= context.pages()[0] ?? await context.newPage();
    return this.#page;
  }
}
