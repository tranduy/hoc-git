import type { Frame, Locator, Page } from "playwright";
import { inspectionStructuralSelectors, safeControlShape, type SafeControlShape } from "./protocol-inspector.js";

const candidateSelector = [
  "[class*='sport' i]", "[class*='live' i]", "[class*='upcoming' i]", "[class*='account' i]",
  "[class*='balance' i]", "[class*='event' i]", "[class*='market' i]"
].join(", ");

async function readSafeShape(candidate: Locator): Promise<SafeControlShape> {
  return safeControlShape({
    tagName: await candidate.evaluate((element) => element.tagName).catch(() => "unknown"),
    className: await candidate.getAttribute("class").catch(() => null) ?? "",
    role: await candidate.getAttribute("role").catch(() => null),
    labels: [
      await candidate.innerText().catch(() => ""),
      await candidate.getAttribute("aria-label").catch(() => null) ?? "",
      await candidate.getAttribute("title").catch(() => null) ?? ""
    ]
  });
}

export async function collectSafeControlShapes(page: Page, limit = 400): Promise<readonly SafeControlShape[]> {
  const result = new Map<string, SafeControlShape>();
  let inspected = 0;
  for (const frame of page.frames()) {
    const candidates = frame.locator(candidateSelector);
    const count = Math.min(await candidates.count(), Math.max(0, limit - inspected));
    for (let index = 0; index < count; index += 1) {
      inspected += 1;
      const candidate = candidates.nth(index);
      if (!(await candidate.isVisible().catch(() => false))) continue;
      const shape = await readSafeShape(candidate);
      if (shape.classTokens.length > 0 || shape.label !== undefined) result.set(JSON.stringify(shape), shape);
      const isCategoryIcon = await candidate.evaluate((element, selectors) =>
        selectors.some((selector) => element.matches(selector)), inspectionStructuralSelectors).catch(() => false);
      if (isCategoryIcon) {
        const ancestors = candidate.locator("xpath=ancestor::*[position() <= 5]");
        const ancestorCount = Math.min(await ancestors.count(), 5);
        for (let ancestorIndex = 0; ancestorIndex < ancestorCount; ancestorIndex += 1) {
          const ancestorShape = await readSafeShape(ancestors.nth(ancestorIndex));
          if (ancestorShape.classTokens.length > 0 || ancestorShape.role !== undefined) {
            result.set(JSON.stringify(ancestorShape), ancestorShape);
          }
        }
      }
    }
    if (inspected >= limit) break;
  }
  return [...result.values()];
}

export async function clickSafeStructuralCategories(page: Page, delayMs = 2_000): Promise<number> {
  let clicked = 0;
  for (const selector of inspectionStructuralSelectors) {
    let handled = false;
    for (const frame of page.frames()) {
      const icons = frame.locator(selector);
      const count = Math.min(await icons.count(), 20);
      for (let index = 0; index < count; index += 1) {
        const icon = icons.nth(index);
        if (!(await icon.isVisible().catch(() => false))) continue;
        const control = icon.locator("xpath=ancestor-or-self::*[self::a or self::button or @role='button' or @onclick or contains(concat(' ', normalize-space(@class), ' '), ' c-side-nav__btn ')][1]");
        if (await control.count() === 0 || !(await control.isVisible().catch(() => false))) continue;
        await control.click({ timeout: 2_000 });
        clicked += 1;
        handled = true;
        if (delayMs > 0) await page.waitForTimeout(delayMs);
        break;
      }
      if (handled) break;
    }
  }
  return clicked;
}

