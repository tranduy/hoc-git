import { calculateArbitrage } from "./calculate.js";
import { Decimal } from "../odds/convert.js";

const MAX_CANDIDATE_COMBINATIONS = 50_000;
const PLAIN_DECIMAL = /^[+-]?(?:0|[1-9]\d*)(?:\.\d+)?$/;

export interface StakeConstraint {
  readonly minStake: string;
  readonly maxStake: string;
  readonly stakeStep: string;
  readonly balance: string;
}

export interface OptimizeStakesInput {
  readonly odds: readonly string[];
  readonly stakeToBaseRates?: readonly string[];
  readonly constraints: readonly StakeConstraint[];
  readonly bankroll: string;
  readonly minimumWorstCaseProfit?: string;
  readonly minimumRoi?: string;
  readonly searchRadiusSteps?: number;
}

export interface StakePlan {
  readonly stakes: readonly string[];
  readonly payouts: readonly string[];
  readonly totalStake: string;
  readonly worstCasePayout: string;
  readonly worstCaseProfit: string;
  readonly roi: string;
  readonly executable: true;
}

export class StakeOptimizationValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StakeOptimizationValidationError";
  }
}

export class StakeSearchSpaceError extends Error {
  constructor(combinations: number) {
    super(
      `stake candidate search would evaluate ${combinations} combinations; maximum is ${MAX_CANDIDATE_COMBINATIONS}`
    );
    this.name = "StakeSearchSpaceError";
  }
}

interface ValidatedConstraint {
  readonly minStake: Decimal;
  readonly maxStake: Decimal;
  readonly stakeStep: Decimal;
  readonly balance: Decimal;
  readonly lowerIndex: Decimal;
  readonly upperIndex: Decimal;
}

interface CandidatePlan {
  readonly stakes: readonly Decimal[];
  readonly payouts: readonly Decimal[];
  readonly totalStake: Decimal;
  readonly worstCasePayout: Decimal;
  readonly worstCaseProfit: Decimal;
  readonly roi: Decimal;
}

function decimalInput(value: unknown, field: string, allowZero: boolean): Decimal {
  if (typeof value !== "string" || !PLAIN_DECIMAL.test(value)) {
    throw new StakeOptimizationValidationError(`${field} must be a plain decimal string`);
  }

  const decimal = new Decimal(value);
  if (!decimal.isFinite() || (allowZero ? decimal.lt(0) : decimal.lte(0))) {
    throw new StakeOptimizationValidationError(
      `${field} must be ${allowZero ? "non-negative" : "positive"}`
    );
  }
  return decimal;
}

function plainDecimal(value: Decimal): string {
  if (value.isZero()) return "0";
  return value.toFixed(value.decimalPlaces());
}

function comparePlans(left: CandidatePlan, right: CandidatePlan): number {
  const profitComparison = left.worstCaseProfit.comparedTo(right.worstCaseProfit);
  if (profitComparison !== 0) return profitComparison;

  const roiComparison = left.roi.comparedTo(right.roi);
  if (roiComparison !== 0) return roiComparison;

  return right.totalStake.comparedTo(left.totalStake);
}

function constrainedContinuousCenter(
  payoutCoefficients: readonly Decimal[],
  baseRates: readonly Decimal[],
  constraints: readonly ValidatedConstraint[],
  bankroll: Decimal
): Decimal[] | null {
  const lowerStakes = constraints.map((constraint) =>
    constraint.lowerIndex.times(constraint.stakeStep)
  );
  const upperStakes = constraints.map((constraint) =>
    constraint.upperIndex.times(constraint.stakeStep)
  );
  const minimumTotal = lowerStakes.reduce(
    (sum, stake, index) => sum.plus(stake.times(baseRates[index]!)),
    new Decimal(0)
  );
  if (minimumTotal.gt(bankroll)) return null;

  const lowerPayouts = lowerStakes.map((stake, index) => stake.times(payoutCoefficients[index]!));
  const upperPayouts = upperStakes.map((stake, index) => stake.times(payoutCoefficients[index]!));
  const payoutCap = Decimal.min(...upperPayouts);
  let currentPayout = Decimal.min(...lowerPayouts);
  let remaining = bankroll.minus(minimumTotal);

  const eventPayouts = new Map<string, Decimal>();
  for (const payout of [...lowerPayouts, payoutCap]) {
    if (payout.gt(currentPayout) && payout.lte(payoutCap)) {
      eventPayouts.set(payout.toString(), payout);
    }
  }

  for (const targetPayout of [...eventPayouts.values()].sort((left, right) =>
    left.comparedTo(right)
  )) {
    if (remaining.eq(0)) break;
    const inverseOdds = lowerPayouts.reduce(
      (sum, lowerPayout, index) =>
        lowerPayout.lte(currentPayout)
          ? sum.plus(baseRates[index]!.div(payoutCoefficients[index]!))
          : sum,
      new Decimal(0)
    );
    const costToTarget = targetPayout.minus(currentPayout).times(inverseOdds);
    if (costToTarget.gt(remaining)) {
      currentPayout = currentPayout.plus(remaining.div(inverseOdds));
      remaining = new Decimal(0);
      break;
    }

    currentPayout = targetPayout;
    remaining = remaining.minus(costToTarget);
  }

  return lowerStakes.map((lowerStake, index) =>
    Decimal.max(lowerStake, currentPayout.div(payoutCoefficients[index]!))
  );
}

