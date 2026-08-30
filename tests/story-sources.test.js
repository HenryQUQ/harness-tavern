import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { createApp } from '../src/app.js'
import { loadStorySource, loadStorySourcePath, STORY_PROJECT_BUNDLE_FORMAT, writeStoryProject } from '../src/story/source.js'
import { SAMPLE_IDS } from '../src/domain/seed.js'
import { jsonRequest, testApp } from './helpers.js'

const EXAMPLE_PROJECT = fileURLToPath(new URL('../examples/stories/midnight-at-the-glass-observatory', import.meta.url))

await test('every runtime Story has a canonical editable source without database identifiers', async t => {
  const { app, dir } = await testApp(t)
  const loaded = app.storySources.get(SAMPLE_IDS.story)
  const text = JSON.stringify(loaded.source)
  assert.equal(loaded.source.format, 'harness-tavern-story')
  assert.equal(loaded.source.format_version, 2)
  assert.equal(loaded.source.characters.length, 3)
  assert.equal(loaded.source.cast.length, 3)
  assert.equal(loaded.binding.kind, 'single')
  assert.equal(loaded.binding.linked, false)
  assert.doesNotMatch(text, /story_glass_observatory|char_mira_vale|char_rowan_ash|char_lyra_voss/)
  assert.doesNotMatch(text, /exported_at|integrity|source_digest/)
  const row = app.storySources.binding(SAMPLE_IDS.story)
  assert.ok(row.source_path.startsWith(dir))
  assert.ok(existsSync(row.source_path))
  const before = readFileSync(row.source_path, 'utf8')
  app.storySources.syncRuntimeStory(SAMPLE_IDS.story)
  assert.equal(readFileSync(row.source_path, 'utf8'), before)
})

await test('the browser source API validates, saves, and rebuilds the Story projection', async t => {
  const { app, baseUrl } = await testApp(t)
  const before = await jsonRequest(baseUrl, `/api/story-sources/${SAMPLE_IDS.story}`)
  assert.equal(before.response.status, 200)
  const sourcePath = app.storySources.binding(SAMPLE_IDS.story).source_path
  const manuallyEdited = structuredClone(before.body.source)
  manuallyEdited.story.title = 'Edited outside the browser first'
  writeFileSync(sourcePath, `${JSON.stringify(manuallyEdited, null, 2)}\n`)
  const refreshed = await jsonRequest(baseUrl, `/api/story-sources/${SAMPLE_IDS.story}`)
  assert.notEqual(refreshed.body.binding.digest, before.body.binding.digest)
  assert.equal(refreshed.body.source.story.title, 'Edited outside the browser first')
  refreshed.body.source.story.title = 'Edited directly in Story source'
  refreshed.body.source.characters[0].card.data.name = 'Mira Source-Edited'
  const saved = await jsonRequest(baseUrl, `/api/story-sources/${SAMPLE_IDS.story}`, {
    method: 'PUT',
    body: JSON.stringify({ source: refreshed.body.source, expected_digest: refreshed.body.binding.digest }),
  })
  assert.equal(saved.response.status, 200)
  assert.equal(saved.body.story.title, 'Edited directly in Story source')
  assert.equal(app.repository.getStory(SAMPLE_IDS.story).cast[0].character.name, 'Mira Source-Edited')
  const onDisk = JSON.parse(readFileSync(app.storySources.binding(SAMPLE_IDS.story).source_path, 'utf8'))
  assert.equal(onDisk.story.title, 'Edited directly in Story source')
  const stale = await jsonRequest(baseUrl, `/api/story-sources/${SAMPLE_IDS.story}`, {
    method: 'PUT',
    body: JSON.stringify({ source: refreshed.body.source, expected_digest: refreshed.body.binding.digest }),
  })
  assert.equal(stale.response.status, 409)
  assert.equal(stale.body.error.code, 'story_source_conflict')
  const exported = await jsonRequest(baseUrl, `/api/exports/stories/${SAMPLE_IDS.story}?format=source`)
  assert.equal(exported.body.format, 'harness-tavern-story')
  assert.match(exported.response.headers.get('content-disposition'), /\.story\.tavern\.json/)
})