export async function clickSafeStructuralCategory(
  page: Page,
  sportId: "1" | "43",
  delayMs = 2_000
): Promise<boolean> {
  const selector = sportId === "1" ? ".c-iconcolor-sport1" : ".c-iconcolor-sport43";
  for (const frame of page.frames()) {
    const icons = frame.locator(selector);
    const count = Math.min(await icons.count(), 20);
    for (let index = 0; index < count; index += 1) {
      const icon = icons.nth(index);
      if (!(await icon.isVisible().catch(() => false))) continue;
      const control = icon.locator("xpath=ancestor-or-self::*[self::a or self::button or @role='button' or @onclick or contains(concat(' ', normalize-space(@class), ' '), ' c-side-nav__btn ')][1]");
      if (await control.count() === 0 || !(await control.isVisible().catch(() => false))) continue;
      await control.click({ timeout: 2_000 });
      if (delayMs > 0) await page.waitForTimeout(delayMs);
      return true;
    }
  }
  return false;
}

export async function clickSafeLiveCatalog(page: Page, delayMs = 2_000): Promise<boolean> {
  for (const frame of page.frames()) {
    const controls = frame.locator(".c-side-nav--event .c-side-nav__btn");
    const count = Math.min(await controls.count(), 20);
    for (let index = 0; index < count; index += 1) {
      const control = controls.nth(index);
      if (!(await control.isVisible().catch(() => false))) continue;
      const dataView = (await control.getAttribute("data-view").catch(() => null))?.trim().toLocaleLowerCase("en");
      const label = (await control.innerText().catch(() => "")).trim().replace(/\s+/gu, " ").toLocaleLowerCase("vi");
      if (dataView !== "live" && label !== "live" && label !== "tr\u1ef1c ti\u1ebfp") continue;
      await control.click({ timeout: 2_000 });
      if (delayMs > 0) await page.waitForTimeout(delayMs);
      return true;
    }
    const labels = frame.getByText(/^\s*(?:live|tr\u1ef1c ti\u1ebfp)\s*\d*\s*$/iu);
    const labelCount = Math.min(await labels.count(), 20);
    for (let index = 0; index < labelCount; index += 1) {
      const label = labels.nth(index);
      if (!(await label.isVisible().catch(() => false))) continue;
      const control = label.locator("xpath=ancestor-or-self::*[self::a or self::button or @role='button' or @onclick][1]");
      const target = await control.count() > 0 ? control : label;
      await target.click({ timeout: 2_000 });
      if (delayMs > 0) await page.waitForTimeout(delayMs);
      return true;
    }
  }
  return false;
}

export async function findAccessTokenFrame<T extends {
  evaluate(pageFunction: () => boolean): Promise<boolean>;
}>(page: { frames(): readonly T[] }): Promise<T | null> {
  for (const frame of page.frames()) {
    if (await frame.evaluate(() => Boolean(sessionStorage.getItem("at"))).catch(() => false)) return frame;
  }
  return null;
}

export async function discoverApiOriginFromFrame(frame: Pick<Frame, "evaluate">): Promise<string | null> {
  return frame.evaluate(() => {
    const utilPack = (globalThis as unknown as {
      UtilPack?: { siteInfoStore?: { attrs?: { ApiBackendUrl?: unknown } } }
    }).UtilPack;
    const candidate = utilPack?.siteInfoStore?.attrs?.ApiBackendUrl;
    if (typeof candidate !== "string") return null;
    try {
      const parsed = new URL(candidate);
      const pathname = parsed.pathname.replace(/\/$/u, "") || "/";
      if (parsed.protocol !== "https:" || parsed.username || parsed.password ||
        !["/", "/api"].includes(pathname) || parsed.search || parsed.hash) return null;
      return `${parsed.origin}${pathname === "/" ? "" : pathname}`;
    } catch { return null; }
  }).catch(() => null);
}

export async function findApiOriginFromPage(page: Page): Promise<string | null> {
  for (const frame of page.frames()) {
    const origin = await discoverApiOriginFromFrame(frame);
    if (origin !== null) return origin;
  }
  return null;
}

