import { normalizeCmdAccountStore, type CmdCatalogInputRecord } from "@tool-chenh/adapters";
import type { Page } from "playwright";
import type { FabetBrowserDriver } from "../../sessions/fabet-browser.js";
import { findProviderAccountFrame, inspectExactCmdTicket, readProviderAccountStore }
  from "../browser-protocol-inspector.js";
import { readCmdFootballCatalog, readStableCmdAccountStore } from "../cmd/cmd-browser-manager.js";
import { parseCmdTicketConstraint, type CmdTicketConstraintSnapshot } from "../cmd/cmd-ticket-constraint.js";
import { readSabaFootballCatalogFromPage } from "./saba-football-push-browser-manager.js";

interface Input { readonly sessionId: string; readonly launchUrl: string }
interface TicketInput extends Input { readonly providerEventId: string; readonly providerMarketId: string;
  readonly providerSelectionId: string; readonly selection: "HOME" | "AWAY" }

interface Fallback {
  readCatalog(input: Input): Promise<readonly CmdCatalogInputRecord[]>;
  readAccountStore(input: Input): Promise<unknown>;
  readTicketConstraint(input: TicketInput): Promise<CmdTicketConstraintSnapshot | null>;
  close(): Promise<void>;
}

interface PageReader {
  readCatalog(page: Page): Promise<readonly CmdCatalogInputRecord[]>;
  readAccountStore(page: Page): Promise<unknown>;
  readTicketConstraint(page: Page, input: TicketInput): Promise<CmdTicketConstraintSnapshot | null>;
}

const realPageReader: PageReader = {
  readCatalog: readCmdFootballCatalog,
  readAccountStore: async (page) => readStableCmdAccountStore({
    read: async () => {
      const frame = await findProviderAccountFrame(page);
      return frame === null ? null : readProviderAccountStore(frame);
    },
    wait: async (delayMs) => page.waitForTimeout(delayMs)
  }),
  readTicketConstraint: async (page, input) => {
    const expectedSelectionId = `${input.providerMarketId}:${input.selection.toLocaleLowerCase("en")}`;
    if (input.providerSelectionId !== expectedSelectionId) return null;
    const evidence = await inspectExactCmdTicket(page, { matchId: input.providerEventId,
      marketOddsId: input.providerMarketId, selection: input.selection });
    const rawProfile = await realPageReader.readAccountStore(page);
    const profile = normalizeCmdAccountStore(rawProfile, Date.now());
    if (profile === null) return null;
    return parseCmdTicketConstraint({ evidence, providerSelectionId: input.providerSelectionId,
      currency: profile.currency, balance: profile.balance, observedAtMs: profile.asOfMs });
  }
};

function isFabetSabaFootballSession(sessionId: string): boolean {
  return /^fabet-launch-saba-football-/u.test(sessionId);
}

async function observedJitRead<T>(operation: () => Promise<T>): Promise<T> {
  try { return await operation(); }
  catch (error) {
    const message = error instanceof Error && /^[A-Z0-9_]+$/u.test(error.message) ? error.message : "UNKNOWN";
    process.stderr.write(`SABA JIT read failed: ${message}\n`);
    throw error;
  }
}

export class FabetSabaBrowserManager {
  readonly #fabet: Pick<FabetBrowserDriver, "withProviderPage">;
  readonly #fallback: Fallback;
  readonly #catalogFallback: { readCatalog(input: Input): Promise<readonly Readonly<Record<string, unknown>>[]> };
  readonly #pageReader: PageReader;

  constructor(options: { readonly fabet: Pick<FabetBrowserDriver, "withProviderPage">;
    readonly fallback: Fallback;
    readonly catalogFallback?: { readCatalog(input: Input): Promise<readonly Readonly<Record<string, unknown>>[]> };
    readonly pageReader?: PageReader }) {
    this.#fabet = options.fabet;
    this.#fallback = options.fallback;
    this.#catalogFallback = options.catalogFallback ?? {
      readCatalog: async (input) => (await options.fallback.readCatalog(input)).map((record) => ({ ...record }))
    };
    this.#pageReader = options.pageReader ?? realPageReader;
  }

  readCatalog(input: Input): Promise<readonly CmdCatalogInputRecord[]> {
    if (!isFabetSabaFootballSession(input.sessionId)) return this.#fallback.readCatalog(input);
    return observedJitRead(async () => this.#fabet.withProviderPage("SABA", "FOOTBALL",
      async (page) => this.#pageReader.readCatalog(page)));
  }

  readRawCatalog(input: Input): Promise<readonly Readonly<Record<string, unknown>>[]> {
    if (!isFabetSabaFootballSession(input.sessionId)) return this.#catalogFallback.readCatalog(input);
    return observedJitRead(async () => this.#fabet.withProviderPage("SABA", "FOOTBALL",
      async (page) => readSabaFootballCatalogFromPage(page)));
  }

  readAccountStore(input: Input): Promise<unknown> {
    if (!isFabetSabaFootballSession(input.sessionId)) return this.#fallback.readAccountStore(input);
    return observedJitRead(async () => this.#fabet.withProviderPage("SABA", "FOOTBALL",
      async (page) => this.#pageReader.readAccountStore(page)));
  }

  readTicketConstraint(input: TicketInput): Promise<CmdTicketConstraintSnapshot | null> {
    if (!isFabetSabaFootballSession(input.sessionId)) return this.#fallback.readTicketConstraint(input);
    return observedJitRead(async () => this.#fabet.withProviderPage("SABA", "FOOTBALL",
      async (page) => this.#pageReader.readTicketConstraint(page, input)));
  }

  close(): Promise<void> { return this.#fallback.close(); }
}
