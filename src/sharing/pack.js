import { deflateRawSync, inflateRawSync } from 'node:zlib'
import { assert, cleanText, id, isExpired, json, nowIso, plainObject, randomToken, sha256Hex, stableStringify, uniqueStrings } from '../util.js'
import { EXTENSION_FORMAT, PACK_FORMAT, PACK_VERSION, PRODUCT_NAME, PRODUCT_VERSION } from '../version.js'

const MAX_TOKEN_BYTES = 500_000

function withoutIntegrity(pack) {
  const { integrity, ...content } = pack
  return content
}

function integrityPack(content) {
  const pack = {
    format: PACK_FORMAT,
    format_version: PACK_VERSION,
    exported_at: nowIso(),
    producer: { name: PRODUCT_NAME, version: PRODUCT_VERSION },
    ...structuredClone(content),
  }
  return { ...pack, integrity: { algorithm: 'sha256', digest: sha256Hex(stableStringify(pack)) } }
}

function verifyPack(pack) {
  assert(plainObject(pack), 'Import data must be a JSON object')
  assert(pack.format === PACK_FORMAT, `Pack format must be ${PACK_FORMAT}`)
  assert(Number(pack.format_version) === PACK_VERSION, `Unsupported pack format version: ${pack.format_version}`)
  if (pack.integrity?.digest) {
    const expected = sha256Hex(stableStringify(withoutIntegrity(pack)))
    assert(expected === pack.integrity.digest, 'Pack integrity check failed', 400, 'integrity_failed')
  }
  return pack
}

function publicCharacter(character) {
  return {
    id: character.id,
    slug: character.slug,
    name: character.name,
    description: character.description,
    personality: character.personality,
    appearance: character.appearance,
    scenario: character.scenario,
    first_message: character.first_message,
    speech_style: character.speech_style,
    goals: character.goals,
    secrets: character.secrets,
    boundaries: character.boundaries,
    extensions: character.extensions,
    avatar_url: character.avatar_url,
    tags: character.tags,
    creator_notes: character.creator_notes,
    metadata: character.metadata,
  }
}

function publicStory(story) {
  return {
    id: story.id,
    slug: story.slug,
    title: story.title,
    hook: story.hook,
    summary: story.summary,
    premise: story.premise,
    genre: story.genre,
    tone: story.tone,
    opening_scene: story.opening_scene,
    player_role: story.player_role,
    world_rules: story.world_rules,
    lore: story.lore,
    initial_state: story.initial_state,
    author_notes: story.author_notes,
    content_warnings: story.content_warnings,
    tags: story.tags,
    scenes: story.scenes,
    metadata: story.metadata,
    share_policy: story.share_policy,
    visibility: story.visibility,
    runtime: story.runtime,
    cast: story.cast.map(member => ({
      character_id: member.character_id,
      role: member.role,
      public_context: member.public_context,
      private_context: member.private_context,
      metadata: member.metadata,
    })),
  }
}

function remapReferences(value, mapping) {
  if (typeof value === 'string') {
    if (mapping[value]) return mapping[value]
    let output = value
    for (const [before, after] of Object.entries(mapping)) if (before && after && output.includes(before)) output = output.replaceAll(before, after)
    return output
  }
  if (Array.isArray(value)) return value.map(item => remapReferences(item, mapping))
  if (!plainObject(value)) return value
  return Object.fromEntries(Object.entries(value).map(([key, nested]) => [key, remapReferences(nested, mapping)]))
}

