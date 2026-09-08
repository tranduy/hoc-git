import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { extractSbobetMoreRoster } from "./sbobet-more-roster.js";

const observed = (JSON.parse(readFileSync(new URL(
  "../../api/src/providers/sbobet/sbobet-native-5717357.fixture.json", import.meta.url), "utf8")) as {
  records: Array<Record<string, unknown>>;
}).records;
const league = (events: readonly unknown[] = observed) => ({ "0": 481,
  "1": "Giải Ngoại hạng Phần Lan", "2": events });
const owner = { eventId: "5717357", leagueId: "481", home: "Lahti", away: "IFK Mariehamn",
  startAtUtcMs: Date.parse("2026-09-08T15:00:00Z") };

describe("SBOBET More owners from native roster", () => {
  it.each(["PREMATCH", "LIVE"] as const)("deduplicates observed main/corner containers and retains league owner for %s", (phase) => {
    expect(extractSbobetMoreRoster([league()], phase)).toEqual([{ ...owner, phase }]);
    expect(extractSbobetMoreRoster([league([...observed].reverse())], phase)).toEqual([{ ...owner, phase }]);
  });

  it("accepts the full native date-array wrapper", () => {
    expect(extractSbobetMoreRoster([[], [league()]], "PREMATCH")).toEqual([{ ...owner, phase: "PREMATCH" }]);
  });

  it.each([[], [[]], [league([])], [[league([])]]].map(body => ({ body })))("preserves a valid empty roster %#", ({ body }) => {
    expect(extractSbobetMoreRoster(body, "PREMATCH")).toEqual([]);
  });

  it("retains an admitted owner with explicit empty native groups", () => {
    expect(extractSbobetMoreRoster([league([{ ...observed[0], "7": {} }])], "PREMATCH"))
      .toEqual([{ ...owner, phase: "PREMATCH" }]);
  });

  it.each([
    { "2": "Different Home" }, { "3": "Different Away" }, { "0": "2026-09-09T15:00:00Z" }
  ])("rejects conflicting repeated-event metadata %j", (override) => {
    expect(extractSbobetMoreRoster([league([observed[0], { ...observed[1], ...override }])], "PREMATCH")).toBeNull();
  });

  it("rejects the same event assigned to different native leagues", () => {
    expect(extractSbobetMoreRoster([league([observed[0]]), { ...league([observed[1]]), "0": 482 }], "PREMATCH")).toBeNull();
  });

  it.each([
    null, {}, { "1": [league()] }, observed,
    [league(), [league()]], [[[]]], [{ ...league(), error: "denied" }],
    [{ ...league(), "0": "481" }], [{ ...league(), "0": 0 }],
    [{ ...league(), "0": Number.MAX_SAFE_INTEGER + 1 }], [{ ...league(), "1": " " }],
    [{ ...league(), "2": null }], [league([{ error: "denied" }])],
    [league([{ ...observed[0], "8": Number.MAX_SAFE_INTEGER + 1 }])],
    [league([{ ...observed[0], "8": "not-numeric" }])],
    [league([{ ...observed[0], "2": " " }])], [league([{ ...observed[0], "3": "Lahti" }])],
    [league([{ ...observed[0], "0": "15:00" }])],
    [league([{ ...observed[0], "0": "2026-09-08T15:00:00" }])],
    [league([{ ...observed[0], "7": null }])],
    [league([{ ...observed[0], "7": { "3": null, "21": [] } }])],
    [league([{ ...observed[0], "7": { error: [] } }])],
    [league([{ ...observed[0], errors: [] }])]
  ].map(body => ({ body })))("rejects incomplete, mixed or malformed native roster input %#", ({ body }) => {
    expect(extractSbobetMoreRoster(body, "PREMATCH")).toBeNull();
  });

  it("does not infer phase from a caller value outside the proven pair", () => {
    expect(extractSbobetMoreRoster([league()], "TODAY" as "PREMATCH")).toBeNull();
  });

  it("bounds source traversal before an oversized roster tail is read", () => {
    const unread = new Proxy({}, { get: () => { throw new Error("UNBOUNDED_ROSTER"); } });
    expect(extractSbobetMoreRoster(Array.from({ length: 20_001 }, () => unread), "PREMATCH")).toBeNull();
  });
});
