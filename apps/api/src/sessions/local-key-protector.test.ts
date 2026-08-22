import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LocalKeyProtector } from "./local-key-protector.js";
import { createPlatformSecretProtector, defaultWarpCliPath } from "./platform-secret-protector.js";
import { DpapiProtector } from "./dpapi-protector.js";
import { SecretVault } from "./secret-vault.js";

describe("LocalKeyProtector", () => {
  const directories: string[] = [];
  afterEach(async () => { await Promise.all(directories.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))); });
  async function scratch(): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), "local-key-protector-"));
    directories.push(dir);
    return dir;
  }

  it("round-trips bytes and creates a private key file on first use", async () => {
    const dir = await scratch();
    const keyPath = join(dir, "nested", "local-vault.key");
    const protector = new LocalKeyProtector({ keyPath });
    const cleartext = new TextEncoder().encode("local-roundtrip-canary");

    const ciphertext = await protector.protect(cleartext);

    expect(Buffer.from(ciphertext).toString("latin1")).not.toContain("local-roundtrip-canary");
    expect(Array.from(await protector.unprotect(ciphertext))).toEqual(Array.from(cleartext));
    expect((await stat(keyPath)).mode & 0o777).toBe(0o600);
    expect(Buffer.from((await readFile(keyPath, "utf8")).trim(), "base64")).toHaveLength(32);
  });

  it("decrypts with a second instance that reads the same key file and rejects a foreign key", async () => {
    const dir = await scratch();
    const keyPath = join(dir, "local-vault.key");
    const ciphertext = await new LocalKeyProtector({ keyPath }).protect(new TextEncoder().encode("shared"));

    expect(new TextDecoder().decode(await new LocalKeyProtector({ keyPath }).unprotect(ciphertext))).toBe("shared");
    await expect(new LocalKeyProtector({ keyPath: join(dir, "other.key") }).unprotect(ciphertext))
      .rejects.toMatchObject({ code: "INVALID_VAULT_RECORD" });
  });

  it("backs the SecretVault on non-Windows platforms", async () => {
    const dir = await scratch();
    const protector = createPlatformSecretProtector({ authRoot: dir, platform: "darwin" });
    expect(protector).toBeInstanceOf(LocalKeyProtector);
    expect(createPlatformSecretProtector({ authRoot: dir, platform: "win32" })).toBeInstanceOf(DpapiProtector);
    const vault = new SecretVault({ directory: join(dir, "vault"), protector });
    await vault.save("session-1", { kind: "TOKEN", value: "secret-token" });
    expect(await vault.load("session-1")).toEqual({ kind: "TOKEN", value: "secret-token" });
  });

  it("picks a platform-appropriate warp-cli default", () => {
    expect(defaultWarpCliPath("win32")).toMatch(/warp-cli\.exe$/u);
    expect(defaultWarpCliPath("darwin")).toBe("/usr/local/bin/warp-cli");
    expect(defaultWarpCliPath("linux")).toBe("/usr/bin/warp-cli");
  });
});
