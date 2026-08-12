import { createHash } from "node:crypto";
import { join } from "node:path";
import { normalizeCmdAccountStore, type CmdCatalogInputRecord } from "@tool-chenh/adapters";
import { chromium, type BrowserContext, type Page } from "playwright";
import {
  clickSafeStructuralCategory,
  collectCmdIdentitySignals,
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

export interface StableFootballCatalogProbe {
  read(): Promise<readonly CmdCatalogInputRecord[]>;
  select(): Promise<boolean>;
  wait(delayMs: number): Promise<void>;
}

export async function readStableCmdAccountStore(probe: {
  read(): Promise<unknown>;
  wait(delayMs: number): Promise<void>;
}, options: { readonly maxWaitMs: number; readonly pollingIntervalMs: number } = {
  maxWaitMs: 3_000, pollingIntervalMs: 100
}): Promise<unknown> {
  if (!Number.isFinite(options.maxWaitMs) || options.maxWaitMs <= 0 ||
    !Number.isFinite(options.pollingIntervalMs) || options.pollingIntervalMs <= 0) {
    throw new Error("CMD_PROFILE_OPTIONS_INVALID");
  }
  const attempts = Math.ceil(options.maxWaitMs / options.pollingIntervalMs) + 1;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const value = await probe.read();
    if (normalizeCmdAccountStore(value, 0) !== null) return value;
    if (attempt + 1 < attempts) await probe.wait(options.pollingIntervalMs);
  }
  throw new Error("CMD_PROFILE_UNAVAILABLE");
}

export interface StableFootballCatalogOptions {
  readonly maxWaitMs: number;
  readonly pollingIntervalMs: number;
  readonly stableSampleCount: number;
  readonly trustedStructuralFingerprint?: string;
}

const defaultStableFootballCatalogOptions: StableFootballCatalogOptions = {
  maxWaitMs: 3_000,
  pollingIntervalMs: 75,
  stableSampleCount: 2
};

function focusedHandicapRecords(records: readonly CmdCatalogInputRecord[]): readonly CmdCatalogInputRecord[] {
  return records.filter((record) => {
    const evidence = `${record.leagueName} ${record.teamNames.join(" ")}`.normalize("NFKC").toLocaleLowerCase("en");
    return !/(?:soccer marble|e[\s-]?soccer|\bvirtual\b|simulated reality|spinner world cup|\bpes\b|áº£o|Ä‘iá»‡n tá»­)/u.test(evidence);
  }).map((record) => ({
    ...record,
    groups: record.groups.filter((group) => group.betTypeIds.length === 1 && group.betTypeIds[0] === "1")
  }));
}

function hasUsableHandicap(records: readonly CmdCatalogInputRecord[]): boolean {
  return records.some((record) => record.matchId.length > 0 && record.teamNames.length === 2 &&
    record.groups.some((group) => group.odds.length === 2 && group.odds.every((odd) =>
      odd.marketOddsId.length > 0 && odd.priceText.length > 0)));
}

export function catalogStructuralFingerprint(records: readonly CmdCatalogInputRecord[]): string {
  return JSON.stringify(records.map((record) => ({
    sportId: record.sportId,
    leagueId: record.leagueId,
    leagueName: record.leagueName,
    matchId: record.matchId,
    timeText: record.timeText,
    teamNames: record.teamNames,
    groups: record.groups.map((group) => ({
      betTypeIds: group.betTypeIds,
      labels: group.labels,
      odds: group.odds.map((odd) => ({ marketOddsId: odd.marketOddsId, lineText: odd.lineText ?? null }))
    }))
  })));
}

