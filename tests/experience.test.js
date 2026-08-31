import test from 'node:test'
import assert from 'node:assert/strict'
import { testApp, jsonRequest } from './helpers.js'
import { SAMPLE_IDS } from '../src/domain/seed.js'

await test('explicit single-actor content enters the Library as a Story and starts a playthrough', async t => {
  const { app } = await testApp(t)
  const created = app.library.add({
    kind: 'story',
    content: {
      title: 'The Night Signal',
      cast: [{ character: {
        name: 'Elara Vale',
        description: 'A night-shift radio host.',
        personality: 'Patient and direct.',
        first_message: 'The line is open.',
        goals: ['Understand the signal'],
        secrets: ['She has heard it before'],
        boundaries: ['Does not decide the player’s actions'],
      } }],
    },
  })
  assert.equal(created.kind, 'story')
  assert.equal(created.item.cast[0].character.description, 'A night-shift radio host.')
  assert.equal(created.item.cast[0].character.scenario, '')
  assert.deepEqual(created.item.cast[0].character.goals, ['Understand the signal'])

  const { conversation } = app.repository.createPlaythrough({
    story_id: created.item.id,
    persona_id: SAMPLE_IDS.persona,
  })
  const turn = await app.turns.run(conversation.id, { content: 'I heard something impossible on the road tonight.' })
  assert.equal(turn.messages.length, 1)
  assert.equal(turn.messages[0].character_id, 'narrator')
  assert.deepEqual(turn.messages[0].participant_ids, [created.item.cast[0].character_id])
})

await test('explicit Story structure becomes a canonical playable file without generated plot details', async t => {
  const { app } = await testApp(t)
  const created = app.library.add({
    kind: 'story',
    content: {
      title: 'Untold structure',
      cast: [SAMPLE_IDS.mira, SAMPLE_IDS.rowan, SAMPLE_IDS.lyra].map(characterId => ({
        character_id: characterId,
        role: '',
        public_context: '',
        private_context: '',
        metadata: {},
      })),
    },
  })
  assert.equal(created.kind, 'story')
  assert.equal(created.item.cast.length, 3)
  assert.equal(created.item.premise, '')
  assert.equal(created.item.opening_scene, '')
  assert.deepEqual(created.item.scenes, [])
  assert.deepEqual(created.item.runtime.actions, [])
  assert.ok(created.source.digest)
  assert.equal(app.storySources.get(created.item.id).source.story.title, 'Untold structure')

  const playthrough = app.repository.createPlaythrough({ story_id: created.item.id, persona_id: SAMPLE_IDS.persona })
  const turn = await app.turns.run(playthrough.conversation.id, { content: 'Each of you compare what you know, then decide together what we should observe.' })
  assert.equal(turn.messages.length, 1)
  assert.equal(turn.messages[0].character_id, 'narrator')
  assert.deepEqual(turn.messages[0].participant_ids, created.item.cast.map(member => member.character_id))
})

await test('onboarding can update the default persona without asking for technical settings', async t => {
  const { baseUrl } = await testApp(t)
  const profile = await jsonRequest(baseUrl, '/api/user-profile', {
    method: 'PATCH',
    body: JSON.stringify({ name: 'Henry', persona_description: 'A curious visitor.', onboarding_complete: true, sync_default_persona: true }),
  })
  assert.equal(profile.response.status, 200)
  assert.equal(profile.body.name, 'Henry')
  assert.equal(profile.body.onboarding_complete, true)
  const bootstrap = await jsonRequest(baseUrl, '/api/bootstrap')
  const persona = bootstrap.body.personas.find(item => item.id === profile.body.default_persona_id)
  assert.equal(persona.name, 'Henry')
  assert.equal(bootstrap.body.user_profile.onboarding_complete, true)
})

await test('the generic Library API accepts explicit content and rejects fixed-brief generation', async t => {
  const { baseUrl } = await testApp(t)
  const types = await jsonRequest(baseUrl, '/api/library/content-types')
  assert.equal(types.response.status, 200)
  assert.deepEqual(types.body.map(item => item.kind), ['story'])
  assert.ok(types.body.every(item => item.creation_mode === 'explicit' && item.generated === false))

  const story = await jsonRequest(baseUrl, '/api/library/items', {
    method: 'POST',
    body: JSON.stringify({ kind: 'story', content: { title: 'Explicit API Story', cast: [{ character: { name: 'Explicit API Actor' } }] } }),
  })
  assert.equal(story.response.status, 201)
  assert.ok(story.body.source.digest)
  assert.equal(story.body.item.cast[0].role, '')
  assert.equal(story.body.item.cast[0].character.description, '')

  const implicit = await jsonRequest(baseUrl, '/api/library/items', {
    method: 'POST',
    body: JSON.stringify({ kind: 'story', brief: 'Invent the rest for me.' }),
  })
  assert.equal(implicit.response.status, 400)
  assert.equal(implicit.body.error.code, 'explicit_content_required')

  const removed = await jsonRequest(baseUrl, '/api/creator/character-drafts', {
    method: 'POST',
    body: JSON.stringify({ brief: 'A fixed-prompt request.' }),
  })
  assert.equal(removed.response.status, 410)
  assert.equal(removed.body.error.code, 'guided_creation_removed')
})

await test('home is a projection of durable Library items and conversations, not generated drafts', async t => {
  const { app } = await testApp(t)
  app.library.add({ kind: 'story', content: { title: 'Framework Story', cast: [{ character: { name: 'Framework Actor' } }] } })
  const home = app.repository.getHome()
  assert.ok(home.continue.length >= 1)
  assert.equal(Object.hasOwn(home, 'characters'), false)
  assert.ok(home.stories.some(item => item.title === 'Framework Story'))
  assert.equal(Object.hasOwn(home, 'drafts'), false)
})

await test('legacy generated drafts remain recoverable read-only data', async t => {
  const { app, baseUrl } = await testApp(t)
  const timestamp = new Date().toISOString()
  app.db.raw.prepare(`
    INSERT INTO creator_drafts(id, type, title, brief, data_json, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run('legacy_draft_fixture', 'character', 'Recovered draft', 'Earlier brief', JSON.stringify({ name: 'Recovered character' }), 'draft', timestamp, timestamp)

  const listed = await jsonRequest(baseUrl, '/api/legacy/drafts')
  assert.equal(listed.response.status, 200)
  assert.equal(listed.body.find(item => item.id === 'legacy_draft_fixture').data.name, 'Recovered character')

  const oldWriteSurface = await jsonRequest(baseUrl, '/api/creator/drafts/legacy_draft_fixture')
  assert.equal(oldWriteSurface.response.status, 410)
  assert.equal(oldWriteSurface.body.error.code, 'guided_creation_removed')
  assert.equal(app.db.raw.prepare('SELECT COUNT(*) AS count FROM creator_drafts WHERE id = ?').get('legacy_draft_fixture').count, 1)
})
