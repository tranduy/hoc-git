import { describe, expect, it, vi } from "vitest";
import { recoverUnexpectedDebuggerDetach } from "./debugger-detach-recovery.js";

describe("recoverUnexpectedDebuggerDetach", () => {
  it("reattaches an owned provider tab after Chrome replaces its debug target", async () => {
    const operations: string[] = [];
    let reads = 0;

    await expect(recoverUnexpectedDebuggerDetach({
      tabId: 7,
      lobby: "SABA",
      reason: "target_closed",
      get: async () => {
        reads += 1;
        if (reads === 1) throw new Error("TARGET_NOT_READY");
        return { id: 7, url: "https://c0z0oa.bpd3a3fn.com/(S(fresh))/NewIndex?lang=vn" };
      },
      attach: async (tab, lobby) => { operations.push(`${lobby}:${tab.id}`); },
      delay: async () => undefined
    })).resolves.toBe(true);

    expect(reads).toBe(2);
    expect(operations).toEqual(["SABA:7"]);
  });

  it("reattaches when Chrome reports a reload detach as canceled_by_user", async () => {
    const attach = vi.fn(async () => undefined);

    await expect(recoverUnexpectedDebuggerDetach({
      tabId: 7,
      lobby: "SABA",
      reason: "canceled_by_user",
      get: async () => ({ id: 7,
        url: "https://c0z0oa.bpd3a3fn.com/(S(fresh))/NewIndex?lang=vn" }),
      attach,
      delay: async () => undefined
    })).resolves.toBe(true);

    expect(attach).toHaveBeenCalledOnce();
  });

  it("does not fight DevTools when it takes ownership of the tab", async () => {
      const reason = "replaced_with_devtools";
      const attach = vi.fn(async () => undefined);

      await expect(recoverUnexpectedDebuggerDetach({
        tabId: 7,
        lobby: "SABA",
        reason,
        get: async () => ({ id: 7,
          url: "https://c0z0oa.bpd3a3fn.com/(S(fresh))/NewIndex?lang=vn" }),
        attach,
        delay: async () => undefined
      })).resolves.toBe(false);

      expect(attach).not.toHaveBeenCalled();
  });

  it("does not attach a tab that no longer belongs to the detached lobby", async () => {
    const attach = vi.fn(async () => undefined);

    await expect(recoverUnexpectedDebuggerDetach({
      tabId: 7,
      lobby: "SABA",
      reason: "target_closed",
      get: async () => ({ id: 7, url: "https://example.com/" }),
      attach,
      delay: async () => undefined,
      maxAttempts: 2
    })).resolves.toBe(false);

    expect(attach).not.toHaveBeenCalled();
  });
});
