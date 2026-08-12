# Validated Catalog Source Binding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make each supported provider/category catalog use a stable logical source that automatically resolves to the newest validated ACTIVE launcher.

**Architecture:** Add a derived, non-persistent `CatalogSourceRegistry` between session management and catalog readers. The registry exposes stable public source IDs, resolves them to exact validated sessions on every read, and delegates legacy/manual account IDs to `AccountRegistry`; bettor accounts remain separate and are selected only for profile/preflight.

**Tech Stack:** TypeScript, Zod, Fastify, React, Vitest, Playwright-backed provider readers.

## Global Constraints

- Only exact provider/category pairs with registered catalog readers are exposed.
- Only `ACTIVE` sessions that already passed the existing trust/validation pipeline may back a logical source.
- Unknown providers, category-null sessions, wrong-category sessions, and untrusted hostnames fail closed.
- Logical catalog sources have no profile, balance, preflight, receipt, or execution capability.
- No new binding file is persisted; the binding is derived from redacted session state so storage failure cannot block the price path.
- Existing manual accounts and session audit records are neither rebound nor deleted.
- Stale catalogs cannot create a green ticket, profit toast, or executable preflight.
- No real-money bet or provider submit action is permitted by this plan.

---

## File Structure

- Create `apps/api/src/catalog/catalog-source-registry.ts`: stable source IDs, source statuses, newest-session resolution, and account fallback.
- Create `apps/api/src/catalog/catalog-source-registry.test.ts`: resolver security, ordering, category isolation, and fallback tests.
- Create `apps/api/src/routes/catalog-sources.ts`: read-only source-status endpoint.
- Create `apps/api/src/routes/catalog-sources.test.ts`: strict route response and failure tests.
- Modify `packages/contracts/src/domain.ts` and `packages/contracts/src/schemas.ts`: shared `CatalogSourceStatus` contract.
- Modify `apps/api/src/sessions/session-services.ts`: construct the registry once and pass it to catalog readers.
- Modify `apps/api/src/app.ts` and `apps/api/src/server.ts`: register the source route.
- Create `apps/web/src/api/catalog-sources.ts` and test: strict source-status client.
- Modify `apps/web/src/pages/live-catalog-page.tsx` and test: source checkboxes/catalog loading separated from bettor-account preflight.
- Create `docs/superpowers/reports/2026-08-13-validated-catalog-source-binding-report.md`: final automated and live read-only evidence.
- Modify `proccess.md` and `sảnh.md`: record verified live result and remaining unsupported pairs.

---

### Task 1: Shared Catalog Source Contract And Resolver

**Files:**
- Modify: `packages/contracts/src/domain.ts`
- Modify: `packages/contracts/src/schemas.ts`
- Modify: `packages/contracts/src/schemas.test.ts`
- Create: `apps/api/src/catalog/catalog-source-registry.ts`
- Create: `apps/api/src/catalog/catalog-source-registry.test.ts`

**Interfaces:**
- Consumes: `SessionStatusList`, `ActiveSecretHandle`, `CatalogSourceIdentity`, and `ActiveAccountAccess`.
- Produces: `CatalogSourceStatus`, `CatalogSourceStatusSchema`, `CatalogSourceRegistry.listStatuses()`, `resolveCatalogSource(id)`, and `withActiveHandle(...)`.

- [x] **Step 1: Write failing contract tests**

Add strict schema tests equivalent to:

```ts
expect(CatalogSourceStatusSchema.parse({
  id: "catalog-source:SABA:FOOTBALL",
  alias: "SABA Football",
  provider: "SABA",
  category: "FOOTBALL",
  sessionState: "ACTIVE",
  sessionSource: "FABET_LOGIN",
  acquiredAtMs: 200,
  reason: null
})).toMatchObject({ provider: "SABA", category: "FOOTBALL" });

expect(() => CatalogSourceStatusSchema.parse({
  id: "catalog-source:SABA:FOOTBALL",
  alias: "SABA Football",
  provider: "SABA",
  category: "LOL",
  sessionState: "ACTIVE",
  sessionSource: "FABET_LOGIN",
  acquiredAtMs: 200,
  reason: null,
  token: "must-not-pass"
})).toThrow();
```

- [x] **Step 2: Run contract tests and verify RED**

Run: `npm.cmd test --workspace @tool-chenh/contracts -- --run src/schemas.test.ts`

