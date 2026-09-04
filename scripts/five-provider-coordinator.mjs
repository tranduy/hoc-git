import { createHash, randomUUID } from "node:crypto";
import { open, mkdir, readFile, readdir, rename, stat, unlink, writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PROVIDERS = new Set(["SABA", "CMD", "APSPORT", "IM", "SBOBET", "BTI"]);
const EMPTY_STATE = Object.freeze({ version: 3, deployment: null, lastDeployment: null,
  edits: [], acceptances: [] });
const BUILD_ID_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const PROVIDER_LOBBIES = Object.freeze({ SABA: "SABA", CMD: "CMD", APSPORT: "TSPORT",
  IM: "IM", SBOBET: "KSPORT", BTI: "BTI" });
const BUILD_OUTPUT_DIRECTORIES = Object.freeze([
  "packages/contracts/dist", "apps/api/dist", "apps/chrome-extension/dist", "apps/web/dist"
]);
const BASE_LEASE_KEYS = Object.freeze(["claimedAtMs", "expiresAtMs", "provider", "token", "worker"]);
const ACCEPTANCE_LEASE_KEYS = Object.freeze([...BASE_LEASE_KEYS, "buildIdentity", "deployedAtMs", "sourceId"]);

const delay = (milliseconds) => new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));

export class FiveProviderCoordinator {
  #root;
  #now;

  constructor({ root, now = Date.now }) {
    this.#root = resolve(root);
    this.#now = now;
  }

