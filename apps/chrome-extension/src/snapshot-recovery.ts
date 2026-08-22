import type { ChromeLobbyId } from "@tool-chenh/contracts";

export type SnapshotRecoveryMode = "DOM_CAPTURE" | "CATALOG_REFRESH" | "TAB_RELOAD";

export function snapshotRecoveryMode(lobby: ChromeLobbyId): SnapshotRecoveryMode {
  // CMD's table is authoritative in the rendered DOM. Every other attached
  // provider must recover inside the current authenticated page. A loopback
  // API reconnect is never permission to navigate or hard-reload a source.
  if (lobby === "CMD") return "DOM_CAPTURE";
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
