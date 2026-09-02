# PHÂN BIỆT LOCAL VÀ DEV

- **LOCAL:** `http://127.0.0.1:4311/football-live`
- **DEV PUBLIC:** `https://live.babiesbo.uk/football-live`
- Cấm gọi URL `127.0.0.1` là dev.
- Chỉ báo "đã deploy dev" khi `https://live.babiesbo.uk/football-live` trả HTTP 200 và `/api/health` public trả đúng build identity vừa deploy.

```powershell
cd 'F:\0. PROJECT\tool-chenh\.worktrees\arbitrage-foundation'
npm.cmd run start:live
```

Local: http://127.0.0.1:4311/football-live

Tunnel (PowerShell thứ hai):

```powershell
cd 'F:\0. PROJECT\tool-chenh\.worktrees\arbitrage-foundation'
.\.run\cloudflared\start-fieldline-live.ps1
```

Public: https://live.babiesbo.uk/football-live


=== deploy 
cd 'F:\0. PROJECT\tool-chenh\.worktrees\arbitrage-foundation'
npm.cmd run start:live


cd 'F:\0. PROJECT\tool-chenh\.worktrees\arbitrage-foundation'
.\.run\cloudflared\start-fieldline-live.ps1

feat/six-provider-realtime-feed
