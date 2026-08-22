export function resolveInstallationKey(stored: unknown, bundled: string): string {
  const persisted = typeof stored === "string" ? stored.trim() : "";
  return persisted || bundled.trim();
}
