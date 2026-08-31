import { randomUUID } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { basename, dirname, isAbsolute, join, relative, resolve, sep, posix } from 'node:path'
import { fileURLToPath } from 'node:url'
import Ajv2020 from 'ajv/dist/2020.js'
import { assert, cleanText, nowIso, plainObject, sha256Hex, slugify, stableStringify, uniqueStrings } from '../util.js'
import { cardToCharacter, characterToCardV2 } from '../sharing/pack.js'
import { loreCompatibilityFields } from '../domain/lore.js'

export const STORY_SOURCE_FORMAT = 'harness-tavern-story'
export const STORY_SOURCE_VERSION = 2
export const STORY_PROJECT_BUNDLE_FORMAT = 'harness-tavern-story-project-files'
export const STORY_SCHEMA_URL = 'https://raw.githubusercontent.com/HenryQUQ/harness-tavern/main/schemas/story.schema.json'

const SCHEMA_DIR = fileURLToPath(new URL('../../schemas', import.meta.url))
const STORY_SCHEMA = JSON.parse(readFileSync(join(SCHEMA_DIR, 'story.schema.json'), 'utf8'))
const CHARACTER_SCHEMA = JSON.parse(readFileSync(join(SCHEMA_DIR, 'character-card.schema.json'), 'utf8'))
const LOREBOOK_SCHEMA = JSON.parse(readFileSync(join(SCHEMA_DIR, 'lorebook.schema.json'), 'utf8'))
const ajv = new Ajv2020({ allErrors: true, allowUnionTypes: true, strict: true, strictRequired: false })
ajv.addSchema(CHARACTER_SCHEMA)
ajv.addSchema(LOREBOOK_SCHEMA)
const validateStorySchema = ajv.compile(STORY_SCHEMA)

function sourceError(message, code = 'invalid_story_source', status = 400) {
  return Object.assign(new Error(message), { code, status, expose: true })
}

function prettyJson(value) {
  return `${JSON.stringify(JSON.parse(stableStringify(value)), null, 2)}\n`
}

function parseJson(value, label = 'Story source') {
  if (plainObject(value)) return structuredClone(value)
  try {
    const parsed = JSON.parse(String(value ?? ''))
    assert(plainObject(parsed), `${label} must contain a JSON object`)
    return parsed
  } catch (error) {
    if (error.code) throw error
    throw sourceError(`${label} is not valid JSON: ${error.message}`, 'invalid_json')
  }
}

function schemaErrors(errors = []) {
  return errors.slice(0, 12).map(error => {
    const path = error.instancePath || '/'
    return `${path} ${error.message}`
  }).join('; ')
}

function validateManifest(manifest) {
  if (!validateStorySchema(manifest)) {
    throw sourceError(`Story source does not match the Story schema: ${schemaErrors(validateStorySchema.errors)}`, 'story_schema_invalid')
  }
  return manifest
}

function assertUniqueKeys(items, label) {
  const seen = new Set()
  for (const item of items) {
    assert(!seen.has(item.key), `${label} key “${item.key}” is duplicated`, 400, 'duplicate_story_key')
    seen.add(item.key)
  }
}

function validateSemantics(source) {
  assertUniqueKeys(source.characters, 'Character')
  assertUniqueKeys(source.lorebooks ?? [], 'Lorebook')
  assertUniqueKeys(source.scenes ?? [], 'Scene')
  assertUniqueKeys(source.actions ?? [], 'Action')
  assertUniqueKeys(source.agendas ?? [], 'Agenda')
  assertUniqueKeys(source.transforms ?? [], 'Transform')
  assertUniqueKeys(source.automations ?? [], 'Automation')
  const characterKeys = new Set(source.characters.map(item => item.key))
  const castKeys = new Set()
  for (const member of source.cast) {
    assert(characterKeys.has(member.character), `Cast references missing character “${member.character}”`, 400, 'missing_character_reference')
    assert(!castKeys.has(member.character), `Character “${member.character}” appears in the cast more than once`, 400, 'duplicate_cast_member')
    castKeys.add(member.character)
  }
  for (const scene of source.scenes ?? []) {
    for (const characterKey of scene.active_characters ?? []) {
      assert(characterKeys.has(characterKey), `Scene “${scene.key}” references missing character “${characterKey}”`, 400, 'missing_character_reference')
    }
  }
  for (const agenda of source.agendas ?? []) {
    const owner = agenda.owner ?? agenda.owner_id
    assert(owner === 'user' || characterKeys.has(owner), `Agenda “${agenda.key}” references missing owner “${owner}”`, 400, 'missing_character_reference')
  }
  const loreEntryKeys = new Set()
  for (const book of source.lorebooks ?? []) {
    assertUniqueKeys(book.book.entries, `Lorebook “${book.key}” entry`)
    for (const entry of book.book.entries) {
      assert(!loreEntryKeys.has(entry.key), `Lore entry key “${entry.key}” must be unique across the Story`, 400, 'duplicate_story_key')
      loreEntryKeys.add(entry.key)
    }
  }
  return source
}

function safeResourcePath(baseDir, resourcePath) {
  assert(typeof resourcePath === 'string' && resourcePath.trim(), 'Resource source path is required', 400, 'invalid_resource_path')
  assert(!isAbsolute(resourcePath), `Resource path must be relative: ${resourcePath}`, 400, 'invalid_resource_path')
  const target = resolve(baseDir, resourcePath)
  const rel = relative(baseDir, target)
  assert(rel && !rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel), `Resource path leaves the story project: ${resourcePath}`, 400, 'invalid_resource_path')
  return target
}

function fileResolver(manifestPath) {
  const baseDir = dirname(manifestPath)
  return {
    manifestPath,
    read(resourcePath) {
      const target = safeResourcePath(baseDir, resourcePath)
      assert(existsSync(target) && statSync(target).isFile(), `Story resource not found: ${resourcePath}`, 400, 'story_resource_missing')
      return readFileSync(target, 'utf8')
    },
  }
}

