import { randomBytes } from "node:crypto";
import { mkdir, open, readFile } from "node:fs/promises";
import { dirname } from "node:path";

const KEY_PATTERN = /^[A-Za-z0-9_-]{43}$/u;

export async function ensureChromeBridgeKey(path) {
  await mkdir(dirname(path), { recursive: true });
  let key;
  try {
    key = (await readFile(path, "utf8")).trim();
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    key = randomBytes(32).toString("base64url");
    try {
      const handle = await open(path, "wx", 0o600);
      try { await handle.writeFile(key, "utf8"); } finally { await handle.close(); }
    } catch (writeError) {
      if (writeError?.code !== "EEXIST") throw writeError;
      key = (await readFile(path, "utf8")).trim();
    }
  }
  if (!KEY_PATTERN.test(key)) throw new Error("CHROME_BRIDGE_KEY_INVALID");
  return key;
}
