import { describe, expect, it } from "vitest";
import { tabsNeedingContentScriptRefresh } from "./extension-update.js";

describe("tabsNeedingContentScriptRefresh", () => {
  const tabs = [
    { lobby: "SABA", tabId: 7, hostname: "c0z0ob.bpd3a3fn.com", state: "ATTACHED" },
    { lobby: "CMD", tabId: 8, hostname: "cgnew.fts368.com", state: "ATTACHED" },
    { lobby: "IM", tabId: 9, hostname: "imsports.directsb.net", state: "ATTACHED" }
  ] as const;

  it("does not hard-reload attached sportsbook tabs during an extension update", () => {
    expect(tabsNeedingContentScriptRefresh("update", tabs)).toEqual([]);
  });

  it("does not disturb sportsbook tabs on an ordinary install", () => {
    expect(tabsNeedingContentScriptRefresh("install", tabs)).toEqual([]);
  });
});