await test('a multi-file Story project round-trips relative Character, Lorebook, and Markdown files', async t => {
  const { app, dir } = await testApp(t)
  const source = structuredClone(app.storySources.get(SAMPLE_IDS.story).source)
  source.story_key = 'project-round-trip'
  source.story.title = 'Project round trip'
  const projectDirectory = join(dir, 'git-story-project')
  writeStoryProject(source, projectDirectory)
  const loaded = loadStorySourcePath(projectDirectory)
  assert.equal(loaded.kind, 'project')
  assert.equal(loaded.source.characters.length, 3)
  assert.equal(loaded.source.lorebooks.length, 1)
  assert.equal(loaded.source.scenes.length, 3)
  const compiled = app.storySources.compilePath(projectDirectory, { strategy: 'copy' })
  assert.equal(compiled.story.title, 'Project round trip')
  assert.equal(compiled.story.cast.length, 3)
  const manifestPath = join(projectDirectory, 'story.tavern.json')
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  assert.equal(manifest.characters[0].source, `characters/${source.characters[0].key}.character.json`)
  assert.doesNotMatch(JSON.stringify(manifest), /char_mira_vale|story_glass_observatory/)
  app.storySources.updateRuntimeStory(compiled.story.id, { tone: 'Updated through the compatibility API' })
  const preserved = JSON.parse(readFileSync(manifestPath, 'utf8'))
  assert.equal(preserved.characters[0].source, manifest.characters[0].source)
  assert.equal(preserved.lorebooks[0].source, manifest.lorebooks[0].source)
  assert.equal(preserved.scenes[0].source, manifest.scenes[0].source)
  manifest.story.title = 'Changed with a text editor'
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
  writeFileSync(join(projectDirectory, manifest.scenes[0].source), '# Edited scene\n\nThis text came from Markdown.\n')
  app.storySources.compilePath(projectDirectory, { targetStoryId: compiled.story.id, strategy: 'replace' })
  const updated = app.repository.getStory(compiled.story.id)
  assert.equal(updated.title, 'Changed with a text editor')
  assert.match(updated.scenes[0].content, /came from Markdown/)
})

await test('the checked-in multi-file example is valid and directly loadable', () => {
  const loaded = loadStorySourcePath(EXAMPLE_PROJECT)
  assert.equal(loaded.kind, 'project')
  assert.equal(loaded.source.story_key, 'midnight-at-the-glass-observatory')
  assert.equal(loaded.source.characters.length, 3)
  assert.match(loaded.source.scenes[0].content, /powerless orrery/i)
  assert.equal(loaded.source.lorebooks[0].book.entries[1].visibility, 'director')
})

await test('the Story source schema does not impose an arbitrary twenty-character cast ceiling', async t => {
  const { app } = await testApp(t)
  const source = structuredClone(app.storySources.get(SAMPLE_IDS.story).source)
  const card = source.characters[0].card
  source.story_key = 'large-ensemble'
  source.story.title = 'Large ensemble'
  source.characters = Array.from({ length: 24 }, (_value, index) => ({
    key: `ensemble-${index + 1}`,
    card: { ...structuredClone(card), data: { ...structuredClone(card.data), name: `Ensemble ${index + 1}` } },
  }))
  source.cast = source.characters.map(character => ({ character: character.key, role: 'Ensemble member' }))
  source.scenes = [{ ...source.scenes[0], active_characters: source.characters.map(character => character.key) }]
  source.agendas = []
  source.state_visibility = []
  const loaded = loadStorySource(source).source
  assert.equal(loaded.characters.length, 24)
  assert.equal(loaded.cast.length, 24)
  assert.equal(loaded.scenes[0].active_characters.length, 24)
})