export function cardToCharacter(card) {
  const data = plainObject(card.data) ? card.data : card
  const harness = plainObject(data.extensions?.harness_tavern) ? data.extensions.harness_tavern : {}
  const name = cleanText(data.name, 120)
  assert(name, 'Character card is missing a name')
  const book = data.character_book ?? data.characterBook
  const bookEntries = Array.isArray(book?.entries) ? book.entries.map(entry => ({
    id: cleanText(String(entry.id ?? id('lore')), 160),
    title: cleanText(entry.comment || entry.name || 'Lore', 300),
    content: cleanText(entry.content, 10_000),
    keywords: uniqueStrings(entry.keys ?? entry.keywords, 50, 100),
    visibility: 'public',
  })) : []
  return {
    name,
    description: cleanText(data.description, 20_000),
    personality: cleanText(data.personality, 20_000),
    appearance: cleanText(data.appearance ?? harness.appearance, 10_000),
    scenario: cleanText(data.scenario, 20_000),
    first_message: cleanText(data.first_mes ?? data.first_message, 20_000),
    speech_style: cleanText(data.speech_style ?? data.post_history_instructions, 10_000),
    goals: uniqueStrings(data.goals ?? harness.goals, 50, 2000),
    secrets: uniqueStrings(data.secrets ?? harness.secrets, 50, 3000),
    boundaries: uniqueStrings(data.boundaries ?? harness.boundaries, 50, 3000),
    tags: uniqueStrings(data.tags, 50, 100),
    creator_notes: cleanText(data.creator_notes, 20_000),
    extensions: { ...(plainObject(data.extensions) ? data.extensions : {}), imported_lore: bookEntries },
    metadata: {
      ...(plainObject(harness.metadata) ? harness.metadata : {}),
      imported_from: card.spec || 'sillytavern-character-card',
      alternate_greetings: Array.isArray(data.alternate_greetings) ? data.alternate_greetings.slice(0, 50) : [],
      example_dialogue: cleanText(data.mes_example, 20_000),
      system_prompt: cleanText(data.system_prompt, 20_000),
    },
  }
}

export function characterToCardV2(character) {
  return {
    spec: 'chara_card_v2',
    spec_version: '2.0',
    data: {
      name: character.name,
      description: character.description,
      personality: character.personality,
      scenario: character.scenario,
      first_mes: character.first_message,
      mes_example: character.metadata?.example_dialogue || '',
      creator_notes: character.creator_notes,
      system_prompt: character.metadata?.system_prompt || '',
      post_history_instructions: character.speech_style,
      alternate_greetings: character.metadata?.alternate_greetings || [],
      tags: character.tags,
      creator: 'Harness Tavern',
      character_version: '1.0',
      extensions: {
        ...character.extensions,
        harness_tavern: {
          appearance: character.appearance,
          goals: character.goals,
          secrets: character.secrets,
          boundaries: character.boundaries,
          metadata: character.metadata,
        },
      },
    },
  }
}

export function characterToCardV3(character) {
  const v2 = characterToCardV2(character)
  return {
    spec: 'chara_card_v3',
    spec_version: '3.0',
    data: {
      ...v2.data,
      group_only_greetings: character.metadata?.group_only_greetings || [],
      nickname: character.metadata?.nickname || '',
      creator_notes_multilingual: character.metadata?.creator_notes_multilingual || {},
      source: Array.isArray(character.metadata?.source) ? character.metadata.source : [],
      creation_date: Math.floor(Date.parse(character.created_at || nowIso()) / 1000),
      modification_date: Math.floor(Date.parse(character.updated_at || nowIso()) / 1000),
      assets: Array.isArray(character.metadata?.assets) ? character.metadata.assets : [],
    },
  }
}

export class SharingService {
  constructor({ repository, extensions, storySources = null, config }) {
    this.repository = repository
    this.extensions = extensions
    this.storySources = storySources
    this.config = config
  }

  exportCharacter(characterId) {
    const character = this.repository.getCharacter(characterId)
    return integrityPack({ kind: 'character', title: character.name, items: { characters: [publicCharacter(character)], stories: [], personas: [] } })
  }

  exportStory(storyId) {
    const story = this.repository.getStory(storyId)
    const characters = story.cast.map(member => publicCharacter(member.character))
    return integrityPack({ kind: 'story', title: story.title, items: { characters, stories: [publicStory(story)], personas: [] } })
  }

