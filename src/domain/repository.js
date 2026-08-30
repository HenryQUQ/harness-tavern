import { assert, cleanText, id, json, nowIso, stableStringify, uniqueStrings } from '../util.js'
import { assertThinkingIntensity } from '../runtime/thinking.js'
import { normalizeStoryAgendas } from '../runtime/action-registry.js'
import { normalizeGeneration, normalizePrompt } from './generation-config.js'

function characterFromRow(row) {
  if (!row) return null
  return {
    ...row,
    goals: json(row.goals_json, []),
    secrets: json(row.secrets_json, []),
    boundaries: json(row.boundaries_json, []),
    extensions: json(row.extensions_json, {}),
    tags: json(row.tags_json, []),
    metadata: json(row.metadata_json, {}),
    goals_json: undefined,
    secrets_json: undefined,
    boundaries_json: undefined,
    extensions_json: undefined,
    tags_json: undefined,
    metadata_json: undefined,
  }
}

function personaFromRow(row) {
  if (!row) return null
  return {
    ...row,
    metadata: json(row.metadata_json, {}),
    metadata_json: undefined,
  }
}

function storyFromRow(row, cast = []) {
  if (!row) return null
  return {
    ...row,
    world_rules: json(row.world_rules_json, []),
    lore: json(row.lore_json, []),
    initial_state: json(row.initial_state_json, {}),
    content_warnings: json(row.content_warnings_json, []),
    tags: json(row.tags_json, []),
    scenes: json(row.scenes_json, []),
    metadata: json(row.metadata_json, {}),
    share_policy: json(row.share_policy_json, {}),
    runtime: json(row.runtime_json, { actions: [], agendas: [], prompt_graph: {}, world_schema: {} }),
    cast,
    world_rules_json: undefined,
    lore_json: undefined,
    initial_state_json: undefined,
    content_warnings_json: undefined,
    tags_json: undefined,
    scenes_json: undefined,
    metadata_json: undefined,
    share_policy_json: undefined,
    runtime_json: undefined,
  }
}

function conversationFromRow(row) {
  if (!row) return null
  return {
    ...row,
    archived: Boolean(row.archived),
    route: json(row.route_json, {}),
    cast_state: json(row.cast_state_json, {}),
    generation: normalizeGeneration(json(row.generation_json, {})),
    prompt: normalizePrompt(json(row.prompt_json, {})),
    route_json: undefined,
    cast_state_json: undefined,
    generation_json: undefined,
    prompt_json: undefined,
  }
}

function playthroughFromRow(row) {
  return row ? { ...row } : null
}

function draftFromRow(row) {
  return row ? { ...row, data: json(row.data_json, {}), data_json: undefined } : null
}

export class TavernRepository {
  constructor(db) { this.db = db }

  listCharacters() {
    return this.db.raw.prepare('SELECT * FROM characters ORDER BY name COLLATE NOCASE').all().map(characterFromRow)
  }

  getCharacter(characterId) {
    const row = this.db.raw.prepare('SELECT * FROM characters WHERE id = ? OR slug = ?').get(characterId, characterId)
    assert(row, 'Character not found', 404, 'not_found')
    return characterFromRow(row)
  }

