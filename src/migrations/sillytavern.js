import { unzipSync, strFromU8 } from 'fflate'
import { cardToCharacter } from '../sharing/pack.js'
import { assert, cleanText, id, json, nowIso, plainObject, sha256Hex, stableStringify, uniqueStrings } from '../util.js'

const MAX_ARCHIVE_BYTES = 128 * 1024 * 1024
const MAX_FILE_BYTES = 24 * 1024 * 1024
const PRESET_DIRECTORIES = [
  'openai settings', 'textgen settings', 'koboldai settings', 'novelai settings',
  'context', 'instruct', 'sysprompt', 'reasoning',
]
const PASSIVE_DIRECTORIES = ['quickreplies', 'themes', 'movingui', 'extensions', 'vectors', 'backgrounds', 'assets']

function bytes(value) {
  if (value instanceof Uint8Array) return value
  if (Buffer.isBuffer(value)) return new Uint8Array(value)
  return new TextEncoder().encode(String(value ?? ''))
}

function fromBase64(value) {
  const source = String(value ?? '').trim()
  assert(source.length > 0 && source.length % 4 !== 1 && /^[A-Za-z0-9+/]*={0,2}$/.test(source), 'Migration file contains invalid base64', 400, 'invalid_migration_file')
  const decoded = Buffer.from(source, 'base64')
  assert(decoded.toString('base64').replace(/=+$/, '') === source.replace(/=+$/, ''), 'Migration file contains invalid base64', 400, 'invalid_migration_file')
  return new Uint8Array(decoded)
}

function text(value) {
  try { return strFromU8(bytes(value)) } catch { return new TextDecoder('utf-8', { fatal: false }).decode(bytes(value)) }
}

function parseJson(value, sourceName) {
  try { return JSON.parse(typeof value === 'string' ? value : text(value)) } catch {
    throw Object.assign(new Error(`${sourceName} is not valid JSON`), { status: 400, code: 'invalid_sillytavern_json' })
  }
}

function safePath(value) {
  return String(value ?? '').replaceAll('\\', '/').replace(/^\/+/, '').replace(/\/+/g, '/')
}

function filename(path) {
  return safePath(path).split('/').at(-1) || 'Imported item'
}

function stem(path) {
  return filename(path).replace(/\.(jsonl|json|png|charx)$/i, '')
}

function directorySegments(path) {
  return safePath(path).toLocaleLowerCase().split('/').slice(0, -1)
}

function inDirectory(path, names) {
  const segments = directorySegments(path)
  return names.some(name => segments.includes(name))
}

function isZip(data) {
  const value = bytes(data)
  return value.length >= 4 && value[0] === 0x50 && value[1] === 0x4b && [0x03, 0x05, 0x07].includes(value[2])
}

function expandArchive(data, sourceName) {
  let expanded
  let declaredTotal = 0
  try {
    expanded = unzipSync(bytes(data), {
      filter(file) {
        if (file.name.endsWith('/')) return false
        assert(file.originalSize <= MAX_FILE_BYTES, `${filename(file.name)} exceeds the per-file migration limit`, 413, 'migration_file_too_large')
        declaredTotal += file.originalSize
        assert(declaredTotal <= MAX_ARCHIVE_BYTES, 'Expanded SillyTavern backup exceeds the migration limit', 413, 'migration_too_large')
        return true
      },
    })
  } catch (error) {
    if (error.code) throw error
    throw Object.assign(new Error(`${sourceName} is not a readable ZIP or CHARX archive`), { status: 400, code: 'invalid_archive' })
  }
  const files = []
  let total = 0
  for (const [path, value] of Object.entries(expanded)) {
    if (!value.length || path.endsWith('/')) continue
    total += value.length
    assert(value.length <= MAX_FILE_BYTES, `${filename(path)} exceeds the per-file migration limit`, 413, 'migration_file_too_large')
    assert(total <= MAX_ARCHIVE_BYTES, 'Expanded SillyTavern backup exceeds the migration limit', 413, 'migration_too_large')
    files.push({ path: safePath(path), data: value })
  }
  return files
}

