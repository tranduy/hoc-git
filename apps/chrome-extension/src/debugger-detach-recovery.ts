import type { ChromeLobbyId } from "@tool-chenh/contracts";
import { recognizeExpectedLobbyTab, type TabDescriptor } from "./lobby-signatures.js";

interface UnexpectedDebuggerDetachRecoveryOptions {
  readonly tabId: number;
  readonly lobby: ChromeLobbyId;
  readonly reason: string;
  readonly get: (tabId: number) => Promise<TabDescriptor>;
  readonly attach: (tab: TabDescriptor, lobby: ChromeLobbyId) => Promise<void>;
  readonly delay?: (delayMs: number) => Promise<void>;
  readonly maxAttempts?: number;
}

const intentionalDetachReasons = new Set(["replaced_with_devtools"]);

export async function recoverUnexpectedDebuggerDetach(
  options: UnexpectedDebuggerDetachRecoveryOptions
): Promise<boolean> {
  if (intentionalDetachReasons.has(options.reason)) return false;
  const delay = options.delay ?? ((delayMs: number) =>
    new Promise<void>((resolve) => setTimeout(resolve, delayMs)));
  const maxAttempts = options.maxAttempts ?? 12;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    if (attempt > 0) await delay(250);
    try {
      const tab = await options.get(options.tabId);
      if (recognizeExpectedLobbyTab(tab, options.lobby)?.lobby !== options.lobby) continue;
      await options.attach(tab, options.lobby);
      return true;
    } catch {
      // A reload can replace the debug target before the new document is
      // attachable. Retry the same tab id; never open, focus or navigate it.
    }
  }
  return false;
}
