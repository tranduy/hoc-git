export function resolveLiveStackEnvironment(environment, host, webPort) {
  const publicOrigin = environment.FIELDLINE_PUBLIC_ORIGIN?.trim();

  return {
    ...environment,
    NODE_ENV: "development",
    API_HOST: host,
    API_PORT: "4310",
    VITE_ORIGIN: publicOrigin || `http://${host}:${webPort}`,
    // The live stack reads provider tabs through the Chrome bridge. The
    // legacy minute timer launches private Playwright browsers to renew old
    // sessions, which duplicates readers and can grow a new Chromium process
    // tree on every retry. Keep it opt-in for troubleshooting only.
    SESSION_MAINTENANCE_ENABLED: environment.SESSION_MAINTENANCE_ENABLED?.trim() || "0"
  };
}
