import type { ChromeLobbyId } from "@tool-chenh/contracts";

export type ChromeBridgeAccountKey = "CMD" | "IM" | "SABA" | "SBOBET" | "APSPORT" | "BTI";

export function chromeBridgeAccountKeyForLobby(lobby: ChromeLobbyId): ChromeBridgeAccountKey {
  return lobby === "KSPORT" || lobby === "SBO" ? "SBOBET"
    : lobby === "TSPORT" ? "APSPORT" : lobby;
}

export function chromeBridgeSourceIdentity(sourceId: string): {
  readonly accountKey: ChromeBridgeAccountKey;
  readonly lobby: ChromeLobbyId;
} | null {
  const match = /^chrome:(CMD|IM|SABA|SBO|KSPORT|TSPORT|BTI):[^:]+$/u.exec(sourceId);
  if (match === null) return null;
  const lobby = match[1] as ChromeLobbyId;
  return { accountKey: chromeBridgeAccountKeyForLobby(lobby), lobby };
}
