import type { ProtocolObservation } from "../protocol-inspector.js";

export type CmdIdentityReason = "LAUNCH_PROVENANCE_MISMATCH" | "INSUFFICIENT_PROTOCOL_EVIDENCE";

export function proveCmdIdentity(
  candidate: { readonly providerHint: string; readonly hostname: string },
  observations: readonly ProtocolObservation[]
): { readonly verified: true; readonly reason: null } |
  { readonly verified: false; readonly reason: CmdIdentityReason } {
  if (candidate.providerHint !== "CMD") return { verified: false, reason: "LAUNCH_PROVENANCE_MISMATCH" };
  const hasLaunch = observations.some((item) => item.transport === "NAVIGATION" && item.hostname === candidate.hostname);
  const hasJsonApi = observations.some((item) =>
    (item.transport === "FETCH" || item.transport === "XHR") && item.contentType === "application/json" && item.status === 200
  );
  const hasWebsocket = observations.some((item) => item.transport === "WEBSOCKET" && item.status === 101);
  return hasLaunch && hasJsonApi && hasWebsocket
    ? { verified: true, reason: null }
    : { verified: false, reason: "INSUFFICIENT_PROTOCOL_EVIDENCE" };
}