function inputFiles(input) {
  const sourceName = cleanText(input?.source_name || input?.filename || 'SillyTavern import', 500)
  if (Array.isArray(input?.files)) {
    return {
      sourceName,
      files: input.files.map(file => {
        const data = file.base64 !== undefined ? fromBase64(file.base64) : bytes(file.text ?? '')
        assert(data.length <= MAX_FILE_BYTES, `${filename(file.path || file.name)} exceeds the per-file migration limit`, 413, 'migration_file_too_large')
        return { path: safePath(file.path || file.name), data }
      }),
    }
  }
  if (plainObject(input?.files)) {
    return {
      sourceName,
      files: Object.entries(input.files).map(([path, value]) => ({ path: safePath(path), data: bytes(value) })),
    }
  }
  if (input?.data_base64) {
    const data = fromBase64(input.data_base64)
    const inputName = safePath(input.filename || sourceName)
    return { sourceName, files: isZip(data) && !inputName.toLocaleLowerCase().endsWith('.charx') ? expandArchive(data, sourceName) : [{ path: inputName, data }] }
  }
  const content = input?.content ?? input
  if (plainObject(content)) return { sourceName, files: [{ path: safePath(input?.filename || 'character.json'), data: bytes(stableStringify(content)) }] }
  assert(typeof content === 'string' && content.trim(), 'Choose a SillyTavern backup, card, or data folder')
  const data = bytes(content)
  return { sourceName, files: isZip(data) ? expandArchive(data, sourceName) : [{ path: safePath(input?.filename || 'import.json'), data }] }
}

function pngTextChunks(data) {
  const buffer = Buffer.from(data)
  assert(buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])), 'Character PNG has an invalid signature', 400, 'invalid_character_png')
  const values = {}
  let offset = 8
  while (offset + 12 <= buffer.length) {
    const length = buffer.readUInt32BE(offset)
    const type = buffer.toString('ascii', offset + 4, offset + 8)
    const body = buffer.subarray(offset + 8, offset + 8 + length)
    assert(offset + 12 + length <= buffer.length, 'Character PNG is truncated', 400, 'invalid_character_png')
    if (type === 'tEXt') {
      const separator = body.indexOf(0)
      if (separator > 0) values[body.subarray(0, separator).toString('latin1')] = body.subarray(separator + 1).toString('latin1')
    }
    if (type === 'iTXt') {
      const separator = body.indexOf(0)
      if (separator > 0 && body[separator + 1] === 0) {
        let cursor = separator + 3
        cursor = body.indexOf(0, cursor) + 1
        cursor = body.indexOf(0, cursor) + 1
        if (cursor > 1) values[body.subarray(0, separator).toString('latin1')] = body.subarray(cursor).toString('utf8')
      }
    }
    offset += 12 + length
    if (type === 'IEND') break
  }
  return values
}

function decodeCardPayload(value) {
  if (!value) return null
  for (const candidate of [value, Buffer.from(String(value), 'base64').toString('utf8')]) {
    try {
      const parsed = JSON.parse(candidate)
      if (plainObject(parsed)) return parsed
    } catch {}
  }
  return null
}

function cardFromFile(file) {
  const lower = file.path.toLocaleLowerCase()
  let card
  let avatar = ''
  if (lower.endsWith('.png')) {
    const chunks = pngTextChunks(file.data)
    card = decodeCardPayload(chunks.ccv3 || chunks.chara)
    assert(card, `${filename(file.path)} does not contain a SillyTavern character card`, 400, 'character_card_missing')
    if (file.data.length <= 180_000) avatar = `data:image/png;base64,${Buffer.from(file.data).toString('base64')}`
  } else if (lower.endsWith('.charx')) {
    const archive = expandArchive(file.data, file.path)
    const cardFile = archive.find(item => /(^|\/)(card|character)\.json$/i.test(item.path)) || archive.find(item => item.path.toLocaleLowerCase().endsWith('.json'))
    assert(cardFile, `${filename(file.path)} has no card.json`, 400, 'character_card_missing')
    card = parseJson(cardFile.data, cardFile.path)
  } else card = parseJson(file.data, file.path)
  const character = cardToCharacter(card)
  if (avatar) character.avatar_url = avatar
  character.metadata = {
    ...character.metadata,
    migration: { source: 'sillytavern', source_path: file.path, original_spec: card.spec || 'legacy' },
  }
  return character
}