export async function readStableFootballCatalog(
  probe: StableFootballCatalogProbe,
  options: StableFootballCatalogOptions = defaultStableFootballCatalogOptions
): Promise<readonly CmdCatalogInputRecord[]> {
  if (!Number.isFinite(options.maxWaitMs) || options.maxWaitMs <= 0 ||
    !Number.isFinite(options.pollingIntervalMs) || options.pollingIntervalMs <= 0 ||
    !Number.isSafeInteger(options.stableSampleCount) || options.stableSampleCount < 2) {
    throw new Error("CMD_CATALOG_OPTIONS_INVALID");
  }
  let records = focusedHandicapRecords(await probe.read());
  if (!hasUsableHandicap(records)) await probe.select();
  let previousFingerprint: string | null = options.trustedStructuralFingerprint ?? null;
  let stableSamples = previousFingerprint === null ? 0 : options.stableSampleCount - 1;
  let fallback: readonly CmdCatalogInputRecord[] = [];
  const attempts = Math.ceil(options.maxWaitMs / options.pollingIntervalMs) + 1;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (records.length > 0) fallback = records;
    if (hasUsableHandicap(records)) {
      const fingerprint = catalogStructuralFingerprint(records);
      stableSamples = fingerprint === previousFingerprint ? stableSamples + 1 : 1;
      previousFingerprint = fingerprint;
      if (stableSamples >= options.stableSampleCount) return records;
    } else {
      previousFingerprint = null;
      stableSamples = 0;
    }
    if (attempt + 1 < attempts) {
      await probe.wait(options.pollingIntervalMs);
      records = focusedHandicapRecords(await probe.read());
    }
  }
  if (fallback.length > 0) return fallback;
  throw new Error("CMD_CATALOG_UNAVAILABLE");
}

export async function readCmdFootballCatalog(
  page: Page,
  trustedStructuralFingerprint?: string
): Promise<readonly CmdCatalogInputRecord[]> {
  return readStableFootballCatalog({
    read: async () => extractCmdCatalogRecords(page, 500, "1", ["1"]),
    select: async () => clickSafeStructuralCategory(page, "1", 0),
    wait: async (delayMs) => page.waitForTimeout(delayMs)
  }, {
    ...defaultStableFootballCatalogOptions,
    ...(trustedStructuralFingerprint === undefined ? {} : { trustedStructuralFingerprint })
  });
}

export async function runCoalesced<TKey, TValue>(
  pending: Map<TKey, Promise<TValue>>,
  key: TKey,
  operation: () => Promise<TValue>
): Promise<TValue> {
  const current = pending.get(key);
  if (current !== undefined) return current;
  const created = Promise.resolve().then(operation).finally(() => {
    if (pending.get(key) === created) pending.delete(key);
  });
  pending.set(key, created);
  return created;
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
  readonly launchFingerprint: string;
  footballSelected: boolean;
  catalogFingerprint: string | undefined;
}

export function cmdLaunchFingerprint(launchUrl: string): string {
  return createHash("sha256").update(validateCmdLaunchUrl(launchUrl)).digest("hex");
}

export interface PlaywrightCmdBrowserManagerOptions {
  readonly profilesRoot: string;
  readonly headless?: boolean;
  readonly startupTimeoutMs?: number;
}

export function isVerifiedCmdFootballIdentity(signals: CmdIdentitySignals): boolean {
  return signals.runtime && signals.football && signals.cmdBundle;
}

function mergeIdentitySignals(left: CmdIdentitySignals, right: CmdIdentitySignals): CmdIdentitySignals {
  return {
    runtime: left.runtime || right.runtime,
    football: left.football || right.football,
    esports: left.esports || right.esports,
    cmdBundle: left.cmdBundle || right.cmdBundle
  };
}

export class PlaywrightCmdBrowserManager implements CmdAccountStoreSource, CmdCatalogRecordReader {
  readonly #profilesRoot: string;
  readonly #headless: boolean;
  readonly #startupTimeoutMs: number;
  readonly #sessions = new Map<string, OpenCmdSession>();
  readonly #opening = new Map<string, { readonly launchFingerprint: string; readonly promise: Promise<OpenCmdSession> }>();
  readonly #reading = new Map<string, Promise<readonly CmdCatalogInputRecord[]>>();

  constructor(options: PlaywrightCmdBrowserManagerOptions) {
    if (options.profilesRoot.trim().length === 0 || !Number.isFinite(options.startupTimeoutMs ?? 30_000) ||
      (options.startupTimeoutMs ?? 30_000) < 1_000) throw new Error("CMD_BROWSER_OPTIONS_INVALID");
    this.#profilesRoot = options.profilesRoot;
    this.#headless = options.headless ?? false;
    this.#startupTimeoutMs = options.startupTimeoutMs ?? 30_000;
  }

  async verifyLaunch(launchUrl: string): Promise<boolean> {
    const signals = await this.inspectLaunchIdentity(launchUrl);
    return isVerifiedCmdFootballIdentity(signals);
  }