  async claimDeployment(provider, worker, ttlMs = 15 * 60_000) {
    return this.#mutate((state, nowMs) => {
      const input = validLeaseInput(provider, worker, ttlMs);
      if (state.deployment !== null) throw new Error("DEPLOYMENT_ACTIVE");
      if (state.edits.length > 0) throw new Error("EDIT_ACTIVE");
      if (state.acceptances.length > 0) throw new Error("ACCEPTANCE_ACTIVE");
      const lease = leaseValue(input, nowMs);
      return [{ ...state, deployment: lease }, lease];
    });
  }

  async releaseDeployment(token, buildIdentity) {
    return this.#mutate((state, nowMs) => {
      if (state.deployment?.token !== token) throw new Error("LEASE_TOKEN_MISMATCH");
      if (state.deployment.provider === "ROOT") throw new Error("LEASE_KIND_MISMATCH");
      if (typeof buildIdentity !== "string" || !BUILD_ID_PATTERN.test(buildIdentity)) {
        throw new Error("INVALID_BUILD_IDENTITY");
      }
      const lastDeployment = { identity: buildIdentity, provider: state.deployment.provider,
        completedAtMs: nowMs };
      return [{ ...state, deployment: null, lastDeployment }, lastDeployment];
    });
  }

  async abortDeployment(token) {
    return this.#mutate((state) => {
      if (state.deployment?.token !== token) throw new Error("LEASE_TOKEN_MISMATCH");
      if (state.deployment.provider === "ROOT") throw new Error("LEASE_KIND_MISMATCH");
      return [{ ...state, deployment: null }, undefined];
    });
  }

  async claimIntegration(worker, ttlMs = 10 * 60_000) {
    return this.#mutate((state, nowMs) => {
      const input = validWorkerTtl(worker, ttlMs);
      if (state.deployment !== null) throw new Error("DEPLOYMENT_ACTIVE");
      if (state.edits.length > 0) throw new Error("EDIT_ACTIVE");
      if (state.acceptances.length > 0) throw new Error("ACCEPTANCE_ACTIVE");
      const lease = leaseValue({ provider: "ROOT", ...input }, nowMs);
      return [{ ...state, deployment: lease }, lease];
    });
  }

  async releaseIntegration(token) {
    return this.#mutate((state) => {
      if (state.deployment?.token !== token) throw new Error("LEASE_TOKEN_MISMATCH");
      if (state.deployment.provider !== "ROOT") throw new Error("LEASE_KIND_MISMATCH");
      return [{ ...state, deployment: null }, undefined];
    });
  }

  async beginEdit(provider, worker, ttlMs = 5 * 60_000) {
    return this.#mutate((state, nowMs) => {
      const input = validLeaseInput(provider, worker, ttlMs);
      if (state.deployment !== null) throw new Error("DEPLOYMENT_ACTIVE");
      if (state.edits.some((lease) => lease.provider === input.provider)) {
        throw new Error("PROVIDER_EDIT_ACTIVE");
      }
      if (state.acceptances.some((lease) => lease.provider === input.provider)) {
        throw new Error("PROVIDER_ACCEPTANCE_ACTIVE");
      }
      const lease = leaseValue(input, nowMs);
      return [{ ...state, edits: [...state.edits, lease] }, lease];
    });
  }

  async endEdit(token) {
    return this.#mutate((state) => {
      if (!state.edits.some((lease) => lease.token === token)) throw new Error("LEASE_TOKEN_MISMATCH");
      return [{ ...state, edits: state.edits.filter((lease) => lease.token !== token) }, undefined];
    });
  }

  async beginAcceptance(provider, worker, sourceId, ttlMs = 15 * 60_000) {
    return this.#mutate((state, nowMs) => {
      const input = validLeaseInput(provider, worker, ttlMs);
      if (!validProviderSourceId(sourceId, input.provider)) throw new Error("INVALID_SOURCE_ID");
      if (state.deployment !== null) throw new Error("DEPLOYMENT_ACTIVE");
      if (state.lastDeployment === null) throw new Error("DEPLOYMENT_IDENTITY_REQUIRED");
      if (state.edits.some((lease) => lease.provider === input.provider)) throw new Error("PROVIDER_EDIT_ACTIVE");
      if (state.acceptances.some((lease) => lease.provider === input.provider)) {
        throw new Error("PROVIDER_ACCEPTANCE_ACTIVE");
      }
      const lease = { ...leaseValue(input, nowMs), sourceId,
        buildIdentity: state.lastDeployment.identity, deployedAtMs: state.lastDeployment.completedAtMs };
      return [{ ...state, acceptances: [...state.acceptances, lease] }, lease];
    });
  }

  async endAcceptance(token) {
    return this.#mutate((state) => {
      if (!state.acceptances.some((lease) => lease.token === token)) throw new Error("LEASE_TOKEN_MISMATCH");
      return [{ ...state, acceptances: state.acceptances.filter((lease) => lease.token !== token) }, undefined];
    });
  }

  async renewLease(token, ttlMs = 15 * 60_000) {
    return this.#mutate((state, nowMs) => {
      const ttl = validTtl(ttlMs);
      const renew = (lease) => ({ ...lease, claimedAtMs: nowMs, expiresAtMs: nowMs + ttl });
      if (state.deployment?.token === token) {
        const lease = renew(state.deployment);
        return [{ ...state, deployment: lease }, lease];
      }
      const editIndex = state.edits.findIndex((lease) => lease.token === token);
      if (editIndex >= 0) {
        const lease = renew(state.edits[editIndex]);
        return [{ ...state, edits: state.edits.map((entry, index) => index === editIndex ? lease : entry) }, lease];
      }
      const acceptanceIndex = state.acceptances.findIndex((lease) => lease.token === token);
      if (acceptanceIndex >= 0) {
        const lease = renew(state.acceptances[acceptanceIndex]);
        return [{ ...state, acceptances: state.acceptances.map((entry, index) =>
          index === acceptanceIndex ? lease : entry) }, lease];
      }
      throw new Error("LEASE_TOKEN_MISMATCH");
    });
  }

  async status() {
    return this.#mutate((state) => [state, state]);
  }

  async #mutate(operation) {
    await mkdir(this.#root, { recursive: true });
    const lockPath = resolve(this.#root, "coordination.lock");
    const statePath = resolve(this.#root, "coordination.json");
    const lock = await acquireFileLock(lockPath);
    try {
      const nowMs = this.#now();
      const current = pruneExpired(await readState(statePath), nowMs);
      const [next, result] = operation(current, nowMs);
      const temporary = resolve(this.#root, `coordination.${process.pid}.${randomUUID()}.tmp`);
      await writeFile(temporary, `${JSON.stringify(next)}\n`, "utf8");
      await rename(temporary, statePath);
      return result;
    } finally {
      await lock.close();
      await unlink(lockPath).catch(() => undefined);
    }
  }
}

export async function computeBuildIdentity(repositoryRoot) {
  const root = resolve(repositoryRoot);
  const artifacts = [];
  for (const directory of BUILD_OUTPUT_DIRECTORIES) {
    const directoryFiles = await collectArtifactFiles(root, directory);
    if (directoryFiles.length === 0) throw new Error("BUILD_ARTIFACTS_EMPTY");
    artifacts.push(...directoryFiles);
  }
  artifacts.sort((left, right) => left.relativePath < right.relativePath ? -1 :
    left.relativePath > right.relativePath ? 1 : 0);
  const hash = createHash("sha256");
  for (const artifact of artifacts) {
    let contents;
    try { contents = await readFile(artifact.absolutePath); }
    catch { throw new Error("BUILD_ARTIFACTS_UNAVAILABLE"); }
    const pathBytes = Buffer.from(artifact.relativePath, "utf8");
    hash.update(`${pathBytes.length}:`);
    hash.update(pathBytes);
    hash.update(`:${contents.length}:`);
    hash.update(contents);
  }
  return `sha256:${hash.digest("hex")}`;
}

export function validateFiveProviderCoordinatorStatus(value, nowMs = Date.now()) {
  if (!Number.isSafeInteger(nowMs) || nowMs < 0) throw new Error("INVALID_COORDINATION_STATE");
  try { return pruneExpired(migrateAndValidateState(value), nowMs); }
  catch { throw new Error("INVALID_COORDINATION_STATE"); }
}

async function collectArtifactFiles(repositoryRoot, relativeDirectory) {
  const absoluteDirectory = resolve(repositoryRoot, ...relativeDirectory.split("/"));
  const files = [];
  async function visit(directory) {
    let entries;
    try { entries = await readdir(directory, { withFileTypes: true }); }
    catch (error) {
      if (error instanceof Error && Object.hasOwn(error, "code") &&
        ["ENOENT", "ENOTDIR"].includes(error.code)) throw new Error("BUILD_ARTIFACTS_MISSING");
      throw new Error("BUILD_ARTIFACTS_UNAVAILABLE");
    }
    entries.sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0);
    for (const entry of entries) {
      const absolutePath = resolve(directory, entry.name);
      if (entry.isDirectory()) await visit(absolutePath);
      else if (entry.isFile()) files.push({ absolutePath,
        relativePath: relative(repositoryRoot, absolutePath).replaceAll("\\", "/") });
      else throw new Error("BUILD_ARTIFACTS_INVALID");
    }
  }
  await visit(absoluteDirectory);
  return files;
}

function validLeaseInput(provider, worker, ttlMs) {
  if (!PROVIDERS.has(provider)) throw new Error("UNKNOWN_PROVIDER");
  return { provider, ...validWorkerTtl(worker, ttlMs) };
}

function validWorkerTtl(worker, ttlMs) {
  if (typeof worker !== "string" || !/^[a-z0-9._-]{1,80}$/iu.test(worker)) throw new Error("INVALID_WORKER");
  return { worker, ttlMs: validTtl(ttlMs) };
}

function validTtl(ttlMs) {
  if (!Number.isSafeInteger(ttlMs) || ttlMs < 1_000 || ttlMs > 30 * 60_000) throw new Error("INVALID_TTL");
  return ttlMs;
}

function leaseValue(input, nowMs) {
  return { provider: input.provider, worker: input.worker, token: randomUUID(),
    claimedAtMs: nowMs, expiresAtMs: nowMs + input.ttlMs };
}

function pruneExpired(state, nowMs) {
  return { version: 3,
    deployment: state.deployment !== null && state.deployment.expiresAtMs > nowMs ? state.deployment : null,
    lastDeployment: state.lastDeployment,
    edits: state.edits.filter((lease) => lease.expiresAtMs > nowMs),
    acceptances: state.acceptances.filter((lease) => lease.expiresAtMs > nowMs) };
}

async function readState(path) {
  let raw;
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    if (error instanceof Error && Object.hasOwn(error, "code") && error.code === "ENOENT") {
      return { ...EMPTY_STATE };
    }
    throw new Error("COORDINATION_STATE_UNAVAILABLE");
  }
  try {
    const parsed = JSON.parse(raw);
    return migrateAndValidateState(parsed);
  } catch {
    throw new Error("COORDINATION_STATE_INVALID");
  }
}

