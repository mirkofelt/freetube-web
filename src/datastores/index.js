import Datastore from '@seald-io/nedb'

let dbPath = null

if (process.env.IS_ELECTRON_MAIN) {
  const { app } = require('electron')
  const { join } = require('path')
  // this code only runs in the electron main process, so hopefully using sync fs code here should be fine 😬
  const { statSync, realpathSync } = require('fs')
  const userDataPath = app.getPath('userData') // This is based on the user's OS
  dbPath = (dbName) => {
    let path = join(userDataPath, `${dbName}.db`)

    // returns undefined if the path doesn't exist
    if (statSync(path, { throwIfNoEntry: false })?.isSymbolicLink) {
      path = realpathSync(path)
    }

    return path
  }
} else {
  // In the web build, databases live in the browser's IndexedDB via localForage.
  // When the server injects window.__FT_USER_ID__ (multi-user mode), prefix every
  // database name with the user ID so each user gets their own isolated storage.
  dbPath = (dbName) => {
    const userId = (typeof window !== 'undefined' && window.__FT_USER_ID__)
      ? window.__FT_USER_ID__
      : 'default'
    return `${userId}/${dbName}.db`
  }
}

/**
 * @param {string} name
 */
function createDatastore(name) {
  return new Datastore({
    filename: dbPath(name),
    autoload: !process.env.IS_ELECTRON_MAIN,
    // Automatically clean up corrupted data, instead of crashing
    corruptAlertThreshold: 1
  })
}

export const settings = createDatastore('settings')
export const profiles = createDatastore('profiles')
export const playlists = createDatastore('playlists')
export const history = createDatastore('history')
export const searchHistory = createDatastore('search-history')
export const subscriptionCache = createDatastore('subscription-cache')
