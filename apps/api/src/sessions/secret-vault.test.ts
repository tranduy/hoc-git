import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SecretVault } from "./secret-vault.js";
import type { SecretProtector } from "./types.js";

const directories: string[] = [];

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "tool-chenh-vault-"));
  directories.push(directory);
  return directory;
}

const reversibleProtector: SecretProtector = {
  protect: async (value) => Uint8Array.from(value, (byte) => byte ^ 0x5a),
  unprotect: async (value) => Uint8Array.from(value, (byte) => byte ^ 0x5a)
};

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("SecretVault", () => {
  it("persists only ciphertext and survives reconstruction", async () => {
    const directory = await temporaryDirectory();
    const first = new SecretVault({ directory, protector: reversibleProtector });

    await first.save("fabet", { username: "secret-user", password: "secret-pass" });

    const disk = await readFile(join(directory, "vault.v1.json"), "utf8");
    expect(disk).not.toContain("secret-user");
    expect(disk).not.toContain("secret-pass");
    expect(disk).not.toContain("username");
    expect(disk).not.toContain("password");
    const second = new SecretVault({ directory, protector: reversibleProtector });
    expect(await second.load("fabet")).toEqual({ username: "secret-user", password: "secret-pass" });
    expect(await second.listIds()).toEqual(["fabet"]);
  });

  it("atomically replaces records and removes its temporary file", async () => {
    const directory = await temporaryDirectory();
    const vault = new SecretVault({ directory, protector: reversibleProtector });
    await vault.save("provider", { token: "first" });
    await vault.save("provider", { token: "second" });

    expect(await vault.load("provider")).toEqual({ token: "second" });
    await expect(readFile(join(directory, "vault.v1.json.tmp"), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("decrypts a requested record set through one batch protector call", async () => {
    const directory = await temporaryDirectory();
    const writer = new SecretVault({ directory, protector: reversibleProtector });
    await writer.save("one", { token: "first" });
    await writer.save("two", { token: "second" });
    let batchCalls = 0;
    const reader = new SecretVault({ directory, protector: {
      ...reversibleProtector,
      unprotectMany: async (values) => {
        batchCalls += 1;
        return Promise.all(values.map(reversibleProtector.unprotect));
      }
    } });

    expect(await reader.loadMany(["two", "missing", "one"])).toEqual([
      { token: "second" }, null, { token: "first" }
    ]);
    expect(batchCalls).toBe(1);
  });

  it("deletes records without affecting siblings", async () => {
    const directory = await temporaryDirectory();
    const vault = new SecretVault({ directory, protector: reversibleProtector });
    await vault.save("fabet", { token: "one" });
    await vault.save("saba", { token: "two" });

    await vault.delete("fabet");

    expect(await vault.has("fabet")).toBe(false);
    expect(await vault.load("fabet")).toBeNull();
    expect(await vault.has("saba")).toBe(true);
  });

  it("fails closed with a redacted error for corrupt ciphertext", async () => {
    const directory = await temporaryDirectory();
    await writeFile(join(directory, "vault.v1.json"), JSON.stringify({
      version: 1,
      records: { fabet: { ciphertextBase64: "corrupt-secret-canary" } }
    }), "utf8");
    const protector: SecretProtector = {
      protect: reversibleProtector.protect,
      unprotect: async () => { throw new Error("corrupt-secret-canary"); }
    };
    const vault = new SecretVault({ directory, protector });

    await expect(vault.load("fabet")).rejects.toMatchObject({ code: "VAULT_UNAVAILABLE" });
    await expect(vault.load("fabet")).rejects.not.toThrow(/corrupt-secret-canary/u);
  });

  it("rejects unsafe record identifiers", async () => {
    const vault = new SecretVault({ directory: await temporaryDirectory(), protector: reversibleProtector });
    await expect(vault.save("../escape", { token: "x" })).rejects.toMatchObject({ code: "INVALID_VAULT_RECORD" });
  });
});