export async function findProviderRuntimeFrame(page: Page): Promise<Frame | null> {
  for (const frame of page.frames()) {
    const ready = await frame.evaluate(() => {
      const runtime = (globalThis as unknown as {
        UtilPack?: {
          siteInfoStore?: { attrs?: { ApiBackendUrl?: unknown } };
          SyncServer?: { json?: unknown };
        }
      }).UtilPack;
      let hasToken = false;
      try { hasToken = Boolean(sessionStorage.getItem("at")); } catch { hasToken = false; }
      return hasToken && typeof runtime?.siteInfoStore?.attrs?.ApiBackendUrl === "string" &&
        typeof runtime?.SyncServer?.json === "function";
    }).catch(() => false);
    if (ready) return frame;
  }
  return null;
}

export async function readProviderAccountStore(frame: Frame): Promise<unknown> {
  return frame.evaluate(() => {
    const attrs = (globalThis as unknown as {
      UtilPack?: { accountStore?: { attrs?: unknown } }
    }).UtilPack?.accountStore?.attrs;
    if (typeof attrs !== "object" || attrs === null) return null;
    try { return JSON.parse(JSON.stringify(attrs)) as unknown; } catch { return null; }
  }).catch(() => null);
}

export type ReadOnlyProfileProbeInput = (
  | { readonly endpoint: "/Customer/Balance"; readonly method: "POST" }
  | { readonly endpoint: "/CashMember/GetUserInfo"; readonly method: "GET" }
) & { readonly timeoutMs: number };

export async function probeReadOnlyProfileThroughRuntime(
  frame: Frame,
  input: ReadOnlyProfileProbeInput
): Promise<{
  readonly status: "OK" | "ERROR" | "UNAVAILABLE" | "TIMEOUT";
  readonly httpStatus: number | null;
  readonly body: unknown;
}> {
  return frame.evaluate(async (request) => {
    const allowed = (request.endpoint === "/Customer/Balance" && request.method === "POST") ||
      (request.endpoint === "/CashMember/GetUserInfo" && request.method === "GET");
    if (!allowed) return { status: "UNAVAILABLE" as const, httpStatus: null, body: null };
    const runtime = (globalThis as unknown as {
      UtilPack?: {
        siteInfoStore?: { attrs?: { ApiBackendUrl?: unknown } };
        SyncServer?: {
          json?: (...args: unknown[]) => unknown;
        };
      }
    }).UtilPack;
    const baseUrl = runtime?.siteInfoStore?.attrs?.ApiBackendUrl;
    let token: string | null = null;
    try { token = sessionStorage.getItem("at"); } catch { token = null; }
    if (typeof baseUrl !== "string" || typeof runtime?.SyncServer?.json !== "function" || !token) {
      return { status: "UNAVAILABLE" as const, httpStatus: null, body: null };
    }
    try {
      const parsed = new URL(baseUrl);
      const pathname = parsed.pathname.replace(/\/$/u, "") || "/";
      if (parsed.protocol !== "https:" || parsed.username || parsed.password ||
        !["/", "/api"].includes(pathname) || parsed.search || parsed.hash) {
        return { status: "UNAVAILABLE" as const, httpStatus: null, body: null };
      }
      const cleanBaseUrl = `${parsed.origin}${pathname === "/" ? "" : pathname}`;
      return await new Promise<{
        status: "OK" | "ERROR" | "TIMEOUT";
        httpStatus: number | null;
        body: unknown;
      }>((resolve) => {
        const timeout = window.setTimeout(() => resolve({ status: "TIMEOUT", httpStatus: null, body: null }), request.timeoutMs);
        const finish = (status: "OK" | "ERROR", body: unknown): void => {
          window.clearTimeout(timeout);
          let httpStatus: number | null = null;
          let normalizedBody = body;
          if (status === "ERROR" && typeof body === "object" && body !== null) {
            const error = body as { status?: unknown; responseText?: unknown };
            if (typeof error.status === "number" && Number.isInteger(error.status)) httpStatus = error.status;
            if (typeof error.responseText === "string") {
              try { normalizedBody = JSON.parse(error.responseText) as unknown; } catch { normalizedBody = null; }
            }
          }
          resolve({ status, httpStatus, body: normalizedBody });
        };
        const headers: Record<string, string> = { Authorization: `bearer ${token}` };
        if (request.method === "POST") headers["Content-Type"] = "application/json";
        try {
          runtime.SyncServer!.json!(
            `${cleanBaseUrl}${request.endpoint}`,
            {},
            (body: unknown) => finish("OK", body),
            true,
            (body: unknown) => finish("ERROR", body),
            request.method,
            "json",
            headers
          );
        } catch { finish("ERROR", null); }
      });
    } catch { return { status: "UNAVAILABLE" as const, httpStatus: null, body: null }; }
  }, input);
}

