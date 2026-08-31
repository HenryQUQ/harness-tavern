import assert from 'node:assert/strict'
import test from 'node:test'
import { reduceEvents } from '../src/domain/projection.js'
import { ActionRegistry } from '../src/runtime/action-registry.js'
import { normalizeCharacterPlan, normalizeSceneOutput } from '../src/runtime/contracts.js'
import { SAMPLE_IDS } from '../src/domain/seed.js'
import { jsonRequest, testApp } from './helpers.js'

function projection(app, conversationId = SAMPLE_IDS.conversation) {
  const conversation = app.repository.getConversation(conversationId)
  const story = app.repository.getStory(conversation.story_id)
  return reduceEvents(app.repository.events(conversationId), story.initial_state)
}

function systemText(request) {
  return request.messages.filter(message => message.role === 'system').map(message => message.content).join('\n')
}

test('Character plans are identity-bound and Scene Blocks cannot invent a speaker', async t => {
  const { app } = await testApp(t)
  const cast = app.repository.listConversationCast(SAMPLE_IDS.conversation)
  const member = cast.find(candidate => candidate.character_id === SAMPLE_IDS.rowan)
  const registry = new ActionRegistry({ story: app.repository.getStory(SAMPLE_IDS.story), cast })
  const plan = normalizeCharacterPlan({
    character_id: SAMPLE_IDS.rowan,
    participation: 'speak',
    perceived_event_ids: ['visible-observation', 'private-observation'],
    belief_updates: [{ subject: 'the lock', claim: 'It is still closed.', confidence: 2, source_event_ids: ['visible-observation', 'private-observation'] }],
    emotional_state: { tone: 'guarded', tension: 2, warmth: -2, resolve: 0.7 },
    relationship_shifts: [{ target_id: 'user', dimension: 'trust', delta: 4, reason: 'The player asked directly.' }],
    agenda_decisions: [{ agenda_id: 'rowan-survive', decision: 'defer', reason: 'Wait.' }],
    spontaneous_actions: [{ type: 'observe', actor_id: 'user', parameters: { focus: 'the west door' } }],
    speech_act: { kind: 'answer', meaning: 'Answer without confessing.', disclose: ['secret-1', 'not-a-secret'] },
    public_cue: 'Rowan grips the scarf.',
  }, {
    actionRegistry: registry,
    member,
    activeAgendas: [{ id: 'rowan-survive', owner_id: SAMPLE_IDS.rowan }],
    allowedEventIds: ['visible-observation'],
    allowedRelationshipTargets: cast.map(candidate => candidate.character_id),
  })
  assert.deepEqual(plan.perceived_event_ids, ['visible-observation'])
  assert.deepEqual(plan.belief_updates[0].source_event_ids, ['visible-observation'])
  assert.equal(plan.belief_updates[0].confidence, 1)
  assert.equal(plan.emotional_state.tension, 1)
  assert.equal(plan.emotional_state.warmth, -1)
  assert.equal(plan.relationship_shifts[0].delta, 0.2)
  assert.deepEqual(plan.speech_act.disclose, ['secret-1'])
  assert.ok(plan.actions.every(action => action.actor_id === SAMPLE_IDS.rowan))

  const scene = normalizeSceneOutput({ blocks: [
    { type: 'narration', content: 'The observatory listens.' },
    { type: 'action', character_id: SAMPLE_IDS.rowan, content: 'keeps one hand near the scarf.' },
    { type: 'dialogue', character_id: SAMPLE_IDS.rowan, content: 'Not everything here wants to be found.' },
  ] }, { participantIds: [SAMPLE_IDS.rowan], characterPlans: [plan], cast })
  assert.equal(scene.scene_blocks.length, 3)
  assert.match(scene.content, /Rowan Ash: “Not everything here wants to be found.”/)
  assert.throws(() => normalizeSceneOutput({ blocks: [
    { type: 'dialogue', character_id: SAMPLE_IDS.mira, content: 'I was never selected.' },
  ] }, { participantIds: [SAMPLE_IDS.rowan], characterPlans: [plan], cast }), error => error.code === 'invalid_scene_output')
  assert.throws(() => normalizeCharacterPlan({ character_id: SAMPLE_IDS.mira }, { actionRegistry: registry, member }), error => error.code === 'character_identity_mismatch')
})

