import type { ChromeLobbyId } from "@tool-chenh/contracts";

const HOST_TO_LOBBY = new Map<string, ChromeLobbyId>([
  ["imsports.directsb.net", "IM"],
  ["prod20091.fxf774.com", "BTI"],
  ["pacific.agenate.com", "TSPORT"],
  ["sport.asportsb.com", "TSPORT"],
  ["zenandfe.com", "KSPORT"],
  ["c0z0oa.bpd3a3fn.com", "SABA"],
  ["cgnew.fts368.com", "CMD"],
  ["sports-sbomaind-play.jjsskktt.com", "SBO"]
]);

/** Every lobby host the extension recognises outright, so callers that must
 * cover all of them - the heartbeat that restarts a collected worker - cannot
 * silently miss one that was added here. */
export const LOBBY_HOSTNAMES: readonly string[] = [...HOST_TO_LOBBY.keys()];

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

export function isReadyKsportSportsbookTab(tab: TabDescriptor): boolean {
  return recognizeLobbyTab(tab)?.lobby === "KSPORT" && /\bsportsbook\b/iu.test(tab.title?.trim() ?? "");
}

export function shouldPreserveKsportObserver(
  attachedLobby: ChromeLobbyId,
  hasCompleteBaseline: boolean
): boolean {
  return attachedLobby === "KSPORT" && hasCompleteBaseline;
}

export function recognizeLobbyTab(tab: TabDescriptor): LobbyTabCandidate | null {
  if (!Number.isSafeInteger(tab.id) || (tab.id ?? -1) < 0 || !tab.url) return null;
  try {
    const parsed = new URL(tab.url);
    const hostname = parsed.hostname.toLowerCase();
    const lobby = HOST_TO_LOBBY.get(hostname) ??
      (/^c0z0o[a-z0-9]+\.(?:bpb7jrm5|bpf7t7s9)\.com$/iu.test(hostname) ? "SBO" :
      /^c0z0o[a-z0-9]+\.bp[a-z0-9]+\.com$/iu.test(hostname) ? "SABA" :
        /^pacific\.(?:agenate|racern)\.com$/iu.test(hostname) ? "TSPORT" : undefined);
    if (!lobby) return null;
    const title = tab.title?.trim() ?? "";
    if (lobby === "SABA" && (isSabaErrorTitle(title) || isSabaErrorUrl(parsed) ||
      isSabaEventDetailUrl(parsed))) {
      return null;
    }
    if (lobby === "KSPORT" && (/\bvolta\b/iu.test(parsed.pathname) ||
      /volta|something went wrong/iu.test(title))) return null;
    return { lobby, tabId: tab.id!, hostname, confidence: "CANDIDATE" };
  } catch {
    return null;
  }
}

export function recognizeExpectedLobbyTab(
  tab: TabDescriptor,
  expectedLobby: ChromeLobbyId
): LobbyTabCandidate | null {
  const candidate = recognizeLobbyTab(tab);
  if (candidate?.lobby === expectedLobby) return candidate;
  if (expectedLobby !== "SABA" || candidate?.lobby !== "SBO" ||
    !/^c0z0o[a-z0-9]+\.(?:bpb7jrm5|bpf7t7s9)\.com$/iu.test(candidate.hostname) ||
    isSabaErrorTitle(tab.title?.trim() ?? "") || isSabaErrorUrlValue(tab.url) ||
    isSabaEventDetailUrlValue(tab.url)) return null;
  return { ...candidate, lobby: "SABA" };
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

function isSabaErrorTitle(title: string): boolean {
  return /(?:SPA-\d+|authentication failed|session expired|login required|please log in|access denied|something went wrong|^error\b)/iu.test(title);
}

function isSabaErrorUrl(url: URL): boolean {
  return /\/VendorGame\/ErrorPage(?:\/|$)/iu.test(url.pathname) ||
    (url.searchParams.has("ErrCode") && url.searchParams.get("ErrCode")?.trim() !== "");
}

function isSabaEventDetailUrl(url: URL): boolean {
  return Boolean(url.searchParams.get("matchid")?.trim());
}

function isSabaErrorUrlValue(value: string | undefined): boolean {
  if (!value) return false;
  try { return isSabaErrorUrl(new URL(value)); }
  catch { return false; }
}

function isSabaEventDetailUrlValue(value: string | undefined): boolean {
  if (!value) return false;
  try { return isSabaEventDetailUrl(new URL(value)); }
  catch { return false; }
}
