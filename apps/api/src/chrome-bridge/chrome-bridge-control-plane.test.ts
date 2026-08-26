import { describe, expect, it, vi } from "vitest";
import { ChromeBridgeControlPlane } from "./chrome-bridge-control-plane.js";
import { ProviderAuthorityCoordinator } from "./provider-authority-coordinator.js";
import type { AuthorityIdentity, CatalogCommitProof } from "./provider-authority-types.js";

const SABA_ACCOUNT = "catalog-source:SABA:FOOTBALL" as const;

function proof(cursor: bigint): CatalogCommitProof {
  return { authorityCursor: cursor, provenance: "WS", contentClass: "FOOTBALL", completeness: "COMPLETE",
    scope: "ACCOUNT", completedPartitions: ["SABA"], emptyProof: "PROVIDER_CONFIRMED_EMPTY",
    catalog: { dataMode: "LIVE", accountId: SABA_ACCOUNT, provider: "SABA", category: "FOOTBALL",
      comparisonState: "AWAITING_SECOND_PROVIDER", observedAtMs: Number(cursor), rejectedMarketCount: 0,
      events: [], markets: [], quotes: [] } };
}

describe("ChromeBridgeControlPlane", () => {
  it("keeps routine control on active authority and explicitly addresses one candidate bootstrap", () => {
    const coordinator = new ProviderAuthorityCoordinator();
    const plane = new ChromeBridgeControlPlane({ authorityCoordinator: coordinator });
    const activeSocket = { send: vi.fn(), readyState: 1 };
    const candidateSocket = { send: vi.fn(), readyState: 1 };
    const activeIdentity: AuthorityIdentity = { accountId: SABA_ACCOUNT, sourceId: "chrome:SABA:1",
      sourceEpoch: "observer-a:0", connectionGeneration: 1 };
    const first = coordinator.observe(activeIdentity, "CANDIDATE_DATA");
    if (first.disposition !== "CANDIDATE") throw new Error("expected candidate");
    plane.attachAuthority(activeIdentity, first, "SABA", activeSocket);

    expect(plane.requestAllSnapshots()).toBe(0);
    expect(plane.requestCandidateSnapshot(first.token)).toBe(1);
    expect(activeSocket.send).toHaveBeenCalledWith(JSON.stringify({ version: 1, kind: "REQUEST_SNAPSHOT",
      sourceId: "chrome:SABA:1" }));
    coordinator.promote(first.token, proof(1n));
    expect(plane.requestAllSnapshots()).toBe(1);

    const nextIdentity: AuthorityIdentity = { accountId: SABA_ACCOUNT, sourceId: "chrome:SABA:2",
      sourceEpoch: "observer-b:0", connectionGeneration: 2 };
    const next = coordinator.observe(nextIdentity, "TRANSPORT");
    if (next.disposition !== "CANDIDATE") throw new Error("expected candidate");
    plane.attachAuthority(nextIdentity, next, "SABA", candidateSocket);
    activeSocket.send.mockClear();
    expect(plane.requestAllSnapshots()).toBe(1);
    expect(activeSocket.send).toHaveBeenCalledOnce();
    expect(candidateSocket.send).not.toHaveBeenCalled();

    coordinator.promote(next.token, proof(2n));
    plane.detach(activeSocket);
    activeSocket.send.mockClear();
    expect(plane.requestAllSnapshots()).toBe(1);
    expect(candidateSocket.send).toHaveBeenCalledWith(JSON.stringify({ version: 1, kind: "REQUEST_SNAPSHOT",
      sourceId: "chrome:SABA:2" }));
    expect(activeSocket.send).not.toHaveBeenCalled();
  });

  it("keeps exact routine snapshot control active-only while candidate bootstrap requires its token", () => {
    const coordinator = new ProviderAuthorityCoordinator();
    const plane = new ChromeBridgeControlPlane({ authorityCoordinator: coordinator });
    const activeSocket = { send: vi.fn(), readyState: 1 };
    const candidateSocket = { send: vi.fn(), readyState: 1 };
    const replacementSocket = { send: vi.fn(), readyState: 1 };
    const activeIdentity: AuthorityIdentity = { accountId: SABA_ACCOUNT, sourceId: "chrome:SABA:1",
      sourceEpoch: "observer-a:0", connectionGeneration: 1 };
    const first = coordinator.observe(activeIdentity, "CANDIDATE_DATA");
    if (first.disposition !== "CANDIDATE") throw new Error("expected candidate");
    plane.attachAuthority(activeIdentity, first, "SABA", activeSocket);
    coordinator.promote(first.token, proof(1n));

    const candidateIdentity: AuthorityIdentity = { accountId: SABA_ACCOUNT, sourceId: "chrome:SABA:2",
      sourceEpoch: "observer-b:0", connectionGeneration: 2 };
    const candidate = coordinator.observe(candidateIdentity, "CANDIDATE_DATA");
    if (candidate.disposition !== "CANDIDATE") throw new Error("expected candidate");
    plane.attachAuthority(candidateIdentity, candidate, "SABA", candidateSocket);

    expect(plane.requestSourceSnapshot("chrome:SABA:2")).toBe(0);
    expect(candidateSocket.send).not.toHaveBeenCalled();
    expect(plane.requestCandidateSnapshot(candidate.token)).toBe(1);
    expect(candidateSocket.send).toHaveBeenCalledExactlyOnceWith(JSON.stringify({
      version: 1, kind: "REQUEST_SNAPSHOT", sourceId: "chrome:SABA:2"
    }));
    expect(activeSocket.send).not.toHaveBeenCalled();
    expect(plane.requestSourceSnapshot("chrome:SABA:1")).toBe(1);
    expect(activeSocket.send).toHaveBeenCalledExactlyOnceWith(JSON.stringify({
      version: 1, kind: "REQUEST_SNAPSHOT", sourceId: "chrome:SABA:1"
    }));

    const replacementIdentity: AuthorityIdentity = { accountId: SABA_ACCOUNT, sourceId: "chrome:SABA:3",
      sourceEpoch: "observer-c:0", connectionGeneration: 3 };
    const replacement = coordinator.observe(replacementIdentity, "CANDIDATE_DATA");
    if (replacement.disposition !== "CANDIDATE") throw new Error("expected replacement candidate");
    plane.attachAuthority(replacementIdentity, replacement, "SABA", replacementSocket);

    expect(plane.requestSourceSnapshot("chrome:SABA:2")).toBe(0);
    expect(plane.requestSourceSnapshot("chrome:SABA:999")).toBe(0);
    expect(plane.requestSourceSnapshot("chrome:SABA:3")).toBe(0);
    expect(plane.requestCandidateSnapshot(replacement.token)).toBe(1);
    expect(replacementSocket.send).toHaveBeenCalledExactlyOnceWith(JSON.stringify({
      version: 1, kind: "REQUEST_SNAPSHOT", sourceId: "chrome:SABA:3"
    }));
  });

  it("reloads only an exact active or current candidate source", () => {
    const coordinator = new ProviderAuthorityCoordinator();
    const plane = new ChromeBridgeControlPlane({ authorityCoordinator: coordinator });
    const activeSocket = { send: vi.fn(), readyState: 1 };
    const candidateSocket = { send: vi.fn(), readyState: 1 };
    const replacementSocket = { send: vi.fn(), readyState: 1 };
    const activeIdentity: AuthorityIdentity = { accountId: SABA_ACCOUNT, sourceId: "chrome:SABA:1",
      sourceEpoch: "observer-a:0", connectionGeneration: 1 };
    const first = coordinator.observe(activeIdentity, "CANDIDATE_DATA");
    if (first.disposition !== "CANDIDATE") throw new Error("expected candidate");
    plane.attachAuthority(activeIdentity, first, "SABA", activeSocket);
    coordinator.promote(first.token, proof(1n));

    const candidateIdentity: AuthorityIdentity = { accountId: SABA_ACCOUNT, sourceId: "chrome:SABA:2",
      sourceEpoch: "observer-b:0", connectionGeneration: 2 };
    const candidate = coordinator.observe(candidateIdentity, "CANDIDATE_DATA");
    if (candidate.disposition !== "CANDIDATE") throw new Error("expected candidate");
    plane.attachAuthority(candidateIdentity, candidate, "SABA", candidateSocket);

    expect(plane.reloadSource("chrome:SABA:1")).toBe(1);
    expect(activeSocket.send).toHaveBeenCalledExactlyOnceWith(JSON.stringify({
      version: 1, kind: "RELOAD_SOURCE", sourceId: "chrome:SABA:1"
    }));
    expect(plane.reloadSource("chrome:SABA:2")).toBe(1);
    expect(candidateSocket.send).toHaveBeenCalledExactlyOnceWith(JSON.stringify({
      version: 1, kind: "RELOAD_SOURCE", sourceId: "chrome:SABA:2"
    }));

    const replacementIdentity: AuthorityIdentity = { accountId: SABA_ACCOUNT, sourceId: "chrome:SABA:3",
      sourceEpoch: "observer-c:0", connectionGeneration: 3 };
    const replacement = coordinator.observe(replacementIdentity, "CANDIDATE_DATA");
    if (replacement.disposition !== "CANDIDATE") throw new Error("expected replacement candidate");
    plane.attachAuthority(replacementIdentity, replacement, "SABA", replacementSocket);

    expect(plane.reloadSource("chrome:SABA:2")).toBe(0);
    expect(plane.reloadSource("chrome:SABA:999")).toBe(0);
    expect(plane.reloadSource("chrome:SABA:3")).toBe(1);
    expect(replacementSocket.send).toHaveBeenCalledExactlyOnceWith(JSON.stringify({
      version: 1, kind: "RELOAD_SOURCE", sourceId: "chrome:SABA:3"
    }));
  });

  it("reloads an exact current candidate when the same-source active lane is closed", () => {
    const coordinator = new ProviderAuthorityCoordinator();
    const plane = new ChromeBridgeControlPlane({ authorityCoordinator: coordinator });
    const activeSocket = { send: vi.fn(), readyState: 3 };
    const candidateSocket = { send: vi.fn(), readyState: 1 };
    const activeIdentity: AuthorityIdentity = { accountId: SABA_ACCOUNT, sourceId: "chrome:SABA:1",
      sourceEpoch: "observer-a:0", connectionGeneration: 1 };
    const first = coordinator.observe(activeIdentity, "CANDIDATE_DATA");
    if (first.disposition !== "CANDIDATE") throw new Error("expected candidate");
    plane.attachAuthority(activeIdentity, first, "SABA", activeSocket);
    coordinator.promote(first.token, proof(1n));
    const candidateIdentity: AuthorityIdentity = { accountId: SABA_ACCOUNT, sourceId: "chrome:SABA:1",
      sourceEpoch: "observer-b:0", connectionGeneration: 2 };
    const candidate = coordinator.observe(candidateIdentity, "CANDIDATE_DATA");
    if (candidate.disposition !== "CANDIDATE") throw new Error("expected candidate");
    plane.attachAuthority(candidateIdentity, candidate, "SABA", candidateSocket);

    expect(plane.reloadSource("chrome:SABA:1")).toBe(1);
    expect(activeSocket.send).not.toHaveBeenCalled();
    expect(candidateSocket.send).toHaveBeenCalledExactlyOnceWith(JSON.stringify({
      version: 1, kind: "RELOAD_SOURCE", sourceId: "chrome:SABA:1"
    }));
  });

  it("continues same-source reload on the current candidate when the active send throws", () => {
    const coordinator = new ProviderAuthorityCoordinator();
    const plane = new ChromeBridgeControlPlane({ authorityCoordinator: coordinator });
    const activeSocket = { send: vi.fn(() => { throw new Error("SOCKET_CLOSED_DURING_SEND"); }), readyState: 1 };
    const candidateSocket = { send: vi.fn(), readyState: 1 };
    const activeIdentity: AuthorityIdentity = { accountId: SABA_ACCOUNT, sourceId: "chrome:SABA:1",
      sourceEpoch: "observer-a:0", connectionGeneration: 1 };
    const first = coordinator.observe(activeIdentity, "CANDIDATE_DATA");
    if (first.disposition !== "CANDIDATE") throw new Error("expected candidate");
    plane.attachAuthority(activeIdentity, first, "SABA", activeSocket);
    coordinator.promote(first.token, proof(1n));
    const candidateIdentity: AuthorityIdentity = { accountId: SABA_ACCOUNT, sourceId: "chrome:SABA:1",
      sourceEpoch: "observer-b:0", connectionGeneration: 2 };
    const candidate = coordinator.observe(candidateIdentity, "CANDIDATE_DATA");
    if (candidate.disposition !== "CANDIDATE") throw new Error("expected candidate");
    plane.attachAuthority(candidateIdentity, candidate, "SABA", candidateSocket);

    expect(plane.reloadSource("chrome:SABA:1")).toBe(1);
    expect(activeSocket.send).toHaveBeenCalledOnce();
    expect(candidateSocket.send).toHaveBeenCalledExactlyOnceWith(JSON.stringify({
      version: 1, kind: "RELOAD_SOURCE", sourceId: "chrome:SABA:1"
    }));
  });

  it("revalidates the exact candidate after an active send retires it and throws", () => {
    const coordinator = new ProviderAuthorityCoordinator();
    const plane = new ChromeBridgeControlPlane({ authorityCoordinator: coordinator });
    const retiredCandidateSocket = { send: vi.fn(), readyState: 1 };
    const replacementSocket = { send: vi.fn(), readyState: 1 };
    const replacementIdentity: AuthorityIdentity = { accountId: SABA_ACCOUNT, sourceId: "chrome:SABA:1",
      sourceEpoch: "observer-c:0", connectionGeneration: 3 };
    const activeSocket = { readyState: 1, send: vi.fn(() => {
      const replacement = coordinator.observe(replacementIdentity, "CANDIDATE_DATA");
      if (replacement.disposition !== "CANDIDATE") throw new Error("expected replacement candidate");
      plane.attachAuthority(replacementIdentity, replacement, "SABA", replacementSocket);
      throw new Error("ACTIVE_SEND_FAILED");
    }) };
    const activeIdentity: AuthorityIdentity = { accountId: SABA_ACCOUNT, sourceId: "chrome:SABA:1",
      sourceEpoch: "observer-a:0", connectionGeneration: 1 };
    const first = coordinator.observe(activeIdentity, "CANDIDATE_DATA");
    if (first.disposition !== "CANDIDATE") throw new Error("expected candidate");
    plane.attachAuthority(activeIdentity, first, "SABA", activeSocket);
    coordinator.promote(first.token, proof(1n));
    const retiredIdentity: AuthorityIdentity = { accountId: SABA_ACCOUNT, sourceId: "chrome:SABA:1",
      sourceEpoch: "observer-b:0", connectionGeneration: 2 };
    const retired = coordinator.observe(retiredIdentity, "CANDIDATE_DATA");
    if (retired.disposition !== "CANDIDATE") throw new Error("expected candidate");
    plane.attachAuthority(retiredIdentity, retired, "SABA", retiredCandidateSocket);

    expect(plane.reloadSource("chrome:SABA:1")).toBe(1);
    expect(activeSocket.send).toHaveBeenCalledOnce();
    expect(retiredCandidateSocket.send).not.toHaveBeenCalled();
    expect(replacementSocket.send).toHaveBeenCalledExactlyOnceWith(JSON.stringify({
      version: 1, kind: "RELOAD_SOURCE", sourceId: "chrome:SABA:1"
    }));
  });

  it("reports reload as undelivered when every exact open lane throws", () => {
    const coordinator = new ProviderAuthorityCoordinator();
    const plane = new ChromeBridgeControlPlane({ authorityCoordinator: coordinator });
    const activeSocket = { send: vi.fn(() => { throw new Error("ACTIVE_SEND_FAILED"); }), readyState: 1 };
    const candidateSocket = { send: vi.fn(() => { throw new Error("CANDIDATE_SEND_FAILED"); }), readyState: 1 };
    const activeIdentity: AuthorityIdentity = { accountId: SABA_ACCOUNT, sourceId: "chrome:SABA:1",
      sourceEpoch: "observer-a:0", connectionGeneration: 1 };
    const first = coordinator.observe(activeIdentity, "CANDIDATE_DATA");
    if (first.disposition !== "CANDIDATE") throw new Error("expected candidate");
    plane.attachAuthority(activeIdentity, first, "SABA", activeSocket);
    coordinator.promote(first.token, proof(1n));
    const candidateIdentity: AuthorityIdentity = { accountId: SABA_ACCOUNT, sourceId: "chrome:SABA:1",
      sourceEpoch: "observer-b:0", connectionGeneration: 2 };
    const candidate = coordinator.observe(candidateIdentity, "CANDIDATE_DATA");
    if (candidate.disposition !== "CANDIDATE") throw new Error("expected candidate");
    plane.attachAuthority(candidateIdentity, candidate, "SABA", candidateSocket);

    expect(plane.reloadSource("chrome:SABA:1")).toBe(0);
    expect(activeSocket.send).toHaveBeenCalledOnce();
    expect(candidateSocket.send).toHaveBeenCalledOnce();
  });

  it("reloads the internally authenticated candidate for an exact account and lobby", () => {
    const coordinator = new ProviderAuthorityCoordinator();
    const plane = new ChromeBridgeControlPlane({ authorityCoordinator: coordinator });
    const candidateSocket = { send: vi.fn(), readyState: 1 };
    const identity: AuthorityIdentity = { accountId: SABA_ACCOUNT, sourceId: "chrome:SABA:7",
      sourceEpoch: "observer-a:0", connectionGeneration: 1 };
    const candidate = coordinator.observe(identity, "CANDIDATE_DATA");
    if (candidate.disposition !== "CANDIDATE") throw new Error("expected candidate");
    plane.attachAuthority(identity, candidate, "SABA", candidateSocket);

    expect(plane.reloadRecoverySource(SABA_ACCOUNT, "SABA")).toBe(1);
    expect(candidateSocket.send).toHaveBeenCalledExactlyOnceWith(JSON.stringify({
      version: 1, kind: "RELOAD_SOURCE", sourceId: "chrome:SABA:7"
    }));
  });

  it("prefers active authority over a current recovery candidate", () => {
    const coordinator = new ProviderAuthorityCoordinator();
    const plane = new ChromeBridgeControlPlane({ authorityCoordinator: coordinator });
    const activeSocket = { send: vi.fn(), readyState: 1 };
    const candidateSocket = { send: vi.fn(), readyState: 1 };
    const activeIdentity: AuthorityIdentity = { accountId: SABA_ACCOUNT, sourceId: "chrome:SABA:1",
      sourceEpoch: "observer-a:0", connectionGeneration: 1 };
    const first = coordinator.observe(activeIdentity, "CANDIDATE_DATA");
    if (first.disposition !== "CANDIDATE") throw new Error("expected candidate");
    plane.attachAuthority(activeIdentity, first, "SABA", activeSocket);
    coordinator.promote(first.token, proof(1n));
    const candidateIdentity: AuthorityIdentity = { accountId: SABA_ACCOUNT, sourceId: "chrome:SABA:2",
      sourceEpoch: "observer-b:0", connectionGeneration: 2 };
    const candidate = coordinator.observe(candidateIdentity, "CANDIDATE_DATA");
    if (candidate.disposition !== "CANDIDATE") throw new Error("expected candidate");
    plane.attachAuthority(candidateIdentity, candidate, "SABA", candidateSocket);

    expect(plane.reloadRecoverySource(SABA_ACCOUNT, "SABA")).toBe(1);
    expect(activeSocket.send).toHaveBeenCalledExactlyOnceWith(JSON.stringify({
      version: 1, kind: "RELOAD_SOURCE", sourceId: "chrome:SABA:1"
    }));
    expect(candidateSocket.send).not.toHaveBeenCalled();
  });

  it("revalidates the account candidate after an active send replaces it and throws", () => {
    const coordinator = new ProviderAuthorityCoordinator();
    const plane = new ChromeBridgeControlPlane({ authorityCoordinator: coordinator });
    const retiredCandidateSocket = { send: vi.fn(), readyState: 1 };
    const replacementSocket = { send: vi.fn(), readyState: 1 };
    const replacementIdentity: AuthorityIdentity = { accountId: SABA_ACCOUNT, sourceId: "chrome:SABA:3",
      sourceEpoch: "observer-c:0", connectionGeneration: 3 };
    const activeSocket = { readyState: 1, send: vi.fn(() => {
      const replacement = coordinator.observe(replacementIdentity, "CANDIDATE_DATA");
      if (replacement.disposition !== "CANDIDATE") throw new Error("expected replacement candidate");
      plane.attachAuthority(replacementIdentity, replacement, "SABA", replacementSocket);
      throw new Error("ACTIVE_SEND_FAILED");
    }) };
    const activeIdentity: AuthorityIdentity = { accountId: SABA_ACCOUNT, sourceId: "chrome:SABA:1",
      sourceEpoch: "observer-a:0", connectionGeneration: 1 };
    const first = coordinator.observe(activeIdentity, "CANDIDATE_DATA");
    if (first.disposition !== "CANDIDATE") throw new Error("expected candidate");
    plane.attachAuthority(activeIdentity, first, "SABA", activeSocket);
    coordinator.promote(first.token, proof(1n));
    const retiredIdentity: AuthorityIdentity = { accountId: SABA_ACCOUNT, sourceId: "chrome:SABA:2",
      sourceEpoch: "observer-b:0", connectionGeneration: 2 };
    const retired = coordinator.observe(retiredIdentity, "CANDIDATE_DATA");
    if (retired.disposition !== "CANDIDATE") throw new Error("expected candidate");
    plane.attachAuthority(retiredIdentity, retired, "SABA", retiredCandidateSocket);

    expect(plane.reloadRecoverySource(SABA_ACCOUNT, "SABA")).toBe(1);
    expect(activeSocket.send).toHaveBeenCalledOnce();
    expect(retiredCandidateSocket.send).not.toHaveBeenCalled();
    expect(replacementSocket.send).toHaveBeenCalledExactlyOnceWith(JSON.stringify({
      version: 1, kind: "RELOAD_SOURCE", sourceId: "chrome:SABA:3"
    }));
  });

  it("fails closed for wrong account/lobby pairs and never addresses a retired candidate", () => {
    const coordinator = new ProviderAuthorityCoordinator();
    const plane = new ChromeBridgeControlPlane({ authorityCoordinator: coordinator });
    const retiredSocket = { send: vi.fn(), readyState: 1 };
    const currentSocket = { send: vi.fn(), readyState: 1 };
    const retiredIdentity: AuthorityIdentity = { accountId: SABA_ACCOUNT, sourceId: "chrome:SABA:1",
      sourceEpoch: "observer-a:0", connectionGeneration: 1 };
    const retired = coordinator.observe(retiredIdentity, "CANDIDATE_DATA");
    if (retired.disposition !== "CANDIDATE") throw new Error("expected candidate");
    plane.attachAuthority(retiredIdentity, retired, "SABA", retiredSocket);
    const currentIdentity: AuthorityIdentity = { accountId: SABA_ACCOUNT, sourceId: "chrome:SABA:2",
      sourceEpoch: "observer-b:0", connectionGeneration: 2 };
    const current = coordinator.observe(currentIdentity, "CANDIDATE_DATA");
    if (current.disposition !== "CANDIDATE") throw new Error("expected replacement candidate");
    plane.attachAuthority(currentIdentity, current, "SABA", currentSocket);

    expect(plane.reloadRecoverySource(SABA_ACCOUNT, "TSPORT")).toBe(0);
    expect(plane.reloadRecoverySource("catalog-source:APSPORT:FOOTBALL", "SABA")).toBe(0);
    expect(retiredSocket.send).not.toHaveBeenCalled();
    expect(currentSocket.send).not.toHaveBeenCalled();
    expect(plane.reloadRecoverySource(SABA_ACCOUNT, "SABA")).toBe(1);
    expect(retiredSocket.send).not.toHaveBeenCalled();
    expect(currentSocket.send).toHaveBeenCalledExactlyOnceWith(JSON.stringify({
      version: 1, kind: "RELOAD_SOURCE", sourceId: "chrome:SABA:2"
    }));
  });

  it("reports a current candidate reload as undelivered when its send throws", () => {
    const coordinator = new ProviderAuthorityCoordinator();
    const plane = new ChromeBridgeControlPlane({ authorityCoordinator: coordinator });
    const candidateSocket = { send: vi.fn(() => { throw new Error("SOCKET_SEND_FAILED"); }), readyState: 1 };
    const identity: AuthorityIdentity = { accountId: SABA_ACCOUNT, sourceId: "chrome:SABA:7",
      sourceEpoch: "observer-a:0", connectionGeneration: 1 };
    const candidate = coordinator.observe(identity, "CANDIDATE_DATA");
    if (candidate.disposition !== "CANDIDATE") throw new Error("expected candidate");
    plane.attachAuthority(identity, candidate, "SABA", candidateSocket);

    expect(plane.reloadRecoverySource(SABA_ACCOUNT, "SABA")).toBe(0);
    expect(candidateSocket.send).toHaveBeenCalledOnce();
  });

  it("requests a snapshot only from the targeted provider lobby", () => {
    const saba = { send: vi.fn(), readyState: 1 };
    const bti = { send: vi.fn(), readyState: 1 };
    const plane = new ChromeBridgeControlPlane();
    plane.attach("chrome:SABA:1", saba);
    plane.attach("chrome:BTI:2", bti);

    expect(plane.requestLobbySnapshot("SABA")).toBe(1);

    expect(saba.send).toHaveBeenCalledExactlyOnceWith(JSON.stringify({
      version: 1, kind: "REQUEST_SNAPSHOT", sourceId: "chrome:SABA:1"
    }));
    expect(bti.send).not.toHaveBeenCalled();
  });
  it("requests a fresh snapshot from every attached source exactly once", () => {
    const saba = { send: vi.fn(), readyState: 1 };
    const bti = { send: vi.fn(), readyState: 1 };
    const plane = new ChromeBridgeControlPlane();
    plane.attach("chrome:SABA:1", saba);
    plane.attach("chrome:BTI:2", bti);

    expect(plane.requestAllSnapshots()).toBe(2);
    expect(saba.send).toHaveBeenCalledWith(JSON.stringify({
      version: 1, kind: "REQUEST_SNAPSHOT", sourceId: "chrome:SABA:1"
    }));
    expect(bti.send).toHaveBeenCalledWith(JSON.stringify({
      version: 1, kind: "REQUEST_SNAPSHOT", sourceId: "chrome:BTI:2"
    }));
  });

  it("can force every attached provider tab to reload for manual session recovery", () => {
    const socket = { send: vi.fn(), readyState: 1 };
    const plane = new ChromeBridgeControlPlane();
    plane.attach("chrome:SABA:1", socket);

    expect(plane.reloadAllSources()).toBe(1);
    expect(socket.send).toHaveBeenCalledWith(JSON.stringify({
      version: 1, kind: "RELOAD_SOURCE", sourceId: "chrome:SABA:1"
    }));
  });

  it("navigates only the attached lobby to a newly issued HTTPS launch", () => {
    const saba = { send: vi.fn(), readyState: 1 };
    const bti = { send: vi.fn(), readyState: 1 };
    const plane = new ChromeBridgeControlPlane();
    plane.attach("chrome:SABA:1", saba);
    plane.attach("chrome:BTI:2", bti);

    expect(plane.navigateLobby("SABA", "https://c0z0ob.bpd3a3fn.com/sports?token=opaque")).toBe(1);
    expect(saba.send).toHaveBeenCalledWith(JSON.stringify({ version: 1, kind: "NAVIGATE_SOURCE",
      sourceId: "chrome:SABA:1", url: "https://c0z0ob.bpd3a3fn.com/sports?token=opaque" }));
    expect(bti.send).not.toHaveBeenCalled();
  });

  it("ensures a missing lobby through the installation socket without an attached source", () => {
    const socket = { send: vi.fn(), readyState: 1 };
    const plane = new ChromeBridgeControlPlane();
    plane.attachInstallation(socket);

    expect(plane.ensureLobby("CMD", "https://cgnew.fts368.com/sports?opaque=1")).toBe(1);
    expect(socket.send).toHaveBeenCalledWith(JSON.stringify({
      version: 1, kind: "ENSURE_SOURCE", lobby: "CMD", url: "https://cgnew.fts368.com/sports?opaque=1"
    }));
  });

  it("delivers one ensure command when one installation socket owns several sources", () => {
    const socket = { send: vi.fn(), readyState: 1 };
    const plane = new ChromeBridgeControlPlane();
    plane.attachInstallation(socket);
    plane.attach("chrome:SABA:1", socket);
    plane.attach("chrome:BTI:2", socket);

    expect(plane.ensureLobby("SABA", "https://c0z0oa.bpd3a3fn.com/sports")).toBe(1);
    expect(socket.send).toHaveBeenCalledTimes(1);
  });

  it("requests restoration of a closed lobby without requiring a launch URL", () => {
    const socket = { send: vi.fn(), readyState: 1 };
    const plane = new ChromeBridgeControlPlane();
    plane.attachInstallation(socket);

    expect(plane.restoreLobby("CMD")).toBe(1);
    expect(socket.send).toHaveBeenCalledWith(JSON.stringify({ version: 1, kind: "RESTORE_SOURCE", lobby: "CMD" }));
  });

  it("sends an exact CMD hidden-market probe only to its attached live socket", () => {
    const socket = { send: vi.fn(), readyState: 1 };
    const plane = new ChromeBridgeControlPlane();
    plane.attach("chrome:CMD:9", socket);

    expect(plane.probeCmdHiddenMarkets("chrome:CMD:9", "probe-1", "25250586")).toBe(true);
    expect(socket.send).toHaveBeenCalledWith(JSON.stringify({ version: 1, kind: "PROBE_CMD_HIDDEN_MARKETS",
      sourceId: "chrome:CMD:9", requestId: "probe-1", providerEventId: "25250586" }));
    expect(plane.probeCmdHiddenMarkets("chrome:SABA:9", "probe-2", "25250586")).toBe(false);
  });

  it("sends a correlated visible-price probe only to the exact attached source", () => {
    const socket = { send: vi.fn(), readyState: 1 };
    const plane = new ChromeBridgeControlPlane();
    plane.attach("chrome:TSPORT:9", socket);

    expect(plane.probeSelectionPrice("chrome:TSPORT:9", { requestId: "price-1", providerEventId: "event-1",
      providerMarketId: "market-1", providerSelectionId: "selection-1", eventLabel: "Alpha vs Beta",
      participantA: "Alpha", participantB: "Beta",
      marketType: "FT_TOTAL", scope: "FULL_TIME", selection: "UNDER", line: "2.5" }))
      .toBe(true);
    expect(socket.send).toHaveBeenCalledWith(JSON.stringify({ version: 1, kind: "PROBE_SELECTION_PRICE",
      sourceId: "chrome:TSPORT:9", requestId: "price-1", providerEventId: "event-1",
      providerMarketId: "market-1", providerSelectionId: "selection-1", eventLabel: "Alpha vs Beta",
      participantA: "Alpha", participantB: "Beta",
      marketType: "FT_TOTAL", scope: "FULL_TIME", selection: "UNDER", line: "2.5" }));
  });

  it("also sends CMD's exact-ID compatibility probe for an already-installed bridge bundle", () => {
    const socket = { send: vi.fn(), readyState: 1 };
    const plane = new ChromeBridgeControlPlane();
    plane.attach("chrome:CMD:9", socket);
    const input = { requestId: "price-cmd", providerEventId: "event-1", providerMarketId: "market-1",
      providerSelectionId: "selection-1", eventLabel: "Alpha vs Beta", participantA: "Alpha",
      participantB: "Beta", marketType: "FT_AH", scope: "FULL_TIME", selection: "HOME", line: "-0.25" };

    expect(plane.probeSelectionPrice("chrome:CMD:9", input)).toBe(true);
    expect(socket.send).toHaveBeenCalledTimes(2);
    expect(socket.send).toHaveBeenNthCalledWith(1, JSON.stringify({ version: 1, kind: "PROBE_SELECTION_PRICE",
      sourceId: "chrome:CMD:9", ...input }));
    expect(socket.send).toHaveBeenNthCalledWith(2, JSON.stringify({ version: 1, kind: "PROBE_SELECTION_PRICE",
      sourceId: "chrome:CMD:9", requestId: "price-cmd", providerEventId: "event-1",
      providerMarketId: "market-1", providerSelectionId: "selection-1", eventLabel: "Alpha vs Beta",
      marketType: "FT_AH", scope: "FULL_TIME", selection: "HOME", line: "-0.25" }));
  });

  it("also sends SABA's exact-ID compatibility probe for an already-installed bridge bundle", () => {
    const socket = { send: vi.fn(), readyState: 1 };
    const plane = new ChromeBridgeControlPlane();
    plane.attach("chrome:SABA:9", socket);
    const input = { requestId: "price-saba", providerEventId: "event-1", providerMarketId: "market-1",
      providerSelectionId: "selection-1", eventLabel: "Alpha vs Beta", participantA: "Alpha",
      participantB: "Beta", marketType: "FT_TOTAL", scope: "FULL_TIME", selection: "OVER", line: "2.5" };

    expect(plane.probeSelectionPrice("chrome:SABA:9", input)).toBe(true);
    expect(socket.send).toHaveBeenCalledTimes(2);
    expect(socket.send).toHaveBeenNthCalledWith(2, JSON.stringify({ version: 1, kind: "PROBE_SELECTION_PRICE",
      sourceId: "chrome:SABA:9", requestId: "price-saba", providerEventId: "event-1",
      providerMarketId: "market-1", providerSelectionId: "selection-1", eventLabel: "Alpha vs Beta",
      marketType: "FT_TOTAL", scope: "FULL_TIME", selection: "OVER", line: "2.5" }));
  });

  it("skips closed sockets and detaches every source owned by a closed connection", () => {
    const socket = { send: vi.fn(), readyState: 3 };
    const plane = new ChromeBridgeControlPlane();
    plane.attach("chrome:SABA:1", socket);
    plane.attach("chrome:BTI:2", socket);

    expect(plane.requestAllSnapshots()).toBe(0);
    plane.detach(socket);
    expect(plane.sourceCount()).toBe(0);
  });

  it("compacts source churn by provider account and keeps exactly the six current providers", () => {
    const socket = { send: vi.fn(), readyState: 1 };
    const plane = new ChromeBridgeControlPlane();
    for (let ordinal = 0; ordinal < 1_000; ordinal += 1) {
      plane.attach(`chrome:SABA:${ordinal + 1}`, socket);
    }
    expect(plane.sourceCount()).toBe(1);
    expect(plane.probeSelectionPrice("chrome:SABA:1", { requestId: "old", providerEventId: "e",
      providerMarketId: "m", providerSelectionId: "s", eventLabel: "A vs B", participantA: "A",
      participantB: "B", marketType: "FT_TOTAL", scope: "FULL_TIME", selection: "OVER", line: "2.5" }))
      .toBe(false);

    for (const sourceId of ["chrome:CMD:1", "chrome:IM:1", "chrome:KSPORT:1",
      "chrome:TSPORT:1", "chrome:BTI:1"] as const) plane.attach(sourceId, socket);
    expect(plane.sourceCount()).toBe(6);
    expect(plane.requestAllSnapshots()).toBe(6);

    // KSPORT and SBO are two capture surfaces for the same SBOBET account.
    plane.attach("chrome:SBO:2", socket);
    expect(plane.sourceCount()).toBe(6);
    expect(plane.requestLobbySnapshot("KSPORT")).toBe(0);
    expect(plane.requestLobbySnapshot("SBO")).toBe(1);
  });

  it("prunes sources retired by registry ownership before recovery targets are selected", () => {
    const active = new Set(["chrome:SABA:2"]);
    const oldSocket = { send: vi.fn(), readyState: 1 };
    const currentSocket = { send: vi.fn(), readyState: 1 };
    const plane = new ChromeBridgeControlPlane({ activeSourceIds: () => active });
    plane.attach("chrome:SABA:1", oldSocket);
    plane.attach("chrome:SABA:2", currentSocket);
    plane.attach("chrome:CMD:1", oldSocket);

    expect(plane.sourceCount()).toBe(1);
    expect(plane.requestAllSnapshots()).toBe(1);
    expect(currentSocket.send).toHaveBeenCalledWith(JSON.stringify({
      version: 1, kind: "REQUEST_SNAPSHOT", sourceId: "chrome:SABA:2"
    }));
    expect(oldSocket.send).not.toHaveBeenCalled();
  });

  it("does not let a late old-socket close detach the newer account owner", () => {
    const oldSocket = { send: vi.fn(), readyState: 1 };
    const currentSocket = { send: vi.fn(), readyState: 1 };
    const plane = new ChromeBridgeControlPlane();
    plane.attach("chrome:SABA:1", oldSocket);
    plane.attach("chrome:SABA:2", currentSocket);

    plane.detach(oldSocket);

    expect(plane.sourceCount()).toBe(1);
    expect(plane.requestAllSnapshots()).toBe(1);
    expect(currentSocket.send).toHaveBeenCalledWith(JSON.stringify({
      version: 1, kind: "REQUEST_SNAPSHOT", sourceId: "chrome:SABA:2"
    }));
  });

  it("sends installation recovery only to the newest authenticated socket after a late old close", () => {
    const oldSocket = { send: vi.fn(), readyState: 1 };
    const currentSocket = { send: vi.fn(), readyState: 1 };
    const plane = new ChromeBridgeControlPlane();
    plane.attachInstallation(oldSocket);
    plane.attachInstallation(currentSocket);

    expect(plane.restoreLobby("SABA")).toBe(1);
    expect(oldSocket.send).not.toHaveBeenCalled();
    expect(currentSocket.send).toHaveBeenCalledTimes(1);
    plane.detach(oldSocket);
    currentSocket.send.mockClear();

    expect(plane.restoreLobby("SABA")).toBe(1);
    expect(oldSocket.send).not.toHaveBeenCalled();
    expect(currentSocket.send).toHaveBeenCalledWith(JSON.stringify({
      version: 1, kind: "RESTORE_SOURCE", lobby: "SABA"
    }));
  });
});
