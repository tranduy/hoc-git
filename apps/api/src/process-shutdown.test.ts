import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { bindGracefulShutdown } from "./process-shutdown.js";

describe("bindGracefulShutdown", () => {
  it("closes owned browser resources exactly once when the stack launcher sends shutdown over IPC", async () => {
    const lifecycle = new EventEmitter();
    let finishStop = (): void => undefined;
    const stop = vi.fn(() => new Promise<void>((resolve) => { finishStop = resolve; }));
    const exit = vi.fn();
    bindGracefulShutdown({ lifecycle, stop, exit });

    lifecycle.emit("message", { type: "tool-chenh:shutdown" });
    lifecycle.emit("SIGTERM");
    expect(stop).toHaveBeenCalledTimes(1);
    expect(exit).not.toHaveBeenCalled();

    finishStop();
    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(0));
  });

  it("ignores unrelated parent-process messages", () => {
    const lifecycle = new EventEmitter();
    const stop = vi.fn(async () => undefined);
    bindGracefulShutdown({ lifecycle, stop, exit: vi.fn() });

    lifecycle.emit("message", { type: "something-else" });

    expect(stop).not.toHaveBeenCalled();
  });
});
