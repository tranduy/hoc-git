import { describe, expect, it, vi } from "vitest";
import { injectHeartbeatIntoOpenLobbies } from "./lobby-heartbeat-injection.js";

const lobbyTab = { id: 7, url: "https://imsports.directsb.net/live", title: "IM" };
const otherLobbyTab = { id: 9, url: "https://cgnew.fts368.com/sports", title: "CMD" };
const unrelatedTab = { id: 11, url: "https://news.example.com/", title: "news" };

describe("injectHeartbeatIntoOpenLobbies", () => {
  it("reaches every open lobby and leaves unrelated tabs alone", async () => {
    const inject = vi.fn(async () => undefined);
    const injected = await injectHeartbeatIntoOpenLobbies({
      listTabs: async () => [lobbyTab, unrelatedTab, otherLobbyTab],
      inject
    });
    expect(injected).toEqual([7, 9]);
    expect(inject).toHaveBeenCalledTimes(2);
  });

  it("keeps going when one tab refuses the injection", async () => {
    const inject = vi.fn(async (tabId: number) => {
      if (tabId === 7) throw new Error("NO_ACCESS");
    });
    const injected = await injectHeartbeatIntoOpenLobbies({
      listTabs: async () => [lobbyTab, otherLobbyTab],
      inject
    });
    expect(injected).toEqual([9]);
  });

  it("reports nothing rather than throwing when the tabs cannot be listed", async () => {
    const injected = await injectHeartbeatIntoOpenLobbies({
      listTabs: async () => { throw new Error("NO_TABS"); },
      inject: vi.fn(async () => undefined)
    });
    expect(injected).toEqual([]);
  });
});