export interface CmdCatalogDomShape {
  readonly sportId: "1" | "43";
  readonly tagName: string;
  readonly classTokens: readonly string[];
  readonly dataKeys: readonly string[];
  readonly text: string | null;
}

export async function collectCmdCatalogShapes(page: Page): Promise<readonly CmdCatalogDomShape[]> {
  const output: CmdCatalogDomShape[] = [];
  for (const frame of page.frames()) {
    const shapes = await frame.evaluate(() => {
      const collected: Array<{
        sportId: "1" | "43";
        tagName: string;
        classTokens: string[];
        dataKeys: string[];
        text: string | null;
      }> = [];
      for (const sportId of ["1", "43"] as const) {
        const roots = document.querySelectorAll(`.c-odds-table--sport${sportId}`);
        for (const root of roots) {
          const candidates = [root, ...root.querySelectorAll("*")];
          for (const element of candidates) {
            const classTokens = [...element.classList]
              .filter((token) => /(?:league|event|match|team|odds|market|time|score|name|selection)/iu.test(token))
              .sort();
            const dataKeys = [...element.attributes]
              .map((attribute) => attribute.name)
              .filter((name) => name.startsWith("data-"))
              .sort();
            if (classTokens.length === 0 && dataKeys.length === 0) continue;
            const rawText = element.children.length === 0 ? element.textContent?.replace(/\s+/gu, " ").trim() ?? "" : "";
            collected.push({
              sportId,
              tagName: element.tagName.toLowerCase(),
              classTokens,
              dataKeys,
              text: rawText.length > 0 && rawText.length <= 160 ? rawText : null
            });
            if (collected.length >= 500) return collected;
          }
        }
      }
      return collected;
    }).catch(() => [] as CmdCatalogDomShape[]);
    output.push(...shapes);
  }
  return output.slice(0, 500);
}

export interface CmdCatalogRecord {
  readonly sportId: "1" | "43";
  readonly leagueId: string;
  readonly leagueName: string;
  readonly matchId: string;
  readonly timeText: string;
  readonly teamNames: readonly string[];
  readonly groups: readonly {
    readonly betTypeIds: readonly string[];
    readonly labels: readonly string[];
    readonly odds: readonly {
      readonly marketOddsId: string;
      readonly priceText: string;
      readonly status: string | null;
      readonly greyedOut: string | null;
    }[];
  }[];
}

