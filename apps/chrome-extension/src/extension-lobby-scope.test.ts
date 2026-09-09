import { describe, expect, it } from "vitest";
import { extensionLobbyScope, lobbyIsInExtensionScope } from "./extension-lobby-scope.js";

describe("extension lobby scope", () => {
  it("limits the isolated verification manifest to KSPORT", () => {
    const scope = extensionLobbyScope("Fieldline KSPORT Isolated Feed");

    expect(lobbyIsInExtensionScope("KSPORT", scope)).toBe(true);
    expect(lobbyIsInExtensionScope("IM", scope)).toBe(false);
    expect(lobbyIsInExtensionScope("TSPORT", scope)).toBe(false);
  });

  it("includes the guarded IM collector and every other production provider", () => {
    const scope = extensionLobbyScope("Fieldline Chrome Feed");

    expect(lobbyIsInExtensionScope("IM", scope)).toBe(true);
    expect(lobbyIsInExtensionScope("BTI", scope)).toBe(true);
    expect(lobbyIsInExtensionScope("CMD", scope)).toBe(true);
    expect(lobbyIsInExtensionScope("SABA", scope)).toBe(true);
    expect(lobbyIsInExtensionScope("KSPORT", scope)).toBe(true);
    expect(lobbyIsInExtensionScope("TSPORT", scope)).toBe(true);
  });
});
