import { Decimal, type FeeModel } from "@tool-chenh/core";

const providers = ["SABA", "SBOBET", "APSPORT", "BTI"] as const;
type PreflightProvider = (typeof providers)[number];
type ProviderFees = Partial<Record<PreflightProvider, FeeModel>>;

const plainDecimal = /^(?:0|[1-9]\d*)(?:\.\d+)?$/;

function invalid(): never {
  throw new Error("PROVIDER_FEES_INVALID");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  return actual.length === expected.length && actual.every((key, index) => key === [...expected].sort()[index]);
}

function parseFee(value: unknown): FeeModel {
  if (!isRecord(value) || typeof value.type !== "string") invalid();

  if (value.type === "NONE") {
    if (!exactKeys(value, ["type"])) invalid();
    return { type: "NONE" };
  }

  if (value.type !== "PROFIT" && value.type !== "PAYOUT") invalid();
  if (!exactKeys(value, ["rate", "type"]) || typeof value.rate !== "string" || !plainDecimal.test(value.rate)) invalid();
  const rate = new Decimal(value.rate);
  if (!rate.isFinite() || rate.lt(0) || rate.gte(1)) invalid();
  return { type: value.type, rate: value.rate };
}

export function resolveProviderFees(env: Readonly<Record<string, string | undefined>>): ProviderFees {
  const raw = env.PROVIDER_FEES_JSON;
  if (raw === undefined) return {};

  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) invalid();
    const allowed = new Set<string>(providers);
    if (Object.keys(parsed).some((provider) => !allowed.has(provider))) invalid();

    const result: ProviderFees = {};
    for (const provider of providers) {
      if (Object.hasOwn(parsed, provider)) result[provider] = parseFee(parsed[provider]);
    }
    return result;
  } catch (error) {
    if (error instanceof Error && error.message === "PROVIDER_FEES_INVALID") throw error;
    return invalid();
  }
}
