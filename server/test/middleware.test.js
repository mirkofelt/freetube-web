'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')
const request = require('supertest')

// Build a minimal version of the same-origin guard from server/index.js
// so we can test it in isolation without Playwright or the full server.
function makeGuardedApp() {
  const express = require('express')
  const app = express()
  app.use(express.json())

  app.use('/api', (req, res, next) => {
    const origin = req.headers.origin
    if (origin) {
      const host = req.headers.host
      try {
        if (new URL(origin).host !== host) {
          return res.status(403).json({ error: 'forbidden', message: 'Cross-origin API access is not allowed' })
        }
      } catch {
        return res.status(403).json({ error: 'forbidden', message: 'Invalid Origin header' })
      }
    }
    next()
  })

  app.get('/api/ping', (_req, res) => res.json({ ok: true }))
  return app
}

test('same-origin guard: allows request without Origin header', async () => {
  const res = await request(makeGuardedApp()).get('/api/ping')
  assert.equal(res.status, 200)
})

test('same-origin guard: allows request with matching Origin', async () => {
  const app = makeGuardedApp()
  const res = await request(app)
    .get('/api/ping')
    .set('Host', 'example.com')
    .set('Origin', 'http://example.com')
  assert.equal(res.status, 200)
})

test('same-origin guard: blocks cross-origin request', async () => {
  const app = makeGuardedApp()
  const res = await request(app)
    .get('/api/ping')
    .set('Host', 'myserver.local:8080')
    .set('Origin', 'http://evil.example.com')
  assert.equal(res.status, 403)
  assert.equal(res.body.error, 'forbidden')
})

test('same-origin guard: blocks request with malformed Origin header', async () => {
  const app = makeGuardedApp()
  const res = await request(app)
    .get('/api/ping')
    .set('Origin', 'not-a-url')
  assert.equal(res.status, 403)
  assert.equal(res.body.error, 'forbidden')
})
