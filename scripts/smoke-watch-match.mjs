import { pathToFileURL } from "node:url";

function eventFor(catalog, eventId) {
  return Array.isArray(catalog.events) ? catalog.events.find((event) => event?.providerEventId === eventId) ?? null : null;
}

function marketKey(market) {
  return `${market.providerEventId}\u0000${market.providerMarketId}`;
}

function quoteKey(quote) {
  return `${quote.providerEventId}\u0000${quote.providerMarketId}\u0000${quote.providerSelectionId}`;
}

function safeBase(current, event, market, selection, detectedAtMs, previousObservedAtMs) {
  return {
    detectedAtMs,
    providerObservedAtMs: current.observedAtMs,
    sampleIntervalMs: Math.max(0, current.observedAtMs - previousObservedAtMs),
    provider: current.provider,
    category: current.category,
    competition: event?.competition ?? "Unknown competition",
    match: event === null ? "Unknown event" : `${event.participantA} vs ${event.participantB}`,
    market: market?.marketType ?? null,
    scope: market?.scope ?? null,
    line: market?.line ?? null,
    selection: selection ?? null
  };
}

export function diffSafeCatalog(previous, current, eventId, detectedAtMs) {
  const previousEvent = eventFor(previous, eventId);
  const currentEvent = eventFor(current, eventId);
  if (previousEvent !== null && currentEvent === null) {
    return [{
      kind: "EVENT_MISSING",
      ...safeBase(current, previousEvent, null, null, detectedAtMs, previous.observedAtMs),
      previous: "PRESENT", current: "MISSING"
    }];
  }
  if (previousEvent === null || currentEvent === null) return [];
  const output = [];
  const previousMarkets = new Map((previous.markets ?? []).filter((market) => market.providerEventId === eventId).map((market) => [marketKey(market), market]));
  const currentMarkets = (current.markets ?? []).filter((market) => market.providerEventId === eventId);
  const currentMarketsById = new Map(currentMarkets.map((market) => [market.providerMarketId, market]));
  for (const market of currentMarkets) {
    const prior = previousMarkets.get(marketKey(market));
    if (prior?.status === "OPEN" && market.status === "SUSPENDED") {
      output.push({ kind: "MARKET_SUSPENDED", ...safeBase(current, currentEvent, market, null, detectedAtMs, previous.observedAtMs), previous: "OPEN", current: "SUSPENDED" });
    } else if (prior?.status === "SUSPENDED" && market.status === "OPEN") {
      output.push({ kind: "MARKET_REOPENED", ...safeBase(current, currentEvent, market, null, detectedAtMs, previous.observedAtMs), previous: "SUSPENDED", current: "OPEN" });
    }
  }
  const previousQuotes = new Map((previous.quotes ?? []).filter((quote) => quote.providerEventId === eventId).map((quote) => [quoteKey(quote), quote]));
  for (const quote of (current.quotes ?? []).filter((candidate) => candidate.providerEventId === eventId)) {
    const prior = previousQuotes.get(quoteKey(quote));
    if (prior === undefined) continue;
    const market = currentMarketsById.get(quote.providerMarketId) ?? null;
    if (prior.rawOdds !== quote.rawOdds || prior.rawFormat !== quote.rawFormat) {
      output.push({
        kind: "ODDS_CHANGED", ...safeBase(current, currentEvent, market, quote.selection, detectedAtMs, previous.observedAtMs),
        previous: `${prior.rawOdds} ${prior.rawFormat}`, current: `${quote.rawOdds} ${quote.rawFormat}`
      });
    }
    if (prior.status === "OPEN" && quote.status === "SUSPENDED") {
      output.push({ kind: "QUOTE_SUSPENDED", ...safeBase(current, currentEvent, market, quote.selection, detectedAtMs, previous.observedAtMs), previous: "OPEN", current: "SUSPENDED" });
    } else if (prior.status === "SUSPENDED" && quote.status === "OPEN") {
      output.push({ kind: "QUOTE_REOPENED", ...safeBase(current, currentEvent, market, quote.selection, detectedAtMs, previous.observedAtMs), previous: "SUSPENDED", current: "OPEN" });
    }
  }
  return output;
}

export function safeTicketSummary(value) {
  return {
    kind: "EXACT_TICKET_SUMMARY",
    providerCount: value.providerCount,
    category: value.category,
    exactRowCount: value.exactRowCount,
    selectedLegs: (value.legs ?? []).map((leg) => ({ provider: leg.provider, selection: leg.selection,
      odds: leg.odds, stake: leg.stake })),
    outcomeProfits: { ...(value.profitsBySelection ?? {}) },
    worstCaseProfit: value.worstCaseProfit,
    alertTransition: value.alertTransition
  };
}

