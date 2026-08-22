export interface ApsportTicketConstraintSnapshot {
  readonly providerSelectionId: string;
  readonly currency: "VND";
  readonly minStake: string;
  readonly maxStake: string;
  readonly stakeStep: string;
  readonly balance: string;
  readonly observedAtMs: number;
}

export interface ApsportTicketConstraintEvidence {
  readonly providerSelectionId: string;
  readonly selectionMatched: boolean;
  readonly limitText: string;
  readonly stakeStepText: string;
  readonly balanceText: string;
  readonly observedAtMs: number;
}

function kToVnd(value: string): string | null {
  const normalized = value.trim().replace(/,/gu, "");
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,3})?$/u.test(normalized)) return null;
  const [whole = "0", fraction = ""] = normalized.split(".");
  return `${whole}${fraction.padEnd(3, "0")}`.replace(/^0+(?=\d)/u, "");
}

export function parseApsportTicketConstraint(evidence: ApsportTicketConstraintEvidence): ApsportTicketConstraintSnapshot | null {
  if (!evidence.selectionMatched || !Number.isFinite(evidence.observedAtMs) || evidence.observedAtMs < 0) return null;
  const limits = /(?:Tối\s*thiểu\s*-\s*Tối\s*đa\s*)?([\d,.]+)\s*-\s*([\d,.]+)\s*K\b/iu.exec(evidence.limitText);
  const balance = /([\d,.]+)\s*K\b/iu.exec(evidence.balanceText)?.[1];
  if (limits === null || balance === undefined) return null;
  const minStake = kToVnd(limits[1] ?? "");
  const maxStake = kToVnd(limits[2] ?? "");
  const stakeStep = kToVnd(evidence.stakeStepText);
  const normalizedBalance = kToVnd(balance);
  if ([minStake, maxStake, stakeStep, normalizedBalance].some((value) => value === null) ||
    BigInt(minStake!) <= 0n || BigInt(stakeStep!) <= 0n || BigInt(maxStake!) < BigInt(minStake!)) return null;
  return { providerSelectionId: evidence.providerSelectionId, currency: "VND", minStake: minStake!, maxStake: maxStake!,
    stakeStep: stakeStep!, balance: normalizedBalance!, observedAtMs: evidence.observedAtMs };
}
