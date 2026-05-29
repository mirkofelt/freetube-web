# FreeTube Codebase Audit: Electron-Specific vs. Portable Code

> Baseline document for the web-migration effort.  
> Audited against the source tree at `/root/freetube-web/src`.

---

## 1. High-level Architecture

FreeTube is built with **Electron + Vue 3 + Vuex + Webpack**.  
The codebase already ships two distinct build targets:

| Target | Webpack config | `IS_ELECTRON` | `SUPPORTS_LOCAL_API` | DB handler alias |
|--------|---------------|---------------|----------------------|-----------------|
| Electron renderer | `webpack.renderer.config.js` | `true` | `true` | `datastores/handlers/electron.js` |
| Web (standalone browser) | `webpack.web.config.js` | `false` | `false` | `datastores/handlers/web.js` |

The web build already exists — this audit documents what still ties the renderer to Electron and what is already portable.

---

## 2. Electron-Only Modules (main process / Node.js)

These files run **only in the Electron main process** and have zero equivalent in a pure-web context.

### 2.1 `src/main/index.js` — Electron main process entry point
- Imports from `electron`: `app`, `BrowserWindow`, `dialog`, `Menu`, `ipcMain`, `powerSaveBlocker`, `screen`, `session`, `shell`, `nativeTheme`, `net`, `protocol`, `clipboard`, `Tray`
- Node.js APIs: `fs`, `fs/promises`, `path`, `child_process`, `util`, `zlib`
- Registers all `ipcMain.handle` / `ipcMain.on` handlers (DB, proxy, screenshot folder, navigation history, power-save blocker, external player, relaunch, PoToken generation)
- Manages window lifecycle, system tray, native app menu, protocol handlers (`app://`, `imagecache://`, `freetube://`)
- Handles session management: cookies, user-agent spoofing, request header injection for YouTube/Invidious

**Migration status: fully Electron-specific — no web equivalent possible or needed.**

### 2.2 `src/main/externalPlayer.js` — External player launcher
- Uses `node:child_process.spawn` to launch VLC / MPV / etc.
- Uses `node:fs/promises.readFile` to read `external-player-map.json` at runtime
- Called via `ipcMain.on(IpcChannels.OPEN_IN_EXTERNAL_PLAYER, ...)`

**Migration status: Electron-only feature. Web build already omits it (no `spawn` available).**

### 2.3 `src/main/poTokenGenerator.js` — PoToken (BotGuard) generator
- Creates a hidden `WebContentsView` (Electron API) with a sandboxed session
- Uses `electron.session`, `electron.WebContentsView`, DevTools debugger protocol
- Uses `fs/promises.readFile` for `botGuardScript.js`

**Migration status: Electron-only. The web build needs a different PoToken strategy (e.g., WASM or server-side).**

### 2.4 `src/main/ImageCache.js` — In-memory image cache
- Pure JS/TS logic (no Electron API directly), but wired up in `main/index.js` via `protocol.handle('imagecache', ...)` and `session.defaultSession.webRequest.onBeforeRequest`
- Only relevant when the `replace-http-cache` experiment flag is enabled

