import test from "node:test";
import assert from "node:assert/strict";
import { resolveLiveStackEnvironment } from "./live-stack-config.mjs";

test("uses the public dashboard origin only when explicitly configured", () => {
  const local = resolveLiveStackEnvironment({}, "127.0.0.1", 4311);
  const publicDashboard = resolveLiveStackEnvironment(
    { FIELDLINE_PUBLIC_ORIGIN: "https://live.babiesbo.uk" },
    "127.0.0.1",
    4311
  );

  assert.equal(local.VITE_ORIGIN, "http://127.0.0.1:4311");
  assert.equal(publicDashboard.VITE_ORIGIN, "https://live.babiesbo.uk");
  assert.equal(publicDashboard.API_HOST, "127.0.0.1");
  assert.equal(publicDashboard.API_PORT, "4310");
});

test("disables legacy browser maintenance by default for the Chrome bridge stack", () => {
  const defaults = resolveLiveStackEnvironment({}, "127.0.0.1", 4311);
  const explicit = resolveLiveStackEnvironment(
    { SESSION_MAINTENANCE_ENABLED: "1" },
    "127.0.0.1",
    4311
  );

  assert.equal(defaults.SESSION_MAINTENANCE_ENABLED, "0");
  assert.equal(explicit.SESSION_MAINTENANCE_ENABLED, "1");
});
