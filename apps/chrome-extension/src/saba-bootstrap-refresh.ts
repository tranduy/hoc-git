// The SABA odds UI is rendered in a delayed child context. Live observation
// on 2026-08-31 showed that its Socket.IO baseline was already available while
// the `Hôm Nay` control still appeared after the old six-second retry window.
// Keep the retries bounded below SourceTabRecovery's sixty-second deadline.
const RETRY_DELAYS_MS = [0, 15_000, 30_000] as const;

export async function retrySabaBootstrapRefresh(
  refresh: () => Promise<void>,
  isReady: () => boolean = () => false,
  delay: (delayMs: number) => Promise<void> = (delayMs) =>
    new Promise<void>((resolve) => setTimeout(resolve, delayMs)),
  isCurrent: () => boolean = () => true
): Promise<void> {
  for (const delayMs of RETRY_DELAYS_MS) {
    if (!isCurrent() || isReady()) return;
    await delay(delayMs);
    if (!isCurrent() || isReady()) return;
    await refresh().catch(() => undefined);
    if (isReady()) return;
  }
}
