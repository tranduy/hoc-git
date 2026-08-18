import { describe, expect, it, vi } from "vitest";
import { ChromeBridgeControlPlane } from "./chrome-bridge-control-plane.js";

describe("ChromeBridgeControlPlane", () => {
  it("requests a fresh snapshot from every attached source exactly once", () => {
    const saba = { send: vi.fn(), readyState: 1 };
    const bti = { send: vi.fn(), readyState: 1 };
    const plane = new ChromeBridgeControlPlane();
    plane.attach("chrome:SABA:1", saba);
    plane.attach("chrome:BTI:2", bti);

    expect(plane.requestAllSnapshots()).toBe(2);
    expect(saba.send).toHaveBeenCalledWith(JSON.stringify({
      version: 1, kind: "REQUEST_SNAPSHOT", sourceId: "chrome:SABA:1"
    }));
    expect(bti.send).toHaveBeenCalledWith(JSON.stringify({
      version: 1, kind: "REQUEST_SNAPSHOT", sourceId: "chrome:BTI:2"
    }));
  });

  it("can force every attached provider tab to reload for manual session recovery", () => {
    const socket = { send: vi.fn(), readyState: 1 };
    const plane = new ChromeBridgeControlPlane();
    plane.attach("chrome:SABA:1", socket);

    expect(plane.reloadAllSources()).toBe(1);
    expect(socket.send).toHaveBeenCalledWith(JSON.stringify({
      version: 1, kind: "RELOAD_SOURCE", sourceId: "chrome:SABA:1"
    }));
  });

  it("navigates only the attached lobby to a newly issued HTTPS launch", () => {
    const saba = { send: vi.fn(), readyState: 1 };
    const bti = { send: vi.fn(), readyState: 1 };
    const plane = new ChromeBridgeControlPlane();
    plane.attach("chrome:SABA:1", saba);
    plane.attach("chrome:BTI:2", bti);

    expect(plane.navigateLobby("SABA", "https://c0z0ob.bpd3a3fn.com/sports?token=opaque")).toBe(1);
    expect(saba.send).toHaveBeenCalledWith(JSON.stringify({ version: 1, kind: "NAVIGATE_SOURCE",
      sourceId: "chrome:SABA:1", url: "https://c0z0ob.bpd3a3fn.com/sports?token=opaque" }));
    expect(bti.send).not.toHaveBeenCalled();
  });

  it("skips closed sockets and detaches every source owned by a closed connection", () => {
    const socket = { send: vi.fn(), readyState: 3 };
    const plane = new ChromeBridgeControlPlane();
    plane.attach("chrome:SABA:1", socket);
    plane.attach("chrome:BTI:2", socket);

    expect(plane.requestAllSnapshots()).toBe(0);
    plane.detach(socket);
    expect(plane.sourceCount()).toBe(0);
  });
});
