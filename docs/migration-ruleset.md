# FreeTube — Electron → Web Migration Ruleset

> Reusable pattern mapping. For every Electron API or pattern found in the codebase, this document gives the exact web-native replacement and the implementation recipe.  
> Read together with `electron-vs-web-audit.md` (what exists) and `webapp-architecture.md` (the target shape).

---

## How to Use This Document

Each rule follows the same structure:

```
### Pattern Name
Electron code          → What to replace it with
Location in codebase   → Where the pattern appears
Web replacement        → Drop-in code or approach
Status                 → already done / needs implementation / not applicable
```

Rules are grouped by the Electron subsystem they belong to.

---

## 1. IPC — Inter-Process Communication

### 1.1 `ipcRenderer.invoke()` → `fetch()`

**When you see it:**
```js
// Electron (preload/interface.js)
return ipcRenderer.invoke(IpcChannels.GENERATE_PO_TOKEN, videoId, context)
```

**Replace with:**
```js
// Web
const resp = await fetch('/api/po-token', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ videoId, context })
})
if (!resp.ok) throw new Error(`PoToken request failed: ${resp.status}`)
return (await resp.json()).poToken
```

**Rule:** Every `ipcRenderer.invoke()` call is a request/response — map it directly to an HTTP `fetch()` against the Express backend. Use `POST` for writes and actions, `GET` for reads. Wrap in a try/catch matching the error shapes defined in `webapp-architecture.md`.

**Appears in:** `src/preload/interface.js` (all `dbSettings`, `dbHistory`, `dbProfiles`, `dbPlaylists`, `dbSearchHistory`, `dbSubscriptionCache`, `generatePoToken`, `playerCacheGet/Set`, `getReplaceHttpCache`, `getNavigationHistory`, `getSystemLocale`, `writeToDefaultFolder`)

**Status:** `generatePoToken` → needs `POST /api/po-token`. DB calls → not needed (web handler goes directly to NeDB). Others → see specific rules below.

---

### 1.2 `ipcRenderer.send()` (fire-and-forget) → direct call or no-op

**When you see it:**
```js
ipcRenderer.send(IpcChannels.ENABLE_PROXY, url)
ipcRenderer.send(IpcChannels.START_POWER_SAVE_BLOCKER)
ipcRenderer.send(IpcChannels.RELAUNCH_REQUEST)
```

**Rule:** Fire-and-forget IPC calls have no network equivalent. Each maps to a native browser API or is simply removed:

| IPC Channel | Web replacement |
|-------------|-----------------|
| `ENABLE_PROXY` / `DISABLE_PROXY` | **Remove** — browsers cannot set proxy programmatically. Hide the UI elements. |
| `START_POWER_SAVE_BLOCKER` | `await navigator.wakeLock.request('screen')` (see Rule 5.1) |
| `STOP_POWER_SAVE_BLOCKER` | `wakeLockSentinel.release()` |
| `RELAUNCH_REQUEST` | `window.location.reload()` |
| `CREATE_NEW_WINDOW` | `window.open(url, '_blank', 'noopener')` |
| `SET_WINDOW_TITLE` | `document.title = title` (already done by Vue router) |
| `APP_READY` | **Remove** — no equivalent needed; `main.js` `mounted()` lifecycle covers this |
| `SEARCH_INPUT_HANDLING_READY` | **Remove** — TopNav sets up its own listener via `router.afterEach` |
| `CHOOSE_DEFAULT_FOLDER` | `await window.showDirectoryPicker()` (see Rule 3.3) |
| `OPEN_IN_EXTERNAL_PLAYER` | **Remove** — not applicable in browser; hide the UI element |
| `SET_INVIDIOUS_AUTHORIZATION` | Set the `Authorization` header directly in the `fetch()` call that makes the Invidious request |
| `TOGGLE_REPLACE_HTTP_CACHE` | **Remove** — Electron experiment, not applicable |

---

### 1.3 `ipcRenderer.on()` (push listeners) → `BroadcastChannel` or native event

**When you see it:**
```js
// Electron — main pushes to all renderer windows
ipcRenderer.on(IpcChannels.SYNC_SETTINGS, (_, { event, data }) => handler(event, data))
ipcRenderer.on(IpcChannels.NATIVE_THEME_UPDATE, (_, shouldUseDarkColors) => ...)
ipcRenderer.on(IpcChannels.CHANGE_VIEW, (_, route) => router.push(route))
ipcRenderer.on(IpcChannels.OPEN_URL, (_, url) => handler(url))
```

