# Live session setup

This page configures authentication only. It does not place bets. The current build can read a validated CMD Football catalog; SABA, SBOBET, APSPORT, BTI, IM, and live LoL still require separately verified adapters.

## Start the local application

From the repository worktree:

```powershell
npm.cmd run build
npm.cmd run dev:fixture
```

Open `http://127.0.0.1:4311/sessions`.

## Fabet login

1. Enter a reachable HTTPS Fabet URL. If `fabet.com` is blocked, enable VPN/WARP or paste the current mirror, such as `https://fabet.party/`.
2. Select **Discover domain**. Discovery does not send a username or password.
3. Review the final hostname after redirects and explicitly trust that exact hostname.
4. Enter the Fabet username and password, then select **Save and connect**.

A visible local browser may open. Complete CAPTCHA or other interactive verification manually. The application visits only the live-sports and esports lobbies and captures provider launch sessions; it does not click wager, payment, or bet controls.

Captured provider rows identify the provider and hostname when possible. They remain `ACTION_REQUIRED` until that provider has a protocol-specific validator; the application never reports an unverified raw token as healthy.

## Direct provider session

Use **Direct provider session** when Fabet is inaccessible or a different portal supplied the token, cookie bundle, or launch URL. The source portal does not matter. Select the provider, choose the secret type, paste the value once, and save it.

Raw provider secrets without a protocol-specific validator remain `ACTION_REQUIRED`. `ACTIVE` means the configured validator actually accepted the current session.

## Session states

- `ACTIVE`: validated and available to its provider adapter.
- `VALIDATING` or `RENEWING`: temporarily withheld until validation finishes.
- `ACTION_REQUIRED`: operator action or a provider-specific validator is required.
- `INVALID`: rejected or expired.

Every active session is forced through renewal after 24 hours. If renewal fails, it is withheld and the UI shows a redacted reason; secrets are never returned by the API.

## Reset

Select **Reset Fabet session**, review the confirmation, then confirm. This clears Fabet credentials, captured Fabet launch sessions, trusted Fabet domains, and the isolated browser profile. Direct provider sessions are preserved.

Secrets are encrypted with Windows DPAPI for the current Windows user and stored below `%LOCALAPPDATA%\tool-chenh\.auth`. Do not copy the encrypted files to another Windows account and expect them to decrypt.

## Betting safety

This milestone is read-only. No balance is used and no wager is submitted. Any future execution feature must require explicit confirmation for each bet before either leg is placed.

## Watch one live match

1. Open `http://127.0.0.1:4311/live-catalog`.
2. Select an active catalog-capable account and load the live Football catalog.
3. On a genuinely returned event, select **View & watch**.
4. The detail view shows current provider markets, lines, selections, odds, and `OPEN`/`SUSPENDED` state. It polls sequentially: the next read starts one second after the previous read settles, so provider reads never overlap.
5. The change log records odds movement, market/selection suspension, reopening, event disappearance, and safe poll failures. **Stop watching** pauses reads; **Clear log** removes the bounded local history for that provider event.

Watcher logs contain sports metadata only and retain at most 200 rows in browser storage. They never contain an account ID, token, cookie, credential, authorization header, or launch URL.

CMD currently exposes verified Football data only. G2 vs TH or another LoL match will not appear until a verified LoL adapter returns it; do not use fixture data as a substitute for a live proof.

The displayed sample interval is the time between accepted observations from one provider. It is not cross-book delay. Cross-book timing becomes available only after two distinct providers are connected and the event, market, line, outcome domain, and settlement rules pass exact mapping. The watcher can measure an observed delay but cannot change a bookmaker's update latency.

For a bounded terminal smoke observation against the local LIVE API:

```powershell
node scripts/smoke-watch-match.mjs --duration-ms 120000 --poll-ms 1000
```

The command chooses only an accepted event returned by the active provider account, prefers a live event, prints safe JSON lines for real transitions, and reports the true sample/change count even when no odds move during the observation window.

## Two-way gross stake preflight

The Football catalog intentionally excludes `FT_1X2` and every market that does not have exactly two canonical outcomes. The current verified two-way feed is `FT_TOTAL` (`OVER`/`UNDER`) at one exact line and settlement profile.

Set **Base stake for every match (VND)** once in the catalog toolbar. The default is `100000`; valid values are at least `30000` and use `1000` VND steps. This non-secret preference is retained in browser storage across reloads.

For each exact two-provider row, the lower decimal odds receives the configured base stake. The other stake is calculated as `base stake × lower odds ÷ higher odds`, then the adjacent valid `1000` VND steps are evaluated. For example, odds `1.8` and `2.5` with a `100000` base produce a `72000` hedge, `172000` total, and `8000` gross profit for either outcome.

The list and watched-match detail show both providers, selections, decimal odds, `BASE`/`HEDGE` stakes, both outcome profits, worst-case profit, and ROI. A ten-second `GROSS TWO-WAY PREFLIGHT` toast appears only when both rounded profits are positive.

No plan or toast is shown if the outcome count is not two, both best outcomes come from one provider, a selected provider/event/market is missing, a quote or market is not `OPEN`, odds are invalid, stake constraints fail, polling is stale, or either rounded profit is non-positive. These are gross calculations because this catalog path does not yet contain verified bookmaker fees or account-specific placement limits. No wager is submitted.
