import type { ChromeLobbyId } from "@tool-chenh/contracts";

export type ChromeBridgeAccountKey = "CMD" | "IM" | "SABA" | "SBOBET" | "APSPORT" | "BTI";

export const CHROME_BRIDGE_ACCOUNT_KEYS: readonly ChromeBridgeAccountKey[] = Object.freeze([
  "CMD", "IM", "SABA", "SBOBET", "APSPORT", "BTI"
]);

export type ChromeBridgeProviderAccountId = `catalog-source:${ChromeBridgeAccountKey}:FOOTBALL`;

export const CHROME_BRIDGE_PROVIDER_ACCOUNT_IDS: readonly ChromeBridgeProviderAccountId[] = Object.freeze(
  CHROME_BRIDGE_ACCOUNT_KEYS.map((accountKey) => chromeBridgeProviderAccountIdForKey(accountKey))
);

export function chromeBridgeProviderAccountIdForKey(
  accountKey: ChromeBridgeAccountKey
): ChromeBridgeProviderAccountId {
  return `catalog-source:${accountKey}:FOOTBALL`;
}

export function chromeBridgeProviderAccountIdForLobby(lobby: ChromeLobbyId): ChromeBridgeProviderAccountId {
  return chromeBridgeProviderAccountIdForKey(chromeBridgeAccountKeyForLobby(lobby));
}

export function chromeBridgeAccountKeyForLobby(lobby: ChromeLobbyId): ChromeBridgeAccountKey {
  return lobby === "KSPORT" || lobby === "SBO" ? "SBOBET"
    : lobby === "TSPORT" ? "APSPORT" : lobby;
}

export function chromeBridgeSourceIdentity(sourceId: string): {
  readonly accountKey: ChromeBridgeAccountKey;
  readonly accountId: ChromeBridgeProviderAccountId;
  readonly lobby: ChromeLobbyId;
} | null {
  const match = /^chrome:(CMD|IM|SABA|SBO|KSPORT|TSPORT|BTI):[^:]+$/u.exec(sourceId);
  if (match === null) return null;
  const lobby = match[1] as ChromeLobbyId;
  const accountKey = chromeBridgeAccountKeyForLobby(lobby);
  return { accountKey, accountId: chromeBridgeProviderAccountIdForKey(accountKey), lobby };
}
