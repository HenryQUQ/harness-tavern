import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { id, json, nowIso, slugify, stableStringify } from '../util.js'

const MIGRATIONS = [
  {
    version: 1,
    sql: `
      CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value_json TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS provider_connections (
        id TEXT PRIMARY KEY, provider_id TEXT NOT NULL, label TEXT NOT NULL, base_url TEXT,
        default_model TEXT, secret_envelope TEXT, config_json TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS account_connections (
        id TEXT PRIMARY KEY, connector_id TEXT NOT NULL, label TEXT NOT NULL, secret_envelope TEXT NOT NULL,
        metadata_json TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS oauth_states (
        state TEXT PRIMARY KEY, connector_id TEXT NOT NULL, verifier_envelope TEXT NOT NULL,
        callback_url TEXT NOT NULL, created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS model_catalog_cache (
        connection_id TEXT PRIMARY KEY, catalog_json TEXT NOT NULL, fetched_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS characters (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL, personality TEXT NOT NULL,
        appearance TEXT NOT NULL, scenario TEXT NOT NULL, first_message TEXT NOT NULL,
        speech_style TEXT NOT NULL, goals_json TEXT NOT NULL, secrets_json TEXT NOT NULL,
        boundaries_json TEXT NOT NULL, extensions_json TEXT NOT NULL,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS personas (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL, style TEXT NOT NULL,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS stories (
        id TEXT PRIMARY KEY, title TEXT NOT NULL, summary TEXT NOT NULL, premise TEXT NOT NULL,
        genre TEXT NOT NULL, tone TEXT NOT NULL, opening_scene TEXT NOT NULL,
        world_rules_json TEXT NOT NULL, lore_json TEXT NOT NULL, initial_state_json TEXT NOT NULL,
        author_notes TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS story_cast (
        story_id TEXT NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
        character_id TEXT NOT NULL REFERENCES characters(id) ON DELETE RESTRICT,
        role TEXT NOT NULL, public_context TEXT NOT NULL, private_context TEXT NOT NULL,
        sort_order INTEGER NOT NULL, PRIMARY KEY (story_id, character_id)
      );
      CREATE TABLE IF NOT EXISTS conversations (
        id TEXT PRIMARY KEY, title TEXT NOT NULL, story_id TEXT REFERENCES stories(id) ON DELETE SET NULL,
        persona_id TEXT REFERENCES personas(id) ON DELETE SET NULL,
        connection_id TEXT REFERENCES provider_connections(id) ON DELETE SET NULL,
        account_connection_id TEXT REFERENCES account_connections(id) ON DELETE SET NULL,
        model_id TEXT NOT NULL, thinking_intensity TEXT NOT NULL, current_branch_id TEXT NOT NULL,
        route_json TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS branches (
        id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        parent_branch_id TEXT, fork_event_id INTEGER, label TEXT NOT NULL, created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY AUTOINCREMENT, event_uid TEXT NOT NULL UNIQUE,
        conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        branch_id TEXT NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
        type TEXT NOT NULL, actor_id TEXT, payload_json TEXT NOT NULL, created_at TEXT NOT NULL,
        idempotency_key TEXT, UNIQUE (conversation_id, branch_id, idempotency_key)
      );
      CREATE INDEX IF NOT EXISTS events_conversation_branch_id ON events(conversation_id, branch_id, id);
      CREATE TABLE IF NOT EXISTS audit_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT, action TEXT NOT NULL, subject_type TEXT NOT NULL,
        subject_id TEXT, metadata_json TEXT NOT NULL, created_at TEXT NOT NULL
      );
    `,
  },
  {
    version: 2,
    sql: `
      CREATE TABLE IF NOT EXISTS usage_ledger (
        id INTEGER PRIMARY KEY AUTOINCREMENT, conversation_id TEXT, turn_event_uid TEXT,
        provider_id TEXT NOT NULL, model_id TEXT NOT NULL, prompt_tokens INTEGER,
        completion_tokens INTEGER, reasoning_tokens INTEGER, total_tokens INTEGER,
        cost_usd REAL, raw_json TEXT NOT NULL, created_at TEXT NOT NULL
      );
    `,
  },
  {
    version: 3,
    sql: `
      ALTER TABLE characters ADD COLUMN slug TEXT;
      ALTER TABLE characters ADD COLUMN avatar_url TEXT NOT NULL DEFAULT '';
      ALTER TABLE characters ADD COLUMN tags_json TEXT NOT NULL DEFAULT '[]';
      ALTER TABLE characters ADD COLUMN creator_notes TEXT NOT NULL DEFAULT '';
      ALTER TABLE characters ADD COLUMN metadata_json TEXT NOT NULL DEFAULT '{}';

      ALTER TABLE personas ADD COLUMN slug TEXT;
      ALTER TABLE personas ADD COLUMN avatar_url TEXT NOT NULL DEFAULT '';
      ALTER TABLE personas ADD COLUMN metadata_json TEXT NOT NULL DEFAULT '{}';

      ALTER TABLE stories ADD COLUMN slug TEXT;
      ALTER TABLE stories ADD COLUMN hook TEXT NOT NULL DEFAULT '';
      ALTER TABLE stories ADD COLUMN cover_url TEXT NOT NULL DEFAULT '';
      ALTER TABLE stories ADD COLUMN player_role TEXT NOT NULL DEFAULT '';
      ALTER TABLE stories ADD COLUMN content_warnings_json TEXT NOT NULL DEFAULT '[]';
      ALTER TABLE stories ADD COLUMN tags_json TEXT NOT NULL DEFAULT '[]';
      ALTER TABLE stories ADD COLUMN scenes_json TEXT NOT NULL DEFAULT '[]';
      ALTER TABLE stories ADD COLUMN metadata_json TEXT NOT NULL DEFAULT '{}';
      ALTER TABLE stories ADD COLUMN share_policy_json TEXT NOT NULL DEFAULT '{}';
      ALTER TABLE stories ADD COLUMN revision INTEGER NOT NULL DEFAULT 1;
      ALTER TABLE stories ADD COLUMN visibility TEXT NOT NULL DEFAULT 'private';

      ALTER TABLE story_cast ADD COLUMN metadata_json TEXT NOT NULL DEFAULT '{}';

      ALTER TABLE conversations ADD COLUMN playthrough_id TEXT;
      ALTER TABLE conversations ADD COLUMN cast_state_json TEXT NOT NULL DEFAULT '{}';
      ALTER TABLE conversations ADD COLUMN generation_json TEXT NOT NULL DEFAULT '{}';
      ALTER TABLE conversations ADD COLUMN archived INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE conversations ADD COLUMN last_preview TEXT NOT NULL DEFAULT '';

      CREATE TABLE playthroughs (
        id TEXT PRIMARY KEY,
        story_id TEXT NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
        persona_id TEXT REFERENCES personas(id) ON DELETE SET NULL,
        title TEXT NOT NULL,
        player_role TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active',
        current_conversation_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX playthroughs_story_updated ON playthroughs(story_id, updated_at DESC);

      CREATE TABLE conversation_cast (
        conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        character_id TEXT NOT NULL REFERENCES characters(id) ON DELETE RESTRICT,
        role TEXT NOT NULL,
        public_context TEXT NOT NULL,
        private_context TEXT NOT NULL,
        sort_order INTEGER NOT NULL,
        muted INTEGER NOT NULL DEFAULT 0,
        spotlight INTEGER NOT NULL DEFAULT 0,
        metadata_json TEXT NOT NULL DEFAULT '{}',
        PRIMARY KEY (conversation_id, character_id)
      );

      CREATE TABLE creator_drafts (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        title TEXT NOT NULL,
        brief TEXT NOT NULL,
        data_json TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'draft',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX creator_drafts_updated ON creator_drafts(updated_at DESC);

      CREATE TABLE favorites (
        entity_type TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (entity_type, entity_id)
      );

      CREATE TABLE extensions (
        id TEXT PRIMARY KEY,
        slug TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        version TEXT NOT NULL,
        manifest_json TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        source TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE import_receipts (
        id TEXT PRIMARY KEY,
        pack_format TEXT NOT NULL,
        source_name TEXT NOT NULL,
        strategy TEXT NOT NULL,
        result_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE share_links (
        code TEXT PRIMARY KEY,
        entity_type TEXT NOT NULL,
        entity_id TEXT,
        pack_json TEXT NOT NULL,
        expires_at TEXT,
        created_at TEXT NOT NULL
      );

      CREATE UNIQUE INDEX characters_slug_unique ON characters(slug) WHERE slug IS NOT NULL;
      CREATE UNIQUE INDEX personas_slug_unique ON personas(slug) WHERE slug IS NOT NULL;
      CREATE UNIQUE INDEX stories_slug_unique ON stories(slug) WHERE slug IS NOT NULL;
    `,
  },
  {
    version: 4,
    sql: `
      CREATE TABLE IF NOT EXISTS content_shares (
        token_hash TEXT PRIMARY KEY,
        token_preview TEXT NOT NULL,
        resource_type TEXT NOT NULL,
        resource_id TEXT,
        scope TEXT NOT NULL DEFAULT 'preview',
        title TEXT NOT NULL,
        snapshot_json TEXT NOT NULL,
        expires_at TEXT,
        revoked_at TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS content_shares_resource ON content_shares(resource_type, resource_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS content_shares_expiry ON content_shares(expires_at);
    `,
  },
  {
    version: 5,
    sql: `
      ALTER TABLE conversations ADD COLUMN prompt_json TEXT NOT NULL DEFAULT '{}';

      CREATE TABLE generation_presets (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        settings_json TEXT NOT NULL,
        builtin INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      UPDATE provider_connections
        SET default_model = 'deepseek-chat'
        WHERE provider_id = 'deepseek' AND COALESCE(default_model, '') = '';
    `,
  },
  {
    version: 6,
    sql: `
      UPDATE provider_connections
        SET default_model = 'deepseek-v4-flash'
        WHERE provider_id = 'deepseek' AND COALESCE(default_model, '') IN ('', 'deepseek-chat');
    `,
  },
  {
    version: 7,
    sql: `
      CREATE TABLE story_sources (
        story_id TEXT PRIMARY KEY REFERENCES stories(id) ON DELETE CASCADE,
        story_key TEXT NOT NULL UNIQUE,
        source_path TEXT NOT NULL,
        source_kind TEXT NOT NULL,
        source_digest TEXT NOT NULL,
        source_version INTEGER NOT NULL,
        loaded_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        last_error TEXT
      );
      CREATE INDEX story_sources_updated ON story_sources(updated_at DESC);

      CREATE TABLE story_source_characters (
        story_id TEXT NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
        character_key TEXT NOT NULL,
        character_id TEXT NOT NULL REFERENCES characters(id) ON DELETE RESTRICT,
        PRIMARY KEY (story_id, character_key),
        UNIQUE (story_id, character_id)
      );
      CREATE INDEX story_source_characters_character ON story_source_characters(character_id);
    `,
  },
  {
    version: 8,
    sql: `
      ALTER TABLE stories ADD COLUMN runtime_json TEXT NOT NULL DEFAULT '{"actions":[],"agendas":[],"prompt_graph":{},"world_schema":{}}';

      ALTER TABLE events ADD COLUMN stream_version INTEGER;
      ALTER TABLE events ADD COLUMN causation_id TEXT;
      ALTER TABLE events ADD COLUMN correlation_id TEXT;
      ALTER TABLE events ADD COLUMN command_id TEXT;
      UPDATE events SET stream_version = id WHERE stream_version IS NULL;
      CREATE UNIQUE INDEX events_stream_version_unique
        ON events(conversation_id, branch_id, stream_version);
      CREATE INDEX events_command_id ON events(command_id) WHERE command_id IS NOT NULL;
      CREATE INDEX events_correlation_id ON events(correlation_id) WHERE correlation_id IS NOT NULL;

      CREATE TABLE control_loop_runs (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        branch_id TEXT NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
        command_id TEXT NOT NULL,
        status TEXT NOT NULL,
        phase TEXT NOT NULL,
        step_count INTEGER NOT NULL DEFAULT 0,
        input_json TEXT NOT NULL,
        result_json TEXT NOT NULL DEFAULT '{}',
        error_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(conversation_id, branch_id, command_id)
      );
      CREATE INDEX control_loop_runs_status ON control_loop_runs(status, updated_at);

      CREATE TABLE state_snapshots (
        conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        branch_id TEXT NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
        event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
        state_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY(conversation_id, branch_id, event_id)
      );

      CREATE TABLE migration_sessions (
        id TEXT PRIMARY KEY,
        source_type TEXT NOT NULL,
        source_name TEXT NOT NULL,
        source_digest TEXT NOT NULL,
        status TEXT NOT NULL,
        inventory_json TEXT NOT NULL,
        mapping_json TEXT NOT NULL DEFAULT '{}',
        result_json TEXT NOT NULL DEFAULT '{}',
        warnings_json TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX migration_sessions_updated ON migration_sessions(updated_at DESC);
    `,
  },
]

