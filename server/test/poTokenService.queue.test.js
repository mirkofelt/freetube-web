'use strict'

// Tests for the promise-queue helper that serialises BotGuard requests.
// We test the queue behaviour in isolation without launching Playwright.

const { test } = require('node:test')
const assert = require('node:assert/strict')

// Replicate the enqueueAsyncFunction implementation from poTokenService.js
// so we can unit-test the queue contract without any Chromium dependency.
function makeQueue() {
  let queueGuardian = Promise.resolve()
  function enqueueAsyncFunction(func, ...args) {
    queueGuardian = queueGuardian.then(() =>
      func(...args).then(
        result => ({ error: false, result }),
        result => ({ error: true, result }),
      )
    )
    return queueGuardian.then(({ error, result }) =>
      error ? Promise.reject(result) : Promise.resolve(result)
    )
  }
  return enqueueAsyncFunction
}

test('queue: resolves a single async function', async () => {
  const enqueue = makeQueue()
  const result = await enqueue(async () => 42)
  assert.equal(result, 42)
})

test('queue: resolves multiple calls in order', async () => {
  const enqueue = makeQueue()
  const order = []
  await Promise.all([
    enqueue(async () => { order.push(1) }),
    enqueue(async () => { order.push(2) }),
    enqueue(async () => { order.push(3) }),
  ])
  assert.deepEqual(order, [1, 2, 3])
})

test('queue: rejection does not poison subsequent tasks', async () => {
  const enqueue = makeQueue()
  const first = enqueue(async () => { throw new Error('boom') })
  const second = enqueue(async () => 'ok')
  await assert.rejects(first)
  assert.equal(await second, 'ok')
})

test('queue: passes arguments through to the function', async () => {
  const enqueue = makeQueue()
  const result = await enqueue(async (a, b) => a + b, 3, 4)
  assert.equal(result, 7)
})

test('queue: tasks run sequentially, not concurrently', async () => {
  const enqueue = makeQueue()
  let running = 0
  let maxConcurrent = 0

  async function tracked() {
    running++
    maxConcurrent = Math.max(maxConcurrent, running)
    await new Promise(r => setTimeout(r, 10))
    running--
  }

  await Promise.all([enqueue(tracked), enqueue(tracked), enqueue(tracked)])
  assert.equal(maxConcurrent, 1)
})
