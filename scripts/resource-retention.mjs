import { readdir, rm, stat } from "node:fs/promises";
import { basename, isAbsolute, join, relative, resolve } from "node:path";

const disposableBrowserDataNames = new Set([
  "browsermetrics",
  "cache",
  "code cache",
  "gpucache",
  "grshadercache",
  "shadercache"
]);
const ephemeralProfileName = /^(?:chrome|chromium|playwright)[-_]|(?:^|[-_])(?:probe|profile)(?:[-_]|$)/iu;

function within(root, candidate) {
  const path = relative(resolve(root), resolve(candidate));
  return path === "" || (!path.startsWith("..") && !isAbsolute(path));
}

async function pruneLogs(root, options, result) {
  let entries;
  try { entries = await readdir(root, { withFileTypes: true }); } catch { return; }
  for (const entry of entries) {
    const path = join(root, entry.name);
    if (!within(root, path)) continue;
    if (entry.isDirectory()) { await pruneLogs(path, options, result); continue; }
    if (!entry.isFile() || !/\.(?:log|jsonl)$/iu.test(entry.name)) continue;
    try {
      const metadata = await stat(path);
      if (metadata.size <= options.maxLogBytes && options.nowMs - metadata.mtimeMs <= options.maxLogAgeMs) continue;
      await rm(path, { force: true });
      result.removedFiles += 1;
      result.reclaimedBytes += metadata.size;
    } catch { /* cleanup is best-effort and never blocks the stack */ }
  }
}

async function pruneBrowserCaches(root, result) {
  let entries;
  try { entries = await readdir(root, { withFileTypes: true }); } catch { return; }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const path = join(root, entry.name);
    if (!within(root, path)) continue;
    const normalizedName = entry.name.toLocaleLowerCase("en");
    const disposable = disposableBrowserDataNames.has(normalizedName) ||
      (normalizedName === "reports" && basename(root).toLocaleLowerCase("en") === "crashpad");
    if (disposable) {
      try {
        const bytes = await directoryBytes(path);
        await rm(path, { recursive: true, force: true });
        result.removedFiles += 1;
        result.reclaimedBytes += bytes;
      }
      catch { /* a live profile may hold a cache lock; leave it for the next start */ }
      continue;
    }
    await pruneBrowserCaches(path, result);
  }
}

async function directoryBytes(root) {
  let entries;
  try { entries = await readdir(root, { withFileTypes: true }); } catch { return 0; }
  let bytes = 0;
  for (const entry of entries) {
    const path = join(root, entry.name);
    if (!within(root, path)) continue;
    if (entry.isDirectory()) bytes += await directoryBytes(path);
    else if (entry.isFile()) {
      try { bytes += (await stat(path)).size; } catch { /* file changed during cleanup */ }
    }
  }
  return bytes;
}

async function pruneEphemeralBrowserProfiles(runRoot, result) {
  let entries;
  try { entries = await readdir(runRoot, { withFileTypes: true }); } catch { return; }
  for (const entry of entries) {
    if (!entry.isDirectory() || !ephemeralProfileName.test(entry.name)) continue;
    const path = join(runRoot, entry.name);
    if (!within(runRoot, path)) continue;
    try { await rm(path, { recursive: true, force: true }); result.removedFiles += 1; }
    catch { /* the profile may still be locked; retry on the next managed start */ }
  }
}

export async function enforceToolResourceRetention({ repositoryRoot, localToolRoot, nowMs = Date.now(),
  maxLogBytes = 64 * 1024 * 1024, maxLogAgeMs = 3 * 24 * 60 * 60 * 1_000 }) {
  const result = { removedFiles: 0, reclaimedBytes: 0 };
  for (const root of [join(repositoryRoot, ".run"), join(repositoryRoot, ".auth", "run"),
    join(repositoryRoot, "artifacts"),
    join(localToolRoot, "logs"), join(localToolRoot, "chrome-bridge-captures")]) {
    await pruneLogs(root, { nowMs, maxLogBytes, maxLogAgeMs }, result);
  }
  for (const root of [join(repositoryRoot, ".auth", "browser-profiles"),
    join(localToolRoot, ".auth", "browser-profiles")]) await pruneBrowserCaches(root, result);
  await pruneEphemeralBrowserProfiles(join(repositoryRoot, ".run"), result);
  return result;
}
