import { afterEach, expect, it, vi } from "vitest";
import { stopSuspendedImCollector } from "./im-collector-suspension.js";

afterEach(() => vi.unstubAllGlobals());

it("retires the injected IM worker and aborts requests without navigating its page", () => {
  const controller = new AbortController();
  const release = vi.fn();
  const state = { retired: false, controllers: new Set([controller]), waiters: new Set([release]) };
  const manager = { state };
  vi.stubGlobal("location", { hostname: "imsports.directsb.net" });
  vi.stubGlobal("window", { __fieldlineImNativeCatalogV1: manager });
  expect(stopSuspendedImCollector()).toBe(true);
  expect(state.retired).toBe(true);
  expect(controller.signal.aborted).toBe(true);
  expect(release).toHaveBeenCalledOnce();
  expect(manager.state).toBeNull();
  expect(stopSuspendedImCollector()).toBe(true);
});

it("does not touch a tab that has navigated away from IM", () => {
  vi.stubGlobal("location", { hostname: "unrelated.test" });
  expect(stopSuspendedImCollector()).toBe(false);
});
