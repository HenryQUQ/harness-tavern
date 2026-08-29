import { OpenAiCompatibleAdapter } from './openai-compatible.js'
import { OpenRouterAdapter } from './openrouter.js'
import { AnthropicAdapter } from './anthropic.js'
import { GeminiAdapter } from './gemini.js'
import { AzureOpenAiAdapter } from './azure-openai.js'
import { MockAdapter } from './mock.js'
import { providerPreset, PROVIDER_PRESETS } from './catalog.js'
import { assert, id, json, nowIso, redact, stableStringify } from '../util.js'

export class ProviderRegistry {
  constructor({ db, vault, config }) {
    this.db = db
    this.vault = vault
    this.config = config
    this.adapters = new Map([
      ['openai-compatible', new OpenAiCompatibleAdapter({ timeoutMs: config.providerTimeoutMs })],
      ['openrouter', new OpenRouterAdapter({ timeoutMs: config.providerTimeoutMs, appName: config.openRouterClientName, siteUrl: config.openRouterSiteUrl })],
      ['anthropic', new AnthropicAdapter({ timeoutMs: config.providerTimeoutMs })],
      ['gemini', new GeminiAdapter({ timeoutMs: config.providerTimeoutMs })],
      ['azure-openai', new AzureOpenAiAdapter({ timeoutMs: config.providerTimeoutMs })],
      ['mock', new MockAdapter()],
    ])
  }

  listPresets() { return PROVIDER_PRESETS }

