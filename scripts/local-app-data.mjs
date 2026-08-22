import { homedir } from "node:os";
import { join } from "node:path";

// Mirrors apps/api/src/local-app-data.ts for the launcher scripts.
export function resolveLocalAppData(environment = process.env, platform = process.platform, home = homedir()) {
  const explicit = environment.LOCALAPPDATA?.trim();
  if (explicit) return explicit;
  if (platform === "win32") return null;
  if (platform === "darwin") return join(home, "Library", "Application Support");
  const xdg = environment.XDG_DATA_HOME?.trim();
  return xdg ? xdg : join(home, ".local", "share");
}
