import test from "node:test";
import assert from "node:assert/strict";
import { resolveApiNodeArgs, resolveLiveStackEnvironment, resolveWebMode } from "./live-stack-config.mjs";

test("explicit compiled dashboard mode keeps development available and rejects mistyped modes", () => {
  assert.equal(resolveWebMode({}), "development");
  assert.equal(resolveWebMode({ FIELDLINE_WEB_MODE: " development " }), "development");
  assert.equal(resolveWebMode({ FIELDLINE_WEB_MODE: " preview " }), "preview");
  assert.throws(() => resolveWebMode({ FIELDLINE_WEB_MODE: "production" }), /WEB_MODE_INVALID/u);
});

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

test("bounds the live API heap while allowing a safe explicit override", () => {
  assert.deepEqual(resolveApiNodeArgs({}), ["--max-old-space-size=512"]);
  assert.deepEqual(resolveApiNodeArgs({ FIELDLINE_API_MAX_OLD_SPACE_MB: "384" }),
    ["--max-old-space-size=384"]);
  assert.deepEqual(resolveApiNodeArgs({ FIELDLINE_API_MAX_OLD_SPACE_MB: "64" }),
    ["--max-old-space-size=512"]);
  assert.deepEqual(resolveApiNodeArgs({ FIELDLINE_API_MAX_OLD_SPACE_MB: "not-a-number" }),
    ["--max-old-space-size=512"]);
});

for (const megabytes of ["2048", "4096"]) {
  test(`honors the explicit ${megabytes} MB API heap setting`, () => {
    assert.deepEqual(resolveApiNodeArgs({ FIELDLINE_API_MAX_OLD_SPACE_MB: megabytes }),
      [`--max-old-space-size=${megabytes}`]);
  });
}

test("falls back to the default heap for oversized or invalid overrides", () => {
  for (const configured of ["4097", "8192", "10000", "2048.5", "-2048", "2e3", "NaN", ""]) {
    assert.deepEqual(resolveApiNodeArgs({ FIELDLINE_API_MAX_OLD_SPACE_MB: configured }),
      ["--max-old-space-size=512"], configured);
  }
});
