export interface SbobetTicketConstraintSnapshot {
  readonly providerSelectionId: string; readonly currency: "VND"; readonly minStake: string;
  readonly maxStake: string; readonly stakeStep: string; readonly balance: string; readonly observedAtMs: number;
}
export interface SbobetTicketConstraintEvidence {
  readonly providerSelectionId: string; readonly selectionMatched: boolean; readonly limitText: string;
  readonly stakeStepText: string; readonly balanceText: string; readonly observedAtMs: number;
}
function kToVnd(value: string): string | null {
  const normalized = value.trim().replace(/,/gu, "");
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,3})?$/u.test(normalized)) return null;
  const [whole = "0", fraction = ""] = normalized.split(".");
  return `${whole}${fraction.padEnd(3, "0")}`.replace(/^0+(?=\d)/u, "");
}
export function parseSbobetTicketConstraint(evidence: SbobetTicketConstraintEvidence): SbobetTicketConstraintSnapshot | null {
  if (!evidence.selectionMatched || !Number.isFinite(evidence.observedAtMs) || evidence.observedAtMs < 0) return null;
  const min = /M\u1ee9c\s*c\u01b0\u1ee3c\s*t\u1ed1i\s*thi\u1ec3u\s*([\d,.]+)\s*K/iu.exec(evidence.limitText)?.[1];
  const max = /M\u1ee9c\s*c\u01b0\u1ee3c\s*t\u1ed1i\s*\u0111a\s*([\d,.]+)\s*K/iu.exec(evidence.limitText)?.[1];
  const balance = /([\d,.]+)\s*K/iu.exec(evidence.balanceText)?.[1];
  if (min === undefined || max === undefined || balance === undefined) return null;
  const minStake = kToVnd(min); const maxStake = kToVnd(max);
  const stakeStep = kToVnd(evidence.stakeStepText); const normalizedBalance = kToVnd(balance);
  if (minStake === null || maxStake === null || stakeStep === null || normalizedBalance === null ||
    BigInt(minStake) <= 0n || BigInt(stakeStep) <= 0n || BigInt(maxStake) < BigInt(minStake)) return null;
  return { providerSelectionId: evidence.providerSelectionId, currency: "VND", minStake, maxStake, stakeStep,
    balance: normalizedBalance, observedAtMs: evidence.observedAtMs };
}
