'use strict'

const { chromium } = require('playwright')
const { readFile } = require('fs/promises')
const path = require('path')

// #region queue
// Mirrors the queue pattern in src/main/poTokenGenerator.js.
// BotGuard generation must be sequential: each run spins up a browser page,
// and spawning them in parallel would exhaust OS file-descriptor limits.

let queueGuardian = Promise.resolve()

function enqueueAsyncFunction(func, ...args) {
  queueGuardian = queueGuardian.then(() =>
    func(...args).then(
      result => ({ error: false, result }),
      result => ({ error: true, result })
    )
  )
  return queueGuardian.then(({ error, result }) =>
    error ? Promise.reject(result) : Promise.resolve(result)
  )
}

// #endregion queue

/** @type {import('playwright').Browser | null} */
let browser = null

/** @type {string | null} */
let cachedScript = null

async function getBrowser() {
  if (!browser) {
    browser = await chromium.launch({
      args: [
        '--disable-web-security',    // lets about:blank fetch cross-origin (mirrors Electron's baseURLForDataURL trick)
        '--no-sandbox',               // required when running as root inside Docker
        '--disable-setuid-sandbox',
      ],
    })
  }
  return browser
}

async function getScript() {
  if (!cachedScript) {
    const scriptPath = path.resolve(__dirname, '../../dist/botGuardScript.js')
    const content = await readFile(scriptPath, 'utf-8')

    // The compiled bundle ends with: export{<name> as default};
    // Replace it with a self-invocation so page.evaluate() executes the function.
    const exportMatch = content.match(/export\{(\w+) as default\};/)
    if (!exportMatch) {
      throw new Error('botGuardScript.js is missing its export statement — rebuild with pnpm pack:botGuardScript')
    }
    cachedScript = content.replace(exportMatch[0], `;${exportMatch[1]}(FT_PARAMS)`)
  }
  return cachedScript
}

/**
 * @param {string} videoId
 * @param {string} context  JSON-serialised InnerTube session context
 * @returns {Promise<string>}
 */
async function internalGeneratePoToken(videoId, context) {
  const b = await getBrowser()
  const templateScript = await getScript()

  // Embed the arguments directly in the script string, same as the Electron implementation.
  const script = templateScript.replace('FT_PARAMS', `"${videoId}",${context}`)

  const page = await b.newPage()
  try {
    // Add the headers that YouTube's InnerTube endpoint requires.
    // Electron does this via session.webRequest.onBeforeSendHeaders; here we use Playwright routes.
    await page.route('https://www.youtube.com/youtubei/**', async route => {
      await route.continue({
        headers: {
          ...route.request().headers(),
          referer: 'https://www.youtube.com/',
          origin: 'https://www.youtube.com',
          'sec-fetch-site': 'same-origin',
          'sec-fetch-mode': 'same-origin',
          'x-youtube-bootstrap-logged-in': 'false',
        },
      })
    })

    await page.goto('about:blank')
    return await page.evaluate(script)
  } finally {
    await page.close()
  }
}

let initialised = false

/**
 * Generates a PoToken using BotGuard in a headless Chromium page.
 * Requests are queued to prevent parallel Chromium pages from exhausting OS resources.
 *
 * @param {string} videoId
 * @param {string} context  JSON-serialised InnerTube session context
 * @returns {Promise<string>}
 */
function generatePoToken(videoId, context) {
  if (!initialised) {
    initialised = true
    // Warm up browser and script cache before the first real request arrives.
    enqueueAsyncFunction(getBrowser)
    enqueueAsyncFunction(getScript)
  }

  return enqueueAsyncFunction(internalGeneratePoToken, videoId, context)
}

// Clean up the browser when the process exits.
process.on('exit', () => { if (browser) browser.close() })
process.on('SIGTERM', async () => { if (browser) await browser.close(); process.exit(0) })
process.on('SIGINT', async () => { if (browser) await browser.close(); process.exit(0) })

module.exports = { generatePoToken }
