import type { ChromeLobbyId } from "@tool-chenh/contracts";

const KSPORT_ISOLATED_EXTENSION_NAME = "Fieldline KSPORT Isolated Feed";

/**
 * A copied unpacked build used for KSPORT verification must not attach to the
 * other provider tabs in the same Chrome profile. The normal production
 * extension remains unrestricted.
 */
export function extensionLobbyScope(manifestName: string): ReadonlySet<ChromeLobbyId> | null {
  return manifestName === KSPORT_ISOLATED_EXTENSION_NAME
    ? new Set<ChromeLobbyId>(["KSPORT"])
    : null;
}

export function lobbyIsInExtensionScope(lobby: ChromeLobbyId,
  scope: ReadonlySet<ChromeLobbyId> | null): boolean {
  return scope === null || scope.has(lobby);
}
