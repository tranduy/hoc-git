import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { enforceToolResourceRetention } from "./resource-retention.mjs";

test("removes oversized or expired tool logs and browser caches while preserving session data", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "tool-chenh-retention-"));
  context.after(async () => rm(root, { recursive: true, force: true }));
  const repositoryRoot = join(root, "repo");
  const localToolRoot = join(root, "local", "tool-chenh");
  const cache = join(localToolRoot, ".auth", "browser-profiles", "fabet", "Default", "Cache");
  const browserMetrics = join(localToolRoot, ".auth", "browser-profiles", "fabet", "BrowserMetrics");
  const crashReports = join(localToolRoot, ".auth", "browser-profiles", "fabet", "Crashpad", "reports");
  const ephemeralProfile = join(repositoryRoot, ".run", "chrome-ui-verify", "Default");
  const cookies = join(localToolRoot, ".auth", "browser-profiles", "fabet", "Default", "Cookies");
  await mkdir(join(repositoryRoot, ".run"), { recursive: true });
  await mkdir(join(repositoryRoot, ".auth", "run"), { recursive: true });
  await mkdir(join(repositoryRoot, "artifacts"), { recursive: true });
  await mkdir(join(localToolRoot, "logs"), { recursive: true });
  await mkdir(cache, { recursive: true });
  await mkdir(browserMetrics, { recursive: true });
  await mkdir(crashReports, { recursive: true });
  await mkdir(ephemeralProfile, { recursive: true });
  await writeFile(join(repositoryRoot, ".run", "huge.log"), "x".repeat(2_000));
  await writeFile(join(repositoryRoot, ".auth", "run", "huge.stderr.log"), "x".repeat(2_000));
  const expired = join(repositoryRoot, "artifacts", "expired.log");
  await writeFile(expired, "old");
  await utimes(expired, new Date(0), new Date(0));
  const retained = join(repositoryRoot, ".run", "current.log");
  await writeFile(retained, "current");
  await writeFile(join(localToolRoot, "logs", "catalog-changes.jsonl"), "y".repeat(2_000));
  await writeFile(join(cache, "data_0"), "cache");
  await writeFile(join(browserMetrics, "BrowserMetrics-1.pma"), "metrics");
  await writeFile(join(crashReports, "crash.dmp"), "crash");
  await writeFile(cookies, "session-cookie-data");
  await writeFile(join(ephemeralProfile, "Cookies"), "temporary-test-profile");

  const result = await enforceToolResourceRetention({ repositoryRoot, localToolRoot, nowMs: 100_000,
    maxLogBytes: 1_000, maxLogAgeMs: 50_000 });

  assert.equal(result.removedFiles, 8);
  await assert.rejects(stat(join(repositoryRoot, ".run", "huge.log")), { code: "ENOENT" });
  await assert.rejects(stat(join(repositoryRoot, ".auth", "run", "huge.stderr.log")), { code: "ENOENT" });
  await assert.rejects(stat(expired), { code: "ENOENT" });
  await assert.rejects(stat(join(localToolRoot, "logs", "catalog-changes.jsonl")), { code: "ENOENT" });
  await assert.rejects(stat(cache), { code: "ENOENT" });
  await assert.rejects(stat(browserMetrics), { code: "ENOENT" });
  await assert.rejects(stat(crashReports), { code: "ENOENT" });
  await assert.rejects(stat(join(repositoryRoot, ".run", "chrome-ui-verify")), { code: "ENOENT" });
  assert.equal(await readFile(retained, "utf8"), "current");
  assert.equal(await readFile(cookies, "utf8"), "session-cookie-data");
});
