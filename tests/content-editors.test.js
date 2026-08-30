import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { jsonRequest, testApp } from './helpers.js'
import { SAMPLE_IDS } from '../src/domain/seed.js'

await test('every Character has a complete creator editor contract with source-aware conflict protection', async t => {
  const { app, baseUrl } = await testApp(t)
  const player = await jsonRequest(baseUrl, `/api/characters/${SAMPLE_IDS.mira}`)
  assert.equal(player.response.status, 200)
  assert.equal(player.body.secrets, undefined)
  assert.equal(player.body.creator_notes, undefined)
  assert.equal(typeof player.body.scenario, 'string')

  const opened = await jsonRequest(baseUrl, `/api/creator/characters/${SAMPLE_IDS.mira}`)
  assert.equal(opened.response.status, 200)
  assert.ok(opened.body.edit_token)
  assert.equal(opened.body.bindings.length, 1)
  assert.ok(opened.body.bindings[0].resource_digest)
  assert.ok(Array.isArray(opened.body.character.secrets))

  const edited = {
    ...opened.body.character,
    name: 'Mira, fully edited',
    description: 'A complete public description.',
    personality: 'Patient until the archive is threatened.',
    appearance: 'Ink-dark coat and silver spectacles.',
    scenario: 'The player arrives during a failing observatory shift.',
    first_message: 'You came before the last light went out.',
    speech_style: 'Precise, restrained, quietly warm.',
    goals: ['Protect the archive', 'Trust the player when facts support it'],
    secrets: ['She moved the forbidden index.'],
    boundaries: ['Never decides the player’s thoughts or actions.'],
    avatar_url: 'https://images.example.test/mira.webp',
    tags: ['archivist', 'slow-burn'],
    creator_notes: 'Reveal the index only after a causal discovery.',
    metadata: { example_dialogue: '“Facts first.”', alternate_greetings: ['You returned.'], custom: { weight: 2 } },
    extensions: { community: { theme: 'observatory' } },
  }
  const saved = await jsonRequest(baseUrl, `/api/creator/characters/${SAMPLE_IDS.mira}`, {
    method: 'PUT',
    body: JSON.stringify({ character: edited, expected_token: opened.body.edit_token }),
  })
  assert.equal(saved.response.status, 200)
  assert.equal(saved.body.character.name, edited.name)
  assert.deepEqual(saved.body.character.goals, edited.goals)
  assert.deepEqual(saved.body.character.secrets, edited.secrets)
  assert.deepEqual(saved.body.character.metadata, edited.metadata)
  assert.deepEqual(saved.body.character.extensions, edited.extensions)
  assert.equal(saved.body.character.avatar_url, edited.avatar_url)
  assert.notEqual(saved.body.edit_token, opened.body.edit_token)

  const source = JSON.parse(readFileSync(app.storySources.binding(SAMPLE_IDS.story).source_path, 'utf8'))
  const miraCard = source.characters.find(item => item.key === opened.body.bindings[0].character_key).card
  assert.equal(miraCard.data.name, edited.name)
  assert.equal(miraCard.data.extensions.harness_tavern.avatar_url, edited.avatar_url)
  assert.deepEqual(miraCard.data.extensions.harness_tavern.secrets, edited.secrets)

  const stale = await jsonRequest(baseUrl, `/api/creator/characters/${SAMPLE_IDS.mira}`, {
    method: 'PUT',
    body: JSON.stringify({ character: { ...edited, name: 'Stale overwrite' }, expected_token: opened.body.edit_token }),
  })
  assert.equal(stale.response.status, 409)
  assert.equal(stale.body.error.code, 'character_edit_conflict')
  assert.equal(app.repository.getCharacter(SAMPLE_IDS.mira).name, edited.name)

  const externallyEdited = JSON.parse(readFileSync(app.storySources.binding(SAMPLE_IDS.story).source_path, 'utf8'))
  const externalCard = externallyEdited.characters.find(item => item.key === opened.body.bindings[0].character_key).card
  externalCard.data.description = 'Changed directly in the canonical Story source.'
  writeFileSync(app.storySources.binding(SAMPLE_IDS.story).source_path, `${JSON.stringify(externallyEdited, null, 2)}\n`)
  const externalConflict = await jsonRequest(baseUrl, `/api/creator/characters/${SAMPLE_IDS.mira}`, {
    method: 'PUT',
    body: JSON.stringify({ character: { ...edited, name: 'Would overwrite the file' }, expected_token: saved.body.edit_token }),
  })
  assert.equal(externalConflict.response.status, 409)
  assert.equal(externalConflict.body.error.code, 'character_edit_conflict')
  assert.equal(JSON.parse(readFileSync(app.storySources.binding(SAMPLE_IDS.story).source_path, 'utf8')).characters.find(item => item.key === opened.body.bindings[0].character_key).card.data.description, externalCard.data.description)
})

