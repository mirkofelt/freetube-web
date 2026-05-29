const CACHE_NAME = 'freetube-player-cache'

export class PlayerCache {
  async get(key) {
    if (process.env.IS_ELECTRON) {
      return await window.ftElectron.playerCacheGet(key)
    }
    const cache = await caches.open(CACHE_NAME)
    const response = await cache.match(`/player-cache/${key}`)
    return response ? response.arrayBuffer() : undefined
  }

  async set(key, value) {
    if (process.env.IS_ELECTRON) {
      await window.ftElectron.playerCacheSet(key, value)
      return
    }
    const cache = await caches.open(CACHE_NAME)
    await cache.put(`/player-cache/${key}`, new Response(value))
  }

  async remove(_key) {
    // no-op; YouTube.js only uses remove for the OAuth credentials, but we don't use that in FreeTube
  }
}
