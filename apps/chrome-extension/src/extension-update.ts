import type { AttachedLobbyTab } from "./tab-registry.js";

export function tabsNeedingContentScriptRefresh(
  reason: "update" | "install" | "chrome_update" | "shared_module_update",
  tabs: readonly AttachedLobbyTab[]
): readonly number[] {
  if (reason !== "update") return [];
  // Reload each already-attached provider tab once so the new extension
  // context and content/page relays replace the invalidated old scripts.
  // This never opens a new tab and runs only for an explicit extension update.
  return tabs.map((tab) => tab.tabId);
}
