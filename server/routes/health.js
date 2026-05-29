'use strict'

const { Router } = require('express')
const { version } = require('../package.json')

const router = Router()

router.get('/health', (_req, res) => {
  res.json({ status: 'ok', version })
})

module.exports = router
