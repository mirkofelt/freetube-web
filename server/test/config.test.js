'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

// ── helpers ───────────────────────────────────────────────────────────────────

/**
 * Load a fresh config module isolated to its own temp DATA_DIR.
 * Returns { module, cleanup } — call cleanup() in every test's finally block.
 */
function loadConfig() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-test-'))
  process.env.DATA_DIR = tmpDir
  delete require.cache[require.resolve('../config')]
  const mod = require('../config')
  function cleanup() {
    fs.rmSync(tmpDir, { recursive: true, force: true })
    delete process.env.DATA_DIR
    delete process.env.FREETUBE_USERS
    delete require.cache[require.resolve('../config')]
  }
  return { mod, cleanup }
}

// ── sanitizeName ─────────────────────────────────────────────────────────────

test('sanitizeName: lowercases input', () => {
  const { mod, cleanup } = loadConfig()
  try { assert.equal(mod.sanitizeName('Alice'), 'alice') } finally { cleanup() }
})

test('sanitizeName: strips disallowed characters', () => {
  const { mod, cleanup } = loadConfig()
  try { assert.equal(mod.sanitizeName('Alice Smith!'), 'alicesmith') } finally { cleanup() }
})

test('sanitizeName: allows hyphens and underscores', () => {
  const { mod, cleanup } = loadConfig()
  try { assert.equal(mod.sanitizeName('alice_bob-123'), 'alice_bob-123') } finally { cleanup() }
})

test('sanitizeName: trims surrounding whitespace', () => {
  const { mod, cleanup } = loadConfig()
  try { assert.equal(mod.sanitizeName('  dave  '), 'dave') } finally { cleanup() }
})

test('sanitizeName: returns empty string for all-special input', () => {
  const { mod, cleanup } = loadConfig()
  try { assert.equal(mod.sanitizeName('!!!'), '') } finally { cleanup() }
})

// ── bootstrapFromEnv / getUsers ───────────────────────────────────────────────

test('getUsers: bootstraps from FREETUBE_USERS when no file exists', () => {
  process.env.FREETUBE_USERS = 'alice,bob'
  const { mod, cleanup } = loadConfig()
  try {
    const users = mod.getUsers()
    assert.equal(users.length, 2)
    assert.equal(users[0].id, 'alice')
    assert.equal(users[1].id, 'bob')
  } finally { cleanup() }
})

test('getUsers: displayName is capitalised id when bootstrapping from env', () => {
  process.env.FREETUBE_USERS = 'charlie'
  const { mod, cleanup } = loadConfig()
  try {
    const users = mod.getUsers()
    assert.equal(users[0].displayName, 'Charlie')
  } finally { cleanup() }
})

test('getUsers: deduplicates names from FREETUBE_USERS', () => {
  process.env.FREETUBE_USERS = 'alice,alice,bob'
  const { mod, cleanup } = loadConfig()
  try {
    assert.equal(mod.getUsers().length, 2)
  } finally { cleanup() }
})

test('getUsers: defaults to "default" when FREETUBE_USERS is unset', () => {
  const { mod, cleanup } = loadConfig()
  try {
    const users = mod.getUsers()
    assert.equal(users.length, 1)
    assert.equal(users[0].id, 'default')
  } finally { cleanup() }
})

test('getUsers: reads persisted users.json when it exists', () => {
  const { mod, cleanup } = loadConfig()
  try {
    const usersFile = path.join(process.env.DATA_DIR, 'users.json')
    const stored = { users: [{ id: 'dave', displayName: 'Dave', color: '#123456' }] }
    fs.writeFileSync(usersFile, JSON.stringify(stored))
    // Re-require to pick up the file we just wrote (module not yet loaded)
    delete require.cache[require.resolve('../config')]
    const mod2 = require('../config')
    const users = mod2.getUsers()
    assert.equal(users.length, 1)
    assert.equal(users[0].id, 'dave')
  } finally { cleanup() }
})

test('getUsers: falls back to env when users.json is malformed', () => {
  process.env.FREETUBE_USERS = 'eve'
  const { mod, cleanup } = loadConfig()
  try {
    const usersFile = path.join(process.env.DATA_DIR, 'users.json')
    fs.writeFileSync(usersFile, 'not valid json')
    delete require.cache[require.resolve('../config')]
    const mod2 = require('../config')
    assert.equal(mod2.getUsers()[0].id, 'eve')
  } finally { cleanup() }
})