function worldEntries(world, sourcePath) {
  const raw = Array.isArray(world?.entries) ? world.entries : plainObject(world?.entries) ? Object.values(world.entries) : []
  return raw.map((entry, index) => ({
    id: cleanText(String(entry.uid ?? entry.id ?? `entry-${index + 1}`), 160),
    title: cleanText(entry.comment || entry.name || `Lore ${index + 1}`, 300),
    content: cleanText(entry.content, 30_000),
    keywords: uniqueStrings(entry.key ?? entry.keys ?? entry.keywords ?? [], 100, 200),
    secondary_keywords: uniqueStrings(entry.keysecondary ?? entry.secondary_keys ?? [], 100, 200),
    constant: Boolean(entry.constant),
    selective: Boolean(entry.selective),
    enabled: entry.disable !== true && entry.enabled !== false,
    visibility: 'public',
    insertion: { position: entry.position ?? null, order: entry.order ?? null, depth: entry.depth ?? null },
    extensions: { sillytavern: { source_path: sourcePath, original: entry } },
  })).filter(entry => entry.content)
}

function parseJsonLines(value, sourcePath) {
  const records = []
  for (const [index, line] of text(value).split(/\r?\n/).entries()) {
    if (!line.trim()) continue
    try { records.push(JSON.parse(line)) } catch {
      throw Object.assign(new Error(`${sourcePath} has invalid JSON on line ${index + 1}`), { status: 400, code: 'invalid_chat_jsonl' })
    }
  }
  return records
}

function chatFromFile(file, { group = false } = {}) {
  const records = file.path.toLocaleLowerCase().endsWith('.jsonl') ? parseJsonLines(file.data, file.path) : parseJson(file.data, file.path)
  const list = Array.isArray(records) ? records : Array.isArray(records?.messages) ? records.messages : []
  const metadata = list.find(item => plainObject(item) && !Object.hasOwn(item, 'mes') && (item.chat_metadata || item.user_name || item.character_name)) ?? {}
  const messages = list.filter(item => plainObject(item) && (Object.hasOwn(item, 'mes') || Object.hasOwn(item, 'message'))).map(item => ({
    name: cleanText(item.name, 120),
    is_user: Boolean(item.is_user),
    is_system: Boolean(item.is_system),
    content: cleanText(item.mes ?? item.message, 100_000),
    created_at: cleanText(item.send_date || item.created_at, 100),
    swipes: Array.isArray(item.swipes) ? item.swipes.map(value => cleanText(String(value), 100_000)).slice(0, 100) : [],
    swipe_id: Number.isInteger(item.swipe_id) ? item.swipe_id : 0,
    extra: plainObject(item.extra) ? item.extra : {},
  })).filter(item => item.content)
  return {
    source_path: file.path,
    source_id: `st_chat_${sha256Hex(file.path).slice(0, 20)}`,
    title: cleanText(metadata.chat_metadata?.chat_name || stem(file.path), 200),
    group,
    character_name: cleanText(metadata.character_name || directorySegments(file.path).at(-1) || '', 120),
    metadata: plainObject(metadata.chat_metadata) ? metadata.chat_metadata : {},
    messages,
  }
}

