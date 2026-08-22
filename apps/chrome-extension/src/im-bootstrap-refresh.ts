const RETRY_DELAYS_MS = [1_000, 4_000, 8_000] as const;

export async function retryImBootstrapRefresh(
  refresh: () => Promise<void>,
  delay: (delayMs: number) => Promise<void> = (delayMs) =>
    new Promise<void>((resolve) => setTimeout(resolve, delayMs))
): Promise<void> {
  for (const delayMs of RETRY_DELAYS_MS) {
    await delay(delayMs);
    await refresh().catch(() => undefined);
  }
}
