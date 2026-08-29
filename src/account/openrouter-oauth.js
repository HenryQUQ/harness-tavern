import { fetchJson } from '../providers/http.js'
import { id, nowIso, randomToken, sha256Base64Url, stableStringify } from '../util.js'

const DEFAULT_AUTHORIZE_URL = 'https://openrouter.ai/auth'
const DEFAULT_EXCHANGE_URL = 'https://openrouter.ai/api/v1/auth/keys'
const DEFAULT_KEY_INFO_URL = 'https://openrouter.ai/api/v1/auth/key'

export class OpenRouterOAuthConnector {
  constructor({ db, vault, publicUrl, timeoutMs = 30_000, authorizeUrl = DEFAULT_AUTHORIZE_URL, exchangeUrl = DEFAULT_EXCHANGE_URL, keyInfoUrl = DEFAULT_KEY_INFO_URL }) {
    this.id = 'openrouter-oauth'
    this.label = 'OpenRouter account (OAuth PKCE)'
    this.db = db
    this.vault = vault
    this.publicUrl = publicUrl.replace(/\/+$/, '')
    this.timeoutMs = timeoutMs
    this.authorizeUrl = authorizeUrl
    this.exchangeUrl = exchangeUrl
    this.keyInfoUrl = keyInfoUrl
  }

  descriptor() {
    return {
      id: this.id,
      label: this.label,
      provider_id: 'openrouter',
      authorization: 'oauth-pkce',
      available: true,
      description: 'Authorize Harness Tavern to create a user-controlled OpenRouter API key. Uses the OpenRouter account credit and BYOK routing configured on that account.',
    }
  }

  begin({ callbackUrl } = {}) {
    const state = randomToken(24)
    const verifier = randomToken(64)
    const challenge = sha256Base64Url(verifier)
    const callbackBase = callbackUrl || `${this.publicUrl}/api/account-connections/openrouter/callback`
    const callbackObject = new URL(callbackBase)
    callbackObject.searchParams.set('state', state)
    const callback = callbackObject.toString()
    this.db.raw.prepare('INSERT INTO oauth_states(state, connector_id, verifier_envelope, callback_url, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(state, this.id, this.vault.encrypt(verifier), callback, nowIso())
    const url = new URL(this.authorizeUrl)
    url.searchParams.set('callback_url', callback)
    url.searchParams.set('code_challenge', challenge)
    url.searchParams.set('code_challenge_method', 'S256')
    url.searchParams.set('state', state)
    return { authorization_url: url.toString(), state, callback_url: callback }
  }

  async complete({ state, code, label = 'OpenRouter account', signal }) {
    const row = this.db.raw.prepare('SELECT * FROM oauth_states WHERE state = ? AND connector_id = ?').get(state, this.id)
    if (!row) {
      const error = new Error('OAuth state is invalid or already used')
      error.status = 400
      error.code = 'invalid_oauth_state'
      throw error
    }
    if (Date.now() - Date.parse(row.created_at) > 15 * 60_000) {
      this.db.raw.prepare('DELETE FROM oauth_states WHERE state = ?').run(state)
      const error = new Error('OAuth state expired')
      error.status = 400
      error.code = 'oauth_state_expired'
      throw error
    }
    const verifier = this.vault.decrypt(row.verifier_envelope)
    const exchange = await fetchJson(this.exchangeUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ code, code_verifier: verifier, code_challenge_method: 'S256' }),
      signal,
    }, { timeoutMs: this.timeoutMs, retries: 0 })
    const key = exchange.body?.key
    if (!key) throw new Error('OpenRouter did not return an API key')
    let keyInfo = {}
    try {
      const info = await fetchJson(this.keyInfoUrl, {
        headers: { accept: 'application/json', authorization: `Bearer ${key}` }, signal,
      }, { timeoutMs: this.timeoutMs, retries: 0 })
      keyInfo = info.body?.data ?? info.body ?? {}
    } catch {}
    const accountId = id('acct')
    const timestamp = nowIso()
    const metadata = {
      provider_id: 'openrouter',
      oauth: true,
      key_info: keyInfo,
      issued_at: timestamp,
    }
    this.db.transaction(() => {
      this.db.raw.prepare(`
        INSERT INTO account_connections(id, connector_id, label, secret_envelope, metadata_json, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(accountId, this.id, String(label).slice(0, 120), this.vault.encrypt(key), stableStringify(metadata), timestamp, timestamp)
      this.db.raw.prepare('DELETE FROM oauth_states WHERE state = ?').run(state)
    })
    this.db.audit('account.connection.created', 'account_connection', accountId, { connector_id: this.id })
    return { id: accountId, connector_id: this.id, label, metadata, created_at: timestamp }
  }
}
