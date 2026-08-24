import { describe, expect, it } from "vitest";
import { CmdRecoveryState, type CmdRecoveryDocument } from "./cmd-recovery-state.js";

const currentDocument: CmdRecoveryDocument = {
  sourceId: "chrome:CMD:9",
  sourceEpoch: "observer-cmd:1",
  frameId: "frame-current",
  loaderId: "loader-current"
};

describe("CmdRecoveryState", () => {
  it("keeps busy and baseline-requested pending until one matching completion", () => {
    const state = new CmdRecoveryState();
    const recovery = state.begin(currentDocument, { nowMs: 0, maxAttempts: 4, deadlineMs: 1_000 });

    expect(state.begin(currentDocument, { nowMs: 1, maxAttempts: 4, deadlineMs: 1_000 })).toBe(recovery);
    expect(recovery.nextAttempt(1)).toEqual({ kind: "ATTEMPT", attempt: 1 });
    expect(recovery.nextAttempt(1)).toEqual({ kind: "WAITING" });
    expect(recovery.recordPageResult(1, "busy", 2)).toBeNull();
    expect(recovery.nextAttempt(3)).toEqual({ kind: "ATTEMPT", attempt: 2 });
    expect(recovery.recordPageResult(2, "busy", 4)).toBeNull();
    expect(recovery.nextAttempt(5)).toEqual({ kind: "ATTEMPT", attempt: 3 });
    expect(recovery.recordPageResult(3, "baseline-requested", 6)).toBeNull();
    expect(recovery.resolution).toBeNull();

    expect(state.complete({ document: currentDocument,
      providerFunctionCode: 3, responseComplete: true }, 7)).toBeNull();
    expect(state.complete({ document: currentDocument,
      providerFunctionCode: 1, responseComplete: false }, 7)).toBeNull();
    expect(state.complete({ document: currentDocument,
      providerFunctionCode: 1, responseComplete: true }, 7)).toEqual({ outcome: "SUCCESS", attempts: 3 });
  });

  it("fails an always-busy recovery at either the attempt cap or deadline", () => {
    const state = new CmdRecoveryState();
    const capped = state.begin(currentDocument, { nowMs: 0, maxAttempts: 2, deadlineMs: 100 });
    expect(capped.nextAttempt(0)).toEqual({ kind: "ATTEMPT", attempt: 1 });
    expect(capped.recordPageResult(1, "busy", 1)).toBeNull();
    expect(capped.nextAttempt(2)).toEqual({ kind: "ATTEMPT", attempt: 2 });
    expect(capped.recordPageResult(2, "busy", 3)).toBeNull();
    expect(capped.nextAttempt(4)).toEqual({ kind: "RESOLVED",
      resolution: { outcome: "FAILURE", reason: "ATTEMPT_CAP", attempts: 2 } });

    const deadlineDocument = { ...currentDocument, sourceId: "chrome:CMD:10" };
    const expired = state.begin(deadlineDocument, { nowMs: 20, maxAttempts: 4, deadlineMs: 10 });
    expect(expired.nextAttempt(20)).toEqual({ kind: "ATTEMPT", attempt: 1 });
    expect(expired.recordPageResult(1, "busy", 21)).toBeNull();
    expect(expired.expire(30)).toEqual({ outcome: "FAILURE", reason: "DEADLINE", attempts: 1 });
    expect(state.complete({ document: deadlineDocument,
      providerFunctionCode: 1, responseComplete: true }, 31)).toBeNull();
  });

  it("retries baseline-requested acknowledgements and fails when no completion arrives", () => {
    const state = new CmdRecoveryState();
    const recovery = state.begin(currentDocument, { nowMs: 0, maxAttempts: 2, deadlineMs: 100 });
    expect(recovery.nextAttempt(0)).toEqual({ kind: "ATTEMPT", attempt: 1 });
    expect(recovery.recordPageResult(1, "baseline-requested", 1)).toBeNull();
    expect(recovery.nextAttempt(2)).toEqual({ kind: "ATTEMPT", attempt: 2 });
    expect(recovery.recordPageResult(2, "baseline-requested", 3)).toBeNull();
    expect(recovery.nextAttempt(4)).toEqual({ kind: "RESOLVED",
      resolution: { outcome: "FAILURE", reason: "ATTEMPT_CAP", attempts: 2 } });
  });

  it("retires the old session on document or epoch change and prevents every later action", () => {
    const state = new CmdRecoveryState();
    const oldRecovery = state.begin(currentDocument, { nowMs: 0, maxAttempts: 3, deadlineMs: 100 });
    expect(oldRecovery.nextAttempt(0)).toEqual({ kind: "ATTEMPT", attempt: 1 });
    expect(oldRecovery.recordPageResult(1, "busy", 1)).toBeNull();

    const replacementDocument = { ...currentDocument,
      sourceEpoch: "observer-cmd:2", loaderId: "loader-replacement" };
    const replacement = state.begin(replacementDocument, { nowMs: 2, maxAttempts: 3, deadlineMs: 100 });
    expect(oldRecovery.resolution).toEqual({ outcome: "FAILURE",
      reason: "DOCUMENT_CHANGED", attempts: 1 });
    expect(oldRecovery.nextAttempt(3)).toEqual({ kind: "RESOLVED",
      resolution: { outcome: "FAILURE", reason: "DOCUMENT_CHANGED", attempts: 1 } });
    expect(state.complete({ document: currentDocument,
      providerFunctionCode: 1, responseComplete: true }, 3)).toBeNull();

    expect(state.abort(replacementDocument)).toEqual({ outcome: "FAILURE", reason: "ABORTED", attempts: 0 });
    expect(replacement.nextAttempt(4)).toEqual({ kind: "RESOLVED",
      resolution: { outcome: "FAILURE", reason: "ABORTED", attempts: 0 } });
    const released = state.begin(replacementDocument, { nowMs: 5, maxAttempts: 3, deadlineMs: 100 });
    expect(state.release(replacementDocument.sourceId)).toEqual({ outcome: "FAILURE",
      reason: "RELEASED", attempts: 0 });
    expect(released.nextAttempt(6)).toEqual({ kind: "RESOLVED",
      resolution: { outcome: "FAILURE", reason: "RELEASED", attempts: 0 } });
  });

  it("publishes a matching completion exactly once", () => {
    const state = new CmdRecoveryState();
    const recovery = state.begin(currentDocument, { nowMs: 0, maxAttempts: 2, deadlineMs: 100 });
    expect(recovery.nextAttempt(0)).toEqual({ kind: "ATTEMPT", attempt: 1 });
    expect(recovery.recordPageResult(1, "baseline-requested", 1)).toBeNull();

    const completion = { document: currentDocument, providerFunctionCode: 1, responseComplete: true };
    expect(state.complete(completion, 2)).toEqual({ outcome: "SUCCESS", attempts: 1 });
    expect(state.complete(completion, 3)).toBeNull();
    expect(recovery.resolution).toEqual({ outcome: "SUCCESS", attempts: 1 });
  });
});