Expected: FAIL because `CatalogSourceStatusSchema` is not exported.

- [x] **Step 3: Add the exact contract**

Add to `domain.ts`:

```ts
export interface CatalogSourceStatus {
  readonly id: string;
  readonly alias: string;
  readonly provider: Exclude<ProviderId, "FABET">;
  readonly category: Category;
  readonly sessionState: SessionState;
  readonly sessionSource?: SessionSource | undefined;
  readonly acquiredAtMs: number | null;
  readonly reason: SessionHealthReason | null;
}
```

Add a strict Zod schema with these invariants:

```ts
export const CatalogSourceStatusSchema = z.strictObject({
  id: z.string().regex(/^catalog-source:(?:CMD|SABA|SBOBET|APSPORT|BTI|IM):(FOOTBALL|LOL)$/u),
  alias: z.string().trim().min(1).max(80),
  provider: z.enum(["CMD", "SABA", "SBOBET", "APSPORT", "BTI", "IM"]),
  category: CategorySchema,
  sessionState: SessionStateSchema,
  sessionSource: SessionSourceSchema.optional(),
  acquiredAtMs: z.number().finite().nonnegative().nullable(),
  reason: SessionHealthReasonSchema.nullable()
}).superRefine((value, context) => {
  if (value.id !== `catalog-source:${value.provider}:${value.category}`) {
    context.addIssue({ code: "custom", path: ["id"], message: "source id must match provider and category" });
  }
});
```

- [x] **Step 4: Run contract tests and typecheck**

Run: `npm.cmd test --workspace @tool-chenh/contracts -- --run src/schemas.test.ts; npm.cmd run typecheck --workspace @tool-chenh/contracts`

Expected: all contract tests pass and typecheck exits 0.

- [x] **Step 5: Write failing resolver tests**

Cover these observable behaviors with real resolver calls:

```ts
const registry = new CatalogSourceRegistry({
  sessions,
  accounts,
  supportedPairs: [
    { provider: "SABA", category: "FOOTBALL", alias: "C-Sports · SABA" },
    { provider: "SABA", category: "LOL", alias: "SABA Esports" }
  ]
});

expect((await registry.resolveCatalogSource("catalog-source:SABA:FOOTBALL")).sessionId)
  .toBe("newest-active-football");
await expect(registry.resolveCatalogSource("catalog-source:SABA:LOL"))
  .rejects.toThrow("CATALOG_SOURCE_UNAVAILABLE");
```

Fixtures must include a newer `ACTION_REQUIRED` session, a category-null legacy session, a wrong-category ACTIVE session, two same-time ACTIVE sessions, and a manual account ID delegated to `accounts`.

- [x] **Step 6: Run resolver tests and verify RED**

Run: `npm.cmd test --workspace @tool-chenh/api -- --run src/catalog/catalog-source-registry.test.ts`

Expected: FAIL because `CatalogSourceRegistry` does not exist.

- [x] **Step 7: Implement the minimal resolver**

Use these public signatures:

```ts
export interface SupportedCatalogPair {
  readonly provider: Exclude<ProviderId, "FABET">;
  readonly category: Category;
  readonly alias: string;
}

export class CatalogSourceRegistry implements ActiveAccountAccess {
  listStatuses(): Promise<readonly CatalogSourceStatus[]>;
  resolveCatalogSource(id: string): Promise<CatalogSourceIdentity>;
  withActiveHandle<T>(
    id: string,
    expectedProvider: ProviderId,
    consume: (handle: ActiveSecretHandle) => Promise<T>,
    expectedCategory?: Category
  ): Promise<T>;
}
```

Select eligible sessions by exact provider/category and `state === "ACTIVE"`; order by `acquiredAtMs ?? -1`, then `id`. For non-logical IDs, delegate both resolution and handle access to `AccountRegistry`. Return a stable key `catalog-source|provider|category` for logical sources. Re-resolve before handle consumption and confirm the returned handle still has the expected provider/category.

- [x] **Step 8: Run focused resolver and contract gates**

Run: `npm.cmd test --workspace @tool-chenh/api -- --run src/catalog/catalog-source-registry.test.ts; npm.cmd run typecheck --workspace @tool-chenh/api`

Expected: resolver tests pass and API typecheck exits 0.

- [x] **Step 9: Commit Task 1**

