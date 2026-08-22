import assert from "node:assert/strict";
import test from "node:test";
import { resolveLocalAppData } from "./local-app-data.mjs";

test("keeps an explicit LOCALAPPDATA on every platform", () => {
  assert.equal(resolveLocalAppData({ LOCALAPPDATA: "C:\\Users\\x\\AppData\\Local" }, "win32", "/h"), "C:\\Users\\x\\AppData\\Local");
  assert.equal(resolveLocalAppData({ LOCALAPPDATA: "/tmp/data" }, "darwin", "/h"), "/tmp/data");
});

test("fails closed on Windows and falls back to platform conventions elsewhere", () => {
  assert.equal(resolveLocalAppData({}, "win32", "/h"), null);
  assert.equal(resolveLocalAppData({}, "darwin", "/Users/me"), "/Users/me/Library/Application Support");
  assert.equal(resolveLocalAppData({}, "linux", "/home/me"), "/home/me/.local/share");
  assert.equal(resolveLocalAppData({ XDG_DATA_HOME: "/data" }, "linux", "/home/me"), "/data");
});
