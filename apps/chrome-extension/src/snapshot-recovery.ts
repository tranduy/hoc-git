import type { ChromeLobbyId } from "@tool-chenh/contracts";

export type SnapshotRecoveryMode = "DOM_CAPTURE" | "TAB_RELOAD";

export function snapshotRecoveryMode(lobby: ChromeLobbyId): SnapshotRecoveryMode {
  return lobby === "CMD" || lobby === "SABA" ? "DOM_CAPTURE" : "TAB_RELOAD";
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
