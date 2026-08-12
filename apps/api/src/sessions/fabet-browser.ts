import { rm } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { chromium, type BrowserContext, type Page, type Request, type Response, type Route } from "playwright";
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
  authenticatedUrl?(): Promise<string>;
  withProviderPage?<T>(input: { readonly lobbyUrl: string; readonly provider: "SABA";
    readonly category: Category }, consume: (page: Page) => Promise<T>): Promise<T>;
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

export function launcherLabelFromCard(name: string, thumbnailSource: string | null): string {
  const normalized = name.trim().replace(/\s+/gu, " ");
  const source = (thumbnailSource ?? "").toLowerCase();
  if (source.includes("tpsports_")) return "APSPORT";
  if (source.includes("tsports_")) return "BTI";
  if (normalized.toUpperCase() !== "ESPORTS") return normalized;
  if (source.includes("saba_esport")) return "SABA-SPORTS";
  if (source.includes("bti_esport")) return "BTI";
  return normalized;
}

export function safeLauncherAssetName(thumbnailSource: string | null): string | null {
  if (thumbnailSource === null || thumbnailSource.length > 2_048) return null;
  try {
    const pathname = new URL(thumbnailSource, "https://lobby.invalid").pathname;
    const basename = pathname.split("/").at(-1) ?? "";
    return /^[a-z0-9._-]{1,128}$/iu.test(basename) ? basename : null;
  } catch {
    return null;
  }
}

export function providerLaunchUrlFromResponseBody(value: unknown): string | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const data = (value as Record<string, unknown>).data;
  if (typeof data !== "object" || data === null || Array.isArray(data)) return null;
  const url = (data as Record<string, unknown>).url;
  return typeof url === "string" ? url : null;
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

export function shouldBlockExternalProviderNavigation(
  lobbyOrigin: string, requestUrl: string, isNavigationRequest: boolean
): boolean {
  if (!isNavigationRequest) return false;
  try {
    const target = new URL(requestUrl);
    return (target.protocol === "https:" || target.protocol === "http:") && target.origin !== lobbyOrigin;
  } catch {
    return false;
  }
}

interface LaunchRequestLike { url(): string; method(): string }
interface LaunchResponseLike<TRequest extends LaunchRequestLike> { url(): string; ok(): boolean; request(): TRequest }

export function isProviderLaunchResponseForCurrentCard<TRequest extends LaunchRequestLike>(
  lobbyOrigin: string,
  response: LaunchResponseLike<TRequest>,
  initiatedRequests: ReadonlySet<TRequest>
): boolean {
  const request = response.request();
  if (!initiatedRequests.has(request) || request.method() !== "GET" || !response.ok()) return false;
  try {
    const requestUrl = new URL(request.url());
    const responseUrl = new URL(response.url());
    return requestUrl.origin === lobbyOrigin && requestUrl.pathname === "/api/v3/game-url" &&
      responseUrl.origin === lobbyOrigin && responseUrl.pathname === "/api/v3/game-url";
  } catch {
    return false;
  }
}

function providerHint(label: string, hostname: string): string {
  const upper = label.trim().toUpperCase();
  if (upper.includes("SABA") || upper === "C-SPORTS") return "SABA";
  if (upper === "CMD" || upper === "T-SPORTS") return "CMD";
  if (upper === "K-SPORTS") return "SBOBET";
  if (upper.includes("SBOBET")) return "SBOBET";
  if (/^APS?PORT$/u.test(upper)) return "APSPORT";
  if (upper === "BTI") return "BTI";
  if (upper === "I-SPORTS") return "IM";
  if (hostname.toLowerCase() === "imesports.techplay.com") return "IM";
  return "UNKNOWN";
}

function sabaLauncherPriority(rawName: string, label: string, thumbnailSource: string | null): number {
  const normalizedName = rawName.trim().toLocaleUpperCase("en").replace(/\s+/gu, "-");
  if (/^SABA(?:-SPORTS)?$/u.test(normalizedName)) return 0;
  const asset = safeLauncherAssetName(thumbnailSource)?.toLocaleUpperCase("en") ?? "";
  if (label === "SABA-SPORTS" || asset.includes("SABA")) return 1;
  // C-SPORTS is a legacy alias that can point to SABA, but an explicit
  // SABA-SPORTS card on the same lobby is always the authoritative launcher.
  if (normalizedName === "C-SPORTS") return 2;
  return 3;
}