function normalizeVirtualPath(value) {
  const path = String(value ?? '').replaceAll('\\', '/').replace(/^\.\//, '')
  assert(path && !path.startsWith('/') && !/^[A-Za-z]:\//.test(path), `Invalid project file path: ${value}`, 400, 'invalid_resource_path')
  const normalized = posix.normalize(path)
  assert(normalized !== '..' && !normalized.startsWith('../'), `Project file path leaves the project: ${value}`, 400, 'invalid_resource_path')
  return normalized
}

function bundleResolver(bundle) {
  assert(plainObject(bundle.files), 'Story project bundle must contain a files object', 400, 'invalid_story_project')
  const files = new Map(Object.entries(bundle.files).map(([path, content]) => [normalizeVirtualPath(path), String(content)]))
  const candidates = [...files.keys()].filter(path => basename(path) === 'story.tavern.json' || path.endsWith('.story.tavern.json'))
  const manifestPath = bundle.manifest_path ? normalizeVirtualPath(bundle.manifest_path) : candidates.length === 1 ? candidates[0] : null
  assert(manifestPath && files.has(manifestPath), 'Choose a story project containing exactly one story.tavern.json manifest', 400, 'story_manifest_missing')
  const baseDir = posix.dirname(manifestPath)
  return {
    kind: 'project',
    manifestPath,
    manifestText: files.get(manifestPath),
    read(resourcePath) {
      assert(typeof resourcePath === 'string' && resourcePath.trim(), 'Resource source path is required', 400, 'invalid_resource_path')
      assert(!resourcePath.startsWith('/') && !/^[A-Za-z]:[\\/]/.test(resourcePath), `Resource path must be relative: ${resourcePath}`, 400, 'invalid_resource_path')
      const target = normalizeVirtualPath(posix.join(baseDir, resourcePath))
      const relativeToBase = baseDir === '.' ? target : posix.relative(baseDir, target)
      assert(relativeToBase !== '..' && !relativeToBase.startsWith('../'), `Resource path leaves the story project: ${resourcePath}`, 400, 'invalid_resource_path')
      assert(files.has(target), `Story resource not found: ${resourcePath}`, 400, 'story_resource_missing')
      return files.get(target)
    },
  }
}

function uniqueKey(value, used, fallback) {
  const base = slugify(value, fallback).slice(0, 120)
  let candidate = base
  let suffix = 2
  while (used.has(candidate)) candidate = `${base.slice(0, 115)}-${suffix++}`
  used.add(candidate)
  return candidate
}

function normalizeLorebook(value, fallbackKey, visibility) {
  const book = parseJson(value, `Lorebook “${fallbackKey}”`)
  const rawEntries = Array.isArray(book.entries)
    ? book.entries
    : plainObject(book.entries)
      ? Object.entries(book.entries).map(([entryKey, entry]) => ({ entryKey, ...entry }))
      : []
  const used = new Set()
  const entries = rawEntries.map((entry, index) => {
    const authoredKey = typeof entry.key === 'string' ? entry.key : null
    const key = uniqueKey(authoredKey ?? entry.id ?? entry.comment ?? entry.name ?? entry.uid ?? entry.entryKey ?? `entry-${index + 1}`, used, `entry-${index + 1}`)
    return {
      key,
      title: cleanText(entry.title ?? entry.comment ?? entry.name ?? key, 300) || key,
      content: cleanText(entry.content, 10_000),
      keywords: uniqueStrings(entry.keywords ?? entry.keys ?? entry.key, 50, 100),
      secondary_keywords: uniqueStrings(entry.secondary_keywords ?? entry.secondary_keys ?? entry.keysecondary, 50, 100),
      selective: Boolean(entry.selective),
      visibility: ['public', 'private', 'director'].includes(visibility ?? entry.visibility) ? (visibility ?? entry.visibility) : 'public',
      enabled: entry.enabled !== false && entry.disable !== true,
      constant: Boolean(entry.constant),
      ...loreCompatibilityFields(entry),
      ...plainObject(entry.extensions) ? { extensions: entry.extensions } : {},
    }
  })
  return {
    format: 'harness-tavern-lorebook',
    format_version: 1,
    name: cleanText(book.name ?? fallbackKey, 200) || fallbackKey,
    entries,
    ...plainObject(book.extensions) ? { extensions: book.extensions } : {},
  }
}

function resolveManifest(manifest, resolver) {
  validateManifest(manifest)
  const resolved = structuredClone(manifest)
  resolved.characters = manifest.characters.map(item => ({
    ...item,
    card: item.card ?? parseJson(resolver.read(item.source), `Character “${item.key}”`),
    source: undefined,
  }))
  resolved.lorebooks = (manifest.lorebooks ?? []).map(item => ({
    ...item,
    book: normalizeLorebook(item.book ?? resolver.read(item.source), item.key, item.visibility),
    source: undefined,
  }))
  resolved.scenes = (manifest.scenes ?? []).map(item => ({
    ...item,
    ...item.source ? { content: resolver.read(item.source) } : {},
    source: undefined,
  }))
  resolved.actions = (manifest.actions ?? []).map(item => item.source
    ? { ...parseJson(resolver.read(item.source), `Action “${item.key}”`), key: item.key, source: undefined }
    : item)
  resolved.agendas = (manifest.agendas ?? []).map(item => item.source
    ? { ...parseJson(resolver.read(item.source), `Agenda “${item.key}”`), key: item.key, source: undefined }
    : item)
  const clean = JSON.parse(stableStringify(resolved))
  validateManifest(clean)
  return validateSemantics(clean)
}

export function isStorySourceInput(input) {
  if (plainObject(input)) return input.format === STORY_SOURCE_FORMAT || input.format === STORY_PROJECT_BUNDLE_FORMAT
  if (typeof input !== 'string') return false
  try {
    const parsed = JSON.parse(input)
    return parsed?.format === STORY_SOURCE_FORMAT || parsed?.format === STORY_PROJECT_BUNDLE_FORMAT
  } catch {
    return false
  }
}

export function loadStorySource(input) {
  if (plainObject(input) && input.format === STORY_PROJECT_BUNDLE_FORMAT) {
    const resolver = bundleResolver(input)
    const manifest = parseJson(resolver.manifestText, 'Story manifest')
    return { source: resolveManifest(manifest, resolver), manifest, kind: 'project', manifestPath: resolver.manifestPath }
  }
  const manifest = parseJson(input)
  assert(manifest.format === STORY_SOURCE_FORMAT, `Story format must be ${STORY_SOURCE_FORMAT}`, 400, 'unsupported_story_format')
  const resolver = {
    kind: 'single',
    manifestPath: null,
    read(resourcePath) {
      throw sourceError(`Resource “${resourcePath}” requires importing the complete story project directory`, 'story_resource_missing')
    },
  }
  return { source: resolveManifest(manifest, resolver), manifest, kind: 'single', manifestPath: null }
}

export function loadStorySourcePath(inputPath) {
  const path = resolve(inputPath)
  assert(existsSync(path), `Story source path does not exist: ${inputPath}`, 404, 'story_source_not_found')
  const manifestPath = statSync(path).isDirectory() ? join(path, 'story.tavern.json') : path
  assert(existsSync(manifestPath) && statSync(manifestPath).isFile(), `Story manifest not found: ${manifestPath}`, 404, 'story_manifest_missing')
  const resolver = fileResolver(manifestPath)
  const manifest = parseJson(readFileSync(manifestPath, 'utf8'), 'Story manifest')
  const project = [...manifest.characters ?? [], ...manifest.lorebooks ?? [], ...manifest.scenes ?? [], ...manifest.actions ?? [], ...manifest.agendas ?? []].some(item => item.source)
  return { source: resolveManifest(manifest, resolver), manifest, kind: project ? 'project' : 'single', manifestPath }
}

function deepMapStrings(value, replacements) {
  if (typeof value === 'string') return replacements.get(value) ?? value
  if (Array.isArray(value)) return value.map(item => deepMapStrings(item, replacements))
  if (!plainObject(value)) return value
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, deepMapStrings(child, replacements)]))
}

