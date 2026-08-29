import { OpenRouterOAuthConnector } from './openrouter-oauth.js'
import { assert, json, redact } from '../util.js'

export class AccountConnectionRegistry {
  constructor({ db, vault, config }) {
    this.db = db
    this.vault = vault
    this.connectors = new Map()
    this.register(new OpenRouterOAuthConnector({ db, vault, publicUrl: config.publicUrl, timeoutMs: Math.min(config.providerTimeoutMs, 30_000) }))
  }

  register(connector) { this.connectors.set(connector.id, connector) }
  descriptors() { return [...this.connectors.values()].map(connector => connector.descriptor()) }

  begin(connectorId, options = {}) {
    const connector = this.connectors.get(connectorId)
    assert(connector, 'Account connector not found', 404, 'not_found')
    return connector.begin(options)
  }

  async complete(connectorId, input) {
    const connector = this.connectors.get(connectorId)
    assert(connector, 'Account connector not found', 404, 'not_found')
    return connector.complete(input)
  }

  list() {
    return this.db.raw.prepare('SELECT * FROM account_connections ORDER BY created_at').all().map(row => ({
      id: row.id,
      connector_id: row.connector_id,
      label: row.label,
      key_preview: redact(this.vault.decrypt(row.secret_envelope)),
      metadata: json(row.metadata_json, {}),
      created_at: row.created_at,
      updated_at: row.updated_at,
    }))
  }

  remove(accountId) {
    const result = this.db.raw.prepare('DELETE FROM account_connections WHERE id = ?').run(accountId)
    assert(result.changes > 0, 'Account connection not found', 404, 'not_found')
    this.db.audit('account.connection.deleted', 'account_connection', accountId)
  }
}
