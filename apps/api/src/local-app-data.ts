import { homedir } from "node:os";
import { posix } from "node:path";

/**
 * Resolves the per-user data root. Windows keeps the strict LOCALAPPDATA
 * contract. Other platforms accept an explicit LOCALAPPDATA (handy for tests
 * and fixture mode) and otherwise fall back to the platform convention so the
 * operator does not have to invent a Windows variable on macOS/Linux.
 */
export function resolveLocalAppData(
  env: Readonly<Record<string, string | undefined>>,
  platform: NodeJS.Platform = process.platform,
  home: string = homedir()
): string | null {
  const explicit = env.LOCALAPPDATA?.trim();
  if (explicit) return explicit;
  if (platform === "win32") return null;
  if (platform === "darwin") return posix.join(home, "Library", "Application Support");
  const xdg = env.XDG_DATA_HOME?.trim();
  return xdg ? xdg : posix.join(home, ".local", "share");
}
