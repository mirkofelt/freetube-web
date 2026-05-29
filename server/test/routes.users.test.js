'use strict'

const { test, beforeEach } = require('node:test')
const assert = require('node:assert/strict')
const request = require('supertest')
const express = require('express')
const fs = require('node:fs')
const path = require('node:path')

// ── stubs ─────────────────────────────────────────────────────────────────────

const configPath = require.resolve('../config')
const usersRoutePath = require.resolve('../routes/users')

// Stub index.html so the route can inject the user script tag.
const FAKE_DIST_DIR = path.join(__dirname, '../test/_fixtures')
const FAKE_INDEX = path.join(FAKE_DIST_DIR, '../dist/web/index.html')

function ensureFakeIndex() {
  const dir = path.dirname(FAKE_INDEX)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  if (!fs.existsSync(FAKE_INDEX)) {
    fs.writeFileSync(FAKE_INDEX, '<html><head></head><body>SPA</body></html>')
  }
}

function makeUsersApp(users) {
  ensureFakeIndex()

  // Build a minimal config stub.
  let _users = users.map(u => ({ ...u }))
  require.cache[configPath] = {
    id: configPath,
    filename: configPath,
    loaded: true,
    exports: {
      AVATAR_COLORS: ['#e62117', '#2196F3'],
      getUsers: () => _users,
      addUser: (displayName) => {
        const id = displayName.toLowerCase().replace(/[^a-z0-9_-]/g, '')
        if (!id) { const e = new Error('Bad name'); e.status = 400; throw e }
        if (_users.find(u => u.id === id)) { const e = new Error('Conflict'); e.status = 409; throw e }
        const user = { id, displayName: displayName.trim(), color: '#e62117' }
        _users.push(user)
        return user
      },
      updateUser: (id, fields) => {
        const u = _users.find(u => u.id === id)
        if (!u) { const e = new Error('Not found'); e.status = 404; throw e }
        if (fields.displayName !== undefined) u.displayName = fields.displayName
        if (fields.color !== undefined) u.color = fields.color
        return u
      },
      deleteUser: (id) => {
        const idx = _users.findIndex(u => u.id === id)
        if (idx === -1) { const e = new Error('Not found'); e.status = 404; throw e }
        _users.splice(idx, 1)
      },
    },
  }

  delete require.cache[usersRoutePath]
  const usersRouter = require('../routes/users')

  const app = express()
  app.set('strict routing', true)
  app.use(express.json())
  app.use(usersRouter)
  return app
}

// ── GET /api/users ─────────────────────────────────────────────────────────────

test('GET /api/users: returns user list', async () => {
  const app = makeUsersApp([{ id: 'alice', displayName: 'Alice', color: '#e62117' }])
  const res = await request(app).get('/api/users')
  assert.equal(res.status, 200)
  assert.equal(res.body.users.length, 1)
  assert.equal(res.body.users[0].id, 'alice')
})

test('GET /api/users: multiUser is false for a single user', async () => {
  const app = makeUsersApp([{ id: 'alice', displayName: 'Alice', color: '#e62117' }])
  const res = await request(app).get('/api/users')
  assert.equal(res.body.multiUser, false)
})

test('GET /api/users: multiUser is true for multiple users', async () => {
  const app = makeUsersApp([
    { id: 'alice', displayName: 'Alice', color: '#e62117' },
    { id: 'bob', displayName: 'Bob', color: '#2196F3' },
  ])
  const res = await request(app).get('/api/users')
  assert.equal(res.body.multiUser, true)
})

// ── POST /api/users ───────────────────────────────────────────────────────────

test('POST /api/users: creates user and returns 201', async () => {
  const app = makeUsersApp([])
  const res = await request(app)
    .post('/api/users')
    .send({ displayName: 'Charlie' })
  assert.equal(res.status, 201)
  assert.equal(res.body.id, 'charlie')
  assert.equal(res.body.displayName, 'Charlie')
})

test('POST /api/users: duplicate name returns 409', async () => {
  const app = makeUsersApp([{ id: 'alice', displayName: 'Alice', color: '#e62117' }])
  const res = await request(app)
    .post('/api/users')
    .send({ displayName: 'Alice' })
  assert.equal(res.status, 409)
})

test('POST /api/users: invalid name returns 400', async () => {
  const app = makeUsersApp([])
  const res = await request(app)
    .post('/api/users')
    .send({ displayName: '!!!' })
  assert.equal(res.status, 400)
})

