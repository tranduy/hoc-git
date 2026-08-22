import { describe, expect, it } from "vitest";
import { resolveLocalAppData } from "./local-app-data.js";

describe("resolveLocalAppData", () => {
  it("keeps an explicit LOCALAPPDATA and fails closed only on Windows", () => {
    expect(resolveLocalAppData({ LOCALAPPDATA: " C:\\Users\\x\\AppData\\Local " }, "win32", "/h")).toBe("C:\\Users\\x\\AppData\\Local");
    expect(resolveLocalAppData({}, "win32", "/h")).toBeNull();
    expect(resolveLocalAppData({ LOCALAPPDATA: "" }, "win32", "/h")).toBeNull();
  });

  it("falls back to the platform data directory elsewhere", () => {
    expect(resolveLocalAppData({}, "darwin", "/Users/me")).toBe("/Users/me/Library/Application Support");
    expect(resolveLocalAppData({}, "linux", "/home/me")).toBe("/home/me/.local/share");
    expect(resolveLocalAppData({ XDG_DATA_HOME: "/data" }, "linux", "/home/me")).toBe("/data");
  });
});