**Migration status: Electron-specific (tied to Electron's protocol/session APIs), but the cache logic itself (`ImageCache` class) could be ported.**

### 2.5 `src/main/utils.js` — URL origin check utility
- Single function `isFreeTubeUrl(url)` that checks whether a URL is the `app://bundle/` (production) or `http://localhost:9080` (dev) origin
- Used exclusively in `main/index.js` as a security check on IPC events

**Migration status: Electron-only concern.**

---

## 3. Electron Preload Layer

### 3.1 `src/preload/main.js`
- Calls `contextBridge.exposeInMainWorld('ftElectron', api)` to inject the API surface into the renderer

**Migration status: Electron-only.**

### 3.2 `src/preload/interface.js` — IPC bridge API
- Imports `ipcRenderer`, `webFrame` from `electron/renderer`
- Exposes every IPC call the renderer needs as functions under `window.ftElectron.*`
- Full list of exposed APIs:
  - `getSystemLocale`, `openInNewWindow`, `enableProxy`, `disableProxy`
  - `setInvidiousAuthorization`, `clearInvidiousAuthorization`
  - `startPowerSaveBlocker`, `stopPowerSaveBlocker`
  - `getReplaceHttpCache`, `toggleReplaceHttpCache`
  - `requestPiP`, `requestFullscreen` (via `webFrame.executeJavaScript`)
  - `playerCacheGet`, `playerCacheSet`
  - `generatePoToken`
  - `chooseDefaultFolder`, `writeToDefaultFolder`
  - `relaunch`
  - `openInExternalPlayer`, `handleOpenInExternalPlayerResult`
  - `setZoomFactor`
  - `getNavigationHistory`
  - `dbSettings`, `dbHistory`, `dbProfiles`, `dbPlaylists`, `dbSearchHistory`, `dbSubscriptionCache`
  - `handleChangeView`, `handleOpenUrl`, `handleUpdateSearchInputText`
  - `handleSyncSettings`, `handleSyncHistory`, `handleSyncSearchHistory`, `handleSyncProfiles`, `handleSyncPlaylists`, `handleSyncSubscriptionCache`

**Migration status: Electron-only. The web build never loads this file.**

---

## 4. Datastore Layer

### 4.1 `src/datastores/index.js` — NeDB datastore factory
- On `IS_ELECTRON_MAIN=true`: uses `electron.app.getPath('userData')` + Node.js `fs.statSync` / `fs.realpathSync` for platform-native DB paths
- On browser: uses in-memory / `localForage`-backed NeDB (via `@seald-io/nedb`)
- The `autoload` flag differs: `false` for Electron main (loaded manually), `true` for web

**Migration status: conditionally branched — the browser path is already functional.**

### 4.2 `src/datastores/handlers/base.js` — DB handler implementations
- Pure JS, uses only the NeDB API from `src/datastores/index.js`
- Contains migrations (one-time schema changes) in `Settings.find()`
- Contains methods prefixed with `_` (`_findOne`, `_findAppReadyRelatedSettings`, `_findSidenavSettings`, `_updateBounds`) that are **Electron main process-only** — they are called directly in `main/index.js` and not exposed to the renderer
- `loadDatastores()` and `compactAllDatastores()` are also Electron main process-only

**Migration status: mostly portable. The `_`-prefixed methods and `loadDatastores`/`compactAllDatastores` are Electron main-only; the rest is portable NeDB logic.**

### 4.3 `src/datastores/handlers/electron.js` — Electron renderer DB handler
- Routes all DB calls through `window.ftElectron.db*()` IPC bridge
- Used by the Electron renderer build (alias: `DB_HANDLERS_ELECTRON_RENDERER_OR_WEB`)

**Migration status: Electron renderer-specific.**

### 4.4 `src/datastores/handlers/web.js` — Web DB handler
- Calls `baseHandlers.*` directly (bypasses IPC, hits NeDB in-browser)
- Already complete and functional for all collections

**Migration status: fully portable, already deployed in the web build.**

### 4.5 `src/datastores/handlers/index.js` — Build-time alias resolution
- Exports from `DB_HANDLERS_ELECTRON_RENDERER_OR_WEB` — resolved at build time to either `electron.js` (Electron renderer) or `web.js` (web build)

**Migration status: infrastructure only, no logic.**

---

## 5. Renderer Code — Portable Vue/JS Frontend

The vast majority of `src/renderer/` is portable. The following have **zero Electron dependency**:

### 5.1 Views (all `src/renderer/views/`)
All views are portable Vue SFCs except for conditional feature flags:
- `Settings/Settings.vue`: uses `process.env.IS_ELECTRON` to show/hide Electron-only setting panels (ExternalPlayer, ExperimentalSettings)
- All other views are fully portable

### 5.2 Components
Most components are fully portable. Electron-specific conditional logic lives in:

| File | What's Electron-specific |
|------|--------------------------|
| `ft-list-video/ft-list-video.js` | `openInExternalPlayer` call guarded by `IS_ELECTRON` |
| `ft-shaka-video-player/ft-shaka-video-player.js` | `startPowerSaveBlocker`, `stopPowerSaveBlocker`, `requestPiP`, `requestFullscreen`, `writeToDefaultFolder` — all guarded by `IS_ELECTRON` |
| `WatchVideoInfo/WatchVideoInfo.vue` | `openInExternalPlayer` guarded by `IS_ELECTRON` |
| `FtListPlaylist/FtListPlaylist.vue` | `openInExternalPlayer` guarded by `IS_ELECTRON` |
| `TopNav/TopNav.vue` | `getNavigationHistory`, `handleUpdateSearchInputText` guarded by `IS_ELECTRON` |
| `ProxySettings/ProxySettings.vue` | `enableProxy` / `disableProxy` guarded by `IS_ELECTRON` |
| `ThemeSettings.vue` | `relaunch` guarded by `IS_ELECTRON` |
| `PlayerSettings/PlayerSettings.vue` | Screenshot "Save to Folder" mode and `chooseDefaultFolder` guarded by `IS_ELECTRON` |
| `ExperimentalSettings/ExperimentalSettings.vue` | `getReplaceHttpCache`, `toggleReplaceHttpCache` guarded by `IS_ELECTRON` |
| `GeneralSettings/GeneralSettings.vue` | Feature visibility guard (`USING_ELECTRON`) |

All other components (`FtInput`, `FtButton`, `FtLoader`, `FtPrompt`, `FtToast`, `FtSelect`, `FtToggleSwitch`, `FtSlider`, `FtRadioButton`, `FtProgressBar`, `FtCard`, `FtFlexBox`, `FtListChannel`, `FtListHashtag`, `FtListPlaylist`, `FtProfileBubble`, etc.) are **100% portable**.

### 5.3 Vuex Store Modules

| Module | Portability |
|--------|-------------|
| `store/modules/utils.js` | Fully portable |
| `store/modules/history.js` | Fully portable (uses `DBHistoryHandlers`) |
| `store/modules/playlists.js` | Fully portable |
| `store/modules/profiles.js` | Fully portable |
| `store/modules/search-history.js` | Fully portable |
| `store/modules/subscription-cache.js` | Fully portable |
| `store/modules/invidious.js` | Portable, but `setInvidiousAuthorization` / `clearInvidiousAuthorization` guarded by `IS_ELECTRON` |
| `store/modules/player.js` | Fully portable |
| `store/modules/settings.js` | Mostly portable; `triggerUiScaleSideEffects` calls `window.ftElectron.setZoomFactor` guarded by `IS_ELECTRON`; `setupListenersToSyncWindows` is Electron-only (all sync listeners via `window.ftElectron.handle*`) |

### 5.4 Helpers

| File | Portability |
|------|-------------|
| `helpers/utils.js` | Mostly portable; `openInNewWindow`, `getSystemLocale`, and file I/O helpers have `IS_ELECTRON` branches |
| `helpers/channels.js` | Fully portable |
| `helpers/playlists.js` | Fully portable |
| `helpers/subscriptions.js` | Fully portable |
| `helpers/strings.js` | Fully portable |
| `helpers/colors.js` | Fully portable |
| `helpers/dragAndDrop.js` | Fully portable |
| `helpers/sponsorblock.js` | Fully portable |
| `helpers/api/invidious.js` | Fully portable |
| `helpers/api/local.js` | Has `IS_ELECTRON` branches for `crypto.randomUUID` polyfill and `window.ftElectron.generatePoToken`; otherwise portable |
| `helpers/api/PlayerCache.js` | **Electron-only** — calls `window.ftElectron.playerCacheGet/Set` unconditionally (no web fallback) |
| `helpers/player/*.js` | Fully portable (binary parsers, manifest parsers) |

### 5.5 Other Renderer Files

| File | Portability |
|------|-------------|
| `renderer/main.js` | Mostly portable; `IS_ELECTRON` block wires up `handleChangeView` and `handleOpenInExternalPlayerResult` |
| `renderer/App.vue` | Mostly portable; `IS_ELECTRON` block in `onMounted` enables multi-window sync and external link handling |
| `renderer/i18n/index.js` | Has one `IS_ELECTRON` branch for production locale loading path |
| `renderer/directives/vSaferHtml.js` | `IS_ELECTRON` used to decide whether to use native Sanitizer API |
| `renderer/router/index.js` | Fully portable |
| `renderer/composables/*` | Fully portable |
| `renderer/sigFrameScript.js` | Fully portable (injected into sig iframe) |
| `renderer/botGuardScript.js` | Fully portable (runs in headless WebContentsView in Electron, but is pure JS) |

---

## 6. Build Infrastructure

| File | Purpose |
|------|---------|
| `_scripts/webpack.main.config.js` | Compiles Electron main process (`src/main/index.js`) |
| `_scripts/webpack.preload.config.js` | Compiles Electron preload (`src/preload/main.js`) |
| `_scripts/webpack.renderer.config.js` | Compiles Electron renderer (Vue app with Electron-specific aliases) |
| `_scripts/webpack.web.config.js` | Compiles standalone web build (Vue app with web aliases, `IS_ELECTRON=false`) |
| `_scripts/webpack.botGuardScript.config.js` | Compiles the BotGuard/PoToken script separately |

Key build-time feature flags set via `webpack.DefinePlugin`:

| Flag | Electron renderer | Web build |
|------|------------------|-----------|
| `process.env.IS_ELECTRON` | `true` | `false` |
| `process.env.IS_ELECTRON_MAIN` | `false` | `false` |
| `process.env.SUPPORTS_LOCAL_API` | `true` | `false` |
| `DB_HANDLERS_ELECTRON_RENDERER_OR_WEB` alias | `handlers/electron.js` | `handlers/web.js` |

---

## 7. Summary: Migration Complexity Map

### Fully Electron-Specific (no web equivalent)
- `src/main/index.js` — Electron main process
- `src/main/externalPlayer.js` — Node.js child_process
- `src/main/poTokenGenerator.js` — Electron session + WebContentsView
- `src/main/ImageCache.js` — tied to Electron protocol/session
- `src/main/utils.js` — Electron URL security guard
- `src/preload/main.js` — contextBridge
- `src/preload/interface.js` — ipcRenderer bridge
- `src/datastores/handlers/electron.js` — IPC-routed DB calls

### Already Portable (used by both builds)
- All of `src/renderer/views/` (with minor conditional rendering)
- Most of `src/renderer/components/` (feature flags are properly guarded)
- All of `src/renderer/store/modules/` (with `IS_ELECTRON`-guarded side effects)
- `src/renderer/helpers/` (except `PlayerCache.js`)
- `src/renderer/router/`, `composables/`, `directives/`
- `src/datastores/handlers/base.js` (the business logic layer)
- `src/datastores/handlers/web.js` (already the web DB handler)
- `src/constants.js`

### Needs Web Replacement / Adaptation
| Component | Issue | Web alternative |
|-----------|-------|-----------------|
| `helpers/api/PlayerCache.js` | Calls `window.ftElectron.playerCacheGet/Set` unconditionally | Use `localStorage` or `Cache API` |
| `helpers/api/local.js` — PoToken | `window.ftElectron.generatePoToken` | Server-side token or WASM BotGuard |
| `store/modules/settings.js` — sync | `handleSyncSettings/History/...` via Electron IPC | BroadcastChannel or SharedWorker |
| `helpers/utils.js` — `openInNewWindow` | `window.ftElectron.openInNewWindow` | `window.open()` |
| `helpers/utils.js` — `getSystemLocale` | `window.ftElectron.getSystemLocale()` | `navigator.language` |
| `helpers/utils.js` — file save | `IS_ELECTRON || showSaveFilePicker` | Already has web fallback via File System Access API |
| Proxy settings | `enableProxy`/`disableProxy` via IPC | Not applicable in browser; hide UI |
| `ThemeSettings.vue` — relaunch | `window.ftElectron.relaunch()` | `window.location.reload()` |
| Navigation history | `window.ftElectron.getNavigationHistory()` | `window.navigation` API (already has `|| 'navigation' in window` branch) |
| Screenshot to folder | `writeToDefaultFolder` | Already has `showSaveFilePicker` fallback |