test('getUsers: falls back to env when users.json has empty array', () => {
  process.env.FREETUBE_USERS = 'frank'
  const { mod, cleanup } = loadConfig()
  try {
    const usersFile = path.join(process.env.DATA_DIR, 'users.json')
    fs.writeFileSync(usersFile, JSON.stringify({ users: [] }))
    delete require.cache[require.resolve('../config')]
    const mod2 = require('../config')
    assert.equal(mod2.getUsers()[0].id, 'frank')
  } finally { cleanup() }
})

// ── addUser ───────────────────────────────────────────────────────────────────

test('addUser: creates a user and persists it', () => {
  process.env.FREETUBE_USERS = 'alice'
  const { mod, cleanup } = loadConfig()
  try {
    const user = mod.addUser('Bob')
    assert.equal(user.id, 'bob')
    assert.equal(user.displayName, 'Bob')
    assert.ok(user.color)
    assert.equal(mod.getUsers().length, 2)
  } finally { cleanup() }
})

test('addUser: preserves original displayName capitalisation', () => {
  process.env.FREETUBE_USERS = 'alice'
  const { mod, cleanup } = loadConfig()
  try {
    const user = mod.addUser('Charlie Smith')
    assert.equal(user.displayName, 'Charlie Smith')
  } finally { cleanup() }
})

test('addUser: throws 409 when id already exists', () => {
  process.env.FREETUBE_USERS = 'alice'
  const { mod, cleanup } = loadConfig()
  try {
    assert.throws(() => mod.addUser('Alice'), err => err.status === 409)
  } finally { cleanup() }
})

test('addUser: throws 400 for name with no valid characters', () => {
  process.env.FREETUBE_USERS = 'alice'
  const { mod, cleanup } = loadConfig()
  try {
    assert.throws(() => mod.addUser('!!!'), err => err.status === 400)
  } finally { cleanup() }
})

test('addUser: cycles through AVATAR_COLORS by index', () => {
  process.env.FREETUBE_USERS = 'a,b,c,d,e,f,g,h'
  const { mod, cleanup } = loadConfig()
  try {
    // 8 users already (same as AVATAR_COLORS.length); adding one more wraps around
    const user = mod.addUser('extra')
    assert.equal(user.color, mod.AVATAR_COLORS[0])
  } finally { cleanup() }
})

// ── deleteUser ────────────────────────────────────────────────────────────────

test('deleteUser: removes the user from the list', () => {
  process.env.FREETUBE_USERS = 'alice,bob'
  const { mod, cleanup } = loadConfig()
  try {
    mod.deleteUser('alice')
    const users = mod.getUsers()
    assert.equal(users.length, 1)
    assert.equal(users[0].id, 'bob')
  } finally { cleanup() }
})

test('deleteUser: throws 404 for unknown id', () => {
  process.env.FREETUBE_USERS = 'alice'
  const { mod, cleanup } = loadConfig()
  try {
    assert.throws(() => mod.deleteUser('nobody'), err => err.status === 404)
  } finally { cleanup() }
})

// ── updateUser ────────────────────────────────────────────────────────────────

test('updateUser: updates displayName', () => {
  process.env.FREETUBE_USERS = 'alice'
  const { mod, cleanup } = loadConfig()
  try {
    mod.updateUser('alice', { displayName: 'Alicia' })
    assert.equal(mod.getUsers()[0].displayName, 'Alicia')
  } finally { cleanup() }
})

test('updateUser: updates color', () => {
  process.env.FREETUBE_USERS = 'alice'
  const { mod, cleanup } = loadConfig()
  try {
    mod.updateUser('alice', { color: '#aabbcc' })
    assert.equal(mod.getUsers()[0].color, '#aabbcc')
  } finally { cleanup() }
})

test('updateUser: returns the updated user object', () => {
  process.env.FREETUBE_USERS = 'alice'
  const { mod, cleanup } = loadConfig()
  try {
    const user = mod.updateUser('alice', { displayName: 'A', color: '#ff0000' })
    assert.equal(user.displayName, 'A')
    assert.equal(user.color, '#ff0000')
  } finally { cleanup() }
})

test('updateUser: throws 404 for unknown id', () => {
  process.env.FREETUBE_USERS = 'alice'
  const { mod, cleanup } = loadConfig()
  try {
    assert.throws(() => mod.updateUser('nobody', { displayName: 'X' }), err => err.status === 404)
  } finally { cleanup() }
})

test('updateUser: undefined fields are not overwritten', () => {
  process.env.FREETUBE_USERS = 'alice'
  const { mod, cleanup } = loadConfig()
  try {
    const before = mod.getUsers()[0].color
    mod.updateUser('alice', { displayName: 'Alicia' })
    assert.equal(mod.getUsers()[0].color, before)
  } finally { cleanup() }
})
