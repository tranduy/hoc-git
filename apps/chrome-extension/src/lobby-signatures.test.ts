import { describe, expect, it } from "vitest";
import { confirmLobbyFingerprint, recognizeLobbyTab } from "./lobby-signatures.js";

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

  it("requires traffic markers before a domain candidate becomes trusted", () => {
    const candidate = recognizeLobbyTab({ id: 17, url: "https://imsports.directsb.net/", title: "Sports" });
    expect(candidate?.confidence).toBe("CANDIDATE");
    expect(confirmLobbyFingerprint(candidate!, { resourceType: "Fetch", marker: "unrelated" })).toBeNull();
    expect(confirmLobbyFingerprint(candidate!, { resourceType: "WebSocket", marker: "sports-odds-feed" }))
      .toEqual({ ...candidate, confidence: "TRUSTED" });
  });
});