await test('every Story has a complete creator editor contract and persists all authored layers', async t => {
  const { app, baseUrl } = await testApp(t)
  const player = await jsonRequest(baseUrl, `/api/stories/${SAMPLE_IDS.story}`)
  assert.equal(player.body.author_notes, undefined)
  assert.equal(player.body.initial_state, undefined)
  assert.equal(player.body.cast[0].private_context, undefined)

  const opened = await jsonRequest(baseUrl, `/api/creator/stories/${SAMPLE_IDS.story}`)
  assert.equal(opened.response.status, 200)
  assert.ok(opened.body.binding.digest)
  assert.ok(opened.body.story.cast[0].private_context)
  assert.ok(Array.isArray(opened.body.story.runtime.actions))

  const edited = structuredClone(opened.body.story)
  Object.assign(edited, {
    title: 'Midnight at the editable observatory',
    hook: 'Every authored layer can change without turning chat into truth.',
    summary: 'A complete editor regression Story.',
    premise: 'The archive and the cast respond to deterministic facts.',
    genre: 'Causal mystery',
    tone: 'Quiet pressure and earned trust',
    opening_scene: 'The dome is dark, the archive is sealed, and the player is expected.',
    player_role: 'An invited investigator',
    world_rules: ['A sealed door must be unlocked before it can open.'],
    initial_state: { world: { archive: { locked: true, open: false } } },
    author_notes: 'Do not reveal Director knowledge without an Observation.',
    content_warnings: ['peril'],
    tags: ['editable', 'mystery'],
    cover_url: 'https://images.example.test/observatory.webp',
    visibility: 'unlisted',
    metadata: { edition: 'creator-workbench' },
    share_policy: { remix: true },
  })
  edited.cast[0].role = 'Keeper of the edited archive'
  edited.cast[0].public_context = 'Mira carries the archive keys.'
  edited.cast[0].private_context = 'Mira knows which index was moved.'
  edited.cast[0].metadata = { spotlight: 'archive' }
  edited.lore = [{ id: 'edited-lore', title: 'The sealed index', content: 'The index moved after midnight.', keywords: ['index'], visibility: 'director' }]
  edited.scenes = [{ id: 'edited-scene', title: 'The sealed archive', location: 'Lower dome', time: 'Midnight', objective: 'Establish who can open the archive.', content: '# The sealed archive\n\nThe lock is physically closed.', active_character_ids: edited.cast.map(item => item.character_id), metadata: { pressure: 3 } }]
  edited.runtime = {
    world_schema: { type: 'object', properties: { world: { type: 'object' } } },
    actions: [{ key: 'inspect-index', label: 'Inspect index', actor: 'user', parameters_schema: { type: 'object' }, preconditions: [], effects: [], observations: [], outcome: 'The index is inspected.' }],
    agendas: [{ id: 'mira-protect-index', owner_id: edited.cast[0].character_id, objective: 'Protect the index until trust is earned.', priority: 70, status: 'active', visibility: 'private' }],
    prompt_graph: { order: ['story', 'state', 'observations'] },
    state_visibility: [{ path: 'world.archive', audience: ['user', edited.cast[0].character_id] }],
  }

  const saved = await jsonRequest(baseUrl, `/api/creator/stories/${SAMPLE_IDS.story}`, {
    method: 'PUT',
    body: JSON.stringify({ story: edited, expected_digest: opened.body.binding.digest }),
  })
  assert.equal(saved.response.status, 200)
  assert.equal(saved.body.story.title, edited.title)
  assert.equal(saved.body.story.cast[0].private_context, edited.cast[0].private_context)
  assert.deepEqual(saved.body.story.initial_state, edited.initial_state)
  assert.deepEqual(saved.body.story.metadata, edited.metadata)
  assert.equal(saved.body.story.runtime.actions[0].key, 'inspect-index')
  assert.equal(saved.body.story.runtime.agendas[0].id, 'mira-protect-index')
  assert.notEqual(saved.body.binding.digest, opened.body.binding.digest)

  const source = app.storySources.get(SAMPLE_IDS.story).source
  assert.equal(source.story.title, edited.title)
  assert.equal(source.cast[0].private_context, edited.cast[0].private_context)
  assert.equal(source.lorebooks[0].book.entries[0].key, 'edited-lore')
  assert.equal(source.scenes[0].key, 'edited-scene')
  assert.equal(source.actions[0].key, 'inspect-index')
  assert.equal(source.agendas[0].key, 'mira-protect-index')

  const stale = await jsonRequest(baseUrl, `/api/creator/stories/${SAMPLE_IDS.story}`, {
    method: 'PUT',
    body: JSON.stringify({ story: { ...edited, title: 'Stale Story overwrite' }, expected_digest: opened.body.binding.digest }),
  })
  assert.equal(stale.response.status, 409)
  assert.equal(stale.body.error.code, 'story_source_conflict')
  assert.equal(app.repository.getStory(SAMPLE_IDS.story).title, edited.title)
})

