import { join } from "node:path";
import { DpapiProtector } from "./dpapi-protector.js";
import { LocalKeyProtector } from "./local-key-protector.js";
import type { SecretProtector } from "./types.js";

/**
 * Windows keeps the DPAPI protector (bound to the signed-in Windows user).
 * Every other platform uses the AES-GCM file-key protector so the same API,
 * vault layout and operator flow work on macOS/Linux.
 */
export function createPlatformSecretProtector(options: {
  readonly authRoot: string;
  readonly platform?: NodeJS.Platform;
}): SecretProtector {
  const platform = options.platform ?? process.platform;
  if (platform === "win32") return new DpapiProtector();
  return new LocalKeyProtector({ keyPath: join(options.authRoot, "local-vault.key") });
}

export function defaultWarpCliPath(platform: NodeJS.Platform = process.platform): string {
  if (platform === "win32") return "C:\\Program Files\\Cloudflare\\Cloudflare WARP\\warp-cli.exe";
  if (platform === "darwin") return "/usr/local/bin/warp-cli";
  return "/usr/bin/warp-cli";
}
