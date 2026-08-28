import { describe, expect, it } from "vitest";
import { extensionLobbyScope, lobbyIsInExtensionScope } from "./extension-lobby-scope.js";

describe("extension lobby scope", () => {
  it("limits the isolated verification manifest to KSPORT", () => {
    const scope = extensionLobbyScope("Fieldline KSPORT Isolated Feed");

    expect(lobbyIsInExtensionScope("KSPORT", scope)).toBe(true);
    expect(lobbyIsInExtensionScope("IM", scope)).toBe(false);
    expect(lobbyIsInExtensionScope("TSPORT", scope)).toBe(false);
  });

  it("leaves the production extension unrestricted", () => {
    const scope = extensionLobbyScope("Fieldline Chrome Feed");

    expect(scope).toBeNull();
    expect(lobbyIsInExtensionScope("TSPORT", scope)).toBe(true);
  });
});