**Replace with:**

| Push channel | Web replacement |
|---|---|
| `SYNC_SETTINGS`, `SYNC_HISTORY`, `SYNC_SEARCH_HISTORY`, `SYNC_PROFILES`, `SYNC_PLAYLISTS`, `SYNC_SUBSCRIPTION_CACHE` | `BroadcastChannel` (see Rule 6.1) |
| `NATIVE_THEME_UPDATE` | `window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', ...)` — already used in `App.vue` |
| `CHANGE_VIEW` | **Remove** — only needed for the native menu; web has no native menu |
| `OPEN_URL` | **Remove** — `freetube://` deep links don't exist in the web build |
| `UPDATE_SEARCH_INPUT_TEXT` | **Remove** — triggered from right-click context menu search, not applicable in web |

---

### 1.4 `window.ftElectron.*` call-site guard pattern

**When you see it:**
```js
if (process.env.IS_ELECTRON) {
  window.ftElectron.someMethod(...)
} else {
  // web path
}
```

**Rule:** `IS_ELECTRON` is a **build-time constant** set by `webpack.DefinePlugin`. The web build gets `IS_ELECTRON = false`, so the Electron branch is dead-code-eliminated by Terser. When adding a web implementation, add the `else` branch — do not touch the Electron branch.

**For files that call `window.ftElectron` without an `IS_ELECTRON` guard** (currently only `src/renderer/helpers/api/PlayerCache.js`): wrap the Electron call in the guard and add the web branch. Never leave an unguarded `window.ftElectron` call — it will throw a `TypeError` in the web build.

---

## 2. Electron Main Process APIs

### 2.1 `shell.openExternal(url)` → `window.open(url, '_blank', 'noreferrer')`

**When you see it:**
```js
// src/main/index.js
shell.openExternal(details.url)
```

**Web replacement:**
```js
window.open(url, '_blank', 'noreferrer')
```

**Status:** Already handled. `openExternalLink()` in `src/renderer/helpers/utils.js:236` already uses `window.open()` directly — the web build never reaches the Electron path in `main/index.js`.

---

### 2.2 `clipboard.writeText(text)` / `clipboard.write({...})` → `navigator.clipboard`

**When you see it:**
```js
// src/main/index.js (context menu copy handler)
clipboard.writeText(url)
clipboard.write({ bookmark: text, text: url })
```

**Web replacement:**
```js
await navigator.clipboard.writeText(text)
// For rich clipboard (bookmark+text), only writeText is needed for the web build
```

**Status:** Already handled. `copyToClipboard()` in `src/renderer/helpers/utils.js:198` uses `navigator.clipboard` directly. The Electron clipboard module is only used in `main/index.js` for the native context menu — not needed in the web build.

---

### 2.3 `app.getSystemLocale()` → `navigator.language`

**When you see it:**
```js
// src/main/index.js
return app.getSystemLocale()
```

**Web replacement:**
```js
navigator.language  // e.g. "en-US"
// or for full preference list:
navigator.languages  // e.g. ["en-US", "en", "de"]
```

**Status:** Already handled. `getSystemLocale()` in `src/renderer/helpers/utils.js:542` already falls back to `navigator.language` when `IS_ELECTRON` is false.

---

### 2.4 `nativeTheme.shouldUseDarkColors` → `window.matchMedia('(prefers-color-scheme: dark)')`

**When you see it:**
```js
// src/main/index.js
nativeTheme.shouldUseDarkColors
nativeTheme.on('updated', () => { ... })
```

**Web replacement:**
```js
const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
  document.body.dataset.systemTheme = e.matches ? 'dark' : 'light'
})
```

**Status:** Already handled. `App.vue:242` and the preload `NATIVE_THEME_UPDATE` listener already do this for the web build.

---

### 2.5 `app.relaunch()` → `window.location.reload()`

**When you see it:**
```js
// src/main/index.js
app.relaunch({ args: process.argv.slice(1) })
app.quit()
```

**Web replacement:**
```js
window.location.reload()
```

**Status:** Needs implementation. `ThemeSettings.vue:321` calls `window.ftElectron.relaunch()` inside an `IS_ELECTRON` block but has no `else`. Add:
```js
} else {
  window.location.reload()
}
```