function migrateAndValidateState(value) {
  if (!plainObject(value) || ![1, 2, 3].includes(value.version)) throw new Error("INVALID");
  if (value.version === 1) {
    if (!exactKeys(value, ["acceptances", "deployment", "version"]) ||
      !Array.isArray(value.acceptances) || value.acceptances.length !== 0 ||
      (value.deployment !== null && !validBaseLease(value.deployment, PROVIDERS))) throw new Error("INVALID");
    return validateV3State({ ...EMPTY_STATE, deployment: value.deployment });
  }
  if (value.version === 2) {
    if (!exactKeys(value, ["acceptances", "deployment", "edits", "version"]) ||
      !Array.isArray(value.acceptances) || value.acceptances.length !== 0 || !Array.isArray(value.edits) ||
      !value.edits.every((lease) => validBaseLease(lease, PROVIDERS)) ||
      (value.deployment !== null && !validBaseLease(value.deployment, PROVIDERS))) throw new Error("INVALID");
    return validateV3State({ ...EMPTY_STATE, deployment: value.deployment, edits: value.edits });
  }
  return validateV3State(value);
}

function validateV3State(value) {
  if (!exactKeys(value, ["acceptances", "deployment", "edits", "lastDeployment", "version"]) ||
    value.version !== 3 || !Array.isArray(value.edits) || !Array.isArray(value.acceptances) ||
    (value.deployment !== null && !validBaseLease(value.deployment, new Set([...PROVIDERS, "ROOT"]))) ||
    !value.edits.every((lease) => validBaseLease(lease, PROVIDERS)) ||
    !value.acceptances.every(validAcceptanceLease) || !validLastDeployment(value.lastDeployment)) {
    throw new Error("INVALID");
  }
  if (value.deployment !== null && (value.edits.length > 0 || value.acceptances.length > 0)) {
    throw new Error("INVALID");
  }
  const editProviders = value.edits.map((lease) => lease.provider);
  const acceptanceProviders = value.acceptances.map((lease) => lease.provider);
  if (new Set(editProviders).size !== editProviders.length ||
    new Set(acceptanceProviders).size !== acceptanceProviders.length ||
    editProviders.some((provider) => acceptanceProviders.includes(provider))) throw new Error("INVALID");
  const leases = [...(value.deployment === null ? [] : [value.deployment]), ...value.edits, ...value.acceptances];
  if (new Set(leases.map((lease) => lease.token)).size !== leases.length) throw new Error("INVALID");
  if (value.acceptances.length > 0 && (value.lastDeployment === null ||
    value.acceptances.some((lease) => lease.buildIdentity !== value.lastDeployment.identity ||
      lease.deployedAtMs !== value.lastDeployment.completedAtMs))) throw new Error("INVALID");
  return { version: 3, deployment: value.deployment, lastDeployment: value.lastDeployment,
    edits: value.edits, acceptances: value.acceptances };
}

