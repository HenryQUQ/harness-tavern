import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'node:http'
import { createApp } from '../src/app.js'
import { installDeterministicTestProvider } from '../test-support/deterministic-provider.js'

export async function testApp(t, extraEnv = {}, { deterministicProvider = true } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'harness-tavern-test-'))
  const sink = { log() {}, warn() {}, error() {} }
  const env = { ...process.env, HT_DATA_DIR: dir, HT_PORT: '0', HT_HOST: '127.0.0.1', HT_LOG_LEVEL: 'error', HT_SEED_SAMPLE_CONVERSATION: 'true', ...extraEnv }
  const app = createApp({ env, loggerSink: sink })
  if (deterministicProvider) installDeterministicTestProvider(app, { includeConversation: app.config.seedSampleConversation })
  await app.listen()
  const address = app.server.address()
  const baseUrl = `http://127.0.0.1:${address.port}`
  t.after(async () => { await app.close(); rmSync(dir, { recursive: true, force: true }) })
  return { app, dir, baseUrl }
}

export async function jsonRequest(baseUrl, path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: { ...(options.body ? { 'content-type': 'application/json' } : {}), ...(options.headers ?? {}) },
  })
  const body = await response.json()
  return { response, body }
}

export async function captureServer(t, handler) {
  const requests = []
  const server = createServer(async (request, response) => {
    const chunks = []
    for await (const chunk of request) chunks.push(chunk)
    const text = Buffer.concat(chunks).toString('utf8')
    const record = { method: request.method, url: request.url, headers: request.headers, text, json: text ? JSON.parse(text) : null }
    requests.push(record)
    await handler(record, response, requests.length)
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const baseUrl = `http://127.0.0.1:${server.address().port}`
  t.after(() => new Promise(resolve => server.close(resolve)))
  return { server, baseUrl, requests }
}