await test('visual Story editing keeps the complete cast without an arbitrary twenty-member ceiling', async t => {
  const { app, baseUrl } = await testApp(t)
  const opened = await jsonRequest(baseUrl, `/api/creator/stories/${SAMPLE_IDS.story}`)
  const story = structuredClone(opened.body.story)
  for (let index = story.cast.length; index < 24; index += 1) {
    const character = app.repository.createCharacter({ name: `Editable cast member ${index + 1}`, description: `Member ${index + 1}` })
    story.cast.push({ character_id: character.id, role: `Role ${index + 1}`, public_context: '', private_context: '', metadata: {} })
  }
  const saved = await jsonRequest(baseUrl, `/api/creator/stories/${SAMPLE_IDS.story}`, {
    method: 'PUT',
    body: JSON.stringify({ story, expected_digest: opened.body.binding.digest }),
  })
  assert.equal(saved.response.status, 200)
  assert.equal(saved.body.story.cast.length, 24)
  assert.equal(app.repository.getStory(SAMPLE_IDS.story).cast.length, 24)
  assert.equal(app.storySources.get(SAMPLE_IDS.story).source.cast.length, 24)
})

await test('standalone Characters and database-only Stories can enter the same complete editors', async t => {
  const { app, baseUrl } = await testApp(t)
  const character = app.repository.createCharacter({
    name: 'Standalone editable Character',
    description: 'Not referenced by a Story source yet.',
    first_message: 'You can still edit me.',
  })
  const openedCharacter = await jsonRequest(baseUrl, `/api/creator/characters/${character.id}`)
  assert.equal(openedCharacter.response.status, 200)
  assert.deepEqual(openedCharacter.body.bindings, [])
  const savedCharacter = await jsonRequest(baseUrl, `/api/creator/characters/${character.id}`, {
    method: 'PUT',
    body: JSON.stringify({
      character: { ...openedCharacter.body.character, personality: 'Edited without a Story binding.' },
      expected_token: openedCharacter.body.edit_token,
    }),
  })
  assert.equal(savedCharacter.response.status, 200)
  assert.equal(savedCharacter.body.character.personality, 'Edited without a Story binding.')

  const databaseOnlyStory = app.repository.createStory({
    title: 'Database-only Story',
    opening_scene: 'A source will be materialized when the editor opens.',
    cast: [{ character_id: character.id, role: 'Only cast member' }],
  })
  assert.equal(app.storySources.binding(databaseOnlyStory.id), null)
  const openedStory = await jsonRequest(baseUrl, `/api/creator/stories/${databaseOnlyStory.id}`)
  assert.equal(openedStory.response.status, 200)
  assert.ok(openedStory.body.binding.digest)
  assert.ok(app.storySources.binding(databaseOnlyStory.id))
  assert.equal(openedStory.body.story.cast[0].character_id, character.id)
})

await test('Library profiles expose responsive complete Character and Story workbenches', () => {
  const browser = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8')
  const styles = readFileSync(new URL('../public/styles.css', import.meta.url), 'utf8')
  assert.match(browser, /openCharacterEditor\(character\.id\)/)
  assert.match(browser, /openStoryEditor\(story\.id\)/)
  assert.match(browser, /\/api\/creator\/characters\/\$\{encodeURIComponent\(characterId\)\}/)
  assert.match(browser, /\/api\/creator\/stories\/\$\{encodeURIComponent\(storyId\)\}/)
  for (const section of ['Identity', 'Intent & privacy', 'Cast', 'World & lore', 'Scenes', 'Causality', 'Advanced']) assert.match(browser, new RegExp(section.replace(/[&]/g, '\\&')))
  assert.match(styles, /\.modal-workspace/)
  assert.match(styles, /@media \(max-width: 720px\)/)
  assert.match(browser, /role: 'tablist'/)
  assert.match(browser, /'aria-live': 'polite'/)
})