function validBaseLease(value, providers) {
  return exactKeys(value, BASE_LEASE_KEYS) && providers.has(value.provider) &&
    typeof value.worker === "string" && /^[a-z0-9._-]{1,80}$/iu.test(value.worker) &&
    typeof value.token === "string" && value.token.length >= 16 && value.token.length <= 80 &&
    Number.isSafeInteger(value.claimedAtMs) && Number.isSafeInteger(value.expiresAtMs) &&
    value.claimedAtMs >= 0 && value.expiresAtMs > value.claimedAtMs &&
    value.expiresAtMs - value.claimedAtMs <= 30 * 60_000;
}

function validAcceptanceLease(value) {
  return exactKeys(value, ACCEPTANCE_LEASE_KEYS) && validBaseLeaseShape(value, PROVIDERS) &&
    validProviderSourceId(value.sourceId, value.provider) && BUILD_ID_PATTERN.test(value.buildIdentity) &&
    Number.isSafeInteger(value.deployedAtMs) && value.deployedAtMs >= 0 && value.deployedAtMs <= value.claimedAtMs;
}

function validBaseLeaseShape(value, providers) {
  return plainObject(value) && providers.has(value.provider) &&
    typeof value.worker === "string" && /^[a-z0-9._-]{1,80}$/iu.test(value.worker) &&
    typeof value.token === "string" && value.token.length >= 16 && value.token.length <= 80 &&
    Number.isSafeInteger(value.claimedAtMs) && value.claimedAtMs >= 0 &&
    Number.isSafeInteger(value.expiresAtMs) && value.expiresAtMs > value.claimedAtMs &&
    value.expiresAtMs - value.claimedAtMs <= 30 * 60_000;
}

