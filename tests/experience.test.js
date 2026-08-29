import test from 'node:test'
import assert from 'node:assert/strict'
import { testApp, jsonRequest } from './helpers.js'
import { SAMPLE_IDS } from '../src/domain/seed.js'

await test('a nontechnical user can describe, publish, and chat with a character', async t => {
  const { app } = await testApp(t)
  const draft = app.creator.generateCharacterDraft({
    brief: 'A patient night-shift radio host named Elara who loves strange local stories and gently challenges people when they avoid a difficult truth.',
    relationship: 'a familiar voice the listener can grow to trust',
    energy: 'warm, observant and slightly mysterious',
  })
  assert.equal(draft.type, 'character')
  assert.match(draft.data.description, /radio host/i)
  assert.ok(draft.data.boundaries.some(item => /user/i.test(item)))
  const published = app.creator.publishDraft(draft.id)
  assert.equal(published.type, 'character')
  const conversation = app.repository.createConversation({
    title: `Chat with ${published.character.name}`,
    character_ids: [published.character.id],
    persona_id: SAMPLE_IDS.persona,
  })
  const cast = app.repository.listConversationCast(conversation.id)
  assert.equal(cast.length, 1)
  assert.equal(cast[0].character_id, published.character.id)
  const turn = await app.turns.run(conversation.id, { content: 'I heard something impossible on the road tonight.' })
  assert.equal(turn.messages[0].character_id, published.character.id)
})

await test('a creator can turn one story brief into a playable multi-character draft', async t => {
  const { app } = await testApp(t)
  const draft = app.creator.generateStoryDraft({
    brief: 'Three strangers are trapped overnight in a museum where every portrait changes when nobody is looking. One of them already knows why.',
    genre: 'Supernatural mystery',
    tone: 'Tense but humane',
    cast_size: 3,
    player_role: 'A conservator called in just before closing time.',
  })
  assert.equal(draft.type, 'story')
  assert.equal(draft.data.characters.length, 3)
  assert.equal(draft.data.cast.length, 3)
  assert.equal(draft.data.scenes.length, 3)
  assert.ok(draft.data.characters.every(character => character.secrets.length >= 1))
  const published = app.creator.publishDraft(draft.id, { start_playthrough: true, persona_id: SAMPLE_IDS.persona })
  assert.equal(published.story.cast.length, 3)
  assert.ok(published.playthrough.playthrough.id)
  assert.equal(published.playthrough.conversation.story_id, published.story.id)
  const turn = await app.turns.run(published.playthrough.conversation.id, { content: 'I ask each of you what changed in the nearest portrait.' })
  assert.equal(turn.messages.length, 3)
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

await test('guided creator HTTP journey publishes a story and starts a playthrough', async t => {
  const { baseUrl } = await testApp(t)
  const draft = await jsonRequest(baseUrl, '/api/creator/story-drafts', {
    method: 'POST',
    body: JSON.stringify({
      brief: 'A floating night market appears once a year and three merchants each need the player to choose a different bargain.',
      genre: 'Fantasy',
      tone: 'Wonder with moral choices',
      cast_size: 3,
    }),
  })
  assert.equal(draft.response.status, 201)
  assert.equal(draft.body.data.characters.length, 3)
  const published = await jsonRequest(baseUrl, `/api/creator/drafts/${draft.body.id}/publish`, {
    method: 'POST',
    body: JSON.stringify({ start_playthrough: true, persona_id: SAMPLE_IDS.persona }),
  })
  assert.equal(published.response.status, 201)
  assert.equal(published.body.story.cast.length, 3)
  assert.ok(published.body.playthrough.conversation.id)
  const home = await jsonRequest(baseUrl, '/api/home')
  assert.ok(home.body.continue.some(item => item.id === published.body.playthrough.conversation.id))
})

await test('home groups continuation, characters, stories, and unfinished creator drafts', async t => {
  const { app } = await testApp(t)
  app.creator.generateCharacterDraft({ brief: 'A careful botanist who keeps a rooftop garden.' })
  const home = app.repository.getHome()
  assert.ok(home.continue.length >= 1)
  assert.ok(home.characters.length >= 3)
  assert.ok(home.stories.length >= 1)
  assert.ok(home.drafts.some(item => item.status === 'draft'))
})
