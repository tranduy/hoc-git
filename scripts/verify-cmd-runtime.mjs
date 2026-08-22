import { writeFile } from "node:fs/promises";

const baseUrl = process.env.TOOL_CHENH_API_URL ?? "http://127.0.0.1:4310";
const durationMs = Math.max(10_000, Number(process.argv[2] ?? 600_000));
const outputPath = process.argv[3] ?? "cmd-runtime-evidence.json";
const accountId = "catalog-source:CMD:FOOTBALL";
const startedAtMs = Date.now();
const deadlineMs = startedAtMs + durationMs;
const result = {
  startedAtMs, durationMs, samples: 0, liveSamples: 0, zeroEventWhileLive: 0,
  firstSourceSequence: null, lastSourceSequence: null,
  firstCatalogRevision: null, lastCatalogRevision: null,
  firstEventCount: null, minEventCount: null, lastEventCount: null,
  catalogRevisionChanges: 0, websocketCmdRevisions: 0, websocketErrors: [], quoteChanges: []
};
const prices = new Map();

const wsUrl = baseUrl.replace(/^http/u, "ws") + "/api/realtime";
const socket = new WebSocket(wsUrl);
socket.addEventListener("message", (event) => {
  try {
    const message = JSON.parse(String(event.data));
    if (message.type === "CATALOG_REVISION" && message.accountId === accountId) {
      result.websocketCmdRevisions += 1;
    }
  } catch (error) {
    result.websocketErrors.push(error instanceof Error ? error.message : String(error));
  }
});
socket.addEventListener("error", () => result.websocketErrors.push("WEBSOCKET_ERROR"));

while (Date.now() < deadlineMs) {
  const [sourcesResponse, catalogResponse] = await Promise.all([
    fetch(baseUrl + "/api/chrome-bridge/sources", { cache: "no-store" }),
    fetch(baseUrl + "/api/catalog/accounts/" + encodeURIComponent(accountId), { cache: "no-store" })
  ]);
  if (!sourcesResponse.ok || !catalogResponse.ok) {
    result.websocketErrors.push(`HTTP_${sourcesResponse.status}_${catalogResponse.status}`);
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    continue;
  }
  const sources = await sourcesResponse.json();
  const catalog = await catalogResponse.json();
  const source = sources.sources.find((candidate) => candidate.lobby === "CMD");
  const revision = catalogResponse.headers.get("x-catalog-revision");
  const eventCount = catalog.events.length;
  result.samples += 1;
  if (source?.state === "LIVE") result.liveSamples += 1;
  if (source?.state === "LIVE" && eventCount === 0) result.zeroEventWhileLive += 1;
  result.firstSourceSequence ??= source?.lastSequence ?? null;
  result.lastSourceSequence = source?.lastSequence ?? result.lastSourceSequence;
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
  await new Promise((resolve) => setTimeout(resolve, 1_000));
}

socket.close();
result.finishedAtMs = Date.now();
await writeFile(outputPath, JSON.stringify(result, null, 2) + "\n", "utf8");
process.stdout.write(JSON.stringify(result, null, 2) + "\n");
