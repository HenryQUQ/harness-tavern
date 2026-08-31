import test from 'node:test'
import assert from 'node:assert/strict'
import { testApp } from './helpers.js'
import { SAMPLE_IDS } from '../src/domain/seed.js'
import { reduceEvents } from '../src/domain/projection.js'
import { buildPlayerJournal } from '../src/domain/journal.js'

await test('seeds a ready-to-open three-character story, playthrough, and conversation', async t => {
  const { app } = await testApp(t)
  const story = app.repository.getStory(SAMPLE_IDS.story)
  assert.equal(story.cast.length, 3)
  assert.deepEqual(story.cast.map(member => member.character_id), [SAMPLE_IDS.mira, SAMPLE_IDS.rowan, SAMPLE_IDS.lyra])
  assert.ok(story.cast.every(member => member.private_context.length > 20))
  assert.ok(story.hook.length > 30)
  assert.equal(story.scenes.length, 3)
  const playthrough = app.repository.getPlaythrough(SAMPLE_IDS.playthrough)
  assert.equal(playthrough.story_id, story.id)
  const conversation = app.repository.getConversation(SAMPLE_IDS.conversation)
  assert.equal(conversation.story_id, story.id)
  assert.equal(conversation.playthrough_id, playthrough.id)
  assert.equal(conversation.thinking_intensity, 'auto')
  assert.equal('mode' in conversation, false)
  const projection = reduceEvents(app.repository.events(conversation.id), story.initial_state)
  assert.deepEqual(projection.messages.map(message => message.actor_id), ['narrator'])
  assert.deepEqual(projection.messages[0].metadata.participant_ids, [SAMPLE_IDS.mira])
  assert.match(projection.messages[0].content, /central orrery turns without power/i)
  assert.match(projection.messages[0].content, /Mira closes the archive ledger/i)
  assert.equal(projection.world.doors.west_hall.locked, true)
  assert.equal(app.repository.listConversationCast(conversation.id).length, 3)
})

await test('only exposes thinking intensity as the turn-control setting', async t => {
  const { app } = await testApp(t)
  for (const intensity of ['auto', 'none', 'low', 'medium', 'high', 'max']) {
    const updated = app.repository.updateConversation(SAMPLE_IDS.conversation, { thinking_intensity: intensity })
    assert.equal(updated.thinking_intensity, intensity)
    assert.equal(updated.mode, undefined)
  }
  assert.throws(() => app.repository.updateConversation(SAMPLE_IDS.conversation, { thinking_intensity: 'agentic' }), /thinking_intensity/)
})

await test('forks a visible event boundary without leaking future branch events', async t => {
  const { app } = await testApp(t)
  const conversation = app.repository.getConversation(SAMPLE_IDS.conversation)
  const before = app.repository.events(conversation.id)
  const boundary = before.at(-1).id
  const fork = app.repository.forkBranch(conversation.id, { source_branch_id: conversation.current_branch_id, fork_event_id: boundary, label: 'Test fork' })
  app.db.appendEvent({ conversationId: conversation.id, branchId: fork.branch.id, type: 'memory.created', payload: { id: 'fork-memory', content: 'Only on fork' } })
  assert.ok(app.repository.events(conversation.id, fork.branch.id).some(event => event.payload.content === 'Only on fork'))
  assert.ok(!app.repository.events(conversation.id, conversation.current_branch_id).some(event => event.payload.content === 'Only on fork'))
})

await test('character private knowledge is distinct for each cast member', async t => {
  const { app } = await testApp(t)
  const story = app.repository.getStory(SAMPLE_IDS.story)
  const privateTexts = new Set(story.cast.map(member => member.private_context))
  assert.equal(privateTexts.size, 3)
  assert.match(story.cast.find(member => member.character_id === SAMPLE_IDS.rowan).private_context, /lens fragment/i)
  assert.doesNotMatch(story.cast.find(member => member.character_id === SAMPLE_IDS.lyra).private_context, /Rowan carries/i)
})

await test('player journal hides creator-only lore and private world keys', async t => {
  const { app } = await testApp(t)
  const story = app.repository.getStory(SAMPLE_IDS.story)
  const conversation = app.repository.getConversation(SAMPLE_IDS.conversation)
  const events = app.repository.events(conversation.id)
  app.db.appendEvent({
    conversationId: conversation.id,
    branchId: conversation.current_branch_id,
    type: 'world.state_set',
    payload: { path: 'director.secret_answer', value: 'Rowan has the fragment' },
  })
  const projection = reduceEvents(app.repository.events(conversation.id), story.initial_state)
  const journal = buildPlayerJournal({ conversation, projection, story, branches: app.repository.listBranches(conversation.id), cast: app.repository.listConversationCast(conversation.id) })
  assert.doesNotMatch(JSON.stringify(journal), /erased gate/i)
  assert.doesNotMatch(JSON.stringify(journal), /secret_answer/i)
  assert.ok(journal.known_facts.length > 0)
  assert.ok(events.length > 0)
})

await test('first-run profile is friendly and references the default persona', async t => {
  const { app } = await testApp(t)
  const profile = app.repository.getUserProfile()
  assert.equal(profile.onboarding_complete, false)
  assert.equal(profile.default_persona_id, SAMPLE_IDS.persona)
  const updated = app.repository.updateUserProfile({ name: 'Henry', onboarding_complete: true, sync_default_persona: true })
  assert.equal(updated.name, 'Henry')
  assert.equal(updated.onboarding_complete, true)
})