```powershell
git add packages/contracts/src/domain.ts packages/contracts/src/schemas.ts packages/contracts/src/schemas.test.ts apps/api/src/catalog/catalog-source-registry.ts apps/api/src/catalog/catalog-source-registry.test.ts
git commit -m "feat: resolve validated logical catalog sources"
```

---

### Task 2: API Composition And Read-Only Source Endpoint

**Files:**
- Create: `apps/api/src/routes/catalog-sources.ts`
- Create: `apps/api/src/routes/catalog-sources.test.ts`
- Modify: `apps/api/src/app.ts`
- Modify: `apps/api/src/app.test.ts`
- Modify: `apps/api/src/sessions/session-services.ts`
- Modify: `apps/api/src/sessions/session-services.test.ts`
- Modify: `apps/api/src/server.ts`

**Interfaces:**
- Consumes: `CatalogSourceRegistry` from Task 1.
- Produces: `GET /api/catalog/sources`, `ManagedSessionServices.catalogSources`, and catalog readers backed by logical-source resolution.

- [x] **Step 1: Write failing route tests**

Test that `/api/catalog/sources` returns only strict redacted statuses and that registry failure produces `503 { error: "CATALOG_SOURCES_UNAVAILABLE" }` without affecting `/api/health`.

```ts
const response = await app.inject({ method: "GET", url: "/api/catalog/sources" });
expect(response.statusCode).toBe(200);
expect(response.json()).toEqual({ sources: [expect.objectContaining({
  id: "catalog-source:SABA:FOOTBALL", provider: "SABA", category: "FOOTBALL"
})] });
expect(JSON.stringify(response.json())).not.toMatch(/token|cookie|launchUrl|trustedHostname/iu);
```

- [x] **Step 2: Run route tests and verify RED**

Run: `npm.cmd test --workspace @tool-chenh/api -- --run src/routes/catalog-sources.test.ts`

Expected: FAIL because the route is absent.

- [x] **Step 3: Implement and register the route**

Create:

```ts
export interface CatalogSourceRegistryLike {
  listStatuses(): Promise<readonly CatalogSourceStatus[]>;
}

export function registerCatalogSourceRoutes(
  app: FastifyInstance,
  sources: CatalogSourceRegistryLike
): void;
```

Validate the outgoing array with `CatalogSourceStatusSchema.array()` before sending it. Coalesce simultaneous list calls for 250 ms, mirroring account-route behavior. Catch list failures and return only the safe error code.

- [x] **Step 4: Run route tests and verify GREEN**

Run: `npm.cmd test --workspace @tool-chenh/api -- --run src/routes/catalog-sources.test.ts src/app.test.ts`

Expected: route and app tests pass.

- [x] **Step 5: Write failing composition tests**

Assert that session services:

- expose exactly the registered source pairs;
- pass the registry, not raw accounts, to catalog readers;
- resolve a stable logical source to the newest ACTIVE test session;
- still allow a manual account ID through the delegate path.

- [x] **Step 6: Run composition tests and verify RED**

Run: `npm.cmd test --workspace @tool-chenh/api -- --run src/sessions/session-services.test.ts`

Expected: FAIL because `catalogSources` is absent.

- [x] **Step 7: Compose supported pairs once**

Define one immutable pair list in `session-services.ts`:

```ts
const supportedCatalogPairs = [
  { provider: "CMD", category: "FOOTBALL", alias: "T-Sports · CMD" },
  { provider: "SABA", category: "FOOTBALL", alias: "C-Sports · SABA" },
  { provider: "SABA", category: "LOL", alias: "SABA Esports" },
  { provider: "SBOBET", category: "FOOTBALL", alias: "K-Sports · SBOBET" },
  { provider: "APSPORT", category: "FOOTBALL", alias: "AP Sports · APSPORT" },
  { provider: "BTI", category: "FOOTBALL", alias: "BTI Football" },
  { provider: "IM", category: "LOL", alias: "IM Esports" }
] as const;
```

Construct `CatalogSourceRegistry({ sessions: manager, accounts, supportedPairs })`, pass it as `accounts` to every observed catalog reader, pass it as `sources` to `MultiProviderCatalogReader`, expose it on `ManagedSessionServices`, and register its route in `buildApp/startServer`.

Do not add IM Football or BTI LoL until their reader registrations exist. CMD may appear unavailable until a validated session exists.

