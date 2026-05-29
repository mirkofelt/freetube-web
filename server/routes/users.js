'use strict'

const path = require('path')
const fs = require('fs')
const { Router } = require('express')
const { getUsers, addUser, deleteUser, updateUser, AVATAR_COLORS } = require('../config')

const router = Router({ strict: true })
const indexHtmlPath = path.join(__dirname, '../../dist/web/index.html')

// Cache the SPA shell; only read from disk once per process lifetime.
let baseHtml = null
function getBaseHtml() {
  if (!baseHtml) baseHtml = fs.readFileSync(indexHtmlPath, 'utf-8')
  return baseHtml
}

function buildUserHtml(userId) {
  const injection = `<script>window.__FT_USER_ID__=${JSON.stringify(userId)}</script>`
  return getBaseHtml().replace('<head>', `<head>${injection}`)
}

function apiError(res, err) {
  res.status(err.status ?? 500).json({ error: err.message })
}

// ── REST API ──────────────────────────────────────────────────────────────────

router.get('/api/users', (_req, res) => {
  const users = getUsers()
  res.json({ users, multiUser: users.length > 1 })
})

router.post('/api/users', (req, res) => {
  try {
    const user = addUser(req.body?.displayName ?? '')
    res.status(201).json(user)
  } catch (err) { apiError(res, err) }
})

router.patch('/api/users/:id', (req, res) => {
  try {
    const user = updateUser(req.params.id, {
      displayName: req.body?.displayName,
      color: req.body?.color,
    })
    res.json(user)
  } catch (err) { apiError(res, err) }
})

router.delete('/api/users/:id', (req, res) => {
  try {
    deleteUser(req.params.id)
    res.status(204).end()
  } catch (err) { apiError(res, err) }
})

// ── Root & per-user SPA ───────────────────────────────────────────────────────

router.get('/', (_req, res) => {
  const users = getUsers()
  if (users.length === 1) return res.redirect(302, `/u/${users[0].id}/`)
  res.type('html').send(buildPickerHtml())
})

router.get('/u/:username', (req, res) => {
  res.redirect(301, `/u/${req.params.username}/`)
})

router.get(['/u/:username/', '/u/:username/*'], (req, res) => {
  const { username } = req.params
  const user = getUsers().find(u => u.id === username)
  if (!user) return res.status(404).type('text').send('Unknown user')
  res.type('html').send(buildUserHtml(username))
})

// ── Picker HTML ───────────────────────────────────────────────────────────────

function esc(str) {
  return String(str).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))
}

