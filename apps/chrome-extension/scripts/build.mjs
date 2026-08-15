import { cp, mkdir, readFile, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = resolve(root, "dist");
const repositoryRoot = resolve(root, "../..");
let installationKey = "";
try {
  installationKey = (await readFile(resolve(repositoryRoot, ".auth/chrome-bridge.key"), "utf8")).trim();
} catch { /* production/CI builds remain explicitly unconfigured */ }

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
await build({
  entryPoints: [resolve(root, "src/background.ts"), resolve(root, "src/popup.ts")],
  outdir: output,
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "chrome151",
  sourcemap: false,
  minify: true,
  legalComments: "none",
  define: { __CHROME_BRIDGE_DEFAULT_KEY__: JSON.stringify(installationKey) }
});
await cp(resolve(root, "public"), output, { recursive: true });
