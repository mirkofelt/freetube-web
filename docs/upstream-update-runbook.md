# FreeTube Web — Upstream Update Runbook

> How to pull a new FreeTube release into this fork without dragging in Electron-specific changes.  
> Read after `electron-vs-web-audit.md` (what's Electron vs. portable) and `migration-ruleset.md` (how each Electron pattern maps to a web equivalent).

---

## 1. Mental Model

This fork is layered:

```
[upstream FreeTube commit vX.Y.Z]   ← origin of the Vue/JS frontend
        │
        │  our additions:
        │   server/           ← Express backend (ours only)
        │   Dockerfile        ← ours only
        │   docker-compose.yml
        │   WEB.md
        │   docs/             ← ours only
        │
        │  our modifications:
        │   src/renderer/helpers/api/PlayerCache.js   (IS_ELECTRON guard + Cache API)
        │   src/renderer/helpers/api/local.js         (fetch /api/po-token else branch)
        │   pnpm-workspace.yaml                        (fixed @parcel/watcher placeholder)
        ▼
[this fork at HEAD]
```

When upstream ships a new release we want to absorb:
- **Frontend changes** in `src/renderer/`, `src/datastores/handlers/web.js`, `src/botGuardScript.js`, `static/`, `_scripts/webpack.web.config.js`
- **New IPC channels** in `src/constants.js` that might need web equivalents
- **Dependency updates** in `package.json`

We do NOT want to absorb:
- `src/main/`       — Electron main process
- `src/preload/`    — contextBridge + ipcRenderer bridge
- `src/datastores/handlers/electron.js` — IPC-routed DB handler

---

## 2. One-Time Setup

### 2.1 Record the upstream base tag

On initial fork creation, tag the upstream commit this fork diverged from:

```bash
# If you don't already have the upstream remote:
git remote add upstream https://github.com/FreeTubeApp/FreeTube.git
git fetch upstream --tags

# Record the divergence point (the FreeTube release this fork started from)
git tag web-base-v0.24.0 v0.24.0
```

**Convention:** `web-base-vX.Y.Z` always points to the last upstream tag that has been fully absorbed into this fork. Update this tag after every successful merge (section 5 below).

### 2.2 Verify remotes

```bash
git remote -v
# origin   <your fork URL>   (fetch)
# origin   <your fork URL>   (push)
# upstream https://github.com/FreeTubeApp/FreeTube.git (fetch)
# upstream https://github.com/FreeTubeApp/FreeTube.git (push)
```

---

## 3. Fetch the New Release

```bash
# Fetch all new tags and commits from upstream
git fetch upstream --tags

# Identify the new release tag
git tag --list 'v*' | sort -V | tail -5
# e.g. output: v0.24.0  v0.24.1  v0.25.0

export OLD_TAG=v0.24.0    # last absorbed tag (matches your web-base-* tag)
export NEW_TAG=v0.25.0    # incoming release
```

---

## 4. Triage: What Changed?

Run the triage script before touching any files.

```bash
# ── Total change surface ──────────────────────────────────────────
git diff --stat $OLD_TAG..$NEW_TAG

# ── Electron-only paths (informational, DO NOT apply) ────────────
echo "=== Electron main process ===" && \
  git diff --stat $OLD_TAG..$NEW_TAG -- src/main/ src/preload/ \
    src/datastores/handlers/electron.js

# ── Frontend paths (candidates to apply) ─────────────────────────
echo "=== Frontend (apply) ===" && \
  git diff --stat $OLD_TAG..$NEW_TAG -- \
    src/renderer/ \
    src/datastores/handlers/base.js \
    src/datastores/handlers/web.js \
    src/datastores/index.js \
    src/botGuardScript.js \
    src/constants.js \
    static/ \
    _scripts/webpack.web.config.js

# ── Shared / infrastructure paths (review manually) ──────────────
echo "=== Review manually ===" && \
  git diff --stat $OLD_TAG..$NEW_TAG -- \
    package.json \
    pnpm-lock.yaml \
    src/index.ejs
```

---

## 5. File Classification Reference

| Path | Action | Reason |
|------|--------|--------|
| `src/main/` | **Skip entirely** | Electron main process; we replaced this with Express |
| `src/preload/` | **Skip entirely** | contextBridge + ipcRenderer; not loaded in web build |
| `src/datastores/handlers/electron.js` | **Skip entirely** | IPC-routed DB handler; not used in web build |
| `src/renderer/` | **Apply** | Pure Vue/JS frontend; applies cleanly in almost all cases |
| `src/datastores/handlers/base.js` | **Apply** | NeDB business logic; portable |
| `src/datastores/handlers/web.js` | **Apply** | Already the web handler; absorb upstream fixes |
| `src/datastores/index.js` | **Apply** | Branched on IS_ELECTRON_MAIN; web path is safe |
| `src/botGuardScript.js` | **Apply + rebuild** | BotGuard API may update; then re-run `pnpm pack:botGuardScript` |
| `src/constants.js` | **Apply + inspect** | New IPC channels need web equivalents — see §6 |
| `src/index.ejs` | **Apply** | HTML template; already has IS_ELECTRON branches |
| `static/` | **Apply** | Locales, icons, PWA manifest |
| `_scripts/webpack.web.config.js` | **Apply with caution** | Upstream may not maintain this; resolve conflicts keeping our changes |
| `package.json` | **Merge manually** | Add new runtime deps; ignore Electron-only devDeps |
| `pnpm-lock.yaml` | **Regenerate** | After package.json merge, run `pnpm install` |

**Our-only files — never overwrite with upstream content:**

| Path | Why |
|------|-----|
| `server/` | Our Express backend |
| `Dockerfile`, `.dockerignore`, `docker-compose.yml` | Our container setup |
| `WEB.md` | Our deployment docs |
| `docs/` | Our migration docs |
| `src/renderer/helpers/api/PlayerCache.js` | We replaced Electron IPC with Cache API |
| `src/renderer/helpers/api/local.js` | We added the `/api/po-token` else branch |
| `pnpm-workspace.yaml` | We fixed the `@parcel/watcher` placeholder |

---

## 6. Checking for New IPC Channels in `constants.js`

Any new entry in `IpcChannels` in `src/constants.js` represents a new Electron feature that may need a web equivalent:

```bash
# Show only the IpcChannels enum diff
git diff $OLD_TAG..$NEW_TAG -- src/constants.js | grep '^+.*IpcChannels'
```

For each new channel, look it up in `src/main/index.js` (in the upstream diff) to understand what it does, then consult `migration-ruleset.md` to find the web replacement. Possibilities:

| What the channel does | Web response |
|-----------------------|--------------|
| DB read/write | Nothing — web build uses NeDB+localForage directly |
| System info (locale, theme) | `navigator.language`, `matchMedia()` — already handled |
| File I/O | File System Access API — check existing IS_ELECTRON guards |
| PoToken generation | Already on `/api/po-token` — no action needed |
| New privileged action | Add a new Express route in `server/routes/` |
| Electron-only feature (external player, tray) | Not applicable; confirm IS_ELECTRON guard exists in renderer |

---

## 7. Apply Frontend Changes

### 7.1 Generate a filtered patch

```bash
git diff $OLD_TAG..$NEW_TAG \
  -- \
  src/renderer/ \
  src/datastores/handlers/base.js \
  src/datastores/handlers/web.js \
  src/datastores/index.js \
  src/botGuardScript.js \
  src/constants.js \
  src/index.ejs \
  static/ \
  > /tmp/upstream-frontend.patch
```

### 7.2 Inspect files we've modified before applying

These files exist in both upstream and our fork with local changes. Check them separately:

```bash
# Files with our local modifications — diff them individually:
git diff $OLD_TAG..$NEW_TAG -- src/renderer/helpers/api/PlayerCache.js
git diff $OLD_TAG..$NEW_TAG -- src/renderer/helpers/api/local.js
```

- **If upstream changed `PlayerCache.js`:** Compare to our version; we need to keep the `IS_ELECTRON` guard and `caches.open()` implementation. Apply only the parts that don't conflict.
- **If upstream changed `local.js` around the PoToken block (line ~443):** Our `else` branch must survive. Merge manually.

Exclude these from the bulk patch to handle them separately:

```bash
git diff $OLD_TAG..$NEW_TAG \
  -- \
  src/renderer/ \
  src/datastores/handlers/base.js \
  src/datastores/handlers/web.js \
  src/datastores/index.js \
  src/botGuardScript.js \
  src/constants.js \
  src/index.ejs \
  static/ \
  ':(exclude)src/renderer/helpers/api/PlayerCache.js' \
  ':(exclude)src/renderer/helpers/api/local.js' \
  > /tmp/upstream-frontend.patch
```

### 7.3 Apply the patch

```bash
# Dry run first — shows which hunks would conflict
git apply --check /tmp/upstream-frontend.patch

# Apply for real (--3way falls back to merge conflict markers if hunks don't apply cleanly)
git apply --3way /tmp/upstream-frontend.patch
```

If `--3way` produces conflict markers, resolve them with your editor then:

```bash
git add -p     # stage resolved files
```

### 7.4 Apply the manually-reviewed files

After reviewing the PlayerCache.js and local.js diffs:

```bash
# Option A: if upstream's change is unrelated to our additions, apply normally
git diff $OLD_TAG..$NEW_TAG -- src/renderer/helpers/api/local.js | git apply --3way

# Option B: if there are conflicts, cherry-pick the upstream commit and resolve
git cherry-pick <upstream-commit-hash>
# then resolve conflicts keeping our else branch and IS_ELECTRON guard
```

---

## 8. Update `package.json` Dependencies

```bash
# See what changed
git diff $OLD_TAG..$NEW_TAG -- package.json
```

For each changed dependency:

| Dependency type | Action |
|-----------------|--------|
| `dependencies` (runtime, e.g. `vue`, `shaka-player`, `bgutils-js`) | Update version in our `package.json` |
| `devDependencies` — build tools (`webpack`, `babel`, `sass`) | Update version |
| `devDependencies` — Electron (`electron`, `electron-builder`) | Update version; they're devDeps so they exist in lockfile but aren't bundled |
| New `dependencies` added by upstream | Add to our `package.json` if used by renderer or datastores |
| Scripts block | Carry over any new `pack:*` or `get-*` scripts; ignore Electron-only build scripts we don't use |

After editing `package.json`:

```bash
pnpm install           # regenerates pnpm-lock.yaml
pnpm pack:botGuardScript
pnpm pack:web
```

---

## 9. Update `webpack.web.config.js`

```bash
git diff $OLD_TAG..$NEW_TAG -- _scripts/webpack.web.config.js
```

Upstream rarely changes this file (they focus on the Electron renderer config). If they do, review the diff carefully — we may have our own changes here. Merge keeping our alias entries and DefinePlugin values.

---

## 10. Verify

Run all of these before committing:

```bash
# 1. Web build must compile without errors
pnpm pack:web 2>&1 | grep -E "^ERROR|error in "

# 2. No Electron references in the built bundle
grep -c "ftElectron\|ipcRenderer" dist/web/web.js && echo "FAIL: Electron refs found" || echo "OK"

# 3. BotGuard script builds (needed if botGuardScript.js changed)
pnpm pack:botGuardScript

# 4. Server syntax check
node --check server/index.js
node --check server/routes/health.js
node --check server/routes/poToken.js
node --check server/services/poTokenService.js

# 5. Smoke-run the server (Ctrl-C after health check passes)
node server/index.js &
sleep 3
curl -sf http://localhost:8080/api/health && echo "OK" || echo "FAIL"
kill %1
```

---

## 11. Commit and Update the Base Tag

```bash
# Stage everything
git add src/ static/ package.json pnpm-lock.yaml _scripts/webpack.web.config.js

# Commit
git commit -m "chore: absorb FreeTube $NEW_TAG frontend changes"

# Move the web-base tag to the new upstream tag
git tag -f web-base-$NEW_TAG $NEW_TAG
```

---

## 12. Edge Cases

### New Electron feature that *does* need a web equivalent

If upstream adds a new feature (e.g. a new kind of system dialog) that you want to support in the web build:

1. Identify the `ipcMain.handle(IpcChannels.FOO, ...)` handler in `src/main/index.js`
2. Find the matching `window.ftElectron.foo()` call in `src/preload/interface.js`
3. Find the renderer call site (grep for `IS_ELECTRON` + `.foo(`)
4. Add an Express route in `server/routes/` following the contract rules in `webapp-architecture.md §4`
5. Add the `else` branch in the renderer call site
6. Update `migration-ruleset.md` with the new pattern

### Upstream renames or splits a file we depend on

If a file in `src/renderer/` we apply patches against is restructured:

```bash
# Find the old file in the upstream diff
git diff $OLD_TAG..$NEW_TAG --diff-filter=D --name-only   # deleted files
git diff $OLD_TAG..$NEW_TAG --diff-filter=A --name-only   # added files
```

Apply the rename manually, then re-apply our local modifications (PlayerCache guard, local.js else branch) to the new path.

### BotGuard / `bgutils-js` API change

If `src/botGuardScript.js` changed and `bgutils-js` received a major API update:

1. Apply the upstream change to `src/botGuardScript.js`
2. Run `pnpm pack:botGuardScript` to rebuild
3. Check that `dist/botGuardScript.js` still ends with `export{<name> as default};`  
   (The poTokenService relies on this pattern to transform the script)
4. If the export pattern changed, update the regex in `server/services/poTokenService.js`

### Playwright version bump needed

If `bgutils-js` or the BotGuard challenge format changes in a way that requires a newer Chromium:

1. Update `playwright` in `server/package.json` to the new version
2. Update the `FROM mcr.microsoft.com/playwright:v{VERSION}-jammy` line in `Dockerfile`
3. Run `npm install` in `server/` to update `package-lock.json`
4. Test locally with `node server/index.js` and a real video ID
