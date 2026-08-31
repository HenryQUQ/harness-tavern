import test from 'node:test'
import assert from 'node:assert/strict'
import { chmodSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CredentialVault } from '../src/storage/vault.js'
import { loadConfig } from '../src/config.js'
import { normalizeEnvelope } from '../src/runtime/operations.js'

await test('credential vault stores authenticated ciphertext and enforces private key permissions', t => {
  const dir = mkdtempSync(join(tmpdir(), 'ht-vault-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const keyPath = join(dir, 'credentials.key')
  const vault = new CredentialVault(keyPath)
  const envelope = vault.encrypt('secret-api-key')
  assert.notEqual(envelope, 'secret-api-key')
  assert.equal(vault.decrypt(envelope), 'secret-api-key')
  assert.equal(statSync(keyPath).mode & 0o777, 0o600)
  const index = Math.max(envelope.lastIndexOf('.') + 2, Math.floor(envelope.length * 0.75))
  const replacement = envelope[index] === 'A' ? 'B' : 'A'
  const tampered = `${envelope.slice(0, index)}${replacement}${envelope.slice(index + 1)}`
  assert.throws(() => vault.decrypt(tampered))
})

await test('configuration requires a token when binding beyond loopback', () => {
  assert.throws(() => loadConfig({ HT_HOST: '0.0.0.0', HT_PORT: '8787', HT_DATA_DIR: '/tmp/ht-config-test' }), /HT_ACCESS_TOKEN/)
  const config = loadConfig({ HT_HOST: '0.0.0.0', HT_PORT: '8787', HT_ACCESS_TOKEN: 'token', HT_DATA_DIR: '/tmp/ht-config-test' })
  assert.equal(config.migrationBodyLimit, 128_000_000)
  assert.throws(() => loadConfig({ HT_DATA_DIR: '/tmp/ht-config-test', HT_MIGRATION_BODY_LIMIT: 'invalid' }), /HT_MIGRATION_BODY_LIMIT/)
  assert.throws(() => loadConfig({ HT_DATA_DIR: '/tmp/ht-config-test', HT_PROVIDER_TIMEOUT_MS: '0' }), /HT_PROVIDER_TIMEOUT_MS/)
  assert.throws(() => loadConfig({ HT_DATA_DIR: '/tmp/ht-config-test', HT_MODEL_CATALOG_TTL_MS: '2.5' }), /HT_MODEL_CATALOG_TTL_MS/)
  assert.equal(config.host, '0.0.0.0')
})

await test('legacy model envelope falls back to a cast speaker and rejects empty output', () => {
  const response = `Hello ${'x'.repeat(35_000)}`
  const envelope = normalizeEnvelope({ response }, { castIds: ['char-a'] })
  assert.deepEqual(envelope.messages, [{ character_id: 'char-a', content: response }])
  assert.throws(() => normalizeEnvelope({}, { castIds: ['char-a'] }), /user-visible message/)
})