function personaCandidates(settings, sourcePath) {
  const descriptions = plainObject(settings?.persona_descriptions) ? settings.persona_descriptions : {}
  return Object.entries(descriptions).map(([avatar, value]) => {
    const data = plainObject(value) ? value : { description: value }
    return {
      id: `st_persona_${sha256Hex(`${sourcePath}:${avatar}`).slice(0, 20)}`,
      name: cleanText(data.name || avatar.replace(/\.[^.]+$/, ''), 120) || 'Imported Persona',
      description: cleanText(data.description, 10_000),
      style: cleanText(data.position ? `SillyTavern prompt position: ${data.position}` : '', 5000),
      avatar_url: '',
      metadata: { migration: { source: 'sillytavern', source_path: sourcePath, avatar }, original: data },
    }
  })
}

function publicInventory(inventory) {
  return {
    counts: {
      files: inventory.files.length,
      characters: inventory.characters.length,
      worlds: inventory.worlds.length,
      groups: inventory.groups.length,
      chats: inventory.chats.length,
      personas: inventory.personas.length,
      presets: inventory.presets.length,
      passive_items: inventory.passive.length,
      ignored_secrets: inventory.ignored_secrets.length,
    },
    characters: inventory.characters.map(item => ({ source_path: item.source_path, name: item.character.name })),
    worlds: inventory.worlds.map(item => ({ source_path: item.source_path, name: item.name, entries: item.lore.length })),
    groups: inventory.groups.map(item => ({ source_path: item.source_path, name: item.name, members: item.member_names.length })),
    chats: inventory.chats.map(item => ({ source_path: item.source_path, title: item.title, messages: item.messages.length, group: item.group })),
    personas: inventory.personas.map(item => ({ name: item.name })),
    presets: inventory.presets.map(item => ({ source_path: item.source_path, name: item.name })),
    passive: inventory.passive,
    ignored_secrets: inventory.ignored_secrets,
  }
}

function migrationRow(row) {
  if (!row) return null
  const inventory = json(row.inventory_json, {})
  return {
    id: row.id,
    source_type: row.source_type,
    source_name: row.source_name,
    source_digest: row.source_digest,
    status: row.status,
    inventory: publicInventory(inventory),
    mapping: json(row.mapping_json, {}),
    result: json(row.result_json, {}),
    warnings: json(row.warnings_json, []),
    created_at: row.created_at,
    updated_at: row.updated_at,
  }
}

export class SillyTavernMigrationService {
  constructor({ db, repository, sharing, generationPresets, storySources }) {
    this.db = db
    this.repository = repository
    this.sharing = sharing
    this.generationPresets = generationPresets
    this.storySources = storySources
  }

