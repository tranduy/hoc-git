import { cp, mkdir, readFile, rm } from "node:fs/promises";
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
  define: { __CHROME_BRIDGE_DEFAULT_KEY__: JSON.stringify(installationKey) }
});
await cp(resolve(root, "public"), output, { recursive: true });
