# FreeTube Web — Target Architecture

> Companion to `electron-vs-web-audit.md`.  
> Defines the backend framework, deployment shape, and the stable API contract between frontend and backend.

---

## 1. Design Principle

The existing web build (`webpack.web.config.js`) already runs in a browser without any backend: NeDB uses `localForage` (IndexedDB) for persistence, the File System Access API handles screenshots, and `navigator.language` gives the locale. The only capability that genuinely cannot be handled in a browser is **PoToken (BotGuard) generation**, because BotGuard requires a real browser environment to prove origin.

**Conclusion: the backend is minimal.** Its only mandatory job is to generate PoTokens. Everything else is either already working in the web build or can be shimmed with a web-native API.

```
┌─────────────────────────────────────────────────────────┐
│  Browser (Vue 3 + Vuex + Shaka Player)                  │
│                                                         │
│  DB: @seald-io/nedb → localForage (IndexedDB)           │
│  Player cache: Cache API / localStorage                 │
│  Screenshots: File System Access API / <a download>     │
│  Tab sync: BroadcastChannel                             │
│  Locale: navigator.language                             │
│  Navigation: window.navigation / History API            │
└──────────────────┬──────────────────────────────────────┘
                   │ HTTPS (same origin)
┌──────────────────▼──────────────────────────────────────┐
│  Express.js server (Node.js)                            │
│                                                         │
│  • Serves dist/web/ as static files                     │
│  • POST /api/po-token  (Playwright headless browser)    │
│  • GET  /api/health                                     │
│  • Optional: GET /api/system/version                    │
└─────────────────────────────────────────────────────────┘
```

---

## 2. Backend Framework Choice

### Decision: Express.js (Node.js)

**Rationale:**

| Criterion | Express.js | FastAPI (Python) | Fastify (Node.js) |
|-----------|-----------|----------------|--------------------|
| Language match | ✅ Same as codebase | ❌ New language stack | ✅ Same |
| Reuse existing code | ✅ `datastores/`, `constants.js` | ❌ Full rewrite | ✅ Same |
| Complexity | Minimal | New ecosystem | Slightly more config |
| Docker footprint | Small (node:alpine) | Larger (python:slim) | Small |
| Ecosystem familiarity | High (FreeTube devs already know JS) | Low | Medium |

FastAPI is rejected because it requires Python, cannot reuse any existing FreeTube code, and adds a second language to maintain. Fastify is a valid alternative to Express, but Express has no meaningful downside here given the minimal surface area of the backend.

### Runtime Requirements
- Node.js 20+
- Playwright (or Puppeteer) for the PoToken headless browser — this is the only heavy dependency
- The `bgutils-js` package is already in `package.json`; PoToken generation needs it running inside a headless Chromium page (same as the Electron approach, but using Playwright instead of `WebContentsView`)

---

## 3. Directory Layout

```
freetube-web/
├── server/                       ← new (the Express backend)
│   ├── index.js                  ← entry point: app + listen
│   ├── routes/
│   │   ├── health.js
│   │   └── poToken.js
│   ├── services/
│   │   └── poTokenService.js     ← Playwright wrapper (mirrors main/poTokenGenerator.js)
│   └── package.json              ← separate deps (express, playwright)
├── src/                          ← existing FreeTube source (unchanged)
├── dist/
│   └── web/                      ← built by `pnpm pack:web`; served by Express
└── docs/
    ├── electron-vs-web-audit.md
    └── webapp-architecture.md    ← this file
```

The server lives in its own `server/` directory and does **not** touch `src/`. The frontend is built independently; the server only serves the resulting static files and adds the PoToken endpoint.

---

## 4. API Contract

All endpoints are under `/api/`. The frontend calls them using standard `fetch()`.  
The contract is intentionally narrow — adding new Electron features does not require adding backend endpoints unless they fall into the categories below.

### 4.1 Health

```
GET /api/health
```

Response `200 OK`:
```json
{ "status": "ok", "version": "1.0.0" }
```

No authentication. Used by Docker health checks and the frontend startup check.

---

### 4.2 PoToken Generation

This is the **only endpoint the frontend strictly requires from the backend**.

```
POST /api/po-token
Content-Type: application/json
```