function evaluateCandidate(
  stakes: readonly Decimal[],
  odds: readonly Decimal[],
  baseRates: readonly Decimal[],
  bankroll: Decimal,
  minimumWorstCaseProfit: Decimal,
  minimumRoi: Decimal
): CandidatePlan | null {
  const totalStake = stakes.reduce(
    (sum, stake, index) => sum.plus(stake.times(baseRates[index]!)),
    new Decimal(0)
  );
  if (totalStake.gt(bankroll)) return null;

  const payouts = stakes.map((stake, index) =>
    stake.times(odds[index]!).times(baseRates[index]!)
  );
  const worstCasePayout = Decimal.min(...payouts);
  const worstCaseProfit = worstCasePayout.minus(totalStake);
  const roi = worstCaseProfit.div(totalStake);

  if (
    !worstCaseProfit.gt(0) ||
    worstCaseProfit.lt(minimumWorstCaseProfit) ||
    roi.lt(minimumRoi)
  ) {
    return null;
  }

  return { stakes: [...stakes], payouts, totalStake, worstCasePayout, worstCaseProfit, roi };
}

function candidateStakes(
  index: number,
  odds: readonly Decimal[],
  baseRates: readonly Decimal[],
  constraints: readonly ValidatedConstraint[],
  continuousTarget: Decimal,
  radius: number
): Decimal[] {
  const constraint = constraints[index]!;
  if (constraint.lowerIndex.gt(constraint.upperIndex)) return [];

  const indices = new Map<string, Decimal>();
  const addIndex = (candidateIndex: Decimal): void => {
    if (candidateIndex.lt(constraint.lowerIndex) || candidateIndex.gt(constraint.upperIndex)) return;
    indices.set(candidateIndex.toFixed(0), candidateIndex);
    if (indices.size > MAX_CANDIDATE_COMBINATIONS) {
      throw new StakeSearchSpaceError(indices.size);
    }
  };
  const addFloorCeiling = (target: Decimal): void => {
    const quotient = target.div(constraint.stakeStep);
    addIndex(quotient.floor());
    addIndex(quotient.ceil());
  };

  const targetIndex = continuousTarget.div(constraint.stakeStep);
  const floorIndex = targetIndex.floor();
  const ceilingIndex = targetIndex.ceil();
  for (let offset = -radius; offset <= radius; offset += 1) {
    addIndex(floorIndex.plus(offset));
    addIndex(ceilingIndex.plus(offset));
  }

  addIndex(constraint.lowerIndex);
  addIndex(constraint.upperIndex);

  for (let otherIndex = 0; otherIndex < constraints.length; otherIndex += 1) {
    if (otherIndex === index) continue;
    const other = constraints[otherIndex]!;
    if (other.lowerIndex.gt(other.upperIndex)) continue;

    for (const boundaryIndex of [other.lowerIndex, other.upperIndex]) {
      const boundaryStake = boundaryIndex.times(other.stakeStep);
      const equalPayoutStake = boundaryStake
        .times(odds[otherIndex]!)
        .times(baseRates[otherIndex]!)
        .div(odds[index]!.times(baseRates[index]!));
      addFloorCeiling(equalPayoutStake);
    }
  }

  return [...indices.values()]
    .sort((left, right) => left.comparedTo(right))
    .map((candidateIndex) => candidateIndex.times(constraint.stakeStep));
}

