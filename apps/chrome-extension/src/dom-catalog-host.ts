export function supportsDomCatalogCapture(hostname: string): boolean {
  const normalized = hostname.trim().toLowerCase();
  return normalized === "cgnew.fts368.com" || /^c0z0o[a-z0-9]+\.bp[a-z0-9]+\.com$/u.test(normalized);
}
