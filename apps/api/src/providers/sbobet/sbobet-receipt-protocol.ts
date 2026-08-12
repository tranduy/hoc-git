import { createHash } from "node:crypto";
import type { APIResponse, BrowserContext, Locator, Page, Request, Response } from "playwright";

export interface ReceiptProtocolObservation {
  readonly hostname: string;
  readonly method: string;
  readonly pathTemplate: string;
  readonly status: number;
  readonly contentType: string;
  readonly shape: string;
  readonly bodyHash: string;
}

export interface ReceiptProtocolInspection {
  readonly controlLabel: "Lịch sử cược" | "Bet history";
  readonly observations: readonly ReceiptProtocolObservation[];
}

const forbiddenAction = /(?:place|submit|create|confirm|cashout|wager|deposit|withdraw|dat[-_/ ]?cuoc|đặt[-_/ ]?cược)/iu;
const historyPath = /(?:history|statement|settled|transactions?)/iu;

function normalizedLabel(value: string): string {
  return value.normalize("NFKC").replace(/\s+/gu, " ").trim().toLocaleLowerCase("en");
}

export function isSafeReceiptHistoryLabel(value: string): boolean {
  const label = normalizedLabel(value);
  return label === "lịch sử cược" || label === "bet history";
}

export function safeReceiptResponseCandidate(method: string, rawUrl: string): boolean {
  if (!/^(?:GET|POST)$/u.test(method.toUpperCase())) return false;
  try {
    const path = new URL(rawUrl).pathname;
    return historyPath.test(path) && !forbiddenAction.test(path) &&
      !/\.(?:css|js|mjs|map|png|jpe?g|gif|svg|webp|ico|woff2?|ttf|eot)$/iu.test(path);
  } catch {
    return false;
  }
}

function safeOpaqueDataCandidate(method: string, rawUrl: string, resourceType: string): boolean {
  if (!/^(?:fetch|xhr)$/u.test(resourceType) || !/^(?:GET|POST)$/u.test(method.toUpperCase())) return false;
  try {
    const url = new URL(rawUrl);
    return /^(?:https?):$/u.test(url.protocol) && !forbiddenAction.test(url.pathname) &&
      !/\.(?:css|js|mjs|map|png|jpe?g|gif|svg|webp|ico|woff2?|ttf|eot)$/iu.test(url.pathname);
  } catch {
    return false;
  }
}