Note: The relaunch in FreeTube is triggered when the "Replace HTTP Cache" experiment is toggled — that experiment is Electron-only, so the button is hidden in the web build. The relaunch from theme settings (if any) should fall back to `reload()`.

---

### 2.6 `BrowserWindow.getAllWindows()` / multi-window management

**When you see it:**
```js
// src/main/index.js
BrowserWindow.getAllWindows().forEach(window => window.webContents.send(...))
```

**Web replacement:** Multi-window coordination moves to `BroadcastChannel` on the client side (see Rule 6.1). The backend doesn't manage windows.

**Status:** Not applicable — the web build is a SPA. Multiple browser tabs are independent and sync via `BroadcastChannel`.

---

### 2.7 `dialog.showOpenDialog()` → `window.showDirectoryPicker()`

**When you see it:**
```js
// src/main/index.js
const result = await dialog.showOpenDialog(window, { properties: ['openDirectory'] })
```

**Web replacement:**
```js
// For selecting a directory (e.g., screenshot folder)
const dirHandle = await window.showDirectoryPicker({ mode: 'readwrite' })
// dirHandle.name gives the directory name; you cannot get a full OS path
```

**Caveat:** `showDirectoryPicker()` returns a `FileSystemDirectoryHandle`, not a file path string. The FreeTube "screenshotFolderPath" setting stores a path — this concept doesn't exist in the web. Replace with storing the `FileSystemDirectoryHandle` in IndexedDB (it's serializable and persistent across page reloads in Chrome).

**Status:** Already partially handled. `ft-shaka-video-player.js:1741` checks `IS_ELECTRON` and falls back to `showSaveFilePicker()` for screenshots. The "choose default folder" UI in `PlayerSettings.vue:641` is guarded by `IS_ELECTRON` and hidden in the web build.

---

### 2.8 `fs.readFile()` / `fs.writeFile()` (main process) → no direct web equivalent needed

**When you see it:**
```js
// src/main/index.js, src/main/externalPlayer.js, src/main/poTokenGenerator.js
await asyncFs.readFile(filePath)
await asyncFs.writeFile(filePath, data)
```

**Rule:** These calls are in the **Electron main process only** and are not part of the renderer's IPC surface — the renderer never calls `fs` directly. In the web:
- Config/data files → NeDB + localForage (IndexedDB) — already in place
- Static assets (`external-player-map.json`, `botGuardScript.js`) → served as static HTTP files by Express, fetched with `fetch()`
- Screenshot files → File System Access API (already has fallback in `ft-shaka-video-player.js`)

**Status:** No renderer changes needed. The main-process file system work is encapsulated behind IPC and the web handler bypasses it entirely.

---

### 2.9 `child_process.spawn()` → not applicable

**When you see it:**
```js
// src/main/externalPlayer.js
const child = spawn(executable, args, { detached: true, stdio: 'ignore' })
```

**Web replacement:** None — the browser cannot launch external processes. The external player feature must be **hidden entirely** in the web build.

**Rule:** Any UI element related to "Open in external player" must be wrapped with `v-if="IS_ELECTRON"` or the equivalent `process.env.IS_ELECTRON` compile-time check. The relevant settings panel (`ExternalPlayerSettings.vue`) is already excluded via `Settings.vue:113`.

---

### 2.10 `powerSaveBlocker.start('prevent-display-sleep')` → `navigator.wakeLock`

**When you see it (via IPC):**
```js
// src/main/index.js
powerSaveBlocker.start('prevent-display-sleep')
powerSaveBlocker.stop(id)
```

**Web replacement:**
```js
// In ft-shaka-video-player.js — replace the IS_ELECTRON branch:
let wakeLockSentinel = null

async function startPowerSaveBlocker() {
  if (process.env.IS_ELECTRON) {
    window.ftElectron.startPowerSaveBlocker()
  } else if ('wakeLock' in navigator) {
    try {
      wakeLockSentinel = await navigator.wakeLock.request('screen')
    } catch { /* user denied or not supported */ }
  }
}

function stopPowerSaveBlocker() {
  if (process.env.IS_ELECTRON) {
    window.ftElectron.stopPowerSaveBlocker()
  } else {
    wakeLockSentinel?.release()
    wakeLockSentinel = null
  }
}
```