export class Database {
  constructor(path) {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
    this.path = path
    this.raw = new DatabaseSync(path)
    this.transactionDepth = 0
    this.savepointCounter = 0
    this.raw.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA busy_timeout = 5000;')
    this.migrate()
  }

  close() { this.raw.close() }

  migrate() {
    this.raw.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)')
    const applied = new Set(this.raw.prepare('SELECT version FROM schema_migrations').all().map(row => row.version))
    for (const migration of MIGRATIONS) {
      if (applied.has(migration.version)) continue
      this.transaction(() => {
        this.raw.exec(migration.sql)
        this.raw.prepare('INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)').run(migration.version, nowIso())
      })
    }
    this.#migrateLegacyModes()
    this.#backfillSlugs()
    this.#backfillConversationCast()
  }

  #migrateLegacyModes() {
    const columns = this.raw.prepare("PRAGMA table_info('conversations')").all().map(row => row.name)
    if (!columns.includes('mode')) return
    const rows = this.raw.prepare('SELECT id, mode, thinking_intensity FROM conversations').all()
    const map = { direct: 'low', stateful: 'medium', adaptive: 'auto', agentic: 'high' }
    for (const row of rows) {
      if (row.thinking_intensity && row.thinking_intensity !== 'medium') continue
      this.raw.prepare('UPDATE conversations SET thinking_intensity = ? WHERE id = ?').run(map[row.mode] || 'auto', row.id)
    }
  }

  #backfillSlugs() {
    for (const [table, label] of [['characters', 'name'], ['personas', 'name'], ['stories', 'title']]) {
      const rows = this.raw.prepare(`SELECT id, ${label} AS label, slug FROM ${table} ORDER BY created_at`).all()
      for (const row of rows) {
        if (row.slug) continue
        let candidate = slugify(row.label, table.slice(0, -1))
        let suffix = 2
        while (this.raw.prepare(`SELECT 1 FROM ${table} WHERE slug = ? AND id <> ?`).get(candidate, row.id)) {
          candidate = `${slugify(row.label, table.slice(0, -1))}-${suffix++}`
        }
        this.raw.prepare(`UPDATE ${table} SET slug = ? WHERE id = ?`).run(candidate, row.id)
      }
    }
  }

  #backfillConversationCast() {
    const conversations = this.raw.prepare(`
      SELECT c.id, c.story_id FROM conversations c
      WHERE c.story_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM conversation_cast cc WHERE cc.conversation_id = c.id
      )
    `).all()
    for (const conversation of conversations) {
      this.raw.prepare(`
        INSERT OR IGNORE INTO conversation_cast(
          conversation_id, character_id, role, public_context, private_context, sort_order, muted, spotlight, metadata_json
        )
        SELECT ?, character_id, role, public_context, private_context, sort_order, 0, 0, metadata_json
        FROM story_cast WHERE story_id = ? ORDER BY sort_order
      `).run(conversation.id, conversation.story_id)
    }
  }

  transaction(fn) {
    if (this.transactionDepth === 0) {
      this.raw.exec('BEGIN IMMEDIATE')
      this.transactionDepth += 1
      try {
        const result = fn()
        this.raw.exec('COMMIT')
        return result
      } catch (error) {
        try { this.raw.exec('ROLLBACK') } catch {}
        throw error
      } finally {
        this.transactionDepth -= 1
      }
    }
    const savepoint = `ht_sp_${++this.savepointCounter}`
    this.raw.exec(`SAVEPOINT ${savepoint}`)
    this.transactionDepth += 1
    try {
      const result = fn()
      this.raw.exec(`RELEASE SAVEPOINT ${savepoint}`)
      return result
    } catch (error) {
      try {
        this.raw.exec(`ROLLBACK TO SAVEPOINT ${savepoint}`)
        this.raw.exec(`RELEASE SAVEPOINT ${savepoint}`)
      } catch {}
      throw error
    } finally {
      this.transactionDepth -= 1
    }
  }

  getSetting(key, fallback = null) {
    const row = this.raw.prepare('SELECT value_json FROM settings WHERE key = ?').get(key)
    return row ? json(row.value_json, fallback) : fallback
  }

  setSetting(key, value) {
    this.raw.prepare(`
      INSERT INTO settings(key, value_json, updated_at) VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at
    `).run(key, stableStringify(value), nowIso())
  }

  uniqueSlug(table, value, currentId = null) {
    const allowed = new Set(['characters', 'personas', 'stories'])
    if (!allowed.has(table)) throw new Error('Unsupported slug table')
    const base = slugify(value, table.slice(0, -1))
    let candidate = base
    let suffix = 2
    while (this.raw.prepare(`SELECT 1 FROM ${table} WHERE slug = ? AND (? IS NULL OR id <> ?)`).get(candidate, currentId, currentId)) {
      candidate = `${base}-${suffix++}`
    }
    return candidate
  }

  appendEvent({
    conversationId,
    branchId,
    type,
    actorId = null,
    payload = {},
    idempotencyKey = null,
    causationId = null,
    correlationId = null,
    commandId = null,
    createdAt = null,
  }) {
    const eventUid = id('evt')
    try {
      const streamVersion = Number(this.raw.prepare(`
        SELECT COALESCE(MAX(stream_version), 0) + 1 AS next_version
        FROM events WHERE conversation_id = ? AND branch_id = ?
      `).get(conversationId, branchId).next_version)
      const result = this.raw.prepare(`
        INSERT INTO events(
          event_uid, conversation_id, branch_id, type, actor_id, payload_json, created_at,
          idempotency_key, stream_version, causation_id, correlation_id, command_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        eventUid, conversationId, branchId, type, actorId, stableStringify(payload), createdAt || nowIso(),
        idempotencyKey, streamVersion, causationId, correlationId, commandId,
      )
      return this.getEvent(Number(result.lastInsertRowid))
    } catch (error) {
      if (idempotencyKey && String(error.message).includes('UNIQUE')) {
        const existing = this.raw.prepare('SELECT * FROM events WHERE conversation_id = ? AND branch_id = ? AND idempotency_key = ?')
          .get(conversationId, branchId, idempotencyKey)
        if (existing) return this.#event(existing)
      }
      throw error
    }
  }

  getEvent(eventId) {
    const row = this.raw.prepare('SELECT * FROM events WHERE id = ?').get(eventId)
    return row ? this.#event(row) : null
  }

  listBranchEvents(conversationId, branchId) {
    const lineage = this.branchLineage(conversationId, branchId)
    const events = []
    for (let index = 0; index < lineage.length; index += 1) {
      const branch = lineage[index]
      const child = lineage[index + 1]
      const boundary = child?.fork_event_id ?? Number.MAX_SAFE_INTEGER
      const rows = this.raw.prepare('SELECT * FROM events WHERE conversation_id = ? AND branch_id = ? AND id <= ? ORDER BY id')
        .all(conversationId, branch.id, boundary)
      events.push(...rows.map(row => this.#event(row)))
    }
    return events
  }

  branchLineage(conversationId, branchId) {
    const reverse = []
    let current = this.raw.prepare('SELECT * FROM branches WHERE id = ? AND conversation_id = ?').get(branchId, conversationId)
    while (current) {
      reverse.push(current)
      current = current.parent_branch_id
        ? this.raw.prepare('SELECT * FROM branches WHERE id = ? AND conversation_id = ?').get(current.parent_branch_id, conversationId)
        : null
    }
    return reverse.reverse()
  }

  #event(row) {
    return { ...row, payload: json(row.payload_json, {}), payload_json: undefined }
  }

  audit(action, subjectType, subjectId = null, metadata = {}) {
    this.raw.prepare('INSERT INTO audit_log(action, subject_type, subject_id, metadata_json, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(action, subjectType, subjectId, stableStringify(metadata), nowIso())
  }

  integrityCheck() {
    return this.raw.prepare('PRAGMA integrity_check').all().map(row => Object.values(row)[0])
  }
}