- [x] **Step 8: Run API focused and full gates**

Run: `npm.cmd test --workspace @tool-chenh/api -- --run src/catalog/catalog-source-registry.test.ts src/routes/catalog-sources.test.ts src/sessions/session-services.test.ts src/routes/catalog.test.ts; npm.cmd run typecheck --workspace @tool-chenh/api`

Expected: all focused tests pass and API typecheck exits 0.

- [x] **Step 9: Commit Task 2**

```powershell
git add apps/api/src/routes/catalog-sources.ts apps/api/src/routes/catalog-sources.test.ts apps/api/src/app.ts apps/api/src/app.test.ts apps/api/src/sessions/session-services.ts apps/api/src/sessions/session-services.test.ts apps/api/src/server.ts
git commit -m "feat: expose stable validated catalog sources"
```

---

### Task 3: Web Source Selection Separate From Betting Accounts

**Files:**
- Create: `apps/web/src/api/catalog-sources.ts`
- Create: `apps/web/src/api/catalog-sources.test.ts`
- Modify: `apps/web/src/pages/live-catalog-page.tsx`
- Modify: `apps/web/src/pages/live-catalog-page.test.tsx`
- Modify: `apps/web/src/watch/ticket-preflight-coordinator.test.ts`

**Interfaces:**
- Consumes: `GET /api/catalog/sources`, existing `GET /api/accounts`, and stable logical source IDs.
- Produces: provider checkboxes driven by catalog sources; profile/preflight driven only by real bettor accounts.

- [x] **Step 1: Write failing client tests**

```ts
const sources = await new CatalogSourceApi(fetcher).list();
expect(sources).toEqual([expect.objectContaining({
  id: "catalog-source:SABA:FOOTBALL",
  sessionState: "ACTIVE"
})]);
```

Reject extra fields, malformed IDs, provider/category mismatch, non-JSON, and non-2xx responses.

- [x] **Step 2: Run client tests and verify RED**

Run: `npm.cmd test --workspace @tool-chenh/web -- --run src/api/catalog-sources.test.ts`

Expected: FAIL because `CatalogSourceApi` is absent.

- [x] **Step 3: Implement the strict source client**

Expose:

```ts
export interface CatalogSourceApiLike {
  list(): Promise<readonly CatalogSourceStatus[]>;
}

export class CatalogSourceApi implements CatalogSourceApiLike {
  constructor(fetcher: typeof fetch = window.fetch.bind(window));
  list(): Promise<readonly CatalogSourceStatus[]>;
}
```

Use `cache: "no-store"` and validate with `CatalogSourceStatusSchema.array()`.

- [x] **Step 4: Run client tests and verify GREEN**

Run: `npm.cmd test --workspace @tool-chenh/web -- --run src/api/catalog-sources.test.ts`

Expected: all client tests pass.

- [x] **Step 5: Write failing page regressions**

Add tests proving:

1. A source remains checked and continues loading after its backing session changes while its logical ID stays constant.
2. Catalog calls use `catalog-source:PROVIDER:CATEGORY`, never a bettor account ID.
3. Preflight receives a separate ACTIVE/FRESH account with `PROFILE` and `PREFLIGHT` for the matching provider/category.
4. A catalog-only source cannot be passed as a preflight account.
5. An unavailable source remains visible with its explicit reason; it is not rendered as zero matches.
6. Football and LoL screens request only their fixed category.

- [x] **Step 6: Run page tests and verify RED**

Run: `npm.cmd test --workspace @tool-chenh/web -- --run src/pages/live-catalog-page.test.tsx`

Expected: FAIL because the page still derives catalog selection from `AccountStatus`.

- [x] **Step 7: Separate the two identities in the page**

Replace `oneAccountPerProvider(accounts)` for catalog loading with source statuses grouped by provider/category. Keep `AccountApi` for profiles and preflight only.

Add a pure selector:

```ts
export function selectBettingAccount(
  accounts: readonly AccountStatus[],
  provider: ProviderId,
  category: Category
): AccountStatus | null;
```

Eligibility requires `sessionState === "ACTIVE"`, exact category, `profileState === "FRESH"`, capabilities `PROFILE` and `PREFLIGHT`, non-null currency/balance/balanceAsOfMs. Order by newest `balanceAsOfMs`, then ID. The function never returns a catalog source because sources use a different contract.