**Note:** Wake Lock is released automatically when the page is hidden. Re-acquire it on `visibilitychange` if the video is still playing.

**Status:** Needs implementation. Currently the `else` branch is a no-op (the function exits without doing anything in the web build).

---

### 2.11 `session.setProxy()` → not applicable

**Web replacement:** None — browsers cannot be programmatically told to use a proxy. The proxy settings UI must be **hidden in the web build** (already done via `IS_ELECTRON` guards in `ProxySettings.vue:291`).

---

### 2.12 `protocol.handle('app', ...)` → Express `express.static()`

**When you see it:**
```js
// src/main/index.js
protocol.handle('app', async (request) => {
  const contents = await asyncFs.readFile(path.join(__dirname, pathname))
  return new Response(contents.buffer, { ... })
})
```

**Web replacement:**
```js
// server/index.js
app.use(express.static(path.join(__dirname, '../dist/web')))
```

**Status:** Covered by the Express server design in `webapp-architecture.md`.

---

### 2.13 `protocol.handle('imagecache', ...)` + `net.request()` → browser HTTP cache

**When you see it:**
```js
// src/main/index.js
protocol.handle('imagecache', (request) => { ... net.request({ url }) ... })
session.defaultSession.webRequest.onBeforeRequest(imageRequestFilter, (details, callback) => {
  callback({ redirectURL: `imagecache://${...}` })
})
```

**Web replacement:** The browser's built-in HTTP cache already handles image caching. The `imagecache://` protocol redirect is an Electron experiment (controlled by `REPLACE_HTTP_CACHE_PATH`). In the web build, images load via normal `<img src="...">` URLs and the browser caches them.

**Status:** Not applicable — this is Electron-only. The feature flag UI is already hidden in the web build (`ExperimentalSettings.vue` is Electron-only).

---

### 2.14 `webFrame.setZoomFactor(factor)` → CSS `zoom` or `transform: scale()`

**When you see it:**
```js
// src/preload/interface.js
webFrame.setZoomFactor(factor)
// called from settings.js sideEffectHandler for 'uiScale'
```

**Web replacement:**
```js
// Option A: CSS zoom (Chrome/Edge only, non-standard but widely supported)
document.documentElement.style.zoom = `${factor}`

// Option B: CSS transform (standard, works everywhere but has layout side effects)
document.documentElement.style.transform = `scale(${factor})`
document.documentElement.style.transformOrigin = 'top left'
```

Apply in the `uiScale` side-effect handler in `settings.js:394`:
```js
uiScale: (_, value) => {
  if (process.env.IS_ELECTRON) {
    window.ftElectron.setZoomFactor(value / 100)
  } else {
    document.documentElement.style.zoom = `${value / 100}`
  }
},
```

**Status:** Needs implementation. Currently the `else` branch is absent — the setting saves to DB but has no visual effect in the web build.

---

### 2.15 `webFrame.executeJavaScript(...)` → direct function call

**When you see it:**
```js
// src/preload/interface.js
webFrame.executeJavaScript(
  'document.querySelector("video.player")?.ui.getControls().togglePiP()', true
)
webFrame.executeJavaScript(
  'document.querySelector("video.player")?.ui.getControls().toggleFullScreen()', true
)
```

**Why this exists:** Electron's preload runs in a separate context, so `webFrame.executeJavaScript()` is needed to call into the main world. In the web build there is no context boundary.

**Web replacement:** The renderer can call the Shaka player controls directly:
```js
// Called from the context where the player is accessible
document.querySelector('video.player')?.ui?.getControls()?.togglePiP()
document.querySelector('video.player')?.ui?.getControls()?.toggleFullScreen()
```

**Status:** These methods (`requestPiP`, `requestFullscreen`) are currently only called from `ft-shaka-video-player.js:1189` and `ft-shaka-video-player.js:2979` under `IS_ELECTRON` guards. The web build has its own PiP/fullscreen triggers via the Shaka UI — no replacement is needed unless the guard logic is changed.

---

## 3. File System Access

### 3.1 Reading files — `showOpenFilePicker()` with `<input type="file">` fallback

**Pattern (already implemented in FreeTube):**
```js
// src/renderer/helpers/utils.js readFileWithPicker()
if (process.env.IS_ELECTRON || 'showOpenFilePicker' in window) {
  const [handle] = await window.showOpenFilePicker({ ... })
  file = await handle.getFile()
} else {
  // Fallback: hidden <input type="file">
  const fileInput = document.createElement('input')
  fileInput.type = 'file'
  fileInput.click()
  file = await new Promise(resolve => { fileInput.onchange = () => resolve(fileInput.files[0]) })
}
```

