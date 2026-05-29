<p align="center">
  <img alt="FreeTube" src="./_icons/logoColor.svg" width="420"/>
</p>

<h3 align="center">FreeTube — Self-Hosted Web</h3>
<p align="center">Watch YouTube privately, in your browser, from your own server.</p>

<p align="center">
  <a href="#quick-start">Quick Start</a> &bull;
  <a href="#multi-user">Multi-User</a> &bull;
  <a href="#unraid">Unraid</a> &bull;
  <a href="./WEB.md">Full Docs</a>
</p>

---

## ⚠️ This is a fork — not the official FreeTube project

**The original FreeTube** is a privacy-focused desktop YouTube client for Windows, macOS, and Linux, built with Electron by the FreeTube team.

➡️ **Official project:** https://github.com/FreeTubeApp/FreeTube  
➡️ **Official website:** https://freetubeapp.io  
➡️ **Download the desktop app:** https://github.com/FreeTubeApp/FreeTube/releases

This repository (`mirkofelt/freetube-web`) is an **unofficial, community fork** that repackages FreeTube's Vue 3 frontend as a self-hosted web server. It is not affiliated with, endorsed by, or officially supported by the FreeTube project.

If you're looking for the **desktop app**, go to the links above.  
If you want to **self-host FreeTube in a browser** via Docker, you're in the right place.

---

## What this fork adds

| | FreeTube Desktop (upstream) | **FreeTube Web (this fork)** |
|---|---|---|
| Interface | Electron desktop app | Any modern browser |
| Install | Per-device download | One Docker container |
| Data storage | Local files | Browser IndexedDB |
| Multi-user | Profiles within one install | Per-user namespaced storage + picker |
| PoToken generation | Built-in (WebContentsView) | Express + Playwright (headless Chromium) |
| Self-hosted | No | **Yes** |

**All core features are from upstream FreeTube:**
- No ads, no tracking, no Google account required
- Invidious API and local YouTube.js API support
- Subscriptions, playlists, watch history — stored in your browser (no server database)
- SponsorBlock, DeArrow, LBRY
- Shaka Player — quality selection, playback speed, subtitles, PiP

---

## Quick start

```bash
# 1 — clone
git clone https://github.com/mirkofelt/freetube-web
cd freetube-web

# 2 — build and start (takes a few minutes on first run; pulls Playwright/Chromium)
docker compose up -d

# 3 — open
open http://localhost:8080
```

No volumes, no database, no API keys required.

---

## Multi-user

Set `FREETUBE_USERS` to a comma-separated list of names to show a profile picker:

```bash
FREETUBE_USERS=alice,bob,carol docker compose up -d
```

A "Who's watching?" screen appears at `/`. Each person gets their own subscriptions, history,
and settings — isolated in their browser's IndexedDB. Profiles can be added, renamed, and
deleted from the picker without restarting the container.

---

## Unraid

Search **FreeTube Web** in the Community Applications plugin, or add the template URL manually:

```
https://raw.githubusercontent.com/mirkofelt/freetube-web/develop/unraid/freetube-web.xml
```

Or drop the template file from this repo directly into CA:

```
unraid/freetube-web.xml
```

---

## Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `8080` | Port the server listens on inside the container |
| `FREETUBE_USERS` | `default` | Comma-separated profile names. Single name = no picker shown. |
| `NODE_ENV` | `production` | Set to `development` for verbose server errors |
| `HOST_PORT` | `8080` | *(docker-compose only)* Host-side port mapping |

---

## Architecture

```
Browser  ──────────────────────────────────────────────────────
  Vue 3 + Vuex + Shaka Player
  Subscriptions / history / settings → IndexedDB (per-user prefix)
  Player cache → Cache API
  Multi-tab sync → BroadcastChannel

  ↕ HTTP (same-origin)

Express server (Node.js)
  GET  /                   user picker or redirect to /u/default/
  GET  /u/:username/       SPA with injected window.__FT_USER_ID__
  GET  /api/health         health check (used by Docker / Unraid)
  GET  /api/users          list profiles
  POST /api/users          add profile
  PATCH /api/users/:id     rename / recolour profile
  DELETE /api/users/:id    remove profile
  POST /api/po-token       BotGuard PoToken via Playwright headless Chromium
  *    static dist/web/    built Vue SPA
```

---

## Building from source

Requirements: **Node.js 22+**, **pnpm 11+**

```bash
pnpm install
pnpm pack:botGuardScript   # compile the BotGuard bundle used by the PoToken service
pnpm pack:web              # compile the Vue SPA → dist/web/

cd server && npm install && cd ..
node server/index.js
```

---

## Keeping up with upstream FreeTube

This fork tracks upstream FreeTube releases. See
[`docs/upstream-update-runbook.md`](./docs/upstream-update-runbook.md)
for the step-by-step process of pulling in new releases.

---

## Documentation index

| File | Contents |
|------|----------|
| [`WEB.md`](./WEB.md) | Full deployment guide (Docker, Unraid, bare Node, all env vars) |
| [`docs/webapp-architecture.md`](./docs/webapp-architecture.md) | Backend design and API contract |
| [`docs/electron-vs-web-audit.md`](./docs/electron-vs-web-audit.md) | Electron-only vs. portable code |
| [`docs/migration-ruleset.md`](./docs/migration-ruleset.md) | Pattern-by-pattern Electron → Web mapping |
| [`docs/upstream-update-runbook.md`](./docs/upstream-update-runbook.md) | How to merge new upstream FreeTube releases |

---

## License

[AGPL-3.0-or-later](./LICENSE) — same as upstream FreeTube.
