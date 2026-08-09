import assert from "node:assert/strict";
import test from "node:test";
import { diffSafeCatalog } from "./smoke-watch-match.mjs";

function catalog(observedAtMs, odds, status) {
  return {
    dataMode: "LIVE", accountId: "private-account", provider: "CMD", category: "FOOTBALL",
    observedAtMs, events: [{ providerEventId: "event-1", competition: "Premier Test", participantA: "Alpha", participantB: "Beta", isLive: true }],
    markets: [{ providerEventId: "event-1", providerMarketId: "market-1", marketType: "FT_1X2", scope: "FULL_TIME", line: null, status }],
    quotes: [{ providerEventId: "event-1", providerMarketId: "market-1", providerSelectionId: "home", selection: "HOME", rawOdds: odds, rawFormat: "DECIMAL", status }],
    token: "token-canary", cookie: "cookie-canary", launchUrl: "https://secret.invalid"
  };
}

test("formats only safe odds and suspension change evidence", () => {
  const changes = diffSafeCatalog(catalog(1_000, "2.1", "OPEN"), catalog(2_250, "2.05", "SUSPENDED"), "event-1", 2_300);
  assert.deepEqual(changes.map((change) => change.kind), ["MARKET_SUSPENDED", "ODDS_CHANGED", "QUOTE_SUSPENDED"]);
  assert.deepEqual(changes[1], {
    kind: "ODDS_CHANGED", detectedAtMs: 2_300, providerObservedAtMs: 2_250, sampleIntervalMs: 1_250,
    provider: "CMD", category: "FOOTBALL", competition: "Premier Test", match: "Alpha vs Beta",
    market: "FT_1X2", scope: "FULL_TIME", line: null, selection: "HOME",
    previous: "2.1 DECIMAL", current: "2.05 DECIMAL"
  });
  const serialized = JSON.stringify(changes);
  for (const canary of ["private-account", "token-canary", "cookie-canary", "secret.invalid"]) {
    assert.equal(serialized.includes(canary), false);
  }
});
