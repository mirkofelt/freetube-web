'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')
const request = require('supertest')
const express = require('express')
const healthRouter = require('../routes/health')
const { version } = require('../package.json')

function makeApp() {
  const app = express()
  app.use('/api', healthRouter)
  return app
}

test('GET /api/health returns 200 with status ok and version', async () => {
  const res = await request(makeApp()).get('/api/health')
  assert.equal(res.status, 200)
  assert.equal(res.body.status, 'ok')
  assert.equal(res.body.version, version)
})

test('GET /api/health response is JSON', async () => {
  const res = await request(makeApp()).get('/api/health')
  assert.ok(res.headers['content-type'].includes('application/json'))
})
