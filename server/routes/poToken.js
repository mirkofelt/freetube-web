'use strict'

const { Router } = require('express')
const { generatePoToken } = require('../services/poTokenService')

const router = Router()

router.post('/po-token', async (req, res) => {
  const { videoId, context } = req.body

  if (typeof videoId !== 'string' || videoId.length !== 11) {
    return res.status(400).json({
      error: 'invalid_input',
      message: 'videoId must be an 11-character string',
    })
  }

  if (typeof context !== 'string' || context.length === 0) {
    return res.status(400).json({
      error: 'invalid_input',
      message: 'context is required and must be a non-empty string',
    })
  }

  // Reject obviously malformed context to guard against script injection
  // (the value is embedded verbatim into the botGuardScript).
  try {
    JSON.parse(context)
  } catch {
    return res.status(400).json({
      error: 'invalid_input',
      message: 'context must be valid JSON',
    })
  }

  try {
    const poToken = await generatePoToken(videoId, context)
    res.json({ poToken })
  } catch (err) {
    console.error('[po-token] generation failed:', err?.message ?? err)
    res.status(500).json({
      error: 'generation_failed',
      message: 'BotGuard script execution failed',
    })
  }
})

module.exports = router
