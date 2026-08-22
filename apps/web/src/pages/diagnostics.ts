import type { BlockedDiagnostic } from "@tool-chenh/contracts";

export function isStaleDiagnostic(diagnostic: BlockedDiagnostic): boolean {
  return diagnostic.code === "STALE" || diagnostic.code === "QUOTE_STALE";
}