  createCharacter(input) {
    const characterId = input.id || id('char')
    const timestamp = nowIso()
    const name = cleanText(input.name, 120)
    assert(name, 'Character name is required')
    const slug = this.db.uniqueSlug('characters', input.slug || name, characterId)
    this.db.raw.prepare(`
      INSERT INTO characters(
        id, name, description, personality, appearance, scenario, first_message, speech_style,
        goals_json, secrets_json, boundaries_json, extensions_json, created_at, updated_at,
        slug, avatar_url, tags_json, creator_notes, metadata_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      characterId, name, cleanText(input.description, 20_000), cleanText(input.personality, 20_000),
      cleanText(input.appearance, 10_000), cleanText(input.scenario, 20_000), cleanText(input.first_message, 20_000),
      cleanText(input.speech_style, 10_000), stableStringify(uniqueStrings(input.goals, 50, 2000)),
      stableStringify(uniqueStrings(input.secrets, 50, 3000)), stableStringify(uniqueStrings(input.boundaries, 50, 3000)),
      stableStringify(input.extensions ?? {}), timestamp, timestamp, slug, cleanText(input.avatar_url, 200_000),
      stableStringify(uniqueStrings(input.tags, 30, 100)), cleanText(input.creator_notes, 20_000),
      stableStringify(input.metadata ?? {}),
    )
    this.db.audit('character.created', 'character', characterId)
    return this.getCharacter(characterId)
  }

  updateCharacter(characterId, input) {
    const current = this.getCharacter(characterId)
    const merged = { ...current, ...input }
    const name = cleanText(merged.name, 120)
    assert(name, 'Character name is required')
    const slug = this.db.uniqueSlug('characters', merged.slug || name, current.id)
    this.db.raw.prepare(`
      UPDATE characters SET
        name=?, description=?, personality=?, appearance=?, scenario=?, first_message=?, speech_style=?,
        goals_json=?, secrets_json=?, boundaries_json=?, extensions_json=?, slug=?, avatar_url=?, tags_json=?,
        creator_notes=?, metadata_json=?, updated_at=? WHERE id=?
    `).run(
      name, cleanText(merged.description, 20_000), cleanText(merged.personality, 20_000), cleanText(merged.appearance, 10_000),
      cleanText(merged.scenario, 20_000), cleanText(merged.first_message, 20_000), cleanText(merged.speech_style, 10_000),
      stableStringify(uniqueStrings(merged.goals, 50, 2000)), stableStringify(uniqueStrings(merged.secrets, 50, 3000)),
      stableStringify(uniqueStrings(merged.boundaries, 50, 3000)), stableStringify(merged.extensions ?? {}), slug,
      cleanText(merged.avatar_url, 200_000), stableStringify(uniqueStrings(merged.tags, 30, 100)),
      cleanText(merged.creator_notes, 20_000), stableStringify(merged.metadata ?? {}), nowIso(), current.id,
    )
    this.db.audit('character.updated', 'character', current.id)
    return this.getCharacter(current.id)
  }

  deleteCharacter(characterId) {
    const character = this.getCharacter(characterId)
    const used = this.db.raw.prepare('SELECT COUNT(*) AS count FROM story_cast WHERE character_id = ?').get(character.id).count
      + this.db.raw.prepare('SELECT COUNT(*) AS count FROM conversation_cast WHERE character_id = ?').get(character.id).count
    assert(used === 0, 'Character is used by a story or conversation', 409, 'character_in_use')
    this.db.raw.prepare('DELETE FROM characters WHERE id = ?').run(character.id)
    this.db.audit('character.deleted', 'character', character.id)
  }

  listPersonas() {
    return this.db.raw.prepare('SELECT * FROM personas ORDER BY name COLLATE NOCASE').all().map(personaFromRow)
  }

  getPersona(personaId) {
    if (!personaId) return null
    return personaFromRow(this.db.raw.prepare('SELECT * FROM personas WHERE id = ? OR slug = ?').get(personaId, personaId))
  }

  createPersona(input) {
    const personaId = input.id || id('persona')
    const timestamp = nowIso()
    const name = cleanText(input.name, 120)
    assert(name, 'Persona name is required')
    const slug = this.db.uniqueSlug('personas', input.slug || name, personaId)
    this.db.raw.prepare(`
      INSERT INTO personas(id, name, description, style, created_at, updated_at, slug, avatar_url, metadata_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      personaId, name, cleanText(input.description, 10_000), cleanText(input.style, 5_000), timestamp, timestamp,
      slug, cleanText(input.avatar_url, 200_000), stableStringify(input.metadata ?? {}),
    )
    this.db.audit('persona.created', 'persona', personaId)
    return this.getPersona(personaId)
  }

  updatePersona(personaId, input) {
    const current = this.getPersona(personaId)
    assert(current, 'Persona not found', 404, 'not_found')
    const merged = { ...current, ...input }
    const name = cleanText(merged.name, 120)
    assert(name, 'Persona name is required')
    this.db.raw.prepare(`
      UPDATE personas SET name=?, description=?, style=?, slug=?, avatar_url=?, metadata_json=?, updated_at=? WHERE id=?
    `).run(
      name, cleanText(merged.description, 10_000), cleanText(merged.style, 5000),
      this.db.uniqueSlug('personas', merged.slug || name, current.id), cleanText(merged.avatar_url, 200_000),
      stableStringify(merged.metadata ?? {}), nowIso(), current.id,
    )
    this.db.audit('persona.updated', 'persona', current.id)
    return this.getPersona(current.id)
  }

  listStories() {
    return this.db.raw.prepare('SELECT * FROM stories ORDER BY updated_at DESC').all().map(row => storyFromRow(row, this.#storyCast(row.id)))
  }

  getStory(storyId) {
    const row = this.db.raw.prepare('SELECT * FROM stories WHERE id = ? OR slug = ?').get(storyId, storyId)
    assert(row, 'Story not found', 404, 'not_found')
    return storyFromRow(row, this.#storyCast(row.id))
  }

  createStory(input) {
    const storyId = input.id || id('story')
    const timestamp = nowIso()
    const title = cleanText(input.title, 200)
    assert(title, 'Story title is required')
    this.db.transaction(() => {
      this.db.raw.prepare(`
        INSERT INTO stories(
          id, title, summary, premise, genre, tone, opening_scene, world_rules_json, lore_json,
          initial_state_json, author_notes, created_at, updated_at, slug, hook, cover_url, player_role,
          content_warnings_json, tags_json, scenes_json, metadata_json, share_policy_json, revision, visibility,
          runtime_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        storyId, title, cleanText(input.summary, 4000), cleanText(input.premise, 30_000), cleanText(input.genre, 300),
        cleanText(input.tone, 1000), cleanText(input.opening_scene, 30_000), stableStringify(uniqueStrings(input.world_rules, 100, 3000)),
        stableStringify(Array.isArray(input.lore) ? input.lore.slice(0, 200) : []), stableStringify(input.initial_state ?? {}),
        cleanText(input.author_notes, 30_000), timestamp, timestamp, this.db.uniqueSlug('stories', input.slug || title, storyId),
        cleanText(input.hook || input.summary, 1000), cleanText(input.cover_url, 200_000), cleanText(input.player_role, 5000),
        stableStringify(uniqueStrings(input.content_warnings, 50, 500)), stableStringify(uniqueStrings(input.tags, 50, 100)),
        stableStringify(Array.isArray(input.scenes) ? input.scenes.slice(0, 100) : []), stableStringify(input.metadata ?? {}),
        stableStringify(input.share_policy ?? {}), Number.isInteger(input.revision) ? input.revision : 1,
        ['private', 'unlisted', 'public'].includes(input.visibility) ? input.visibility : 'private',
        stableStringify(input.runtime ?? { actions: [], agendas: [], prompt_graph: {}, world_schema: {} }),
      )
      this.#replaceStoryCast(storyId, input.cast ?? [])
    })
    this.db.audit('story.created', 'story', storyId, { cast_size: input.cast?.length ?? 0 })
    return this.getStory(storyId)
  }

  updateStory(storyId, input) {
    const current = this.getStory(storyId)
    const merged = { ...current, ...input }
    const title = cleanText(merged.title, 200)
    assert(title, 'Story title is required')
    this.db.transaction(() => {
      this.db.raw.prepare(`
        UPDATE stories SET title=?, summary=?, premise=?, genre=?, tone=?, opening_scene=?, world_rules_json=?,
          lore_json=?, initial_state_json=?, author_notes=?, slug=?, hook=?, cover_url=?, player_role=?,
          content_warnings_json=?, tags_json=?, scenes_json=?, metadata_json=?, share_policy_json=?, revision=?,
          visibility=?, runtime_json=?, updated_at=? WHERE id=?
      `).run(
        title, cleanText(merged.summary, 4000), cleanText(merged.premise, 30_000), cleanText(merged.genre, 300),
        cleanText(merged.tone, 1000), cleanText(merged.opening_scene, 30_000),
        stableStringify(uniqueStrings(merged.world_rules, 100, 3000)), stableStringify(Array.isArray(merged.lore) ? merged.lore.slice(0, 200) : []),
        stableStringify(merged.initial_state ?? {}), cleanText(merged.author_notes, 30_000),
        this.db.uniqueSlug('stories', merged.slug || title, current.id), cleanText(merged.hook || merged.summary, 1000),
        cleanText(merged.cover_url, 200_000), cleanText(merged.player_role, 5000),
        stableStringify(uniqueStrings(merged.content_warnings, 50, 500)), stableStringify(uniqueStrings(merged.tags, 50, 100)),
        stableStringify(Array.isArray(merged.scenes) ? merged.scenes.slice(0, 100) : []), stableStringify(merged.metadata ?? {}),
        stableStringify(merged.share_policy ?? {}), Number(current.revision || 1) + 1,
        ['private', 'unlisted', 'public'].includes(merged.visibility) ? merged.visibility : 'private',
        stableStringify(merged.runtime ?? { actions: [], agendas: [], prompt_graph: {}, world_schema: {} }),
        nowIso(), current.id,
      )
      if (input.cast !== undefined) this.#replaceStoryCast(current.id, input.cast)
    })
    this.db.audit('story.updated', 'story', current.id)
    return this.getStory(current.id)
  }

  deleteStory(storyId) {
    const story = this.getStory(storyId)
    const active = this.db.raw.prepare('SELECT COUNT(*) AS count FROM playthroughs WHERE story_id = ?').get(story.id).count
    assert(active === 0, 'Story has playthroughs; archive or duplicate it instead', 409, 'story_in_use')
    this.db.raw.prepare('DELETE FROM stories WHERE id = ?').run(story.id)
    this.db.audit('story.deleted', 'story', story.id)
  }

  #replaceStoryCast(storyId, cast) {
    this.db.raw.prepare('DELETE FROM story_cast WHERE story_id = ?').run(storyId)
    for (const [index, member] of (Array.isArray(cast) ? cast : []).entries()) {
      const character = this.getCharacter(member.character_id)
      this.db.raw.prepare(`
        INSERT INTO story_cast(story_id, character_id, role, public_context, private_context, sort_order, metadata_json)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        storyId, character.id, cleanText(member.role, 1000), cleanText(member.public_context, 10_000),
        cleanText(member.private_context, 10_000), index, stableStringify(member.metadata ?? {}),
      )
    }
  }

  #storyCast(storyId) {
    return this.db.raw.prepare(`
      SELECT sc.story_id, sc.character_id, sc.role, sc.public_context, sc.private_context, sc.sort_order,
             sc.metadata_json AS cast_metadata_json, c.*
      FROM story_cast sc JOIN characters c ON c.id = sc.character_id
      WHERE sc.story_id = ? ORDER BY sc.sort_order
    `).all(storyId).map(row => ({
      story_id: row.story_id,
      character_id: row.character_id,
      role: row.role,
      public_context: row.public_context,
      private_context: row.private_context,
      sort_order: row.sort_order,
      metadata: json(row.cast_metadata_json, {}),
      character: characterFromRow({ ...row, id: row.character_id }),
    }))
  }

  listPlaythroughs(storyId = null) {
    const rows = storyId
      ? this.db.raw.prepare('SELECT * FROM playthroughs WHERE story_id = ? ORDER BY updated_at DESC').all(storyId)
      : this.db.raw.prepare('SELECT * FROM playthroughs ORDER BY updated_at DESC').all()
    return rows.map(playthroughFromRow)
  }

  getPlaythrough(playthroughId) {
    const row = this.db.raw.prepare('SELECT * FROM playthroughs WHERE id = ?').get(playthroughId)
    assert(row, 'Playthrough not found', 404, 'not_found')
    return playthroughFromRow(row)
  }

  createPlaythrough(input) {
    const story = this.getStory(input.story_id)
    const persona = input.persona_id ? this.getPersona(input.persona_id) : null
    if (input.persona_id) assert(persona, 'Persona not found', 404, 'not_found')
    const playthroughId = input.id || id('play')
    const timestamp = nowIso()
    let conversation
    this.db.transaction(() => {
      this.db.raw.prepare(`
        INSERT INTO playthroughs(id, story_id, persona_id, title, player_role, status, current_conversation_id, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, 'active', NULL, ?, ?)
      `).run(
        playthroughId, story.id, persona?.id ?? null, cleanText(input.title || story.title, 200),
        cleanText(input.player_role || story.player_role, 5000), timestamp, timestamp,
      )
      conversation = this.createConversation({
        title: input.title || story.title,
        story_id: story.id,
        persona_id: persona?.id ?? null,
        playthrough_id: playthroughId,
        connection_id: input.connection_id,
        account_connection_id: input.account_connection_id,
        model_id: input.model_id,
        thinking_intensity: input.thinking_intensity ?? 'auto',
        generation: input.generation ?? {},
        prompt: input.prompt ?? {},
        route: input.route ?? {},
      })
      this.db.raw.prepare('UPDATE playthroughs SET current_conversation_id = ?, updated_at = ? WHERE id = ?')
        .run(conversation.id, nowIso(), playthroughId)
    })
    this.db.audit('playthrough.created', 'playthrough', playthroughId, { story_id: story.id })
    return { playthrough: this.getPlaythrough(playthroughId), conversation }
  }

  listConversations({ includeArchived = false } = {}) {
    const rows = this.db.raw.prepare(`
      SELECT * FROM conversations ${includeArchived ? '' : 'WHERE archived = 0'} ORDER BY updated_at DESC
    `).all()
    return rows.map(row => this.#conversation(row))
  }

  getConversation(conversationId) {
    const row = this.db.raw.prepare('SELECT * FROM conversations WHERE id = ?').get(conversationId)
    assert(row, 'Conversation not found', 404, 'not_found')
    return this.#conversation(row)
  }

  createConversation(input) {
    const conversationId = input.id || id('conv')
    const branchId = input.branch_id || id('branch')
    const timestamp = nowIso()
    const intensity = assertThinkingIntensity(String(input.thinking_intensity ?? 'auto').toLowerCase())
    const story = input.story_id ? this.getStory(input.story_id) : null
    if (input.persona_id) assert(this.getPersona(input.persona_id), 'Persona not found', 404, 'not_found')
    if (input.playthrough_id) this.getPlaythrough(input.playthrough_id)
    const explicitCharacterIds = uniqueStrings(input.character_ids, 20, 200)
    const defaultConnection = input.connection_id
      ? this.db.raw.prepare('SELECT * FROM provider_connections WHERE id = ?').get(input.connection_id)
      : this.db.raw.prepare("SELECT * FROM provider_connections WHERE enabled = 1 ORDER BY CASE WHEN provider_id = 'mock' THEN 1 ELSE 0 END, created_at LIMIT 1").get()
    if (input.connection_id) assert(defaultConnection, 'Provider connection not found', 404, 'not_found')
    assert(defaultConnection?.enabled, 'Choose an enabled AI service before starting a conversation', 409, 'connection_required')
    const title = cleanText(input.title || story?.title || (explicitCharacterIds[0] ? this.getCharacter(explicitCharacterIds[0]).name : 'New conversation'), 200)
    const generation = normalizeGeneration(input.generation)
    const prompt = normalizePrompt(input.prompt)
    const modelId = cleanText(input.model_id || defaultConnection.default_model || (defaultConnection.provider_id === 'mock' ? 'mock/roleplay-ensemble' : ''), 300)
    assert(modelId, 'Choose a model before starting a conversation', 409, 'model_required')
    this.db.transaction(() => {
      this.db.raw.prepare(`
        INSERT INTO conversations(
          id, title, story_id, persona_id, connection_id, account_connection_id, model_id,
          thinking_intensity, current_branch_id, route_json, created_at, updated_at,
          playthrough_id, cast_state_json, generation_json, prompt_json, archived, last_preview
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '{}', ?, ?, 0, '')
      `).run(
        conversationId, title, story?.id ?? null, input.persona_id ?? null, defaultConnection?.id ?? null,
        input.account_connection_id ?? null, modelId,
        intensity, branchId, stableStringify(input.route ?? {}), timestamp, timestamp, input.playthrough_id ?? null,
        stableStringify(generation), stableStringify(prompt),
      )
      this.db.raw.prepare('INSERT INTO branches(id, conversation_id, parent_branch_id, fork_event_id, label, created_at) VALUES (?, ?, NULL, NULL, ?, ?)')
        .run(branchId, conversationId, 'Main timeline', timestamp)
      if (story) {
        this.db.raw.prepare(`
          INSERT INTO conversation_cast(
            conversation_id, character_id, role, public_context, private_context, sort_order, muted, spotlight, metadata_json
          ) SELECT ?, character_id, role, public_context, private_context, sort_order, 0, 0, metadata_json
            FROM story_cast WHERE story_id = ? ORDER BY sort_order
        `).run(conversationId, story.id)
      } else {
        for (const [index, characterId] of explicitCharacterIds.entries()) {
          const character = this.getCharacter(characterId)
          this.db.raw.prepare(`
            INSERT INTO conversation_cast(conversation_id, character_id, role, public_context, private_context, sort_order, muted, spotlight, metadata_json)
            VALUES (?, ?, ?, '', '', ?, 0, 0, '{}')
          `).run(conversationId, character.id, 'Conversation partner', index)
        }
      }
      this.db.appendEvent({
        conversationId, branchId, type: 'conversation.created',
        payload: { title, story_id: story?.id ?? null, playthrough_id: input.playthrough_id ?? null, thinking_intensity: intensity },
      })
      if (!input.skip_opening) this.#appendOpening(conversationId, branchId, story)
    })
    this.db.audit('conversation.created', 'conversation', conversationId)
    return this.getConversation(conversationId)
  }

  #appendOpening(conversationId, branchId, story) {
    const cast = this.listConversationCast(conversationId)
    if (story) {
      for (const agenda of normalizeStoryAgendas(story, cast)) {
        this.db.appendEvent({ conversationId, branchId, type: 'agenda.created', actorId: agenda.owner_id, payload: agenda })
      }
    }
    const firstScene = story?.scenes?.[0]
    if (firstScene) {
      this.db.appendEvent({
        conversationId, branchId, type: 'scene.changed',
        payload: { id: firstScene.id || 'opening', title: firstScene.title || 'Opening scene', location: firstScene.location || '', time: firstScene.time || '' },
      })
    }
    if (story?.opening_scene) {
      this.db.appendEvent({ conversationId, branchId, type: 'assistant.message', actorId: 'narrator', payload: { content: story.opening_scene, metadata: { opening: true } } })
    }
    for (const member of cast) {
      if (!member.character.first_message) continue
      this.db.appendEvent({
        conversationId, branchId, type: 'assistant.message', actorId: member.character_id,
        payload: { content: member.character.first_message, metadata: { opening: true, character_id: member.character_id } },
      })
    }
  }

  updateConversation(conversationId, input) {
    const current = this.getConversation(conversationId)
    const intensity = input.thinking_intensity === undefined
      ? current.thinking_intensity
      : assertThinkingIntensity(String(input.thinking_intensity).toLowerCase())
    const connectionId = input.connection_id === undefined ? current.connection_id : input.connection_id
    const connection = this.db.raw.prepare('SELECT * FROM provider_connections WHERE id = ?').get(connectionId)
    assert(connection, 'Provider connection not found', 404, 'not_found')
    assert(connection.enabled, 'Provider connection is disabled', 409, 'connection_disabled')
    const connectionChanged = connectionId !== current.connection_id
    const modelId = cleanText(input.model_id === undefined ? (connectionChanged ? connection.default_model : current.model_id) : input.model_id, 300)
    assert(modelId, 'Choose a model for this AI service', 409, 'model_required')
    const generation = normalizeGeneration(input.generation ?? {}, current.generation)
    const prompt = normalizePrompt(input.prompt ?? {}, current.prompt)
    this.db.raw.prepare(`
      UPDATE conversations SET title=?, persona_id=?, connection_id=?, account_connection_id=?, model_id=?,
        thinking_intensity=?, route_json=?, generation_json=?, prompt_json=?, archived=?, updated_at=? WHERE id=?
    `).run(
      cleanText(input.title ?? current.title, 200), input.persona_id === undefined ? current.persona_id : input.persona_id,
      connectionId,
      input.account_connection_id === undefined ? current.account_connection_id : input.account_connection_id,
      modelId, intensity,
      stableStringify(input.route === undefined ? current.route : input.route ?? {}), stableStringify(generation), stableStringify(prompt),
      input.archived === undefined ? Number(current.archived) : input.archived ? 1 : 0, nowIso(), current.id,
    )
    return this.getConversation(current.id)
  }

  deleteConversation(conversationId) {
    const conversation = this.getConversation(conversationId)
    this.db.transaction(() => {
      this.db.raw.prepare('DELETE FROM usage_ledger WHERE conversation_id = ?').run(conversation.id)
      this.db.raw.prepare("DELETE FROM favorites WHERE entity_type = 'conversation' AND entity_id = ?").run(conversation.id)
      this.db.raw.prepare("DELETE FROM content_shares WHERE resource_type = 'conversation' AND resource_id = ?").run(conversation.id)
      this.db.raw.prepare("DELETE FROM share_links WHERE entity_type = 'conversation' AND entity_id = ?").run(conversation.id)
      this.db.raw.prepare('DELETE FROM conversations WHERE id = ?').run(conversation.id)
      if (conversation.playthrough_id) {
        const remaining = this.db.raw.prepare('SELECT 1 FROM conversations WHERE playthrough_id = ? LIMIT 1').get(conversation.playthrough_id)
        if (!remaining) this.db.raw.prepare('DELETE FROM playthroughs WHERE id = ?').run(conversation.playthrough_id)
      }
    })
    this.db.audit('conversation.deleted', 'conversation', conversation.id, { model_id: conversation.model_id })
    return { deleted: true, id: conversation.id }
  }

  touchConversation(conversationId, preview = null) {
    if (preview === null) this.db.raw.prepare('UPDATE conversations SET updated_at = ? WHERE id = ?').run(nowIso(), conversationId)
    else this.db.raw.prepare('UPDATE conversations SET updated_at = ?, last_preview = ? WHERE id = ?')
      .run(nowIso(), cleanText(preview, 500), conversationId)
    const conversation = this.getConversation(conversationId)
    if (conversation.playthrough_id) {
      this.db.raw.prepare('UPDATE playthroughs SET current_conversation_id = ?, updated_at = ? WHERE id = ?')
        .run(conversationId, nowIso(), conversation.playthrough_id)
    }
  }

  listConversationCast(conversationId) {
    this.getConversation(conversationId)
    return this.db.raw.prepare(`
      SELECT cc.conversation_id, cc.character_id, cc.role, cc.public_context, cc.private_context,
             cc.sort_order, cc.muted, cc.spotlight, cc.metadata_json AS cast_metadata_json, c.*
      FROM conversation_cast cc JOIN characters c ON c.id = cc.character_id
      WHERE cc.conversation_id = ? ORDER BY cc.sort_order
    `).all(conversationId).map(row => ({
      conversation_id: row.conversation_id,
      character_id: row.character_id,
      role: row.role,
      public_context: row.public_context,
      private_context: row.private_context,
      sort_order: row.sort_order,
      muted: Boolean(row.muted),
      spotlight: Boolean(row.spotlight),
      metadata: json(row.cast_metadata_json, {}),
      character: characterFromRow({ ...row, id: row.character_id }),
    }))
  }

  updateConversationCast(conversationId, characterId, input) {
    this.getConversation(conversationId)
    const row = this.db.raw.prepare('SELECT * FROM conversation_cast WHERE conversation_id = ? AND character_id = ?').get(conversationId, characterId)
    assert(row, 'Character is not in this conversation', 404, 'not_found')
    this.db.transaction(() => {
      if (input.spotlight === true) this.db.raw.prepare('UPDATE conversation_cast SET spotlight = 0 WHERE conversation_id = ?').run(conversationId)
      this.db.raw.prepare(`
        UPDATE conversation_cast SET muted=?, spotlight=?, role=?, public_context=?, private_context=?, metadata_json=?
        WHERE conversation_id=? AND character_id=?
      `).run(
        input.muted === undefined ? row.muted : input.muted ? 1 : 0,
        input.spotlight === undefined ? row.spotlight : input.spotlight ? 1 : 0,
        cleanText(input.role ?? row.role, 1000), cleanText(input.public_context ?? row.public_context, 10_000),
        cleanText(input.private_context ?? row.private_context, 10_000),
        stableStringify(input.metadata ?? json(row.metadata_json, {})), conversationId, characterId,
      )
    })
    this.db.audit('conversation.cast.updated', 'conversation', conversationId, { character_id: characterId })
    return this.listConversationCast(conversationId)
  }

  listBranches(conversationId) {
    this.getConversation(conversationId)
    return this.db.raw.prepare('SELECT * FROM branches WHERE conversation_id = ? ORDER BY created_at').all(conversationId)
  }

  forkBranch(conversationId, { source_branch_id, fork_event_id = null, label = 'What if…' }) {
    const conversation = this.getConversation(conversationId)
    const source = this.db.raw.prepare('SELECT * FROM branches WHERE id = ? AND conversation_id = ?')
      .get(source_branch_id || conversation.current_branch_id, conversationId)
    assert(source, 'Source timeline not found', 404, 'not_found')
    const events = this.db.listBranchEvents(conversationId, source.id)
    const boundary = fork_event_id === null ? events.at(-1)?.id ?? null : Number(fork_event_id)
    if (boundary !== null) assert(events.some(event => event.id === boundary), 'Fork event is not visible on source timeline')
    const branchId = id('branch')
    this.db.raw.prepare('INSERT INTO branches(id, conversation_id, parent_branch_id, fork_event_id, label, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(branchId, conversationId, source.id, boundary, cleanText(label, 200) || 'What if…', nowIso())
    this.db.audit('branch.created', 'branch', branchId, { conversation_id: conversationId, source_branch_id: source.id, fork_event_id: boundary })
    return this.switchBranch(conversationId, branchId)
  }

  switchBranch(conversationId, branchId) {
    const branch = this.db.raw.prepare('SELECT * FROM branches WHERE id = ? AND conversation_id = ?').get(branchId, conversationId)
    assert(branch, 'Timeline not found', 404, 'not_found')
    this.db.raw.prepare('UPDATE conversations SET current_branch_id = ?, updated_at = ? WHERE id = ?').run(branchId, nowIso(), conversationId)
    return { conversation: this.getConversation(conversationId), branch }
  }

  events(conversationId, branchId = null) {
    const conversation = this.getConversation(conversationId)
    return this.db.listBranchEvents(conversationId, branchId || conversation.current_branch_id)
  }

  getUserProfile() {
    return this.db.getSetting('user.profile', {
      name: '', avatar_url: '', bio: '', onboarding_complete: false,
      default_persona_id: null, locale: 'en', experience_level: 'simple',
    })
  }

  updateUserProfile(input) {
    const current = this.getUserProfile()
    const profile = {
      ...current,
      ...(input.name !== undefined ? { name: cleanText(input.name, 120) } : {}),
      ...(input.avatar_url !== undefined ? { avatar_url: cleanText(input.avatar_url, 200_000) } : {}),
      ...(input.bio !== undefined ? { bio: cleanText(input.bio, 5000) } : {}),
      ...(input.default_persona_id !== undefined ? { default_persona_id: input.default_persona_id || null } : {}),
      ...(input.locale !== undefined ? { locale: cleanText(input.locale, 20) || 'en' } : {}),
      ...(input.experience_level !== undefined ? { experience_level: ['simple', 'advanced'].includes(input.experience_level) ? input.experience_level : 'simple' } : {}),
      ...(input.onboarding_complete !== undefined ? { onboarding_complete: Boolean(input.onboarding_complete) } : {}),
    }
    if (input.sync_default_persona && profile.default_persona_id && profile.name) {
      const persona = this.getPersona(profile.default_persona_id)
      if (persona) {
        this.updatePersona(persona.id, {
          name: profile.name,
          description: input.persona_description ?? persona.description,
        })
      }
    }
    this.db.setSetting('user.profile', profile)
    return profile
  }

  setFavorite(entityType, entityId, favorite = true) {
    assert(['character', 'story', 'conversation'].includes(entityType), 'Unsupported favorite type')
    if (favorite) {
      this.db.raw.prepare('INSERT OR IGNORE INTO favorites(entity_type, entity_id, created_at) VALUES (?, ?, ?)')
        .run(entityType, entityId, nowIso())
    } else {
      this.db.raw.prepare('DELETE FROM favorites WHERE entity_type = ? AND entity_id = ?').run(entityType, entityId)
    }
    return { entity_type: entityType, entity_id: entityId, favorite: Boolean(favorite) }
  }

  listFavorites() {
    return this.db.raw.prepare('SELECT * FROM favorites ORDER BY created_at DESC').all()
  }

  getHome() {
    const favorites = this.listFavorites()
    const favoriteKeys = new Set(favorites.map(item => `${item.entity_type}:${item.entity_id}`))
    const recent = this.listConversations().slice(0, 8).map(conversation => {
      const cast = this.listConversationCast(conversation.id)
      const story = conversation.story_id ? this.getStory(conversation.story_id) : null
      return {
        ...conversation,
        display_title: conversation.title,
        subtitle: story?.hook || story?.summary || cast.map(member => member.character.name).join(', '),
        current_scene: this.#currentScene(conversation.id),
        cast: cast.map(member => ({ id: member.character_id, name: member.character.name, avatar_url: member.character.avatar_url })),
        favorite: favoriteKeys.has(`conversation:${conversation.id}`),
      }
    })
    return {
      continue: recent,
      characters: this.listCharacters().map(item => ({ ...item, favorite: favoriteKeys.has(`character:${item.id}`) }))
        .sort((a, b) => Number(b.favorite) - Number(a.favorite) || b.updated_at.localeCompare(a.updated_at)).slice(0, 8),
      stories: this.listStories().map(item => ({ ...item, favorite: favoriteKeys.has(`story:${item.id}`), playthroughs: this.listPlaythroughs(item.id) }))
        .sort((a, b) => Number(b.favorite) - Number(a.favorite) || b.updated_at.localeCompare(a.updated_at)).slice(0, 8),
      drafts: this.listDrafts().slice(0, 4),
    }
  }

  #currentScene(conversationId) {
    const events = this.events(conversationId)
    return [...events].reverse().find(event => event.type === 'scene.changed')?.payload ?? null
  }

  listDrafts(type = null) {
    const rows = type
      ? this.db.raw.prepare('SELECT * FROM creator_drafts WHERE type = ? ORDER BY updated_at DESC').all(type)
      : this.db.raw.prepare('SELECT * FROM creator_drafts ORDER BY updated_at DESC').all()
    return rows.map(draftFromRow)
  }

  getDraft(draftId) {
    const row = this.db.raw.prepare('SELECT * FROM creator_drafts WHERE id = ?').get(draftId)
    assert(row, 'Draft not found', 404, 'not_found')
    return draftFromRow(row)
  }

  saveDraft({ id: draftId = null, type, title, brief = '', data = {}, status = 'draft' }) {
    assert(['character', 'story'].includes(type), 'Draft type must be character or story')
    const existing = draftId ? this.db.raw.prepare('SELECT * FROM creator_drafts WHERE id = ?').get(draftId) : null
    const draft = draftId || id('draft')
    const timestamp = nowIso()
    this.db.raw.prepare(`
      INSERT INTO creator_drafts(id, type, title, brief, data_json, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET title=excluded.title, brief=excluded.brief, data_json=excluded.data_json,
        status=excluded.status, updated_at=excluded.updated_at
    `).run(
      draft, type, cleanText(title || data.name || data.title || 'Untitled draft', 200), cleanText(brief, 10_000),
      stableStringify(data), ['draft', 'published', 'archived'].includes(status) ? status : 'draft',
      existing?.created_at ?? timestamp, timestamp,
    )
    return this.getDraft(draft)
  }

  deleteDraft(draftId) {
    const result = this.db.raw.prepare('DELETE FROM creator_drafts WHERE id = ?').run(draftId)
    assert(result.changes > 0, 'Draft not found', 404, 'not_found')
  }

  recordImport({ packFormat, sourceName, strategy, result }) {
    const receiptId = id('import')
    this.db.raw.prepare(`
      INSERT INTO import_receipts(id, pack_format, source_name, strategy, result_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(receiptId, packFormat, cleanText(sourceName, 500), strategy, stableStringify(result), nowIso())
    return { id: receiptId, pack_format: packFormat, source_name: sourceName, strategy, result, created_at: nowIso() }
  }

  listImports() {
    return this.db.raw.prepare('SELECT * FROM import_receipts ORDER BY created_at DESC LIMIT 100').all()
      .map(row => ({ ...row, result: json(row.result_json, {}), result_json: undefined }))
  }

  createShareLink({ code, entityType, entityId = null, pack, expiresAt = null }) {
    this.db.raw.prepare(`
      INSERT INTO share_links(code, entity_type, entity_id, pack_json, expires_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(code) DO UPDATE SET pack_json=excluded.pack_json, expires_at=excluded.expires_at
    `).run(code, entityType, entityId, stableStringify(pack), expiresAt, nowIso())
    return this.getShareLink(code)
  }

  getShareLink(code) {
    const row = this.db.raw.prepare('SELECT * FROM share_links WHERE code = ?').get(code)
    assert(row, 'Share link not found', 404, 'not_found')
    return { ...row, pack: json(row.pack_json, {}), pack_json: undefined }
  }

  #conversation(row) {
    return conversationFromRow(row)
  }
}
