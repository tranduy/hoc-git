import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ensureChromeBridgeKey } from "./chrome-bridge-key.mjs";

test("creates one token-safe key and reuses it across restarts", async () => {
  const directory = await mkdtemp(join(tmpdir(), "tool-chenh-key-"));
  const path = join(directory, "bridge.key");
  const first = await ensureChromeBridgeKey(path);
  const second = await ensureChromeBridgeKey(path);

  assert.match(first, /^[A-Za-z0-9_-]{43}$/u);
  assert.equal(second, first);
  assert.equal((await readFile(path, "utf8")).trim(), first);
});

test("rejects a malformed existing key instead of silently replacing it", async () => {
  const directory = await mkdtemp(join(tmpdir(), "tool-chenh-key-"));
  const path = join(directory, "bridge.key");
  await import("node:fs/promises").then(({ writeFile }) => writeFile(path, "bad key", "utf8"));
  await assert.rejects(() => ensureChromeBridgeKey(path), /CHROME_BRIDGE_KEY_INVALID/u);
});
