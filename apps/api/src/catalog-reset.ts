import type { RefreshableProvider } from "./routes/maintenance.js";

/**
 * Order matters: the cheap restores (an already attached reader is simply told
 * to collect again) go first so the dashboard shows books coming back while
 * the ones that may need a replacement tab are still working.
 */
export const RESET_PROVIDERS: readonly RefreshableProvider[] =
  ["CMD", "SBOBET", "BTI", "APSPORT", "SABA", "IM"];

export interface ProviderResetOutcome {
  readonly provider: RefreshableProvider;
  readonly delivered: number | null;
  readonly failure: string | null;
}

export interface ProviderResetOptions {
  readonly refresh: (provider: RefreshableProvider) => Promise<number>;
  readonly providers?: readonly RefreshableProvider[];
  readonly staggerMs?: number;
  readonly sleep?: (delayMs: number) => Promise<void>;
  readonly onOutcome?: (outcome: ProviderResetOutcome) => void;
}

export function resetFailureCode(error: unknown): string {
  const raw = (error instanceof Error ? error.message : String(error)).replace(/\s+/gu, " ").trim();
  return raw === "" ? "UNKNOWN" : raw.slice(0, 80);
}

/**
 * Reset means "every book goes and collects again", not "relaunch the whole
 * browser side and wait for six new tabs". Each provider is driven on its own
 * targeted path and reports as soon as it has a fresh baseline, so one dead
 * book can no longer hold the other five hostage.
 */
export async function resetProviderSources(
  options: ProviderResetOptions
): Promise<readonly ProviderResetOutcome[]> {
  const providers = options.providers ?? RESET_PROVIDERS;
  const staggerMs = options.staggerMs ?? 1_500;
  const sleep = options.sleep ?? ((delayMs: number) =>
    new Promise<void>((resolve) => { setTimeout(resolve, delayMs); }));
  const report = (outcome: ProviderResetOutcome): ProviderResetOutcome => {
    try { options.onOutcome?.(outcome); }
    catch { /* journalling a result must never fail the reset itself */ }
    return outcome;
  };
  const running: Promise<ProviderResetOutcome>[] = [];
  for (const [index, provider] of providers.entries()) {
    // Six sportsbook bootstraps landing in the same tick saturate the browser.
    // Start them apart, but never wait for one to finish before the next.
    if (index > 0 && staggerMs > 0) await sleep(staggerMs);
    // Called synchronously so the stagger really is the only gap between two
    // provider bootstraps; a synchronous throw still becomes this book's failure.
    let attempt: Promise<number>;
    try { attempt = Promise.resolve(options.refresh(provider)); }
    catch (error) { attempt = Promise.reject(error instanceof Error ? error : new Error(String(error))); }
    running.push(attempt.then(
      (delivered) => report({ provider, delivered, failure: null }),
      (error: unknown) => report({ provider, delivered: null, failure: resetFailureCode(error) })
    ));
  }
  return Promise.all(running);
}

export function describeProviderReset(outcomes: readonly ProviderResetOutcome[]): string {
  if (outcomes.length === 0) return "Reset sàn: không có sàn nào đang gắn";
  const recovered = outcomes.filter((outcome) => outcome.failure === null).map((outcome) => outcome.provider);
  const failed = outcomes.filter((outcome) => outcome.failure !== null);
  const head = `Reset sàn: ${recovered.length}/${outcomes.length} sàn đã lấy kèo lại`;
  if (failed.length === 0) return `${head} (${recovered.join(", ")})`;
  const detail = failed.map((outcome) => `${outcome.provider}(${outcome.failure ?? "UNKNOWN"})`).join(", ");
  return recovered.length === 0
    ? `${head}; chưa lấy lại được: ${detail}`
    : `${head} (${recovered.join(", ")}); chưa lấy lại được: ${detail}`;
}

/**
 * A reset that brought even one book back is a partial success, not a failure:
 * reporting FAILED would hide the five feeds that did come back.
 */
export function providerResetFailure(outcomes: readonly ProviderResetOutcome[]): Error | null {
  if (outcomes.length === 0) return new Error("CHROME_BRIDGE_NO_ATTACHED_SOURCE");
  if (outcomes.some((outcome) => outcome.failure === null)) return null;
  return new Error(`CHROME_BRIDGE_RESET_INCOMPLETE:${outcomes
    .map((outcome) => `${outcome.provider}=${outcome.failure ?? "UNKNOWN"}`).join(";")}`);
}
