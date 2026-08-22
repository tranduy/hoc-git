import type { Page } from "playwright";
import type { CmdCatalogInputRecord } from "@tool-chenh/adapters";
import type { ProviderSecret } from "../../sessions/types.js";
import type { CmdFootballCatalogSnapshot } from "./cmd-browser-manager.js";

interface FabetCmdPageAccess {
  withProviderPage<T>(provider: "CMD", category: "FOOTBALL", consume: (page: Page) => Promise<T>): Promise<T>;
}

interface Tk88CmdPageAccess {
  withProviderPage<T>(consume: (page: Page) => Promise<T>): Promise<T>;
}

interface CmdFootballPageReader {
  readCatalogFromPage(page: Page): Promise<CmdFootballCatalogSnapshot>;
  readCatalog?(input: { readonly sessionId: string; readonly launchUrl: string }): Promise<readonly CmdCatalogInputRecord[]>;
}

interface CmdDirectSessionAccess {
  listStatuses(): Promise<{ readonly sessions: ReadonlyArray<{
    readonly id: string;
    readonly provider: string;
    readonly category: "FOOTBALL" | "LOL" | null;
    readonly source: string;
    readonly state: string;
    readonly acquiredAtMs: number | null;
  }> }>;
  getActiveSecretHandle(id: string): Promise<{
    readonly sessionId: string;
    readonly provider: string;
    withSecret<T>(consume: (secret: ProviderSecret) => Promise<T>): Promise<T>;
  } | null>;
}

export class JitCmdFootballCatalogSource {
  readonly #fabet: FabetCmdPageAccess;
  readonly #browser: CmdFootballPageReader;
  readonly #clock: { nowMs(): number };
  readonly #retryBackoffMs: number;
  readonly #sessionAccess: CmdDirectSessionAccess | null;
  readonly #tk88: Tk88CmdPageAccess | null;
  #retryAfterMs = 0;
  #inFlight: Promise<CmdFootballCatalogSnapshot> | null = null;

  constructor(options: { readonly fabet: FabetCmdPageAccess; readonly browser: CmdFootballPageReader;
    readonly sessionAccess?: CmdDirectSessionAccess; readonly tk88?: Tk88CmdPageAccess;
    readonly clock?: { nowMs(): number };
    readonly retryBackoffMs?: number }) {
    if (!Number.isFinite(options.retryBackoffMs ?? 60_000) || (options.retryBackoffMs ?? 60_000) < 1_000) {
      throw new Error("CMD_FABET_SOURCE_OPTIONS_INVALID");
    }
    this.#fabet = options.fabet;
    this.#browser = options.browser;
    this.#clock = options.clock ?? { nowMs: Date.now };
    this.#retryBackoffMs = options.retryBackoffMs ?? 60_000;
    this.#sessionAccess = options.sessionAccess ?? null;
    this.#tk88 = options.tk88 ?? null;
  }

  readCatalogFromFabet(): Promise<CmdFootballCatalogSnapshot> {
    if (this.#inFlight !== null) return this.#inFlight;
    const operation = this.#readPreferred().finally(() => {
      if (this.#inFlight === operation) this.#inFlight = null;
    });
    this.#inFlight = operation;
    return operation;
  }

  async #readPreferred(): Promise<CmdFootballCatalogSnapshot> {
    let fabetFailure: unknown = new Error("CMD_FABET_SOURCE_BACKOFF");
    if (this.#clock.nowMs() >= this.#retryAfterMs) {
      try {
        const snapshot = await this.#fabet.withProviderPage("CMD", "FOOTBALL",
          async (page) => this.#browser.readCatalogFromPage(page));
        this.#retryAfterMs = 0;
        return snapshot;
      } catch (error) {
        fabetFailure = error;
        this.#retryAfterMs = this.#clock.nowMs() + this.#retryBackoffMs;
      }
    }
    if (this.#tk88 !== null) {
      try {
        return await this.#tk88.withProviderPage(async (page) => this.#browser.readCatalogFromPage(page));
      } catch {
        // A TK88 tab is accepted only after exact CMD Football identity verification.
      }
    }
    try { return await this.#readDirect(); }
    catch { throw fabetFailure; }
  }

  async #readDirect(): Promise<CmdFootballCatalogSnapshot> {
    if (this.#sessionAccess === null || this.#browser.readCatalog === undefined) {
      throw new Error("CMD_DIRECT_SOURCE_UNAVAILABLE");
    }
    const sessions = (await this.#sessionAccess.listStatuses()).sessions.filter((session) =>
      session.provider === "CMD" && session.category === "FOOTBALL" &&
      session.source === "MANUAL_PROVIDER_SESSION" && session.state === "ACTIVE")
      .sort((left, right) => (right.acquiredAtMs ?? -1) - (left.acquiredAtMs ?? -1) ||
        right.id.localeCompare(left.id));
    const selected = sessions[0];
    if (selected === undefined) throw new Error("CMD_DIRECT_SOURCE_UNAVAILABLE");
    const handle = await this.#sessionAccess.getActiveSecretHandle(selected.id);
    if (handle === null || handle.provider !== "CMD") throw new Error("CMD_DIRECT_SOURCE_UNAVAILABLE");
    const records = await handle.withSecret(async (secret) => {
      if (secret.kind !== "LAUNCH_URL") throw new Error("CMD_DIRECT_SOURCE_UNAVAILABLE");
      return this.#browser.readCatalog!({ sessionId: handle.sessionId, launchUrl: secret.value });
    });
    return { records, observedAtMs: this.#clock.nowMs(), receivedMonotonicMs: performance.now() };
  }
}
