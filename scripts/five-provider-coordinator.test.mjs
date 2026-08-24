import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, rm, unlink, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { FiveProviderCoordinator } from "./five-provider-coordinator.mjs";

const execFileAsync = promisify(execFile);
const coordinatorModule = await import("./five-provider-coordinator.mjs");

const BUILD_ID = `sha256:${"a".repeat(64)}`;
const sourceId = (provider) => `chrome:${provider === "APSPORT" ? "TSPORT" :
  provider === "SBOBET" ? "KSPORT" : provider}:7`;

async function fixture(run) {
  const root = await mkdtemp(join(tmpdir(), "five-provider-coordinator-"));
  try { await run(new FiveProviderCoordinator({ root, now: () => 1_000 }), root); }
  finally { await rm(root, { recursive: true, force: true }); }
}

async function writeBuildTree(root, files = { "packages/contracts/dist/index.js": "contracts",
  "apps/api/dist/index.js": "api", "apps/chrome-extension/dist/background.js": "extension",
  "apps/web/dist/index.html": "web" }) {
  for (const [path, contents] of Object.entries(files)) {
    const absolute = join(root, ...path.split("/"));
    await mkdir(join(absolute, ".."), { recursive: true });
    await writeFile(absolute, contents, "utf8");
  }
}

async function cliFixture(run) {
  const root = await mkdtemp(join(tmpdir(), "five-provider-cli-"));
  const scripts = join(root, "scripts");
  const script = join(scripts, "five-provider-coordinator.mjs");
  try {
    await mkdir(scripts, { recursive: true });
    await copyFile(new URL("./five-provider-coordinator.mjs", import.meta.url), script);
    await writeBuildTree(root);
    const invoke = async (...args) => execFileAsync(process.execPath, [script, ...args], { cwd: root });
    await run({ root, invoke });
  } finally { await rm(root, { recursive: true, force: true }); }
}

test("allows five provider acceptances concurrently but excludes deployment", async () => fixture(async (coordinator) => {
  const deployment = await coordinator.claimDeployment("SABA", "root");
  await coordinator.releaseDeployment(deployment.token, BUILD_ID);
  const leases = [];
  for (const provider of ["SABA", "CMD", "APSPORT", "IM", "SBOBET"]) {
    leases.push(await coordinator.beginAcceptance(provider, `worker-${provider}`, sourceId(provider)));
  }
  assert.equal((await coordinator.status()).acceptances.length, 5);
  await assert.rejects(coordinator.claimDeployment("CMD", "worker-CMD"), /ACCEPTANCE_ACTIVE/u);
  for (const lease of leases) await coordinator.endAcceptance(lease.token);
  assert.equal((await coordinator.status()).acceptances.length, 0);
}));

test("grants one deployment lease and rejects a competing build or acceptance", async () => fixture(async (coordinator) => {
  const first = await coordinator.claimDeployment("SABA", "worker-SABA");
  await assert.rejects(coordinator.claimDeployment("CMD", "worker-CMD"), /DEPLOYMENT_ACTIVE/u);
  await assert.rejects(coordinator.beginAcceptance("IM", "worker-IM", sourceId("IM")), /DEPLOYMENT_ACTIVE/u);
  await coordinator.releaseDeployment(first.token, BUILD_ID);
  const second = await coordinator.claimDeployment("CMD", "worker-CMD");
  assert.equal(second.provider, "CMD");
}));

test("allows disjoint provider edits but freezes all edits during deployment", async () => fixture(async (coordinator) => {
  const edits = [];
  for (const provider of ["SABA", "CMD", "APSPORT", "IM", "SBOBET"]) {
    edits.push(await coordinator.beginEdit(provider, `worker-${provider}`));
  }
  assert.equal((await coordinator.status()).edits.length, 5);
  await assert.rejects(coordinator.claimDeployment("CMD", "worker-CMD"), /EDIT_ACTIVE/u);
  await assert.rejects(coordinator.beginEdit("CMD", "worker-CMD-2"), /PROVIDER_EDIT_ACTIVE/u);
  for (const lease of edits) await coordinator.endEdit(lease.token);

  const deployment = await coordinator.claimDeployment("CMD", "worker-CMD");
  await assert.rejects(coordinator.beginEdit("SABA", "worker-SABA"), /DEPLOYMENT_ACTIVE/u);
  await coordinator.releaseDeployment(deployment.token, BUILD_ID);
}));

