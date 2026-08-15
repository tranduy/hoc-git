import type { ChromeLobbyId } from "@tool-chenh/contracts";

const HOST_TO_LOBBY = new Map<string, ChromeLobbyId>([
  ["imsports.directsb.net", "IM"],
  ["prod20091.fxf774.com", "BTI"],
  ["pacific.agenate.com", "TSPORT"],
  ["zenandfe.com", "KSPORT"],
  ["c0z0oa.bpd3a3fn.com", "SABA"],
  ["cgnew.fts368.com", "CMD"],
  ["sports-sbomaind-play.jjsskktt.com", "SBO"]
]);

export interface TabDescriptor {
  readonly id?: number | undefined;
  readonly url?: string | undefined;
  readonly title?: string | undefined;
}

export interface LobbyTabCandidate {
  readonly lobby: ChromeLobbyId;
  readonly tabId: number;
  readonly hostname: string;
  readonly confidence: "CANDIDATE" | "TRUSTED";
}

export interface TrafficMarker {
  readonly resourceType: string;
  readonly marker: string;
}

export function recognizeLobbyTab(tab: TabDescriptor): LobbyTabCandidate | null {
  if (!Number.isSafeInteger(tab.id) || (tab.id ?? -1) < 0 || !tab.url) return null;
  try {
    const hostname = new URL(tab.url).hostname.toLowerCase();
    const lobby = HOST_TO_LOBBY.get(hostname);
    if (!lobby) return null;
    return { lobby, tabId: tab.id!, hostname, confidence: "CANDIDATE" };
  } catch {
    return null;
  }
}

export function confirmLobbyFingerprint(
  candidate: LobbyTabCandidate,
  traffic: TrafficMarker
): LobbyTabCandidate | null {
  const transportMatches = /^(?:WebSocket|XHR|Fetch)$/u.test(traffic.resourceType);
  const schemaMatches = /(?:sport|odds|market|event).*(?:feed|price|line|update)|(?:feed|price|line|update).*(?:sport|odds|market|event)/iu
    .test(traffic.marker);
  return transportMatches && schemaMatches ? { ...candidate, confidence: "TRUSTED" } : null;
}
