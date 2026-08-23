import { describe, expect, it, vi } from "vitest";
import { ProviderWorkQueueFullError, ProviderWorkScheduler } from "./provider-work-scheduler.js";

describe("ProviderWorkScheduler", () => {
  it("does not let a blocked TSPORT operation delay BTI", async () => {
    let release: (() => void) | undefined;
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    const scheduler = new ProviderWorkScheduler();

    const tsport = scheduler.run("chrome:TSPORT:1", async () => blocked);
    await expect(scheduler.run("chrome:BTI:2", async () => "done")).resolves.toBe("done");

    release?.();
    await tsport;
  });

  it("preserves provider ordering while allowing at most three active providers", async () => {
    const scheduler = new ProviderWorkScheduler();
    const releases = new Map<string, () => void>();
    const started: string[] = [];
    const operation = (sourceId: string) => scheduler.run(sourceId, async () => {
      started.push(sourceId);
      await new Promise<void>((resolve) => { releases.set(sourceId, resolve); });
    });

    const firstA = operation("chrome:CMD:1");
    const secondA = scheduler.run("chrome:CMD:1", async () => { started.push("chrome:CMD:1:second"); });
    const b = operation("chrome:IM:2");
    const c = operation("chrome:SABA:3");
    const d = operation("chrome:BTI:4");
    await vi.waitFor(() => expect(started).toEqual(["chrome:CMD:1", "chrome:IM:2", "chrome:SABA:3"]));

    releases.get("chrome:CMD:1")?.();
    await vi.waitFor(() => expect(started).toContain("chrome:BTI:4"));
    releases.get("chrome:IM:2")?.();
    await vi.waitFor(() => expect(started).toContain("chrome:CMD:1:second"));
    expect(started.indexOf("chrome:CMD:1:second")).toBeGreaterThan(started.indexOf("chrome:CMD:1"));
    releases.get("chrome:SABA:3")?.();
    releases.get("chrome:BTI:4")?.();
    await Promise.all([firstA, secondA, b, c, d]);
  });

  it("rejects a provider's second queued operation without evicting another provider", async () => {
    const rejected = vi.fn();
    const scheduler = new ProviderWorkScheduler({ onRejected: rejected });
    let release: (() => void) | undefined;
    const active = scheduler.run("chrome:IM:7", async () => {
      await new Promise<void>((resolve) => { release = resolve; });
    });
    const queued = scheduler.run("chrome:IM:7", async () => "queued");

    const overflow = scheduler.run("chrome:IM:7", async () => "overflow");
    await expect(overflow).rejects.toMatchObject({
      name: "ProviderWorkQueueFullError", code: "PROVIDER_WORK_QUEUE_FULL", sourceId: "chrome:IM:7"
    });
    await expect(scheduler.run("chrome:BTI:8", async () => "healthy")).resolves.toBe("healthy");
    expect(rejected).toHaveBeenCalledExactlyOnceWith(expect.any(ProviderWorkQueueFullError));

    release?.();
    await expect(queued).resolves.toBe("queued");
    await active;
  });

  it("clears only queued work for one provider while its active operation settles", async () => {
    const scheduler = new ProviderWorkScheduler();
    let release: (() => void) | undefined;
    const active = scheduler.run("chrome:SABA:7", async () => {
      await new Promise<void>((resolve) => { release = resolve; });
    });
    const queued = scheduler.run("chrome:SABA:7", async () => "stale");
    expect(scheduler.isBusy("chrome:SABA:7")).toBe(true);

    scheduler.clear("chrome:SABA:7");
    await expect(queued).rejects.toMatchObject({
      name: "ProviderWorkClearedError", code: "PROVIDER_WORK_CLEARED", sourceId: "chrome:SABA:7"
    });
    expect(scheduler.isBusy("chrome:SABA:7")).toBe(true);
    await expect(scheduler.run("chrome:BTI:8", async () => "healthy")).resolves.toBe("healthy");

    release?.();
    await active;
    expect(scheduler.isBusy("chrome:SABA:7")).toBe(false);
  });
});
