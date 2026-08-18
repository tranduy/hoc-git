import { describe, expect, it } from "vitest";
import {
  appendBoundedSbobetSocketPayload, correlateSbobetPublicIds, decodeSbobetJsonBody,
  decodeSbobetStompBodies, extractSbobetSnapshotPublicIds, hasSbobetSocketCatalogCorrelation,
  isSbobetPublicFeedUrl, isSbobetResponseCandidate,
  isSbobetSocketUrl, nextSbobetSocketDirtyAtMs
} from "./sbobet-stomp.js";

describe("SBOBET SockJS/STOMP decoding", () => {
  it("unwraps a MESSAGE and its nested JSON body without accepting headers as data", () => {
    const nested = JSON.stringify({ "1": [{ "2": 5603585, "3": "Home" }] });
    const frame = `MESSAGE\ndestination:/safe\n\n${JSON.stringify({ body: nested })}\0`;
    expect(decodeSbobetStompBodies(`a${JSON.stringify([frame])}`)).toEqual([
      { "1": [{ "2": 5603585, "3": "Home" }] }
    ]);
  });

  it("reports only structural paths and sibling key names for known public event IDs", () => {
    const evidence = correlateSbobetPublicIds([{ "1": [{ "2": 5603585, "3": "Home", secret: "must-not-return" }] }], ["5603585"]);
    expect(evidence).toEqual([{ target: "5603585", path: "$[0].1[0].2", keys: ["2", "3"] }]);
    expect(JSON.stringify(evidence)).not.toContain("must-not-return");
    expect(JSON.stringify(evidence)).not.toContain("secret");
  });

  it("extracts bounded public event and selection IDs from an SBOBET snapshot", () => {
    const body = { wrapper: [{ "2": "Alpha", "3": "Beta", "7": {
      "5": ["0.5 0.80*56035850050001h -0.90*56035850050001a h 730078508161105"]
    }, "8": 5603585, token: "must-not-return" }] };
    expect(extractSbobetSnapshotPublicIds(body)).toEqual([
      "5603585", "56035850050001", "730078508161105"
    ]);
  });

  it("correlates a socket frame by public event ID without decoding a full catalog", () => {
    const matching = { wrapper: [{ "2": "Alpha", "3": "Beta", "7": {
      "5": ["0.5 0.80*56035850050001h -0.90*56035850050001a h 730078508161105"]
    }, "8": 5603585 }] };
    expect(hasSbobetSocketCatalogCorrelation([matching], ["5603585", "777"])).toBe(true);
    expect(hasSbobetSocketCatalogCorrelation([matching], ["999"])).toBe(false);
    expect(hasSbobetSocketCatalogCorrelation([], ["5603585"])).toBe(false);
  });

  it("rejects arbitrary text targets so correlation cannot become a secret search primitive", () => {
    expect(correlateSbobetPublicIds([{ token: "private-value" }], ["private-value"])).toEqual([]);
  });

  it("redacts nonnumeric wrapper names from structural paths", () => {
    expect(correlateSbobetPublicIds([{ authEnvelope: { "9": "5603585" } }], ["5603585"]))
      .toEqual([{ target: "5603585", path: "$[0].*.9", keys: ["9"] }]);
  });

  it("bounds diagnostic capture by frame count, frame size, and total size", () => {
    const buffer: string[] = [];
    const limits = { maxFrameChars: 5, maxTotalChars: 6, maxFrames: 2 };
    appendBoundedSbobetSocketPayload(buffer, "111", limits);
    appendBoundedSbobetSocketPayload(buffer, "222", limits);
    appendBoundedSbobetSocketPayload(buffer, "333", limits);
    appendBoundedSbobetSocketPayload(buffer, "oversized", limits);
    expect(buffer).toEqual(["222", "333"]);
  });

  it("accepts only the verified HTTPS public feed path and decodes JSON in memory", () => {
    expect(isSbobetPublicFeedUrl("https://sports.example/sport/info?lang=vi")).toBe(true);
    expect(isSbobetPublicFeedUrl("https://sports.example/private/info")).toBe(false);
    expect(isSbobetPublicFeedUrl("http://sports.example/sport/info")).toBe(false);
    expect(decodeSbobetJsonBody('{"1":5603585}')).toEqual([{ "1": 5603585 }]);
    expect(decodeSbobetJsonBody("not-json")).toEqual([]);
    expect(isSbobetResponseCandidate("https://sports.example/events", "xhr")).toBe(true);
    expect(isSbobetResponseCandidate("https://sports.example/events", "document")).toBe(false);
    expect(isSbobetResponseCandidate("http://sports.example/events", "fetch")).toBe(false);
  });

  it("accepts only the observed SBOBET secure socket hosts", () => {
    expect(isSbobetSocketUrl("wss://novoga.sb21.net/opaque")).toBe(true);
    expect(isSbobetSocketUrl("wss://sb21.net/opaque")).toBe(true);
    expect(isSbobetSocketUrl("ws://novoga.sb21.net/opaque")).toBe(false);
    expect(isSbobetSocketUrl("wss://sb21.net.evil.test/opaque")).toBe(false);
  });

  it("coalesces high-frequency socket frames before scheduling an authoritative refresh", () => {
    expect(nextSbobetSocketDirtyAtMs(null, null, 1_000)).toBe(1_000);
    expect(nextSbobetSocketDirtyAtMs(1_000, 1_000, 1_001)).toBe(1_000);
    expect(nextSbobetSocketDirtyAtMs(null, 1_000, 1_100)).toBeNull();
    expect(nextSbobetSocketDirtyAtMs(null, 1_000, 1_250)).toBe(1_250);
  });
});