export function optimizeStakes(input: OptimizeStakesInput): StakePlan | null {
  if (input.odds.length < 2 || input.odds.length !== input.constraints.length) {
    throw new StakeOptimizationValidationError(
      "odds and constraints must have the same length of at least two"
    );
  }

  const bankroll = decimalInput(input.bankroll, "bankroll", false);
  const minimumWorstCaseProfit = decimalInput(
    input.minimumWorstCaseProfit ?? "0",
    "minimumWorstCaseProfit",
    true
  );
  const minimumRoi = decimalInput(input.minimumRoi ?? "0", "minimumRoi", true);
  const radius = input.searchRadiusSteps ?? 2;
  if (!Number.isSafeInteger(radius) || radius < 0) {
    throw new StakeOptimizationValidationError(
      "searchRadiusSteps must be a non-negative safe integer"
    );
  }
  const estimatedNeighborhoodWork = input.odds.length * (4 * radius + 2);
  if (estimatedNeighborhoodWork > MAX_CANDIDATE_COMBINATIONS) {
    throw new StakeSearchSpaceError(estimatedNeighborhoodWork);
  }

  const odds = input.odds.map((odd, index) => {
    const value = decimalInput(odd, `odds[${index}]`, false);
    if (value.lte(1)) {
      throw new StakeOptimizationValidationError(`odds[${index}] must be greater than 1`);
    }
    return value;
  });
  const rawBaseRates = input.stakeToBaseRates ?? input.odds.map(() => "1");
  if (rawBaseRates.length !== input.odds.length) {
    throw new StakeOptimizationValidationError(
      "stakeToBaseRates must have the same length as odds"
    );
  }
  const baseRates = rawBaseRates.map((rate, index) =>
    decimalInput(rate, `stakeToBaseRates[${index}]`, false)
  );

  const constraints = input.constraints.map((raw, index): ValidatedConstraint => {
    const minStake = decimalInput(raw.minStake, `constraints[${index}].minStake`, false);
    const maxStake = decimalInput(raw.maxStake, `constraints[${index}].maxStake`, false);
    const stakeStep = decimalInput(raw.stakeStep, `constraints[${index}].stakeStep`, false);
    const balance = decimalInput(raw.balance, `constraints[${index}].balance`, false);
    if (maxStake.lt(minStake)) {
      throw new StakeOptimizationValidationError(
        `constraints[${index}].maxStake must be greater than or equal to minStake`
      );
    }

    const upperStake = Decimal.min(maxStake, balance);
    return {
      minStake,
      maxStake,
      stakeStep,
      balance,
      lowerIndex: minStake.div(stakeStep).ceil(),
      upperIndex: upperStake.div(stakeStep).floor()
    };
  });

  const arbitrage = calculateArbitrage(input.odds);
  if (!arbitrage.isArbitrage) return null;

  const payoutCoefficients = odds.map((odd, index) => odd.times(baseRates[index]!));
  const continuousCenter = constrainedContinuousCenter(
    payoutCoefficients,
    baseRates,
    constraints,
    bankroll
  );
  if (continuousCenter === null) return null;

  const candidates = constraints.map((_, index) =>
    candidateStakes(
      index,
      odds,
      baseRates,
      constraints,
      continuousCenter[index]!,
      radius
    )
  );
  if (candidates.some((candidateSet) => candidateSet.length === 0)) return null;

  let combinations = 1;
  for (const candidateSet of candidates) {
    combinations *= candidateSet.length;
    if (combinations > MAX_CANDIDATE_COMBINATIONS) {
      throw new StakeSearchSpaceError(combinations);
    }
  }

  let best: CandidatePlan | null = null;
  const selected: Decimal[] = [];
  const search = (index: number): void => {
    if (index === candidates.length) {
      const plan = evaluateCandidate(
        selected,
        odds,
        baseRates,
        bankroll,
        minimumWorstCaseProfit,
        minimumRoi
      );
      if (plan !== null && (best === null || comparePlans(plan, best) > 0)) best = plan;
      return;
    }

    for (const stake of candidates[index]!) {
      selected.push(stake);
      search(index + 1);
      selected.pop();
    }
  };
  search(0);

  if (best === null) return null;
  const selectedPlan: CandidatePlan = best;
  return {
    stakes: selectedPlan.stakes.map(plainDecimal),
    payouts: selectedPlan.payouts.map(plainDecimal),
    totalStake: plainDecimal(selectedPlan.totalStake),
    worstCasePayout: plainDecimal(selectedPlan.worstCasePayout),
    worstCaseProfit: plainDecimal(selectedPlan.worstCaseProfit),
    roi: plainDecimal(selectedPlan.roi),
    executable: true
  };
}
