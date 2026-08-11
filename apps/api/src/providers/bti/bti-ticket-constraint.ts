export interface BtiTicketConstraintSnapshot {
  readonly providerSelectionId: string;
  readonly currency: "VND";
  readonly minStake: string;
  readonly maxStake: string;
  readonly stakeStep: string;
  readonly balance: string;
  readonly observedAtMs: number;
}

export interface BtiTicketConstraintEvidence {
  readonly providerSelectionId: string;
  readonly selectionMatched: boolean;
  readonly limitText: string;
  readonly stakeStepText: string;
  readonly balanceText: string;
  readonly currencyCode: string;
  readonly observedAtMs: number;
}

function kToVnd(value: string): string | null {
  const normalized = value.trim().replace(/,/gu, "");
  const match = /^(0|[1-9]\d*)(?:\.(\d{1,3}))?$/u.exec(normalized);
  if (match === null) return null;
  const whole = match[1] ?? "0";
  const fraction = (match[2] ?? "").padEnd(3, "0");
  return `${whole}${fraction}`.replace(/^0+(?=\d)/u, "");
}

export function parseBtiTicketConstraint(evidence: BtiTicketConstraintEvidence): BtiTicketConstraintSnapshot | null {
  if (!evidence.selectionMatched || evidence.currencyCode !== "VND" ||
    !Number.isFinite(evidence.observedAtMs) || evidence.observedAtMs < 0) return null;
  const limits = /Tối\s*thiểu\s*-\s*Tối\s*đa\s*([\d,.]+)\s*-\s*([\d,.]+)/iu.exec(evidence.limitText);
  if (limits === null) return null;
  const minStake = kToVnd(limits[1] ?? "");
  const maxStake = kToVnd(limits[2] ?? "");
  const stakeStep = kToVnd(evidence.stakeStepText);
  const balanceMatch = /^\s*([\d,.]+)\s*K\s*$/iu.exec(evidence.balanceText);
  const balance = kToVnd(balanceMatch?.[1] ?? "");
  if (minStake === null || maxStake === null || stakeStep === null || balance === null ||
    BigInt(minStake) <= 0n || BigInt(stakeStep) <= 0n || BigInt(maxStake) < BigInt(minStake)) return null;
  return { providerSelectionId: evidence.providerSelectionId, currency: "VND", minStake, maxStake,
    stakeStep, balance, observedAtMs: evidence.observedAtMs };
}
