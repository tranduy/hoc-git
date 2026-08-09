import { createHash } from "node:crypto";
import { join } from "node:path";
import type { CmdCatalogInputRecord } from "@tool-chenh/adapters";
import { chromium, type BrowserContext, type Page } from "playwright";
import {
  clickSafeStructuralCategory,
  waitForCmdIdentitySignals,
  extractCmdCatalogRecords,
  findCmdCatalogPage,
  findProviderRuntimeFrame,
  readProviderAccountStore
} from "../browser-protocol-inspector.js";
import type { CmdIdentitySignals } from "../browser-protocol-inspector.js";
import type { CmdAccountStoreSource } from "./cmd-profile-reader.js";
import type { CmdCatalogRecordReader } from "./cmd-catalog-source.js";

export function validateCmdLaunchUrl(value: string): string {
  if (value.length === 0 || value.length > 24_000) throw new Error("CMD_LAUNCH_URL_INVALID");
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.hostname.length === 0) {
      throw new Error("CMD_LAUNCH_URL_INVALID");
    }
    return value;
  } catch {
    throw new Error("CMD_LAUNCH_URL_INVALID");
  }
}

export function cmdProfileDirectoryName(sessionId: string): string {
  const digest = createHash("sha256").update(sessionId).digest("hex").slice(0, 24);
  return `cmd-${digest}`;
}

export async function readCmdFootballCatalog(page: Page): Promise<readonly CmdCatalogInputRecord[]> {
  const visible = await extractCmdCatalogRecords(page, 500, "1");
  if (visible.length > 0) return visible;
  if (!(await clickSafeStructuralCategory(page, "1", 5_000))) {
    throw new Error("CMD_CATALOG_UNAVAILABLE");
  }
  return extractCmdCatalogRecords(page, 500, "1");
}

export async function readWithOneSessionRecovery<TSession, TResult>(input: {
  readonly acquire: () => Promise<TSession>;
  readonly invalidate: (session: TSession) => Promise<void>;
  readonly recover: (session: TSession) => Promise<void>;
  readonly read: (session: TSession) => Promise<TResult>;
}): Promise<TResult> {
  const first = await input.acquire();
  try {
    return await input.read(first);
  } catch {
    try {
      await input.recover(first);
      return await input.read(first);
    } catch {
      await input.invalidate(first);
    }
  }
  const replacement = await input.acquire();
  try {
    return await input.read(replacement);
  } catch {
    await input.invalidate(replacement);
    throw new Error("CMD_CATALOG_UNAVAILABLE");
  }
}

interface OpenCmdSession {
  readonly context: BrowserContext;
  readonly page: Page;
  footballSelected: boolean;
}

export interface PlaywrightCmdBrowserManagerOptions {
  readonly profilesRoot: string;
  readonly headless?: boolean;
  readonly startupTimeoutMs?: number;
}

export class PlaywrightCmdBrowserManager implements CmdAccountStoreSource, CmdCatalogRecordReader {
  readonly #profilesRoot: string;
  readonly #headless: boolean;
  readonly #startupTimeoutMs: number;
  readonly #sessions = new Map<string, OpenCmdSession>();
  readonly #opening = new Map<string, Promise<OpenCmdSession>>();

  constructor(options: PlaywrightCmdBrowserManagerOptions) {
    if (options.profilesRoot.trim().length === 0 || !Number.isFinite(options.startupTimeoutMs ?? 30_000) ||
      (options.startupTimeoutMs ?? 30_000) < 1_000) throw new Error("CMD_BROWSER_OPTIONS_INVALID");
    this.#profilesRoot = options.profilesRoot;
    this.#headless = options.headless ?? false;
    this.#startupTimeoutMs = options.startupTimeoutMs ?? 30_000;
  }

  async verifyLaunch(launchUrl: string): Promise<boolean> {
    const signals = await this.inspectLaunchIdentity(launchUrl);
    return signals.runtime && signals.football && signals.esports && signals.cmdBundle;
  }

  async inspectLaunchIdentity(launchUrl: string): Promise<CmdIdentitySignals> {
    const sessionId = `identity-${createHash("sha256").update(launchUrl).digest("hex").slice(0, 24)}`;
    let session: OpenCmdSession | null = null;
    try {
      session = await this.#open({ sessionId, launchUrl });
      return await waitForCmdIdentitySignals(session.page, this.#startupTimeoutMs);
    } finally {
      this.#sessions.delete(sessionId);
      await session?.context.close().catch(() => undefined);
    }
  }

  async readAccountStore(input: { readonly sessionId: string; readonly launchUrl: string }): Promise<unknown> {
    const session = await this.#get(input);
    for (const page of session.context.pages()) {
      const frame = await findProviderRuntimeFrame(page);
      if (frame === null) continue;
      const state = await readProviderAccountStore(frame);
      if (state !== null) return state;
    }
    throw new Error("CMD_PROFILE_UNAVAILABLE");
  }

  async readCatalog(input: {
    readonly sessionId: string;
    readonly launchUrl: string;
  }): Promise<readonly CmdCatalogInputRecord[]> {
    return readWithOneSessionRecovery({
      acquire: async () => this.#get(input),
      invalidate: async (session) => this.#invalidate(input.sessionId, session),
      recover: async (session) => {
        await session.page.reload({ waitUntil: "domcontentloaded", timeout: this.#startupTimeoutMs });
      },
      read: async (session) => {
        const records = await readCmdFootballCatalog(session.page);
        session.footballSelected = true;
        return records;
      }
    });
  }

  async close(): Promise<void> {
    const sessions = [...this.#sessions.values()];
    this.#sessions.clear();
    await Promise.allSettled(sessions.map(async (session) => session.context.close()));
  }

  async #get(input: { readonly sessionId: string; readonly launchUrl: string }): Promise<OpenCmdSession> {
    const current = this.#sessions.get(input.sessionId);
    if (current !== undefined && !current.page.isClosed()) return current;
    const pending = this.#opening.get(input.sessionId);
    if (pending !== undefined) return pending;
    const operation = this.#open(input).finally(() => this.#opening.delete(input.sessionId));
    this.#opening.set(input.sessionId, operation);
    return operation;
  }

  async #invalidate(sessionId: string, expected: OpenCmdSession): Promise<void> {
    if (this.#sessions.get(sessionId) !== expected) return;
    this.#sessions.delete(sessionId);
    await expected.context.close().catch(() => undefined);
  }

  async #open(input: { readonly sessionId: string; readonly launchUrl: string }): Promise<OpenCmdSession> {
    const launchUrl = validateCmdLaunchUrl(input.launchUrl);
    let context: BrowserContext | null = null;
    try {
      context = await chromium.launchPersistentContext(
        join(this.#profilesRoot, cmdProfileDirectoryName(input.sessionId)),
        { headless: this.#headless, acceptDownloads: false }
      );
      const launcher = context.pages()[0] ?? await context.newPage();
      await launcher.goto(launchUrl, { waitUntil: "domcontentloaded", timeout: this.#startupTimeoutMs });
      const deadline = Date.now() + this.#startupTimeoutMs;
      let page: Page | null = null;
      while (page === null && Date.now() < deadline) {
        page = await findCmdCatalogPage(context.pages());
        if (page === null) await launcher.waitForTimeout(250);
      }
      if (page === null) throw new Error("CMD_CATALOG_UNAVAILABLE");
      const session: OpenCmdSession = { context, page, footballSelected: false };
      this.#sessions.set(input.sessionId, session);
      return session;
    } catch {
      await context?.close().catch(() => undefined);
      throw new Error("CMD_BROWSER_UNAVAILABLE");
    }
  }
}
