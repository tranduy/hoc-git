import { recognizeLobbyTab, type TabDescriptor } from "./lobby-signatures.js";

export const HEARTBEAT_SCRIPT = "lobby-heartbeat.js";

export interface HeartbeatInjectionDependencies {
  readonly listTabs: () => Promise<readonly TabDescriptor[]>;
  readonly inject: (tabId: number) => Promise<void>;
}

/**
 * Puts the heartbeat into lobby tabs that were already open when this version
 * arrived.
 *
 * A declarative content script only lands on a page load, and a deployment must
 * never navigate an authenticated sportsbook tab. Without this the way back
 * into a collected worker would not exist until the user happened to reload
 * every book by hand - which is the state this whole path exists to end.
 */
export async function injectHeartbeatIntoOpenLobbies(
  dependencies: HeartbeatInjectionDependencies
): Promise<readonly number[]> {
  const tabs = await dependencies.listTabs().catch(() => [] as readonly TabDescriptor[]);
  const injected: number[] = [];
  for (const tab of tabs) {
    const recognized = recognizeLobbyTab(tab);
    if (recognized === null) continue;
    try {
      await dependencies.inject(recognized.tabId);
      injected.push(recognized.tabId);
    } catch { /* a closed or restricted tab must not stop the remaining books */ }
  }
  return injected;
}
