function childExited(children) {
  return children.some((child) => child.exitCode !== null || child.signalCode !== null);
}

async function observeOnlyApiReady(fetchImpl, apiHealthUrl, requestTimeoutMs) {
  const response = await fetchImpl(apiHealthUrl, { signal: AbortSignal.timeout(requestTimeoutMs) });
  if (!response.ok) return false;
  const body = await response.json();
  return body?.status === "ok" && body?.mode === "OBSERVE" && body?.executionReady === false;
}

async function webRootReady(fetchImpl, webUrl, requestTimeoutMs) {
  const response = await fetchImpl(webUrl, { signal: AbortSignal.timeout(requestTimeoutMs) });
  return response.ok;
}

export async function waitForFixtureStack({
  children,
  apiHealthUrl,
  webUrl,
  fetchImpl = globalThis.fetch,
  timeoutMs = 30_000,
  pollIntervalMs = 200
}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (childExited(children)) {
      throw new Error("A fixture-stack child exited before API and web readiness.");
    }
    const requestTimeoutMs = Math.max(1, Math.min(1_000, deadline - Date.now()));
    try {
      const [apiReady, webReady] = await Promise.all([
        observeOnlyApiReady(fetchImpl, apiHealthUrl, requestTimeoutMs),
        webRootReady(fetchImpl, webUrl, requestTimeoutMs)
      ]);
      if (childExited(children)) {
        throw new Error("A fixture-stack child exited before API and web readiness.");
      }
      if (apiReady && webReady) return;
    } catch {
      if (childExited(children)) {
        throw new Error("A fixture-stack child exited before API and web readiness.");
      }
      // Startup races are expected; the bounded loop retries them.
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, pollIntervalMs));
  }
  throw new Error(`Fixture stack did not become ready at ${apiHealthUrl} and ${webUrl} within ${timeoutMs} ms.`);
}
