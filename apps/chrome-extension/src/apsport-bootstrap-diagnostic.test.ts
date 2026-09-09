import { describe, expect, it } from "vitest";
import { ApsportBootstrapDiagnostic } from "./apsport-bootstrap-diagnostic.js";

describe("AP bootstrap command diagnostics", () => {
  it.each([
    ["frame-command-timeout", "TIMEOUT"],
    ["Debugger is not attached to the tab with id: 12", "DETACHED"],
    ["No tab with given id", "TARGET_GONE"],
    ["Cannot find context with specified id", "CONTEXT_GONE"],
    ["No frame for given id found", "FRAME_GONE"],
    ["Target closed", "TARGET_GONE"],
    ["other failure https://private.example/?token=secret", "CDP_REJECTED"]
  ])("classifies %s without exposing the original command error", async (message, category) => {
    const diagnostic = new ApsportBootstrapDiagnostic(0);
    expect(await diagnostic.command("FRAME_TREE", Promise.reject(Error(message)))).toBeNull();
    expect(diagnostic.format()).toContain(`FRAME_TREE:${category}`);
    expect(diagnostic.format()).not.toContain(message);
    expect(diagnostic.format()).not.toContain("secret");
  });

  it("distinguishes a missing frame tree from failed world creation and evaluation", async () => {
    const diagnostic = new ApsportBootstrapDiagnostic(2);
    diagnostic.frames = 1;
    diagnostic.worlds = 1;
    diagnostic.note("FRAME_TREE", "NO_FRAMES");
    diagnostic.evaluation("WORLD_EVALUATE", { exceptionDetails: {
      text: "secret exception from provider"
    } });
    diagnostic.evaluation("CONTEXT_EVALUATE", { result: { value: null } });
    expect(diagnostic.format()).toBe("contexts=2 frames=1 worlds=1 failures[FRAME_TREE:NO_FRAMES,WORLD_EVALUATE:EVALUATION_EXCEPTION,CONTEXT_EVALUATE:NO_RESULT]");
  });

  it("distinguishes an in-page caught error from a Chrome protocol error", () => {
    const diagnostic = new ApsportBootstrapDiagnostic(1);
    diagnostic.evaluation("CONTEXT_EVALUATE", {
      result: { value: { reason: "APSPORT_BOOTSTRAP_CONTEXT_UNAVAILABLE" } }
    });
    expect(diagnostic.format()).toContain("CONTEXT_EVALUATE:IN_PAGE_EXCEPTION");
  });

  it("retains at most eight failure classifications even when frames repeat errors", () => {
    const diagnostic = new ApsportBootstrapDiagnostic(200);
    for (let i = 0; i < 1_000; i++) diagnostic.note("WORLD_CREATE", "FRAME_GONE");
    expect(diagnostic.format()).toBe("contexts=200 frames=0 worlds=0 failures[WORLD_CREATE:FRAME_GONE]");
  });
});
