import type { CDPSession, Frame, Page, Request } from "playwright";

type ProtocolDirection = "SENT" | "RECEIVED";

export interface CmdProtocolFrameSummary {
  readonly direction: ProtocolDirection;
  readonly byteLength: number;
  readonly eventIdReferenced: boolean;
  readonly jsonKeys: readonly string[];
  readonly channelPaths: readonly string[];
}

export interface CmdHttpEvidence {
  readonly method: string;
  readonly hostname: string;
  readonly pathname: string;
  readonly resourceType: string;
  readonly eventIdReferenced: boolean;
}

export interface CmdHiddenMarketProbeResult {
  readonly providerEventId: string;
  readonly status: "EXPANDED" | "NO_NEW_MARKETS" | "NO_SAFE_CONTROL" | "EVENT_NOT_FOUND" | "TIMEOUT";
  readonly beforeMarketIds: readonly string[];
  readonly afterMarketIds: readonly string[];
  readonly clickedControlCount: number;
  readonly clickedControls: readonly string[];
  readonly candidateControls: readonly string[];
  readonly marketStructures: readonly string[];
  readonly visibleEventIds: readonly string[];
  readonly stablePasses: number;
  readonly httpEvidence: readonly CmdHttpEvidence[];
  readonly websocketEvidence: readonly CmdProtocolFrameSummary[];
}

export interface CmdHiddenMarketProbeOptions {
  readonly withProviderPage: <T>(provider: "CMD", category: "FOOTBALL",
    consume: (page: Page) => Promise<T>) => Promise<T>;
  readonly settleMs?: number;
  readonly timeoutMs?: number;
}

const secretKeyPattern = /(?:auth|authorization|bearer|cookie|credential|jwt|password|secret|session|signature|token)/iu;
const pathTokenPattern = /\/(?:event|events|match|matches|market|markets|topic|sports)(?:\/[a-z0-9_.:-]+){1,8}/giu;

export function summarizeCmdProtocolFrame(
  payload: string,
  providerEventId: string,
  direction: ProtocolDirection
): CmdProtocolFrameSummary {
  const keys = new Set<string>();
  const pathTokens = new Set<string>();
  const visit = (value: unknown, key: string | null = null): void => {
    if (key !== null) {
      if (secretKeyPattern.test(key)) return;
      keys.add(key);
    }
    if (typeof value === "string") {
      for (const token of value.match(pathTokenPattern) ?? []) pathTokens.add(token);
      return;
    }
    if (Array.isArray(value)) { value.forEach((item) => visit(item)); return; }
    if (typeof value !== "object" || value === null) return;
    for (const [childKey, childValue] of Object.entries(value)) visit(childValue, childKey);
  };
  try { visit(JSON.parse(payload) as unknown); }
  catch {
    for (const token of payload.match(pathTokenPattern) ?? []) pathTokens.add(token);
  }
  return {
    direction,
    byteLength: new TextEncoder().encode(payload).byteLength,
    eventIdReferenced: payload.includes(providerEventId),
    jsonKeys: [...keys].sort(),
    channelPaths: [...pathTokens].sort()
  };
}

interface DomProbePass {
  readonly found: boolean;
  readonly marketIds: readonly string[];
  readonly clicked: readonly string[];
}

async function findEventFrame(page: Page, providerEventId: string): Promise<Frame | null> {
  for (const frame of page.frames()) {
    const found = await frame.evaluate((eventId) => [...document.querySelectorAll(".c-match[data-matchid]")]
      .some((element) => element.getAttribute("data-matchid") === eventId) ||
      [...document.querySelectorAll(".match[id]")].some((element) => element.id === `R_${eventId}`), providerEventId)
      .catch(() => false);
    if (found) return frame;
  }
  return null;
}