export async function extractCmdCatalogRecords(
  page: Page,
  limit = 200,
  sportFilter?: "1" | "43",
  allowedBetTypeIds?: readonly string[]
): Promise<readonly CmdCatalogRecord[]> {
  if (!Number.isSafeInteger(limit) || limit <= 0 || limit > 1_000) throw new Error("invalid CMD catalog limit");
  const batches = await Promise.all(page.frames().map(async (frame) => frame.evaluate(({
    frameLimit, requestedSport, requestedBetTypes
  }) => {
      const clean = (value: string | null | undefined, max = 160): string => {
        const normalized = value?.replace(/\s+/gu, " ").trim() ?? "";
        return normalized.length <= max ? normalized : "";
      };
      const directText = (element: Element): string => clean([...element.childNodes]
        .filter((node) => node.nodeType === Node.TEXT_NODE)
        .map((node) => node.textContent ?? "").join(" "), 80);
      const result: CmdCatalogRecord[] = [];
      const sportIds: readonly ("1" | "43")[] = requestedSport === undefined ? ["1", "43"] : [requestedSport];
      for (const sportId of sportIds) {
        for (const match of document.querySelectorAll(`.c-odds-table--sport${sportId} .c-match[data-matchid]`)) {
          const matchId = clean(match.getAttribute("data-matchid"), 128);
          const league = match.closest(".c-league");
          if (matchId.length === 0 || league === null) continue;
          const groups = [...match.querySelectorAll(".c-match__odds-group")].flatMap((container) => {
            const marketRows = [...container.querySelectorAll("[data-bt]")]
              .filter((row) => row.querySelector(".c-odds[data-moid]") !== null);
            const groupElements = marketRows.length > 0 ? marketRows : [container];
            return groupElements.map((group) => {
            const semanticElements = [
              ...(group.matches("[data-bt], [data-in-play]") ? [group] : []),
              ...group.querySelectorAll("[data-bt], [data-in-play]")
            ];
            const directLabels = semanticElements
              .filter((element) => !element.classList.contains("c-odds"))
              .map(directText);
            const leafLabels = [...group.querySelectorAll("*")]
              .filter((element) => element.children.length === 0 && !element.classList.contains("c-odds") &&
                !element.matches("i, svg, path"))
              .map((element) => clean(element.textContent, 80));
            const labels = [...directLabels, ...leafLabels]
              .filter((value, index, values) => value.length > 0 && values.indexOf(value) === index);
            const betTypeElements = [
              ...(group.matches("[data-bt]") ? [group] : []),
              ...group.querySelectorAll("[data-bt]")
            ];
            const betTypeIds = betTypeElements
              .map((element) => clean(element.getAttribute("data-bt"), 80))
              .filter((value, index, values) => value.length > 0 && values.indexOf(value) === index);
            const odds = [...group.querySelectorAll(".c-odds[data-moid]")].map((element) => {
              const button = element.closest(".c-odds-button");
              const base = {
                marketOddsId: clean(element.getAttribute("data-moid"), 128),
                priceText: clean(element.textContent, 32),
                status: button === null ? null : clean(button.getAttribute("data-odds-status"), 32) || null,
                greyedOut: button === null ? null : clean(button.getAttribute("data-grey-out"), 16) || null
              };
              if (!betTypeIds.includes("1")) return base;
              const clone = button?.cloneNode(true) as Element | undefined;
              clone?.querySelectorAll(".c-odds").forEach((price) => price.remove());
              const evidence = clone === undefined ? "" : clean(clone.textContent, 32);
              const lineText = evidence.match(/[+-]?\d+(?:\.\d+)?(?:\s*[\/-]\s*\d+(?:\.\d+)?)?/u)?.[0] ?? null;
              return { ...base, lineText };
            }).filter((odd) => odd.marketOddsId.length > 0 && odd.priceText.length > 0);
              return { betTypeIds, labels, odds };
            });
          }).filter((group) => group.odds.length > 0 && (requestedBetTypes === null ||
            (group.betTypeIds.length === 1 && requestedBetTypes.includes(group.betTypeIds[0]!))));
          const teamNames = [...match.querySelectorAll(".c-team-name")]
            .map((element) => clean(element.textContent, 160)).filter((value) => value.length > 0)
            .filter((value, index, values) => values.indexOf(value) === index).slice(0, 4);
          result.push({
            sportId,
            leagueId: clean(league.getAttribute("data-leagueid"), 128),
            leagueName: clean(league.querySelector(".c-league__name")?.textContent, 160),
            matchId,
            timeText: clean(match.querySelector(".c-match-time")?.textContent, 80),
            teamNames,
            groups
          });
          if (result.length >= frameLimit) return result;
        }
      }
      return result;
    }, { frameLimit: limit, requestedSport: sportFilter,
      requestedBetTypes: allowedBetTypeIds === undefined ? null : [...allowedBetTypeIds] })
    .catch(() => [] as CmdCatalogRecord[])));
  return batches.flat().slice(0, limit);
}