function validLastDeployment(value) {
  return value === null || (exactKeys(value, ["completedAtMs", "identity", "provider"]) &&
    PROVIDERS.has(value.provider) && typeof value.identity === "string" && BUILD_ID_PATTERN.test(value.identity) &&
    Number.isSafeInteger(value.completedAtMs) && value.completedAtMs >= 0);
}

function validProviderSourceId(value, provider) {
  if (typeof value !== "string" ||
    !new RegExp(`^chrome:${PROVIDER_LOBBIES[provider]}:[0-9]+$`, "u").test(value)) return false;
  const tabId = Number(value.split(":").at(-1));
  return Number.isSafeInteger(tabId) && tabId >= 0 && value === `chrome:${PROVIDER_LOBBIES[provider]}:${tabId}`;
}

function exactKeys(value, keys) {
  return plainObject(value) && Object.keys(value).sort().join("\u0000") === [...keys].sort().join("\u0000");
}

function plainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

async function acquireFileLock(path) {
  const deadlineMs = Date.now() + 5_000;
  while (true) {
    try { return await open(path, "wx"); }
    catch (error) {
      if (!(error instanceof Error) || !Object.hasOwn(error, "code")) throw error;
      const isExistingLock = error.code === "EEXIST" || (error.code === "EPERM" &&
        await stat(path).then(() => true).catch(() => false));
      if (!isExistingLock) throw error;
      if (Date.now() >= deadlineMs) throw new Error("COORDINATION_BUSY");
      await delay(10);
    }
  }
}

async function main() {
  const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const coordinator = new FiveProviderCoordinator({ root: resolve(repositoryRoot, ".run", "five-provider") });
  const [command, ...args] = process.argv.slice(2);
  const arities = { "claim-deploy": [2, 3], "release-deploy": [1, 1], "abort-deploy": [1, 1],
    "renew-lease": [1, 2],
    "claim-integration": [1, 2], "release-integration": [1, 1], "begin-edit": [2, 3], "end-edit": [1, 1],
    "begin-acceptance": [3, 4], "end-acceptance": [1, 1], status: [0, 0] };
  const arity = arities[command];
  if (arity !== undefined && (args.length < arity[0] || args.length > arity[1])) {
    throw new Error("INVALID_ARGUMENTS");
  }
  const [first, second, third, fourth] = args;
  let value;
  if (command === "claim-deploy") value = await coordinator.claimDeployment(first, second, optionalTtl(third));
  else if (command === "release-deploy") {
    const buildIdentity = await computeBuildIdentity(repositoryRoot);
    value = await coordinator.releaseDeployment(first, buildIdentity);
  }
  else if (command === "abort-deploy") value = await coordinator.abortDeployment(first);
  else if (command === "renew-lease") value = await coordinator.renewLease(first, optionalTtl(second));
  else if (command === "claim-integration") value = await coordinator.claimIntegration(first,
    optionalTtl(second, 10 * 60_000));
  else if (command === "release-integration") value = await coordinator.releaseIntegration(first);
  else if (command === "begin-edit") value = await coordinator.beginEdit(first, second, optionalTtl(third, 5 * 60_000));
  else if (command === "end-edit") value = await coordinator.endEdit(first);
  else if (command === "begin-acceptance") value = await coordinator.beginAcceptance(first, second, third,
    optionalTtl(fourth));
  else if (command === "end-acceptance") value = await coordinator.endAcceptance(first);
  else if (command === "status") value = await coordinator.status();
  else throw new Error("USAGE: claim-deploy|release-deploy|abort-deploy|renew-lease|claim-integration|release-integration|" +
    "begin-edit|end-edit|begin-acceptance|end-acceptance|status");
  process.stdout.write(`${JSON.stringify(value ?? { ok: true })}\n`);
}

function optionalTtl(value, fallback = 15 * 60_000) {
  return value === undefined ? fallback : Number(value);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
