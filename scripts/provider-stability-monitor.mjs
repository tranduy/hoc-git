import { appendFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Continuous stability monitor. Answers one question the acceptance sampler
 * cannot: over hours, does a provider hold, or does it flap?
 *
 * Read-only. It never claims a lease, never deploys and never touches a tab.
 *
 *   node scripts/provider-stability-monitor.mjs [durationMinutes] [intervalSeconds]
 */

const API_ORIGIN = process.env.TOOL_CHENH_API_ORIGIN ?? "http://127.0.0.1:4310";
const PROVIDERS = ["CMD", "IM", "SABA", "SBOBET", "APSPORT", "BTI"];
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const logPath = resolve(repositoryRoot, ".run", "realtime", "stability.jsonl");

export function classify(diagnostic, status) {
  const hop = (name) => diagnostic?.hops?.find((entry) => entry.hop === name)?.detail ?? {};
  const catalog = hop("HOP7_CATALOG");
  const semantic = hop("HOP8_SEMANTIC");
  return {
    firstFailingHop: diagnostic?.firstFailingHop ?? null,
    feedState: hop("HOP6_FEED").state ?? null,
    sessionState: status?.sessionState ?? null,
    snapshotState: catalog.snapshotState ?? null,
    events: catalog.events ?? 0,
    quoteChanges60s: semantic.quoteChanges60s ?? 0,
    usable: status?.sessionState === "ACTIVE" && catalog.snapshotState === "FRESH"
  };
}

export function updateHistory(history, sample) {
  const previous = history.get(sample.provider);
  const flapped = previous !== undefined && previous.usable !== sample.usable;
  const next = {
    usable: sample.usable,
    flaps: (previous?.flaps ?? 0) + (flapped ? 1 : 0),
    usableSamples: (previous?.usableSamples ?? 0) + (sample.usable ? 1 : 0),
    samples: (previous?.samples ?? 0) + 1,
    changingSamples: (previous?.changingSamples ?? 0) + (sample.quoteChanges60s > 0 ? 1 : 0)
  };
  history.set(sample.provider, next);
  return flapped;
}

export function summarize(history) {
  return [...history.entries()].map(([provider, entry]) => ({
    provider,
    upPercent: Math.round((entry.usableSamples / entry.samples) * 100),
    changingPercent: Math.round((entry.changingSamples / entry.samples) * 100),
    flaps: entry.flaps,
    samples: entry.samples
  }));
}

async function readJson(pathname) {
  const response = await fetch(new URL(pathname, API_ORIGIN), { headers: { accept: "application/json" } });
  if (!response.ok) throw new Error(`HTTP_${response.status}`);
  return response.json();
}

async function sampleOnce(history) {
  const [pipeline, sources] = await Promise.all([
    readJson("/api/diag/pipeline"),
    readJson("/api/catalog/sources")
  ]);
  const statusByProvider = new Map((sources.sources ?? []).map((entry) => [entry.provider, entry]));
  const atMs = Date.now();
  const rows = [];
  for (const provider of PROVIDERS) {
    const diagnostic = (pipeline.accounts ?? []).find((entry) =>
      entry.accountId === `catalog-source:${provider}:FOOTBALL`);
    const sample = { provider, atMs, ...classify(diagnostic, statusByProvider.get(provider)) };
    const flapped = updateHistory(history, sample);
    rows.push({ ...sample, flapped });
  }
  await appendFile(logPath, `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`, "utf8");
  return rows;
}

function render(rows, history) {
  const clock = new Date().toISOString().slice(11, 19);
  const line = rows.map((row) => {
    const mark = row.usable ? (row.quoteChanges60s > 0 ? "OK" : "up") : "--";
    return `${row.provider}:${mark}${row.flapped ? "!" : ""}`;
  }).join("  ");
  process.stdout.write(`${clock}  ${line}\n`);
  void history;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const durationMinutes = Number(process.argv[2] ?? 60);
  const intervalSeconds = Number(process.argv[3] ?? 15);
  if (!Number.isFinite(durationMinutes) || durationMinutes <= 0 ||
    !Number.isFinite(intervalSeconds) || intervalSeconds < 5) {
    process.stderr.write("usage: provider-stability-monitor.mjs [durationMinutes] [intervalSeconds>=5]\n");
    process.exitCode = 1;
  } else {
    await mkdir(dirname(logPath), { recursive: true });
    const history = new Map();
    const deadline = Date.now() + durationMinutes * 60_000;
    process.stdout.write(`monitoring ${PROVIDERS.length} books for ${durationMinutes}m, ` +
      `sampling every ${intervalSeconds}s -> ${logPath}\n`);
    while (Date.now() < deadline) {
      try { render(await sampleOnce(history), history); }
      catch (error) {
        process.stdout.write(`${new Date().toISOString().slice(11, 19)}  SAMPLE_FAILED ` +
          `${error instanceof Error ? error.message : "unknown"}\n`);
      }
      await new Promise((done) => setTimeout(done, intervalSeconds * 1_000));
    }
    process.stdout.write(`\nSUMMARY ${JSON.stringify(summarize(history))}\n`);
  }
}
