export interface BtiStakeStepEvidence { readonly key: string; readonly value: string }

const explicitStepKeys = new Set(["step", "stakestep", "amountstep", "increment"]);

export function exactBtiStakeStep(evidence: readonly BtiStakeStepEvidence[]): string | null {
  const candidates = new Set(evidence.flatMap(({ key, value }) => {
    const normalized = value.trim();
    const normalizedKey = key.replace(/[-_]/gu, "").toLocaleLowerCase("en");
    if (!explicitStepKeys.has(normalizedKey) || !/^(?:0|[1-9]\d*)(?:\.\d+)?$/u.test(normalized) || Number(normalized) <= 0) return [];
    return [normalized];
  }));
  return candidates.size === 1 ? [...candidates][0]! : null;
}