  exportCollection({ character_ids = [], story_ids = [], persona_ids = [], title = 'Tavern collection' } = {}) {
    const storyObjects = story_ids.map(storyId => this.repository.getStory(storyId))
    const characterIds = new Set(character_ids)
    for (const story of storyObjects) for (const member of story.cast) characterIds.add(member.character_id)
    const characters = [...characterIds].map(characterId => publicCharacter(this.repository.getCharacter(characterId)))
    const stories = storyObjects.map(publicStory)
    const personas = persona_ids.map(personaId => {
      const persona = this.repository.getPersona(personaId)
      assert(persona, 'Persona not found', 404, 'not_found')
      return { id: persona.id, slug: persona.slug, name: persona.name, description: persona.description, style: persona.style, avatar_url: persona.avatar_url, metadata: persona.metadata }
    })
    return integrityPack({ kind: 'collection', title: cleanText(title, 200), items: { characters, stories, personas } })
  }

  #portableConversation(conversationId) {
    const conversation = this.repository.getConversation(conversationId)
    return {
      id: conversation.id,
      title: conversation.title,
      story_id: conversation.story_id,
      persona_id: conversation.persona_id,
      character_ids: this.repository.listConversationCast(conversation.id).map(member => member.character_id),
      thinking_intensity: conversation.thinking_intensity,
      generation: conversation.generation,
      prompt: conversation.prompt,
      events: this.repository.events(conversation.id).map(event => ({
        event_uid: event.event_uid,
        type: event.type,
        actor_id: event.actor_id,
        payload: event.payload,
        created_at: event.created_at,
        causation_id: event.causation_id,
        correlation_id: event.correlation_id,
        command_id: event.command_id,
      })),
      exported_branch_id: conversation.current_branch_id,
    }
  }

  exportConversation(conversationId) {
    const conversation = this.repository.getConversation(conversationId)
    const story = conversation.story_id ? this.repository.getStory(conversation.story_id) : null
    const characterIds = new Set(this.repository.listConversationCast(conversation.id).map(member => member.character_id))
    if (story) for (const member of story.cast) characterIds.add(member.character_id)
    const persona = conversation.persona_id ? this.repository.getPersona(conversation.persona_id) : null
    return integrityPack({
      kind: 'playthrough',
      title: conversation.title,
      items: {
        characters: [...characterIds].map(characterId => publicCharacter(this.repository.getCharacter(characterId))),
        stories: story ? [publicStory(story)] : [],
        personas: persona ? [persona] : [],
        conversations: [this.#portableConversation(conversation.id)],
      },
    })
  }

  exportBackup() {
    const profile = this.repository.getUserProfile()
    return integrityPack({
      kind: 'backup',
      title: `${profile.name || 'My'} Harness Tavern backup`,
      privacy: { credentials_included: false, provider_connections_included: false },
      user_profile: profile,
      generation_presets: this.repository.db.raw.prepare('SELECT name, description, settings_json FROM generation_presets WHERE builtin = 0 ORDER BY name').all()
        .map(row => ({ name: row.name, description: row.description, settings: json(row.settings_json, {}) })),
      items: {
        characters: this.repository.listCharacters().map(publicCharacter),
        stories: this.repository.listStories().map(publicStory),
        personas: this.repository.listPersonas(),
        conversations: this.repository.listConversations({ includeArchived: true }).map(item => this.#portableConversation(item.id)),
      },
    })
  }

  normalize(input) {
    let value = input
    if (typeof value === 'string') {
      try { value = JSON.parse(value) } catch { throw Object.assign(new Error('Import text is not valid JSON'), { status: 400, code: 'invalid_json' }) }
    }
    assert(plainObject(value), 'Import data must be a JSON object')
    if (value.format === PACK_FORMAT) return verifyPack(value)
    if (value.format === EXTENSION_FORMAT) return { format: EXTENSION_FORMAT, manifest: value }
    if (value.spec?.startsWith?.('chara_card_') || value.name || value.data?.name) {
      const character = cardToCharacter(value)
      return integrityPack({ kind: 'character', title: character.name, source_format: value.spec || 'legacy-character-card', items: { characters: [character], stories: [], personas: [] } })
    }
    throw Object.assign(new Error('Unsupported import format'), { status: 400, code: 'unsupported_import' })
  }

  preview(input) {
    const normalized = this.normalize(input)
    if (normalized.format === EXTENSION_FORMAT) {
      const manifest = normalized.manifest
      const existing = this.extensions.list().find(item => item.slug === manifest.slug)
      return { kind: 'extension', title: manifest.name, normalized, conflicts: existing ? [{ type: 'extension', existing_id: existing.id, slug: existing.slug }] : [], warnings: ['Extensions are declarative. JavaScript and executable code are never imported.'] }
    }
    const items = normalized.items ?? {}
    const conflicts = []
    for (const character of items.characters ?? []) {
      const existing = this.repository.listCharacters().find(item => item.slug === character.slug || item.name.toLocaleLowerCase() === String(character.name).toLocaleLowerCase())
      if (existing) conflicts.push({ type: 'character', source_id: character.id ?? null, existing_id: existing.id, name: character.name })
    }
    for (const story of items.stories ?? []) {
      const existing = this.repository.listStories().find(item => item.slug === story.slug || item.title.toLocaleLowerCase() === String(story.title).toLocaleLowerCase())
      if (existing) conflicts.push({ type: 'story', source_id: story.id ?? null, existing_id: existing.id, name: story.title })
    }
    return {
      kind: normalized.kind,
      title: normalized.title,
      normalized,
      counts: { characters: items.characters?.length ?? 0, stories: items.stories?.length ?? 0, personas: items.personas?.length ?? 0 },
      conflicts,
      warnings: conflicts.length ? ['Choose “Create copies” to keep both versions, or “Replace” to update matching content.'] : [],
    }
  }

  import(input, { strategy = 'copy', source_name = 'import', sync_sources = true } = {}) {
    assert(['copy', 'replace', 'skip'].includes(strategy), 'Import strategy must be copy, replace or skip')
    const preview = this.preview(input)
    if (preview.kind === 'extension') {
      const extension = this.extensions.install(preview.normalized.manifest, { source: source_name })
      const result = { extensions: [extension], characters: [], stories: [], personas: [], skipped: [] }
      return { result, receipt: this.repository.recordImport({ packFormat: EXTENSION_FORMAT, sourceName: source_name, strategy, result: { extension_id: extension.id } }) }
    }
    const pack = preview.normalized
    const result = { characters: [], stories: [], personas: [], conversations: [], presets: [], skipped: [], id_map: {} }
    const referenceMap = {}
    const completed = this.repository.db.transaction(() => {
      for (const source of pack.items?.characters ?? []) {
        const existing = this.repository.listCharacters().find(item => item.slug === source.slug || item.name.toLocaleLowerCase() === String(source.name).toLocaleLowerCase())
        if (existing && strategy === 'skip') {
          result.skipped.push({ type: 'character', name: source.name, existing_id: existing.id })
          result.id_map[source.id] = existing.id
          if (source.slug) referenceMap[source.slug] = existing.slug
          continue
        }
        const saved = existing && strategy === 'replace'
          ? this.repository.updateCharacter(existing.id, { ...source, id: undefined, slug: existing.slug })
          : this.repository.createCharacter({ ...source, id: undefined, slug: strategy === 'copy' ? undefined : source.slug })
        result.characters.push(saved)
        if (source.id) result.id_map[source.id] = saved.id
        if (source.id) referenceMap[source.id] = saved.id
        if (source.slug) referenceMap[source.slug] = saved.slug
      }
      for (const source of pack.items?.personas ?? []) {
        const existing = this.repository.listPersonas().find(item => item.slug === source.slug || item.name.toLocaleLowerCase() === String(source.name).toLocaleLowerCase())
        if (existing && strategy === 'skip') {
          result.skipped.push({ type: 'persona', name: source.name, existing_id: existing.id })
          result.id_map[source.id] = existing.id
          continue
        }
        const saved = existing && strategy === 'replace'
          ? this.repository.updatePersona(existing.id, { ...source, id: undefined, slug: existing.slug })
          : this.repository.createPersona({ ...source, id: undefined, slug: strategy === 'copy' ? undefined : source.slug })
        result.personas.push(saved)
        if (source.id) result.id_map[source.id] = saved.id
      }
      for (const source of pack.items?.stories ?? []) {
        const existing = this.repository.listStories().find(item => item.slug === source.slug || item.title.toLocaleLowerCase() === String(source.title).toLocaleLowerCase())
        if (existing && strategy === 'skip') {
          result.skipped.push({ type: 'story', name: source.title, existing_id: existing.id })
          result.id_map[source.id] = existing.id
          continue
        }
        const mapped = {
          ...source,
          id: undefined,
          slug: strategy === 'copy' ? undefined : source.slug,
          cast: (source.cast ?? []).map(member => ({ ...member, character_id: result.id_map[member.character_id] ?? member.character_id })),
          scenes: (source.scenes ?? []).map(scene => ({
            ...scene,
            active_character_ids: (scene.active_character_ids ?? []).map(characterId => result.id_map[characterId] ?? characterId),
          })),
          runtime: remapReferences(source.runtime ?? {}, { ...result.id_map, ...referenceMap }),
        }
        const saved = existing && strategy === 'replace'
          ? this.repository.updateStory(existing.id, { ...mapped, slug: existing.slug })
          : this.repository.createStory(mapped)
        result.stories.push(saved)
        if (source.id) result.id_map[source.id] = saved.id
      }
      for (const source of pack.items?.conversations ?? []) {
        const storyId = result.id_map[source.story_id] ?? null
        const personaId = result.id_map[source.persona_id] ?? null
        const characterIds = (source.character_ids ?? []).map(characterId => result.id_map[characterId]).filter(Boolean)
        if (!storyId && !characterIds.length) {
          result.skipped.push({ type: 'conversation', name: source.title, reason: 'No imported Story or Character matched this conversation.' })
          continue
        }
        const conversation = this.repository.createConversation({
          title: source.title,
          story_id: storyId,
          persona_id: personaId,
          character_ids: characterIds,
          thinking_intensity: source.thinking_intensity,
          generation: source.generation,
          prompt: source.prompt,
          skip_opening: true,
        })
        const eventUidMap = new Map()
        const correlationMap = new Map()
        const commandMap = new Map()
        const createdEvent = this.repository.events(conversation.id).find(event => event.type === 'conversation.created')
        const mapOpaqueId = (mapping, value, prefix) => {
          if (!value) return null
          if (!mapping.has(value)) mapping.set(value, id(prefix))
          return mapping.get(value)
        }
        for (const event of source.events ?? []) {
          if (event.type === 'conversation.created') {
            if (event.event_uid && createdEvent) eventUidMap.set(event.event_uid, createdEvent.event_uid)
            continue
          }
          const appended = this.repository.db.appendEvent({
            conversationId: conversation.id,
            branchId: conversation.current_branch_id,
            type: event.type,
            actorId: result.id_map[event.actor_id] ?? event.actor_id,
            payload: remapReferences(event.payload, { ...result.id_map, ...referenceMap }),
            createdAt: event.created_at,
            causationId: eventUidMap.get(event.causation_id) ?? null,
            correlationId: mapOpaqueId(correlationMap, event.correlation_id, 'corr'),
            commandId: mapOpaqueId(commandMap, event.command_id, 'cmd'),
          })
          if (event.event_uid) eventUidMap.set(event.event_uid, appended.event_uid)
        }
        this.repository.touchConversation(conversation.id, [...(source.events ?? [])].reverse().find(event => /\.message$/.test(event.type))?.payload?.content || '')
        result.conversations.push(this.repository.getConversation(conversation.id))
        if (source.id) result.id_map[source.id] = conversation.id
      }
      for (const source of pack.generation_presets ?? []) {
        try {
          const presetId = id('preset')
          const timestamp = nowIso()
          this.repository.db.raw.prepare(`
            INSERT INTO generation_presets(id, name, description, settings_json, builtin, created_at, updated_at)
            VALUES (?, ?, ?, ?, 0, ?, ?)
          `).run(presetId, cleanText(source.name, 120) || 'Imported preset', cleanText(source.description, 1000), stableStringify(source.settings ?? {}), timestamp, timestamp)
          result.presets.push(presetId)
        } catch (error) {
          result.skipped.push({ type: 'generation_preset', name: source.name, reason: error.message })
        }
      }
      if (pack.kind === 'backup' && plainObject(pack.user_profile)) this.repository.updateUserProfile(pack.user_profile)
      const receipt = this.repository.recordImport({
        packFormat: pack.source_format || pack.format,
        sourceName: source_name,
        strategy,
        result: { characters: result.characters.map(item => item.id), stories: result.stories.map(item => item.id), personas: result.personas.map(item => item.id), conversations: result.conversations.map(item => item.id), presets: result.presets, skipped: result.skipped },
      })
      return { result, receipt }
    })
    if (sync_sources) {
      const sourceSyncWarnings = []
      for (const character of result.characters) {
        try { this.storySources?.syncRuntimeCharacter(character.id, { character }) } catch (error) {
          sourceSyncWarnings.push({ type: 'character', id: character.id, message: error.message })
        }
      }
      for (const story of result.stories) {
        try { this.storySources?.syncRuntimeStory(story.id) } catch (error) {
          sourceSyncWarnings.push({ type: 'story', id: story.id, message: error.message })
        }
      }
      if (sourceSyncWarnings.length) {
        result.source_sync_warnings = sourceSyncWarnings
        completed.receipt.result.source_sync_warnings = sourceSyncWarnings
        this.repository.db.raw.prepare('UPDATE import_receipts SET result_json = ? WHERE id = ?')
          .run(stableStringify(completed.receipt.result), completed.receipt.id)
      }
    }
    return completed
  }

  encode(pack) {
    const normalized = this.normalize(pack)
    assert(normalized.format === PACK_FORMAT, 'Only Tavern content packs can be encoded as share links')
    const compressed = deflateRawSync(Buffer.from(stableStringify(normalized)))
    assert(compressed.length <= MAX_TOKEN_BYTES, 'This pack is too large for a share link; download the file instead', 413, 'share_too_large')
    return compressed.toString('base64url')
  }

  decode(token) {
    assert(typeof token === 'string' && token.length > 0 && token.length <= MAX_TOKEN_BYTES * 2, 'Invalid share token')
    let text
    try { text = inflateRawSync(Buffer.from(token, 'base64url')).toString('utf8') } catch {
      throw Object.assign(new Error('Share token is invalid or damaged'), { status: 400, code: 'invalid_share_token' })
    }
    return this.normalize(text)
  }

  createLink({ entity_type, entity_id, pack = null, expires_at = null }) {
    const content = pack ?? (entity_type === 'character' ? this.exportCharacter(entity_id) : this.exportStory(entity_id))
    const code = randomToken(9)
    this.repository.createShareLink({ code, entityType: entity_type || content.kind, entityId: entity_id, pack: content, expiresAt: expires_at })
    return { code, url: `${this.config.publicUrl.replace(/\/$/, '')}/?share=${encodeURIComponent(code)}#import`, pack: content }
  }

  resolveLink(code) {
    const link = this.repository.getShareLink(code)
    assert(!isExpired(link.expires_at), 'Share link has expired', 410, 'share_expired')
    return this.normalize(link.pack)
  }

  toCharacterCardV2(characterId) {
    const character = this.repository.getCharacter(characterId)
    return characterToCardV2(character)
  }

  toCharacterCardV3(characterId) {
    const character = this.repository.getCharacter(characterId)
    return characterToCardV3(character)
  }
}
