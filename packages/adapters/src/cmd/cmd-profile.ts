export interface NormalizedCmdProfile {
  readonly redactedLabel: string;
  readonly currency: string;
  readonly balance: string;
  readonly asOfMs: number;
  readonly source: "ACCOUNT_STORE_BETTING_CREDIT";
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function plainNonnegativeDecimal(value: unknown): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  if (typeof value === "number" && (!Number.isFinite(value) || value < 0)) return null;
  const input = String(value).trim();
  const ungrouped = input.includes(",")
    ? /^\d{1,3}(?:,\d{3})+(?:\.\d+)?$/u.test(input) ? input.replaceAll(",", "") : null
    : input;
  if (ungrouped === null || !/^(?:0|[1-9]\d*)(?:\.\d+)?$/u.test(ungrouped)) return null;
  if (!ungrouped.includes(".")) return ungrouped;
  const normalized = ungrouped.replace(/0+$/u, "").replace(/\.$/u, "");
  return normalized.length === 0 ? "0" : normalized;
}

function maskLabel(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const label = value.trim();
  if (label.length === 0) return null;
  if (label.length <= 4) return "•".repeat(label.length);
  return `••••${label.slice(-4)}`;
}

export function normalizeCmdAccountStore(raw: unknown, observedAtMs: number): NormalizedCmdProfile | null {
  const root = record(raw);
  const balanceState = record(root?.Bal);
  if (root === null || balanceState === null || !Number.isFinite(observedAtMs) || observedAtMs < 0) return null;

  const balance = plainNonnegativeDecimal(balanceState.BCredit);
  const rawCurrency = balanceState.Curr ?? root.Curr;
  const currency = typeof rawCurrency === "string" ? rawCurrency.trim().toUpperCase() : "";
  const label = [root.DisplayUserName, root.LicUserName, root.Name, root.Nick]
    .map(maskLabel).find((candidate): candidate is string => candidate !== null) ?? null;
  if (balance === null || !/^[A-Z]{3,8}$/u.test(currency) || label === null) return null;

  return {
    redactedLabel: label,
    currency,
    balance,
    asOfMs: observedAtMs,
    source: "ACCOUNT_STORE_BETTING_CREDIT"
  };
}
