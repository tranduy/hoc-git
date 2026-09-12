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

  it("reloads the page when the transport is starved, however well the document answers", () => {
    // SABA's socket reconnects without resending reset, so every later frame
    // is refused for want of a baseline while the DOM keeps answering as
    // normal. Measured 2026-09-12: 333 frames refused in ten minutes, the
    // catalog stuck at 56 fixtures while the page listed 117 to 141. Nothing
    // done inside that document can open a new socket.
    expect(sabaSourceControlAction("RELOAD", true, true)).toBe("RELOAD_DOCUMENT");
    expect(sabaSourceControlAction("RELOAD", false, true)).toBe("RELOAD_DOCUMENT");
  });

  it("leaves the page alone when the backend says nothing about the transport", () => {
    // The flag is optional on the wire. A backend that does not send it must
    // not start reloading provider pages by omission.
    expect(sabaSourceControlAction("RELOAD", true, undefined)).toBe("REFRESH_CURRENT");
    expect(sabaSourceControlAction("RESTORE", false, undefined)).toBe("RESTORE_DOCUMENT");
  });
});
