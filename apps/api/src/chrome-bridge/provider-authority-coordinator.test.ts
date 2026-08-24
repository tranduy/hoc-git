import { describe, expect, it, vi } from "vitest";
import type { ObservedProviderCatalog } from "../providers/cmd/cmd-observed-catalog.js";
import { ProviderAuthorityCoordinator } from "./provider-authority-coordinator.js";
import type {
  AuthorityCandidateToken,
  AuthorityIdentity,
  CatalogCommitProof
} from "./provider-authority-types.js";
import {
  chromeBridgeProviderAccountIdForKey,
  type ChromeBridgeAccountKey
} from "./chrome-bridge-account.js";

const accountId = chromeBridgeProviderAccountIdForKey;

function identity(
  accountId: AuthorityIdentity["accountId"],
  connectionGeneration: number,
  suffix = String(connectionGeneration)
): AuthorityIdentity {
  const accountKey = accountId.split(":")[1] as ChromeBridgeAccountKey;
  const lobby = accountKey === "SBOBET" ? "KSPORT" : accountKey === "APSPORT" ? "TSPORT" : accountKey;
  return {
    accountId,
    sourceId: `chrome:${lobby}:${suffix}`,
    sourceEpoch: `observer-${suffix}:0`,
    connectionGeneration
  };
}

function proof(accountId: AuthorityIdentity["accountId"], cursor = 1n): CatalogCommitProof {
  const provider = accountId.split(":")[1] as ChromeBridgeAccountKey;
  return {
    authorityCursor: cursor,
    provenance: "WS",
    contentClass: "FOOTBALL",
    completeness: "COMPLETE",
    scope: "ACCOUNT",
    completedPartitions: ["FOOTBALL"],
    emptyProof: "NONEMPTY",
    catalog: {
      dataMode: "LIVE",
      accountId,
      provider,
      category: "FOOTBALL",
      comparisonState: "AWAITING_SECOND_PROVIDER",
      observedAtMs: Number(cursor),
      rejectedMarketCount: 0,
      events: [{}] as unknown as ObservedProviderCatalog["events"],
      markets: [],
      quotes: []
    }
  };
}

function candidate(
  coordinator: ProviderAuthorityCoordinator,
  value: AuthorityIdentity,
  evidenceClass: "TRANSPORT" | "CANDIDATE_DATA" = "CANDIDATE_DATA"
): AuthorityCandidateToken {
  const decision = coordinator.observe(value, evidenceClass);
  expect(decision.disposition).toBe("CANDIDATE");
  expect(decision.token).not.toBeNull();
  return decision.token!;
}