function buildPickerHtml() {
  const colorSwatches = AVATAR_COLORS.map(c =>
    `<button class="swatch" style="background:${c}" data-color="${c}" aria-label="${c}"></button>`
  ).join('')

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>FreeTube — Who's watching?</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    :root {
      --bg: #141414;
      --surface: #1f1f1f;
      --surface-hover: #2a2a2a;
      --accent: #e62117;
      --text: #e5e5e5;
      --text-muted: #999;
      --border: #333;
      --radius: 8px;
      --avatar: 96px;
    }

    body {
      min-height: 100dvh;
      background: var(--bg);
      color: var(--text);
      font-family: system-ui, -apple-system, sans-serif;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 0;
    }

    /* ── Header ── */
    header {
      position: fixed;
      top: 0; left: 0; right: 0;
      height: 64px;
      display: flex;
      align-items: center;
      padding: 0 2rem;
      background: linear-gradient(to bottom, #0a0a0a 60%, transparent);
      z-index: 10;
    }
    .logo { display: flex; align-items: center; gap: .6rem; text-decoration: none; color: var(--text); }
    .logo svg { width: 32px; height: 32px; }
    .logo-text { font-size: 1.2rem; font-weight: 700; letter-spacing: .02em; }

    /* ── Main ── */
    main {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 3rem;
      padding: 96px 1rem 5rem;
      width: 100%;
      max-width: 900px;
    }

    h1 {
      font-size: clamp(1.4rem, 4vw, 2rem);
      font-weight: 400;
      letter-spacing: .08em;
      color: var(--text-muted);
      text-transform: uppercase;
    }

    /* ── User grid ── */
    #user-grid {
      display: flex;
      flex-wrap: wrap;
      gap: 1.5rem;
      justify-content: center;
    }

    .user-card {
      position: relative;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: .75rem;
      width: 140px;
      padding: 1rem .5rem 1.2rem;
      border-radius: var(--radius);
      cursor: pointer;
      border: 2px solid transparent;
      transition: border-color .15s, background .15s, transform .15s;
      text-decoration: none;
      color: var(--text);
      background: transparent;
      font: inherit;
    }
    .user-card:hover { background: var(--surface-hover); transform: scale(1.04); }
    .user-card:focus-visible { outline: 2px solid var(--accent); outline-offset: 3px; }

    .avatar {
      width: var(--avatar);
      height: var(--avatar);
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 2.4rem;
      font-weight: 700;
      color: #fff;
      flex-shrink: 0;
      transition: filter .15s;
      user-select: none;
    }

    .user-name {
      font-size: .9rem;
      text-align: center;
      word-break: break-word;
      color: var(--text-muted);
      transition: color .15s;
    }
    .user-card:hover .user-name { color: var(--text); }

    /* ── Edit overlay on each card ── */
    .edit-overlay {
      position: absolute;
      inset: 0;
      border-radius: var(--radius);
      display: none;
      flex-direction: column;
      align-items: center;
      justify-content: flex-start;
      padding-top: .5rem;
      gap: .4rem;
    }
    body.editing .edit-overlay { display: flex; }
    body.editing .user-card { border-color: var(--border); cursor: default; }
    body.editing .user-card:hover { transform: none; }
    body.editing .avatar { filter: brightness(.4); }
    body.editing .user-card .avatar-link { pointer-events: none; }

    .edit-btn {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: .35rem;
      background: rgba(255,255,255,.15);
      border: none;
      border-radius: 4px;
      color: #fff;
      font-size: .75rem;
      padding: .3rem .6rem;
      cursor: pointer;
      transition: background .12s;
      width: 90px;
    }
    .edit-btn:hover { background: rgba(255,255,255,.28); }
    .edit-btn.danger:hover { background: rgba(230,33,23,.55); }
    .edit-btn svg { width: 13px; height: 13px; flex-shrink: 0; }

    /* ── Add card ── */
    #add-card {
      display: none;
      width: 140px;
      height: 175px;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: .75rem;
      border: 2px dashed var(--border);
      border-radius: var(--radius);
      cursor: pointer;
      transition: border-color .15s, background .15s;
      background: none;
      color: var(--text-muted);
      font: inherit;
      padding: 0;
    }
    #add-card:hover { border-color: #666; background: var(--surface); color: var(--text); }
    body.editing #add-card { display: flex; }

    .add-circle {
      width: var(--avatar);
      height: var(--avatar);
      border-radius: 50%;
      border: 2px dashed currentColor;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 2.5rem;
      line-height: 1;
    }

    /* ── Manage button ── */
    #manage-btn {
      position: fixed;
      bottom: 2rem;
      right: 2rem;
      background: transparent;
      border: 1px solid var(--border);
      color: var(--text-muted);
      font: inherit;
      font-size: .85rem;
      padding: .5rem 1.2rem;
      border-radius: 4px;
      cursor: pointer;
      transition: border-color .15s, color .15s, background .15s;
      letter-spacing: .04em;
    }
    #manage-btn:hover { border-color: #777; color: var(--text); }
    body.editing #manage-btn {
      background: var(--accent);
      border-color: var(--accent);
      color: #fff;
    }
    body.editing #manage-btn:hover { background: #c41b13; }

    /* ── Modal backdrop ── */
    .modal-backdrop {
      position: fixed; inset: 0;
      background: rgba(0,0,0,.7);
      display: none;
      align-items: center;
      justify-content: center;
      z-index: 100;
    }
    .modal-backdrop.open { display: flex; }

    .modal {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 2rem;
      width: min(420px, calc(100vw - 2rem));
      display: flex;
      flex-direction: column;
      gap: 1.25rem;
    }
    .modal h2 { font-size: 1.1rem; font-weight: 600; }

    .modal label { font-size: .85rem; color: var(--text-muted); display: block; margin-bottom: .4rem; }

    .modal input[type="text"] {
      width: 100%;
      background: #2c2c2c;
      border: 1px solid var(--border);
      border-radius: 4px;
      color: var(--text);
      font: inherit;
      font-size: .95rem;
      padding: .55rem .75rem;
      outline: none;
      transition: border-color .12s;
    }
    .modal input[type="text"]:focus { border-color: #666; }

    .color-palette { display: flex; gap: .5rem; flex-wrap: wrap; }
    .swatch {
      width: 28px; height: 28px;
      border-radius: 50%;
      border: 2px solid transparent;
      cursor: pointer;
      transition: transform .12s, border-color .12s;
    }
    .swatch:hover { transform: scale(1.15); }
    .swatch.selected { border-color: #fff; }

    .modal-preview {
      display: flex;
      align-items: center;
      gap: 1rem;
    }
    .modal-avatar {
      width: 56px; height: 56px;
      border-radius: 50%;
      display: flex; align-items: center; justify-content: center;
      font-size: 1.5rem; font-weight: 700; color: #fff;
      flex-shrink: 0;
    }
    .modal-preview-name { font-size: 1rem; }

    .modal-actions {
      display: flex;
      gap: .75rem;
      justify-content: flex-end;
      margin-top: .25rem;
    }

    .btn {
      padding: .5rem 1.2rem;
      border-radius: 4px;
      border: none;
      font: inherit;
      font-size: .9rem;
      cursor: pointer;
      transition: background .12s;
    }
    .btn-ghost { background: transparent; border: 1px solid var(--border); color: var(--text-muted); }
    .btn-ghost:hover { background: var(--surface-hover); color: var(--text); }
    .btn-primary { background: var(--accent); color: #fff; }
    .btn-primary:hover { background: #c41b13; }
    .btn-danger { background: #8b1a1a; color: #fff; }
    .btn-danger:hover { background: #a51f1f; }

    .error-msg { color: #e57373; font-size: .85rem; min-height: 1.2em; }
  </style>
</head>
<body>
  <header>
    <a class="logo" href="/">
      <svg viewBox="0 0 100 70" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect width="100" height="70" rx="12" fill="#e62117"/>
        <polygon points="38,18 72,35 38,52" fill="white"/>
      </svg>
      <span class="logo-text">FreeTube</span>
    </a>
  </header>

  <main>
    <h1>Who's watching?</h1>
    <div id="user-grid"></div>
  </main>

  <button id="manage-btn">Manage Profiles</button>

  <!-- Add / Edit user modal -->
  <div class="modal-backdrop" id="user-modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">
    <div class="modal">
      <h2 id="modal-title">Add Profile</h2>
      <div class="modal-preview">
        <div class="modal-avatar" id="modal-avatar-preview">?</div>
        <span class="modal-preview-name" id="modal-name-preview">—</span>
      </div>
      <div>
        <label for="modal-name-input">Name</label>
        <input type="text" id="modal-name-input" maxlength="32" autocomplete="off" placeholder="Profile name"/>
      </div>
      <div>
        <label>Avatar colour</label>
        <div class="color-palette" id="color-palette">${colorSwatches}</div>
      </div>
      <div class="error-msg" id="modal-error"></div>
      <div class="modal-actions">
        <button class="btn btn-ghost" id="modal-cancel">Cancel</button>
        <button class="btn btn-primary" id="modal-save">Save</button>
      </div>
    </div>
  </div>

  <!-- Delete confirm modal -->
  <div class="modal-backdrop" id="delete-modal" role="dialog" aria-modal="true">
    <div class="modal">
      <h2>Delete Profile</h2>
      <p style="color:var(--text-muted);font-size:.9rem;">
        Delete <strong id="delete-name-label"></strong>?
        All data for this profile is stored in the browser and will remain there — only the profile entry is removed.
      </p>
      <div class="modal-actions">
        <button class="btn btn-ghost" id="delete-cancel">Cancel</button>
        <button class="btn btn-danger" id="delete-confirm">Delete</button>
      </div>
    </div>
  </div>

  <script>
  (function () {
    'use strict'

    const grid = document.getElementById('user-grid')
    const manageBtn = document.getElementById('manage-btn')

    // ── State ──────────────────────────────────────────────────────────────────

    let users = []
    let editing = false
    let modalMode = null    // 'add' | 'edit'
    let editTargetId = null
    let selectedColor = '${AVATAR_COLORS[0]}'
    let pendingDeleteId = null

    // ── Boot ───────────────────────────────────────────────────────────────────

    async function init() {
      const res = await fetch('/api/users')
      const data = await res.json()
      users = data.users
      render()
    }

    // ── Render ─────────────────────────────────────────────────────────────────

    function render() {
      grid.innerHTML = ''
      users.forEach(u => grid.appendChild(makeCard(u)))
      if (editing) {
        const addCard = makeAddCard()
        grid.appendChild(addCard)
      }
    }

    function makeCard(u) {
      const card = document.createElement('a')
      card.className = 'user-card'
      card.href = editing ? '#' : '/u/' + u.id + '/'
      card.dataset.id = u.id
      card.innerHTML = \`
        <div class="avatar" style="background:\${u.color}">\${initial(u.displayName)}</div>
        <span class="user-name">\${esc(u.displayName)}</span>
        <div class="edit-overlay">
          <button class="edit-btn rename-btn" data-id="\${u.id}" aria-label="Rename">
            <svg viewBox="0 0 16 16" fill="currentColor"><path d="M11.5 1a1.5 1.5 0 0 1 2.12 2.12L5 11.73l-2.5.63.63-2.5L11.5 1z"/></svg>
            Rename
          </button>
          <button class="edit-btn danger delete-btn" data-id="\${u.id}" aria-label="Delete">
            <svg viewBox="0 0 16 16" fill="currentColor"><path d="M6 2h4v1H6V2zm-2 2h8l-.8 9H4.8L4 4zm2 2v5h1V6H6zm3 0v5h1V6H9z"/></svg>
            Delete
          </button>
        </div>
      \`
      card.addEventListener('click', e => {
        if (editing) e.preventDefault()
      })
      card.querySelector('.rename-btn').addEventListener('click', e => {
        e.preventDefault(); e.stopPropagation()
        openModal('edit', u)
      })
      card.querySelector('.delete-btn').addEventListener('click', e => {
        e.preventDefault(); e.stopPropagation()
        openDeleteModal(u)
      })
      return card
    }

    function makeAddCard() {
      const btn = document.createElement('button')
      btn.id = 'add-card'
      btn.innerHTML = \`<div class="add-circle">+</div><span class="user-name">Add Profile</span>\`
      btn.addEventListener('click', () => openModal('add', null))
      return btn
    }

    // ── Edit mode ──────────────────────────────────────────────────────────────

    manageBtn.addEventListener('click', () => {
      editing = !editing
      document.body.classList.toggle('editing', editing)
      manageBtn.textContent = editing ? 'Done' : 'Manage Profiles'
      render()
    })

    // ── User modal ─────────────────────────────────────────────────────────────

    const modal = document.getElementById('user-modal')
    const modalTitle = document.getElementById('modal-title')
    const nameInput = document.getElementById('modal-name-input')
    const errorMsg = document.getElementById('modal-error')
    const modalAvatarPreview = document.getElementById('modal-avatar-preview')
    const modalNamePreview = document.getElementById('modal-name-preview')

    function openModal(mode, user) {
      modalMode = mode
      editTargetId = user?.id ?? null
      modalTitle.textContent = mode === 'add' ? 'Add Profile' : 'Edit Profile'
      nameInput.value = user?.displayName ?? ''
      selectedColor = user?.color ?? '${AVATAR_COLORS[0]}'
      errorMsg.textContent = ''
      updateSwatchSelection()
      updatePreview()
      modal.classList.add('open')
      nameInput.focus()
    }

    function closeModal() {
      modal.classList.remove('open')
      modalMode = null
      editTargetId = null
    }

    document.getElementById('modal-cancel').addEventListener('click', closeModal)
    modal.addEventListener('click', e => { if (e.target === modal) closeModal() })

    nameInput.addEventListener('input', updatePreview)

    document.getElementById('color-palette').addEventListener('click', e => {
      const btn = e.target.closest('.swatch')
      if (!btn) return
      selectedColor = btn.dataset.color
      updateSwatchSelection()
      updatePreview()
    })

    function updateSwatchSelection() {
      document.querySelectorAll('.swatch').forEach(s => {
        s.classList.toggle('selected', s.dataset.color === selectedColor)
      })
    }

    function updatePreview() {
      const name = nameInput.value.trim() || (modalMode === 'edit' ? editTargetId : '?')
      modalAvatarPreview.style.background = selectedColor
      modalAvatarPreview.textContent = initial(name)
      modalNamePreview.textContent = name || '—'
    }

    document.getElementById('modal-save').addEventListener('click', async () => {
      errorMsg.textContent = ''
      const displayName = nameInput.value.trim()
      if (!displayName) { errorMsg.textContent = 'Name cannot be empty.'; return }
      try {
        if (modalMode === 'add') {
          const res = await fetch('/api/users', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ displayName }),
          })
          if (!res.ok) { errorMsg.textContent = (await res.json()).error; return }
          const user = await res.json()
          // Set the chosen color immediately after creation
          await fetch('/api/users/' + user.id, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ color: selectedColor }),
          })
          users.push({ ...user, color: selectedColor })
        } else {
          const res = await fetch('/api/users/' + editTargetId, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ displayName, color: selectedColor }),
          })
          if (!res.ok) { errorMsg.textContent = (await res.json()).error; return }
          const updated = await res.json()
          const idx = users.findIndex(u => u.id === editTargetId)
          if (idx !== -1) users[idx] = updated
        }
        closeModal()
        render()
      } catch (err) {
        errorMsg.textContent = 'Network error — try again.'
      }
    })

    nameInput.addEventListener('keydown', e => {
      if (e.key === 'Enter') document.getElementById('modal-save').click()
      if (e.key === 'Escape') closeModal()
    })

    // ── Delete modal ───────────────────────────────────────────────────────────

    const deleteModal = document.getElementById('delete-modal')
    const deleteNameLabel = document.getElementById('delete-name-label')

    function openDeleteModal(user) {
      pendingDeleteId = user.id
      deleteNameLabel.textContent = user.displayName
      deleteModal.classList.add('open')
    }

    document.getElementById('delete-cancel').addEventListener('click', () => {
      deleteModal.classList.remove('open')
      pendingDeleteId = null
    })
    deleteModal.addEventListener('click', e => {
      if (e.target === deleteModal) { deleteModal.classList.remove('open'); pendingDeleteId = null }
    })

    document.getElementById('delete-confirm').addEventListener('click', async () => {
      if (!pendingDeleteId) return
      await fetch('/api/users/' + pendingDeleteId, { method: 'DELETE' })
      users = users.filter(u => u.id !== pendingDeleteId)
      pendingDeleteId = null
      deleteModal.classList.remove('open')
      render()
    })

    // ── Helpers ────────────────────────────────────────────────────────────────

    function initial(name) {
      return (String(name).trim()[0] ?? '?').toUpperCase()
    }

    function esc(str) {
      return String(str).replace(/[&<>"']/g, c =>
        ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))
    }

    init()
  })()
  </script>
</body>
</html>`
}

module.exports = router
