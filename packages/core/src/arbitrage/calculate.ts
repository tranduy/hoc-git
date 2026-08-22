import { Decimal } from "../odds/convert.js";

const PLAIN_DECIMAL = /^[+-]?(?:0|[1-9]\d*)(?:\.\d+)?$/;

export interface ArbitrageResult {
  readonly inverseSum: Decimal;
  readonly theoreticalMargin: Decimal;
  readonly isArbitrage: boolean;
  readonly equalizedFractions: readonly Decimal[];
}

export class ArbitrageCalculationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ArbitrageCalculationError";
  }
}

export function calculateArbitrage(odds: readonly string[]): ArbitrageResult {
  if (odds.length < 2) {
    throw new ArbitrageCalculationError("at least two outcomes are required");
  }

  const validatedOdds = odds.map((odd, index) => {
    if (typeof odd !== "string" || !PLAIN_DECIMAL.test(odd)) {
      throw new ArbitrageCalculationError(`odds[${index}] must be a finite decimal greater than 1`);
    }

    const value = new Decimal(odd);
    if (!value.isFinite() || value.lte(1)) {
      throw new ArbitrageCalculationError(`odds[${index}] must be a finite decimal greater than 1`);
    }
    return value;
  });

  const inverseOdds = validatedOdds.map((odd) => new Decimal(1).div(odd));
  const inverseSum = inverseOdds.reduce((sum, inverse) => sum.plus(inverse), new Decimal(0));

  return {
    inverseSum,
    theoreticalMargin: new Decimal(1).div(inverseSum).minus(1),
    isArbitrage: inverseSum.lt(1),
    equalizedFractions: inverseOdds.map((inverse) => inverse.div(inverseSum))
  };
}
