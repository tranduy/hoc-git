export function resolveWebMode(environment) {
  const mode = environment.FIELDLINE_WEB_MODE?.trim() || "development";
  if (mode !== "development" && mode !== "preview") throw new Error("WEB_MODE_INVALID");
  return mode;
}

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
  // Opt-in CPU profile. The API has sat at 82-91% of one core and nothing in
  // the diagnostics times a hop, so the hot code can only be named by
  // profiling the process. Off unless FIELDLINE_API_CPU_PROF_DIR is set.
  const profileDir = environment.FIELDLINE_API_CPU_PROF_DIR?.trim();
  const profiling = profileDir !== undefined && profileDir.length > 0
    ? ["--cpu-prof", "--cpu-prof-dir", profileDir] : [];
  const configured = environment.FIELDLINE_API_MAX_OLD_SPACE_MB?.trim();
  const megabytes = configured !== undefined && /^\d{3,4}$/u.test(configured)
    ? Number(configured)
    : 512;
  const bounded = Number.isSafeInteger(megabytes) && megabytes >= 192 && megabytes <= 4_096
    ? megabytes
    : 512;
  return [...profiling, `--max-old-space-size=${bounded}`];
}