Use accepted catalog providers to select bettor accounts for `TicketPreflightCoordinator.refresh`. Update `filterAccountBackedSignals` to map each signal leg to `selectBettingAccount`, not to `catalog.accountId`.

On source refresh, replace status metadata but retain checkbox membership by stable source ID. If a source becomes unavailable, retain only bounded stale display and invalidate signals/preflight immediately.

- [x] **Step 8: Run web focused gates**

Run: `npm.cmd test --workspace @tool-chenh/web -- --run src/api/catalog-sources.test.ts src/pages/live-catalog-page.test.tsx src/watch/ticket-preflight-coordinator.test.ts src/watch/ranked-tickets.test.ts; npm.cmd run typecheck --workspace @tool-chenh/web`

Expected: all focused tests pass and Web typecheck exits 0.

- [x] **Step 9: Commit Task 3**

```powershell
git add apps/web/src/api/catalog-sources.ts apps/web/src/api/catalog-sources.test.ts apps/web/src/pages/live-catalog-page.tsx apps/web/src/pages/live-catalog-page.test.tsx apps/web/src/watch/ticket-preflight-coordinator.test.ts
git commit -m "feat: keep catalog sources stable across launcher rotation"
```

---

### Task 4: Full Verification, Live Read-Only Smoke, And Progress Record

**Files:**
- Create: `docs/superpowers/reports/2026-08-13-validated-catalog-source-binding-report.md`
- Modify: `proccess.md`
- Modify: `sảnh.md`

**Interfaces:**
- Consumes: production build and existing encrypted local sessions.
- Produces: evidence-backed provider matrix; no betting state change.

- [x] **Step 1: Stop only project-owned live readers before automated verification**

Resolve port 4310 and Chromium processes whose command line contains the project browser-profile directory. Stop those exact project-owned processes; do not delete profiles, vault records, cookies, or user browser data.

- [x] **Step 2: Run the full automated gate**

Run: `npm.cmd run verify`

Expected: every workspace typecheck, unit suite, integration suite, fixture-stack test, and watch smoke exits 0.

- [x] **Step 3: Run production build and diff check**

Run: `npm.cmd run build; git diff --check`

Expected: production builds exit 0 and diff check reports no whitespace errors.

- [x] **Step 4: Start the production API hidden and verify health**

Start `node apps/api/dist/server.js` with hidden window and redirected logs under `.run/`. Verify `GET http://127.0.0.1:4310/api/health` returns `mode: "OBSERVE"` and `executionReady: false`.

- [x] **Step 5: Verify logical source statuses**

Call `GET /api/catalog/sources`. Record only provider, category, session state, reason, and acquired time. Confirm the response contains no URL, token, cookie, username, password, trusted hostname, or backing session ID.

- [x] **Step 6: Perform one bounded read-only catalog smoke per ACTIVE source**

For each ACTIVE logical source, call `/api/catalog/accounts/{logicalSourceId}` and record HTTP status, duration, event count, market count, quote count, rejected market count, and observed timestamp. Never open a bet slip and never call preflight, dry-run execution, receipt, or submit routes in this smoke.

- [x] **Step 7: Verify launcher rotation without manual account creation**

Trigger only the existing read-only Fabet renew/capture flow if renewal is due. Confirm the logical source ID remains identical while `acquiredAtMs` advances and a subsequent catalog read succeeds through the new ACTIVE session. If no rotation occurs during the test window, verify the behavior using the registry integration fixture and report the live source as unchanged rather than manufacturing a rotation.

- [x] **Step 8: Write the report and update the two project records**

Create the in-worktree report, append one dated checkpoint to `proccess.md`, and update the provider matrix in `sảnh.md`. State exact snapshot counts, failures, remaining unsupported pairs, test totals, commits, `OBSERVE` mode, and that no bet was sent. Storage/document update errors must be caught and reported without stopping the live API.

- [x] **Step 9: Commit only files owned by this plan**

```powershell
git add docs/superpowers/reports/2026-08-13-validated-catalog-source-binding-report.md
git commit -m "docs: record validated catalog source rollout"
```

Do not stage unrelated dirty execution/history/BTI files. Root-level `proccess.md` and `sảnh.md` may be outside the linked worktree and must remain as explicit workspace changes when Git cannot stage them from this worktree.
