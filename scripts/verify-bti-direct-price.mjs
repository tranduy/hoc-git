import { writeFile } from "node:fs/promises";

const baseUrl = process.env.TOOL_CHENH_API_URL ?? "http://127.0.0.1:4310";
const outputPath = process.argv[2] ?? "bti-direct-price-evidence.json";
const maxCandidates = Math.max(1, Number(process.argv[3] ?? 20));
const accountId = "catalog-source:BTI:FOOTBALL";
const catalog = await fetch(baseUrl + "/api/catalog/accounts/" + encodeURIComponent(accountId),
  { cache: "no-store" }).then((response) => response.json());

function decimalOdds(rawOdds) {
  const value = Number(rawOdds);
  return String(value >= 0 ? 1 + value : 1 + 1 / Math.abs(value));
}

const results = [];
for (const marketType of ["FT_AH", "FT_TOTAL"]) {
  const candidates = catalog.quotes.filter((quote) => quote.marketType === marketType &&
    (quote.selection === "HOME" || quote.selection === "OVER")).slice(0, maxCandidates);
  const checks = [];
  for (const displayed of candidates) {
    const event = catalog.events.find((candidate) => candidate.providerEventId === displayed.providerEventId);
    if (!event) continue;
    const leg = { provider: "BTI", accountId, providerEventId: displayed.providerEventId,
      providerMarketId: displayed.providerMarketId, providerSelectionId: displayed.providerSelectionId,
      selection: displayed.selection, line: displayed.line, rawOdds: displayed.rawOdds,
      rawFormat: displayed.rawFormat, decimalOdds: decimalOdds(displayed.rawOdds), quoteStatus: displayed.status,
      providerObservedAtMs: catalog.observedAtMs, receivedMonotonicMs: displayed.receivedMonotonicMs,
      sequence: displayed.sequence, requestedStake: "100000" };
    const response = await fetch(baseUrl + "/api/preflight/realtime-check", { method: "POST",
      headers: { "content-type": "application/json" }, body: JSON.stringify({
        eventLabel: `${event.participantA} vs ${event.participantB}`,
        participantA: event.participantA, participantB: event.participantB,
        marketType: displayed.marketType, scope: displayed.scope, capturedAtMs: Date.now(),
        legs: [leg, { ...leg, provider: "CMD", accountId: "catalog-source:CMD:FOOTBALL",
          providerEventId: "diagnostic-none", providerMarketId: "diagnostic-none",
          providerSelectionId: "diagnostic-none", selection: displayed.selection === "HOME" ? "AWAY" : "UNDER" }]
      }) });
    if (!response.ok) continue;
    const body = await response.json();
    checks.push({ checkId: body.checkId, identity: { providerEventId: displayed.providerEventId,
      providerMarketId: displayed.providerMarketId, providerSelectionId: displayed.providerSelectionId,
      selection: displayed.selection, line: displayed.line }, toolRawOdds: displayed.rawOdds,
      result: body.legs[0] });
    if (body.legs[0]?.direct !== null) break;
  }
  results.push({ marketType, checks, accepted: checks.find((check) => check.result?.direct !== null) ?? null });
}

const evidence = { checkedAtMs: Date.now(), results };
await writeFile(outputPath, JSON.stringify(evidence, null, 2) + "\n", "utf8");
process.stdout.write(JSON.stringify(evidence, null, 2) + "\n");
