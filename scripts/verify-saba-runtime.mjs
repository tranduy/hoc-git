import { writeFile } from "node:fs/promises";

const baseUrl = process.env.TOOL_CHENH_API_URL ?? "http://127.0.0.1:4310";
const durationMs = Math.max(10_000, Number(process.argv[2] ?? 600_000));
const outputPath = process.argv[3] ?? "saba-runtime-evidence.json";
const accountId = "catalog-source:SABA:FOOTBALL";
const startedAtMs = Date.now();
const deadlineMs = startedAtMs + durationMs;
const result = { startedAtMs, durationMs, samples: 0, liveSamples: 0, zeroEventWhileLive: 0,
  firstSourceSequence: null, lastSourceSequence: null, sourceSequenceChanges: 0,
  firstCatalogRevision: null, lastCatalogRevision: null, catalogRevisionChanges: 0,
  websocketSabaRevisions: 0, firstEventCount: null, minEventCount: null, lastEventCount: null,
  quoteChanges: [], errors: [] };
const prices = new Map();
let priorSourceSequence = null;

const socket = new WebSocket(baseUrl.replace(/^http/u, "ws") + "/api/realtime");
socket.addEventListener("message", (event) => {
  try {
    const message = JSON.parse(String(event.data));
    if (message.type === "CATALOG_REVISION" && message.accountId === accountId) result.websocketSabaRevisions += 1;
  } catch (error) { result.errors.push(error instanceof Error ? error.message : String(error)); }
});
socket.addEventListener("error", () => result.errors.push("WEBSOCKET_ERROR"));

while (Date.now() < deadlineMs) {
  try {
    const [sourcesResponse, catalogResponse] = await Promise.all([
      fetch(baseUrl + "/api/chrome-bridge/sources", { cache: "no-store" }),
      fetch(baseUrl + "/api/catalog/accounts/" + encodeURIComponent(accountId), { cache: "no-store" })
    ]);
    if (!sourcesResponse.ok || !catalogResponse.ok) throw new Error(`HTTP_${sourcesResponse.status}_${catalogResponse.status}`);
    const sources = await sourcesResponse.json();
    const catalog = await catalogResponse.json();
    const source = sources.sources.find((candidate) => candidate.lobby === "SABA");
    const sequence = source?.lastSequence ?? null;
    const revision = catalogResponse.headers.get("x-catalog-revision");
    const eventCount = catalog.events.length;
    result.samples += 1;
    if (source?.state === "LIVE") result.liveSamples += 1;
    if (source?.state === "LIVE" && eventCount === 0) result.zeroEventWhileLive += 1;
    result.firstSourceSequence ??= sequence;
    result.lastSourceSequence = sequence ?? result.lastSourceSequence;
    if (priorSourceSequence !== null && sequence !== null && sequence > priorSourceSequence) result.sourceSequenceChanges += 1;
    priorSourceSequence = sequence;
    result.firstCatalogRevision ??= revision;
    if (result.lastCatalogRevision !== null && revision !== result.lastCatalogRevision) result.catalogRevisionChanges += 1;
    result.lastCatalogRevision = revision;
    result.firstEventCount ??= eventCount;
    result.minEventCount = result.minEventCount === null ? eventCount : Math.min(result.minEventCount, eventCount);
    result.lastEventCount = eventCount;
    for (const quote of catalog.quotes) {
      const key = [quote.providerEventId, quote.providerMarketId, quote.providerSelectionId].join("|");
      const prior = prices.get(key);
      if (prior !== undefined && prior.rawOdds !== quote.rawOdds && result.quoteChanges.length < 50) {
        result.quoteChanges.push({ key, marketType: quote.marketType, scope: quote.scope, line: quote.line,
          before: prior.rawOdds, after: quote.rawOdds, beforeSequence: prior.sequence,
          afterSequence: quote.sequence, detectedAtMs: Date.now() });
      }
      prices.set(key, { rawOdds: quote.rawOdds, sequence: quote.sequence });
    }
  } catch (error) { result.errors.push(error instanceof Error ? error.message : String(error)); }
  await new Promise((resolve) => setTimeout(resolve, 1_000));
}
socket.close();
result.finishedAtMs = Date.now();
await writeFile(outputPath, JSON.stringify(result, null, 2) + "\n", "utf8");
process.stdout.write(JSON.stringify(result, null, 2) + "\n");
