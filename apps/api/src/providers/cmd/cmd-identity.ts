import type { ProtocolObservation } from "../protocol-inspector.js";

export type CmdIdentityReason = "LAUNCH_PROVENANCE_MISMATCH" | "INSUFFICIENT_PROTOCOL_EVIDENCE";

export function proveCmdIdentity(
  candidate: { readonly providerHint: string; readonly hostname: string },
  observations: readonly ProtocolObservation[]
): { readonly verified: true; readonly reason: null } |
  { readonly verified: false; readonly reason: CmdIdentityReason } {
  if (candidate.providerHint !== "CMD") return { verified: false, reason: "LAUNCH_PROVENANCE_MISMATCH" };
  const hasLaunch = observations.some((item) => item.transport === "NAVIGATION" && item.hostname === candidate.hostname &&
    item.pathTemplate === "/:session/Newindex" && item.status === 200);
  const hasAppConfigFingerprint = observations.some((item) =>
    item.pathTemplate === "/:session/NewIndex/GetAppConfig" &&
    item.bodyShapeHash === "6a471d81d8c6be58ec077a5f6672083c1be064b02c7bbb2e40932173d0c270db"
  );
  const hasMenuFingerprint = observations.some((item) =>
    item.pathTemplate === "/api/menu/desktopMenu" &&
    item.bodyShapeHash === "3ddb067776b1837ef907a113b4efb4146b2cc443a2dded65dcd596183be709a8"
  );
  return hasLaunch && hasAppConfigFingerprint && hasMenuFingerprint
    ? { verified: true, reason: null }
    : { verified: false, reason: "INSUFFICIENT_PROTOCOL_EVIDENCE" };
}
