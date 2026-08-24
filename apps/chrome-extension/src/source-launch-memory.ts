import type { ChromeLobbyId } from "@tool-chenh/contracts";
import { recognizeLobbyTab, type TabDescriptor } from "./lobby-signatures.js";

type RememberedLaunches = Record<ChromeLobbyId, string | null>;

function emptyRememberedLaunches(): RememberedLaunches {
  return {
    IM: null,
    BTI: null,
    TSPORT: null,
    KSPORT: null,
    SABA: null,
    CMD: null,
    SBO: null
  };
}

export class SourceLaunchMemory {
  readonly #launches = emptyRememberedLaunches();

  rememberRecognized(tab: TabDescriptor): void {
    const recognized = recognizeLobbyTab(tab);
    if (recognized === null || typeof tab.url !== "string") return;
    this.#launches[recognized.lobby] = tab.url;
  }

  load(lobby: ChromeLobbyId): string | null {
    return this.#launches[lobby];
  }
}
