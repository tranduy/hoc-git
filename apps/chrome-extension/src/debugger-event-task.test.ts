import { describe, expect, it, vi } from "vitest";
import { runDebuggerEventTask } from "./debugger-event-task.js";

describe("runDebuggerEventTask", () => {
  it("coalesces expected provider queue pressure without reporting an extension error", async () => {
    const reportUnexpected = vi.fn();

    runDebuggerEventTask(
      Promise.reject(Object.assign(new Error("queue full"), { code: "PROVIDER_WORK_QUEUE_FULL" })),
      reportUnexpected
    );
    await Promise.resolve();

    expect(reportUnexpected).not.toHaveBeenCalled();
  });

  it("reports unexpected debugger event failures after consuming the rejection", async () => {
    const reportUnexpected = vi.fn();

    runDebuggerEventTask(Promise.reject(new Error("boom")), reportUnexpected);
    await Promise.resolve();

    expect(reportUnexpected).toHaveBeenCalledExactlyOnceWith(expect.any(Error));
  });
});
