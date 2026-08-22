const RETRY_DELAYS_MS = [0, 1_000, 5_000] as const;

export async function retrySabaBootstrapRefresh(
  refresh: () => Promise<void>,
  delay: (delayMs: number) => Promise<void> = (delayMs) =>
    new Promise<void>((resolve) => setTimeout(resolve, delayMs))
): Promise<void> {
  for (const delayMs of RETRY_DELAYS_MS) {
    await delay(delayMs);
    await refresh().catch(() => undefined);
  }
}