async function inspectOrAct(frame: Frame, providerEventId: string, action: "INSPECT" | "OPEN" | "EXPAND"):
Promise<DomProbePass> {
  return frame.evaluate(({ eventId, actionName }) => {
    const clean = (value: unknown, max = 120): string => String(value ?? "").replace(/\s+/gu, " ").trim().slice(0, max);
    const normalize = (value: unknown): string => clean(value).normalize("NFD")
      .replace(/[\u0300-\u036f]/gu, "").toLocaleLowerCase("en");
    const rows = [...document.querySelectorAll(".c-match[data-matchid]")]
      .filter((element) => element.getAttribute("data-matchid") === eventId);
    const legacy = [...document.querySelectorAll(".match[id]")].filter((element) => element.id === `R_${eventId}`);
    const owner = (rows.length === 1 ? rows[0] : legacy.length === 1 ? legacy[0] : null) as HTMLElement | null;
    if (owner === null) return { found: false, marketIds: [], clicked: [] };
    const marketIds = (): string[] => [...owner.querySelectorAll(".c-odds[data-moid]")]
      .map((element) => clean(element.getAttribute("data-moid"), 128)).filter(Boolean).sort();
    if (actionName === "INSPECT") return { found: true, marketIds: marketIds(), clicked: [] };
    const unsafeSelector = ".c-odds, [data-moid], [class*=selection], [class*=ticket], [class*=slip], [class*=betslip], [class*=stake], form";
    const isSafe = (control: HTMLElement): boolean => control.getClientRects().length > 0 &&
      !control.hasAttribute("disabled") && !control.matches(unsafeSelector) && !control.closest(unsafeSelector) &&
      control.querySelector(".c-odds, [data-moid]") === null &&
      !/(?:odd|price|selection|ticket|slip|stake)/u.test(normalize(control.className));
    const describe = (control: HTMLElement): string => clean(
      control.getAttribute("aria-label") || control.getAttribute("title") || control.textContent || control.className, 120);
    let candidates: HTMLElement[] = [];
    if (actionName === "OPEN") {
      const nodes = [...owner.querySelectorAll<HTMLElement>("button, a, summary, [role='button'], [onclick], .c-team-name, .team")];
      candidates = [...new Set(nodes.map((node) => node.closest<HTMLElement>("button, a, summary, [role='button'], [onclick]") ?? node))]
        .filter((control) => {
          const evidence = normalize(`${control.className} ${control.getAttribute("aria-label")} ${control.getAttribute("title")} ${control.textContent}`);
          return isSafe(control) && /(?:detail|view|more|expand|market|match-info|team|chi tiet|xem tran|keo)/u.test(evidence);
        }).slice(0, 1);
    } else {
      candidates = [...owner.querySelectorAll<HTMLElement>("button, a, summary, [role='button'], [onclick]")]
        .filter((control) => {
          const label = normalize(control.getAttribute("aria-label") || control.getAttribute("title") || control.textContent);
          const evidence = normalize(`${control.className} ${label}`);
          return isSafe(control) && control.dataset.fieldlineCmdHiddenProbeClicked !== "1" &&
            (/^(?:\+\s*\d+|show more|more markets?|all markets?|xem them|them keo)$/u.test(label) ||
              /(?:show-more|market.*(?:more|expand)|(?:more|expand).*market)/u.test(evidence));
        }).slice(0, 8);
    }
    const clicked: string[] = [];
    for (const control of candidates) {
      control.dataset.fieldlineCmdHiddenProbeClicked = "1";
      control.setAttribute("aria-expanded", "true");
      clicked.push(describe(control));
      control.click();
    }
    return { found: true, marketIds: marketIds(), clicked };
  }, { eventId: providerEventId, actionName: action });
}

function summarizeRequest(request: Request, providerEventId: string): CmdHttpEvidence | null {
  try {
    const parsed = new URL(request.url());
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    return {
      method: request.method(),
      hostname: parsed.hostname.toLocaleLowerCase("en"),
      pathname: parsed.pathname.slice(0, 512),
      resourceType: request.resourceType(),
      eventIdReferenced: parsed.pathname.includes(providerEventId) || parsed.search.includes(providerEventId)
    };
  } catch { return null; }
}

export class CmdHiddenMarketProbe {
  readonly #withProviderPage: CmdHiddenMarketProbeOptions["withProviderPage"];
  readonly #settleMs: number;
  readonly #timeoutMs: number;