function argument(name, fallback) {
  const index = process.argv.indexOf(name);
  return index === -1 ? fallback : process.argv[index + 1] ?? fallback;
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function readJson(url) {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error("HTTP_READ_FAILED");
  return response.json();
}

async function main() {
  const baseUrl = argument("--api", "http://127.0.0.1:4310").replace(/\/$/u, "");
  const durationMs = Number(argument("--duration-ms", "120000"));
  const pollMs = Number(argument("--poll-ms", "1000"));
  const requestedEventId = argument("--event-id", "");
  const matchQuery = argument("--match-query", "").toLocaleLowerCase();
  const requestedAccountId = argument("--account-id", "");
  const requestedProvider = argument("--provider", "").toUpperCase();
  const requestedCategory = argument("--category", "").toUpperCase();
  if (!Number.isSafeInteger(durationMs) || durationMs < 1_000 || !Number.isSafeInteger(pollMs) || pollMs < 250) {
    throw new Error("WATCH_OPTIONS_INVALID");
  }
  const accountsResponse = await readJson(`${baseUrl}/api/accounts`);
  const account = accountsResponse.accounts?.find((candidate) =>
    candidate.sessionState === "ACTIVE" && candidate.capabilities?.includes("CATALOG") &&
    (requestedAccountId.length === 0 || candidate.id === requestedAccountId) &&
    (requestedProvider.length === 0 || candidate.provider === requestedProvider) &&
    (requestedCategory.length === 0 || candidate.category === requestedCategory));
  if (account === undefined) throw new Error("NO_ACTIVE_CATALOG_ACCOUNT");
  let previous = await readJson(`${baseUrl}/api/catalog/accounts/${encodeURIComponent(account.id)}`);
  if (previous.dataMode !== "LIVE") throw new Error("LIVE_MODE_REQUIRED");
  const acceptedEventIds = new Set((previous.markets ?? []).map((market) => market.providerEventId));
  const candidates = (previous.events ?? []).filter((event) => acceptedEventIds.has(event.providerEventId));
  const selected = requestedEventId.length > 0
    ? candidates.find((event) => event.providerEventId === requestedEventId)
    : matchQuery.length > 0
      ? candidates.find((event) => `${event.participantA} ${event.participantB}`.toLocaleLowerCase().includes(matchQuery))
      : candidates.find((event) => event.isLive) ?? candidates[0];
  if (selected === undefined) throw new Error(matchQuery.length > 0 ? "REQUESTED_MATCH_NOT_IN_VERIFIED_FEED" : "NO_ACCEPTED_EVENT");

  const startAt = Date.now();
  let samples = 1;
  let changeCount = 0;
  process.stdout.write(`${JSON.stringify({
    kind: "WATCH_STARTED", provider: previous.provider, category: previous.category,
    competition: selected.competition, match: `${selected.participantA} vs ${selected.participantB}`,
    isLive: selected.isLive, observedAtMs: previous.observedAtMs,
    note: "Single-provider observation; cross-book timing unavailable"
  })}\n`);
  while (Date.now() - startAt < durationMs) {
    await sleep(pollMs);
    try {
      const current = await readJson(`${baseUrl}/api/catalog/accounts/${encodeURIComponent(account.id)}`);
      if (current.dataMode !== "LIVE" || current.provider !== previous.provider || current.category !== previous.category) {
        throw new Error("CATALOG_IDENTITY_CHANGED");
      }
      const changes = diffSafeCatalog(previous, current, selected.providerEventId, Date.now());
      for (const change of changes) process.stdout.write(`${JSON.stringify(change)}\n`);
      changeCount += changes.length;
      samples += 1;
      previous = current;
    } catch {
      process.stdout.write(`${JSON.stringify({ kind: "POLL_FAILED", detectedAtMs: Date.now(), reason: "Provider catalog read failed" })}\n`);
    }
  }
  process.stdout.write(`${JSON.stringify({
    kind: "WATCH_FINISHED", provider: previous.provider, category: previous.category,
    match: `${selected.participantA} vs ${selected.participantB}`, samples, changes: changeCount,
    elapsedMs: Date.now() - startAt
  })}\n`);
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`${JSON.stringify({ kind: "WATCH_ABORTED", reason: error instanceof Error ? error.message : "UNKNOWN" })}\n`);
    process.exitCode = 1;
  });
}
