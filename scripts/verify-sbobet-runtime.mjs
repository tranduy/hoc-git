import { writeFile } from "node:fs/promises";

const baseUrl = process.env.TOOL_CHENH_API_URL ?? "http://127.0.0.1:4310";
const durationMs = Math.max(10_000, Number(process.argv[2] ?? 600_000));
const outputPath = process.argv[3] ?? "sbobet-runtime-evidence.json";
const accountId = "catalog-source:SBOBET:FOOTBALL";
const startedAtMs = Date.now();
const result = { startedAtMs, durationMs, samples: 0, liveSamples: 0, zeroEventWhileLive: 0,
  providerActiveSamples: 0, providerActionRequiredSamples: 0, catalogAvailableSamples: 0,
  firstSourceSequence: null, lastSourceSequence: null, firstCatalogRevision: null,
  lastCatalogRevision: null, firstEventCount: null, minEventCount: null, lastEventCount: null,
  catalogRevisionChanges: 0, websocketSbobetRevisions: 0, websocketErrors: [], quoteChanges: [] };
const prices = new Map();
const socket = new WebSocket(baseUrl.replace(/^http/u, "ws") + "/api/realtime");
socket.addEventListener("message", (event) => {
  try {
    const message = JSON.parse(String(event.data));
    if (message.type === "CATALOG_REVISION" && message.accountId === accountId) {
      result.websocketSbobetRevisions += 1;
    }
  } catch (error) { result.websocketErrors.push(error instanceof Error ? error.message : String(error)); }
});
socket.addEventListener("error", () => result.websocketErrors.push("WEBSOCKET_ERROR"));

while (Date.now() < startedAtMs + durationMs) {
  try {
    const [sourcesResponse, statusesResponse, catalogResponse] = await Promise.all([
      fetch(baseUrl + "/api/chrome-bridge/sources", { cache: "no-store" }),
      fetch(baseUrl + "/api/catalog/sources", { cache: "no-store" }),
      fetch(baseUrl + "/api/catalog/accounts/" + encodeURIComponent(accountId), { cache: "no-store" })
    ]);
    if (!sourcesResponse.ok || !statusesResponse.ok) {
      throw new Error(`HTTP_${sourcesResponse.status}_${statusesResponse.status}`);
    }
    const sources = await sourcesResponse.json();
    const statuses = await statusesResponse.json();
    const source = sources.sources.find((candidate) => candidate.lobby === "KSPORT");
    const providerStatus = statuses.sources.find((candidate) => candidate.id === accountId);
    result.samples += 1;
    if (source?.state === "LIVE") result.liveSamples += 1;
    if (providerStatus?.sessionState === "ACTIVE") result.providerActiveSamples += 1;
    if (providerStatus?.sessionState === "ACTION_REQUIRED") result.providerActionRequiredSamples += 1;
    result.firstSourceSequence ??= source?.lastSequence ?? null;
    result.lastSourceSequence = source?.lastSequence ?? result.lastSourceSequence;
    if (!catalogResponse.ok) {
      await new Promise((resolve) => setTimeout(resolve, 1_000));
      continue;
    }
    result.catalogAvailableSamples += 1;
    const catalog = await catalogResponse.json();
    const revision = catalogResponse.headers.get("x-catalog-revision");
    const eventCount = catalog.events.length;
    if (source?.state === "LIVE" && eventCount === 0) result.zeroEventWhileLive += 1;
    result.firstCatalogRevision ??= revision;
    if (result.lastCatalogRevision !== null && revision !== result.lastCatalogRevision) {
      result.catalogRevisionChanges += 1;
    }
    result.lastCatalogRevision = revision;
    result.firstEventCount ??= eventCount;
    result.minEventCount = result.minEventCount === null ? eventCount : Math.min(result.minEventCount, eventCount);
    result.lastEventCount = eventCount;
    for (const quote of catalog.quotes) {
      const key = [quote.providerEventId, quote.providerMarketId, quote.providerSelectionId].join("|");
      const prior = prices.get(key);
      if (prior !== undefined && prior.rawOdds !== quote.rawOdds && result.quoteChanges.length < 50) {
        result.quoteChanges.push({ key, before: prior.rawOdds, after: quote.rawOdds,
          beforeSequence: prior.sequence, afterSequence: quote.sequence, detectedAtMs: Date.now() });
      }
      prices.set(key, { rawOdds: quote.rawOdds, sequence: quote.sequence });
    }
  } catch (error) { result.websocketErrors.push(error instanceof Error ? error.message : String(error)); }
  await new Promise((resolve) => setTimeout(resolve, 1_000));
}
socket.close();
result.finishedAtMs = Date.now();
await writeFile(outputPath, JSON.stringify(result, null, 2) + "\n", "utf8");
process.stdout.write(JSON.stringify(result, null, 2) + "\n");
