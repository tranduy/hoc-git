import { Decimal, type DecimalValue } from "./convert.js";

export type FeeModel =
  | { type: "NONE" }
  | { type: "PROFIT"; rate: DecimalValue }
  | { type: "PAYOUT"; rate: DecimalValue };

export interface FxModel {
  sourceCurrency: string;
  baseCurrency: string;
  rate: DecimalValue;
  spreadRate: DecimalValue;
}

const one = new Decimal("1");

function validatedRate(rate: DecimalValue, description: string): Decimal {
  const value = new Decimal(rate);

  if (!value.isFinite() || value.lt(0) || value.gte(one)) {
    throw new Error(`${description} must be at least 0 and less than 1`);
  }

  return value;
}

export function effectiveDecimal(decimal: Decimal, fee: FeeModel): Decimal {
  if (fee.type === "NONE") {
    return new Decimal(decimal);
  }

  if (fee.type === "PROFIT") {
    const rate = validatedRate(fee.rate, "fee rate");
    return new Decimal(decimal).minus(one).times(one.minus(rate)).plus(one);
  }

  if (fee.type === "PAYOUT") {
    const rate = validatedRate(fee.rate, "fee rate");
    return new Decimal(decimal).times(one.minus(rate));
  }

  throw new Error("unsupported fee model");
}

export function convertStake(amount: Decimal, fx: FxModel): Decimal {
  const rate = new Decimal(fx.rate);

  if (!rate.isFinite() || rate.lte(0)) {
    throw new Error("FX rate must be greater than 0");
  }

  const spreadRate = validatedRate(fx.spreadRate, "FX spread rate");
  return new Decimal(amount).times(rate).times(one.minus(spreadRate));
}
