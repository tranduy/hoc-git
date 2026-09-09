import { describe, expect, it } from "vitest";
import { conditionalRoi } from "./conditional-roi.js";
import { capturedRefundExample } from "./conditional-roi.test-fixtures.js";

describe("conditional ROI presentation", () => {
  it.each(["handicap", "total"] as const)("recognizes the captured %s profit with a common full refund", kind => {
    const { row, plan } = capturedRefundExample(kind);
    expect(plan.worstCaseProfit).toBe("0");
    expect(plan.roi).toBe("0");
    expect(conditionalRoi(row, plan)).toEqual(kind === "handicap"
      ? { minimumProfit: "11173", roiPercent: "1.23618789879036585541259555202488971894" }
      : { minimumProfit: "2659.0909090909090909090909090909090907", roiPercent: "0.2821795646041671892214159336429430025999" });
  });

  it("does not relabel exact Lausanne/Servette break-even", () => {
    const { row, plan } = capturedRefundExample("break-even");
    expect(Object.values(plan.profitsBySelection)).toEqual(["0", "0"]);
    expect(conditionalRoi(row, plan)).toBeNull();
  });

  it.each(["0", "-0.000000000001"])("rejects a non-refund profit of %s even if the plan header says zero", profit => {
    const { row, plan } = capturedRefundExample("handicap");
    expect(conditionalRoi(row, { ...plan, settlementScenarios: plan.settlementScenarios!.map(s =>
      s.kind === "FIRST_WINS" ? { ...s, profit } : s) })).toBeNull();
  });

  it("does not mistake a zero split/partial refund for both stakes being refunded", () => {
    const { row, plan } = capturedRefundExample("total");
    expect(conditionalRoi({ ...row, line: "1.25" }, { ...plan, settlementScenarios: plan.settlementScenarios!.map(s =>
      s.kind === "PUSH" ? { kind: "SPLIT", profit: "0" } : s) })).toBeNull();
  });

  it("matches scenario identities independently of order", () => {
    const { row, plan } = capturedRefundExample("handicap");
    expect(conditionalRoi(row, { ...plan, settlementScenarios: [...plan.settlementScenarios!].reverse() }))
      .toEqual(conditionalRoi(row, plan));
    expect(conditionalRoi(row, plan)).not.toBeNull();
  });

  it.each(["missing", "duplicate", "extra", "forged-push"] as const)("rejects %s settlement evidence", mode => {
    const { row, plan } = capturedRefundExample("handicap");
    const scenarios = [...plan.settlementScenarios!];
    if (mode === "missing") scenarios.pop();
    if (mode === "duplicate") scenarios[1] = scenarios[0]!;
    if (mode === "extra") scenarios.push({ kind: "SPLIT", profit: "100" });
    expect(conditionalRoi(mode === "forged-push" ? { ...row, line: "0.5" } : row,
      { ...plan, settlementScenarios: scenarios })).toBeNull();
  });

  it.each(["0", "NaN", "Infinity", "903826"])("rejects invalid or inconsistent total stake %s", totalStake => {
    const { row, plan } = capturedRefundExample("handicap");
    expect(conditionalRoi(row, { ...plan, totalStake })).toBeNull();
  });

  it.each(["one-leg", "same-provider", "same-outcome", "negative-stake"] as const)("rejects %s leg evidence", mode => {
    const { row, plan } = capturedRefundExample("handicap");
    const legs = [...plan.legs];
    if (mode === "one-leg") legs.pop();
    if (mode === "same-provider") legs[1] = { ...legs[1]!, provider: legs[0]!.provider };
    if (mode === "same-outcome") legs[1] = { ...legs[1]!, selection: legs[0]!.selection };
    if (mode === "negative-stake") legs[1] = { ...legs[1]!, stake: "-1" };
    expect(conditionalRoi(row, { ...plan, legs })).toBeNull();
  });

  it.each(["NaN", "Infinity", "invalid"])("rejects nonfinite scenario profit %s", profit => {
    const { row, plan } = capturedRefundExample("handicap");
    expect(conditionalRoi(row, { ...plan, settlementScenarios: plan.settlementScenarios!.map(s =>
      s.kind === "FIRST_WINS" ? { ...s, profit } : s) })).toBeNull();
  });
});
