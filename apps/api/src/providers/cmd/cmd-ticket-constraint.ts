import type { ExactCmdTicketEvidence } from "../browser-protocol-inspector.js";

export interface CmdTicketConstraintSnapshot {
  readonly providerSelectionId: string;
  readonly rawOdds: string;
  readonly currency: string;
  readonly minStake: string;
  readonly maxStake: string;
  readonly stakeStep: string;
  readonly balance: string;
  readonly observedAtMs: number;
}

function amount(value: string): string | null {
  const trimmed = value.trim();
  const ungrouped = trimmed.includes(",")
    ? /^\d{1,3}(?:,\d{3})*$/u.test(trimmed) ? trimmed.replaceAll(",", "") : null
    : /^\d+$/u.test(trimmed) ? trimmed : null;
  if (ungrouped === null) return null;
  return ungrouped.replace(/^0+(?=\d)/u, "");
}

export function parseCmdTicketConstraint(input: {
  readonly evidence: ExactCmdTicketEvidence;
  readonly providerSelectionId: string;
  readonly currency: string;
  readonly balance: string;
  readonly observedAtMs: number;
}): CmdTicketConstraintSnapshot | null {
  if (!input.evidence.matched || input.evidence.displayedOdds === null ||
    input.providerSelectionId.trim().length === 0 || !/^[A-Z]{3,8}$/u.test(input.currency) ||
    !/^(?:0|[1-9]\d*)(?:\.\d+)?$/u.test(input.balance) ||
    !Number.isFinite(input.observedAtMs) || input.observedAtMs < 0) return null;
  const ranges = input.evidence.inputs.flatMap((field) => {
    const match = field.placeholder?.match(/^\s*([\d,]+)\s*(?:-|~|–|—)\s*([\d,]+)\s*(?:K|VND|UUS|INH)?\s*$/iu);
    if (match === undefined || match === null || match[1] === undefined || match[2] === undefined) return [];
    const minStake = amount(match[1]); const maxStake = amount(match[2]);
    return minStake === null || maxStake === null ? [] : [{ minStake, maxStake }];
  });
  const unique = [...new Map(ranges.map((range) => [`${range.minStake}:${range.maxStake}`, range])).values()];
  if (unique.length !== 1) return null;
  const range = unique[0]!;
  if (BigInt(range.minStake) <= 0n || BigInt(range.maxStake) < BigInt(range.minStake)) return null;
  return { providerSelectionId: input.providerSelectionId, rawOdds: input.evidence.displayedOdds,
    currency: input.currency, minStake: range.minStake, maxStake: range.maxStake,
    // The ticket accepts native whole units and exposes integer bounds. A step
    // of one native unit is conservative; no fractional stake is ever issued.
    stakeStep: "1", balance: input.balance, observedAtMs: input.observedAtMs };
}
