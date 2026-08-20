import type { ChromeLobbyId } from "@tool-chenh/contracts";

export type SnapshotRecoveryMode = "DOM_CAPTURE" | "CATALOG_REFRESH" | "TAB_RELOAD";

export function snapshotRecoveryMode(lobby: ChromeLobbyId): SnapshotRecoveryMode {
  // CMD's table is authoritative in the rendered DOM. SABA's DOM is only the
  // currently visible viewport; a tab reload is required to make its socket
  // replay the complete reset/done snapshot after bridge state is lost.
  if (lobby === "CMD") return "DOM_CAPTURE";
  if (lobby === "BTI" || lobby === "IM") return "CATALOG_REFRESH";
  return "TAB_RELOAD";
}

export interface RecoverableSource {
  readonly lobby: ChromeLobbyId;
  readonly tabId: number;
  readonly hostname: string;
}

export interface SnapshotRecoveryPort {
  capture(source: RecoverableSource): Promise<void>;
  refresh(source: RecoverableSource): Promise<void>;
  reload(tabId: number): Promise<void>;
}

export async function recoverAttachedSource(
  source: RecoverableSource,
  port: SnapshotRecoveryPort
): Promise<void> {
  const mode = snapshotRecoveryMode(source.lobby);
  if (mode === "DOM_CAPTURE") {
    await port.capture(source);
    return;
  }
  if (mode === "CATALOG_REFRESH") {
    await port.refresh(source);
    return;
  }
  await port.reload(source.tabId);
}
