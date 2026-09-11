import { describe, expect, it } from "vitest";
import * as policy from "./football-refresh-policy.js";

describe("football refresh policy", () => {
  it("uses exact kickoff boundaries and bounded unknown reconciliation", () => {
    const now = 1_000_000;
    for (const [hours, refreshMs, quoteMaxAgeMs] of [[0,30000,60000],[3,60000,120000],
      [6,120000,300000],[13,600000,900000],[24,3600000,4500000],[72,3600000,4500000],
      [73,null,4500000]] as const) {
      expect(policy.footballRefreshPolicy(now + hours * 3600000,false,false,now))
        .toMatchObject({ refreshMs, quoteMaxAgeMs });
    }
    expect(policy.footballRefreshPolicy(null,false,true,now)).toMatchObject({tier:"UNKNOWN",refreshMs:60000,quoteMaxAgeMs:15000});
  });
  it("limits urgent eligibility and retains strict live age", () => {
    expect(policy.footballRefreshPolicy(100000,false,true,0)).toMatchObject({refreshMs:10000,quoteMaxAgeMs:15000});
    expect(policy.footballRefreshPolicy(10800000,false,true,0).refreshMs).toBe(60000);
    expect(policy.footballRefreshPolicy(null,true,true,0).quoteMaxAgeMs).toBe(5000);
  });
  it("exposes the next tier promotion without changing receipt clocks", () => {
    expect(policy.footballRefreshPolicy(10*3600000,false,false,0).nextBoundaryAtMs).toBe(4*3600000+1);
    const standalone = new Function(`return (${policy.footballRefreshPolicy.toString()})`)();
    expect(standalone(null,false,false,0)).toEqual(policy.footballRefreshPolicy(null,false,false,0));
  });
});