test('one ensemble turn runs isolated Character minds and renders one structured Storyteller beat', async t => {
  const { app, baseUrl } = await testApp(t)
  const adapter = app.providers.adapters.get('test')
  const complete = adapter.complete.bind(adapter)
  const requests = []
  adapter.complete = async request => {
    requests.push(request)
    return complete(request)
  }

  const result = await app.turns.run(SAMPLE_IDS.conversation, {
    content: 'Everyone watches while I ask Mira what the silent orrery means.',
    idempotencyKey: 'character-runtime-ensemble',
  })
  assert.equal(result.messages.length, 1)
  assert.equal(result.messages[0].character_id, 'narrator')
  assert.ok(result.messages[0].scene_blocks.some(block => block.type === 'dialogue' && block.character_id === SAMPLE_IDS.mira))
  assert.equal(result.messages[0].scene_blocks.some(block => block.type === 'dialogue' && block.character_id === SAMPLE_IDS.rowan), false)

  const actorRequests = requests.filter(request => request.phase === 'character')
  assert.equal(actorRequests.length, 3)
  const byCharacter = new Map(actorRequests.map(request => {
    const text = systemText(request)
    const characterId = text.match(/isolated Character runtime for\s+.+?\s+\(([^)]+)\)/i)?.[1]
    return [characterId, text]
  }))
  assert.match(byCharacter.get(SAMPLE_IDS.mira), /Mira alone knows the ledger margins/i)
  assert.doesNotMatch(byCharacter.get(SAMPLE_IDS.mira), /Rowan carries a lens fragment/i)
  assert.match(byCharacter.get(SAMPLE_IDS.rowan), /Rowan carries a lens fragment/i)
  assert.doesNotMatch(byCharacter.get(SAMPLE_IDS.rowan), /Mira alone knows the ledger margins/i)
  assert.match(byCharacter.get(SAMPLE_IDS.lyra), /alignment opens an erased gate/i)
  assert.doesNotMatch(byCharacter.get(SAMPLE_IDS.lyra), /Rowan carries a lens fragment/i)

  const storytellerText = systemText(requests.find(request => request.phase === 'narration'))
  assert.match(storytellerText, /ISOLATED CHARACTER PERFORMANCE BRIEFS/i)
  assert.doesNotMatch(storytellerText, /Mira alone knows the ledger margins/i)
  assert.doesNotMatch(storytellerText, /Rowan carries a lens fragment/i)

  const current = projection(app)
  assert.deepEqual(Object.keys(current.characterStates).sort(), [SAMPLE_IDS.lyra, SAMPLE_IDS.mira, SAMPLE_IDS.rowan].sort())
  assert.equal(current.characterStates[SAMPLE_IDS.mira].last_participation, 'speak')
  assert.equal(current.characterStates[SAMPLE_IDS.rowan].last_participation, 'remain_silent')
  assert.equal(current.messages.filter(message => message.role === 'assistant').length, 2)
  assert.ok(Array.isArray(current.messages.at(-1).metadata.scene_blocks))

  const view = await jsonRequest(baseUrl, `/api/conversations/${SAMPLE_IDS.conversation}`)
  const rowanPublic = view.body.character_runtime.find(item => item.character_id === SAMPLE_IDS.rowan)
  assert.equal(rowanPublic.last_participation, 'remain_silent')
  assert.equal('beliefs' in rowanPublic, false)
  assert.equal('current_intent' in rowanPublic, false)
  assert.equal('private_context' in view.body.cast.find(item => item.character_id === SAMPLE_IDS.rowan), false)
})

test('an invalid Character response is corrected once without suspending the turn', async t => {
  const { app } = await testApp(t)
  app.repository.updateConversationCast(SAMPLE_IDS.conversation, SAMPLE_IDS.mira, { spotlight: true })
  const adapter = app.providers.adapters.get('test')
  const complete = adapter.complete.bind(adapter)
  let characterCalls = 0
  adapter.complete = async request => {
    if (request.phase !== 'character') return complete(request)
    characterCalls += 1
    if (characterCalls === 1) return { content: 'not-json', finishReason: 'stop', usage: { promptTokens: 10, completionTokens: 2, totalTokens: 12 } }
    return complete(request)
  }

  const result = await app.turns.run(SAMPLE_IDS.conversation, {
    content: 'Mira Vale, what do you notice?',
    idempotencyKey: 'character-runtime-correction',
  })
  assert.equal(result.status, 'completed')
  assert.equal(characterCalls, 2)
  const usage = app.db.raw.prepare('SELECT raw_json FROM usage_ledger WHERE turn_event_uid = ? ORDER BY id').all(result.turn_uid).map(row => JSON.parse(row.raw_json))
  assert.ok(usage.some(item => item.outcome === 'discarded_invalid_character_output'))
  assert.ok(usage.some(item => item.outcome === 'completed_after_character_retry'))
})

