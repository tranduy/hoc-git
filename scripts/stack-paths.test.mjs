import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";
import { resolveStackEntries } from "./stack-paths.mjs";

test("uses the web workspace Vite version instead of a different root dependency", () => {
  assert.deepEqual(resolveStackEntries("C:\\repo"), {
    apiEntry: join("C:\\repo", "apps", "api", "dist", "server.js"),
    viteEntry: join("C:\\repo", "apps", "web", "node_modules", "vite", "bin", "vite.js"),
    webRoot: join("C:\\repo", "apps", "web")
  });
});