// ── PATCH /api/users/:id ──────────────────────────────────────────────────────

test('PATCH /api/users/:id: updates displayName', async () => {
  const app = makeUsersApp([{ id: 'alice', displayName: 'Alice', color: '#e62117' }])
  const res = await request(app)
    .patch('/api/users/alice')
    .send({ displayName: 'Alicia' })
  assert.equal(res.status, 200)
  assert.equal(res.body.displayName, 'Alicia')
})

test('PATCH /api/users/:id: unknown id returns 404', async () => {
  const app = makeUsersApp([])
  const res = await request(app)
    .patch('/api/users/nobody')
    .send({ displayName: 'X' })
  assert.equal(res.status, 404)
})

// ── DELETE /api/users/:id ─────────────────────────────────────────────────────

test('DELETE /api/users/:id: returns 204', async () => {
  const app = makeUsersApp([{ id: 'alice', displayName: 'Alice', color: '#e62117' }])
  const res = await request(app).delete('/api/users/alice')
  assert.equal(res.status, 204)
})

test('DELETE /api/users/:id: unknown id returns 404', async () => {
  const app = makeUsersApp([])
  const res = await request(app).delete('/api/users/nobody')
  assert.equal(res.status, 404)
})

// ── GET / ─────────────────────────────────────────────────────────────────────

test('GET /: redirects to /u/<id>/ when only one user', async () => {
  const app = makeUsersApp([{ id: 'alice', displayName: 'Alice', color: '#e62117' }])
  const res = await request(app).get('/')
  assert.equal(res.status, 302)
  assert.equal(res.headers.location, '/u/alice/')
})

test('GET /: returns picker HTML when multiple users', async () => {
  const app = makeUsersApp([
    { id: 'alice', displayName: 'Alice', color: '#e62117' },
    { id: 'bob', displayName: 'Bob', color: '#2196F3' },
  ])
  const res = await request(app).get('/')
  assert.equal(res.status, 200)
  assert.ok(res.text.includes("Who's watching?"))
})

// ── GET /u/:username (no trailing slash) ──────────────────────────────────────

test('GET /u/alice: 301 redirects to /u/alice/', async () => {
  const app = makeUsersApp([{ id: 'alice', displayName: 'Alice', color: '#e62117' }])
  const res = await request(app).get('/u/alice')
  assert.equal(res.status, 301)
  assert.equal(res.headers.location, '/u/alice/')
})

// ── GET /u/:username/ ─────────────────────────────────────────────────────────

test('GET /u/alice/: returns HTML with injected __FT_USER_ID__', async () => {
  const app = makeUsersApp([{ id: 'alice', displayName: 'Alice', color: '#e62117' }])
  const res = await request(app).get('/u/alice/')
  assert.equal(res.status, 200)
  assert.ok(res.text.includes('window.__FT_USER_ID__'))
  assert.ok(res.text.includes('"alice"'))
})

test('GET /u/unknown/: returns 404', async () => {
  const app = makeUsersApp([{ id: 'alice', displayName: 'Alice', color: '#e62117' }])
  const res = await request(app).get('/u/nobody/')
  assert.equal(res.status, 404)
})

// ── Picker HTML does not embed user displayNames server-side ──────────────────
// The picker populates user cards entirely client-side (fetch /api/users + JS).
// This means raw displayName HTML is never present in the server-rendered response,
// which is the structural XSS protection.

test('GET /: picker HTML does not embed displayName in server-rendered output', async () => {
  const app = makeUsersApp([
    { id: 'evil', displayName: '<script>alert(1)</script>', color: '#e62117' },
    { id: 'bob', displayName: 'Bob', color: '#2196F3' },
  ])
  const res = await request(app).get('/')
  // Neither the raw tag nor any user name should appear in the static HTML shell.
  assert.ok(!res.text.includes('<script>alert(1)</script>'))
  assert.ok(!res.text.includes('Bob'))
})

// ── __FT_USER_ID__ injection is JSON-encoded (safe for inline script) ─────────

test('GET /u/alice/: injected user id is JSON.stringify-encoded', async () => {
  // Even if an id somehow contained a quote, JSON.stringify escapes it.
  const app = makeUsersApp([{ id: 'alice', displayName: 'Alice', color: '#e62117' }])
  const res = await request(app).get('/u/alice/')
  // Must appear as a JSON string, not a bare identifier.
  assert.ok(res.text.includes('window.__FT_USER_ID__="alice"'))
})
