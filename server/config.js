'use strict'

const { readFileSync, writeFileSync, existsSync } = require('fs')
const path = require('path')

const USERS_FILE = path.join(__dirname, 'users.json')

const AVATAR_COLORS = [
  '#e62117', // red
  '#2196F3', // blue
  '#4CAF50', // green
  '#9C27B0', // purple
  '#FF9800', // orange
  '#009688', // teal
  '#E91E63', // pink
  '#3F51B5', // indigo
]

function sanitizeName(name) {
  return String(name).trim().toLowerCase().replace(/[^a-z0-9_-]/g, '')
}

function capitalize(str) {
  return str.charAt(0).toUpperCase() + str.slice(1)
}

function readFile() {
  if (existsSync(USERS_FILE)) {
    try {
      const parsed = JSON.parse(readFileSync(USERS_FILE, 'utf-8'))
      if (Array.isArray(parsed.users) && parsed.users.length > 0) return parsed.users
    } catch { /* fall through */ }
  }
  return null
}

function writeFile(users) {
  writeFileSync(USERS_FILE, JSON.stringify({ users }, null, 2), 'utf-8')
}

function bootstrapFromEnv() {
  const raw = process.env.FREETUBE_USERS ?? 'default'
  const ids = [...new Set(
    raw.split(',').map(sanitizeName).filter(Boolean)
  )]
  return ids.map((id, i) => ({
    id,
    displayName: capitalize(id),
    color: AVATAR_COLORS[i % AVATAR_COLORS.length],
  }))
}

/** In-memory cache; populated lazily on first call. */
let _users = null

function getUsers() {
  if (!_users) {
    _users = readFile() ?? bootstrapFromEnv()
    // Persist the bootstrapped list so future restarts don't re-read the env
    if (!existsSync(USERS_FILE)) writeFile(_users)
  }
  return _users
}

function addUser(displayName) {
  const id = sanitizeName(displayName)
  if (!id) throw Object.assign(new Error('Name must contain at least one letter or digit'), { status: 400 })
  const users = getUsers()
  if (users.some(u => u.id === id)) {
    throw Object.assign(new Error(`User "${id}" already exists`), { status: 409 })
  }
  const user = {
    id,
    displayName: String(displayName).trim(),
    color: AVATAR_COLORS[users.length % AVATAR_COLORS.length],
  }
  users.push(user)
  writeFile(users)
  return user
}

function deleteUser(id) {
  const users = getUsers()
  const idx = users.findIndex(u => u.id === id)
  if (idx === -1) throw Object.assign(new Error('User not found'), { status: 404 })
  users.splice(idx, 1)
  writeFile(users)
}

function updateUser(id, { displayName, color }) {
  const users = getUsers()
  const user = users.find(u => u.id === id)
  if (!user) throw Object.assign(new Error('User not found'), { status: 404 })
  if (displayName !== undefined) user.displayName = String(displayName).trim()
  if (color !== undefined) user.color = String(color)
  writeFile(users)
  return user
}

module.exports = { getUsers, addUser, deleteUser, updateUser, sanitizeName, AVATAR_COLORS }
