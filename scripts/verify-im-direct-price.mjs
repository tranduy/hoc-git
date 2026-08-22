import { writeFile } from "node:fs/promises";

const baseUrl = process.env.TOOL_CHENH_API_URL ?? "http://127.0.0.1:4310";
const outputPath = process.argv[2] ?? "im-direct-price-evidence.json";
const maxCandidates = Math.max(1, Number(process.argv[3] ?? 16));
const accountId = "catalog-source:IM:FOOTBALL";
const response = await fetch(baseUrl + "/api/catalog/accounts/" + encodeURIComponent(accountId), { cache: "no-store" });
const catalog = await response.json();
const decimalOdds = (rawOdds) => String(Number(rawOdds) >= 0 ? 1 + Number(rawOdds) : 1 + 1 / Math.abs(Number(rawOdds)));
const results = [];
for (const marketType of ["FT_AH", "FT_TOTAL"]) {
  const candidates = catalog.quotes.filter((quote) => quote.marketType === marketType && quote.status === "OPEN");
  const checked = [];
  for (const displayed of candidates.slice(0, maxCandidates)) {
    const event = catalog.events.find((candidate) => candidate.providerEventId === displayed.providerEventId);
    if (!event) continue;
    const leg = { provider: "IM", accountId, providerEventId: displayed.providerEventId,
      providerMarketId: displayed.providerMarketId, providerSelectionId: displayed.providerSelectionId,
      selection: displayed.selection, line: displayed.line, rawOdds: displayed.rawOdds,
      rawFormat: displayed.rawFormat, decimalOdds: decimalOdds(displayed.rawOdds), quoteStatus: displayed.status,
      providerObservedAtMs: catalog.observedAtMs, receivedMonotonicMs: displayed.receivedMonotonicMs,
      sequence: displayed.sequence, requestedStake: "100000" };
    const checkResponse = await fetch(baseUrl + "/api/preflight/realtime-check", { method: "POST",
      headers: { "content-type": "application/json" }, body: JSON.stringify({
        eventLabel: `${event.participantA} vs ${event.participantB}`, participantA: event.participantA,
        participantB: event.participantB, marketType: displayed.marketType, scope: displayed.scope,
        capturedAtMs: Date.now(), legs: [leg, { ...leg, provider: "CMD",
          accountId: "catalog-source:CMD:FOOTBALL", providerEventId: "diagnostic-none",
          providerMarketId: "diagnostic-none", providerSelectionId: "diagnostic-none",
          selection: displayed.selection === "HOME" ? "AWAY" : "UNDER" }]
      }) });
    if (!checkResponse.ok) continue;
    const body = await checkResponse.json();
    checked.push({ checkId: body.checkId, identity: { providerEventId: displayed.providerEventId,
      providerMarketId: displayed.providerMarketId, providerSelectionId: displayed.providerSelectionId,
      selection: displayed.selection, line: displayed.line }, result: body.legs[0] });
    if (body.legs[0]?.direct !== null) break;
  }
  const accepted = checked.find((check) => check.result?.direct !== null) ?? checked[0];
  if (!accepted) throw new Error(`IM_${marketType}_CHECK_UNAVAILABLE`);
  results.push({ marketType, ...accepted });
}
const evidence = { checkedAtMs: Date.now(), results };
await writeFile(outputPath, JSON.stringify(evidence, null, 2) + "\n", "utf8");
process.stdout.write(JSON.stringify(evidence, null, 2) + "\n");
