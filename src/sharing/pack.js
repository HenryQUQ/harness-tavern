import { deflateRawSync, inflateRawSync } from 'node:zlib'
import { assert, cleanText, id, isExpired, json, nowIso, plainObject, randomToken, sha256Hex, stableStringify, uniqueStrings } from '../util.js'
import { EXTENSION_FORMAT, PACK_FORMAT, PACK_VERSION, PRODUCT_NAME, PRODUCT_VERSION } from '../version.js'

const MAX_TOKEN_BYTES = 500_000

function withoutIntegrity(pack) {
  const { integrity, ...content } = pack
  return content
}

function signedPack(content) {
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
    cast: story.cast.map(member => ({
      character_id: member.character_id,
      role: member.role,
      public_context: member.public_context,
      private_context: member.private_context,
      metadata: member.metadata,
    })),
  }
}

function cardToCharacter(card) {
  const data = plainObject(card.data) ? card.data : card
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
    appearance: cleanText(data.appearance, 10_000),
    scenario: cleanText(data.scenario, 20_000),
    first_message: cleanText(data.first_mes ?? data.first_message, 20_000),
    speech_style: cleanText(data.speech_style ?? data.post_history_instructions, 10_000),
    goals: uniqueStrings(data.goals, 50, 2000),
    secrets: uniqueStrings(data.secrets, 50, 3000),
    boundaries: uniqueStrings(data.boundaries, 50, 3000),
    tags: uniqueStrings(data.tags, 50, 100),
    creator_notes: cleanText(data.creator_notes, 20_000),
    extensions: { ...(plainObject(data.extensions) ? data.extensions : {}), imported_lore: bookEntries },
    metadata: {
      imported_from: card.spec || 'sillytavern-character-card',
      alternate_greetings: Array.isArray(data.alternate_greetings) ? data.alternate_greetings.slice(0, 50) : [],
      example_dialogue: cleanText(data.mes_example, 20_000),
      system_prompt: cleanText(data.system_prompt, 20_000),
    },
  }
}

export class SharingService {
  constructor({ repository, extensions, config }) {
    this.repository = repository
    this.extensions = extensions
    this.config = config
  }

  exportCharacter(characterId) {
    const character = this.repository.getCharacter(characterId)
    return signedPack({ kind: 'character', title: character.name, items: { characters: [publicCharacter(character)], stories: [], personas: [] } })
  }

  exportStory(storyId) {
    const story = this.repository.getStory(storyId)
    const characters = story.cast.map(member => publicCharacter(member.character))
    return signedPack({ kind: 'story', title: story.title, items: { characters, stories: [publicStory(story)], personas: [] } })
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
    return signedPack({ kind: 'collection', title: cleanText(title, 200), items: { characters, stories, personas } })
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
      return signedPack({ kind: 'character', title: character.name, source_format: value.spec || 'legacy-character-card', items: { characters: [character], stories: [], personas: [] } })
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

  import(input, { strategy = 'copy', source_name = 'import' } = {}) {
    assert(['copy', 'replace', 'skip'].includes(strategy), 'Import strategy must be copy, replace or skip')
    const preview = this.preview(input)
    if (preview.kind === 'extension') {
      const extension = this.extensions.install(preview.normalized.manifest, { source: source_name })
      const result = { extensions: [extension], characters: [], stories: [], personas: [], skipped: [] }
      return { result, receipt: this.repository.recordImport({ packFormat: EXTENSION_FORMAT, sourceName: source_name, strategy, result: { extension_id: extension.id } }) }
    }
    const pack = preview.normalized
    const result = { characters: [], stories: [], personas: [], skipped: [], id_map: {} }
    this.repository.db.transaction(() => {
      for (const source of pack.items?.characters ?? []) {
        const existing = this.repository.listCharacters().find(item => item.slug === source.slug || item.name.toLocaleLowerCase() === String(source.name).toLocaleLowerCase())
        if (existing && strategy === 'skip') {
          result.skipped.push({ type: 'character', name: source.name, existing_id: existing.id })
          result.id_map[source.id] = existing.id
          continue
        }
        const saved = existing && strategy === 'replace'
          ? this.repository.updateCharacter(existing.id, { ...source, id: undefined, slug: existing.slug })
          : this.repository.createCharacter({ ...source, id: undefined, slug: strategy === 'copy' ? undefined : source.slug })
        result.characters.push(saved)
        if (source.id) result.id_map[source.id] = saved.id
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
        }
        const saved = existing && strategy === 'replace'
          ? this.repository.updateStory(existing.id, { ...mapped, slug: existing.slug })
          : this.repository.createStory(mapped)
        result.stories.push(saved)
        if (source.id) result.id_map[source.id] = saved.id
      }
    })
    const receipt = this.repository.recordImport({
      packFormat: pack.source_format || pack.format,
      sourceName: source_name,
      strategy,
      result: { characters: result.characters.map(item => item.id), stories: result.stories.map(item => item.id), personas: result.personas.map(item => item.id), skipped: result.skipped },
    })
    return { result, receipt }
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
        extensions: { ...character.extensions, harness_tavern: { goals: character.goals, secrets: character.secrets, boundaries: character.boundaries, metadata: character.metadata } },
      },
    }
  }
}
