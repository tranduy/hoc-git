# Live Cloudflare Tunnel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish the local live-odds dashboard at `https://live.babiesbo.uk` without exposing the Chrome extension bridge or provider sessions.

**Architecture:** A Cloudflare named Tunnel forwards `live.babiesbo.uk` only to the local Vite web origin on `127.0.0.1:4311`; Vite continues proxying `/api` and realtime WebSockets to the loopback Fastify API at `127.0.0.1:4310`. The Chrome extension remains hard-bound to loopback and is never routed through the public hostname.

**Tech Stack:** Node.js, Fastify, Vite, Cloudflare Tunnel, Cloudflare DNS, Cloudflare Access.

## Global Constraints

- Public hostname is exactly `live.babiesbo.uk`.
- API process continues to bind only a loopback host.
- Chrome bridge remains `ws://127.0.0.1:4310/api/chrome-bridge`.
- Cloudflare Access will protect the public dashboard once it is enabled in the Cloudflare account. The API reported Access is not enabled during this deployment.
- Tunnel token is stored outside git and runs as a local Windows service/process.

---

### Task 1: Permit the single public dashboard origin

**Files:**
- Modify: `apps/api/src/app.ts`
- Modify: `apps/api/src/app.test.ts`
- Modify: `apps/web/vite.config.ts`
- Modify: `.env.example`

**Interfaces:**
- Consumes: `VITE_ORIGIN` string from `resolveServerConfig`.
- Produces: API acceptance of `https://live.babiesbo.uk` while retaining loopback-only bind and extension exception.

- [x] **Step 1: Write the failing tests**

```ts
expect(resolveServerConfig({ VITE_ORIGIN: "https://live.babiesbo.uk" }).viteOrigin)
  .toBe("https://live.babiesbo.uk");
expect(() => resolveServerConfig({ VITE_ORIGIN: "https://evil.example" })).toThrow(/allowed/u);
```

- [x] **Step 2: Run the API test to verify it fails**

Run: `npm.cmd test --workspace @tool-chenh/api -- --run src/app.test.ts`

- [x] **Step 3: Implement the minimal exact-origin allow-list**

```ts
const allowedOrigins = new Set(["http://127.0.0.1:4311", "http://localhost:4311", "https://live.babiesbo.uk"]);
```

Reject all other origins; leave `API_HOST` loopback validation unchanged. Add `live.babiesbo.uk` to Vite's `allowedHosts` and document its exact `VITE_ORIGIN` value.

- [x] **Step 4: Run the API test and web typecheck**

Run: `npm.cmd test --workspace @tool-chenh/api -- --run src/app.test.ts`

Run: `npm.cmd run typecheck --workspace @tool-chenh/web`

### Task 2: Provision and run the protected Cloudflare Tunnel

**Files:**
- Create: `.run/cloudflared/live.ps1` (ignored runtime launcher)
- Modify: `run.md`

**Interfaces:**
- Consumes: Cloudflare named tunnel token and local origin `http://127.0.0.1:4311`.
- Produces: a long-running local replica for `live.babiesbo.uk` and a concise operator command.

- [x] **Step 1: Create or reuse named tunnel `fieldline-live`**

Use Cloudflare Tunnel API; inspect existing tunnels first. Configure ingress exactly:

```json
{"config":{"ingress":[{"hostname":"live.babiesbo.uk","service":"http://127.0.0.1:4311"},{"service":"http_status:404"}]}}
```

- [~] **Step 2: Create proxied DNS route and Cloudflare Access application**

DNS CNAME targets the tunnel. Access policy permits only the Cloudflare account owner email and denies unauthenticated requests.

- [x] **Step 3: Install cloudflared and create local launcher**

```powershell
cloudflared tunnel --no-autoupdate run --token $env:FIELDLINE_TUNNEL_TOKEN
```

Persist the token only in the current Windows user's protected local environment/configuration, never in `.env.example`, source, logs, or git.

- [x] **Step 4: Verify public HTTP and realtime WebSocket**

Check `/football-live`, `/api/health`, and the dashboard realtime socket through `https://live.babiesbo.uk`. Confirm Chrome extension bridge stays local by checking its endpoint remains `127.0.0.1:4310`.

### Task 3: Production handoff

**Files:**
- Modify: `run.md`

**Interfaces:**
- Consumes: local stack and tunnel launcher.
- Produces: two short start commands and fault checks.

- [x] **Step 1: Add concise operator commands**

Document starting local stack, starting the tunnel, local health check, and public health check.

- [x] **Step 2: Run final verification**

Run: `npm.cmd run typecheck --workspace @tool-chenh/api`

Run: `npm.cmd test --workspace @tool-chenh/api -- --run src/app.test.ts`

Run: `npm.cmd run build --workspace @tool-chenh/web`

Run: public `https://live.babiesbo.uk/api/health` check after Tunnel is connected.