Request body:
```json
{
  "videoId": "dQw4w9WgXcQ",
  "context": "<base64-encoded InnerTube context string>"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `videoId` | string (11 chars) | yes | YouTube video ID |
| `context` | string | yes | InnerTube visitor data context, as passed by `local.js` |

Response `200 OK`:
```json
{ "poToken": "<generated token string>" }
```

Response `400 Bad Request` (invalid input):
```json
{ "error": "invalid_input", "message": "videoId must be 11 characters" }
```

Response `500 Internal Server Error` (generation failed):
```json
{ "error": "generation_failed", "message": "BotGuard script execution failed" }
```

**Implementation note:** `poTokenService.js` mirrors the existing `src/main/poTokenGenerator.js` logic using Playwright's `page.evaluate()` in place of Electron's `webContents.executeJavaScript()`. The queue-and-cleanup pattern from the original should be preserved to avoid OS resource exhaustion (same reason it was used in the Electron implementation).

**Frontend call site:** `src/renderer/helpers/api/local.js` — the `IS_ELECTRON` branch that currently calls `window.ftElectron.generatePoToken(videoId, context)` will be replaced with a `fetch('/api/po-token', ...)` call when `IS_ELECTRON` is false.

---

### 4.3 Optional: System Version

Useful if the frontend wants to display the server version or check for compatibility.

```
GET /api/system/version
```

Response `200 OK`:
```json
{ "serverVersion": "1.0.0", "nodeVersion": "20.11.0" }
```

This endpoint is optional and has no corresponding Electron IPC channel; it is purely for observability.

---

## 5. Endpoints NOT Needed (and why)

The following Electron IPC channels have no backend equivalent because they are handled client-side or are not applicable in a browser context:

| Electron IPC / feature | Web replacement | Backend needed? |
|------------------------|-----------------|-----------------|
| `db-settings`, `db-history`, `db-profiles`, `db-playlists`, `db-search-history`, `db-subscription-cache` | NeDB + localForage already works in-browser | **No** |
| `sync-settings`, `sync-history`, etc. | `BroadcastChannel` API — tabs sync themselves | **No** |
| `player-cache-get/set` | `localStorage` or `Cache API` | **No** |
| `get-system-locale` | `navigator.language` / `navigator.languages` | **No** |
| `get-navigation-history` | `window.navigation` API (already has `|| 'navigation' in window` branch in `TopNav.vue`) | **No** |
| `enable-proxy`, `disable-proxy` | Not applicable — browsers don't support programmatic proxy switching | **No** (hide UI) |
| `start/stop-power-save-blocker` | `navigator.wakeLock.request('screen')` | **No** |
| `open-in-external-player` | Not applicable in a browser context | **No** (hide UI) |
| `choose-default-folder`, `write-to-default-folder` | `showSaveFilePicker` (already has fallback in `ft-shaka-video-player.js`) | **No** |
| `relaunch-request` | `window.location.reload()` | **No** |
| `create-new-window` | `window.open()` | **No** |
| `set-invidious-authorization` | `Authorization` header set directly in `fetch()` | **No** |
| `native-theme-update` | `window.matchMedia('(prefers-color-scheme: dark)')` listener | **No** |
| `toggle-replace-http-cache` | Not applicable (Electron experiment) | **No** |

---

## 6. Frontend Changes Required

These are the code-side changes needed to wire the frontend to the backend. All are guarded by `IS_ELECTRON` already; only the `else` branch needs implementing.

### 6.1 PoToken (`src/renderer/helpers/api/local.js`)

Current Electron branch (line ~443):
```js
if (process.env.IS_ELECTRON) {
  contentPoToken = await window.ftElectron.generatePoToken(videoId, context)
}
```

Web branch to add:
```js
// Already partially handled — just needs the fetch call:
else {
  const resp = await fetch('/api/po-token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ videoId, context })
  })
  if (resp.ok) {
    contentPoToken = (await resp.json()).poToken
  }
}
```

### 6.2 Player Cache (`src/renderer/helpers/api/PlayerCache.js`)

Currently calls `window.ftElectron` unconditionally (no `IS_ELECTRON` guard). Needs a `localStorage`/`Cache API` implementation:

```js
// Suggested: use Cache API for binary data (ArrayBuffer)
const CACHE_NAME = 'freetube-player-cache'

