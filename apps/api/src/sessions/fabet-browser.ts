import { rm } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { chromium, type Browser, type BrowserContext, type Page, type Request, type Response, type Route } from "playwright";
import type { Category } from "@tool-chenh/contracts";
import { SecretVault } from "./secret-vault.js";
import { TrustedDomainStore } from "./trusted-domain-store.js";
import { observeProtocolMetadata } from "../providers/protocol-inspector.js";
import type { AuthEgress } from "./auth-egress.js";
import { attestFabetOrigin, type FabetOriginEvidence } from "./fabet-origin-attestation.js";

const FABET_ROOT_URL = "https://fabet.com/" as const;

export interface FabetAuthenticationResult {
  readonly finalUrl: string;
  readonly finalHostname: string;
  readonly encryptedStateId: string;
  readonly capturedNavigations?: readonly CapturedNavigation[];
}

export interface CapturedNavigation {
  readonly url: string;
  readonly label: string;
}

export type FabetJitProvider = "SABA" | "IM" | "CMD" | "BTI";

export interface FabetBrowserAutomation {
  login(input: { readonly entryUrl: string; readonly username: string; readonly password: string }): Promise<void>;
  captureNavigations(lobbyUrl: string): Promise<readonly CapturedNavigation[]>;
  isAuthenticated(): Promise<boolean>;
  authenticatedUrl?(): Promise<string>;
  withProviderPage?<T>(input: { readonly lobbyUrl: string; readonly provider: FabetJitProvider;
    readonly category: Category }, consume: (page: Page) => Promise<T>): Promise<T>;
  close(): Promise<void>;
  authenticate?(input: {
    readonly rootUrl: typeof FABET_ROOT_URL;
    readonly username: string;
    readonly password: string;
    readonly egress: AuthEgress;
    readonly signal: AbortSignal;
  }): Promise<FabetAuthenticationResult>;
  openDirectAuthenticatedLobby?(input: {
    readonly authentication: FabetAuthenticationResult;
    readonly signal: AbortSignal;
  }): Promise<void>;
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
  const normalizedUpper = normalized.toLocaleUpperCase("en");
  const source = (thumbnailSource ?? "").toLowerCase();
  if (normalizedUpper === "SABA SPORTS") return "SABA-SPORTS";
  if (normalizedUpper === "BTI SPORTS") return "BTI";
  if (source.includes("tpsports_")) return "APSPORT";
  if (source.includes("tsports_")) return "BTI";
  if (normalizedUpper !== "ESPORTS") return normalized;
  if (source.includes("saba_esport")) return "SABA-SPORTS";
  if (source.includes("betradar_esport")) return "I-SPORTS";
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

export function launcherMatchesCategory(category: Category, label: string): boolean {
  return category !== "LOL" || label.trim().toLocaleUpperCase("en") !== "C-SPORTS";
}

export function launcherMatchesProviderCategory(
  provider: FabetJitProvider,
  category: Category,
  label: string,
  thumbnailSource: string | null
): boolean {
  if (!launcherMatchesCategory(category, label)) return false;
  const asset = safeLauncherAssetName(thumbnailSource)?.toLocaleLowerCase("en") ?? "";
  if (provider === "IM") {
    const isImEsports = asset.includes("betradar_esport");
    return category === "LOL" ? isImEsports : !isImEsports;
  }
  if (provider !== "BTI") return true;

  const isBtiEsports = asset.includes("bti_esport");
  return category === "LOL" ? isBtiEsports : !isBtiEsports;
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
  if (error instanceof FabetBrowserError) return error.code;
  const safeCode = error.message.match(/^(?:FABET|AUTH|WARP)_[A-Z0-9_]+$/u)?.[0];
  if (safeCode !== undefined) return safeCode;
  if (/ERR_NAME_NOT_RESOLVED/iu.test(error.message)) return "DNS_FAILED";
  if (/ERR_CONNECTION_(?:REFUSED|RESET|CLOSED)/iu.test(error.message)) return "CONNECTION_FAILED";
  if (/ERR_(?:SOCKS_CONNECTION_FAILED|PROXY_CONNECTION_FAILED)/iu.test(error.message)) return "PROXY_FAILED";
  if (/ERR_(?:TIMED_OUT|CONNECTION_TIMED_OUT)/iu.test(error.message)) return "NETWORK_TIMEOUT";
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
  #pendingAuthenticatedNavigations: readonly CapturedNavigation[] = [];

  constructor(options: FabetBrowserDriverOptions) {
    this.#vault = options.vault;
    this.#trustStore = options.trustStore;
    this.#automation = options.automation;
    this.#profilesRoot = resolve(options.profilesRoot);
    this.#profilePath = resolve(join(this.#profilesRoot, "fabet"));
    this.#clock = options.clock;
    this.#idFactory = options.idFactory;
  }

  async authenticateWithEgresses(input: {
    readonly username: string;
    readonly password: string;
    readonly egresses: readonly AuthEgress[];
    readonly timeoutMs?: number;
  }): Promise<void> {
    if (this.#automation.authenticate === undefined ||
      this.#automation.openDirectAuthenticatedLobby === undefined || input.egresses.length === 0) {
      throw new Error("AUTH_EGRESS_UNAVAILABLE");
    }
    const timeoutMs = input.timeoutMs ?? 60_000;
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error("AUTH_TIMEOUT_INVALID");
    for (const egress of input.egresses) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(new Error("AUTH_TIMEOUT")), timeoutMs);
      timer.unref?.();
      try {
        const authentication = await this.#automation.authenticate({
          rootUrl: FABET_ROOT_URL,
          username: input.username,
          password: input.password,
          egress,
          signal: controller.signal,
        });
        await this.#trustStore.approve(authentication.finalHostname);
        this.#pendingAuthenticatedNavigations = authentication.capturedNavigations ?? [];
        try {
          await this.#automation.openDirectAuthenticatedLobby({ authentication, signal: controller.signal });
        } catch {
          // Some Fabet deployments bind the authenticated lobby to the WARP
          // egress IP. Launch URLs captured inside that authenticated browser
          // remain usable directly, so do not discard them merely because the
          // cookie state cannot be replayed from the machine's normal egress.
          if (this.#pendingAuthenticatedNavigations.length === 0) {
            throw new Error("FABET_AUTH_DIRECT_HANDOFF_FAILED");
          }
        }
        this.#baseOrigin = new URL(authentication.finalUrl).origin;
        return;
      } catch (error) {
        process.stderr.write(`[fabet-auth] ${egress.name}: ${safeBrowserFailureReason(error)}\n`);
        await this.#automation.close().catch(() => undefined);
      } finally {
        clearTimeout(timer);
      }
    }
    throw new Error("AUTH_EGRESS_UNAVAILABLE");
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

  async captureLobbyLaunches(categories: readonly Category[] = ["FOOTBALL", "LOL"]): Promise<readonly LaunchCandidate[]> {
    await this.#resumePersistedProfile();
    const enabled = new Set(categories);
    const lobbies: ReadonlyArray<{ category: Category; url: string }> = [
      { category: "FOOTBALL", url: `${this.#baseOrigin}/lobby-the-thao?type=livesports` },
      { category: "LOL", url: `${this.#baseOrigin}/lobby-the-thao?type=esports` }
    ];
    const candidates: LaunchCandidate[] = [];
    const seen = new Set<string>();
    for (const lobby of lobbies) {
      if (!enabled.has(lobby.category)) continue;
      const pending = lobby.category === "FOOTBALL" ? this.#pendingAuthenticatedNavigations : [];
      const navigations = pending.length > 0
        ? pending
        : await this.#automation.captureNavigations(lobby.url);
      for (const navigation of navigations) {
        if (!launcherMatchesCategory(lobby.category, navigation.label)) continue;
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
    this.#pendingAuthenticatedNavigations = [];
    this.#diagnostics = candidates;
    return candidates;
  }

  async withProviderPage<T>(provider: FabetJitProvider, category: Category,
    consume: (page: Page) => Promise<T>): Promise<T> {
    await this.#resumePersistedProfile();
    if (this.#automation.withProviderPage === undefined) throw new FabetBrowserError("NOT_AUTHENTICATED");
    const type = category === "FOOTBALL" ? "livesports" : "esports";
    return this.#automation.withProviderPage({
      lobbyUrl: `${this.#baseOrigin}/lobby-the-thao?type=${type}`, provider, category
    }, consume);
  }

  async #resumePersistedProfile(): Promise<void> {
    if (this.#baseOrigin !== null) return;
    if (!(await this.#automation.isAuthenticated()) || this.#automation.authenticatedUrl === undefined) {
      throw new FabetBrowserError("NOT_AUTHENTICATED");
    }
    const authenticated = safeHttpsUrl(await this.#automation.authenticatedUrl());
    if (!(await this.#trustStore.isTrusted(authenticated.hostname))) {
      throw new FabetBrowserError("DOMAIN_APPROVAL_REQUIRED");
    }
    this.#baseOrigin = authenticated.origin;
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
    this.#pendingAuthenticatedNavigations = [];
  }
}

export interface PlaywrightFabetAutomationOptions {
  readonly profilePath: string;
  readonly headless?: boolean;
  readonly providerPageMaxAgeMs?: number;
  readonly providerPageIdleMs?: number;
  readonly nowMs?: () => number;
  readonly vault?: SecretVault;
  readonly authenticationStateId?: string;
}

export class PlaywrightFabetAutomation implements FabetBrowserAutomation {
  readonly #profilePath: string;
  readonly #headless: boolean;
  readonly #providerPageMaxAgeMs: number;
  readonly #providerPageIdleMs: number;
  readonly #nowMs: () => number;
  readonly #vault: SecretVault | null;
  readonly #authenticationStateId: string;
  #browser: Browser | null = null;
  #context: BrowserContext | null = null;
  #page: Page | null = null;
  readonly #providerPages = new Map<string, Page>();
  readonly #providerPageOpenedAtMs = new Map<string, number>();
  readonly #providerOpenings = new Map<string, Promise<Page>>();
  readonly #providerUses = new Map<string, Promise<void>>();
  readonly #providerFailureCounts = new Map<string, number>();
  readonly #providerIdleTimers = new Map<string, ReturnType<typeof setTimeout>>();
  #providerOpeningTail: Promise<void> = Promise.resolve();

  constructor(options: PlaywrightFabetAutomationOptions) {
    this.#profilePath = options.profilePath;
    this.#headless = options.headless ?? false;
    this.#providerPageMaxAgeMs = options.providerPageMaxAgeMs ?? 300_000;
    this.#providerPageIdleMs = options.providerPageIdleMs ?? 10_000;
    this.#nowMs = options.nowMs ?? (() => performance.now());
    this.#vault = options.vault ?? null;
    this.#authenticationStateId = options.authenticationStateId ?? "fabet-browser-state";
    if (!Number.isFinite(this.#providerPageMaxAgeMs) || this.#providerPageMaxAgeMs <= 0) {
      throw new Error("FABET_PROVIDER_PAGE_MAX_AGE_INVALID");
    }
    if (!Number.isFinite(this.#providerPageIdleMs) || this.#providerPageIdleMs <= 0) {
      throw new Error("FABET_PROVIDER_PAGE_IDLE_INVALID");
    }
  }

  async login(input: { readonly entryUrl: string; readonly username: string; readonly password: string }): Promise<void> {
    const page = await this.#getPage();
    await page.goto(input.entryUrl, { waitUntil: "domcontentloaded" });
    await this.#submitLogin(page, input.username, input.password);
  }

  async authenticate(input: {
    readonly rootUrl: typeof FABET_ROOT_URL;
    readonly username: string;
    readonly password: string;
    readonly egress: AuthEgress;
    readonly signal: AbortSignal;
  }): Promise<FabetAuthenticationResult> {
    if (input.rootUrl !== FABET_ROOT_URL) throw new Error("FABET_ROOT_URL_REQUIRED");
    if (this.#vault === null) throw new Error("FABET_AUTH_VAULT_REQUIRED");
    if (input.signal.aborted) throw input.signal.reason ?? new Error("Operation aborted");

    const lease = await input.egress.acquire(input.signal).catch(() => {
      throw new Error("FABET_AUTH_EGRESS_ACQUIRE_FAILED");
    });
    let authBrowser: Browser | null = null;
    let authContext: BrowserContext | null = null;
    let stage = "BROWSER_LAUNCH";
    try {
      authBrowser = await chromium.launch({ headless: this.#headless });
      stage = "CONTEXT_CREATE";
      authContext = await authBrowser.newContext({
        acceptDownloads: false,
        viewport: { width: 1_920, height: 1_080 },
        ...(lease.playwrightProxy === null ? {} : { proxy: lease.playwrightProxy }),
      });
      stage = "PAGE_CREATE";
      const page = await authContext.newPage();
      const observedResponseUrls: string[] = [];
      page.on("response", (response) => {
        if (observedResponseUrls.length < 500) observedResponseUrls.push(response.url());
      });
      stage = "ROOT_NAVIGATION";
      await page.goto(FABET_ROOT_URL, { waitUntil: "domcontentloaded", timeout: 30_000 });
      stage = "LOGIN_SUBMIT";
      await this.#submitLogin(page, input.username, input.password);
      stage = "LOGIN_SETTLE";
      await Promise.race([
        page.locator("input[type='password']").first().waitFor({ state: "hidden", timeout: 15_000 }),
        page.locator("button").filter({ hasText: /nạp\s*tiền|deposit/iu }).first()
          .waitFor({ state: "visible", timeout: 15_000 }),
      ]).catch(() => undefined);
      await page.waitForTimeout(250);
      if (input.signal.aborted) throw input.signal.reason ?? new Error("Operation aborted");

      const finalUrl = page.url();
      const final = new URL(finalUrl);
      stage = "ORIGIN_ATTESTATION";
      const loginFormPresent = await page.locator("input[type='password']").first().isVisible().catch(() => false) ||
        await page.getByRole("button", { name: /đăng\s*nhập|login/iu }).first().isVisible().catch(() => false);
      const authenticatedControlPresent = await page.getByRole("button", { name: /nạp\s*tiền|deposit/iu })
        .first().isVisible().catch(() => false);
      const lobbyPresent = await page.locator(".game-item.lobby").first().isVisible().catch(() => false) ||
        authenticatedControlPresent;
      const sameOriginApiObserved = observedResponseUrls.some((value) => {
        try {
          const responseUrl = new URL(value);
          return responseUrl.origin === final.origin && responseUrl.pathname.startsWith("/api/");
        } catch {
          return false;
        }
      });
      const localizedLoginVisible = await page.locator("button")
        .filter({ hasText: /đăng\s*nhập|login/iu }).first().isVisible().catch(() => false);
      const localizedLobbyVisible = await page.locator("button")
        .filter({ hasText: /nạp\s*tiền|deposit/iu }).first().isVisible().catch(() => false);
      const originEvidence = {
        entryUrl: FABET_ROOT_URL,
        finalUrl,
        finalHostname: final.hostname,
        loginFormPresent: loginFormPresent || localizedLoginVisible,
        lobbyPresent: lobbyPresent || localizedLobbyVisible,
        authenticatedControlPresent: authenticatedControlPresent || localizedLobbyVisible,
        sameOriginApiObserved,
      } satisfies FabetOriginEvidence;
      if (!originEvidence.authenticatedControlPresent) throw new FabetBrowserError("UNAUTHORIZED");
      let attested: ReturnType<typeof attestFabetOrigin>;
      try {
        attested = attestFabetOrigin(originEvidence);
      } catch {
        if (!originEvidence.loginFormPresent && !originEvidence.lobbyPresent) {
          throw new Error("FABET_AUTH_CONTROLS_NOT_FOUND");
        }
        if (!originEvidence.sameOriginApiObserved) {
          throw new Error("FABET_AUTH_API_EVIDENCE_NOT_FOUND");
        }
        throw new Error("FABET_AUTH_ORIGIN_ATTESTATION_FAILED");
      }
      const storageState = await authContext.storageState();
      stage = "STATE_PERSIST";
      await this.#vault.save(this.#authenticationStateId, {
        kind: "FABET_BROWSER_STATE",
        value: JSON.stringify(storageState),
        finalUrl: attested.finalUrl,
        finalHostname: attested.finalHostname,
      });
      stage = "PROVIDER_LAUNCH_CAPTURE";
      const capturedNavigations = await this.#captureNavigationsFrom(
        authContext,
        page,
        `${final.origin}/lobby-the-thao?type=livesports`,
      );
      return {
        ...attested,
        encryptedStateId: this.#authenticationStateId,
        capturedNavigations,
      };
    } catch (error) {
      if (error instanceof Error && (error.message === "UNAUTHORIZED" ||
        /^(?:FABET|AUTH|WARP)_[A-Z0-9_]+$/u.test(error.message))) throw error;
      throw new Error(`FABET_AUTH_${stage}_FAILED`);
    } finally {
      await authContext?.close().catch(() => undefined);
      await authBrowser?.close().catch(() => undefined);
      await lease.release();
    }
  }

  async openDirectAuthenticatedLobby(input: {
    readonly authentication: FabetAuthenticationResult;
    readonly signal: AbortSignal;
  }): Promise<void> {
    if (this.#vault === null) throw new Error("FABET_AUTH_VAULT_REQUIRED");
    if (input.signal.aborted) throw input.signal.reason ?? new Error("Operation aborted");
    const secret = await this.#vault.load(input.authentication.encryptedStateId);
    if (secret?.kind !== "FABET_BROWSER_STATE" || typeof secret.value !== "string") {
      throw new Error("FABET_AUTH_STATE_UNAVAILABLE");
    }
    if (secret.finalUrl !== input.authentication.finalUrl ||
      secret.finalHostname !== input.authentication.finalHostname) {
      throw new Error("FABET_AUTH_STATE_IDENTITY_MISMATCH");
    }
    let storageState: Awaited<ReturnType<BrowserContext["storageState"]>>;
    try {
      storageState = JSON.parse(secret.value) as Awaited<ReturnType<BrowserContext["storageState"]>>;
    } catch {
      throw new Error("FABET_AUTH_STATE_INVALID");
    }
    await this.close();
    this.#browser = await chromium.launch({ headless: this.#headless });
    try {
      this.#context = await this.#browser.newContext({
        acceptDownloads: false,
        viewport: { width: 1_920, height: 1_080 },
        storageState,
      });
      this.#page = await this.#context.newPage();
      await this.#page.goto(new URL(input.authentication.finalUrl).origin, {
        waitUntil: "domcontentloaded",
        timeout: 30_000,
      });
      const authenticated = await this.#page.getByRole("button", { name: /nạp\s*tiền|deposit/iu })
        .first().isVisible().catch(() => false);
      if (!authenticated) throw new Error("FABET_AUTH_DIRECT_SESSION_LOST");
    } catch (error) {
      await this.close();
      throw error;
    }
  }

  async #submitLogin(page: Page, usernameValue: string, passwordValue: string): Promise<void> {
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
    await username.fill(usernameValue);
    await password.fill(passwordValue);
    await loginButtons.last().click();
    await page.waitForLoadState("domcontentloaded").catch(() => undefined);
  }

  async captureNavigations(lobbyUrl: string): Promise<readonly CapturedNavigation[]> {
    const context = await this.#getContext();
    const page = await this.#getPage();
    return this.#captureNavigationsFrom(context, page, lobbyUrl);
  }

  async #captureNavigationsFrom(context: BrowserContext, page: Page,
    lobbyUrl: string): Promise<readonly CapturedNavigation[]> {
    const lobbyOrigin = new URL(lobbyUrl).origin;
    const captured = new Map<string, CapturedNavigation>();
    const record = (url: string, label: string): void => {
      const navigation = capturedTopLevelNavigation(lobbyOrigin, label, url);
      if (navigation !== null) captured.set(navigation.url, navigation);
    };
    await page.goto(lobbyUrl, { waitUntil: "domcontentloaded" });
    await this.#dismissBlockingPromotions(page);
    const lobbyCards = page.locator(".game-item.lobby");
    const responsiveProviderLabel = page.getByText(
      /C-SPORTS|SABA-SPORTS|I-SPORTS|K-SPORTS|T-SPORTS|AP\s*SPORTS|BTI/iu).first();
    await Promise.race([
      lobbyCards.first().waitFor({ state: "visible", timeout: 10_000 }),
      responsiveProviderLabel.waitFor({ state: "visible", timeout: 10_000 })
    ]).catch(() => undefined);
    const controls = await lobbyCards.count() > 0
      ? lobbyCards
      : page.locator("[class*='game-item' i], [class*='lobby' i], [onclick], a, button, [role='button']");
    // Provider cards can appear after hundreds of navigation/filter controls on
    // the current responsive Fabet lobby. The old 200-node cap silently missed
    // C-Sports/SABA and returned an empty launch set.
    const summaries = await controls.evaluateAll((elements) => elements.slice(0, 1_000).map((element, index) => {
      const control = element as HTMLElement;
      return {
        index,
        visible: control.getClientRects().length > 0,
        cardName: control.querySelector<HTMLElement>(".game-item__name, [class*='name' i]")?.innerText ?? "",
        thumbnailSource: control.querySelector<HTMLImageElement>("img.game-item__thumb, img")?.getAttribute("src") ?? null,
        fallbackName: control.innerText
      };
    }));
    const seenLabels = new Set<string>();
    for (const summary of summaries) {
        const control = controls.nth(summary.index);
        const { cardName, thumbnailSource, fallbackName } = summary;
        const label = launcherLabelFromCard(cardName === "" ? fallbackName : cardName, thumbnailSource);
        if (!launcherTextIsSafe(label) || !summary.visible) continue;
        if (seenLabels.has(label)) continue;
        seenLabels.add(label);
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
          let clicked = false;
          for (let attempt = 0; attempt < 3 && !clicked; attempt += 1) {
            await this.#dismissBlockingPromotions(page);
            try {
              if (await play.count() > 0) {
                await control.hover({ timeout: 2_000 });
                await play.click({ timeout: 2_000 });
              } else {
                await control.click({ timeout: 2_000 });
              }
              clicked = true;
            } catch {
              // The promotion SPA can remount its modal between discovery and
              // click. Retry only this exact verified provider card.
            }
          }
          if (!clicked) process.stderr.write(`[fabet-launch] ${label}: CARD_CLICK_BLOCKED\n`);
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

  async withProviderPage<T>(input: { readonly lobbyUrl: string; readonly provider: FabetJitProvider;
    readonly category: Category }, consume: (page: Page) => Promise<T>): Promise<T> {
    const key = `${input.provider}\u0000${input.category}`;
    const idleTimer = this.#providerIdleTimers.get(key);
    if (idleTimer !== undefined) clearTimeout(idleTimer);
    this.#providerIdleTimers.delete(key);
    const previousUse = this.#providerUses.get(key) ?? Promise.resolve();
    let releaseUse = (): void => undefined;
    const currentUse = new Promise<void>((resolveUse) => { releaseUse = resolveUse; });
    this.#providerUses.set(key, currentUse);
    await previousUse.catch(() => undefined);
    try {
      let providerPage = this.#providerPages.get(key) ?? null;
      const openedAtMs = this.#providerPageOpenedAtMs.get(key);
      if (providerPage !== null && openedAtMs !== undefined &&
        this.#nowMs() - openedAtMs >= this.#providerPageMaxAgeMs) {
        this.#providerPages.delete(key);
        this.#providerPageOpenedAtMs.delete(key);
        await providerPage.close().catch(() => undefined);
        providerPage = null;
      }
      if (providerPage === null || providerPage.isClosed()) {
        this.#providerPages.delete(key);
        this.#providerPageOpenedAtMs.delete(key);
        let opening = this.#providerOpenings.get(key);
        if (opening === undefined) {
          const previousOpening = this.#providerOpeningTail;
          let releaseOpening = (): void => undefined;
          const currentOpening = new Promise<void>((resolveOpening) => { releaseOpening = resolveOpening; });
          this.#providerOpeningTail = currentOpening;
          opening = previousOpening.catch(() => undefined).then(async () => this.#openProviderPage(input, key))
            .finally(() => {
              releaseOpening();
            }).finally(() => {
            if (this.#providerOpenings.get(key) === opening) this.#providerOpenings.delete(key);
          });
          this.#providerOpenings.set(key, opening);
        }
        providerPage = await opening;
      }
      try {
        const result = await consume(providerPage);
        this.#providerFailureCounts.delete(key);
        return result;
      } catch (error) {
        const failures = (this.#providerFailureCounts.get(key) ?? 0) + 1;
        this.#providerFailureCounts.set(key, failures);
        if (this.#shouldDiscardProviderPage(providerPage, error) || failures >= 2) {
          this.#providerFailureCounts.delete(key);
          this.#providerPages.delete(key);
          this.#providerPageOpenedAtMs.delete(key);
          await providerPage.close().catch(() => undefined);
        }
        throw error;
      }
    } finally {
      releaseUse();
      if (this.#providerUses.get(key) === currentUse) this.#providerUses.delete(key);
      const expectedPage = this.#providerPages.get(key);
      if (expectedPage !== undefined) {
        const timer = setTimeout(() => {
          if (this.#providerPages.get(key) !== expectedPage || this.#providerUses.has(key)) return;
          this.#providerPages.delete(key);
          this.#providerPageOpenedAtMs.delete(key);
          this.#providerFailureCounts.delete(key);
          this.#providerIdleTimers.delete(key);
          void expectedPage.close().catch(() => undefined);
        }, this.#providerPageIdleMs);
        timer.unref?.();
        this.#providerIdleTimers.set(key, timer);
      }
    }
  }

  #shouldDiscardProviderPage(page: Page, error: unknown): boolean {
    if (page.isClosed()) return true;
    let current = error;
    for (let depth = 0; depth < 4 && current instanceof Error; depth += 1) {
      if (/(?:SOURCE_EXPIRED|NOT_AUTHENTICATED|UNAUTHORIZED|LAUNCH_(?:FAILED|EXPIRED)|PAGE_CLOSED|TARGET_CLOSED)/u
        .test(current.message.toUpperCase())) return true;
      if (/(?:page|context|browser|target).*closed/iu.test(current.message)) return true;
      current = current.cause;
    }
    // Catalog timeouts, temporarily empty frames and schema diagnostics do not
    // prove the authenticated provider page is bad. Retain it so the next
    // collector tick does not reopen the Fabet lobby and launch popup.
    return false;
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
    for (const timer of this.#providerIdleTimers.values()) clearTimeout(timer);
    await this.#context?.close();
    await this.#browser?.close();
    this.#browser = null;
    this.#context = null;
    this.#page = null;
    this.#providerPages.clear();
    this.#providerPageOpenedAtMs.clear();
    this.#providerOpenings.clear();
    this.#providerUses.clear();
    this.#providerFailureCounts.clear();
    this.#providerIdleTimers.clear();
    this.#providerOpeningTail = Promise.resolve();
  }

  async #openProviderPage(input: { readonly lobbyUrl: string; readonly provider: FabetJitProvider;
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
      const cardSummaries = await lobbyPage.evaluate(() =>
        [...document.querySelectorAll<HTMLElement>(".game-item.lobby")].slice(0, 200).map((candidate, index) => ({
          index,
          visible: candidate.getClientRects().length > 0,
          cardName: candidate.querySelector<HTMLElement>(".game-item__name")?.innerText ?? "",
          thumbnailSource: candidate.querySelector<HTMLImageElement>("img.game-item__thumb")?.getAttribute("src") ?? null,
          fallbackName: candidate.innerText
        })));
      for (const summary of cardSummaries) {
        const { cardName, thumbnailSource, fallbackName } = summary;
        const rawName = cardName === "" ? fallbackName : cardName;
        const label = launcherLabelFromCard(rawName, thumbnailSource);
        if (providerHint(label, "") === input.provider &&
          launcherMatchesProviderCategory(input.provider, input.category, label, thumbnailSource) &&
          summary.visible) {
          const signature = `${label.trim().toLocaleUpperCase("en")}\u0000${safeLauncherAssetName(thumbnailSource) ?? ""}`;
          const priority = sabaLauncherPriority(rawName, label, thumbnailSource);
          if (priority < controlPriority) {
            control = lobbyCards.nth(summary.index);
            controlSignature = signature;
            controlPriority = priority;
          } else if (priority === controlPriority && controlSignature !== signature) {
            process.stderr.write(`Fabet provider card ambiguity: ${JSON.stringify([controlSignature, signature])}\n`);
            throw new Error("FABET_PROVIDER_LAUNCH_AMBIGUOUS");
          }
        }
      }
      if (control === null) throw new Error("FABET_PROVIDER_LAUNCH_UNAVAILABLE");
      if (input.provider === "SABA" && controlPriority === 0) {
        const stableExplicitSaba = lobbyPage.locator(".game-item.lobby", { hasText: /SABA-SPORTS/iu }).first();
        if (await stableExplicitSaba.isVisible().catch(() => false)) control = stableExplicitSaba;
      } else if (input.provider === "SABA" && controlPriority >= 1 && input.category === "FOOTBALL") {
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
        if (input.provider === "SABA" && controlPriority >= 1 && input.category === "FOOTBALL") {
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
        if (input.provider === "SABA" && controlPriority === 0) {
          const refreshed = lobbyPage.locator(".game-item.lobby", { hasText: /SABA-SPORTS/iu }).first();
          if (await refreshed.isVisible().catch(() => false)) control = refreshed;
        } else if (input.provider === "SABA" && controlPriority >= 1 && input.category === "FOOTBALL") {
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
        if (!clicked && input.provider === "SABA" && controlPriority >= 1 && input.category === "FOOTBALL") {
          const refreshed = lobbyPage.locator(".game-item.lobby", { hasText: /C-SPORTS/iu }).first();
          if (await refreshed.isVisible().catch(() => false)) control = refreshed;
        }
        const play = control.locator(".game-item__play-btn button").first();
        if (!clicked && await play.count() > 0) {
          await control.hover({ timeout: 2_000 }).catch(() => undefined);
          if (input.provider === "SABA" && controlPriority >= 1 && input.category === "FOOTBALL") {
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
      this.#providerPageOpenedAtMs.set(key, this.#nowMs());
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
      "#s4-dynamic-popup-modal:visible .icon-close-btn",
      "#s4-dynamic-popup-modal:visible [aria-label*='close' i]",
      "#s4-dynamic-popup-modal:visible [class*='close' i]",
      ".dynamic__modal:visible .icon-close-btn",
      ".dynamic-popup:visible .icon-close-btn",
      ".modal:visible .icon-close-btn"
    ].join(", "));
    for (let index = 0; index < Math.min(await dynamicCloses.count(), 5); index += 1) {
      const close = dynamicCloses.nth(index);
      if (await close.isVisible().catch(() => false)) await close.click({ timeout: 2_000 }).catch(() => undefined);
    }
    const dialogs = page.getByRole("dialog", { name: /khuyến\s*mãi|promotion/iu });
    for (let index = 0; index < Math.min(await dialogs.count(), 5); index += 1) {
      const dialog = dialogs.nth(index);
      if (!(await dialog.isVisible().catch(() => false))) continue;
      const close = dialog.getByRole("button", { name: /close|đóng/iu }).first();
      if (await close.isVisible().catch(() => false)) await close.click({ timeout: 2_000 }).catch(() => undefined);
    }
    const blockingPromotion = page.locator("#s4-dynamic-popup-modal:visible").first();
    if (await blockingPromotion.isVisible().catch(() => false)) {
      await page.keyboard.press("Escape").catch(() => undefined);
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
    if (this.#context === null) {
      const context = await chromium.launchPersistentContext(this.#profilePath, {
        headless: this.#headless,
        acceptDownloads: false,
        viewport: { width: 1_920, height: 1_080 },
        args: ["--blink-settings=imagesEnabled=false"]
      });
      this.#context = context;
    }
    return this.#context;
  }

  async #getPage(): Promise<Page> {
    const context = await this.#getContext();
    this.#page ??= context.pages()[0] ?? await context.newPage();
    return this.#page;
  }
}
