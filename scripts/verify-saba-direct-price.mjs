import { writeFile } from "node:fs/promises";

const baseUrl = process.env.TOOL_CHENH_API_URL ?? "http://127.0.0.1:4310";
const outputPath = process.argv[2] ?? "saba-direct-price-evidence.json";
const accountId = "catalog-source:SABA:FOOTBALL";
const catalog = await fetch(baseUrl + "/api/catalog/accounts/" + encodeURIComponent(accountId),
  { cache: "no-store" }).then((response) => response.json());

function decimalOdds(rawOdds) {
  const value = Number(rawOdds);
  return String(value >= 0 ? 1 + value : 1 + 1 / Math.abs(value));
}

const results = [];
for (const marketType of ["FT_AH", "FT_TOTAL"]) {
  const displayed = catalog.quotes.find((quote) => quote.marketType === marketType &&
    (quote.selection === "HOME" || quote.selection === "OVER"));
  if (!displayed) throw new Error(`SABA_${marketType}_QUOTE_NOT_FOUND`);
  const event = catalog.events.find((candidate) => candidate.providerEventId === displayed.providerEventId);
  if (!event) throw new Error(`SABA_${marketType}_EVENT_NOT_FOUND`);
  const leg = { provider: "SABA", accountId, providerEventId: displayed.providerEventId,
    providerMarketId: displayed.providerMarketId, providerSelectionId: displayed.providerSelectionId,
    selection: displayed.selection, line: displayed.line, rawOdds: displayed.rawOdds,
    rawFormat: displayed.rawFormat, decimalOdds: decimalOdds(displayed.rawOdds), quoteStatus: displayed.status,
    providerObservedAtMs: catalog.observedAtMs, receivedMonotonicMs: displayed.receivedMonotonicMs,
    sequence: displayed.sequence, requestedStake: "100000" };
  const opposite = displayed.selection === "HOME" ? "AWAY" : "UNDER";
  const response = await fetch(baseUrl + "/api/preflight/realtime-check", { method: "POST",
    headers: { "content-type": "application/json" }, body: JSON.stringify({
      eventLabel: `${event.participantA} vs ${event.participantB}`,
      participantA: event.participantA, participantB: event.participantB,
      marketType: displayed.marketType, scope: displayed.scope, capturedAtMs: Date.now(),
      legs: [leg, { ...leg, provider: "APSPORT", accountId: "catalog-source:APSPORT:FOOTBALL",
        providerEventId: "diagnostic-none", providerMarketId: "diagnostic-none",
        providerSelectionId: "diagnostic-none", selection: opposite }]
    }) });
  if (!response.ok) throw new Error(`SABA_${marketType}_CHECK_HTTP_${response.status}`);
  const body = await response.json();
  results.push({ marketType, checkId: body.checkId, result: body.legs[0] });
}
const evidence = { checkedAtMs: Date.now(), results };
await writeFile(outputPath, JSON.stringify(evidence, null, 2) + "\n", "utf8");
process.stdout.write(JSON.stringify(evidence, null, 2) + "\n");
