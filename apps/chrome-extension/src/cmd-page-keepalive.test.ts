import { describe, expect, it, vi } from "vitest";

const CMD_SOURCE = { lobby: "CMD" as const, sourceId: "chrome:CMD:7", tabId: 7 };

describe("CMD page keepalive", () => {
  it("rejects a corrupted persisted schedule so keepalive can seed a safe new window", async () => {
    const { parseCmdPageKeepaliveState } = await import("./cmd-page-keepalive.js");

    expect(parseCmdPageKeepaliveState({ lastCompletedAtMs: 1_000, nextAttemptAtMs: "soon" })).toBeNull();
    expect(parseCmdPageKeepaliveState({ lastCompletedAtMs: 1_000, nextAttemptAtMs: 2_000 }))
      .toEqual({ lastCompletedAtMs: 1_000, nextAttemptAtMs: 2_000 });
  });

  it("keeps a CMD source busy until every overlapping price operation settles", async () => {
    const { SourceActivityGuard } = await import("./cmd-page-keepalive.js");
    const guard = new SourceActivityGuard();
    let releaseFirst!: () => void;
    let releaseSecond!: () => void;
    const first = guard.run(CMD_SOURCE.sourceId, () => new Promise<void>((resolve) => { releaseFirst = resolve; }));
    const second = guard.run(CMD_SOURCE.sourceId, () => new Promise<void>((resolve) => { releaseSecond = resolve; }));

    expect(guard.isBusy(CMD_SOURCE.sourceId)).toBe(true);
    releaseFirst();
    await first;
    expect(guard.isBusy(CMD_SOURCE.sourceId)).toBe(true);
    releaseSecond();
    await second;
    expect(guard.isBusy(CMD_SOURCE.sourceId)).toBe(false);
  });

  it("claims an idle CMD source exclusively before any later price operation can start", async () => {
    const { SourceActivityGuard } = await import("./cmd-page-keepalive.js");
    const guard = new SourceActivityGuard();
    let releaseReload!: () => void;
    let priceStarted = false;

    const reload = guard.tryRunExclusive(CMD_SOURCE.sourceId, () =>
      new Promise<void>((resolve) => { releaseReload = resolve; }));
    const price = guard.run(CMD_SOURCE.sourceId, async () => { priceStarted = true; });

    expect(priceStarted).toBe(false);
    releaseReload();
    await expect(reload).resolves.toEqual({ started: true, value: undefined });
    await price;
    expect(priceStarted).toBe(true);
  });

  it("refuses a scheduled exclusive reload while an earlier price operation is active", async () => {
    const { SourceActivityGuard } = await import("./cmd-page-keepalive.js");
    const guard = new SourceActivityGuard();
    let releasePrice!: () => void;
    const price = guard.run(CMD_SOURCE.sourceId, () =>
      new Promise<void>((resolve) => { releasePrice = resolve; }));
    const reload = vi.fn(async () => undefined);

    await expect(guard.tryRunExclusive(CMD_SOURCE.sourceId, reload)).resolves.toEqual({ started: false });
    expect(reload).not.toHaveBeenCalled();
    releasePrice();
    await price;
  });

  it("reloads the exact attached CMD tab only after twenty minutes", async () => {
    const { CmdPageKeepalive } = await import("./cmd-page-keepalive.js");
    let now = 1_000;
    let stored: { lastCompletedAtMs: number; nextAttemptAtMs: number } | null = null;
    const reload = vi.fn(async () => undefined);
    const keepalive = new CmdPageKeepalive({
      now: () => now,
      listAttached: () => [CMD_SOURCE],
      isBusy: () => false,
      isLoading: async () => false,
      loadState: async () => stored,
      saveState: async (state) => { stored = state; },
      reload
    });

    await keepalive.tick();
    expect(stored).toEqual({ lastCompletedAtMs: 1_000, nextAttemptAtMs: 1_201_000 });
    now = 1_200_999;
    await keepalive.tick();
    expect(reload).not.toHaveBeenCalled();

    now = 1_201_000;
    await keepalive.tick();

    expect(reload).toHaveBeenCalledExactlyOnceWith(CMD_SOURCE);
    expect(stored).toEqual({ lastCompletedAtMs: 1_201_000, nextAttemptAtMs: 2_401_000 });
  });

  it("defers a due reload for thirty seconds while a CMD price probe is active", async () => {
    const { CmdPageKeepalive } = await import("./cmd-page-keepalive.js");
    let now = 1_201_000;
    let busy = true;
    let stored = { lastCompletedAtMs: 1_000, nextAttemptAtMs: 1_201_000 };
    const reload = vi.fn(async () => undefined);
    const keepalive = new CmdPageKeepalive({
      now: () => now,
      listAttached: () => [CMD_SOURCE],
      isBusy: () => busy,
      isLoading: async () => false,
      loadState: async () => stored,
      saveState: async (state) => { stored = state; },
      reload
    });

    await keepalive.tick();
    expect(reload).not.toHaveBeenCalled();
    expect(stored).toEqual({ lastCompletedAtMs: 1_000, nextAttemptAtMs: 1_231_000 });

    busy = false;
    now = 1_230_999;
    await keepalive.tick();
    expect(reload).not.toHaveBeenCalled();
    now = 1_231_000;
    await keepalive.tick();
    expect(reload).toHaveBeenCalledExactlyOnceWith(CMD_SOURCE);
  });

  it("defers a due reload for thirty seconds while the exact CMD tab is loading", async () => {
    const { CmdPageKeepalive } = await import("./cmd-page-keepalive.js");
    const now = 1_201_000;
    let stored = { lastCompletedAtMs: 1_000, nextAttemptAtMs: now };
    const reload = vi.fn(async () => undefined);
    const keepalive = new CmdPageKeepalive({
      now: () => now,
      listAttached: () => [CMD_SOURCE],
      isBusy: () => false,
      isLoading: async () => true,
      loadState: async () => stored,
      saveState: async (state) => { stored = state; },
      reload
    });

    await keepalive.tick();

    expect(reload).not.toHaveBeenCalled();
    expect(stored).toEqual({ lastCompletedAtMs: 1_000, nextAttemptAtMs: 1_231_000 });
  });

  it("forces a manual hard-recovery navigation when the dead CMD tab stays loading", async () => {
    const { CmdPageKeepalive } = await import("./cmd-page-keepalive.js");
    const now = 1_201_000;
    let stored = { lastCompletedAtMs: 1_000, nextAttemptAtMs: now };
    const reload = vi.fn(async () => undefined);
    const keepalive = new CmdPageKeepalive({
      now: () => now,
      listAttached: () => [CMD_SOURCE],
      isBusy: () => false,
      isLoading: async () => true,
      loadState: async () => stored,
      saveState: async (state) => { stored = state; },
      reload
    });

    await keepalive.reloadNow(CMD_SOURCE);

    expect(reload).toHaveBeenCalledExactlyOnceWith(CMD_SOURCE);
    expect(stored).toEqual({ lastCompletedAtMs: now, nextAttemptAtMs: now + 20 * 60_000 });
  });

  it("waits five minutes before retrying a failed reload", async () => {
    const { CmdPageKeepalive } = await import("./cmd-page-keepalive.js");
    let now = 1_201_000;
    let stored = { lastCompletedAtMs: 1_000, nextAttemptAtMs: 1_201_000 };
    const reload = vi.fn()
      .mockRejectedValueOnce(new Error("CMD_RELOAD_FAILED"))
      .mockResolvedValueOnce(undefined);
    const keepalive = new CmdPageKeepalive({
      now: () => now,
      listAttached: () => [CMD_SOURCE],
      isBusy: () => false,
      isLoading: async () => false,
      loadState: async () => stored,
      saveState: async (state) => { stored = state; },
      reload
    });

    await expect(keepalive.tick()).resolves.toBeUndefined();
    expect(stored).toEqual({ lastCompletedAtMs: 1_000, nextAttemptAtMs: 1_501_000 });
    now = 1_500_999;
    await keepalive.tick();
    expect(reload).toHaveBeenCalledTimes(1);
    now = 1_501_000;
    await keepalive.tick();
    expect(reload).toHaveBeenCalledTimes(2);
  });

  it("persists a five-minute guard and resolves when the tab disappears before reload", async () => {
    const { CmdPageKeepalive } = await import("./cmd-page-keepalive.js");
    const now = 1_201_000;
    let stored = { lastCompletedAtMs: 1_000, nextAttemptAtMs: now };
    const keepalive = new CmdPageKeepalive({
      now: () => now,
      listAttached: () => [CMD_SOURCE],
      isBusy: () => false,
      isLoading: async () => { throw new Error("No tab with id: 7"); },
      loadState: async () => stored,
      saveState: async (state) => { stored = state; },
      reload: vi.fn(async () => undefined)
    });

    await expect(keepalive.tick()).resolves.toBeUndefined();
    expect(stored).toEqual({ lastCompletedAtMs: 1_000, nextAttemptAtMs: 1_501_000 });
  });

  it("coalesces a manual reload with an already running scheduled reload", async () => {
    const { CmdPageKeepalive } = await import("./cmd-page-keepalive.js");
    const now = 1_201_000;
    let stored = { lastCompletedAtMs: 1_000, nextAttemptAtMs: now };
    let releaseReload!: () => void;
    const reload = vi.fn(() => new Promise<void>((resolve) => { releaseReload = resolve; }));
    const keepalive = new CmdPageKeepalive({
      now: () => now,
      listAttached: () => [CMD_SOURCE],
      isBusy: () => false,
      isLoading: async () => false,
      loadState: async () => stored,
      saveState: async (state) => { stored = state; },
      reload
    });

    const scheduled = keepalive.tick();
    await vi.waitFor(() => expect(reload).toHaveBeenCalledOnce());
    const manual = keepalive.reloadNow(CMD_SOURCE);
    releaseReload();
    await Promise.all([scheduled, manual]);

    expect(reload).toHaveBeenCalledOnce();
    expect(stored).toEqual({ lastCompletedAtMs: now, nextAttemptAtMs: now + 20 * 60_000 });
  });

  it("really reloads the exact CMD tab when it is already at the canonical lobby", async () => {
    const { reloadExactCmdTab } = await import("./cmd-page-keepalive.js");
    const calls: string[] = [];

    await reloadExactCmdTab(CMD_SOURCE, {
      isAttached: (source) => source.tabId === 7,
      get: async (tabId) => ({ id: tabId, url: "https://cgnew.fts368.com/BasePage/home.aspx" }),
      isExpected: (tab) => tab.id === 7,
      attachBootstrap: async (tab) => { calls.push(`attach:${tab.id}`); },
      reload: async (tabId, url) => { calls.push(url === undefined
        ? `reload:${tabId}` : `navigate:${tabId}:${url}`); }
    });

    expect(calls).toEqual([
      "attach:7",
      "reload:7"
    ]);
  });

  it("returns an exact CMD subpage to the canonical lobby before reloading later", async () => {
    const { reloadExactCmdTab } = await import("./cmd-page-keepalive.js");
    const calls: string[] = [];

    await reloadExactCmdTab(CMD_SOURCE, {
      isAttached: (source) => source.tabId === 7,
      get: async (tabId) => ({ id: tabId, url: "https://cgnew.fts368.com/DomainNames/cgnew/home.aspx" }),
      isExpected: (tab) => tab.id === 7,
      attachBootstrap: async (tab) => { calls.push(`attach:${tab.id}`); },
      reload: async (tabId, url) => { calls.push(url === undefined
        ? `reload:${tabId}` : `navigate:${tabId}:${url}`); }
    });

    expect(calls).toEqual([
      "attach:7",
      "navigate:7:https://cgnew.fts368.com/BasePage/home.aspx"
    ]);
  });

  it("fails closed without reloading when the exact CMD source is replaced during bootstrap", async () => {
    const { reloadExactCmdTab } = await import("./cmd-page-keepalive.js");
    let attached = true;
    const reload = vi.fn(async () => undefined);

    await expect(reloadExactCmdTab(CMD_SOURCE, {
      isAttached: () => attached,
      get: async (tabId) => ({ id: tabId, url: "https://cgnew.fts368.com/BasePage/home.aspx" }),
      isExpected: () => true,
      attachBootstrap: async () => { attached = false; },
      reload
    })).rejects.toThrow("CMD_SOURCE_REPLACED");

    expect(reload).not.toHaveBeenCalled();
  });

  it("replaces a crashed CMD renderer when the exact-tab reload cannot attach", async () => {
    const { recoverCmdTab } = await import("./cmd-page-keepalive.js");
    const operations: string[] = [];

    await expect(recoverCmdTab(CMD_SOURCE, {
      isAttached: (source) => source.tabId === 7,
      get: async (tabId) => ({ id: tabId, url: "https://cgnew.fts368.com/BasePage/home.aspx" }),
      isExpected: (tab) => tab.id === 7,
      attachBootstrap: async () => {
        operations.push("attach:7");
        throw new Error("TARGET_CRASHED");
      },
      reload: async () => { operations.push("reload:7"); },
      replace: async (tabId) => {
        operations.push(`replace:${tabId}`);
        return 8;
      },
      waitForFreshBaseline: async (tabId) => {
        operations.push(`baseline:${tabId}`);
        return tabId === 8;
      }
    })).resolves.toBeUndefined();

    expect(operations).toEqual(["attach:7", "replace:7", "baseline:8"]);
  });

  it("replaces a CMD tab when reload resolves but no fresh baseline arrives", async () => {
    const { recoverCmdTab } = await import("./cmd-page-keepalive.js");
    const operations: string[] = [];

    await recoverCmdTab(CMD_SOURCE, {
      isAttached: (source) => source.tabId === 7,
      get: async (tabId) => ({ id: tabId, url: "https://cgnew.fts368.com/BasePage/home.aspx" }),
      isExpected: (tab) => tab.id === 7,
      attachBootstrap: async () => { operations.push("attach:7"); },
      reload: async () => { operations.push("reload:7"); },
      replace: async (tabId) => {
        operations.push(`replace:${tabId}`);
        return 8;
      },
      waitForFreshBaseline: async (tabId) => {
        operations.push(`baseline:${tabId}`);
        return tabId === 8;
      }
    });

    expect(operations).toEqual(["attach:7", "reload:7", "baseline:7", "replace:7", "baseline:8"]);
  });

  it("fails recovery when neither the reloaded nor replacement CMD tab publishes a baseline", async () => {
    const { recoverCmdTab } = await import("./cmd-page-keepalive.js");

    await expect(recoverCmdTab(CMD_SOURCE, {
      isAttached: (source) => source.tabId === 7,
      get: async (tabId) => ({ id: tabId, url: "https://cgnew.fts368.com/BasePage/home.aspx" }),
      isExpected: () => true,
      attachBootstrap: async () => undefined,
      reload: async () => undefined,
      replace: async () => 8,
      waitForFreshBaseline: async () => false
    })).rejects.toThrow("CMD_SOURCE_RECOVERY_FAILED");
  });

  it("removes the crashed exact CMD tab before bootstrapping its replacement", async () => {
    const { CMD_CANONICAL_LOBBY_URL, replaceExactCmdTab } = await import("./cmd-page-keepalive.js");
    const operations: string[] = [];

    await expect(replaceExactCmdTab(CMD_SOURCE, {
      isAttached: (source) => source.tabId === 7,
      get: async (tabId) => ({ id: tabId, url: "https://cgnew.fts368.com/BasePage/home.aspx" }),
      isExpected: (tab) => tab.id === 7,
      remove: async (tabId) => { operations.push(`remove:${tabId}`); },
      create: async (url, active) => {
        operations.push(`create:${url}:${active}`);
        return { id: 8, url };
      },
      attachBootstrap: async (tab) => { operations.push(`attach:${tab.id}:${tab.url}`); },
      update: async (tabId, url) => {
        operations.push(`navigate:${tabId}:${url}`);
        return { id: tabId, url };
      }
    })).resolves.toBe(8);

    expect(operations).toEqual([
      "remove:7",
      "create:about:blank:false",
      `attach:8:${CMD_CANONICAL_LOBBY_URL}`,
      `navigate:8:${CMD_CANONICAL_LOBBY_URL}`
    ]);
  });

  it("does not remove a tab after CMD ownership has already changed", async () => {
    const { replaceExactCmdTab } = await import("./cmd-page-keepalive.js");
    const remove = vi.fn(async () => undefined);
    const create = vi.fn(async () => ({ id: 8, url: "about:blank" }));

    await expect(replaceExactCmdTab(CMD_SOURCE, {
      isAttached: () => false,
      get: async (tabId) => ({ id: tabId, url: "https://cgnew.fts368.com/BasePage/home.aspx" }),
      isExpected: () => true,
      remove,
      create,
      attachBootstrap: async () => undefined,
      update: async (tabId, url) => ({ id: tabId, url })
    })).rejects.toThrow("CMD_SOURCE_REPLACED");

    expect(remove).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it("starts a new twenty-minute window after a manual CMD reload", async () => {
    const { CmdPageKeepalive } = await import("./cmd-page-keepalive.js");
    let now = 1_100_000;
    let stored = { lastCompletedAtMs: 1_000, nextAttemptAtMs: 1_201_000 };
    const reload = vi.fn(async () => undefined);
    const keepalive = new CmdPageKeepalive({
      now: () => now,
      listAttached: () => [CMD_SOURCE],
      isBusy: () => false,
      isLoading: async () => false,
      loadState: async () => stored,
      saveState: async (state) => { stored = state; },
      reload
    });

    await keepalive.markCompleted();
    expect(stored).toEqual({ lastCompletedAtMs: 1_100_000, nextAttemptAtMs: 2_300_000 });
    now = 1_201_000;
    await keepalive.tick();
    expect(reload).not.toHaveBeenCalled();
  });

  it("serializes a restored-source completion after an in-flight no-source retry write", async () => {
    const { CmdPageKeepalive } = await import("./cmd-page-keepalive.js");
    const now = 1_201_000;
    let persisted = { lastCompletedAtMs: 1_000, nextAttemptAtMs: now };
    let releaseRetryWrite!: () => void;
    let saveCalls = 0;
    const keepalive = new CmdPageKeepalive({
      now: () => now,
      listAttached: () => [],
      isBusy: () => false,
      isLoading: async () => false,
      loadState: async () => persisted,
      saveState: async (state) => {
        saveCalls += 1;
        if (saveCalls === 1) await new Promise<void>((resolve) => { releaseRetryWrite = resolve; });
        persisted = state;
      },
      reload: vi.fn(async () => undefined)
    });

    const tick = keepalive.tick();
    await vi.waitFor(() => expect(saveCalls).toBe(1));
    const completed = keepalive.markCompleted();
    expect(saveCalls).toBe(1);
    releaseRetryWrite();
    await Promise.all([tick, completed]);

    expect(persisted).toEqual({ lastCompletedAtMs: now, nextAttemptAtMs: now + 20 * 60_000 });
  });
});
