import { describe, expect, it } from "vitest";
import { supportsDomCatalogCapture } from "./dom-catalog-host.js";

describe("supportsDomCatalogCapture", () => {
  it("keeps CMD capture enabled", () => {
    expect(supportsDomCatalogCapture("cgnew.fts368.com")).toBe(true);
  });

  it("accepts rotating SABA launch hosts", () => {
    expect(supportsDomCatalogCapture("c0z0oa.bpd3a3fn.com")).toBe(true);
    expect(supportsDomCatalogCapture("c0z0ob.bpd3a3fn.com")).toBe(true);
    expect(supportsDomCatalogCapture("C0Z0O9F.BPD3A3FN.COM")).toBe(true);
    expect(supportsDomCatalogCapture("c0z0oc.bp8newhost.com")).toBe(true);
  });

  it("rejects lookalike and unrelated hosts", () => {
    expect(supportsDomCatalogCapture("c0z0ob.bpd3a3fn.com.evil.example")).toBe(false);
    expect(supportsDomCatalogCapture("c0z0oc.bp8newhost.com.evil.example")).toBe(false);
    expect(supportsDomCatalogCapture("bpd3a3fn.com")).toBe(false);
    expect(supportsDomCatalogCapture("example.com")).toBe(false);
  });
});