function valueShape(value: unknown, depth = 0): string {
  if (depth >= 8) return "depth-limit";
  if (value === null) return "null";
  if (typeof value === "string") {
    const candidate = value.trim();
    if (candidate.startsWith("{") || candidate.startsWith("[")) {
      try { return `json-string<${valueShape(JSON.parse(candidate), depth + 1)}>`; }
      catch { /* ordinary provider text remains a string */ }
    }
    return "string";
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return "array<empty>";
    const shapes = [...new Set(value.slice(0, 20).map((item) => valueShape(item, depth + 1)))].sort();
    return `array<${shapes.join("|")}>`;
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).slice(0, 100)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${/^(?:\d{1,2}|[A-Za-z][A-Za-z0-9_]{0,63})$/u.test(key) ? key : ":key"}:${valueShape(child, depth + 1)}`);
    return `object{${entries.join(",")}}`;
  }
  return typeof value;
}

function responsePathTemplate(rawUrl: string): string {
  const path = new URL(rawUrl).pathname;
  return path.split("/").map((part) =>
    /^(?:\d{4,}|[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})$/iu.test(part) ? ":id" : part
  ).join("/").slice(0, 512);
}

async function safeObservation(response: Response): Promise<ReceiptProtocolObservation | null> {
  const method = response.request().method().toUpperCase();
  if (!safeReceiptResponseCandidate(method, response.url()) &&
    !safeOpaqueDataCandidate(method, response.url(), response.request().resourceType())) return null;
  try {
    const body = (await response.body()).subarray(0, 2_000_000);
    const text = body.toString("utf8");
    let shape = "non-json";
    try { shape = valueShape(JSON.parse(text)); } catch { /* retain only non-json marker */ }
    const url = new URL(response.url());
    return {
      hostname: url.hostname,
      method,
      pathTemplate: responsePathTemplate(response.url()),
      status: response.status(),
      contentType: (response.headers()["content-type"] ?? "unknown").split(";", 1)[0]!.toLowerCase(),
      shape,
      bodyHash: createHash("sha256").update(body).digest("hex")
    };
  } catch {
    return null;
  }
}

function isExactBetsReportingRequest(request: Request): boolean {
  if (request.method().toUpperCase() !== "GET") return false;
  try { return new URL(request.url()).pathname === "/api/v2/bet/getBetsReporting"; }
  catch { return false; }
}

async function safeReplayObservation(response: APIResponse, rawUrl: string): Promise<ReceiptProtocolObservation | null> {
  try {
    const body = (await response.body()).subarray(0, 2_000_000);
    const text = body.toString("utf8");
    let shape = "non-json";
    try { shape = valueShape(JSON.parse(text)); } catch { /* retain only non-json marker */ }
    const url = new URL(rawUrl);
    return {
      hostname: url.hostname,
      method: "GET",
      pathTemplate: responsePathTemplate(rawUrl),
      status: response.status(),
      contentType: (response.headers()["content-type"] ?? "unknown").split(";", 1)[0]!.toLowerCase(),
      shape,
      bodyHash: createHash("sha256").update(body).digest("hex")
    };
  } catch {
    return null;
  }
}

async function inspectSettledHistory(context: BrowserContext, request: Request): Promise<ReceiptProtocolObservation | null> {
  const url = new URL(request.url());
  url.searchParams.set("index", "0");
  url.searchParams.set("size", "10");
  url.searchParams.set("status", "Settled");
  url.searchParams.set("check-total", "true");
  const headers = await request.allHeaders();
  for (const name of ["host", "content-length", "connection", "accept-encoding"]) delete headers[name];
  try {
    const response = await context.request.get(url.toString(), {
      headers, timeout: 5_000, failOnStatusCode: false
    });
    return safeReplayObservation(response, url.toString());
  } catch {
    return null;
  }
}

async function exactHistoryControl(page: Page): Promise<{
  readonly locator: Locator;
  readonly label: "Lịch sử cược" | "Bet history";
  readonly page: Page;
} | null> {
  for (const frame of page.frames()) {
    const labels = frame.getByText(/^\s*(?:Lịch sử cược|Bet history)\s*$/iu);
    for (let index = 0; index < Math.min(await labels.count(), 20); index += 1) {
      const candidate = labels.nth(index);
      if (!await candidate.isVisible().catch(() => false)) continue;
      const text = (await candidate.innerText().catch(() => "")).trim();
      if (!isSafeReceiptHistoryLabel(text)) continue;
      const explicit = candidate.locator("xpath=ancestor-or-self::*[self::a or self::button or @role='button' or @onclick][1]");
      const control = await explicit.count() === 1 && await explicit.isVisible().catch(() => false) ? explicit : candidate;
      return { locator: control, label: normalizedLabel(text) === "bet history" ? "Bet history" : "Lịch sử cược", page };
    }
  }
  return null;
}

export async function inspectReadOnlyReceiptProtocol(
  context: BrowserContext,
  page: Page,
  options: { readonly waitMs?: number } = {}
): Promise<ReceiptProtocolInspection> {
  const waitMs = options.waitMs ?? 2_000;
  if (!Number.isFinite(waitMs) || waitMs < 0 || waitMs > 5_000) throw new Error("SBOBET_HISTORY_INSPECTION_INVALID");
  const pages = [page, ...context.pages().filter((candidate) => candidate !== page && !candidate.isClosed())];
  let control: Awaited<ReturnType<typeof exactHistoryControl>> = null;
  for (const candidate of pages) {
    control = await exactHistoryControl(candidate);
    if (control !== null) break;
  }
  if (control === null) throw new Error("SBOBET_HISTORY_CONTROL_UNAVAILABLE");
  const observations: ReceiptProtocolObservation[] = [];
  let betsReportingRequest: Request | null = null;
  const pending = new Set<Promise<void>>();
  const onResponse = (response: Response): void => {
    if (isExactBetsReportingRequest(response.request())) betsReportingRequest = response.request();
    const task = safeObservation(response).then((value) => { if (value !== null) observations.push(value); })
      .finally(() => pending.delete(task));
    pending.add(task);
  };
  context.on("response", onResponse);
  try {
    await control.locator.click({ timeout: 2_000 });
    if (waitMs > 0) await control.page.waitForTimeout(waitMs);
    await Promise.allSettled([...pending]);
    if (betsReportingRequest !== null) {
      const settled = await inspectSettledHistory(context, betsReportingRequest);
      if (settled !== null) observations.push(settled);
    }
  } finally {
    context.off("response", onResponse);
  }
  const unique = new Map(observations.map((item) => [JSON.stringify(item), item]));
  return { controlLabel: control.label, observations: [...unique.values()] };
}
