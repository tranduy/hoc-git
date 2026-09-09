import { describe, expect, it, vi } from "vitest";
import { SourceTabRecovery } from "./source-tab-recovery.js";
import { renewExactProviderTab } from "./provider-page-lease.js";

const apUrl = "https://pacific.agenate.com/?agentId=4&lng=vi";
const source = { lobby: "TSPORT" as const, sourceId: "chrome:TSPORT:7", tabId: 7 };

function restoreCase(options: { error?: string; owned?: boolean; replaced?: boolean;
  secondAttachFails?: boolean; loadingAfterReload?: boolean; detachedDuringAttach?: boolean;
  retireWhileLoading?: boolean; backoffWhileLoading?: boolean } = {}) {
  const operations: string[] = [];
  let navigating = false;
  let attachCount = 0;
  let pendingDocument = options.loadingAfterReload === true;
  let loadingFinished = false;
  const tab = { id: 7, url: apUrl, status: "complete" as const };
  const recovery = new SourceTabRecovery({
    canRecover: () => !(options.backoffWhileLoading && loadingFinished),
    listAttached: () => options.owned === false || options.detachedDuringAttach && attachCount > 0 ||
      options.retireWhileLoading && loadingFinished ? [] : [source],
    query: async () => [tab],
    get: async () => ({ ...tab, url: options.replaced ? `${apUrl}&different=1` : apUrl,
      status: navigating && pendingDocument ? "loading" : "complete" }),
    delay: async () => { operations.push("document-loaded"); pendingDocument = false; loadingFinished = true; },
    create: async () => { throw Error("must retain the exact tab"); },
    update: async () => { throw Error("restore should use browser reload"); },
    reload: async () => { operations.push("reload:7"); navigating = true; return tab; },
    attach: async () => { throw Error("expected bootstrap attach"); },
    attachBootstrap: async () => {
      operations.push(`attach:${++attachCount}`);
      if (!navigating || options.secondAttachFails) throw Error(options.error ?? "frame-command-timeout");
    },
    validateReady: async () => { operations.push("ready"); return true; }
  });
  return { recovery, operations };
}

describe("APSPORT existing renderer timeout recovery", () => {
  it("reloads the same owned AP tab after a timed-out observer bootstrap, then requires attachment", async () => {
    const { recovery, operations } = restoreCase();
    await recovery.restore("TSPORT");
    expect(operations).toEqual(["attach:1", "reload:7", "attach:2", "ready"]);
  });

  it.each(["Debugger is not attached", "FRAME_TREE:TIMEOUT", "timeout", "SOURCE_REQUEST_BACKOFF"])(
    "does not navigate after an unrelated bootstrap rejection: %s", async (error) => {
      const { recovery, operations } = restoreCase({ error });
      await expect(recovery.restore("TSPORT")).rejects.toThrow(error);
      expect(operations).toEqual(["attach:1"]);
    });

  it("does not use the timeout fallback for an AP tab that was not already owned", async () => {
    const { recovery, operations } = restoreCase({ owned: false });
    await expect(recovery.restore("TSPORT")).rejects.toThrow("frame-command-timeout");
    expect(operations).toEqual(["attach:1"]);
  });

  it("does not navigate when the owned tab URL changed during failed bootstrap", async () => {
    const { recovery, operations } = restoreCase({ replaced: true });
    await expect(recovery.restore("TSPORT")).rejects.toThrow();
    expect(operations).toEqual(["attach:1"]);
  });

  it("rejects recovery if the replacement document still cannot attach", async () => {
    const { recovery, operations } = restoreCase({ secondAttachFails: true });
    await expect(recovery.restore("TSPORT")).rejects.toThrow("frame-command-timeout");
    expect(operations).toEqual(["attach:1", "reload:7", "attach:2"]);
  });

  it("waits for the replacement document before retrying attachment", async () => {
    const { recovery, operations } = restoreCase({ loadingAfterReload: true });
    await recovery.restore("TSPORT");
    expect(operations).toEqual(["attach:1", "reload:7", "document-loaded", "attach:2", "ready"]);
  });

  it("does not reload a tab whose ownership was lost during bootstrap", async () => {
    const { recovery, operations } = restoreCase({ detachedDuringAttach: true });
    await expect(recovery.restore("TSPORT")).rejects.toThrow("SOURCE_TAB_REPLACED");
    expect(operations).toEqual(["attach:1"]);
  });

  it.each([{ retireWhileLoading: true }, { backoffWhileLoading: true }])(
    "does not reattach a retired or paused source after navigation: %j", async (options) => {
      const { recovery, operations } = restoreCase({ ...options, loadingAfterReload: true });
      await expect(recovery.restore("TSPORT")).rejects.toThrow();
      expect(operations).toEqual(["attach:1", "reload:7", "document-loaded"]);
    });
});

describe("APSPORT exact lease renewal after renderer timeout", () => {
  function leaseCase(options: { error?: string; replaced?: boolean; detached?: boolean;
    secondAttachFails?: boolean } = {}) {
    const operations: string[] = [];
    let attachCount = 0;
    let attachFailed = false;
    const update = vi.fn(async (id: number, url: string) => {
      operations.push("navigate:7"); return { id, url };
    });
    const run = () => renewExactProviderTab(source, {
      now: () => 9_000,
      isAttached: () => !(options.detached && attachFailed),
      get: async () => ({ id: 7, url: options.replaced && attachFailed ? `${apUrl}&different=1` : apUrl }),
      attachBootstrap: async () => {
        operations.push(`attach:${++attachCount}`);
        if (attachCount === 1 || options.secondAttachFails) {
          attachFailed = true;
          throw Error(options.error ?? "frame-command-timeout");
        }
      },
      beginSourceEpoch: () => undefined,
      update,
      waitForReady: async () => { operations.push("ready"); return { id: 7, url: apUrl }; }
    });
    return { run, operations, update };
  }

  it("navigates an unchanged owned AP tab and rearms after its old renderer timed out", async () => {
    const { run, operations } = leaseCase();
    await run();
    expect(operations).toEqual(["attach:1", "navigate:7", "ready", "attach:2"]);
  });

  it.each([{ replaced: true }, { detached: true }, { error: "unrelated timeout" }])(
    "retains ownership, URL and exact error checks: %j", async (options) => {
      const { run, update } = leaseCase(options);
      await expect(run()).rejects.toThrow();
      expect(update).not.toHaveBeenCalled();
    });

  it("does not report success when post-navigation attachment still times out", async () => {
    const { run, operations } = leaseCase({ secondAttachFails: true });
    await expect(run()).rejects.toThrow("frame-command-timeout");
    expect(operations).toEqual(["attach:1", "navigate:7", "ready", "attach:2"]);
  });
});