**Status:** Already complete. `DataSettings.vue` uses `readFileWithPicker()` throughout — no changes needed.

---

### 3.2 Writing files — `showSaveFilePicker()` with `<a download>` fallback

**Pattern (already implemented):**
```js
// src/renderer/helpers/utils.js writeFileWithPicker()
if (process.env.IS_ELECTRON || 'showSaveFilePicker' in window) {
  const handle = await window.showSaveFilePicker({ suggestedName: fileName, ... })
  const writable = await handle.createWritable()
  await writable.write(content)
  await writable.close()
} else {
  const url = URL.createObjectURL(new Blob([content], { type: mimeType }))
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
```

**Status:** Already complete for data export. Screenshots use a similar path in `ft-shaka-video-player.js:1741`.

---

### 3.3 Writing screenshots to a persistent folder — `FileSystemDirectoryHandle`

**When you see it:**
```js
// src/preload/interface.js
window.ftElectron.writeToDefaultFolder(filename, arrayBuffer)
// calls ipcMain WRITE_TO_DEFAULT_FOLDER → asyncFs.writeFile(filePath, ...)
```

**Web replacement:**
```js
// Store the handle in IndexedDB on first use (showDirectoryPicker prompts the user)
let cachedDirHandle = await idbGet('screenshotDirHandle')

if (!cachedDirHandle) {
  cachedDirHandle = await window.showDirectoryPicker({ mode: 'readwrite' })
  await idbSet('screenshotDirHandle', cachedDirHandle)
}

// On each save:
const fileHandle = await cachedDirHandle.getFileHandle(filename, { create: true })
const writable = await fileHandle.createWritable()
await writable.write(arrayBuffer)
await writable.close()
```

**Note:** `FileSystemDirectoryHandle` is serializable to IndexedDB in Chrome/Edge. The user is prompted once via `showDirectoryPicker()` and subsequent saves happen silently. Firefox does not support persisting directory handles.

**Status:** The `default_folder` screenshot mode is already hidden in the web build (guarded by `IS_ELECTRON` in `PlayerSettings.vue:607`). If this mode is later exposed for desktop Chrome, implement the above.

---

## 4. Database / Persistence

### 4.1 `ipcRenderer.invoke(IpcChannels.DB_*)` → direct NeDB call

**When you see it (Electron renderer):**
```js
// src/datastores/handlers/electron.js
window.ftElectron.dbSettings(DBActions.GENERAL.FIND)
```

**Web replacement (already in place):**
```js
// src/datastores/handlers/web.js → delegates to base.js → calls NeDB directly
baseHandlers.settings.find()
```

The build alias `DB_HANDLERS_ELECTRON_RENDERER_OR_WEB` switches between `electron.js` and `web.js` at build time — no runtime branching needed.

**Status:** Already complete. The web handler is fully implemented.

---

### 4.2 `app.getPath('userData')` → localForage / IndexedDB

**When you see it:**
```js
// src/datastores/index.js
const { app } = require('electron')
const userDataPath = app.getPath('userData')
dbPath = (dbName) => join(userDataPath, `${dbName}.db`)
```

**Web replacement:**
```js
// src/datastores/index.js (IS_ELECTRON_MAIN === false branch)
dbPath = (dbName) => `${dbName}.db`
// NeDB uses localForage as its storage backend in the browser, so the "path"
// is just a key name in IndexedDB — no actual filesystem path needed
```

**Status:** Already in place — `src/datastores/index.js:22` handles the web case.

---

## 5. Hardware / OS APIs

### 5.1 `powerSaveBlocker` → `navigator.wakeLock` (see Rule 2.10)

Already covered above.

---

### 5.2 `screen.getAllDisplays()` → `window.screen` / CSS media queries

**When you see it:**
```js
// src/main/index.js
const windowVisible = screen.getAllDisplays().some(display => { ... })
```

**Context:** Used to validate that saved window bounds are on a visible display before restoring them. In the web build, window size/position is managed by the browser — this is not needed.

**Status:** Not applicable — window bounds persistence is an Electron feature.

---

## 6. Multi-Window / Multi-Tab Sync

