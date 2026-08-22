import { describe, expect, it } from "vitest";
import { shouldBlockCatalogResource } from "./browser-resource-policy.js";

describe("catalog browser resource policy", () => {
  it.each(["image", "media", "font"])("blocks non-data resource %s", (resourceType) => {
    expect(shouldBlockCatalogResource(resourceType)).toBe(true);
  });

  it.each(["document", "script", "stylesheet", "xhr", "fetch", "websocket"])(
    "keeps data-bearing resource %s",
    (resourceType) => expect(shouldBlockCatalogResource(resourceType)).toBe(false)
  );
});