  constructor(options: CmdHiddenMarketProbeOptions) {
    this.#withProviderPage = options.withProviderPage;
    this.#settleMs = options.settleMs ?? 250;
    this.#timeoutMs = options.timeoutMs ?? 10_000;
    if (!Number.isFinite(this.#settleMs) || this.#settleMs < 0 || !Number.isFinite(this.#timeoutMs) ||
      this.#timeoutMs < 250) throw new Error("CMD_HIDDEN_PROBE_OPTIONS_INVALID");
  }

  probe(providerEventId: string): Promise<CmdHiddenMarketProbeResult> {
    if (!/^[a-z0-9_.:-]{1,128}$/iu.test(providerEventId)) throw new Error("CMD_EVENT_ID_INVALID");
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error("CMD_HIDDEN_PROBE_TIMEOUT")), this.#timeoutMs);
    });
    const operation = this.#withProviderPage("CMD", "FOOTBALL",
      async (page) => this.#probePage(page, providerEventId));
    return Promise.race([operation, timeout]).finally(() => {
      if (timer !== undefined) clearTimeout(timer);
    });
  }

  async #probePage(page: Page, providerEventId: string): Promise<CmdHiddenMarketProbeResult> {
    const frame = await findEventFrame(page, providerEventId);
    if (frame === null) return emptyResult(providerEventId, "EVENT_NOT_FOUND");
    const before = await inspectOrAct(frame, providerEventId, "INSPECT");
    const httpEvidence: CmdHttpEvidence[] = [];
    const websocketEvidence: CmdProtocolFrameSummary[] = [];
    const onRequest = (request: Request): void => {
      const evidence = summarizeRequest(request, providerEventId);
      if (evidence !== null) httpEvidence.push(evidence);
    };
    page.on("request", onRequest);
    let cdp: CDPSession | null = null;
    try {
      cdp = await page.context().newCDPSession(page).catch(() => null);
      if (cdp !== null) {
        await cdp.send("Network.enable").catch(() => undefined);
        cdp.on("Network.webSocketFrameSent", (event) => websocketEvidence.push(
          summarizeCmdProtocolFrame(event.response.payloadData, providerEventId, "SENT")));
        cdp.on("Network.webSocketFrameReceived", (event) => websocketEvidence.push(
          summarizeCmdProtocolFrame(event.response.payloadData, providerEventId, "RECEIVED")));
      }
      const deadline = Date.now() + this.#timeoutMs;
      let clickedControlCount = 0;
      const clickedControls: string[] = [];
      const opened = await inspectOrAct(frame, providerEventId, "OPEN");
      clickedControlCount += opened.clicked.length;
      clickedControls.push(...opened.clicked);
      if (opened.clicked.length > 0 && this.#settleMs > 0) await page.waitForTimeout(this.#settleMs);
      let priorIds = [...before.marketIds];
      let stablePasses = 0;
      let timedOut = false;
      while (stablePasses < 2) {
        if (Date.now() >= deadline) { timedOut = true; break; }
        const pass = await inspectOrAct(frame, providerEventId, "EXPAND");
        clickedControlCount += pass.clicked.length;
        clickedControls.push(...pass.clicked);
        if (pass.clicked.length > 0 && this.#settleMs > 0) await page.waitForTimeout(this.#settleMs);
        const inspected = await inspectOrAct(frame, providerEventId, "INSPECT");
        const changed = JSON.stringify(inspected.marketIds) !== JSON.stringify(priorIds);
        stablePasses = pass.clicked.length === 0 && !changed ? stablePasses + 1 : 0;
        priorIds = [...inspected.marketIds];
      }
      const after = await inspectOrAct(frame, providerEventId, "INSPECT");
      const newMarkets = after.marketIds.some((marketId) => !before.marketIds.includes(marketId));
      const status = timedOut ? "TIMEOUT" : newMarkets ? "EXPANDED"
        : clickedControlCount > 0 ? "NO_NEW_MARKETS" : "NO_SAFE_CONTROL";
      return {
        providerEventId,
        status,
        beforeMarketIds: before.marketIds,
        afterMarketIds: after.marketIds,
        clickedControlCount,
        clickedControls,
        candidateControls: [],
        marketStructures: [],
        visibleEventIds: [],
        stablePasses,
        httpEvidence: uniqueEvidence(httpEvidence),
        websocketEvidence: uniqueEvidence(websocketEvidence)
      };
    } finally {
      page.off("request", onRequest);
      await cdp?.detach().catch(() => undefined);
    }
  }
}

function uniqueEvidence<T>(items: readonly T[]): readonly T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = JSON.stringify(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function emptyResult(providerEventId: string, status: CmdHiddenMarketProbeResult["status"]): CmdHiddenMarketProbeResult {
  return { providerEventId, status, beforeMarketIds: [], afterMarketIds: [], clickedControlCount: 0,
    clickedControls: [], candidateControls: [], marketStructures: [], visibleEventIds: [], stablePasses: 0,
    httpEvidence: [], websocketEvidence: [] };
}