  async inspectLaunchIdentity(launchUrl: string): Promise<CmdIdentitySignals> {
    const sessionId = `identity-${createHash("sha256").update(launchUrl).digest("hex").slice(0, 24)}`;
    const safeUrl = validateCmdLaunchUrl(launchUrl);
    let context: BrowserContext | null = null;
    try {
      context = await chromium.launchPersistentContext(
        join(this.#profilesRoot, cmdProfileDirectoryName(sessionId)),
        { headless: this.#headless, acceptDownloads: false }
      );
      const launcher = context.pages()[0] ?? await context.newPage();
      await launcher.goto(safeUrl, { waitUntil: "domcontentloaded", timeout: this.#startupTimeoutMs });
      const deadline = Date.now() + this.#startupTimeoutMs;
      let signals: CmdIdentitySignals = { runtime: false, football: false, esports: false, cmdBundle: false };
      while (!isVerifiedCmdFootballIdentity(signals) && Date.now() < deadline) {
        const samples = await Promise.all(context.pages().map(collectCmdIdentitySignals));
        signals = samples.reduce(mergeIdentitySignals, signals);
        if (!isVerifiedCmdFootballIdentity(signals)) {
          await launcher.waitForTimeout(Math.min(100, Math.max(1, deadline - Date.now())));
        }
      }
      return signals;
    } finally {
      await context?.close().catch(() => undefined);
    }
  }

  async readAccountStore(input: { readonly sessionId: string; readonly launchUrl: string }): Promise<unknown> {
    const session = await this.#get(input);
    return readStableCmdAccountStore({
      read: async () => {
        for (const page of session.context.pages()) {
          const frame = await findProviderRuntimeFrame(page);
          if (frame === null) continue;
          const state = await readProviderAccountStore(frame);
          if (state !== null) return state;
        }
        return null;
      },
      wait: async (delayMs) => session.page.waitForTimeout(delayMs)
    });
  }

  async readCatalog(input: {
    readonly sessionId: string;
    readonly launchUrl: string;
  }): Promise<readonly CmdCatalogInputRecord[]> {
    return runCoalesced(this.#reading, input.sessionId, async () => readWithOneSessionRecovery({
      acquire: async () => this.#get(input),
      invalidate: async (session) => this.#invalidate(input.sessionId, session),
      recover: async (session) => {
        await session.page.reload({ waitUntil: "domcontentloaded", timeout: this.#startupTimeoutMs });
      },
      read: async (session) => {
        const records = await readCmdFootballCatalog(session.page, session.catalogFingerprint);
        session.footballSelected = true;
        session.catalogFingerprint = catalogStructuralFingerprint(records);
        return records;
      }
    }));
  }

  async close(): Promise<void> {
    const sessions = [...this.#sessions.values()];
    this.#sessions.clear();
    this.#reading.clear();
    await Promise.allSettled(sessions.map(async (session) => session.context.close()));
  }

  async #get(input: { readonly sessionId: string; readonly launchUrl: string }): Promise<OpenCmdSession> {
    const launchFingerprint = cmdLaunchFingerprint(input.launchUrl);
    const current = this.#sessions.get(input.sessionId);
    if (current !== undefined && !current.page.isClosed() && current.launchFingerprint === launchFingerprint) return current;
    if (current !== undefined) await this.#invalidate(input.sessionId, current);
    const pending = this.#opening.get(input.sessionId);
    if (pending !== undefined && pending.launchFingerprint === launchFingerprint) return pending.promise;
    if (pending !== undefined) {
      await pending.promise.catch(() => undefined);
      const superseded = this.#sessions.get(input.sessionId);
      if (superseded !== undefined && superseded.launchFingerprint !== launchFingerprint) {
        await this.#invalidate(input.sessionId, superseded);
      }
    }
    const operation = this.#open(input).finally(() => {
      if (this.#opening.get(input.sessionId)?.promise === operation) this.#opening.delete(input.sessionId);
    });
    this.#opening.set(input.sessionId, { launchFingerprint, promise: operation });
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
      const session: OpenCmdSession = { context, page, launchFingerprint: cmdLaunchFingerprint(launchUrl),
        footballSelected: false, catalogFingerprint: undefined };
      this.#sessions.set(input.sessionId, session);
      return session;
    } catch {
      await context?.close().catch(() => undefined);
      throw new Error("CMD_BROWSER_UNAVAILABLE");
    }
  }
}