describe("ProviderAuthorityCoordinator", () => {
  it("owns exactly the six canonical account slots and keeps KSPORT/SBO in SBOBET", () => {
    const coordinator = new ProviderAuthorityCoordinator();
    const accounts = ["CMD", "IM", "SABA", "SBOBET", "APSPORT", "BTI"] as const;

    for (const [index, accountId] of accounts.entries()) {
      const value = identity(chromeBridgeProviderAccountIdForKey(accountId), index + 1);
      const token = candidate(coordinator, value);
      expect(coordinator.promote(token, proof(chromeBridgeProviderAccountIdForKey(accountId)))).toMatchObject({ promoted: true });
    }

    expect(coordinator.snapshots()).toHaveLength(6);
    expect(coordinator.snapshot(accountId("SBOBET")).active?.sourceId).toMatch(/^chrome:KSPORT:/u);
    expect(() => coordinator.snapshot("FABET" as AuthorityIdentity["accountId"])).toThrow("AUTHORITY_ACCOUNT_UNKNOWN");
  });

  it("treats replay as diagnostic and transport evidence as candidate bootstrap only", () => {
    const coordinator = new ProviderAuthorityCoordinator();
    const first = identity(accountId("SABA"), 1, "active");
    const firstToken = candidate(coordinator, first);
    coordinator.promote(firstToken, proof(accountId("SABA")));

    const next = identity(accountId("SABA"), 2, "candidate");
    expect(coordinator.observe(next, "REPLAY")).toEqual({
      disposition: "REJECTED",
      token: null,
      laneToken: null,
      reason: "REPLAY_DIAGNOSTIC_ONLY"
    });
    expect(coordinator.snapshot(accountId("SABA"))).toMatchObject({ active: first, candidate: null });

    const nextToken = candidate(coordinator, next, "TRANSPORT");
    for (const evidenceClass of ["TRANSPORT", "CANDIDATE_DATA"] as const) {
      expect(coordinator.observe(next, evidenceClass)).toMatchObject({
        disposition: "CANDIDATE",
        token: nextToken
      });
      expect(coordinator.snapshot(accountId("SABA")).active).toEqual(first);
    }
  });

  it("promotes by exact compare-and-swap and rejects late old and candidate evidence", () => {
    const coordinator = new ProviderAuthorityCoordinator();
    const oldIdentity = identity(accountId("IM"), 10, "old");
    const oldToken = candidate(coordinator, oldIdentity);
    const oldPromotion = coordinator.promote(oldToken, proof(accountId("IM"), 10n));
    expect(oldPromotion).toMatchObject({ promoted: true, previousActive: null, active: oldIdentity });

    const nextIdentity = identity(accountId("IM"), 11, "next");
    const nextToken = candidate(coordinator, nextIdentity);
    const staleCopy = { ...nextToken };
    expect(coordinator.promote(staleCopy, proof(accountId("IM"), 11n))).toMatchObject({
      promoted: false,
      reason: "STALE_CANDIDATE_TOKEN"
    });
    expect(coordinator.snapshot(accountId("IM")).active).toEqual(oldIdentity);

    const nextPromotion = coordinator.promote(nextToken, proof(accountId("IM"), 11n));
    if (!nextPromotion.promoted) throw new Error("promotion failed");
    expect(nextPromotion).toMatchObject({
      promoted: true,
      previousActive: oldIdentity,
      active: nextIdentity
    });
    expect(nextPromotion.activeLaneToken).not.toBe(nextPromotion.candidateLaneToken);
    expect(nextPromotion.activeLaneToken).toMatchObject({ accountId: accountId("IM"), phase: "ACTIVE" });
    expect(coordinator.observe(oldIdentity, "CANDIDATE_DATA").disposition).toBe("REJECTED");
    expect(coordinator.observe(nextIdentity, "CANDIDATE_DATA")).toMatchObject({ disposition: "ACTIVE" });
  });

  it("rejects an invalid proof without changing candidate or active state", () => {
    const coordinator = new ProviderAuthorityCoordinator();
    const value = identity(accountId("CMD"), 1);
    const token = candidate(coordinator, value);

    expect(coordinator.promote(token, proof(accountId("IM")))).toMatchObject({
      promoted: false,
      reason: "PROOF_ACCOUNT_MISMATCH"
    });
    expect(coordinator.snapshot(accountId("CMD"))).toMatchObject({ active: null, candidate: value });
  });

  it("keeps candidate tokens monotonic and bounded across 1,000 turnovers", () => {
    const coordinator = new ProviderAuthorityCoordinator();
    const activeIdentity = identity(accountId("BTI"), 1, "active");
    coordinator.promote(candidate(coordinator, activeIdentity), proof(accountId("BTI")));

    let previousNonce = 0;
    for (let generation = 2; generation <= 1_001; generation += 1) {
      const token = candidate(coordinator, identity(accountId("BTI"), generation));
      expect(token.nonce).toBeGreaterThan(previousNonce);
      previousNonce = token.nonce;
    }

    expect(coordinator.snapshot(accountId("BTI"))).toMatchObject({
      active: activeIdentity,
      candidate: identity(accountId("BTI"), 1_001)
    });
    expect(coordinator.snapshots()).toHaveLength(6);
  });

  it("fences exact connection/epoch identity and ignores a late close after promotion", () => {
    const coordinator = new ProviderAuthorityCoordinator();
    const oldIdentity = identity(accountId("SBOBET"), 5, "old");
    coordinator.promote(candidate(coordinator, oldIdentity), proof(accountId("SBOBET")));
    const newerIdentity = identity(accountId("SBOBET"), 6, "new");
    const newerToken = candidate(coordinator, newerIdentity);

    expect(coordinator.observe({ ...newerIdentity, sourceEpoch: "wrong:0" }, "CANDIDATE_DATA").disposition)
      .toBe("REJECTED");
    expect(coordinator.observe(oldIdentity, "CANDIDATE_DATA").disposition).toBe("ACTIVE");
    coordinator.promote(newerToken, proof(accountId("SBOBET"), 2n));

    expect(coordinator.release(oldIdentity)).toMatchObject({ changed: false });
    expect(coordinator.snapshot(accountId("SBOBET")).active).toEqual(newerIdentity);
    expect(coordinator.release(newerIdentity)).toMatchObject({ changed: false, disposition: "ACTIVE" });
    expect(coordinator.snapshot(accountId("SBOBET")).active).toEqual(newerIdentity);
  });

  it("notifies lane retirement synchronously on replacement and promotion", () => {
    const coordinator = new ProviderAuthorityCoordinator();
    const listener = vi.fn();
    coordinator.subscribe(listener);
    const first = identity(accountId("APSPORT"), 1);
    const firstToken = candidate(coordinator, first);
    const firstLane = coordinator.snapshot(accountId("APSPORT")).candidateLaneToken;
    const replacement = identity(accountId("APSPORT"), 2);
    candidate(coordinator, replacement);

    expect(listener).toHaveBeenCalledWith(expect.objectContaining({
      kind: "CANDIDATE_REPLACED",
      retiredLaneToken: firstLane
    }));
    const replacementToken = coordinator.snapshot(accountId("APSPORT")).candidateToken;
    const candidateLane = coordinator.snapshot(accountId("APSPORT")).candidateLaneToken;
    coordinator.promote(replacementToken!, proof(accountId("APSPORT")));
    expect(listener).toHaveBeenLastCalledWith(expect.objectContaining({
      kind: "PROMOTED",
      candidateLaneToken: candidateLane,
      activeLaneToken: expect.objectContaining({ phase: "ACTIVE" })
    }));
    expect(coordinator.promote(firstToken, proof(accountId("APSPORT")))).toMatchObject({ promoted: false });
  });

  it("commits the authority transaction before notifying and rolls back a failed transaction", () => {
    const coordinator = new ProviderAuthorityCoordinator();
    const first = identity(accountId("CMD"), 1);
    const token = candidate(coordinator, first);
    const order: string[] = [];
    coordinator.subscribe((transition) => {
      if (transition.kind !== "PROMOTED") return;
      expect(coordinator.snapshot(accountId("CMD")).active).toEqual(first);
      order.push("notified");
    });

    expect(coordinator.promote(token, proof(accountId("CMD")), () => {
      expect(coordinator.snapshot(accountId("CMD")).active).toEqual(first);
      order.push("transacted");
    })).toMatchObject({ promoted: true });
    expect(order).toEqual(["transacted", "notified"]);

    const next = identity(accountId("CMD"), 2);
    const nextToken = candidate(coordinator, next);
    expect(coordinator.promote(nextToken, proof(accountId("CMD"), 2n), () => {
      throw new Error("commit rejected");
    })).toEqual({ promoted: false, reason: "PROMOTION_TRANSACTION_FAILED" });
    expect(coordinator.snapshot(accountId("CMD"))).toMatchObject({ active: first, candidate: next });
    expect(order).toEqual(["transacted", "notified"]);
  });

  it("leaves the other five slots byte-for-byte unchanged during one-account turnover", () => {
    const coordinator = new ProviderAuthorityCoordinator();
    const accounts = ["CMD", "IM", "SABA", "SBOBET", "APSPORT", "BTI"] as const;
    for (const [index, key] of accounts.entries()) {
      const id = accountId(key);
      coordinator.promote(candidate(coordinator, identity(id, index + 1)), proof(id, BigInt(index + 1)));
    }
    const before = accounts.filter((key) => key !== "SABA")
      .map((key) => coordinator.snapshot(accountId(key)));

    const sabaReplacement = identity(accountId("SABA"), 99, "replacement");
    coordinator.promote(candidate(coordinator, sabaReplacement), proof(accountId("SABA"), 99n));

    const after = accounts.filter((key) => key !== "SABA")
      .map((key) => coordinator.snapshot(accountId(key)));
    expect(after).toEqual(before);
  });
});