function safeBrowserFailureReason(error: unknown): string {
  if (!(error instanceof Error)) return "UNKNOWN";
  if (/target page|context.*closed|page.*closed/iu.test(error.message)) return "PAGE_CLOSED";
  if (/intercepts pointer events/iu.test(error.message)) return "POINTER_INTERCEPTED";
  if (/not visible/iu.test(error.message)) return "NOT_VISIBLE";
  if (/outside of the viewport/iu.test(error.message)) return "OUTSIDE_VIEWPORT";
  if (/not enabled/iu.test(error.message)) return "NOT_ENABLED";
  if (error.name === "TimeoutError" || /timeout/iu.test(error.message)) return "TIMEOUT";
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
    const authenticated = this.#automation.authenticatedUrl === undefined
      ? entry
      : safeHttpsUrl(await this.#automation.authenticatedUrl());
    if (!(await this.#trustStore.isTrusted(authenticated.hostname))) {
      throw new FabetBrowserError("DOMAIN_APPROVAL_REQUIRED");
    }
    this.#baseOrigin = authenticated.origin;
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
          providerHint: providerHint(navigation.label, launch.hostname),
          hostname: launch.hostname,
          capturedAtMs,
          vaultRecordId
        });
        process.stderr.write(`Fabet launcher candidate: ${JSON.stringify({
          category: lobby.category,
          sourceLabel: navigation.label,
          providerHint: providerHint(navigation.label, launch.hostname),
          hostname: launch.hostname
        })}\n`);
      }
    }
    this.#diagnostics = candidates;
    return candidates;
  }

  async withProviderPage<T>(provider: "SABA", category: Category,
    consume: (page: Page) => Promise<T>): Promise<T> {
    if (this.#baseOrigin === null) throw new FabetBrowserError("NOT_AUTHENTICATED");
    if (this.#automation.withProviderPage === undefined) throw new FabetBrowserError("NOT_AUTHENTICATED");
    const type = category === "FOOTBALL" ? "livesports" : "esports";
    return this.#automation.withProviderPage({
      lobbyUrl: `${this.#baseOrigin}/lobby-the-thao?type=${type}`, provider, category
    }, consume);
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
  readonly #providerPages = new Map<string, Page>();
  readonly #providerOpenings = new Map<string, Promise<Page>>();
  readonly #providerUses = new Map<string, Promise<void>>();

  constructor(options: PlaywrightFabetAutomationOptions) {
    this.#profilePath = options.profilePath;
    this.#headless = options.headless ?? false;
  }

  async login(input: { readonly entryUrl: string; readonly username: string; readonly password: string }): Promise<void> {
    const page = await this.#getPage();
    await page.goto(input.entryUrl, { waitUntil: "domcontentloaded" });
    const username = page.locator([
      "input[placeholder*='Tên đăng nhập' i]",
      "input[placeholder*='username' i]",
      "input[autocomplete='username']",
      "input[name*='user' i]",
      "input[type='tel']"
    ].join(", ")).first();
    const password = page.locator("input[type='password']").first();
    const loginButtons = page.getByRole("button", { name: /đăng\s*nhập|login/iu });
    const authenticatedControls = page.getByRole("button", { name: /nạp\s*tiền|deposit/iu });
    await Promise.race([
      password.waitFor({ state: "visible", timeout: 10_000 }),
      loginButtons.first().waitFor({ state: "visible", timeout: 10_000 }),
      authenticatedControls.first().waitFor({ state: "visible", timeout: 10_000 })
    ]).catch(() => undefined);
    if (await authenticatedControls.first().isVisible().catch(() => false)) return;
    await this.#dismissBlockingPromotions(page);
    if (await password.count() === 0 || !(await password.isVisible().catch(() => false))) {
      const opener = loginButtons.first();
      if (await opener.count() === 0 || !(await opener.isVisible().catch(() => false))) return;
      await this.#clickLoginOpener(page, opener);
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
    const lobbyCards = page.locator(".game-item.lobby");
    await lobbyCards.first().waitFor({ state: "visible", timeout: 10_000 }).catch(() => undefined);
    const controls = await lobbyCards.count() > 0
      ? lobbyCards
      : page.locator("a, button, [role='button'], [onclick]");
    const count = Math.min(await controls.count(), 200);
    for (let index = 0; index < count; index += 1) {
        const control = controls.nth(index);
        const nameElement = control.locator(".game-item__name").first();
        const thumbnail = control.locator("img.game-item__thumb").first();
        const cardName = await nameElement.count() > 0 ? await nameElement.innerText().catch(() => "") : "";
        const thumbnailSource = await thumbnail.count() > 0
          ? await thumbnail.getAttribute("src").catch(() => null)
          : null;
        const fallbackName = await control.innerText().catch(() => "");
        const label = launcherLabelFromCard(cardName === "" ? fallbackName : cardName, thumbnailSource);
        if (!launcherTextIsSafe(label) || !(await control.isVisible().catch(() => false))) continue;
        process.stderr.write(`Fabet lobby card: ${JSON.stringify({
          label,
          asset: safeLauncherAssetName(thumbnailSource)
        })}\n`);
        const popups: Page[] = [];
        const existingPages = new Set(context.pages());
        const launchBodies: Array<Promise<string | null>> = [];
        const launchRequests = new Set<Request>();
        const onPage = (popup: Page): void => { popups.push(popup); };
        const onRequest = (request: Request): void => {
          try {
            const requestUrl = new URL(request.url());
            if (requestUrl.origin === lobbyOrigin && requestUrl.pathname === "/api/v3/game-url" &&
              request.method() === "GET") launchRequests.add(request);
          } catch {
            // Ignore malformed or unrelated requests.
          }
        };
        const onResponse = (response: Response): void => {
          if (!isProviderLaunchResponseForCurrentCard(lobbyOrigin, response, launchRequests)) return;
          launchBodies.push(response.json()
            .then((body: unknown) => providerLaunchUrlFromResponseBody(body))
            .catch(() => null));
        };
        const blockExternalProviderNavigation = async (route: Route): Promise<void> => {
          const request = route.request();
          if (shouldBlockExternalProviderNavigation(lobbyOrigin, request.url(), request.isNavigationRequest())) {
            await route.abort("blockedbyclient");
          } else {
            await route.continue();
          }
        };
        context.on("page", onPage);
        page.on("popup", onPage);
        page.on("request", onRequest);
        page.on("response", onResponse);
        await context.route("**/*", blockExternalProviderNavigation);
        try {
          const play = control.locator(".game-item__play-btn button").first();
          if (await play.count() > 0) {
            await control.hover({ timeout: 2_000 }).catch(() => undefined);
            await play.click({ timeout: 2_000 }).catch(() => undefined);
          } else {
            await control.click({ timeout: 2_000 }).catch(() => undefined);
          }
          await page.waitForTimeout(1_500);
        } finally {
          await context.unroute("**/*", blockExternalProviderNavigation);
          context.off("page", onPage);
          page.off("popup", onPage);
          page.off("request", onRequest);
          page.off("response", onResponse);
        }
        for (const launchBody of launchBodies) {
          const launchUrl = await launchBody;
          if (launchUrl !== null) record(launchUrl, label);
        }
        const openedPages = [...new Set([
          ...popups,
          ...context.pages().filter((candidate) => !existingPages.has(candidate))
        ])];
        for (const popup of openedPages) {
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

  async withProviderPage<T>(input: { readonly lobbyUrl: string; readonly provider: "SABA";
    readonly category: Category }, consume: (page: Page) => Promise<T>): Promise<T> {
    const key = `${input.provider}\u0000${input.category}`;
    const previousUse = this.#providerUses.get(key) ?? Promise.resolve();
    let releaseUse = (): void => undefined;
    const currentUse = new Promise<void>((resolveUse) => { releaseUse = resolveUse; });
    this.#providerUses.set(key, currentUse);
    await previousUse.catch(() => undefined);
    try {
      let providerPage = this.#providerPages.get(key) ?? null;
      if (providerPage === null || providerPage.isClosed()) {
        this.#providerPages.delete(key);
        let opening = this.#providerOpenings.get(key);
        if (opening === undefined) {
          opening = this.#openProviderPage(input, key).finally(() => {
            if (this.#providerOpenings.get(key) === opening) this.#providerOpenings.delete(key);
          });
          this.#providerOpenings.set(key, opening);
        }
        providerPage = await opening;
      }
      try {
        return await consume(providerPage);
      } catch (error) {
        this.#providerPages.delete(key);
        await providerPage.close().catch(() => undefined);
        throw error;
      }
    } finally {
      releaseUse();
      if (this.#providerUses.get(key) === currentUse) this.#providerUses.delete(key);
    }
  }

  async isAuthenticated(): Promise<boolean> {
    const page = await this.#getPage();
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const authenticatedControls = page.getByRole("button", { name: /nạp\s*tiền|deposit/iu });
      for (let index = 0; index < await authenticatedControls.count(); index += 1) {
        if (await authenticatedControls.nth(index).isVisible().catch(() => false)) return true;
      }
      // The SPA keeps the form visible while applying a successful login response.
      // Wait for a positive authenticated control instead of failing on that transient state.
      await page.waitForTimeout(250);
    }
    return false;
  }

  async authenticatedUrl(): Promise<string> {
    return (await this.#getPage()).url();
  }

  async close(): Promise<void> {
    await this.#context?.close();
    this.#context = null;
    this.#page = null;
    this.#providerPages.clear();
    this.#providerOpenings.clear();
    this.#providerUses.clear();
  }

  async #openProviderPage(input: { readonly lobbyUrl: string; readonly provider: "SABA";
    readonly category: Category }, key: string): Promise<Page> {
    const context = await this.#getContext();
    const lobbyOrigin = new URL(input.lobbyUrl).origin;
    const lobbyPage = await context.newPage();
    let providerPage: Page | null = null;
    let stage = "LOBBY_NAVIGATION";
    try {
      await lobbyPage.goto(input.lobbyUrl, { waitUntil: "domcontentloaded" });
      await this.#dismissBlockingPromotions(lobbyPage);
      stage = "CARD_DISCOVERY";
      const lobbyCards = lobbyPage.locator(".game-item.lobby");
      const loginControls = lobbyPage.getByRole("button", { name: /\u0111\u0103ng\s*nh\u1eadp|login/iu });
      let lobbyReady = false;
      const lobbyDeadline = Date.now() + 10_000;
      while (Date.now() < lobbyDeadline) {
        for (let index = 0; index < await loginControls.count(); index += 1) {
          if (await loginControls.nth(index).isVisible().catch(() => false)) {
            throw new FabetBrowserError("NOT_AUTHENTICATED");
          }
        }
        if (await lobbyCards.count() > 0 && await lobbyCards.first().isVisible().catch(() => false)) {
          lobbyReady = true;
          break;
        }
        await lobbyPage.waitForTimeout(100);
      }
      if (!lobbyReady) throw new Error("FABET_PROVIDER_LAUNCH_UNAVAILABLE");
      let control = null as ReturnType<Page["locator"]> | null;
      let controlSignature: string | null = null;
      let controlPriority = Number.POSITIVE_INFINITY;
      for (let index = 0; index < Math.min(await lobbyCards.count(), 200); index += 1) {
        const candidate = lobbyCards.nth(index);
        const nameElement = candidate.locator(".game-item__name").first();
        const thumbnail = candidate.locator("img.game-item__thumb").first();
        const cardName = await nameElement.count() > 0 ? await nameElement.innerText().catch(() => "") : "";
        const thumbnailSource = await thumbnail.count() > 0
          ? await thumbnail.getAttribute("src").catch(() => null)
          : null;
        const fallbackName = await candidate.innerText().catch(() => "");
        const rawName = cardName === "" ? fallbackName : cardName;
        const label = launcherLabelFromCard(rawName, thumbnailSource);
        if (providerHint(label, "") === input.provider && await candidate.isVisible().catch(() => false)) {
          const signature = `${label.trim().toLocaleUpperCase("en")}\u0000${safeLauncherAssetName(thumbnailSource) ?? ""}`;
          const priority = sabaLauncherPriority(rawName, label, thumbnailSource);
          if (priority < controlPriority) {
            control = candidate;
            controlSignature = signature;
            controlPriority = priority;
          } else if (priority === controlPriority && controlSignature !== signature) {
            process.stderr.write(`Fabet SABA card ambiguity: ${JSON.stringify([controlSignature, signature])}\n`);
            throw new Error("FABET_PROVIDER_LAUNCH_AMBIGUOUS");
          }
        }
      }
      if (control === null) throw new Error("FABET_PROVIDER_LAUNCH_UNAVAILABLE");
      if (controlPriority === 0) {
        const stableExplicitSaba = lobbyPage.locator(".game-item.lobby", { hasText: /SABA-SPORTS/iu }).first();
        if (await stableExplicitSaba.isVisible().catch(() => false)) control = stableExplicitSaba;
      } else if (controlPriority >= 1) {
        const stableLegacySaba = lobbyPage.locator(".game-item.lobby", { hasText: /C-SPORTS/iu }).first();
        if (await stableLegacySaba.isVisible().catch(() => false)) control = stableLegacySaba;
      }
      const existingPages = new Set(context.pages());
      const launchResponse = lobbyPage.waitForResponse((response) => {
        try {
          const url = new URL(response.url());
          return url.origin === lobbyOrigin && url.pathname === "/api/v3/game-url" && response.ok();
        } catch { return false; }
      }, { timeout: 10_000 }).then(async (response) => providerLaunchUrlFromResponseBody(await response.json()))
        .catch(() => null);
      stage = "CARD_CLICK";
      let clicked = false;
      let clickFailure: unknown = null;
      const hasVisibleLobbyCard = async (): Promise<boolean> => {
        for (let index = 0; index < Math.min(await lobbyCards.count(), 200); index += 1) {
          if (await lobbyCards.nth(index).isVisible().catch(() => false)) return true;
        }
        return false;
      };
      const providerNavigationStarted = async (): Promise<boolean> => {
        if (context.pages().some((candidate) => !existingPages.has(candidate) && !candidate.isClosed())) return true;
        if (lobbyPage.isClosed()) return true;
        try {
          const url = new URL(lobbyPage.url());
          if ((url.protocol === "http:" || url.protocol === "https:") && url.origin !== lobbyOrigin) return true;
        } catch { return false; }
        return !(await hasVisibleLobbyCard()) &&
          await lobbyPage.locator(".competition-select").first().isVisible().catch(() => false);
      };
      for (let attempt = 0; attempt < 3 && !clicked; attempt += 1) {
        await this.#dismissBlockingPromotions(lobbyPage);
        if (controlPriority >= 1) {
          const point = await lobbyPage.evaluate(() => {
            const card = [...document.querySelectorAll<HTMLElement>(".game-item.lobby")].find((candidate) =>
              candidate.querySelector(".game-item__name")?.textContent?.trim().toLocaleUpperCase("en") === "C-SPORTS" &&
              candidate.getClientRects().length > 0);
            if (card === undefined) return null;
            const rect = card.getBoundingClientRect();
            return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
          }).catch(() => null);
          if (point !== null) {
            try {
              await lobbyPage.mouse.move(point.x, point.y);
              await lobbyPage.waitForTimeout(500);
              const playPoint = await lobbyPage.evaluate(() => {
                const card = [...document.querySelectorAll<HTMLElement>(".game-item.lobby")].find((candidate) =>
                  candidate.querySelector(".game-item__name")?.textContent?.trim().toLocaleUpperCase("en") === "C-SPORTS" &&
                  candidate.getClientRects().length > 0);
                const button = card?.querySelector<HTMLElement>(".game-item__play-btn button");
                if (button === null || button === undefined) return null;
                const rect = button.getBoundingClientRect();
                return rect.width > 0 && rect.height > 0
                  ? { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 } : null;
              }).catch(() => null);
              await lobbyPage.mouse.click(playPoint?.x ?? point.x, playPoint?.y ?? point.y);
              for (let wait = 0; wait < 30 && !clicked; wait += 1) {
                await lobbyPage.waitForTimeout(100).catch(() => undefined);
                clicked = await providerNavigationStarted();
              }
              if (!clicked) {
                const currentLaunchUrl = await launchResponse;
                if (currentLaunchUrl !== null) {
                  const launch = new URL(currentLaunchUrl);
                  if ((launch.protocol === "https:" || launch.protocol === "http:") &&
                    launch.username === "" && launch.password === "") {
                    providerPage = await context.newPage();
                    await providerPage.goto(currentLaunchUrl, { waitUntil: "domcontentloaded", timeout: 10_000 });
                    clicked = true;
                  }
                }
              }
            } catch (error) { clickFailure = error; }
          }
        }
        if (clicked) break;
        if (controlPriority === 0) {
          const refreshed = lobbyPage.locator(".game-item.lobby", { hasText: /SABA-SPORTS/iu }).first();
          if (await refreshed.isVisible().catch(() => false)) control = refreshed;
        } else if (controlPriority >= 1) {
          const refreshed = lobbyPage.locator(".game-item.lobby", { hasText: /C-SPORTS/iu }).first();
          if (await refreshed.isVisible().catch(() => false)) control = refreshed;
        }
        const thumbnail = control.locator("img.game-item__thumb").first();
        if (await thumbnail.isVisible().catch(() => false)) {
          try {
            await thumbnail.click({ timeout: 2_000 });
            for (let wait = 0; wait < 10 && !clicked; wait += 1) {
              await lobbyPage.waitForTimeout(100).catch(() => undefined);
              clicked = await providerNavigationStarted();
            }
          } catch (error) { clickFailure = error; }
        }
        if (!clicked && controlPriority >= 1) {
          const refreshed = lobbyPage.locator(".game-item.lobby", { hasText: /C-SPORTS/iu }).first();
          if (await refreshed.isVisible().catch(() => false)) control = refreshed;
        }
        const play = control.locator(".game-item__play-btn button").first();
        if (!clicked && await play.count() > 0) {
          await control.hover({ timeout: 2_000 }).catch(() => undefined);
          if (controlPriority >= 1) {
            const refreshed = lobbyPage.locator(".game-item.lobby", { hasText: /C-SPORTS/iu }).first();
            if (await refreshed.isVisible().catch(() => false)) control = refreshed;
          }
          const activePlay = control.locator(".game-item__play-btn button").first();
          try { await activePlay.click({ timeout: 2_000 }); clicked = true; }
          catch (error) {
            clickFailure = error;
            await lobbyPage.waitForTimeout(150).catch(() => undefined);
            clicked = await providerNavigationStarted();
          }
        }
        if (!clicked) {
          try { await control.click({ timeout: 3_000 }); clicked = true; }
          catch (error) {
            clickFailure = error;
            await lobbyPage.waitForTimeout(150).catch(() => undefined);
            clicked = await providerNavigationStarted();
          }
        }
        if (!clicked) await lobbyPage.waitForTimeout(150);
      }
      if (!clicked) {
        const keyboardLauncher = control.locator(".game-item__play-btn button").first();
        if (await keyboardLauncher.count() > 0) {
          await keyboardLauncher.focus().catch(() => undefined);
          await lobbyPage.keyboard.press("Enter").catch((error) => { clickFailure = error; });
          for (let attempt = 0; attempt < 20 && !clicked; attempt += 1) {
            await lobbyPage.waitForTimeout(100).catch(() => undefined);
            clicked = await providerNavigationStarted();
          }
        }
      }
      if (!clicked) {
        throw clickFailure ?? new Error("FABET_PROVIDER_CARD_CLICK_FAILED");
      }
      stage = "POPUP_DISCOVERY";
      const deadline = Date.now() + 10_000;
      while (Date.now() < deadline) {
        if (providerPage !== null && !providerPage.isClosed()) break;
        const opened = context.pages().find((candidate) => !existingPages.has(candidate) && !candidate.isClosed() &&
          (() => {
            try {
              const url = new URL(candidate.url());
              return (url.protocol === "http:" || url.protocol === "https:") && url.origin !== lobbyOrigin;
            } catch { return false; }
          })());
        let samePage: Page | null = null;
        if (!lobbyPage.isClosed()) {
          let external = false;
          try {
            const url = new URL(lobbyPage.url());
            external = (url.protocol === "http:" || url.protocol === "https:") && url.origin !== lobbyOrigin;
          } catch { external = false; }
          const embeddedProvider = !(await hasVisibleLobbyCard()) &&
            await lobbyPage.locator(".competition-select").first().isVisible().catch(() => false);
          if (external || embeddedProvider) samePage = lobbyPage;
        }
        providerPage = opened ?? samePage;
        if (providerPage !== null) break;
        await lobbyPage.waitForTimeout(100);
      }
      if (providerPage === null) throw new Error("FABET_PROVIDER_POPUP_UNAVAILABLE");
      stage = "POPUP_LOAD";
      await providerPage.waitForLoadState("domcontentloaded", { timeout: 10_000 }).catch(() => undefined);
      this.#providerPages.set(key, providerPage);
      return providerPage;
    } catch (error) {
      if (error instanceof FabetBrowserError ||
        (error instanceof Error && /^[A-Z0-9_]+$/u.test(error.message))) throw error;
      throw new Error(`FABET_PROVIDER_${stage}_${safeBrowserFailureReason(error)}`, { cause: error });
    } finally {
      if (providerPage !== lobbyPage) await lobbyPage.close().catch(() => undefined);
    }
  }

  async #dismissBlockingPromotions(page: Page): Promise<void> {
    const dynamicCloses = page.locator([
      ".dynamic__modal:visible .icon-close-btn",
      ".dynamic-popup:visible .icon-close-btn",
      ".modal:visible .icon-close-btn"
    ].join(", "));
    for (let index = 0; index < Math.min(await dynamicCloses.count(), 5); index += 1) {
      const close = dynamicCloses.nth(index);
      if (await close.isVisible().catch(() => false)) await close.click({ timeout: 2_000 });
    }
    const dialogs = page.getByRole("dialog", { name: /khuyến\s*mãi|promotion/iu });
    for (let index = 0; index < Math.min(await dialogs.count(), 5); index += 1) {
      const dialog = dialogs.nth(index);
      if (!(await dialog.isVisible().catch(() => false))) continue;
      const close = dialog.getByRole("button", { name: /close|đóng/iu }).first();
      if (await close.isVisible().catch(() => false)) await close.click({ timeout: 2_000 });
    }
  }

  async #clickLoginOpener(page: Page, opener: ReturnType<Page["locator"]>): Promise<void> {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      await page.locator(".swal2-container:visible").first()
        .waitFor({ state: "hidden", timeout: 2_000 }).catch(() => undefined);
      await this.#dismissBlockingPromotions(page);
      try {
        await opener.click({ timeout: 2_000 });
        return;
      } catch {
        // A promotion can be mounted after the SPA renders the login button. Recheck boundedly.
      }
    }
    throw new Error("FABET_LOGIN_UNREACHABLE");
  }

  async #getContext(): Promise<BrowserContext> {
    this.#context ??= await chromium.launchPersistentContext(this.#profilePath, {
      headless: this.#headless,
      acceptDownloads: false,
      viewport: { width: 1_920, height: 1_080 }
    });
    return this.#context;
  }

  async #getPage(): Promise<Page> {
    const context = await this.#getContext();
    this.#page ??= context.pages()[0] ?? await context.newPage();
    return this.#page;
  }
}