export async function playerCacheGet(key) {
  const cache = await caches.open(CACHE_NAME)
  const response = await cache.match(`/player-cache/${key}`)
  return response ? response.arrayBuffer() : undefined
}

export async function playerCacheSet(key, value) {
  const cache = await caches.open(CACHE_NAME)
  await cache.put(`/player-cache/${key}`, new Response(value))
}
```

This file is the only renderer helper that calls `window.ftElectron` without an `IS_ELECTRON` guard — it needs to be fixed regardless of backend work.

### 6.3 Multi-tab Sync (`src/renderer/store/modules/settings.js`)

The `setupListenersToSyncWindows` action currently only runs under `IS_ELECTRON`. For the web build, replace with `BroadcastChannel`:

```js
// In the web build's setupListenersToSyncWindows (or a new setupBroadcastSync action):
const bc = new BroadcastChannel('freetube-sync')
bc.onmessage = (event) => {
  const { channel, payload } = event.data
  // dispatch the same mutations as the existing sync handlers
}

// After any DB mutation, broadcast to other tabs:
bc.postMessage({ channel: 'sync-settings', payload: { event, data } })
```

### 6.4 Proxy Settings (`src/renderer/components/ProxySettings/ProxySettings.vue`)

Hide the enable/disable proxy buttons entirely in the web build (they already have `IS_ELECTRON` guards, so nothing to add — just confirm the UI hides correctly).

### 6.5 External Player Settings (`src/renderer/components/ExternalPlayerSettings.vue`, `PlayerSettings.vue`)

Already hidden in web build via `IS_ELECTRON` guards. No changes needed.

---

## 7. Contract Stability Rules

These rules protect the API contract from breaking when FreeTube upstream updates its Electron IPC surface:

1. **The backend exposes exactly `/api/health` and `/api/po-token` as mandatory endpoints.** Any new FreeTube feature that requires a backend must add a new endpoint under `/api/` — never repurpose an existing one.

2. **Request/response shapes are versioned via the `Content-Type` header, not URL versioning.** Use `application/json; version=1` if breaking changes are ever needed. For now, there is only v1.

3. **The `videoId` + `context` fields in the PoToken request body map directly to the arguments of `window.ftElectron.generatePoToken(videoId, context)` in `src/preload/interface.js`.** If the Electron interface adds or removes parameters, the backend endpoint must be updated to match.

4. **The frontend must never hard-code the backend origin.** Use a relative URL (`/api/po-token`), so the same frontend build works whether served by the Express server directly or behind a reverse proxy (e.g., Nginx on Unraid).

5. **The backend must set `Access-Control-Allow-Origin: <same-origin>` only.** Do not expose the PoToken endpoint publicly — BotGuard tokens are single-use and bound to a visitor context, but there is no point in letting arbitrary clients use the server's Chromium instance.

---

## 8. Deployment: Docker Compose Sketch

```yaml
services:
  freetube:
    build: .
    image: freetube-web:latest
    ports:
      - "8080:8080"
    environment:
      - NODE_ENV=production
      - PORT=8080
    volumes:
      - freetube-data:/data          # not used by server (DB is in browser)
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8080/api/health"]
      interval: 30s
      timeout: 5s
      retries: 3

volumes:
  freetube-data:
```

The `Dockerfile` would:
1. Build the web frontend (`pnpm pack:web`) — output to `dist/web/`
2. Install Playwright's Chromium
3. Run `node server/index.js`

---

## 9. What Stays the Same in FreeTube Upstream

The architecture is designed so that FreeTube's existing code requires **no changes** for features the web build already supports. The only files that need to be touched are:

- `src/renderer/helpers/api/local.js` — add `fetch('/api/po-token')` in the non-Electron branch
- `src/renderer/helpers/api/PlayerCache.js` — replace `window.ftElectron` with Cache API
- `src/renderer/store/modules/settings.js` — add `BroadcastChannel` sync in the non-Electron path

Everything else — all views, store modules, router, helpers, the entire `src/datastores/` layer — is untouched.
