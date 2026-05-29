'use strict'

const { test, beforeEach, afterEach } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')

// ── helpers ───────────────────────────────────────────────────────────────────

const USERS_FILE = path.join(__dirname, '../users.json')

function loadConfig() {
  // Clear the module cache so each test group gets a fresh module state.
  delete require.cache[require.resolve('../config')]
  return require('../config')
}

function cleanupUsersFile() {
  if (fs.existsSync(USERS_FILE)) fs.unlinkSync(USERS_FILE)
}

// ── sanitizeName ─────────────────────────────────────────────────────────────

test('sanitizeName: lowercases input', () => {
  const { sanitizeName } = loadConfig()
  assert.equal(sanitizeName('Alice'), 'alice')
})

test('sanitizeName: strips disallowed characters', () => {
  const { sanitizeName } = loadConfig()
  assert.equal(sanitizeName('Alice Smith!'), 'alicesmith')
})

test('sanitizeName: allows hyphens and underscores', () => {
  const { sanitizeName } = loadConfig()
  assert.equal(sanitizeName('alice_bob-123'), 'alice_bob-123')
})

test('sanitizeName: trims surrounding whitespace', () => {
  const { sanitizeName } = loadConfig()
  assert.equal(sanitizeName('  dave  '), 'dave')
})

test('sanitizeName: returns empty string for all-special input', () => {
  const { sanitizeName } = loadConfig()
  assert.equal(sanitizeName('!!!'), '')
})

// ── bootstrapFromEnv / getUsers ───────────────────────────────────────────────

test('getUsers: bootstraps from FREETUBE_USERS when no file exists', () => {
  cleanupUsersFile()
  process.env.FREETUBE_USERS = 'alice,bob'
  const { getUsers } = loadConfig()
  const users = getUsers()
  assert.equal(users.length, 2)
  assert.equal(users[0].id, 'alice')
  assert.equal(users[1].id, 'bob')
  cleanupUsersFile()
  delete process.env.FREETUBE_USERS
})

test('getUsers: displayName is capitalised id when bootstrapping from env', () => {
  cleanupUsersFile()
  process.env.FREETUBE_USERS = 'charlie'
  const { getUsers } = loadConfig()
  const users = getUsers()
  assert.equal(users[0].displayName, 'Charlie')
  cleanupUsersFile()
  delete process.env.FREETUBE_USERS
})

test('getUsers: deduplcates names from FREETUBE_USERS', () => {
  cleanupUsersFile()
  process.env.FREETUBE_USERS = 'alice,alice,bob'
  const { getUsers } = loadConfig()
  const users = getUsers()
  assert.equal(users.length, 2)
  cleanupUsersFile()
  delete process.env.FREETUBE_USERS
})

test('getUsers: defaults to "default" when FREETUBE_USERS is unset', () => {
  cleanupUsersFile()
  delete process.env.FREETUBE_USERS
  const { getUsers } = loadConfig()
  const users = getUsers()
  assert.equal(users.length, 1)
  assert.equal(users[0].id, 'default')
  cleanupUsersFile()
})

test('getUsers: reads persisted users.json when it exists', () => {
  const stored = { users: [{ id: 'dave', displayName: 'Dave', color: '#123456' }] }
  fs.writeFileSync(USERS_FILE, JSON.stringify(stored))
  const { getUsers } = loadConfig()
  const users = getUsers()
  assert.equal(users.length, 1)
  assert.equal(users[0].id, 'dave')
  cleanupUsersFile()
})

test('getUsers: falls back to env when users.json is malformed', () => {
  fs.writeFileSync(USERS_FILE, 'not valid json')
  process.env.FREETUBE_USERS = 'eve'
  const { getUsers } = loadConfig()
  const users = getUsers()
  assert.equal(users[0].id, 'eve')
  cleanupUsersFile()
  delete process.env.FREETUBE_USERS
})

test('getUsers: falls back to env when users.json has empty array', () => {
  fs.writeFileSync(USERS_FILE, JSON.stringify({ users: [] }))
  process.env.FREETUBE_USERS = 'frank'
  const { getUsers } = loadConfig()
  const users = getUsers()
  assert.equal(users[0].id, 'frank')
  cleanupUsersFile()
  delete process.env.FREETUBE_USERS
})

// ── addUser ───────────────────────────────────────────────────────────────────

test('addUser: creates a user and persists it', () => {
  cleanupUsersFile()
  process.env.FREETUBE_USERS = 'alice'
  const { addUser, getUsers } = loadConfig()
  const user = addUser('Bob')
  assert.equal(user.id, 'bob')
  assert.equal(user.displayName, 'Bob')
  assert.ok(user.color)
  assert.equal(getUsers().length, 2)
  cleanupUsersFile()
  delete process.env.FREETUBE_USERS
})

