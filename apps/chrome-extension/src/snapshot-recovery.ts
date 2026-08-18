import type { ChromeLobbyId } from "@tool-chenh/contracts";

export type SnapshotRecoveryMode = "DOM_CAPTURE" | "TAB_RELOAD";

export function snapshotRecoveryMode(lobby: ChromeLobbyId): SnapshotRecoveryMode {
  // CMD's table is authoritative in the rendered DOM. SABA's DOM is only the
  // currently visible viewport; a tab reload is required to make its socket
  // replay the complete reset/done snapshot after bridge state is lost.
  return lobby === "CMD" ? "DOM_CAPTURE" : "TAB_RELOAD";
}

export interface RecoverableSource {
  readonly lobby: ChromeLobbyId;
  readonly tabId: number;
  readonly hostname: string;
}

export interface SnapshotRecoveryPort {
  capture(source: RecoverableSource): Promise<void>;
  reload(tabId: number): Promise<void>;
}

export async function recoverAttachedSource(
  source: RecoverableSource,
  port: SnapshotRecoveryPort
): Promise<void> {
  if (snapshotRecoveryMode(source.lobby) === "DOM_CAPTURE") {
    await port.capture(source);
    return;
  }
  await port.reload(source.tabId);
}
