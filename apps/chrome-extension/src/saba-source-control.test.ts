import { describe, expect, it } from "vitest";
import { sabaSourceControlAction } from "./saba-source-control.js";

describe("sabaSourceControlAction", () => {
  it.each(["RELOAD", "RESTORE", "ENSURE"] as const)(
    "keeps a complete current SABA document for %s",
    (command) => {
      expect(sabaSourceControlAction(command, true)).toBe("REFRESH_CURRENT");
    }
  );

  it("recovers the current tab document when reload or restore finds no complete baseline", () => {
    expect(sabaSourceControlAction("RELOAD", false)).toBe("RESTORE_DOCUMENT");
    expect(sabaSourceControlAction("RESTORE", false)).toBe("RESTORE_DOCUMENT");
  });

  it("consumes the supplied fresh launch only after current-document recovery failed", () => {
    expect(sabaSourceControlAction("ENSURE", false)).toBe("ENSURE_LAUNCH");
  });
});
