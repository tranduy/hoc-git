import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { sbobetMoreBatchFromResponse, sbobetMoreRequestFromObserved } from "./sbobet-more-protocol.js";

const url = "https://be.sb21.net/api/v2/getEventBetMore?eventId=5717357&oddsStyle=ma&leagueId=481&sportId=1&sportType=1_1";
const request = sbobetMoreRequestFromObserved(url, "GET")!;
const receipt = { generation: "worker:2", requestStartSequence: 100, observedAtMs: 1788850000000 };
const native = JSON.parse(readFileSync(new URL("./fixtures/sbobet-more-5717357-20260908.json", import.meta.url), "utf8"));

describe("source-proven complete More view, complementary to the main event", () => {
  it("retains every real native group while distinguishing More scope from full-event authority", () => {
    expect(sbobetMoreBatchFromResponse(request, JSON.stringify(native), receipt)).toEqual({
      kind: "SBOBET_EVENT_MORE", ...receipt, eventId: "5717357", leagueId: "481",
      marketContainerComplete: false, moreContainerComplete: true, groups: native
    });
  });

  it.each([{}, { "0": ["2,3,4,11,12"] }, { "8": [] }])(
    "preserves a validated successful empty More view without claiming the event is empty: %j", groups => {
      expect(sbobetMoreBatchFromResponse(request, JSON.stringify(groups), receipt)).toEqual({
        kind: "SBOBET_EVENT_MORE", ...receipt, eventId: "5717357", leagueId: "481",
        marketContainerComplete: false, moreContainerComplete: true, groups
      });
    });

  it.each([null, [], { error: "expired" }, { success: false }, { "8": "truncated" },
    { "0": ["not-tab-ids"] }, { "8": ["1.8*123456h 2.0*123456a 12345"] },
    { "8": ["https://example.invalid/"] }, { "8": [""] }])(
    "never grants More replacement authority to malformed or foreign-owner content: %j", body => {
      expect(sbobetMoreBatchFromResponse(request, JSON.stringify(body), receipt)).toBeNull();
    });

  it.each(["&gamePart=1", "&groupId=2", "&eventId=5717357", "&page=1"])(
    "rejects another view or ambiguous request scope: %s", suffix => {
      expect(sbobetMoreRequestFromObserved(url + suffix, "GET")).toBeNull();
    });
});
