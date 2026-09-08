import { describe, expect, it } from "vitest";
import { CMD_MORE_PATH, cmdNativeRequestMetadata } from "./cmd-native-request.js";

describe("CMD native request ownership", () => {
  const url = "https://cgnew.fts368.com/Member/BetsView/BetLight/DataOdds.ashx";
  const all = "fc=6&TimeFilter=0&m_gameType=S_&SingleDouble=double&m_sp=0&m_LeagueList=&fav=&keywords=&exlist=0";
  it("proves full Early scope only when every observed native filter is unfiltered", () => {
    expect(cmdNativeRequestMetadata({ url, method: "POST", postData: all })).toEqual({ cmdFullScope: true });
    for (const postData of [all.replace("TimeFilter=0", "TimeFilter=2"), all.replace("m_sp=0", "m_sp=1"),
      all.replace("m_LeagueList=", "m_LeagueList=9"), all + "&keywords=team"]) {
      expect(cmdNativeRequestMetadata({ url, method: "POST", postData })).toEqual({});
    }
  });
  it("retains only the exact More owner and rejects parlay or a foreign endpoint", () => {
    const group = "fa97fe7b-13d3-4b03-96db-68aca62dd73f";
    const postData = JSON.stringify({ m_groupId: group, isPar: false, m_accId: "private-account", c: "private" });
    const request = { url: "https://cgnew.fts368.com" + CMD_MORE_PATH, method: "POST", postData };
    expect(cmdNativeRequestMetadata(request)).toEqual({ providerGroupId: group });
    expect(cmdNativeRequestMetadata({ ...request, postData: postData.replace("false", "0") })).toEqual({ providerGroupId: group });
    expect(cmdNativeRequestMetadata({ ...request, postData: postData.replace("false", "true") })).toEqual({});
    expect(cmdNativeRequestMetadata({ ...request, url: request.url.replace("cgnew.fts368.com", "example.com") })).toEqual({});
  });
});
