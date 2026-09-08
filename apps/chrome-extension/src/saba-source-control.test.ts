import { describe, expect, it } from "vitest";
import { sabaSourceControlAction } from "./saba-source-control.js";

describe("sabaSourceControlAction", () => {
  it.each(["RELOAD", "RESTORE", "ENSURE"] as const)(
    "keeps a responsive current SABA document for %s",
    (command) => {
      expect(sabaSourceControlAction(command, true)).toBe("REFRESH_CURRENT");
    }
  );

  it("recovers the current tab document when reload or restore finds no responsive document", () => {
    expect(sabaSourceControlAction("RELOAD", false)).toBe("RESTORE_DOCUMENT");
    expect(sabaSourceControlAction("RESTORE", false)).toBe("RESTORE_DOCUMENT");
  });

  it("rebuilds the exact current SABA tab when ensure finds no responsive document", () => {
    expect(sabaSourceControlAction("ENSURE", false)).toBe("RESTORE_DOCUMENT");
  });
});