### 6.1 `ipcMain` → `ipcRenderer` push sync → `BroadcastChannel`

**When you see it:**
```js
// src/main/index.js (main pushes to all OTHER windows)
function syncOtherWindows(channel, event, payload) {
  BrowserWindow.getAllWindows()
    .filter(w => w.webContents.id !== event.sender.id)
    .forEach(w => w.webContents.send(channel, payload))
}

// src/renderer/store/modules/settings.js (renderer receives)
window.ftElectron.handleSyncSettings((event, data) => { ... })
```

**Web replacement:**
```js
// Broadcaster: after any DB mutation that currently calls syncOtherWindows,
// send a BroadcastChannel message:
const bc = new BroadcastChannel('freetube-sync')

function broadcastSync(channel, payload) {
  bc.postMessage({ channel, payload })
}

// Receiver (in setupListenersToSyncWindows, web branch):
bc.onmessage = ({ data: { channel, payload } }) => {
  const { event, data } = payload
  switch (channel) {
    case 'sync-settings':  /* apply mutations */ break
    case 'sync-history':   /* apply mutations */ break
    // ...
  }
}
```

**Note:** `BroadcastChannel` only works within the same origin and browser profile. Tabs opened in different profiles won't sync — this is acceptable for a self-hosted web app.

**Status:** Needs implementation. The `setupListenersToSyncWindows` action in `settings.js:456` is already gated behind `IS_ELECTRON`. Add the `else` branch with `BroadcastChannel`.

---

### 6.2 New-window navigation → `window.open()` or `router.push()`

**When you see it:**
```js
// src/renderer/helpers/utils.js
if (process.env.IS_ELECTRON && doCreateNewWindow) {
  window.ftElectron.openInNewWindow(path, query, searchQueryText)
} else {
  router.push({ path, query })
}
```

**Status:** Already handled. The `else` branch uses `router.push()`. For a "truly new window" on the web, `window.open(url, '_blank')` can be used if needed, but most FreeTube "new window" actions are satisfied by same-tab navigation.

---

## 7. Build-Time Feature Flags

### 7.1 `process.env.IS_ELECTRON` — compile-time boolean

**Rule:** Never use `IS_ELECTRON` at runtime (e.g. by reading `process.env`). It is replaced by Webpack's `DefinePlugin` at build time and produces no runtime overhead. The pattern is:

```js
// Correct — Terser removes the dead branch at build time
if (process.env.IS_ELECTRON) {
  // Electron-only path
} else {
  // Web path
}

// Wrong — do not do this:
const isElectron = process.env.IS_ELECTRON
if (isElectron) { ... }  // Terser may not inline the constant
```

**In Vue templates**, use a computed prop or a module-level constant:
```js
const USING_ELECTRON = process.env.IS_ELECTRON
// v-if="USING_ELECTRON" works because the value is inlined at build time
```

---

### 7.2 `process.env.SUPPORTS_LOCAL_API` — compile-time boolean

**Rule:** `SUPPORTS_LOCAL_API` is `true` in the Electron renderer build and `false` in the web build. It controls whether the local YouTube API (youtubei.js) is available. In the web build, the local API client bundle is excluded entirely via `webpack.web.config.js:33-36`:

```js
externals: {
  'youtubei.js': '{}',
  googlevideo: '{}'
}
```

**Impact:** Any component that gates on `SUPPORTS_LOCAL_API` is already correct. Do not add `SUPPORTS_LOCAL_API = true` to the web build without also bundling youtubei.js — the two must stay in sync.

---

### 7.3 `process.env.IS_ELECTRON_MAIN` — main-process guard

**Rule:** Only used in `src/datastores/index.js` to decide whether to use `app.getPath('userData')`. Never needed in renderer code. Do not reference this flag in any renderer or component file.

---

## 8. Security Patterns

### 8.1 `webSecurity: false` in BrowserWindow → not applicable

**When you see it:**
```js
// src/main/index.js
new BrowserWindow({ webPreferences: { webSecurity: false } })
```

**Why it exists:** Electron disables `webSecurity` to allow cross-origin requests to YouTube/Invidious APIs from the renderer without CORS issues.

**Web replacement:** The Express backend must proxy or forward cross-origin requests that the browser would otherwise block. For FreeTube, the YouTube local API makes requests directly from the browser using `fetch()` — YouTube's CORS policy allows this for most endpoints. If a CORS error is encountered, it must be fixed per-endpoint (e.g., by routing the request through the Express server as a proxy).

