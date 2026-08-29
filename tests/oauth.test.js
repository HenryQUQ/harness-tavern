import test from 'node:test'
import assert from 'node:assert/strict'
import { testApp, captureServer } from './helpers.js'
import { OpenRouterOAuthConnector } from '../src/account/openrouter-oauth.js'

await test('OpenRouter account connector generates PKCE authorization URL and embeds anti-CSRF state in callback', async t => {
  const { app } = await testApp(t)
  const connector = new OpenRouterOAuthConnector({ db: app.db, vault: app.vault, publicUrl: 'http://127.0.0.1:8787' })
  const result = connector.begin()
  const authorization = new URL(result.authorization_url)
  assert.equal(authorization.origin, 'https://openrouter.ai')
  assert.equal(authorization.pathname, '/auth')
  assert.equal(authorization.searchParams.get('code_challenge_method'), 'S256')
  assert.ok(authorization.searchParams.get('code_challenge').length > 40)
  const callback = new URL(authorization.searchParams.get('callback_url'))
  assert.equal(callback.searchParams.get('state'), result.state)
})

await test('OpenRouter OAuth exchanges the code and stores a user-controlled account key encrypted', async t => {
  const { app } = await testApp(t)
  const capture = await captureServer(t, (record, response) => {
    response.writeHead(200, { 'content-type': 'application/json' })
    if (record.url === '/api/v1/auth/keys') response.end(JSON.stringify({ key: 'sk-or-v1-secret' }))
    else response.end(JSON.stringify({ data: { label: 'Harness Tavern', limit: 10, usage: 1 } }))
  })
  const connector = new OpenRouterOAuthConnector({
    db: app.db,
    vault: app.vault,
    publicUrl: 'http://127.0.0.1:8787',
    authorizeUrl: `${capture.baseUrl}/auth`,
    exchangeUrl: `${capture.baseUrl}/api/v1/auth/keys`,
    keyInfoUrl: `${capture.baseUrl}/api/v1/auth/key`,
  })
  const start = connector.begin()
  const account = await connector.complete({ state: start.state, code: 'authorization-code', label: 'My OpenRouter' })
  assert.equal(account.connector_id, 'openrouter-oauth')
  assert.equal(capture.requests[0].json.code, 'authorization-code')
  assert.ok(capture.requests[0].json.code_verifier.length > 40)
  const row = app.db.raw.prepare('SELECT * FROM account_connections WHERE id = ?').get(account.id)
  assert.notEqual(row.secret_envelope, 'sk-or-v1-secret')
  assert.equal(app.vault.decrypt(row.secret_envelope), 'sk-or-v1-secret')
  assert.equal(app.db.raw.prepare('SELECT count(*) AS count FROM oauth_states').get().count, 0)
})

await test('account connection registry exposes only official connectors', async t => {
  const { app } = await testApp(t)
  const descriptors = app.accounts.descriptors()
  assert.deepEqual(descriptors.map(item => item.id), ['openrouter-oauth'])
  assert.equal(descriptors[0].authorization, 'oauth-pkce')
  assert.match(descriptors[0].description, /user-controlled OpenRouter API key/i)
})
