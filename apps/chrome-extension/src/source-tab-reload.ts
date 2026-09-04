import type { ChromeLobbyId } from "@tool-chenh/contracts";
import type { TabDescriptor } from "./lobby-signatures.js";

interface AttachedSourceTabReloadOptions {
  readonly reloadDebugTarget: (tabId: number) => Promise<void>;
  readonly reloadBrowserTab: (tabId: number) => Promise<void>;
  readonly get: (tabId: number) => Promise<TabDescriptor>;
}

export async function reloadAttachedSourceTab(
  tabId: number,
  lobby: ChromeLobbyId,
  options: AttachedSourceTabReloadOptions
): Promise<TabDescriptor> {
  if (lobby === "SABA") await options.reloadDebugTarget(tabId);
  else await options.reloadBrowserTab(tabId);
  return options.get(tabId);
}
