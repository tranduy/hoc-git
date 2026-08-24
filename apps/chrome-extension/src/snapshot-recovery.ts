import type { ChromeLobbyId } from "@tool-chenh/contracts";

export type SnapshotRecoveryMode = "DOM_CAPTURE" | "CATALOG_REFRESH" | "TAB_RELOAD";

export function snapshotRecoveryMode(lobby: ChromeLobbyId): SnapshotRecoveryMode {
  // Every attached provider recovers inside the current authenticated page. A
  // loopback API reconnect is never permission to navigate or hard-reload a
  // source. CMD's refresh path requests its authenticated fc=1 baseline.
  void lobby;
  return "CATALOG_REFRESH";
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