await test('common SillyTavern World Info entries normalize into the Story lorebook contract', () => {
  const loaded = loadStorySourcePath(EXAMPLE_PROJECT)
  const manifest = structuredClone(loaded.manifest)
  manifest.lorebooks = [{ key: 'world-info', source: 'lore/world-info.json', visibility: 'director' }]
  const bundle = {
    format: STORY_PROJECT_BUNDLE_FORMAT,
    manifest_path: 'project/story.tavern.json',
    files: {
      'project/story.tavern.json': JSON.stringify(manifest),
      'project/lore/world-info.json': JSON.stringify({ entries: { 0: { uid: 0, key: ['alignment', 'gate'], comment: 'Hidden gate', content: 'The alignment opens an erased gate.', constant: true } } }),
      ...Object.fromEntries(loaded.manifest.characters.map(character => [`project/${character.source}`, readFileSync(join(EXAMPLE_PROJECT, character.source), 'utf8')])),
      ...Object.fromEntries(loaded.manifest.scenes.map(scene => [`project/${scene.source}`, readFileSync(join(EXAMPLE_PROJECT, scene.source), 'utf8')])),
      ...Object.fromEntries(loaded.manifest.actions.map(action => [`project/${action.source}`, readFileSync(join(EXAMPLE_PROJECT, action.source), 'utf8')])),
      ...Object.fromEntries(loaded.manifest.agendas.map(agenda => [`project/${agenda.source}`, readFileSync(join(EXAMPLE_PROJECT, agenda.source), 'utf8')])),
    },
  }
  const normalized = loadStorySource(bundle).source.lorebooks[0].book.entries[0]
  assert.equal(normalized.key, 'hidden-gate')
  assert.deepEqual(normalized.keywords, ['alignment', 'gate'])
  assert.equal(normalized.visibility, 'director')
  assert.equal(normalized.constant, true)
})

await test('source validation rejects broken references and project path traversal', async t => {
  const { app } = await testApp(t)
  const broken = structuredClone(app.storySources.get(SAMPLE_IDS.story).source)
  broken.cast[0].character = 'missing-character'
  assert.throws(() => app.storySources.preview(broken), error => error.code === 'missing_character_reference')

  const manifest = structuredClone(broken)
  manifest.cast[0].character = manifest.characters[0].key
  manifest.characters[0] = { key: manifest.characters[0].key, source: '../outside.character.json' }
  const bundle = {
    format: STORY_PROJECT_BUNDLE_FORMAT,
    manifest_path: 'project/story.tavern.json',
    files: {
      'project/story.tavern.json': JSON.stringify(manifest),
      'outside.character.json': JSON.stringify(broken.characters[0].card),
    },
  }
  assert.throws(() => app.storySources.preview(bundle), error => error.code === 'invalid_resource_path')
})

