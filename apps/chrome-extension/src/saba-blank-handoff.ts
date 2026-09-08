import { recognizeExpectedLobbyTab, type TabDescriptor } from "./lobby-signatures.js";

interface SabaBlankHandoffEntry {
  readonly version: 1;
  readonly tabId: number;
  readonly url: string;
  readonly startedAtMs: number;
}

interface SabaBlankHandoffDependencies {
  readonly load: () => Promise<unknown>;
  readonly save: (entry: SabaBlankHandoffEntry) => Promise<void>;
  readonly clear: () => Promise<void>;
  readonly get: (tabId: number) => Promise<TabDescriptor>;
  readonly update: (tabId: number, url: string) => Promise<TabDescriptor>;
  readonly attachBootstrap: (tab: TabDescriptor, lobby: "SABA") => Promise<void>;
  readonly beginSourceEpoch: (sourceId: string) => void;
  readonly onBootstrapStart: (tabId: number) => void;
  readonly delay?: (delayMs: number) => Promise<void>;
  readonly now?: () => number;
}

const BLANK_URL = "about:blank";

/**
 * Makes SABA's two-navigation recovery survive Manifest V3 worker replacement.
 * The record is deliberately session-scoped by the background adapter: it is
 * useful across worker restarts, but must never become a replayable launch on a
 * later browser session.
 */
export class SabaBlankHandoffJournal {
  readonly #dependencies: SabaBlankHandoffDependencies;

  constructor(dependencies: SabaBlankHandoffDependencies) {
    this.#dependencies = dependencies;
  }

  async begin(tabId: number, url: string): Promise<void> {
    if (!Number.isSafeInteger(tabId) || tabId < 0 ||
      recognizeExpectedLobbyTab({ id: tabId, url }, "SABA")?.lobby !== "SABA") {
      throw new Error("SABA_BLANK_HANDOFF_INVALID");
    }
    await this.#dependencies.save({
      version: 1,
      tabId,
      url,
      startedAtMs: (this.#dependencies.now ?? Date.now)()
    });
  }

  async complete(tabId: number): Promise<void> {
    const entry = parseSabaBlankHandoffEntry(await this.#dependencies.load());
    if (entry?.tabId === tabId) await this.#dependencies.clear();
  }

  async resume(): Promise<number | null> {
    const raw = await this.#dependencies.load();
    const entry = parseSabaBlankHandoffEntry(raw);
    if (entry === null) {
      if (raw !== undefined) await this.#dependencies.clear();
      return null;
    }

    let current: TabDescriptor;
    try {
      current = await this.#dependencies.get(entry.tabId);
    } catch {
      await this.#dependencies.clear();
      return null;
    }
    const isBlank = current.url === BLANK_URL;
    const isSaba = recognizeExpectedLobbyTab(current, "SABA")?.lobby === "SABA";
    if (!isBlank && !isSaba) {
      // The user repurposed the exact tab after the interrupted handoff. Never
      // navigate an unrelated page from stale recovery state.
      await this.#dependencies.clear();
      return null;
    }

    this.#dependencies.onBootstrapStart(entry.tabId);
    if (!isBlank) current = await this.#parkOnBlank(entry.tabId);
    this.#dependencies.beginSourceEpoch(`chrome:SABA:${entry.tabId}`);
    await this.#dependencies.attachBootstrap({ ...current, url: entry.url }, "SABA");
    await this.#dependencies.update(entry.tabId, entry.url);
    await this.#dependencies.clear();
    return entry.tabId;
  }

  async #parkOnBlank(tabId: number): Promise<TabDescriptor> {
    const delay = this.#dependencies.delay ?? ((delayMs: number) =>
      new Promise<void>((resolve) => setTimeout(resolve, delayMs)));
    let current = await this.#dependencies.update(tabId, BLANK_URL);
    if (!blankCommitComplete(current)) {
      for (let attempt = 0; attempt < 20; attempt += 1) {
        await delay(50);
        current = await this.#dependencies.get(tabId);
        if (blankCommitComplete(current)) break;
      }
    }
    if (!blankCommitComplete(current)) throw new Error("SABA_BLANK_HANDOFF_FAILED");
    await delay(100);
    return current;
  }
}

function blankCommitComplete(tab: TabDescriptor): boolean {
  return tab.url === BLANK_URL && (tab.status === undefined || tab.status === "complete");
}

function parseSabaBlankHandoffEntry(value: unknown): SabaBlankHandoffEntry | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (record.version !== 1 || !Number.isSafeInteger(record.tabId) || (record.tabId as number) < 0 ||
    typeof record.url !== "string" || !Number.isFinite(record.startedAtMs) ||
    recognizeExpectedLobbyTab({ id: record.tabId as number, url: record.url }, "SABA")?.lobby !== "SABA") {
    return null;
  }
  return { version: 1, tabId: record.tabId as number, url: record.url,
    startedAtMs: record.startedAtMs as number };
}