test('repeated invalid Character output becomes a silent observation fallback', async t => {
  const { app } = await testApp(t)
  app.repository.updateConversationCast(SAMPLE_IDS.conversation, SAMPLE_IDS.mira, { spotlight: true })
  const adapter = app.providers.adapters.get('test')
  const complete = adapter.complete.bind(adapter)
  let characterCalls = 0
  adapter.complete = async request => {
    if (request.phase !== 'character') return complete(request)
    characterCalls += 1
    return { content: 'not-json', finishReason: 'stop', usage: { promptTokens: 10, completionTokens: 2, totalTokens: 12 } }
  }

  const result = await app.turns.run(SAMPLE_IDS.conversation, {
    content: 'Mira Vale, watch what happens when I wait.',
    idempotencyKey: 'character-runtime-safe-fallback',
  })
  assert.equal(result.status, 'completed')
  assert.equal(characterCalls, 2)
  assert.equal(projection(app).characterStates[SAMPLE_IDS.mira].last_participation, 'observe')
  assert.equal(result.context_manifests.character[SAMPLE_IDS.mira].contract_guard.fallback, true)
  assert.equal(result.messages[0].scene_blocks.some(block => block.type === 'dialogue'), false)
})

test('partial Character planning is resumable without rerunning successful minds', async t => {
  const { app } = await testApp(t)
  const adapter = app.providers.adapters.get('test')
  const complete = adapter.complete.bind(adapter)
  const characterCalls = []
  let failedMira = false
  adapter.complete = async request => {
    if (request.phase !== 'character') return complete(request)
    const text = systemText(request)
    const characterId = text.match(/isolated Character runtime for\s+.+?\s+\(([^)]+)\)/i)?.[1]
    characterCalls.push(characterId)
    if (characterId === SAMPLE_IDS.mira && !failedMira) {
      failedMira = true
      const error = new Error('temporary Character provider failure')
      error.code = 'provider_error'
      error.status = 502
      throw error
    }
    return complete(request)
  }

  await assert.rejects(app.turns.run(SAMPLE_IDS.conversation, {
    content: 'Everyone considers the warning in silence.',
    idempotencyKey: 'character-runtime-resume',
  }), error => error.code === 'provider_error')
  const suspended = app.turns.listRuns(SAMPLE_IDS.conversation)[0]
  assert.equal(suspended.phase, 'character_runtime')
  assert.equal(suspended.status, 'suspended')
  assert.equal(suspended.result.character_plans.length, 2)

  const resumed = await app.turns.resume(suspended.id)
  assert.equal(resumed.status, 'completed')
  assert.equal(characterCalls.filter(id => id === SAMPLE_IDS.mira).length, 2)
  assert.equal(characterCalls.filter(id => id === SAMPLE_IDS.rowan).length, 1)
  assert.equal(characterCalls.filter(id => id === SAMPLE_IDS.lyra).length, 1)
  assert.equal(projection(app).messages.filter(message => message.role === 'user').length, 1)
})

test('Character inner state follows timeline branches', async t => {
  const { app } = await testApp(t)
  await app.turns.run(SAMPLE_IDS.conversation, { content: 'Mira Vale, what do you notice?', idempotencyKey: 'character-branch-boundary' })
  const boundary = app.repository.events(SAMPLE_IDS.conversation).at(-1).id
  await app.turns.run(SAMPLE_IDS.conversation, { content: 'Rowan Ash, answer me directly.', idempotencyKey: 'character-parent-rowan' })
  const parentBranch = app.repository.getConversation(SAMPLE_IDS.conversation).current_branch_id
  const parentState = projection(app).characterStates
  assert.equal(parentState[SAMPLE_IDS.rowan].last_participation, 'speak')

  const fork = app.repository.forkBranch(SAMPLE_IDS.conversation, { fork_event_id: boundary, label: 'Ask Lyra instead' })
  assert.notEqual(fork.branch.id, parentBranch)
  const forkAtBoundary = projection(app).characterStates
  assert.equal(forkAtBoundary[SAMPLE_IDS.rowan], undefined)
  await app.turns.run(SAMPLE_IDS.conversation, { content: 'Lyra Voss, answer me directly.', idempotencyKey: 'character-fork-lyra' })
  assert.equal(projection(app).characterStates[SAMPLE_IDS.lyra].last_participation, 'speak')

  app.repository.switchBranch(SAMPLE_IDS.conversation, parentBranch)
  const restored = projection(app).characterStates
  assert.equal(restored[SAMPLE_IDS.rowan].last_participation, 'speak')
  assert.equal(restored[SAMPLE_IDS.lyra], undefined)
})
