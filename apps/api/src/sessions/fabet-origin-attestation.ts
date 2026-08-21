import { isIP } from "node:net";

export interface FabetOriginEvidence {
  readonly entryUrl: "https://fabet.monster/";
  readonly finalUrl: string;
  readonly finalHostname: string;
  readonly loginFormPresent: boolean;
  readonly lobbyPresent: boolean;
  readonly authenticatedControlPresent: boolean;
  readonly sameOriginApiObserved: boolean;
}

export interface AttestedFabetOrigin {
  readonly finalUrl: string;
  readonly finalHostname: string;
}

export function attestFabetOrigin(evidence: FabetOriginEvidence): AttestedFabetOrigin {
  if (evidence.entryUrl !== "https://fabet.monster/") {
    throw new Error("Fabet authentication must start at the canonical root");
  }

  let final: URL;
  try {
    final = new URL(evidence.finalUrl);
  } catch {
    throw new Error("Fabet redirect final URL is invalid");
  }
  if (final.protocol !== "https:") throw new Error("Fabet redirect must use HTTPS");
  if (final.username || final.password) throw new Error("Fabet redirect must not contain URL credentials");
  const normalizedHostname = final.hostname.toLowerCase().replace(/^\[|\]$/gu, "");
  if (isIP(normalizedHostname) !== 0) throw new Error("Fabet redirect must not target an IP literal");
  if (normalizedHostname !== evidence.finalHostname.toLowerCase().replace(/^\[|\]$/gu, "")) {
    throw new Error("Fabet redirect hostname evidence does not match the final URL");
  }
  if (!evidence.loginFormPresent && !evidence.lobbyPresent) {
    throw new Error("Fabet controls were not observed on the redirect target");
  }
  if (!evidence.authenticatedControlPresent) {
    throw new Error("Fabet authenticated account control was not observed");
  }
  if (!evidence.sameOriginApiObserved) {
    throw new Error("Fabet same-origin API evidence was not observed");
  }

  return { finalUrl: final.href, finalHostname: final.hostname.toLowerCase() };
}
