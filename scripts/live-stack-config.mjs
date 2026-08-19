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

export function resolveApiNodeArgs(environment) {
  const configured = environment.FIELDLINE_API_MAX_OLD_SPACE_MB?.trim();
  const megabytes = configured !== undefined && /^\d{3,4}$/u.test(configured)
    ? Number(configured)
    : 256;
  const bounded = Number.isSafeInteger(megabytes) && megabytes >= 192 && megabytes <= 1_024
    ? megabytes
    : 256;
  return [`--max-old-space-size=${bounded}`];
}