  scan(input = {}) {
    const { sourceName, files } = inputFiles(input)
    assert(files.length, 'The selected SillyTavern source contains no files')
    const inventory = { files: [], characters: [], worlds: [], groups: [], chats: [], personas: [], presets: [], passive: [], ignored_secrets: [] }
    const warnings = []
    let expandedTotal = 0
    for (const file of files) {
      const path = safePath(file.path)
      if (!path || path.endsWith('/')) continue
      assert(file.data.length <= MAX_FILE_BYTES, `${filename(path)} exceeds the per-file migration limit`, 413, 'migration_file_too_large')
      expandedTotal += file.data.length
      assert(expandedTotal <= MAX_ARCHIVE_BYTES, 'SillyTavern migration exceeds the expanded data limit', 413, 'migration_too_large')
      const lower = path.toLocaleLowerCase()
      inventory.files.push({ path, bytes: file.data.length })
      if (filename(lower) === 'secrets.json') {
        inventory.ignored_secrets.push(path)
        continue
      }
      try {
        const isSingleCard = files.length === 1 && /\.(png|charx)$/i.test(path)
        const isCharacterJson = files.length === 1 && lower.endsWith('.json') && (() => {
          try {
            const candidate = parseJson(file.data, path)
            return Boolean(candidate?.spec?.startsWith?.('chara_card_') || candidate?.data?.name || (candidate?.name && (candidate?.description || candidate?.first_mes)))
          } catch { return false }
        })()
        if ((inDirectory(path, ['characters']) && /\.(json|png|charx)$/i.test(path)) || isSingleCard || isCharacterJson) {
          const character = cardFromFile(file)
          character.id = `st_character_${sha256Hex(path).slice(0, 20)}`
          inventory.characters.push({ source_path: path, character })
          continue
        }
        if (inDirectory(path, ['worlds']) && lower.endsWith('.json')) {
          const value = parseJson(file.data, path)
          inventory.worlds.push({ source_path: path, id: `st_world_${sha256Hex(path).slice(0, 20)}`, name: cleanText(value.name || stem(path), 200), lore: worldEntries(value, path), original: value })
          continue
        }
        if (inDirectory(path, ['groups']) && lower.endsWith('.json')) {
          const value = parseJson(file.data, path)
          const members = Array.isArray(value.members) ? value.members : []
          inventory.groups.push({
            source_path: path,
            id: `st_group_${sha256Hex(path).slice(0, 20)}`,
            name: cleanText(value.name || stem(path), 200),
            member_names: members.map(member => stem(String(member))),
            disabled_member_names: (Array.isArray(value.disabled_members) ? value.disabled_members : []).map(member => stem(String(member))),
            world_name: cleanText(value.world_info || value.world || '', 200),
            chat_id: cleanText(value.chat_id, 300),
            original: value,
          })
          continue
        }
        if ((inDirectory(path, ['group chats']) || inDirectory(path, ['chats'])) && /\.(jsonl|json)$/i.test(path)) {
          inventory.chats.push(chatFromFile(file, { group: inDirectory(path, ['group chats']) }))
          continue
        }
        if (filename(lower) === 'settings.json') {
          const settings = parseJson(file.data, path)
          inventory.personas.push(...personaCandidates(settings, path))
          continue
        }
        if (PRESET_DIRECTORIES.some(directory => inDirectory(path, [directory])) && lower.endsWith('.json')) {
          inventory.presets.push({ source_path: path, name: stem(path), content: parseJson(file.data, path) })
          continue
        }
        const passiveType = PASSIVE_DIRECTORIES.find(directory => inDirectory(path, [directory]))
        if (passiveType) inventory.passive.push({ source_path: path, type: passiveType, status: passiveType === 'vectors' ? 'rebuild_required' : 'not_executed' })
      } catch (error) {
        warnings.push(`${path}: ${error.message}`)
      }
    }
    if (inventory.ignored_secrets.length) warnings.push('secrets.json was intentionally excluded. API keys and passwords are never migrated.')
    if (inventory.passive.some(item => item.type === 'extensions' || item.type === 'quickreplies')) warnings.push('SillyTavern extensions and Quick Replies were inventoried but not executed; review and recreate them as declarative Tavern actions.')
    if (inventory.passive.some(item => item.type === 'vectors')) warnings.push('Vector indexes were not copied because embeddings are model-specific; source content should be re-indexed in Harness Tavern.')
    if (!inventory.characters.length && !inventory.worlds.length && !inventory.groups.length && !inventory.chats.length && !inventory.personas.length && !inventory.presets.length) {
      warnings.push('No directly migratable SillyTavern content was detected.')
    }
    return { sourceName, inventory, warnings }
  }

  preview(input = {}) {
    const scanned = this.scan(input)
    const sessionId = id('migration')
    const timestamp = nowIso()
    const digest = sha256Hex(stableStringify(scanned.inventory))
    this.db.raw.prepare(`
      INSERT INTO migration_sessions(
        id, source_type, source_name, source_digest, status, inventory_json, mapping_json,
        result_json, warnings_json, created_at, updated_at
      ) VALUES (?, 'sillytavern', ?, ?, 'previewed', ?, '{}', '{}', ?, ?, ?)
    `).run(sessionId, scanned.sourceName, digest, stableStringify(scanned.inventory), stableStringify(scanned.warnings), timestamp, timestamp)
    return this.get(sessionId)
  }

  get(sessionId) {
    const row = this.db.raw.prepare('SELECT * FROM migration_sessions WHERE id = ?').get(sessionId)
    assert(row, 'Migration session not found', 404, 'not_found')
    return migrationRow(row)
  }