function storyFields(story) {
  return {
    title: story.title,
    hook: story.hook,
    summary: story.summary,
    premise: story.premise,
    genre: story.genre,
    tone: story.tone,
    opening_scene: story.opening_scene,
    player_role: story.player_role,
    world_rules: story.world_rules,
    initial_state: story.initial_state,
    author_notes: story.author_notes,
    content_warnings: story.content_warnings,
    tags: story.tags,
    cover: story.cover_url,
    visibility: story.visibility,
    metadata: story.metadata,
    share_policy: story.share_policy,
  }
}

export function storyToSource(story, { characterKeyById = new Map() } = {}) {
  const storyKey = story.slug || slugify(story.title, 'story')
  const usedCharacterKeys = new Set()
  const characterKeys = new Map()
  for (const member of story.cast) {
    characterKeys.set(member.character_id, uniqueKey(characterKeyById.get(member.character_id) || member.character.slug || member.character.name, usedCharacterKeys, 'character'))
  }
  const replacements = new Map(characterKeys)
  if (story.id) replacements.set(story.id, storyKey)
  const characters = story.cast.map(member => ({
    key: characterKeys.get(member.character_id),
    card: deepMapStrings(characterToCardV2(member.character), replacements),
  }))
  const loreKeys = new Set()
  const lorebook = {
    format: 'harness-tavern-lorebook',
    format_version: 1,
    name: `${story.title} lore`,
    entries: (story.lore ?? []).map((entry, index) => ({
      key: uniqueKey(entry.key ?? entry.id ?? entry.title, loreKeys, `lore-${index + 1}`),
      title: cleanText(entry.title ?? entry.name ?? `Lore ${index + 1}`, 300) || `Lore ${index + 1}`,
      content: cleanText(entry.content, 10_000),
      keywords: uniqueStrings(entry.keywords ?? entry.keys, 50, 100),
      secondary_keywords: uniqueStrings(entry.secondary_keywords ?? entry.secondary_keys, 50, 100),
      ...entry.selective ? { selective: true } : {},
      visibility: ['public', 'private', 'director'].includes(entry.visibility) ? entry.visibility : 'public',
      ...entry.enabled === false ? { enabled: false } : {},
      ...entry.constant ? { constant: true } : {},
      ...loreCompatibilityFields(entry),
      ...plainObject(entry.extensions) ? { extensions: entry.extensions } : {},
    })),
  }
  const sceneKeys = new Set()
  const scenes = (story.scenes ?? []).map((scene, index) => {
    const { id: sceneId, active_character_ids: activeIds, content, title, location, time, objective, metadata, ...rest } = scene
    return {
      key: uniqueKey(scene.key ?? sceneId ?? title, sceneKeys, `scene-${index + 1}`),
      title: cleanText(title ?? `Scene ${index + 1}`, 300) || `Scene ${index + 1}`,
      location: cleanText(location, 1000),
      time: cleanText(time, 1000),
      objective: cleanText(objective, 10_000),
      ...content ? { content: cleanText(content, 100_000) } : {},
      active_characters: (activeIds ?? []).map(characterId => characterKeys.get(characterId)).filter(Boolean),
      ...Object.keys(rest).length || plainObject(metadata) ? { metadata: deepMapStrings({ ...rest, ...(metadata ?? {}) }, replacements) } : {},
    }
  })
  const source = {
    $schema: STORY_SCHEMA_URL,
    format: STORY_SOURCE_FORMAT,
    format_version: STORY_SOURCE_VERSION,
    story_key: storyKey,
    story: deepMapStrings(storyFields(story), replacements),
    characters,
    cast: story.cast.map(member => ({
      character: characterKeys.get(member.character_id),
      role: member.role,
      public_context: member.public_context,
      private_context: member.private_context,
      metadata: deepMapStrings(member.metadata ?? {}, replacements),
    })),
    ...lorebook.entries.length ? { lorebooks: [{ key: 'story-lore', book: lorebook }] } : {},
    ...scenes.length ? { scenes } : {},
    ...story.runtime?.world_schema && Object.keys(story.runtime.world_schema).length ? { world_schema: deepMapStrings(story.runtime.world_schema, replacements) } : {},
    ...story.runtime?.actions?.length ? { actions: deepMapStrings(story.runtime.actions.map(action => ({ ...action, key: action.key ?? action.id })), replacements) } : {},
    ...story.runtime?.agendas?.length ? { agendas: deepMapStrings(story.runtime.agendas.map(agenda => {
      const { id: agendaId, owner_id: ownerId, ...portable } = agenda
      return { ...portable, key: agenda.key ?? agendaId, owner: agenda.owner ?? ownerId }
    }), replacements) } : {},
    ...story.runtime?.prompt_graph && Object.keys(story.runtime.prompt_graph).length ? { prompt_graph: deepMapStrings(story.runtime.prompt_graph, replacements) } : {},
    ...story.runtime?.state_visibility?.length ? { state_visibility: deepMapStrings(story.runtime.state_visibility, replacements) } : {},
    ...story.runtime?.transforms?.length ? { transforms: deepMapStrings(story.runtime.transforms.map((item, index) => {
      const { id: itemId, ...portable } = item
      return { ...portable, key: item.key ?? itemId ?? `transform-${index + 1}` }
    }), replacements) } : {},
    ...story.runtime?.automations?.length ? { automations: deepMapStrings(story.runtime.automations.map((item, index) => {
      const { id: itemId, ...portable } = item
      return { ...portable, key: item.key ?? itemId ?? `automation-${index + 1}` }
    }), replacements) } : {},
  }
  return loadStorySource(source).source
}

