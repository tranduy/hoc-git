const endpoint = process.env.CHROME_BRIDGE_SOURCES_URL ?? "http://127.0.0.1:4310/api/chrome-bridge/sources";

try {
  const response = await fetch(endpoint, { signal: AbortSignal.timeout(3_000) });
  if (!response.ok) throw new Error(`HTTP_${response.status}`);
  const value = await response.json();
  const sources = Array.isArray(value.sources) ? value.sources : [];
  for (const source of sources) {
    process.stdout.write(`${String(source.lobby)}\t${String(source.state)}\tseq=${String(source.lastSequence)}\tageMs=${Math.max(0, Date.now() - Number(source.lastAcceptedAtMs))}\n`);
  }
  if (sources.length === 0) process.stdout.write("NO_ATTACHED_SOURCES\n");
} catch (error) {
  process.stderr.write(`CHROME_BRIDGE_UNAVAILABLE\t${error instanceof Error ? error.message : "UNKNOWN"}\n`);
  process.exitCode = 1;
}
