import { cleanup, render } from "@testing-library/react";
import type { ProviderConnectionStatus } from "@tool-chenh/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { StatusStrip } from "./status-strip.js";

const statuses: readonly ProviderConnectionStatus[] = [
  { adapterId: "shared-adapter", provider: "SABA", category: "FOOTBALL", status: "LIVE", detail: null, updatedAtMs: 1 },
  { adapterId: "shared-adapter", provider: "SABA", category: "LOL", status: "LIVE", detail: null, updatedAtMs: 1 }
];

describe("StatusStrip", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("keeps a multi-category adapter's provider rows uniquely identified", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    render(<StatusStrip statuses={statuses} />);

    expect(error.mock.calls.flat().join(" ")).not.toContain("same key");
  });
});
