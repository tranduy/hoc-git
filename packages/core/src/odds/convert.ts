import type { OddsFormat } from "@tool-chenh/contracts";
import { Decimal as DecimalJs } from "decimal.js";

export type Decimal = DecimalJs;
export type DecimalValue = DecimalJs.Value;

export const Decimal = DecimalJs.clone({
  precision: 40,
  rounding: DecimalJs.ROUND_HALF_EVEN
});

export function toDecimal(raw: string, format: OddsFormat): Decimal {
  const value = new Decimal(raw.replace(/^\+/, ""));

  if (!value.isFinite()) {
    throw new Error("odds must be finite");
  }

  if (format === "DECIMAL") {
    if (value.lte(1)) {
      throw new Error("decimal odds must be greater than 1");
    }

    return value;
  }

  if (format === "HK") {
    if (value.lte(0)) {
      throw new Error("HK odds must be greater than 0");
    }

    return value.plus(1);
  }

  if (format === "MALAY") {
    if (value.eq(0) || value.abs().gt(1)) {
      throw new Error("Malay odds must be between -1 and 1 excluding 0");
    }
    return value.gt(0) ? value.plus(1) : new Decimal(1).div(value.abs()).plus(1);
  }

  if (format === "AMERICAN") {
    if (value.gte(100)) {
      return value.div(100).plus(1);
    }

    if (value.lte(-100)) {
      return new Decimal(100).div(value.abs()).plus(1);
    }

    throw new Error("American odds must be at least +100 or at most -100");
  }

  throw new Error("unsupported odds format");
}