function mergeRuntimeIntoSource(current, story, characterKeyById) {
  const generated = storyToSource(story, { characterKeyById })
  generated.story_key = current.story_key
  generated.extensions = current.extensions

  const generatedCharacterKeys = new Set(generated.characters.map(item => item.key))
  const currentCharacters = new Map(current.characters.map(item => [item.key, item]))
  generated.characters = [
    ...generated.characters.map(item => ({ ...item, ...currentCharacters.get(item.key)?.extensions ? { extensions: currentCharacters.get(item.key).extensions } : {} })),
    ...current.characters.filter(item => !generatedCharacterKeys.has(item.key)),
  ]

  const generatedEntries = new Map((generated.lorebooks?.[0]?.book.entries ?? []).map(entry => [entry.key, entry]))
  if (current.lorebooks?.length) {
    const assigned = new Set()
    generated.lorebooks = current.lorebooks.map(resource => ({
      ...resource,
      book: {
        ...resource.book,
        name: resource.book.name,
        entries: resource.book.entries.flatMap(entry => {
          const next = generatedEntries.get(entry.key)
          if (!next) return []
          assigned.add(entry.key)
          return [next]
        }),
      },
    }))
    const unassigned = [...generatedEntries.values()].filter(entry => !assigned.has(entry.key))
    if (unassigned.length) generated.lorebooks[0].book.entries.push(...unassigned)
  }

  return loadStorySource(generated).source
}

function projectFiles(source) {
  const manifest = structuredClone(source)
  const files = new Map()
  manifest.characters = source.characters.map(item => {
    const path = `characters/${item.key}.character.json`
    files.set(path, prettyJson(item.card))
    return { key: item.key, source: path, ...item.extensions ? { extensions: item.extensions } : {} }
  })
  manifest.lorebooks = (source.lorebooks ?? []).map(item => {
    const path = `lore/${item.key}.lorebook.json`
    files.set(path, prettyJson(item.book))
    return { key: item.key, source: path, ...item.visibility ? { visibility: item.visibility } : {}, ...item.extensions ? { extensions: item.extensions } : {} }
  })
  manifest.scenes = (source.scenes ?? []).map((item, index) => {
    const path = `scenes/${String(index + 1).padStart(3, '0')}-${item.key}.md`
    files.set(path, `${item.content ?? ''}`)
    const { content, ...descriptor } = item
    return { ...descriptor, source: path }
  })
  manifest.actions = (source.actions ?? []).map(item => {
    const path = `actions/${item.key}.action.json`
    files.set(path, prettyJson(item))
    return { key: item.key, source: path }
  })
  manifest.agendas = (source.agendas ?? []).map(item => {
    const path = `agendas/${item.key}.agenda.json`
    files.set(path, prettyJson(item))
    return { key: item.key, source: path }
  })
  files.set('story.tavern.json', prettyJson(manifest))
  return files
}

function atomicWriteFiles(entries) {
  const staged = []
  try {
    for (const [path, content] of entries) {
      mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
      const temporary = `${path}.tmp-${randomUUID()}`
      writeFileSync(temporary, content, { encoding: 'utf8', mode: 0o600 })
      staged.push([temporary, path])
    }
    for (const [temporary, path] of staged) renameSync(temporary, path)
  } catch (error) {
    for (const [temporary] of staged) rmSync(temporary, { force: true })
    throw error
  }
}

export function writeStoryProject(sourceInput, outputDirectory) {
  const source = loadStorySource(sourceInput).source
  const directory = resolve(outputDirectory)
  const files = projectFiles(source)
  atomicWriteFiles([...files.entries()].map(([path, content]) => [join(directory, path), content]))
  return { directory, manifest_path: join(directory, 'story.tavern.json'), files: [...files.keys()] }
}

function publicBinding(binding, sourceRoot) {
  if (!binding) return null
  const rel = relative(sourceRoot, binding.source_path)
  return {
    story_key: binding.story_key,
    kind: binding.source_kind,
    path: rel && !rel.startsWith(`..${sep}`) && !isAbsolute(rel) ? rel : basename(binding.source_path),
    linked: rel.startsWith(`..${sep}`) || isAbsolute(rel),
    digest: binding.source_digest,
    loaded_at: binding.loaded_at,
    last_error: binding.last_error || null,
  }
}

function comparableCharacter(character) {
  return stableStringify({
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
  })
}

function comparableStory(story) {
  return stableStringify({
    ...storyFields(story),
    scenes: story.scenes,
    lore: story.lore,
    cast: story.cast.map(member => ({
      character_id: member.character_id,
      role: member.role,
      public_context: member.public_context,
      private_context: member.private_context,
      metadata: member.metadata,
    })),
    runtime: story.runtime,
  })
}

function runtimeCharacter(resource) {
  const character = cardToCharacter(resource.card)
  const harnessMetadata = resource.card?.data?.extensions?.harness_tavern?.metadata
  if (plainObject(harnessMetadata) && !Object.hasOwn(harnessMetadata, 'imported_from')) delete character.metadata.imported_from
  if (plainObject(character.extensions)) {
    const extensions = { ...character.extensions }
    delete extensions.harness_tavern
    character.extensions = extensions
  }
  return { ...character, slug: resource.key }
}

function runtimeStory(source, characterIds) {
  const replacements = new Map(characterIds)
  const lore = (source.lorebooks ?? []).flatMap(resource => resource.book.entries
    .filter(entry => entry.enabled !== false)
    .map(entry => ({
      id: entry.key,
      title: entry.title,
      content: entry.content,
      keywords: entry.keywords ?? [],
      secondary_keywords: entry.secondary_keywords ?? [],
      ...entry.selective ? { selective: true } : {},
      visibility: entry.visibility ?? resource.visibility ?? 'public',
      ...entry.constant ? { constant: true } : {},
      ...loreCompatibilityFields(entry),
      ...entry.extensions ? { extensions: entry.extensions } : {},
    })))
  const scenes = (source.scenes ?? []).map(scene => ({
    id: scene.key,
    title: scene.title,
    location: scene.location ?? '',
    time: scene.time ?? '',
    objective: scene.objective ?? '',
    ...scene.content ? { content: scene.content } : {},
    active_character_ids: (scene.active_characters ?? []).map(key => characterIds.get(key)),
    ...plainObject(scene.metadata) ? deepMapStrings(scene.metadata, replacements) : {},
  }))
  return {
    ...deepMapStrings(source.story, replacements),
    slug: source.story_key,
    cover_url: source.story.cover ?? '',
    lore,
    scenes,
    runtime: {
      world_schema: deepMapStrings(source.world_schema ?? {}, replacements),
      actions: deepMapStrings(source.actions ?? [], replacements),
      agendas: deepMapStrings((source.agendas ?? []).map(agenda => ({ ...agenda, id: agenda.key, owner_id: agenda.owner ?? agenda.owner_id })), replacements),
      prompt_graph: deepMapStrings(source.prompt_graph ?? {}, replacements),
      state_visibility: deepMapStrings(source.state_visibility ?? [], replacements),
      transforms: deepMapStrings((source.transforms ?? []).map(item => ({ ...item, id: item.key })), replacements),
      automations: deepMapStrings((source.automations ?? []).map(item => ({ ...item, id: item.key })), replacements),
    },
    cast: source.cast.map(member => ({
      character_id: characterIds.get(member.character),
      role: member.role,
      public_context: member.public_context ?? '',
      private_context: member.private_context ?? '',
      metadata: deepMapStrings(member.metadata ?? {}, replacements),
    })),
  }
}

