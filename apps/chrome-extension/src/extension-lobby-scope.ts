import type { ChromeLobbyId } from "@tool-chenh/contracts";

const KSPORT_ISOLATED_EXTENSION_NAME = "Fieldline KSPORT Isolated Feed";

/**
 * A copied unpacked build used for KSPORT verification must not attach to the
 * other provider tabs in the same Chrome profile. The normal production
 * extension admits IM only through its origin-wide, roster-only request gate.
 */
export function extensionLobbyScope(manifestName: string): ReadonlySet<ChromeLobbyId> | null {
  return manifestName === KSPORT_ISOLATED_EXTENSION_NAME
    ? new Set<ChromeLobbyId>(["KSPORT"])
    : new Set<ChromeLobbyId>(["BTI", "CMD", "IM", "SABA", "SBO", "KSPORT", "TSPORT"]);
}

export function lobbyIsInExtensionScope(lobby: ChromeLobbyId,
  scope: ReadonlySet<ChromeLobbyId> | null): boolean {
  return scope === null || scope.has(lobby);
}
