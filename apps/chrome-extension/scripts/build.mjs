import { createHash } from "node:crypto";
import { cp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = resolve(root, "dist");
const repositoryRoot = resolve(root, "../..");
const cmdSnapshotSource = await readFile(resolve(root, "src/cmd-dom-snapshot.ts"), "utf8");
const cmdExpressionMatch = /export const CMD_PUBLIC_CATALOG_EXPRESSION = `([\s\S]*?)`;\s*$/u.exec(cmdSnapshotSource);
if (!cmdExpressionMatch) throw new Error("CMD capture expression not found");
const cmdExpression = Function(`"use strict"; return \`${cmdExpressionMatch[1]}\`;`)();
let installationKey = "";
try {
  installationKey = (await readFile(resolve(repositoryRoot, ".auth/chrome-bridge.key"), "utf8")).trim();
} catch { /* production/CI builds remain explicitly unconfigured */ }

// A build identity lets the running worker tell "this bundle is already mine"
// from "a newer bundle was deployed", so a reload request can never loop.
const sourceRoot = resolve(root, "src");
const sourceNames = (await readdir(sourceRoot)).filter((name) => name.endsWith(".ts")).sort();
const digest = createHash("sha256");
for (const name of sourceNames) {
  digest.update(name);
  digest.update(await readFile(resolve(sourceRoot, name)));
}
const buildIdentity = `sha256:${digest.digest("hex")}`;

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
  plugins: [{
    name: "inline-cmd-capture",
    setup(pluginBuild) {
      pluginBuild.onLoad({ filter: /page-observer\.ts$/ }, async (args) => ({
        contents: (await readFile(args.path, "utf8")).replace(
          "return __FIELDLINE_CMD_CAPTURE_EXPRESSION__;",
          `return (${cmdExpression});`
        ),
        loader: "ts"
      }));
    }
  }],
  define: {
    __CHROME_BRIDGE_DEFAULT_KEY__: JSON.stringify(installationKey),
    __CHROME_EXTENSION_BUILD_IDENTITY__: JSON.stringify(buildIdentity)
  }
});
// A declarative content script is classic script, not a module, so it cannot
// be bundled alongside the worker and the popup.
await build({
  entryPoints: [resolve(root, "src/lobby-heartbeat.ts")],
  outdir: output,
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "chrome151",
  sourcemap: false,
  minify: true,
  legalComments: "none"
});
await cp(resolve(root, "public"), output, { recursive: true });
// The API reads this to tell a running worker which bundle is deployed.
await writeFile(resolve(output, "build-identity.json"),
  `${JSON.stringify({ buildIdentity }, null, 2)}
`, "utf8");
process.stdout.write(`extension build ${buildIdentity}
`);
