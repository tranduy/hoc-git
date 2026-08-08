import { describe, expect, it } from "vitest";
import { Decimal } from "./convert.js";
import {
  convertStake,
  effectiveDecimal,
  type FeeModel,
  type FxModel
} from "./effective.js";

describe("effectiveDecimal", () => {
  it("leaves odds unchanged for no fee without returning the input instance", () => {
    const decimal = new Decimal("2.00");
    const effective = effectiveDecimal(decimal, { type: "NONE" });

    expect(effective.toString()).toBe("2");
    expect(effective).not.toBe(decimal);
  });

  it("reduces only profit for a profit fee", () => {
    expect(
      effectiveDecimal(new Decimal("2.00"), { type: "PROFIT", rate: "0.10" }).toString()
    ).toBe("1.9");
  });

  it("reduces the total payout for a payout fee", () => {
    expect(
      effectiveDecimal(new Decimal("2.00"), { type: "PAYOUT", rate: "0.10" }).toString()
    ).toBe("1.8");
  });

  it("rejects fee rates outside zero inclusive and one exclusive", () => {
    expect(() =>
      effectiveDecimal(new Decimal("2"), { type: "PROFIT", rate: "-0.01" })
    ).toThrow("fee rate must be at least 0 and less than 1");
    expect(() =>
      effectiveDecimal(new Decimal("2"), { type: "PAYOUT", rate: "1" })
    ).toThrow("fee rate must be at least 0 and less than 1");
  });

  it("rejects withdrawal-only fees because they cannot normalize opportunity odds", () => {
    const unsupported = { type: "WITHDRAWAL", rate: "0.10" } as unknown as FeeModel;

    expect(() => effectiveDecimal(new Decimal("2"), unsupported)).toThrow(
      "unsupported fee model"
    );
  });
});

describe("convertStake", () => {
  const fx: FxModel = {
    sourceCurrency: "HKD",
    baseCurrency: "USD",
    rate: "0.128",
    spreadRate: "0.02"
  };

  it("converts a stake after applying the FX spread", () => {
    expect(convertStake(new Decimal("100"), fx).toString()).toBe("12.544");
  });

  it("rejects non-positive FX rates and invalid spreads", () => {
    expect(() => convertStake(new Decimal("100"), { ...fx, rate: "0" })).toThrow(
      "FX rate must be greater than 0"
    );
    expect(() => convertStake(new Decimal("100"), { ...fx, spreadRate: "1" })).toThrow(
      "FX spread rate must be at least 0 and less than 1"
    );
  });
});
