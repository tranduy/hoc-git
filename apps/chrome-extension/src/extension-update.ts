import type { AttachedLobbyTab } from "./tab-registry.js";

export function tabsNeedingContentScriptRefresh(
  reason: "update" | "install" | "chrome_update" | "shared_module_update",
  tabs: readonly AttachedLobbyTab[]
): readonly number[] {
  // An extension deployment must not navigate authenticated sportsbook tabs.
  // Hard reloads belong only to the explicit Reset action or scheduled
  // maintenance; the debugger observer reconnects to existing tabs in place.
  void reason;
  void tabs;
  return [];
}
