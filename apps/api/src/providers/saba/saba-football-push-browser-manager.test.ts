import { describe, expect, it } from "vitest";
import { markSabaLiveContextRecords } from "./saba-football-push-browser-manager.js";

describe("markSabaLiveContextRecords", () => {
  it("uses the verified Live tab as lifecycle evidence when SABA leaves marketid at Today", () => {
    const records = [
      { type: "l", leagueid: 1, leaguenameen: "Today league" },
      { type: "l", leagueid: 2, leaguenameen: "Live league" },
      { type: "m", matchid: 10, leagueid: 1, marketid: "T" },
      { type: "o", oddsid: 100, matchid: 10 },
      { type: "m", matchid: 20, leagueid: 2, marketid: "L" },
      { type: "o", oddsid: 200, matchid: 20 }
    ];

    expect(markSabaLiveContextRecords(records)).toEqual([
      records[0], records[1], { ...records[2], marketid: "L" }, records[3], records[4], records[5]
    ]);
  });
});