  apply(sessionId, { strategy = 'copy' } = {}) {
    assert(['copy', 'replace', 'skip'].includes(strategy), 'Migration strategy must be copy, replace or skip')
    const row = this.db.raw.prepare('SELECT * FROM migration_sessions WHERE id = ?').get(sessionId)
    assert(row, 'Migration session not found', 404, 'not_found')
    assert(row.status === 'previewed' || row.status === 'failed', 'This migration session has already been applied', 409, 'migration_already_applied')
    const inventory = json(row.inventory_json, {})
    const warnings = json(row.warnings_json, [])
    const characterByName = new Map(inventory.characters.map(item => [item.character.name.toLocaleLowerCase(), item.character.id]))
    const worldByName = new Map(inventory.worlds.map(item => [item.name.toLocaleLowerCase(), item]))
    const stories = []
    for (const world of inventory.worlds) {
      stories.push({
        id: world.id,
        title: world.name,
        hook: `Imported SillyTavern World Info with ${world.lore.length} lore entries.`,
        summary: 'A migrated lore world, ready to edit as a standard Story source.',
        premise: '', genre: 'Imported world', tone: '', opening_scene: '', player_role: '', world_rules: [],
        lore: world.lore, initial_state: {}, cast: [], scenes: [], tags: ['sillytavern-import'],
        metadata: { migration: { source: 'sillytavern', source_path: world.source_path }, compatibility: { original_world: world.original } },
        runtime: { actions: [], agendas: [], prompt_graph: {}, world_schema: {} },
      })
    }
    for (const group of inventory.groups) {
      const world = worldByName.get(group.world_name.toLocaleLowerCase())
      stories.push({
        id: group.id,
        title: group.name,
        hook: 'A SillyTavern group migrated into an editable multi-character Story.',
        summary: '', premise: cleanText(group.original.scenario, 30_000), genre: 'Imported group', tone: '',
        opening_scene: '', player_role: '', world_rules: [], lore: world?.lore ?? [], initial_state: {}, scenes: [],
        tags: ['sillytavern-import', 'group'],
        cast: group.member_names.map(name => characterByName.get(name.toLocaleLowerCase())).filter(Boolean).map(characterId => ({ character_id: characterId, role: 'Group member', public_context: '', private_context: '' })),
        metadata: { migration: { source: 'sillytavern', source_path: group.source_path }, compatibility: { original_group: group.original } },
        runtime: { actions: [], agendas: [], prompt_graph: {}, world_schema: {} },
      })
    }
    const pack = {
      format: 'harness-tavern-pack', format_version: 1, kind: 'sillytavern-migration', title: row.source_name,
      items: {
        characters: inventory.characters.map(item => item.character),
        stories,
        personas: inventory.personas,
      },
    }
    let imported
    const presetResults = []
    const conversations = []
    try {
      this.db.transaction(() => {
      imported = this.sharing.import(pack, { strategy, source_name: row.source_name, sync_sources: false })
      const idMap = imported.result.id_map
      for (const preset of inventory.presets) {
        try {
          const result = this.generationPresets.importPreset({ content: preset.content, source_name: preset.source_path, name: preset.name })
          presetResults.push({ source_path: preset.source_path, preset_id: result.preset.id, status: 'imported' })
        } catch (error) {
          presetResults.push({ source_path: preset.source_path, status: 'preserved_only', reason: error.message })
        }
      }
      const groups = new Map(inventory.groups.map(item => [item.id, item]))
      const importedGroupIdByName = new Map(inventory.groups.map(item => [item.name.toLocaleLowerCase(), idMap[item.id]]))
      for (const chat of inventory.chats) {
        let storyId = null
        let characterIds = []
        if (chat.group) {
          const group = [...groups.values()].find(item => item.chat_id && chat.source_path.includes(item.chat_id))
            || inventory.groups.find(item => chat.title.toLocaleLowerCase().includes(item.name.toLocaleLowerCase()))
          storyId = group ? idMap[group.id] : importedGroupIdByName.get(chat.title.toLocaleLowerCase()) ?? null
        } else {
          const sourceCharacterId = characterByName.get(chat.character_name.toLocaleLowerCase())
            || [...characterByName.entries()].find(([name]) => chat.source_path.toLocaleLowerCase().includes(name))?.[1]
          if (sourceCharacterId && idMap[sourceCharacterId]) characterIds = [idMap[sourceCharacterId]]
        }
        if (!storyId && !characterIds.length) {
          warnings.push(`${chat.source_path}: chat was preserved in the migration inventory but no matching character or group was found.`)
          continue
        }
        const conversation = this.repository.createConversation({
          title: chat.title,
          story_id: storyId,
          character_ids: characterIds,
          skip_opening: true,
          thinking_intensity: 'auto',
          prompt: { history_messages: null, context_budget_tokens: null },
        })
        const cast = this.repository.listConversationCast(conversation.id)
        const castByName = new Map(cast.map(member => [member.character.name.toLocaleLowerCase(), member.character_id]))
        for (const [index, message] of chat.messages.entries()) {
          const type = message.is_user ? 'user.message' : 'assistant.message'
          const actorId = message.is_user ? 'user'
            : message.is_system ? 'narrator'
              : castByName.get(message.name.toLocaleLowerCase()) || cast[0]?.character_id || 'narrator'
          const chosenSwipe = message.swipes[message.swipe_id]
          this.db.appendEvent({
            conversationId: conversation.id,
            branchId: conversation.current_branch_id,
            type,
            actorId,
            createdAt: Number.isFinite(Date.parse(message.created_at)) ? new Date(message.created_at).toISOString() : null,
            payload: {
              content: chosenSwipe || message.content,
              metadata: {
                migration: { source: 'sillytavern', source_path: chat.source_path, source_index: index },
                swipes: message.swipes,
                selected_swipe: message.swipe_id,
                original_extra: message.extra,
              },
            },
          })
        }
        this.repository.touchConversation(conversation.id, chat.messages.at(-1)?.content || '')
        conversations.push({ id: conversation.id, title: conversation.title, source_path: chat.source_path, messages: chat.messages.length })
      }
      const mapping = { ...imported.result.id_map }
      const result = {
        characters: imported.result.characters.map(item => item.id),
        stories: imported.result.stories.map(item => item.id),
        personas: imported.result.personas.map(item => item.id),
        conversations,
        presets: presetResults,
        skipped: imported.result.skipped,
        passive_items: inventory.passive,
      }
      this.db.raw.prepare("UPDATE migration_sessions SET status='applied', mapping_json=?, result_json=?, warnings_json=?, updated_at=? WHERE id=?")
        .run(stableStringify(mapping), stableStringify(result), stableStringify(warnings), nowIso(), sessionId)
      this.db.audit('migration.sillytavern.applied', 'migration', sessionId, { strategy, counts: publicInventory(inventory).counts })
      })

      const sourceSyncWarnings = []
      for (const character of imported.result.characters) {
        try { this.storySources?.syncRuntimeCharacter(character.id, { character }) } catch (error) {
          sourceSyncWarnings.push(`${character.name}: ${error.message}`)
        }
      }
      for (const story of imported.result.stories) {
        try { this.storySources?.syncRuntimeStory(story.id) } catch (error) {
          sourceSyncWarnings.push(`${story.title}: ${error.message}`)
        }
      }
      if (sourceSyncWarnings.length) {
        warnings.push(...sourceSyncWarnings.map(message => `Editable Story source could not be synchronized for ${message}`))
        this.db.raw.prepare('UPDATE migration_sessions SET warnings_json=?, updated_at=? WHERE id=?')
          .run(stableStringify(warnings), nowIso(), sessionId)
      }
    } catch (error) {
      this.db.raw.prepare("UPDATE migration_sessions SET status='failed', result_json=?, updated_at=? WHERE id=?")
        .run(stableStringify({ error: { code: error.code || 'migration_failed', message: error.message } }), nowIso(), sessionId)
      throw error
    }
    return this.get(sessionId)
  }
}
