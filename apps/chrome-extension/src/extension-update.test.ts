import { describe, expect, it } from "vitest";
import { tabsNeedingContentScriptRefresh } from "./extension-update.js";

describe("tabsNeedingContentScriptRefresh", () => {
  const tabs = [
    { lobby: "SABA", tabId: 7, hostname: "c0z0ob.bpd3a3fn.com", state: "ATTACHED" },
    { lobby: "CMD", tabId: 8, hostname: "cgnew.fts368.com", state: "ATTACHED" },
    { lobby: "IM", tabId: 9, hostname: "imsports.directsb.net", state: "ATTACHED" }
  ] as const;

  it("reloads every attached tab after an extension update invalidates its content script", () => {
    expect(tabsNeedingContentScriptRefresh("update", tabs)).toEqual([7, 8, 9]);
  });

  it("does not disturb sportsbook tabs on an ordinary install", () => {
    expect(tabsNeedingContentScriptRefresh("install", tabs)).toEqual([]);
  });
});
