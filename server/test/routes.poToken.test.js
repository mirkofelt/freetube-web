'use strict'

const { test, mock, beforeEach } = require('node:test')
const assert = require('node:assert/strict')
const request = require('supertest')
const express = require('express')

// Mock the poTokenService before requiring the route.
const poTokenServicePath = require.resolve('../services/poTokenService')

function makeApp(generatePoToken) {
  // Inject a fresh mock for each test by patching the module cache.
  require.cache[poTokenServicePath] = {
    id: poTokenServicePath,
    filename: poTokenServicePath,
    loaded: true,
    exports: { generatePoToken },
  }

  // Reload the route with the patched service.
  delete require.cache[require.resolve('../routes/poToken')]
  const poTokenRouter = require('../routes/poToken')

  const app = express()
  app.use(express.json())
  app.use('/api', poTokenRouter)
  return app
}

function validBody() {
  return {
    videoId: 'dQw4w9WgXcQ', // exactly 11 chars
    context: JSON.stringify({ clientName: 'WEB', clientVersion: '2.0' }),
  }
}

// ── validation errors ─────────────────────────────────────────────────────────

test('POST /api/po-token: missing videoId → 400', async () => {
  const app = makeApp(async () => 'tok')
  const res = await request(app)
    .post('/api/po-token')
    .send({ context: '{}' })
  assert.equal(res.status, 400)
  assert.equal(res.body.error, 'invalid_input')
})

test('POST /api/po-token: videoId not 11 chars → 400', async () => {
  const app = makeApp(async () => 'tok')
  const res = await request(app)
    .post('/api/po-token')
    .send({ videoId: 'short', context: '{}' })
  assert.equal(res.status, 400)
  assert.equal(res.body.error, 'invalid_input')
})

test('POST /api/po-token: videoId that is non-string → 400', async () => {
  const app = makeApp(async () => 'tok')
  const res = await request(app)
    .post('/api/po-token')
    .send({ videoId: 12345678901, context: '{}' })
  assert.equal(res.status, 400)
})

test('POST /api/po-token: missing context → 400', async () => {
  const app = makeApp(async () => 'tok')
  const res = await request(app)
    .post('/api/po-token')
    .send({ videoId: 'dQw4w9WgXcQ' })
  assert.equal(res.status, 400)
  assert.equal(res.body.error, 'invalid_input')
})

test('POST /api/po-token: empty context → 400', async () => {
  const app = makeApp(async () => 'tok')
  const res = await request(app)
    .post('/api/po-token')
    .send({ videoId: 'dQw4w9WgXcQ', context: '' })
  assert.equal(res.status, 400)
})

test('POST /api/po-token: non-JSON context → 400', async () => {
  const app = makeApp(async () => 'tok')
  const res = await request(app)
    .post('/api/po-token')
    .send({ videoId: 'dQw4w9WgXcQ', context: 'not json' })
  assert.equal(res.status, 400)
  assert.equal(res.body.error, 'invalid_input')
  assert.match(res.body.message, /valid JSON/)
})

// ── success path ──────────────────────────────────────────────────────────────

test('POST /api/po-token: valid request returns poToken', async () => {
  const app = makeApp(async () => 'my-po-token-value')
  const res = await request(app)
    .post('/api/po-token')
    .send(validBody())
  assert.equal(res.status, 200)
  assert.equal(res.body.poToken, 'my-po-token-value')
})

test('POST /api/po-token: passes videoId and context to the service', async () => {
  let capturedVideoId, capturedContext
  const app = makeApp(async (vid, ctx) => {
    capturedVideoId = vid
    capturedContext = ctx
    return 'tok'
  })
  const body = validBody()
  await request(app).post('/api/po-token').send(body)
  assert.equal(capturedVideoId, body.videoId)
  assert.equal(capturedContext, body.context)
})

// ── service error ─────────────────────────────────────────────────────────────

test('POST /api/po-token: service error → 500', async () => {
  const app = makeApp(async () => { throw new Error('Chromium crash') })
  const res = await request(app)
    .post('/api/po-token')
    .send(validBody())
  assert.equal(res.status, 500)
  assert.equal(res.body.error, 'generation_failed')
})
