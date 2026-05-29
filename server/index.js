'use strict'

const path = require('path')
const express = require('express')

const healthRouter = require('./routes/health')
const poTokenRouter = require('./routes/poToken')
const usersRouter = require('./routes/users')

const app = express()
app.set('strict routing', true) // /u/alice and /u/alice/ are distinct; prevents redirect loops
const PORT = process.env.PORT ?? 8080

app.use(express.json({ limit: '64kb' }))

// Same-origin guard for all /api/* endpoints.
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

app.use('/api', healthRouter)
app.use('/api', poTokenRouter)

app.get('/api/system/version', (_req, res) => {
  res.json({ serverVersion: require('./package.json').version, nodeVersion: process.version })
})

// Serve built assets (JS, CSS, fonts, images) from dist/web/.
// index: false prevents Express from auto-serving index.html for '/' — the
// user-picker router below handles that deliberately.
const distDir = path.join(__dirname, '../dist/web')
app.use(express.static(distDir, { index: false }))

// User picker (GET /) and per-user SPA (GET /u/:username/...).
// Must come AFTER static so asset requests don't reach this handler.
app.use(usersRouter)

module.exports = app

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`FreeTube web server listening on port ${PORT}`)
  })
}