export interface CmdCatalogNavigationShape {
  readonly tagName: string;
  readonly classTokens: readonly string[];
  readonly dataKeys: readonly string[];
  readonly text: string;
}

export async function collectCmdCatalogNavigation(page: Page): Promise<readonly CmdCatalogNavigationShape[]> {
  const output: CmdCatalogNavigationShape[] = [];
  for (const frame of page.frames()) {
    const shapes = await frame.evaluate(() => [...document.querySelectorAll(".c-side-nav--event .c-side-nav__btn")]
      .map((element) => ({
        tagName: element.tagName.toLowerCase(),
        classTokens: [...element.classList].sort(),
        dataKeys: [...element.attributes].map((attribute) => attribute.name)
          .filter((name) => name.startsWith("data-")).sort(),
        text: element.textContent?.replace(/\s+/gu, " ").trim().slice(0, 120) ?? ""
      })).filter((shape) => shape.text.length > 0).slice(0, 100)).catch(() => [] as CmdCatalogNavigationShape[]);
    output.push(...shapes);
  }
  return output.slice(0, 100);
}

export async function findCmdCatalogPage(pages: readonly Page[]): Promise<Page | null> {
  for (const page of pages) {
    for (const frame of page.frames()) {
      const icon = frame.locator(".c-iconcolor-sport1").first();
      if (await icon.isVisible().catch(() => false)) return page;
    }
  }
  return null;
}

export interface CmdIdentitySignals {
  readonly runtime: boolean;
  readonly football: boolean;
  readonly esports: boolean;
  readonly cmdBundle: boolean;
}

export async function collectCmdIdentitySignals(page: Page): Promise<CmdIdentitySignals> {
  const result = { runtime: false, football: false, esports: false, cmdBundle: false };
  for (const frame of page.frames()) {
    const signals = await frame.evaluate(() => {
      const runtime = (globalThis as unknown as {
        UtilPack?: {
          accountStore?: { attrs?: unknown };
          siteInfoStore?: { attrs?: { ApiBackendUrl?: unknown } };
          SyncServer?: { json?: unknown };
        }
      }).UtilPack;
      let hasToken = false;
      try { hasToken = Boolean(sessionStorage.getItem("at")); } catch { hasToken = false; }
      const account = runtime?.accountStore?.attrs;
      return {
        runtime: hasToken && typeof account === "object" && account !== null &&
          typeof (account as Record<string, unknown>).Bal === "object" &&
          typeof runtime?.siteInfoStore?.attrs?.ApiBackendUrl === "string" &&
          typeof runtime?.SyncServer?.json === "function",
        football: document.querySelector(".c-iconcolor-sport1") !== null,
        esports: document.querySelector(".c-iconcolor-sport43") !== null,
        cmdBundle: [...document.scripts].some((script) => {
          try { return new URL(script.src).pathname === "/MS2L/Js/dt/main.js"; } catch { return false; }
        })
      };
    }).catch(() => ({ runtime: false, football: false, esports: false, cmdBundle: false }));
    result.runtime ||= signals.runtime;
    result.football ||= signals.football;
    result.esports ||= signals.esports;
    result.cmdBundle ||= signals.cmdBundle;
  }
  return result;
}

export async function waitForCmdIdentitySignals(
  page: Page,
  timeoutMs: number,
  pollingIntervalMs = 100
): Promise<CmdIdentitySignals> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || !Number.isFinite(pollingIntervalMs) || pollingIntervalMs <= 0) {
    throw new Error("invalid CMD identity wait options");
  }
  const deadline = Date.now() + timeoutMs;
  let signals = await collectCmdIdentitySignals(page);
  while (!(signals.runtime && signals.football && signals.esports && signals.cmdBundle) && Date.now() < deadline) {
    await page.waitForTimeout(Math.min(pollingIntervalMs, Math.max(1, deadline - Date.now())));
    signals = await collectCmdIdentitySignals(page);
  }
  return signals;
}
