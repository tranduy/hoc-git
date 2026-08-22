import type { ChromeBridgeEnvelope } from "@tool-chenh/contracts";

export type WebSocketLifecycleState = "OPEN" | "CLOSED";

export function websocketLifecycleState(envelope: ChromeBridgeEnvelope): WebSocketLifecycleState | null {
  if (envelope.transport !== "WS_STATE" || envelope.payload.encoding !== "UTF8") return null;
  try {
    const parsed: unknown = JSON.parse(envelope.payload.body);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
    const item = parsed as Record<string, unknown>;
    if (Object.keys(item).length !== 1 || (item.state !== "OPEN" && item.state !== "CLOSED")) return null;
    return item.state;
  } catch {
    return null;
  }
}