test("expires abandoned leases without letting a wrong token release current ownership", async () => {
  const root = await mkdtemp(join(tmpdir(), "five-provider-coordinator-"));
  let now = 1_000;
  const coordinator = new FiveProviderCoordinator({ root, now: () => now });
  try {
    const first = await coordinator.claimDeployment("SABA", "worker-SABA", 1_000);
    await assert.rejects(coordinator.releaseDeployment("wrong-token"), /LEASE_TOKEN_MISMATCH/u);
    now = 2_001;
    const second = await coordinator.claimDeployment("CMD", "worker-CMD", 1_000);
    assert.notEqual(second.token, first.token);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("renews only a still-live exact lease token and never resurrects an expired holder", async () => {
  const root = await mkdtemp(join(tmpdir(), "five-provider-renew-"));
  let now = 1_000;
  const coordinator = new FiveProviderCoordinator({ root, now: () => now });
  try {
    const lease = await coordinator.beginEdit("SABA", "worker-SABA", 1_000);
    now = 1_500;
    await assert.rejects(coordinator.renewLease("wrong-token", 2_000), /LEASE_TOKEN_MISMATCH/u);
    const renewed = await coordinator.renewLease(lease.token, 2_000);
    assert.equal(renewed.token, lease.token);
    assert.equal(renewed.claimedAtMs, 1_500);
    assert.equal(renewed.expiresAtMs, 3_500);
    now = 3_501;
    await assert.rejects(coordinator.renewLease(lease.token, 2_000), /LEASE_TOKEN_MISMATCH/u);
    assert.equal((await coordinator.status()).edits.length, 0);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("renews an acceptance without changing its exact source or deployed artifact proof", async () => {
  const root = await mkdtemp(join(tmpdir(), "five-provider-renew-acceptance-"));
  let now = 1_000;
  const coordinator = new FiveProviderCoordinator({ root, now: () => now });
  try {
    const deployment = await coordinator.claimDeployment("SABA", "root");
    await coordinator.releaseDeployment(deployment.token, BUILD_ID);
    const acceptance = await coordinator.beginAcceptance("SABA", "worker-SABA", sourceId("SABA"));
    now = 2_000;
    const renewed = await coordinator.renewLease(acceptance.token, 15 * 60_000);
    assert.equal(renewed.sourceId, acceptance.sourceId);
    assert.equal(renewed.buildIdentity, acceptance.buildIdentity);
    assert.equal(renewed.deployedAtMs, acceptance.deployedAtMs);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("aborts a matching provider deployment without replacing the last successful build proof", async () => fixture(
  async (coordinator) => {
    const successful = await coordinator.claimDeployment("SABA", "worker-SABA");
    const lastDeployment = await coordinator.releaseDeployment(successful.token, BUILD_ID);
    const failed = await coordinator.claimDeployment("CMD", "worker-CMD");
    await coordinator.abortDeployment(failed.token);
    const status = await coordinator.status();
    assert.equal(status.deployment, null);
    assert.deepEqual(status.lastDeployment, lastDeployment);
  }));

test("does not abort a provider deployment for the wrong token", async () => fixture(async (coordinator) => {
  const deployment = await coordinator.claimDeployment("SABA", "worker-SABA");
  await assert.rejects(coordinator.abortDeployment("wrong-token"), /LEASE_TOKEN_MISMATCH/u);
  assert.equal((await coordinator.status()).deployment.token, deployment.token);
}));

test("does not treat a root integration lease as an abortable deployment", async () => fixture(
  async (coordinator) => {
    const integration = await coordinator.claimIntegration("root-integrator");
    await assert.rejects(coordinator.abortDeployment(integration.token), /LEASE_KIND_MISMATCH/u);
    assert.equal((await coordinator.status()).deployment.token, integration.token);
  }));

test("pins acceptance to the latest deployed artifacts and exact provider source", async () => fixture(
  async (coordinator) => {
    await assert.rejects(coordinator.beginAcceptance("SABA", "worker-SABA", sourceId("SABA")),
      /DEPLOYMENT_IDENTITY_REQUIRED/u);
    const deployment = await coordinator.claimDeployment("SABA", "root");
    await coordinator.releaseDeployment(deployment.token, BUILD_ID);
    await assert.rejects(coordinator.beginAcceptance("SABA", "worker-SABA", "chrome:SABA:007"),
      /INVALID_SOURCE_ID/u);
    await assert.rejects(coordinator.beginAcceptance("SABA", "worker-SABA", "chrome:CMD:7"),
      /INVALID_SOURCE_ID/u);
    const acceptance = await coordinator.beginAcceptance("SABA", "worker-SABA", sourceId("SABA"));
    assert.equal(acceptance.sourceId, sourceId("SABA"));
    assert.equal(acceptance.buildIdentity, BUILD_ID);
    assert.equal(acceptance.expiresAtMs - acceptance.claimedAtMs, 15 * 60_000);
    await assert.rejects(coordinator.beginEdit("SABA", "worker-SABA"), /PROVIDER_ACCEPTANCE_ACTIVE/u);
    const otherEdit = await coordinator.beginEdit("IM", "worker-IM");
    await coordinator.endEdit(otherEdit.token);
  }));

test("uses one root integration lease to close the Git staging race without changing deployment identity",
  async () => fixture(async (coordinator) => {
    const deployment = await coordinator.claimDeployment("SABA", "root");
    await coordinator.releaseDeployment(deployment.token, BUILD_ID);
    const integration = await coordinator.claimIntegration("root-integrator");
    await assert.rejects(coordinator.beginEdit("CMD", "worker-CMD"), /DEPLOYMENT_ACTIVE/u);
    await assert.rejects(coordinator.claimDeployment("CMD", "worker-CMD"), /DEPLOYMENT_ACTIVE/u);
    await assert.rejects(coordinator.beginAcceptance("CMD", "worker-CMD", sourceId("CMD")),
      /DEPLOYMENT_ACTIVE/u);
    await coordinator.releaseIntegration(integration.token);
    assert.equal((await coordinator.status()).lastDeployment.identity, BUILD_ID);
  }));

test("fails closed when the persisted coordination state is corrupt", async () => fixture(
  async (coordinator, root) => {
    await mkdir(root, { recursive: true });
    await writeFile(join(root, "coordination.json"), "{not-json", "utf8");
    await assert.rejects(coordinator.claimDeployment("CMD", "worker-CMD"), /COORDINATION_STATE_INVALID/u);
  }));

test("migrates only empty legacy v1 and v2 states to schema v3", async () => {
  for (const legacy of [
    { version: 1, deployment: null, acceptances: [] },
    { version: 2, deployment: null, edits: [], acceptances: [] }
  ]) {
    await fixture(async (coordinator, root) => {
      await writeFile(join(root, "coordination.json"), JSON.stringify(legacy), "utf8");
      assert.deepEqual(await coordinator.status(), { version: 3, deployment: null, lastDeployment: null,
        edits: [], acceptances: [] });
    });
  }
});

test("rejects a legacy acceptance that has no pinned source or build proof", async () => fixture(
  async (coordinator, root) => {
    const legacyAcceptance = { provider: "SABA", worker: "worker-SABA", token: "a".repeat(16),
      claimedAtMs: 1_000, expiresAtMs: 2_000 };
    await writeFile(join(root, "coordination.json"), JSON.stringify({ version: 2, deployment: null,
      edits: [], acceptances: [legacyAcceptance] }), "utf8");
    await assert.rejects(coordinator.status(), /COORDINATION_STATE_INVALID/u);
  }));

test("validates persisted v3 lease kinds and deployment proof before using state", async () => {
  const baseLease = { provider: "SABA", worker: "worker-SABA", token: "a".repeat(16),
    claimedAtMs: 1_000, expiresAtMs: 2_000 };
  const validProof = { identity: BUILD_ID, provider: "SABA", completedAtMs: 900 };
  const invalidStates = [
    { version: 3, deployment: null, lastDeployment: null,
      edits: [{ ...baseLease, provider: "ROOT" }], acceptances: [] },
    { version: 3, deployment: null, lastDeployment: validProof,
      edits: [], acceptances: [baseLease] },
    { version: 3, deployment: null, lastDeployment: { ...validProof, identity: "sha256:bad" },
      edits: [], acceptances: [] },
    { version: 3, deployment: { ...baseLease, sourceId: sourceId("SABA") }, lastDeployment: null,
      edits: [], acceptances: [] }
  ];
  for (const state of invalidStates) {
    await fixture(async (coordinator, root) => {
      await writeFile(join(root, "coordination.json"), JSON.stringify(state), "utf8");
      await assert.rejects(coordinator.status(), /COORDINATION_STATE_INVALID/u);
    });
  }
});

test("rejects legacy top-level fields with the wrong container type", async () => fixture(
  async (coordinator, root) => {
    await writeFile(join(root, "coordination.json"), JSON.stringify({ version: 1, deployment: null,
      acceptances: "" }), "utf8");
    await assert.rejects(coordinator.status(), /COORDINATION_STATE_INVALID/u);
  }));

test("computes one deterministic identity from every recursive build artifact", async () => {
  const firstRoot = await mkdtemp(join(tmpdir(), "five-provider-build-a-"));
  const secondRoot = await mkdtemp(join(tmpdir(), "five-provider-build-b-"));
  try {
    const files = { "apps/web/dist/nested/b.js": "B", "packages/contracts/dist/a.js": "A",
      "apps/chrome-extension/dist/background.js": "C", "apps/api/dist/index.js": "D" };
    await writeBuildTree(firstRoot, files);
    await writeBuildTree(secondRoot, Object.fromEntries(Object.entries(files).reverse()));
    const first = await coordinatorModule.computeBuildIdentity(firstRoot);
    const second = await coordinatorModule.computeBuildIdentity(secondRoot);
    assert.match(first, /^sha256:[a-f0-9]{64}$/u);
    assert.equal(second, first);
    await writeFile(join(secondRoot, "apps", "web", "dist", "nested", "b.js"), "changed", "utf8");
    assert.notEqual(await coordinatorModule.computeBuildIdentity(secondRoot), first);
  } finally {
    await rm(firstRoot, { recursive: true, force: true });
    await rm(secondRoot, { recursive: true, force: true });
  }
});

test("fails build identity closed when any artifact tree is missing or empty", async () => {
  const root = await mkdtemp(join(tmpdir(), "five-provider-build-invalid-"));
  try {
    await writeBuildTree(root);
    await rm(join(root, "apps", "web", "dist"), { recursive: true, force: true });
    await assert.rejects(coordinatorModule.computeBuildIdentity(root), /BUILD_ARTIFACTS_MISSING/u);
    await mkdir(join(root, "apps", "web", "dist"), { recursive: true });
    await assert.rejects(coordinatorModule.computeBuildIdentity(root), /BUILD_ARTIFACTS_EMPTY/u);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("release-deploy CLI records the identity computed from local artifacts", async () => cliFixture(
  async ({ root, invoke }) => {
    const claimed = JSON.parse((await invoke("claim-deploy", "SABA", "cli-worker")).stdout);
    await invoke("release-deploy", claimed.token);
    const status = JSON.parse((await invoke("status")).stdout);
    assert.equal(status.lastDeployment.identity, await coordinatorModule.computeBuildIdentity(root));
  }));

test("abort-deploy CLI releases a failed provider deployment without recording build proof", async () => cliFixture(
  async ({ invoke }) => {
    const claimed = JSON.parse((await invoke("claim-deploy", "SABA", "cli-worker")).stdout);
    await invoke("abort-deploy", claimed.token);
    const status = JSON.parse((await invoke("status")).stdout);
    assert.equal(status.deployment, null);
    assert.equal(status.lastDeployment, null);
  }));

test("CLI exposes integration leases and requires an exact source for 15-minute acceptance", async () => cliFixture(
  async ({ invoke }) => {
    const integration = JSON.parse((await invoke("claim-integration", "root-integrator")).stdout);
    await assert.rejects(invoke("begin-edit", "CMD", "cli-worker"), /DEPLOYMENT_ACTIVE/u);
    await invoke("release-integration", integration.token);
    const deployment = JSON.parse((await invoke("claim-deploy", "CMD", "cli-worker")).stdout);
    await invoke("release-deploy", deployment.token);
    await assert.rejects(invoke("begin-acceptance", "CMD", "cli-worker"), /INVALID_ARGUMENTS/u);
    const acceptance = JSON.parse((await invoke("begin-acceptance", "CMD", "cli-worker",
      "chrome:CMD:7")).stdout);
    assert.equal(acceptance.sourceId, "chrome:CMD:7");
    assert.equal(acceptance.expiresAtMs - acceptance.claimedAtMs, 15 * 60_000);
  }));

test("renew-lease CLI extends only the exact live token with strict arity", async () => cliFixture(
  async ({ invoke }) => {
    const lease = JSON.parse((await invoke("begin-edit", "CMD", "cli-worker", "1000")).stdout);
    const renewed = JSON.parse((await invoke("renew-lease", lease.token, "2000")).stdout);
    assert.equal(renewed.token, lease.token);
    assert.equal(renewed.expiresAtMs - renewed.claimedAtMs, 2_000);
    await assert.rejects(invoke("renew-lease"), /INVALID_ARGUMENTS/u);
    await assert.rejects(invoke("renew-lease", lease.token, "2000", "ignored"), /INVALID_ARGUMENTS/u);
  }));

test("CLI rejects command-specific trailing arguments instead of silently ignoring them", async () => cliFixture(
  async ({ invoke }) => {
    await assert.rejects(invoke("status", "ignored"), /INVALID_ARGUMENTS/u);
    await assert.rejects(invoke("claim-integration", "root-integrator", "60000", "ignored"),
      /INVALID_ARGUMENTS/u);
    await assert.rejects(invoke("abort-deploy"), /INVALID_ARGUMENTS/u);
    await assert.rejects(invoke("abort-deploy", "token", "ignored"), /INVALID_ARGUMENTS/u);
    await assert.rejects(invoke("unknown-command"), (error) => /USAGE:.*abort-deploy/u.test(error.stderr));
  }));

test("serializes concurrent deployment claims without a check/write race", async () => {
  const root = await mkdtemp(join(tmpdir(), "five-provider-concurrent-"));
  try {
    const left = new FiveProviderCoordinator({ root, now: () => 1_000 });
    const right = new FiveProviderCoordinator({ root, now: () => 1_000 });
    const results = await Promise.allSettled([
      left.claimDeployment("SABA", "worker-left"),
      right.claimDeployment("CMD", "worker-right")
    ]);
    assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
    const rejection = results.find((result) => result.status === "rejected");
    assert.match(rejection.reason.message, /DEPLOYMENT_ACTIVE/u);
    const persisted = JSON.parse(await readFile(join(root, "coordination.json"), "utf8"));
    assert.equal(persisted.version, 3);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("does not steal an old lock based on a racy age check", async () => {
  const root = await mkdtemp(join(tmpdir(), "five-provider-stale-lock-"));
  const lockPath = join(root, "coordination.lock");
  try {
    await writeFile(lockPath, "owner", "utf8");
    const old = new Date(Date.now() - 20_000);
    await utimes(lockPath, old, old);
    const coordinator = new FiveProviderCoordinator({ root, now: () => 1_000 });
    let settled = false;
    const claim = coordinator.claimDeployment("SABA", "worker-SABA").finally(() => { settled = true; });
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(settled, false);
    await unlink(lockPath);
    assert.equal((await claim).provider, "SABA");
  } finally { await rm(root, { recursive: true, force: true }); }
});
