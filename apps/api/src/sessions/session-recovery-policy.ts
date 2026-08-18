export type RecoverySignal =
  | { readonly kind: "AUTH_EXPIRED"; readonly status?: 401 | 403 }
  | { readonly kind: "LOGIN_PAGE" }
  | { readonly kind: "TOKEN_EXPIRED"; readonly expiredAtMs: number }
  | { readonly kind: "EMPTY_CATALOG" }
  | { readonly kind: "SCHEMA_ERROR" }
  | { readonly kind: "TIMEOUT" };

export function requiresAuthentication(signal: RecoverySignal, nowMs: number): boolean {
  switch (signal.kind) {
    case "AUTH_EXPIRED":
    case "LOGIN_PAGE":
      return true;
    case "TOKEN_EXPIRED":
      return signal.expiredAtMs <= nowMs;
    case "EMPTY_CATALOG":
    case "SCHEMA_ERROR":
    case "TIMEOUT":
      return false;
  }
}

const recoveryBackoffMs = [5_000, 15_000, 60_000, 300_000] as const;

export function recoveryDelayMs(consecutiveFailures: number, jitterUnit: number): number {
  const index = Math.min(Math.max(0, Math.floor(consecutiveFailures)), recoveryBackoffMs.length - 1);
  const base = recoveryBackoffMs[index]!;
  const boundedJitter = Math.max(0, Math.min(1, jitterUnit));
  return Math.round(base * (1 + boundedJitter * 0.2));
}
