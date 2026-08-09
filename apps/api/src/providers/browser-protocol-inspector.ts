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
