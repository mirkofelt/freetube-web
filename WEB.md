# FreeTube — Self-Hosted Web Deployment

This document covers how to build and run FreeTube as a self-hosted web application (Docker / Unraid / any Linux host). The web build is a Vue 3 SPA served by a minimal Express backend; all user data stays in the browser via IndexedDB.

---

## Architecture overview

```
Browser (Vue 3 + Vuex + Shaka Player)
  │  IndexedDB (NeDB/localForage) — settings, history, playlists
  │  Cache API — player script cache
  │  BroadcastChannel — multi-tab sync
  │
  └─ HTTPS (same-origin)
       │
       Express server (Node.js)
         ├─ GET  /api/health            — health check
         ├─ POST /api/po-token          — BotGuard PoToken generation (Playwright)
         ├─ GET  /api/system/version    — server/Node version info
         └─ *    static dist/web/       — serves the SPA
```

The only thing the backend does is generate PoTokens via a headless Chromium page.  
Everything else — persistence, playback, subscriptions — runs entirely in the browser.

---

## Environment variables

| Variable          | Default     | Description |
|-------------------|-------------|-------------|
| `PORT`            | `8080`      | TCP port the Express server listens on |
| `NODE_ENV`        | `production`| Node environment. Set to `development` to enable stack traces in error responses |
| `HOST_PORT`       | `8080`      | (docker-compose only) Host port mapped to the container port |
| `FREETUBE_USERS`  | `default`   | Comma-separated list of user names for multi-user mode (see below) |

No secrets, no database connection strings, and no API keys — YouTube authentication happens inside the headless Chromium session at PoToken-generation time.

### Multi-user mode

Set `FREETUBE_USERS` to a comma-separated list of names to enable a user picker at the root URL:

```
FREETUBE_USERS=alice,bob,carol
```

- Visiting `http://<host>:8080/` shows a "Who's watching?" picker.
- Each name gets its own URL: `/u/alice/`, `/u/bob/`, `/u/carol/`.
- All data (subscriptions, history, playlists, settings) is stored in the **browser's IndexedDB** under a per-user prefix, so each user's data is isolated even on a shared device.
- Names are lowercased and sanitised to `[a-z0-9_-]` — `"Alice"` becomes `"alice"`.
- The `GET /api/users` endpoint returns the current user list.

Single-user mode (default `FREETUBE_USERS=default`): the root immediately redirects to `/u/default/` with no picker shown.

---

## Quick start with Docker Compose

```bash
# Clone / pull the repo, then:
docker compose up -d

# The app is now available at http://<host>:8080
```

To change the port:

```bash
HOST_PORT=9090 docker compose up -d
# or add HOST_PORT=9090 to a .env file next to docker-compose.yml
```

---

## Quick start — Docker only

```bash
docker build -t freetube-web .

docker run -d \
  --name freetube-web \
  -p 8080:8080 \
  -e NODE_ENV=production \
  -e PORT=8080 \
  --restart unless-stopped \
  freetube-web
```

---

## Unraid Community Applications template

Add the container manually with:

| Setting | Value |
|---------|-------|
| Name | `freetube-web` |
| Repository | `freetube-web` (local build) or your registry image |
| Port mapping | `8080 → 8080 TCP` |
| Restart policy | `Unless stopped` |

No path mappings are needed — all data lives in the browser.

---

## Building from source

Requirements: Node.js 20+, pnpm 9+

```bash
# Install dependencies
pnpm install

# Build the botGuard script and web frontend
pnpm pack:botGuardScript
pnpm pack:web

# Install server dependencies
cd server && npm install
cd ..

# Run
node server/index.js
```

---

## Health check

```
GET /api/health
→ 200 { "status": "ok", "version": "1.0.0" }
```

Docker Compose and the Dockerfile both configure this as the health check endpoint.

---

## Notes

- **First PoToken request** launches a headless Chromium instance. This adds ~1–3 seconds to the first video load after a cold start. Subsequent requests are faster because the browser process stays alive.
- **Data privacy** — all your watch history, settings, and playlists live in your browser's IndexedDB. Clearing browser data removes them. There is no server-side storage.
- **Proxy** — the web build does not support the proxy settings UI (a browser cannot switch its own proxy programmatically). Proxy the entire container with a reverse proxy such as Nginx or Traefik if needed.