test('addUser: preserves original displayName capitalisation', () => {
  cleanupUsersFile()
  process.env.FREETUBE_USERS = 'alice'
  const { addUser } = loadConfig()
  const user = addUser('Charlie Smith')
  assert.equal(user.displayName, 'Charlie Smith')
  cleanupUsersFile()
  delete process.env.FREETUBE_USERS
})

test('addUser: throws 409 when id already exists', () => {
  cleanupUsersFile()
  process.env.FREETUBE_USERS = 'alice'
  const { addUser } = loadConfig()
  assert.throws(() => addUser('Alice'), err => err.status === 409)
  cleanupUsersFile()
  delete process.env.FREETUBE_USERS
})

test('addUser: throws 400 for name with no valid characters', () => {
  cleanupUsersFile()
  process.env.FREETUBE_USERS = 'alice'
  const { addUser } = loadConfig()
  assert.throws(() => addUser('!!!'), err => err.status === 400)
  cleanupUsersFile()
  delete process.env.FREETUBE_USERS
})

test('addUser: cycles through AVATAR_COLORS by index', () => {
  cleanupUsersFile()
  process.env.FREETUBE_USERS = 'a,b,c,d,e,f,g,h'
  const { addUser, AVATAR_COLORS, getUsers } = loadConfig()
  // 8 users already (same as AVATAR_COLORS.length); adding one more wraps around
  const user = addUser('extra')
  assert.equal(user.color, AVATAR_COLORS[0])
  cleanupUsersFile()
  delete process.env.FREETUBE_USERS
})

// ── deleteUser ────────────────────────────────────────────────────────────────

test('deleteUser: removes the user from the list', () => {
  cleanupUsersFile()
  process.env.FREETUBE_USERS = 'alice,bob'
  const { deleteUser, getUsers } = loadConfig()
  deleteUser('alice')
  const users = getUsers()
  assert.equal(users.length, 1)
  assert.equal(users[0].id, 'bob')
  cleanupUsersFile()
  delete process.env.FREETUBE_USERS
})

test('deleteUser: throws 404 for unknown id', () => {
  cleanupUsersFile()
  process.env.FREETUBE_USERS = 'alice'
  const { deleteUser } = loadConfig()
  assert.throws(() => deleteUser('nobody'), err => err.status === 404)
  cleanupUsersFile()
  delete process.env.FREETUBE_USERS
})

// ── updateUser ────────────────────────────────────────────────────────────────

test('updateUser: updates displayName', () => {
  cleanupUsersFile()
  process.env.FREETUBE_USERS = 'alice'
  const { updateUser, getUsers } = loadConfig()
  updateUser('alice', { displayName: 'Alicia' })
  assert.equal(getUsers()[0].displayName, 'Alicia')
  cleanupUsersFile()
  delete process.env.FREETUBE_USERS
})

test('updateUser: updates color', () => {
  cleanupUsersFile()
  process.env.FREETUBE_USERS = 'alice'
  const { updateUser, getUsers } = loadConfig()
  updateUser('alice', { color: '#aabbcc' })
  assert.equal(getUsers()[0].color, '#aabbcc')
  cleanupUsersFile()
  delete process.env.FREETUBE_USERS
})

test('updateUser: returns the updated user object', () => {
  cleanupUsersFile()
  process.env.FREETUBE_USERS = 'alice'
  const { updateUser } = loadConfig()
  const user = updateUser('alice', { displayName: 'A', color: '#ff0000' })
  assert.equal(user.displayName, 'A')
  assert.equal(user.color, '#ff0000')
  cleanupUsersFile()
  delete process.env.FREETUBE_USERS
})

test('updateUser: throws 404 for unknown id', () => {
  cleanupUsersFile()
  process.env.FREETUBE_USERS = 'alice'
  const { updateUser } = loadConfig()
  assert.throws(() => updateUser('nobody', { displayName: 'X' }), err => err.status === 404)
  cleanupUsersFile()
  delete process.env.FREETUBE_USERS
})

test('updateUser: undefined fields are not overwritten', () => {
  cleanupUsersFile()
  process.env.FREETUBE_USERS = 'alice'
  const { updateUser, getUsers } = loadConfig()
  const before = getUsers()[0].color
  updateUser('alice', { displayName: 'Alicia' })
  assert.equal(getUsers()[0].color, before)
  cleanupUsersFile()
  delete process.env.FREETUBE_USERS
})
