# Live session setup

This page configures authentication only. It does not place bets, and the current build does not yet ingest real odds from CMD, SABA, SBOBET, APSPORT, BTI, or IM.

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
