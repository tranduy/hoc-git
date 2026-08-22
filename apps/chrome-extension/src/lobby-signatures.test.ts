import { describe, expect, it } from "vitest";
import { confirmLobbyFingerprint, recognizeLobbyTab,
  shouldPreserveKsportObserver } from "./lobby-signatures.js";

const configuredHosts = [
  ["IM", "imsports.directsb.net"],
  ["BTI", "prod20091.fxf774.com"],
  ["TSPORT", "pacific.agenate.com"],
  ["KSPORT", "zenandfe.com"],
  ["SABA", "c0z0oa.bpd3a3fn.com"],
  ["CMD", "cgnew.fts368.com"],
  ["SBO", "sports-sbomaind-play.jjsskktt.com"]
] as const;

describe("lobby tab recognition", () => {
  it.each(configuredHosts)("recognizes %s from hostname without retaining query material", (lobby, hostname) => {
    const result = recognizeLobbyTab({
      id: 17,
      url: `https://${hostname}/sports?token=super-secret`,
      title: "Sports"
    });
    expect(result).toEqual({ lobby, tabId: 17, hostname, confidence: "CANDIDATE" });
    expect(JSON.stringify(result)).not.toContain("super-secret");
  });

  it("does not trust an unmatched tab or a hostname lookalike", () => {
    expect(recognizeLobbyTab({ id: 1, url: "https://example.test/", title: "Sports" })).toBeNull();
    expect(recognizeLobbyTab({ id: 2, url: "https://imsports.directsb.net.evil.test/", title: "Sports" })).toBeNull();
  });

  it("does not recognize a Volta or provider error page as the K-Sports sportsbook", () => {
    expect(recognizeLobbyTab({ id: 3, url: "https://zenandfe.com/volta", title: "Volta" })).toBeNull();
    expect(recognizeLobbyTab({ id: 4, url: "https://zenandfe.com/?token=failed",
      title: "Something went wrong" })).toBeNull();
    expect(recognizeLobbyTab({ id: 5, url: "https://zenandfe.com/sports", title: "Sportsbook" })?.lobby)
      .toBe("KSPORT");
  });

  it("preserves only an already-baselined KSPORT observer across an outer-shell transition", () => {
    expect(shouldPreserveKsportObserver("KSPORT", true)).toBe(true);
    expect(shouldPreserveKsportObserver("KSPORT", false)).toBe(false);
    expect(shouldPreserveKsportObserver("SABA", true)).toBe(false);
  });

  it("recognizes a rotated SABA launch host without accepting a suffix lookalike", () => {
    expect(recognizeLobbyTab({ id: 3, url: "https://c0z0ob.bpd3a3fn.com/sports?token=opaque" })?.lobby).toBe("SABA");
    expect(recognizeLobbyTab({ id: 5, url: "https://c0z0ob.bp7xvs95.com/sports?token=opaque" })?.lobby).toBe("SABA");
    expect(recognizeLobbyTab({ id: 4, url: "https://c0z0ob.bpd3a3fn.com.evil.test/" })).toBeNull();
    expect(recognizeLobbyTab({ id: 6, url: "https://c0z0ob.bp7xvs95.com.evil.test/" })).toBeNull();
  });

  it("classifies the legacy SBO Socket.IO host before the generic rotated SABA pattern", () => {
    expect(recognizeLobbyTab({ id: 10,
      url: "https://c0z0ob.bpb7jrm5.com/session/NewIndex?token=opaque", title: "Sports" })?.lobby)
      .toBe("SBO");
    expect(recognizeLobbyTab({ id: 11,
      url: "https://c0z0oc.bpf7t7s9.com/session/NewIndex?token=opaque", title: "Sports" })?.lobby)
      .toBe("SBO");
    expect(recognizeLobbyTab({ id: 12, url: "https://c0z0ob.bpb7jrm5.com.evil.test/" })).toBeNull();
  });

  it("recognizes the current APSPORT launch host", () => {
    expect(recognizeLobbyTab({ id: 7, url: "https://sport.asportsb.com/sports?token=opaque" })?.lobby)
      .toBe("TSPORT");
    expect(recognizeLobbyTab({ id: 8, url: "https://pacific.racern.com/sports?token=opaque" })?.lobby)
      .toBe("TSPORT");
    expect(recognizeLobbyTab({ id: 9, url: "https://pacific.racern.com.evil.test/sports" }))
      .toBeNull();
  });

  it("requires traffic markers before a domain candidate becomes trusted", () => {
    const candidate = recognizeLobbyTab({ id: 17, url: "https://imsports.directsb.net/", title: "Sports" });
    expect(candidate?.confidence).toBe("CANDIDATE");
    expect(confirmLobbyFingerprint(candidate!, { resourceType: "Fetch", marker: "unrelated" })).toBeNull();
    expect(confirmLobbyFingerprint(candidate!, { resourceType: "WebSocket", marker: "sports-odds-feed" }))
      .toEqual({ ...candidate, confidence: "TRUSTED" });
  });
});