**Status:** Not currently an issue — YouTube API requests work from the web build. Invidious requests may need a CORS proxy if the Invidious instance doesn't set appropriate headers.

---

### 8.2 `contextBridge.exposeInMainWorld()` — eliminated in the web build

**When you see it:**
```js
// src/preload/main.js
contextBridge.exposeInMainWorld('ftElectron', api)
```

**Web replacement:** The `window.ftElectron` object simply does not exist in the web build. All `window.ftElectron.*` calls must be guarded by `IS_ELECTRON`. Any call site missing the guard is a bug.

**Enforcement:** Add a lint rule or grep check to CI:
```bash
grep -rn "window\.ftElectron" src/renderer/ | grep -v "IS_ELECTRON"
# Should produce zero results (all calls are guarded)
```

**Status:** `src/renderer/helpers/api/PlayerCache.js` currently fails this check — it calls `window.ftElectron.playerCacheGet/Set` without a guard.

---

## 9. Quick Reference Table

| Electron Pattern | Web Replacement | Status |
|---|---|---|
| `ipcRenderer.invoke()` | `fetch()` (for PoToken), direct NeDB call (for DB) | Needs: PoToken endpoint |
| `ipcRenderer.send()` | Native API or removed | Mostly done |
| `ipcRenderer.on()` push events | `BroadcastChannel` / native events | Needs: BC sync |
| `shell.openExternal(url)` | `window.open(url, '_blank', 'noreferrer')` | ✅ Done |
| `clipboard.writeText()` | `navigator.clipboard.writeText()` | ✅ Done |
| `app.getSystemLocale()` | `navigator.language` | ✅ Done |
| `nativeTheme.shouldUseDarkColors` | `matchMedia('(prefers-color-scheme: dark)')` | ✅ Done |
| `app.relaunch()` | `window.location.reload()` | Needs: else branch |
| `BrowserWindow` multi-window | `BroadcastChannel` / `window.open()` | Partially done |
| `dialog.showOpenDialog()` | `showDirectoryPicker()` | ✅ Hidden in web |
| `fs.readFile()` / `fs.writeFile()` | `showOpenFilePicker()` / `showSaveFilePicker()` / `<a download>` | ✅ Done |
| `child_process.spawn()` | Not applicable — hide UI | ✅ Hidden in web |
| `powerSaveBlocker.start()` | `navigator.wakeLock.request('screen')` | Needs: else branch |
| `session.setProxy()` | Not applicable — hide UI | ✅ Hidden in web |
| `protocol.handle('app', ...)` | `express.static()` | Covered by server design |
| `protocol.handle('imagecache', ...)` | Browser HTTP cache | ✅ Not applicable in web |
| `webFrame.setZoomFactor()` | `document.documentElement.style.zoom` | Needs: else branch |
| `webFrame.executeJavaScript()` | Direct function call | ✅ Not needed in web |
| `contextBridge.exposeInMainWorld()` | Eliminated — `window.ftElectron` doesn't exist | Guard all call sites |
| `PlayerCache` (window.ftElectron) | Cache API / localStorage | Needs: web implementation |
| `process.env.IS_ELECTRON` | Build-time constant | ✅ Pattern established |
| `process.env.SUPPORTS_LOCAL_API` | Build-time constant | ✅ Pattern established |

---

## 10. Items That Need Implementation (Priority Order)

1. **`PlayerCache.js`** — add `IS_ELECTRON` guard + Cache API implementation (blocks PoToken flow in web build)
2. **`POST /api/po-token`** Express endpoint + Playwright-backed `poTokenService.js` (the only mandatory backend work)
3. **`local.js` PoToken call-site** — add `fetch('/api/po-token')` in the `else` branch
4. **`BroadcastChannel` sync** — add `else` branch to `setupListenersToSyncWindows` in `settings.js`
5. **`uiScale` zoom** — add `document.documentElement.style.zoom` in the `else` branch of `settings.js:394`
6. **`navigator.wakeLock`** — add `else` branch to `startPowerSaveBlocker` / `stopPowerSaveBlocker` in `ft-shaka-video-player.js`
7. **`window.location.reload()`** — add `else` branch to `ThemeSettings.vue:321` relaunch call
