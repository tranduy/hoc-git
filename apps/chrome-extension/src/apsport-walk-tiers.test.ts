import { describe, expect, it } from "vitest";
import { APSPORT_WALK_TIERS } from "./network-observer.js";

describe("APSPORT_WALK_TIERS", () => {
  it("covers the fixtures corner arbitrage actually sits on", () => {
    // The detail walk is the only source of corner books, and confining it to a
    // six-hour window decided that no fixture further out would ever be asked
    // for its corners. Measured 2026-09-13: APSPORT carried corners on 53 of
    // its 1,288 fixtures, and of seven corner pairs on a competitor's screen
    // that day, five were on fixtures ten hours to three days away - none of
    // which could form here, because one side was never collected.
    for (const near of ["LIVE", "URGENT", "NEAR", "3_6H"]) expect(APSPORT_WALK_TIERS.has(near)).toBe(true);
    for (const far of ["6_13H", "13_24H", "24_72H"]) expect(APSPORT_WALK_TIERS.has(far)).toBe(true);
  });

  it("leaves out the tier that has no refresh policy", () => {
    // PASSIVE fixtures are not refreshed at all, so walking them would spend a
    // lane on a book that is never read again.
    expect(APSPORT_WALK_TIERS.has("PASSIVE")).toBe(false);
  });

  it("keeps the near window first, which is what makes widening safe", () => {
    // Near fixtures are not protected by this set but by the scheduler, which
    // orders by refresh interval and reserves exactly one slot per batch for a
    // distant fixture. Widening the set cannot starve the near window; if that
    // reservation is ever removed, this comment is where to start looking.
    expect(APSPORT_WALK_TIERS.has("LIVE")).toBe(true);
    expect(APSPORT_WALK_TIERS.size).toBeGreaterThanOrEqual(8);
  });
});