await test('manual file edits win over SQLite when the Tavern restarts', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'harness-tavern-source-reload-'))
  const env = { ...process.env, HT_DATA_DIR: dir, HT_PORT: '0', HT_HOST: '127.0.0.1', HT_LOG_LEVEL: 'error' }
  const sink = { log() {}, warn() {}, error() {} }
  let app = createApp({ env, loggerSink: sink })
  t.after(async () => {
    try { await app.close() } catch {}
    rmSync(dir, { recursive: true, force: true })
  })
  const path = app.storySources.binding(SAMPLE_IDS.story).source_path
  const manifest = JSON.parse(readFileSync(path, 'utf8'))
  manifest.story.title = 'Reloaded from the canonical file'
  writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`)
  await app.close()
  app = createApp({ env, loggerSink: sink })
  assert.equal(app.repository.getStory(SAMPLE_IDS.story).title, 'Reloaded from the canonical file')
  assert.equal(app.storySourceStatus.errors.length, 0)
})

await test('Story source import previews conflicts and creates an independent editable copy', async t => {
  const { app, baseUrl } = await testApp(t)
  const source = app.storySources.get(SAMPLE_IDS.story).source
  const preview = await jsonRequest(baseUrl, '/api/import/preview', { method: 'POST', body: JSON.stringify({ content: source }) })
  assert.equal(preview.response.status, 200)
  assert.equal(preview.body.kind, 'story-source')
  assert.equal(preview.body.conflicts.length, 1)
  const imported = await jsonRequest(baseUrl, '/api/import/apply', {
    method: 'POST',
    body: JSON.stringify({ content: source, strategy: 'copy', source_name: 'source-copy.story.tavern.json' }),
  })
  assert.equal(imported.response.status, 201)
  assert.equal(imported.body.result.stories.length, 1)
  assert.notEqual(imported.body.result.stories[0].id, SAMPLE_IDS.story)
  assert.equal(imported.body.result.stories[0].cast.length, 3)
  assert.ok(app.storySources.binding(imported.body.result.stories[0].id))
  assert.equal(app.sharing.exportStory(SAMPLE_IDS.story).format, 'harness-tavern-pack')
})

await test('a new Story source never captures an unrelated same-key runtime Character', async t => {
  const { app } = await testApp(t)
  const original = app.repository.getCharacter(SAMPLE_IDS.mira)
  const source = structuredClone(app.storySources.get(SAMPLE_IDS.story).source)
  source.story_key = 'independent-same-key-story'
  source.story.title = 'Independent same-key Story'
  source.characters[0].card.data.name = 'Independent Mira'
  const imported = app.storySources.import(source, { strategy: 'replace', sourceName: 'independent source' })
  const story = imported.result.stories[0]
  assert.equal(app.repository.getCharacter(SAMPLE_IDS.mira).name, original.name)
  assert.notEqual(story.cast[0].character_id, SAMPLE_IDS.mira)
  assert.equal(story.cast[0].character.name, 'Independent Mira')
})

await test('a browser folder bundle imports the complete multi-file project', async t => {
  const { app, baseUrl } = await testApp(t)
  const names = [
    'story.tavern.json',
    'characters/mira-vale.character.json',
    'characters/rowan-ash.character.json',
    'characters/lyra-voss.character.json',
    'lore/observatory.lorebook.json',
    'scenes/001-opening.md',
    'scenes/002-archive.md',
    'actions/take.action.json',
    'actions/unlock.action.json',
    'actions/open.action.json',
    'agendas/mira-protect-archive.agenda.json',
    'agendas/rowan-survive.agenda.json',
    'agendas/lyra-stop-gate.agenda.json',
  ]
  const files = Object.fromEntries(names.map(name => [`observatory-project/${name}`, readFileSync(join(EXAMPLE_PROJECT, name), 'utf8')]))
  const bundle = { format: STORY_PROJECT_BUNDLE_FORMAT, manifest_path: 'observatory-project/story.tavern.json', files }
  const preview = await jsonRequest(baseUrl, '/api/import/preview', { method: 'POST', body: JSON.stringify({ content: bundle }) })
  assert.equal(preview.response.status, 200)
  assert.equal(preview.body.source_kind, 'project')
  const imported = await jsonRequest(baseUrl, '/api/import/apply', {
    method: 'POST',
    body: JSON.stringify({ content: bundle, strategy: 'copy', source_name: 'browser folder' }),
  })
  assert.equal(imported.response.status, 201)
  const story = imported.body.result.stories[0]
  assert.equal(story.cast.length, 3)
  assert.match(story.scenes[0].content, /powerless orrery/i)
  assert.equal(app.storySources.binding(story.id).source_kind, 'project')
})

await test('legacy Story create/update APIs are source-first and deletion is recoverable', async t => {
  const { app, baseUrl } = await testApp(t)
  const created = await jsonRequest(baseUrl, '/api/stories', {
    method: 'POST',
    body: JSON.stringify({
      title: 'A one-character file-first Story',
      premise: 'A lighthouse keeper hears a reply from an empty sea.',
      opening_scene: 'The lamp goes dark.',
      player_role: 'A visitor at the lighthouse.',
      cast: [{ character_id: SAMPLE_IDS.mira, role: 'Lighthouse keeper', public_context: '', private_context: '' }],
      scenes: [{ id: 'lamp-room', title: 'The dark lamp', active_character_ids: [SAMPLE_IDS.mira] }],
    }),
  })
  assert.equal(created.response.status, 201)
  const binding = app.storySources.binding(created.body.id)
  assert.ok(binding)
  const source = JSON.parse(readFileSync(binding.source_path, 'utf8'))
  assert.equal(source.cast.length, 1)
  assert.equal(source.cast[0].character, 'mira-vale')
  assert.doesNotMatch(JSON.stringify(source), /char_mira_vale/)

  const updated = await jsonRequest(baseUrl, `/api/stories/${created.body.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ tone: 'Quiet and uncanny' }),
  })
  assert.equal(updated.response.status, 200)
  assert.equal(updated.body.tone, 'Quiet and uncanny')
  assert.equal(JSON.parse(readFileSync(binding.source_path, 'utf8')).story.tone, 'Quiet and uncanny')

  const manual = JSON.parse(readFileSync(binding.source_path, 'utf8'))
  manual.story.title = 'Manual title survives a Character edit'
  writeFileSync(binding.source_path, `${JSON.stringify(manual, null, 2)}\n`)
  const storyCharacterId = created.body.cast[0].character_id
  assert.equal(storyCharacterId, SAMPLE_IDS.mira)
  const characterUpdated = await jsonRequest(baseUrl, `/api/characters/${storyCharacterId}`, {
    method: 'PATCH',
    body: JSON.stringify({ name: 'Mira edited through the compatibility API' }),
  })
  assert.equal(characterUpdated.response.status, 200)
  const afterCharacterEdit = JSON.parse(readFileSync(binding.source_path, 'utf8'))
  assert.equal(afterCharacterEdit.story.title, 'Manual title survives a Character edit')
  assert.equal(afterCharacterEdit.characters[0].card.data.name, 'Mira edited through the compatibility API')
  assert.equal(app.repository.getStory(created.body.id).title, 'Manual title survives a Character edit')

  const deleted = await jsonRequest(baseUrl, `/api/stories/${created.body.id}`, { method: 'DELETE' })
  assert.equal(deleted.response.status, 200)
  assert.equal(deleted.body.deleted, true)
  assert.ok(deleted.body.recovery_path)
  assert.ok(existsSync(join(app.config.storySourceDir, deleted.body.recovery_path)))
})

await test('migration 7 upgrades a database-only Story without losing runtime content', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'harness-tavern-source-migration-'))
  const env = { ...process.env, HT_DATA_DIR: dir, HT_PORT: '0', HT_HOST: '127.0.0.1', HT_LOG_LEVEL: 'error' }
  const sink = { log() {}, warn() {}, error() {} }
  let app = createApp({ env, loggerSink: sink })
  t.after(async () => {
    try { await app.close() } catch {}
    rmSync(dir, { recursive: true, force: true })
  })
  const before = app.repository.getStory(SAMPLE_IDS.story)
  app.db.raw.exec('DROP TABLE story_source_characters; DROP TABLE story_sources; DELETE FROM schema_migrations WHERE version = 7;')
  rmSync(join(dir, 'stories'), { recursive: true, force: true })
  await app.close()
  app = createApp({ env, loggerSink: sink })
  const after = app.repository.getStory(SAMPLE_IDS.story)
  assert.equal(after.title, before.title)
  assert.equal(after.cast.length, before.cast.length)
  assert.ok(app.db.raw.prepare('SELECT 1 FROM schema_migrations WHERE version = 7').get())
  assert.ok(app.storySources.binding(SAMPLE_IDS.story))
})
