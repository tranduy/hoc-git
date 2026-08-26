const API_ORIGIN = process.env.TOOL_CHENH_API_ORIGIN ?? "http://127.0.0.1:4310";
const accountIds = Object.freeze({
  CMD: "catalog-source:CMD:FOOTBALL",
  SABA: "catalog-source:SABA:FOOTBALL",
  SBOBET: "catalog-source:SBOBET:FOOTBALL",
  KSPORT: "catalog-source:SBOBET:FOOTBALL",
  APSPORT: "catalog-source:APSPORT:FOOTBALL",
  TSPORT: "catalog-source:APSPORT:FOOTBALL",
  IM: "catalog-source:IM:FOOTBALL",
  BTI: "catalog-source:BTI:FOOTBALL"
});

function hop(diagnostic, name) {
  return diagnostic.hops.find((item) => item.hop === name)?.detail ?? {};
}

function seconds(value) {
  return typeof value === "number" ? `${(value / 1_000).toFixed(1)}s` : "n/a";
}

function summary(diagnostic) {
  const feed = hop(diagnostic, "HOP6_FEED");
  const catalog = hop(diagnostic, "HOP7_CATALOG");
  const semantic = hop(diagnostic, "HOP8_SEMANTIC");
  const baseline = `${seconds(feed.baselineAgeMs)}${typeof feed.maxBaselineAgeMs === "number" ? `>${seconds(feed.maxBaselineAgeMs)}` : ""}`;
  const evidence = `${seconds(feed.evidenceAgeMs)}${typeof feed.expectedEvidenceCadenceMs === "number" ? `>${seconds(feed.expectedEvidenceCadenceMs)}` : ""}`;
  const state = `${feed.state ?? "STARTING"}/${feed.reason ?? "OK"}`;
  return `${String(diagnostic.lobby).padEnd(8)} firstFailingHop=${String(diagnostic.firstFailingHop ?? "null").padEnd(16)} ` +
    `${state.padEnd(34)} baseline=${baseline.padEnd(13)} evid=${evidence.padEnd(13)} ` +
    `quotes=${catalog.quotes ?? 0} Δ60s=${semantic.quoteChanges60s ?? 0} forcedUnlocks=${hop(diagnostic, "HOP4_ADAPTER").forcedUnlocks ?? 0}`;
}

async function readJson(pathname) {
  const response = await fetch(new URL(pathname, API_ORIGIN), { headers: { accept: "application/json" } });
  if (!response.ok) throw new Error(`HTTP_${response.status}`);
  return response.json();
}

async function runOnce(provider) {
  if (provider === undefined) {
    const body = await readJson("/api/diag/pipeline");
    for (const diagnostic of body.accounts) process.stdout.write(`${summary(diagnostic)}\n`);
    return;
  }
  const accountId = accountIds[provider];
  if (accountId === undefined) throw new Error(`UNKNOWN_PROVIDER_${provider}`);
  const diagnostic = await readJson(`/api/diag/pipeline/${encodeURIComponent(accountId)}`);
  process.stdout.write(`${JSON.stringify(diagnostic, null, 2)}\n`);
}

const provider = process.argv[2]?.trim().toUpperCase();
const durationSeconds = process.argv[3] === undefined ? 0 : Number(process.argv[3]);
if (!Number.isFinite(durationSeconds) || durationSeconds < 0) {
  process.stderr.write("duration must be a non-negative number of seconds\n");
  process.exitCode = 1;
} else {
  try {
    if (durationSeconds === 0) await runOnce(provider);
    else {
      const deadline = Date.now() + durationSeconds * 1_000;
      do {
        await runOnce(provider);
        if (Date.now() >= deadline) break;
        await new Promise((resolve) => setTimeout(resolve, Math.min(5_000, deadline - Date.now())));
      } while (Date.now() <= deadline);
    }
  } catch (error) {
    const code = error instanceof Error ? error.message : "DIAGNOSTIC_FAILED";
    process.stderr.write(`diag-pipeline failed: ${code}\n`);
    process.exitCode = 1;
  }
}