function discoverManifests(root) {
  if (!existsSync(root)) return []
  const output = []
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue
    const path = join(root, entry.name)
    if (entry.isDirectory()) {
      const manifest = join(path, 'story.tavern.json')
      if (existsSync(manifest) && statSync(manifest).isFile()) output.push(manifest)
    } else if (entry.isFile() && (entry.name.endsWith('.story.tavern.json') || entry.name.endsWith('.tavern.json'))) {
      output.push(path)
    }
  }
  return output.sort()
}

export class StorySourceService {
  constructor({ repository, config, logger }) {
    this.repository = repository
    this.db = repository.db
    this.root = config.storySourceDir
    this.logger = logger
    mkdirSync(this.root, { recursive: true, mode: 0o700 })
  }

  listBindings() {
    return this.db.raw.prepare('SELECT * FROM story_sources ORDER BY story_key').all().map(binding => publicBinding(binding, this.root))
  }

  binding(storyId) {
    return this.db.raw.prepare('SELECT * FROM story_sources WHERE story_id = ?').get(storyId) ?? null
  }

  bootstrap() {
    const errors = []
    const seenPaths = new Set()
    const bindings = this.db.raw.prepare('SELECT * FROM story_sources ORDER BY story_key').all()
    for (const binding of bindings) {
      if (!existsSync(binding.source_path)) {
        const message = `Story source is missing: ${binding.source_path}`
        this.#recordError(binding.story_id, message)
        errors.push({ story_key: binding.story_key, message })
        continue
      }
      seenPaths.add(resolve(binding.source_path))
      try { this.compilePath(binding.source_path, { targetStoryId: binding.story_id, strategy: 'replace' }) } catch (error) {
        this.#recordError(binding.story_id, error.message)
        errors.push({ story_key: binding.story_key, message: error.message })
        this.logger?.warn('story_source.reload_failed', { story_key: binding.story_key, error: error.message })
      }
    }
    const discoveredKeys = new Map(bindings.map(binding => [binding.story_key, binding.source_path]))
    for (const manifestPath of discoverManifests(this.root)) {
      if (seenPaths.has(resolve(manifestPath))) continue
      try {
        const loaded = loadStorySourcePath(manifestPath)
        const prior = discoveredKeys.get(loaded.source.story_key)
        assert(!prior, `Duplicate story_key “${loaded.source.story_key}” in ${prior} and ${manifestPath}`, 409, 'duplicate_story_source')
        discoveredKeys.set(loaded.source.story_key, manifestPath)
        this.#compile(loaded, { strategy: 'replace', bindingPath: manifestPath, bindingKind: loaded.kind })
      } catch (error) {
        errors.push({ path: manifestPath, message: error.message })
        this.logger?.warn('story_source.discover_failed', { path: manifestPath, error: error.message })
      }
    }
    for (const story of this.repository.listStories()) if (!this.binding(story.id)) this.materialize(story.id)
    return { bindings: this.listBindings(), errors }
  }

  preview(input) {
    const loaded = loadStorySource(input)
    const existing = this.#findStoryByKey(loaded.source.story_key)
    return {
      kind: 'story-source',
      title: loaded.source.story.title,
      format: STORY_SOURCE_FORMAT,
      format_version: STORY_SOURCE_VERSION,
      source_kind: loaded.kind,
      story_key: loaded.source.story_key,
      counts: { characters: loaded.source.characters.length, stories: 1, personas: 0 },
      conflicts: existing ? [{ type: 'story', existing_id: existing.id, name: existing.title, story_key: loaded.source.story_key }] : [],
      warnings: existing ? ['Choose “Create copies” to keep both versions, or “Replace” to update the bound editable source.'] : [],
    }
  }

  import(input, { strategy = 'copy', sourceName = 'story source import' } = {}) {
    assert(['copy', 'replace', 'skip'].includes(strategy), 'Import strategy must be copy, replace or skip')
    const loaded = loadStorySource(input)
    const existing = this.#findStoryByKey(loaded.source.story_key)
    if (existing && strategy === 'skip') {
      const result = { characters: [], stories: [], personas: [], skipped: [{ type: 'story', name: existing.title, existing_id: existing.id }] }
      return { result, receipt: this.repository.recordImport({ packFormat: STORY_SOURCE_FORMAT, sourceName, strategy, result: { stories: [], skipped: result.skipped } }) }
    }
    if (existing && strategy === 'copy') loaded.source.story_key = this.#uniqueStoryKey(loaded.source.story_key)
    const targetStoryId = existing && strategy === 'replace' ? existing.id : null
    const directory = join(this.root, loaded.source.story_key)
    const manifestPath = join(directory, 'story.tavern.json')
    if (loaded.kind === 'project') {
      const files = projectFiles(loaded.source)
      atomicWriteFiles([...files.entries()].map(([path, content]) => [join(directory, path), content]))
    } else {
      atomicWriteFiles([[manifestPath, prettyJson(loaded.source)]])
    }
    const compiled = this.#compile({ ...loaded, manifestPath }, { targetStoryId, strategy, bindingPath: manifestPath, bindingKind: loaded.kind })
    const result = { characters: compiled.characters, stories: [compiled.story], personas: [], skipped: [] }
    const receipt = this.repository.recordImport({
      packFormat: STORY_SOURCE_FORMAT,
      sourceName,
      strategy,
      result: { characters: result.characters.map(item => item.id), stories: [compiled.story.id], skipped: [] },
    })
    return { result, receipt }
  }

  compilePath(path, { targetStoryId = null, strategy = 'replace', preferredCharacterIds = new Map() } = {}) {
    const loaded = loadStorySourcePath(path)
    return this.#compile(loaded, { targetStoryId, strategy, bindingPath: loaded.manifestPath, bindingKind: loaded.kind, preferredCharacterIds })
  }

