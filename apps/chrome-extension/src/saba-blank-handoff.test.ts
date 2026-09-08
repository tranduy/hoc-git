import { describe, expect, it, vi } from "vitest";
import { SabaBlankHandoffJournal } from "./saba-blank-handoff.js";
import { SABA_DIRECT_LOBBY_URL } from "./source-tab-recovery.js";

describe("SabaBlankHandoffJournal", () => {
  it("resumes a worker-interrupted blank tab with observation armed before navigation", async () => {
    let stored: unknown;
    let current = { id: 18, url: "about:blank", title: "" };
    const operations: string[] = [];
    const journal = new SabaBlankHandoffJournal({
      load: async () => stored,
      save: async (value) => { stored = value; },
      clear: async () => { operations.push("clear"); stored = undefined; },
      get: async () => current,
      update: async (tabId, url) => {
        operations.push(`update:${url}`);
        current = { id: tabId, url, title: "Sports" };
        return current;
      },
      attachBootstrap: async (tab) => { operations.push(`attach:${tab.url}`); },
      beginSourceEpoch: (sourceId) => { operations.push(`epoch:${sourceId}`); },
      onBootstrapStart: (tabId) => { operations.push(`bootstrap:${tabId}`); },
      delay: async () => undefined
    });
    await journal.begin(18, SABA_DIRECT_LOBBY_URL);

    await expect(journal.resume()).resolves.toBe(18);

    expect(operations).toEqual([
      "bootstrap:18",
      "epoch:chrome:SABA:18",
      `attach:${SABA_DIRECT_LOBBY_URL}`,
      `update:${SABA_DIRECT_LOBBY_URL}`,
      "clear"
    ]);
    expect(stored).toBeUndefined();
  });

  it("parks a partially navigated SABA page again so its baseline cannot predate observation", async () => {
    let stored: unknown;
    let current = { id: 18, url: SABA_DIRECT_LOBBY_URL, title: "Sports" };
    const operations: string[] = [];
    const journal = new SabaBlankHandoffJournal({
      load: async () => stored,
      save: async (value) => { stored = value; },
      clear: async () => { operations.push("clear"); stored = undefined; },
      get: async () => current,
      update: async (tabId, url) => {
        operations.push(`update:${url}`);
        current = { id: tabId, url, title: "Sports" };
        return current;
      },
      attachBootstrap: async (tab) => { operations.push(`attach:${tab.url}`); },
      beginSourceEpoch: (sourceId) => { operations.push(`epoch:${sourceId}`); },
      onBootstrapStart: () => undefined,
      delay: async () => undefined
    });
    await journal.begin(18, SABA_DIRECT_LOBBY_URL);

    await journal.resume();

    expect(operations).toEqual([
      "update:about:blank",
      "epoch:chrome:SABA:18",
      `attach:${SABA_DIRECT_LOBBY_URL}`,
      `update:${SABA_DIRECT_LOBBY_URL}`,
      "clear"
    ]);
  });

  it("waits for about:blank to commit before arming observation and navigating", async () => {
    let stored: unknown;
    let reads = 0;
    const operations: string[] = [];
    const journal = new SabaBlankHandoffJournal({
      load: async () => stored,
      save: async (value) => { stored = value; },
      clear: async () => { stored = undefined; },
      get: async () => {
        reads += 1;
        operations.push(`get:${reads}`);
        return reads === 1
          ? { id: 18, url: SABA_DIRECT_LOBBY_URL, status: "complete" }
          : { id: 18, url: "about:blank", status: "complete" };
      },
      update: async (tabId, url) => {
        operations.push(`update:${url}`);
        return { id: tabId, url, status: url === "about:blank" ? "loading" : "complete" };
      },
      attachBootstrap: async () => { operations.push("attach"); },
      beginSourceEpoch: () => { operations.push("epoch"); },
      onBootstrapStart: () => undefined,
      delay: async () => undefined
    });
    await journal.begin(18, SABA_DIRECT_LOBBY_URL);

    await journal.resume();

    expect(operations).toEqual([
      "get:1",
      "update:about:blank",
      "get:2",
      "epoch",
      "attach",
      `update:${SABA_DIRECT_LOBBY_URL}`
    ]);
  });

  it("leaves the journal pending when navigation fails so the next worker retries", async () => {
    let stored: unknown;
    const clear = vi.fn(async () => { stored = undefined; });
    const journal = new SabaBlankHandoffJournal({
      load: async () => stored,
      save: async (value) => { stored = value; },
      clear,
      get: async () => ({ id: 18, url: "about:blank" }),
      update: async () => { throw new Error("WORKER_INTERRUPTED"); },
      attachBootstrap: async () => undefined,
      beginSourceEpoch: () => undefined,
      onBootstrapStart: () => undefined,
      delay: async () => undefined
    });
    await journal.begin(18, SABA_DIRECT_LOBBY_URL);

    await expect(journal.resume()).rejects.toThrow("WORKER_INTERRUPTED");
    expect(clear).not.toHaveBeenCalled();
    expect(stored).toBeDefined();
  });

  it("clears a handoff whose exact tab no longer exists", async () => {
    let stored: unknown;
    const clear = vi.fn(async () => { stored = undefined; });
    const journal = new SabaBlankHandoffJournal({
      load: async () => stored,
      save: async (value) => { stored = value; },
      clear,
      get: async () => { throw new Error("TAB_GONE"); },
      update: async () => ({ id: 18, url: SABA_DIRECT_LOBBY_URL }),
      attachBootstrap: async () => undefined,
      beginSourceEpoch: () => undefined,
      onBootstrapStart: () => undefined
    });
    await journal.begin(18, SABA_DIRECT_LOBBY_URL);

    await expect(journal.resume()).resolves.toBeNull();
    expect(clear).toHaveBeenCalledOnce();
  });
});