  listConnections() {
    return this.db.raw.prepare('SELECT * FROM provider_connections ORDER BY created_at').all().map(row => this.#publicConnection(row))
  }

  getConnection(connectionId) {
    const row = this.db.raw.prepare('SELECT * FROM provider_connections WHERE id = ?').get(connectionId)
    assert(row, 'Provider connection not found', 404, 'not_found')
    return row
  }

  createConnection(input) {
    const preset = input.provider_id === 'mock'
      ? { id: 'mock', label: 'Built-in Demo', adapter: 'mock', baseUrl: 'mock://local', noKey: true }
      : providerPreset(input.provider_id)
    assert(preset, 'Unknown provider preset')
    const connectionId = id('conn')
    const timestamp = nowIso()
    const label = String(input.label || preset.label).slice(0, 120)
    const baseUrl = String(input.base_url ?? preset.baseUrl ?? '').trim()
    if (preset.adapter !== 'mock') assert(baseUrl, 'base_url is required')
    const secret = input.api_key ? this.vault.encrypt(input.api_key) : null
    if (!preset.noKey && preset.adapter !== 'mock') assert(secret || input.allow_empty_key, 'API key or account connection is required')
    const config = {
      headers: input.headers ?? {},
      extra_body: input.extra_body ?? {},
      route: input.route ?? {},
      api_version: input.api_version ?? undefined,
      app_name: input.app_name ?? undefined,
      site_url: input.site_url ?? undefined,
    }
    this.db.raw.prepare(`
      INSERT INTO provider_connections(id, provider_id, label, base_url, default_model, secret_envelope, config_json, enabled, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
    `).run(connectionId, preset.id, label, baseUrl, String(input.default_model || preset.defaultModel || ''), secret, stableStringify(config), timestamp, timestamp)
    this.db.audit('provider.connection.created', 'provider_connection', connectionId, { provider_id: preset.id })
    return this.#publicConnection(this.getConnection(connectionId))
  }

  updateConnection(connectionId, input) {
    const existing = this.getConnection(connectionId)
    const secret = input.api_key === undefined
      ? existing.secret_envelope
      : input.api_key === '' ? null : this.vault.encrypt(input.api_key)
    const mergedConfig = { ...json(existing.config_json, {}), ...(input.config ?? {}) }
    for (const field of ['headers', 'extra_body', 'route', 'api_version', 'app_name', 'site_url']) {
      if (input[field] !== undefined) mergedConfig[field] = input[field]
    }
    this.db.raw.prepare(`
      UPDATE provider_connections SET label = ?, base_url = ?, default_model = ?, secret_envelope = ?, config_json = ?, enabled = ?, updated_at = ? WHERE id = ?
    `).run(
      String(input.label ?? existing.label).slice(0, 120),
      String(input.base_url ?? existing.base_url),
      String(input.default_model ?? existing.default_model),
      secret,
      stableStringify(mergedConfig),
      input.enabled === undefined ? existing.enabled : input.enabled ? 1 : 0,
      nowIso(), connectionId,
    )
    this.db.audit('provider.connection.updated', 'provider_connection', connectionId, { provider_id: existing.provider_id })
    return this.#publicConnection(this.getConnection(connectionId))
  }

  deleteConnection(connectionId) {
    const result = this.db.raw.prepare('DELETE FROM provider_connections WHERE id = ?').run(connectionId)
    assert(result.changes > 0, 'Provider connection not found', 404, 'not_found')
    this.db.audit('provider.connection.deleted', 'provider_connection', connectionId)
  }

  resolveCredential(connection, accountConnectionId = null) {
    if (accountConnectionId) {
      const account = this.db.raw.prepare('SELECT * FROM account_connections WHERE id = ?').get(accountConnectionId)
      assert(account, 'Account connection not found', 404, 'not_found')
      const metadata = json(account.metadata_json, {})
      if (metadata.provider_id) assert(metadata.provider_id === connection.provider_id, 'Account connection does not belong to this provider')
      return this.vault.decrypt(account.secret_envelope)
    }
    return this.vault.decrypt(connection.secret_envelope)
  }

  adapterFor(connection) {
    const preset = connection.provider_id === 'mock'
      ? { adapter: 'mock' }
      : providerPreset(connection.provider_id) ?? { adapter: 'openai-compatible' }
    const adapter = this.adapters.get(preset.adapter)
    assert(adapter, `No adapter registered for ${preset.adapter}`, 500, 'configuration_error')
    return adapter
  }

  async complete(request, { connectionId, accountConnectionId = null, signal } = {}) {
    const connection = this.getConnection(connectionId)
    assert(connection.enabled, 'Provider connection is disabled', 409, 'connection_disabled')
    const credential = this.resolveCredential(connection, accountConnectionId)
    const adapter = this.adapterFor(connection)
    const startedAt = Date.now()
    const result = await adapter.complete(request, connection, credential, signal)
    return { ...result, providerId: connection.provider_id, latencyMs: Date.now() - startedAt }
  }

  async listModels(connectionId, { accountConnectionId = null, refresh = false, signal } = {}) {
    const connection = this.getConnection(connectionId)
    const cached = this.db.raw.prepare('SELECT * FROM model_catalog_cache WHERE connection_id = ?').get(connectionId)
    if (!refresh && cached && Date.now() - Date.parse(cached.fetched_at) < this.config.modelCatalogTtlMs) {
      return { models: json(cached.catalog_json, []), cached: true, fetchedAt: cached.fetched_at }
    }
    const credential = this.resolveCredential(connection, accountConnectionId)
    const adapter = this.adapterFor(connection)
    const models = await adapter.listModels(connection, credential, signal)
    const fetchedAt = nowIso()
    this.db.raw.prepare(`
      INSERT INTO model_catalog_cache(connection_id, catalog_json, fetched_at) VALUES (?, ?, ?)
      ON CONFLICT(connection_id) DO UPDATE SET catalog_json = excluded.catalog_json, fetched_at = excluded.fetched_at
    `).run(connectionId, stableStringify(models), fetchedAt)
    return { models, cached: false, fetchedAt }
  }

  async listOpenRouterProviders(connectionId, options = {}) {
    const connection = this.getConnection(connectionId)
    assert(connection.provider_id === 'openrouter', 'Connection is not OpenRouter')
    const credential = this.resolveCredential(connection, options.accountConnectionId)
    const adapter = this.adapterFor(connection)
    return adapter.listProviders(connection, credential, options.signal)
  }

  #publicConnection(row) {
    const preset = row.provider_id === 'mock' ? { label: 'Built-in Demo', adapter: 'mock' } : providerPreset(row.provider_id)
    return {
      id: row.id,
      provider_id: row.provider_id,
      provider_label: preset?.label ?? row.provider_id,
      adapter: preset?.adapter ?? 'openai-compatible',
      label: row.label,
      base_url: row.base_url,
      default_model: row.default_model,
      has_api_key: Boolean(row.secret_envelope),
      key_preview: row.secret_envelope ? redact(this.vault.decrypt(row.secret_envelope)) : '',
      config: json(row.config_json, {}),
      enabled: Boolean(row.enabled),
      created_at: row.created_at,
      updated_at: row.updated_at,
    }
  }
}