  materialize(storyId, { overwrite = false } = {}) {
    const existing = this.binding(storyId)
    if (existing && !overwrite) return { source: loadStorySourcePath(existing.source_path).source, binding: publicBinding(existing, this.root) }
    if (existing && overwrite) return this.syncRuntimeStory(storyId)
    const story = this.repository.getStory(storyId)
    const source = storyToSource(story)
    source.story_key = this.#uniqueStoryKey(source.story_key, storyId)
    const manifestPath = join(this.root, source.story_key, 'story.tavern.json')
    atomicWriteFiles([[manifestPath, prettyJson(source)]])
    this.#bindExistingStory(story, source, manifestPath, 'single')
    return this.get(story.id)
  }

  get(storyId) {
    let binding = this.binding(storyId)
    if (!binding) {
      this.materialize(storyId)
      binding = this.binding(storyId)
    }
    const loaded = loadStorySourcePath(binding.source_path)
    const currentBinding = {
      ...binding,
      source_digest: sha256Hex(stableStringify(loaded.source)),
    }
    return { source: loaded.source, binding: publicBinding(currentBinding, this.root) }
  }

  getRuntimeStory(storyId) {
    this.get(storyId)
    const binding = this.binding(storyId)
    this.compilePath(binding.source_path, { targetStoryId: storyId, strategy: 'replace' })
    const refreshed = this.get(storyId)
    return {
      story: this.repository.getStory(storyId),
      binding: refreshed.binding,
    }
  }

