import { describe, expect, it } from "vitest";
import { extractBtiEsportsRecords } from "./bti-esports-source.js";

function payload(): unknown {
  const home = ["home-id", { VI: "Ole Miss Esports" }, { VI: "Ole Miss Esports" }, false, false, 4.16,
    ["316", "4.16", "22/7", "3.16", "3.16", "-0.316"], 1];
  const away = ["away-id", { VI: "Cupid eSports" }, { VI: "Cupid eSports" }, false, false, 1.21,
    ["-476", "1.21", "21/100", "0.21", "-4.76", "0.21"], 3];
  const market = ["market-id", "Live Team/Player to Win", "Live Team/Player to Win",
    ["ML39", "Live Team/Player to Win", 1], "event-id", "league-id", "64", [home, away], true, false];
  const event = ["event-id", [
    ["team-a-id", { VI: "Ole Miss Esports" }, "Home"],
    ["team-b-id", { VI: "Cupid eSports" }, "Away"]
  ], "Ole Miss Esports vs Cupid eSports", "2026-08-12T21:00:00.000Z", ["0", "0"], true, false,
  [true, 0, 1010, 111], ["event-id", 7, [], [market]]];
  return { serializedData: [["league-id", "League of Legends NACL Summer", 1, "master", false, "266",
    "LOL", "LOL", "League-of-Legends-NACL-Summer", "LOL", "64", "Thể-thao-điện-tử", [event]] ] };
}

describe("extractBtiEsportsRecords", () => {
  it("extracts the positional BTI sport-64 event, market and selection ids", () => {
    expect(extractBtiEsportsRecords(payload())).toEqual([expect.objectContaining({
      sportId: "64", sportCode: "LOL", eventId: "event-id", marketId: "market-id", marketCode: "ML39",
      participantA: "Ole Miss Esports", participantB: "Cupid eSports",
      selections: [
        { id: "home-id", side: 1, name: "Ole Miss Esports", decimal: "4.16", locked: false },
        { id: "away-id", side: 3, name: "Cupid eSports", decimal: "1.21", locked: false }
      ]
    })]);
  });

  it("rejects malformed envelopes rather than treating them as an empty live catalog", () => {
    expect(() => extractBtiEsportsRecords({ serializedData: "wrong" })).toThrow("BTI_ESPORTS_SCHEMA_CHANGED");
  });
});