  getRuntimeCharacter(characterId) {
    const character = this.repository.getCharacter(characterId)
    const bindings = this.#characterBindings(character.id).map(binding => {
      const loaded = loadStorySourcePath(binding.source_path)
      const resource = loaded.source.characters.find(item => item.key === binding.character_key)
      assert(resource, `Story source no longer contains character key “${binding.character_key}”`, 409, 'story_source_binding_failed')
      const rel = relative(this.root, binding.source_path)
      return {
        story_id: binding.story_id,
        story_key: binding.story_key,
        story_title: this.repository.getStory(binding.story_id).title,
        character_key: binding.character_key,
        kind: binding.source_kind,
        path: rel && !rel.startsWith(`..${sep}`) && !isAbsolute(rel) ? rel : basename(binding.source_path),
        linked: rel.startsWith(`..${sep}`) || isAbsolute(rel),
        resource_digest: sha256Hex(stableStringify(resource.card)),
      }
    })
    return {
      character,
      bindings,
      edit_token: sha256Hex(stableStringify({ character: comparableCharacter(character), slug: character.slug, bindings })),
    }
  }

  save(storyId, input, { expectedDigest = null, preferredCharacterIds = new Map() } = {}) {
    const binding = this.binding(storyId)
    assert(binding, 'Story has no editable source binding', 404, 'story_source_not_found')
    const next = loadStorySource(input).source
    assert(next.story_key === binding.story_key, 'story_key cannot be changed from the browser editor; rename the source project instead', 409, 'story_key_immutable')
    const current = loadStorySourcePath(binding.source_path)
    const currentDigest = sha256Hex(stableStringify(current.source))
    assert(!expectedDigest || expectedDigest === currentDigest, 'The Story source changed after you opened it. Reload before saving so newer file edits are not overwritten.', 409, 'story_source_conflict')
    this.#writeBack(current, next)
    const compiled = this.compilePath(binding.source_path, { targetStoryId: storyId, strategy: 'replace', preferredCharacterIds })
    return { source: loadStorySourcePath(binding.source_path).source, binding: publicBinding(this.binding(storyId), this.root), story: compiled.story }
  }

  createRuntimeStory(input) {
    const title = cleanText(input.title, 200)
    assert(title, 'Story title is required')
    return this.db.transaction(() => {
      const clientCharacterIds = new Map()
      const cast = (Array.isArray(input.cast) ? input.cast : []).map((member, index) => {
        const actorInput = plainObject(member.character) ? member.character : (!member.character_id && member.name ? member : null)
        const character = member.character_id
          ? this.repository.getCharacter(member.character_id)
          : this.repository.createCharacter(actorInput ?? {})
        if (member.client_id) clientCharacterIds.set(member.client_id, character.id)
        return {
          character_id: character.id,
          role: member.role ?? '',
          public_context: member.public_context ?? '',
          private_context: member.private_context ?? '',
          sort_order: index,
          metadata: member.metadata ?? {},
          character,
        }
      })
      const story = {
        title,
        slug: this.#uniqueStoryKey(input.slug || title),
        hook: input.hook ?? input.summary ?? '',
        summary: input.summary ?? '',
        premise: input.premise ?? '',
        genre: input.genre ?? '',
        tone: input.tone ?? '',
        opening_scene: input.opening_scene ?? '',
        player_role: input.player_role ?? '',
        world_rules: input.world_rules ?? [],
        lore: input.lore ?? [],
        initial_state: input.initial_state ?? {},
        author_notes: input.author_notes ?? '',
        content_warnings: input.content_warnings ?? [],
        tags: input.tags ?? [],
        scenes: deepMapStrings(input.scenes ?? [], clientCharacterIds),
        runtime: {
          actions: [], agendas: [], prompt_graph: {}, world_schema: {}, state_visibility: [], transforms: [], automations: [],
          ...deepMapStrings(input.runtime ?? {}, clientCharacterIds),
        },
        metadata: input.metadata ?? {},
        share_policy: input.share_policy ?? {},
        visibility: input.visibility ?? 'private',
        cover_url: input.cover_url ?? '',
        cast,
      }
      const source = storyToSource(story)
      const manifestPath = join(this.root, source.story_key, 'story.tavern.json')
      const preferredCharacterIds = new Map(source.characters.map((resource, index) => [resource.key, cast[index].character_id]))
      atomicWriteFiles([[manifestPath, prettyJson(source)]])
      return this.#compile({ source, manifest: source, kind: 'single', manifestPath }, {
        strategy: 'replace',
        bindingPath: manifestPath,
        bindingKind: 'single',
        preferredCharacterIds,
      }).story
    })
  }

  updateRuntimeStory(storyId, input, { expectedDigest = null } = {}) {
    const opened = this.get(storyId)
    assert(!expectedDigest || expectedDigest === opened.binding.digest, 'The Story source changed after you opened the editor. Reload before saving so newer file edits are not overwritten.', 409, 'story_source_conflict')
    const existingBinding = this.binding(storyId)
    this.compilePath(existingBinding.source_path, { targetStoryId: storyId, strategy: 'replace' })
    const currentStory = this.repository.getStory(storyId)
    return this.db.transaction(() => {
      const clientCharacterIds = new Map()
      const cast = input.cast === undefined ? currentStory.cast : input.cast.map((member, index) => {
        const nested = plainObject(member.character) ? member.character : null
        let character
        if (member.character_id) {
          character = this.repository.getCharacter(member.character_id)
          if (nested) {
            const { id: _id, slug: _slug, created_at: _createdAt, updated_at: _updatedAt, ...editable } = nested
            character = this.repository.updateCharacter(character.id, editable)
          }
        } else {
          character = this.repository.createCharacter(nested ?? member)
        }
        if (member.client_id) clientCharacterIds.set(member.client_id, character.id)
        return {
          character_id: character.id,
          role: member.role ?? '',
          public_context: member.public_context ?? '',
          private_context: member.private_context ?? '',
          sort_order: index,
          metadata: member.metadata ?? {},
          character,
        }
      })
      const proposed = {
        ...currentStory,
        ...input,
        ...input.scenes !== undefined ? { scenes: deepMapStrings(input.scenes, clientCharacterIds) } : {},
        ...input.runtime !== undefined ? { runtime: deepMapStrings(input.runtime, clientCharacterIds) } : {},
        cast,
      }
      const binding = this.binding(currentStory.id)
      if (!binding) this.materialize(currentStory.id)
      const loaded = this.get(currentStory.id)
      const characterKeyById = new Map(this.db.raw.prepare('SELECT character_key, character_id FROM story_source_characters WHERE story_id = ?').all(currentStory.id).map(row => [row.character_id, row.character_key]))
      const next = mergeRuntimeIntoSource(loaded.source, proposed, characterKeyById)
      const preferredCharacterIds = new Map(next.cast.map((member, index) => [member.character, cast[index].character_id]))
      return this.save(currentStory.id, next, { expectedDigest: expectedDigest ?? loaded.binding.digest, preferredCharacterIds }).story
    })
  }

  updateRuntimeCharacter(characterId, input, { expectedToken = null } = {}) {
    const opened = this.getRuntimeCharacter(characterId)
    assert(!expectedToken || expectedToken === opened.edit_token, 'The Character or one of its Story source files changed after you opened the editor. Reload before saving so newer edits are not overwritten.', 409, 'character_edit_conflict')
    const bindings = this.#characterBindings(characterId)
    for (const binding of bindings) loadStorySourcePath(binding.source_path)
    const character = this.repository.updateCharacter(characterId, input)
    this.syncRuntimeCharacter(character.id, { character, bindings })
    return this.repository.getCharacter(character.id)
  }

  syncRuntimeCharacter(characterId, { character = null, bindings = null } = {}) {
    const runtimeCharacterValue = character ?? this.repository.getCharacter(characterId)
    const targets = bindings ?? this.#characterBindings(runtimeCharacterValue.id)
    for (const binding of targets) {
      const current = loadStorySourcePath(binding.source_path)
      const next = structuredClone(current.source)
      const resource = next.characters.find(item => item.key === binding.character_key)
      assert(resource, `Story source no longer contains character key “${binding.character_key}”`, 409, 'story_source_binding_failed')
      const replacements = new Map(this.db.raw.prepare(
        'SELECT character_id, character_key FROM story_source_characters WHERE story_id = ?',
      ).all(binding.story_id).map(row => [row.character_id, row.character_key]))
      replacements.set(binding.story_id, binding.story_key)
      resource.card = deepMapStrings(characterToCardV2(runtimeCharacterValue), replacements)
      this.#writeBack(current, next)
      this.compilePath(binding.source_path, { targetStoryId: binding.story_id, strategy: 'replace' })
    }
    return { character: this.repository.getCharacter(runtimeCharacterValue.id), stories: targets.map(item => item.story_id) }
  }

  syncRuntimeStory(storyId) {
    const binding = this.binding(storyId)
    if (!binding) return this.materialize(storyId)
    const current = loadStorySourcePath(binding.source_path)
    const characterKeyById = new Map(this.db.raw.prepare('SELECT character_key, character_id FROM story_source_characters WHERE story_id = ?').all(storyId).map(row => [row.character_id, row.character_key]))
    const source = mergeRuntimeIntoSource(current.source, this.repository.getStory(storyId), characterKeyById)
    this.#writeBack(current, source)
    return this.compilePath(binding.source_path, { targetStoryId: storyId, strategy: 'replace' })
  }

  remove(storyId) {
    const story = this.repository.getStory(storyId)
    const active = this.db.raw.prepare('SELECT COUNT(*) AS count FROM playthroughs WHERE story_id = ?').get(story.id).count
    assert(active === 0, 'Story has playthroughs; archive or duplicate it instead', 409, 'story_in_use')
    const binding = this.binding(story.id)
    let moved = null
    if (binding) {
      const sourcePath = resolve(binding.source_path)
      const rel = relative(this.root, sourcePath)
      const insideRoot = rel && !rel.startsWith(`..${sep}`) && !isAbsolute(rel)
      if (insideRoot && existsSync(sourcePath)) {
        const sourceParent = dirname(sourcePath)
        const target = dirname(sourceParent) === this.root ? sourceParent : sourcePath
        const trash = join(this.root, '.trash')
        mkdirSync(trash, { recursive: true, mode: 0o700 })
        moved = join(trash, `${Date.now()}-${basename(target)}`)
        renameSync(target, moved)
      }
    }
    try { this.repository.deleteStory(story.id) } catch (error) {
      if (moved && existsSync(moved)) {
        const original = dirname(binding.source_path) === this.root ? binding.source_path : dirname(binding.source_path)
        renameSync(moved, original)
      }
      throw error
    }
    return { deleted: true, source_retained: Boolean(binding && !moved), recovery_path: moved ? relative(this.root, moved) : null }
  }

  #compile(loaded, { targetStoryId = null, strategy = 'replace', bindingPath, bindingKind, preferredCharacterIds = new Map() }) {
    const source = loaded.source
    let story = targetStoryId ? this.repository.getStory(targetStoryId) : this.#findStoryByKey(source.story_key)
    if (story && strategy === 'copy') story = null
    const characterIds = new Map()
    const savedCharacters = []
    this.db.transaction(() => {
      for (const resource of source.characters) {
        const mapped = story ? this.db.raw.prepare('SELECT character_id FROM story_source_characters WHERE story_id = ? AND character_key = ?').get(story.id, resource.key) : null
        let character = mapped
          ? this.repository.getCharacter(mapped.character_id)
          : preferredCharacterIds.has(resource.key)
            ? this.repository.getCharacter(preferredCharacterIds.get(resource.key))
            : null
        if (!character && story && strategy === 'replace') character = story.cast.find(member => member.character.slug === resource.key)?.character ?? null
        const input = runtimeCharacter(resource)
        if (character) {
          const proposed = { ...character, ...input, slug: character.slug }
          if (comparableCharacter(character) !== comparableCharacter(proposed)) character = this.repository.updateCharacter(character.id, proposed)
        } else character = this.repository.createCharacter(input)
        characterIds.set(resource.key, character.id)
        savedCharacters.push(character)
      }
      const input = runtimeStory(source, characterIds)
      if (story) {
        const proposed = { ...story, ...input, slug: story.slug }
        if (comparableStory(story) !== comparableStory(proposed)) story = this.repository.updateStory(story.id, proposed)
      } else story = this.repository.createStory(input)
      this.db.raw.prepare('DELETE FROM story_source_characters WHERE story_id = ?').run(story.id)
      for (const [characterKey, characterId] of characterIds) {
        this.db.raw.prepare('INSERT INTO story_source_characters(story_id, character_key, character_id) VALUES (?, ?, ?)').run(story.id, characterKey, characterId)
      }
      const timestamp = nowIso()
      this.db.raw.prepare(`
        INSERT INTO story_sources(story_id, story_key, source_path, source_kind, source_digest, source_version, loaded_at, updated_at, last_error)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)
        ON CONFLICT(story_id) DO UPDATE SET story_key=excluded.story_key, source_path=excluded.source_path,
          source_kind=excluded.source_kind, source_digest=excluded.source_digest, source_version=excluded.source_version,
          loaded_at=excluded.loaded_at, updated_at=excluded.updated_at, last_error=NULL
      `).run(story.id, source.story_key, resolve(bindingPath), bindingKind, sha256Hex(stableStringify(source)), Number(source.format_version), timestamp, timestamp)
    })
    this.db.audit('story_source.compiled', 'story', story.id, { story_key: source.story_key, source_kind: bindingKind })
    return { story: this.repository.getStory(story.id), characters: savedCharacters, source }
  }

  #bindExistingStory(story, source, manifestPath, kind) {
    const bySlug = new Map(story.cast.map(member => [member.character.slug, member.character_id]))
    this.db.transaction(() => {
      const timestamp = nowIso()
      this.db.raw.prepare(`
        INSERT INTO story_sources(story_id, story_key, source_path, source_kind, source_digest, source_version, loaded_at, updated_at, last_error)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)
        ON CONFLICT(story_id) DO UPDATE SET story_key=excluded.story_key, source_path=excluded.source_path,
          source_kind=excluded.source_kind, source_digest=excluded.source_digest, source_version=excluded.source_version,
          loaded_at=excluded.loaded_at, updated_at=excluded.updated_at, last_error=NULL
      `).run(story.id, source.story_key, resolve(manifestPath), kind, sha256Hex(stableStringify(source)), Number(source.format_version), timestamp, timestamp)
      this.db.raw.prepare('DELETE FROM story_source_characters WHERE story_id = ?').run(story.id)
      for (const resource of source.characters) {
        const characterId = bySlug.get(resource.key)
        assert(characterId, `Cannot bind character key “${resource.key}” to the existing story`, 409, 'story_source_binding_failed')
        this.db.raw.prepare('INSERT INTO story_source_characters(story_id, character_key, character_id) VALUES (?, ?, ?)').run(story.id, resource.key, characterId)
      }
    })
    this.db.audit('story_source.materialized', 'story', story.id, { story_key: source.story_key })
  }

  #writeBack(current, next) {
    const manifest = structuredClone(next)
    const writes = []
    const currentCharacters = new Map(current.manifest.characters.map(item => [item.key, item]))
    manifest.characters = next.characters.map(item => {
      const prior = currentCharacters.get(item.key)
      if (prior?.source) {
        const path = safeResourcePath(dirname(current.manifestPath), prior.source)
        writes.push([path, prettyJson(item.card)])
        return { key: item.key, source: prior.source, ...item.extensions ? { extensions: item.extensions } : {} }
      }
      return item
    })
    const currentLorebooks = new Map((current.manifest.lorebooks ?? []).map(item => [item.key, item]))
    manifest.lorebooks = (next.lorebooks ?? []).map(item => {
      const prior = currentLorebooks.get(item.key)
      if (prior?.source) {
        const path = safeResourcePath(dirname(current.manifestPath), prior.source)
        writes.push([path, prettyJson(item.book)])
        return { key: item.key, source: prior.source, ...item.visibility ? { visibility: item.visibility } : {}, ...item.extensions ? { extensions: item.extensions } : {} }
      }
      return item
    })
    const currentScenes = new Map((current.manifest.scenes ?? []).map(item => [item.key, item]))
    manifest.scenes = (next.scenes ?? []).map(item => {
      const prior = currentScenes.get(item.key)
      if (prior?.source) {
        const path = safeResourcePath(dirname(current.manifestPath), prior.source)
        writes.push([path, item.content ?? ''])
        const { content, ...descriptor } = item
        return { ...descriptor, source: prior.source }
      }
      return item
    })
    for (const collection of ['actions', 'agendas']) {
      const currentResources = new Map((current.manifest[collection] ?? []).map(item => [item.key, item]))
      manifest[collection] = (next[collection] ?? []).map(item => {
        const prior = currentResources.get(item.key)
        if (prior?.source) {
          const path = safeResourcePath(dirname(current.manifestPath), prior.source)
          writes.push([path, prettyJson(item)])
          return { key: item.key, source: prior.source }
        }
        return item
      })
    }
    writes.push([current.manifestPath, prettyJson(manifest)])
    atomicWriteFiles(writes)
  }

  #findStoryByKey(storyKey) {
    const bound = this.db.raw.prepare('SELECT story_id FROM story_sources WHERE story_key = ?').get(storyKey)
    if (bound) return this.repository.getStory(bound.story_id)
    return this.repository.listStories().find(item => item.slug === storyKey) ?? null
  }

  #characterBindings(characterId) {
    return this.db.raw.prepare(`
      SELECT ssc.story_id, ssc.character_key, ss.story_key, ss.source_path, ss.source_kind
      FROM story_source_characters ssc
      JOIN story_sources ss ON ss.story_id = ssc.story_id
      WHERE ssc.character_id = ?
      ORDER BY ss.story_key
    `).all(characterId)
  }

  #uniqueStoryKey(value, currentStoryId = null) {
    const base = slugify(value, 'story')
    let candidate = base
    let suffix = 2
    while (this.db.raw.prepare('SELECT 1 FROM story_sources WHERE story_key = ? AND (? IS NULL OR story_id <> ?)').get(candidate, currentStoryId, currentStoryId)
      || existsSync(join(this.root, candidate))) candidate = `${base.slice(0, 115)}-${suffix++}`
    return candidate
  }

  #recordError(storyId, message) {
    this.db.raw.prepare('UPDATE story_sources SET last_error = ?, updated_at = ? WHERE story_id = ?').run(cleanText(message, 4000), nowIso(), storyId)
  }
}
