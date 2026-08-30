import assert from 'node:assert/strict'
import test from 'node:test'
import { reduceEvents } from '../src/domain/projection.js'
import { ActionRegistry, agendaLifecycleTransition, normalizeStoryAgendas } from '../src/runtime/action-registry.js'
import { visibleWorld } from '../src/runtime/context-builder.js'
import { narrationContradiction, normalizeControlPlan, normalizeNarration } from '../src/runtime/contracts.js'
import { SAMPLE_IDS } from '../src/domain/seed.js'
import { testApp } from './helpers.js'

function projection(app, conversationId) {
  const conversation = app.repository.getConversation(conversationId)
  const story = app.repository.getStory(conversation.story_id)
  return reduceEvents(app.repository.events(conversationId), story.initial_state)
}

function providerResult(content) {
  return {
    content,
    finishReason: 'stop',
    providerId: 'mock',
    routedProvider: 'mock',
    latencyMs: 1,
    usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15, costUsd: 0 },
  }
}

await test('the causal loop rejects impossible continuation and only commits authored effects', async t => {
  const { app } = await testApp(t)
  const conversationId = SAMPLE_IDS.conversation

  const blocked = await app.turns.run(conversationId, { content: 'Open the west door.', idempotencyKey: 'causal-open-locked' })
  assert.equal(blocked.status, 'completed')
  assert.equal(blocked.action_receipts[0].status, 'rejected')
  assert.match(blocked.action_receipts[0].reason, /locked/i)
  assert.equal(projection(app, conversationId).world.doors.west_hall.open, false)

  const taken = await app.turns.run(conversationId, { content: 'Take the archive key.', idempotencyKey: 'causal-take-key' })
  assert.equal(taken.action_receipts[0].status, 'resolved')
  assert.deepEqual(projection(app, conversationId).world.inventory.user, ['archive_key'])

  const unlocked = await app.turns.run(conversationId, { content: 'Unlock the west door with the archive key.', idempotencyKey: 'causal-unlock-west' })
  assert.equal(unlocked.action_receipts[0].status, 'resolved')
  assert.equal(projection(app, conversationId).world.doors.west_hall.locked, false)

  const opened = await app.turns.run(conversationId, { content: 'Open the west door.', idempotencyKey: 'causal-open-west' })
  assert.equal(opened.action_receipts[0].status, 'resolved')
  const final = projection(app, conversationId)
  assert.equal(final.world.doors.west_hall.open, true)
  assert.equal(final.stateRevision, 3)
  assert.ok(Object.values(final.agendas).every(agenda => agenda.evaluation_count >= 4))
  assert.ok(final.observations.some(item => /releases/i.test(item.content)))

  const snapshot = app.db.raw.prepare('SELECT state_json FROM state_snapshots WHERE conversation_id = ? ORDER BY event_id DESC LIMIT 1').get(conversationId)
  assert.deepEqual(JSON.parse(snapshot.state_json), final)
  const before = app.repository.events(conversationId).length
  const repeated = await app.turns.run(conversationId, { content: 'Open the west door.', idempotencyKey: 'causal-open-west' })
  assert.equal(repeated.loop_id, opened.loop_id)
  assert.equal(app.repository.events(conversationId).length, before)
  await assert.rejects(
    app.turns.run(conversationId, { content: 'Do something different.', idempotencyKey: 'causal-open-west' }),
    error => error.code === 'idempotency_conflict',
  )
})

await test('branch replay isolates causal facts from the parent timeline', async t => {
  const { app } = await testApp(t)
  const conversationId = SAMPLE_IDS.conversation
  await app.turns.run(conversationId, { content: 'Take the archive key.', idempotencyKey: 'branch-take' })
  const boundary = app.repository.events(conversationId).at(-1).id
  await app.turns.run(conversationId, { content: 'Unlock the west door with the archive key.', idempotencyKey: 'parent-unlock' })
  assert.equal(projection(app, conversationId).world.doors.west_hall.locked, false)

  const fork = app.repository.forkBranch(conversationId, { fork_event_id: boundary, label: 'Keep it locked' })
  assert.equal(projection(app, conversationId).world.doors.west_hall.locked, true)
  await app.turns.run(conversationId, { content: 'Wait by the locked door.', idempotencyKey: 'branch-wait' })
  assert.equal(projection(app, conversationId).world.doors.west_hall.locked, true)

  const parent = app.repository.listBranches(conversationId).find(branch => branch.id !== fork.branch.id)
  app.repository.switchBranch(conversationId, parent.id)
  assert.equal(projection(app, conversationId).world.doors.west_hall.locked, false)
})

await test('narration guard rejects open-state contradictions in English and Chinese without rejecting negation', () => {
  const current = {
    actions: [{ id: 'action-unlock', type: 'unlock', parameters: { target: 'west_hall' } }],
    world: { doors: { west_hall: { locked: false, open: false } } },
  }
  const receipts = [{ action_id: 'action-unlock', action_type: 'unlock' }]
  assert.match(narrationContradiction('The door stands ajar, revealing a dark corridor beyond.', current, receipts), /authoritative state/i)
  assert.match(narrationContradiction('门已经半开，露出后面的走廊。', current, receipts), /authoritative state/i)
  assert.equal(narrationContradiction('The lock releases, but the door does not open.', current, receipts), null)
  assert.equal(narrationContradiction('锁已经解开，但门仍未打开。', current, receipts), null)
})

await test('narration normalization preserves complete provider output without a Tavern character ceiling', () => {
  const content = `Opening\n${'x'.repeat(70_000)}\nEnding`
  assert.equal(normalizeNarration(content, 'char-a').content, content)
})

await test('Agenda lifecycle transitions are derived from authored facts rather than model preference', () => {
  const current = { world: { doors: { west_hall: { open: true } }, alarm: false } }
  assert.equal(agendaLifecycleTransition({ status: 'active' }, current), null)
  assert.deepEqual(agendaLifecycleTransition({
    status: 'active',
    complete_when: [{ path: 'world.doors.west_hall.open', operator: 'eq', value: true }],
  }, current), { status: 'completed', rule: 'complete_when' })
  assert.deepEqual(agendaLifecycleTransition({
    status: 'paused',
    resume_when: [{ path: 'world.alarm', operator: 'falsy' }],
  }, current), { status: 'active', rule: 'resume_when' })
})

await test('ensemble speaker plans support the complete cast without an arbitrary six-character ceiling', () => {
  const cast = Array.from({ length: 8 }, (_value, index) => ({ character_id: `char-${index + 1}` }))
  const speakerIds = cast.map(member => member.character_id)
  const plan = normalizeControlPlan({
    actions: [{ type: 'wait', actor_id: 'user', parameters: {} }],
    speakers: speakerIds,
  }, {
    actionRegistry: new ActionRegistry({ cast }),
    allowedSpeakerIds: speakerIds,
    userMessage: 'Everyone responds.',
  })
  assert.deepEqual(plan.speakers, speakerIds)
})

await test('Story-authored Agendas replace duplicate card-goal loops for the same character', () => {
  const cast = [
    { character_id: 'char-a', character: { slug: 'a', goals: ['Card goal one', 'Card goal two'] } },
    { character_id: 'char-b', character: { slug: 'b', goals: ['Fallback card goal'] } },
  ]
  const agendas = normalizeStoryAgendas({
    runtime: { agendas: [{ id: 'story-a', owner: 'a', objective: 'Story-specific intent', visibility: 'public' }] },
  }, cast)
  assert.deepEqual(agendas.map(agenda => agenda.id), ['story-a', 'character-goal-char-b-1'])
})

await test('the planner cannot schedule character Actions outside an Agenda or end durable intent by assertion', async t => {
  const { app } = await testApp(t)
  const complete = app.providers.complete.bind(app.providers)
  app.providers.complete = async (request, options) => {
    const isControl = request.messages.some(message => /control planner inside Harness Tavern/i.test(message.content))
    if (!isControl) return complete(request, options)
    return providerResult(JSON.stringify({
      actions: [
        { type: 'open', actor_id: 'user', parameters: { target: 'west_hall' } },
        { type: 'speak', actor_id: SAMPLE_IDS.mira, parameters: { content: 'An unauthorised side action.' } },
      ],
      agenda_decisions: [{ agenda_id: 'mira-protect-archive', decision: 'complete', reason: 'The model declares it done.' }],
      speakers: [SAMPLE_IDS.mira],
      internal_summary: 'Attempted to exceed control authority.',
    }))
  }

  const result = await app.turns.run(SAMPLE_IDS.conversation, {
    content: 'I try to open the west door.',
    idempotencyKey: 'agenda-authority-boundary',
  })
  assert.deepEqual(result.actions.map(action => action.actor_id), ['user'])
  const interpretation = app.repository.events(SAMPLE_IDS.conversation).find(event => event.type === 'intent.interpreted')
  assert.equal(interpretation.payload.discarded_action_count, 1)
  const current = projection(app, SAMPLE_IDS.conversation)
  assert.ok(Object.values(current.agendas).every(agenda => agenda.status === 'active' && agenda.evaluation_count === 1))
  const evaluation = app.repository.events(SAMPLE_IDS.conversation).find(event => event.type === 'agenda.evaluated' && event.payload.agenda_id === 'mira-protect-archive')
  assert.equal(evaluation.payload.model_decision, 'complete')
  assert.equal(evaluation.payload.decision, 'defer')
})

await test('the runtime closes an Agenda in the same command that satisfies its authored condition', async t => {
  const { app } = await testApp(t)
  const base = app.repository.getStory(SAMPLE_IDS.story)
  const story = app.repository.createStory({
    ...base,
    id: 'story_agenda_lifecycle_test',
    title: 'Agenda lifecycle test',
    slug: 'agenda-lifecycle-test',
    cast: base.cast,
    runtime: {
      ...base.runtime,
      agendas: [{
        id: 'open-west-hall',
        owner: SAMPLE_IDS.mira,
        objective: 'Keep trying until the west-hall door is open.',
        complete_when: [{ path: 'world.doors.west_hall.open', operator: 'eq', value: true }],
        visibility: 'public',
      }],
    },
  })
  const conversation = app.repository.createConversation({
    title: story.title,
    story_id: story.id,
    persona_id: SAMPLE_IDS.persona,
  })
  await app.turns.run(conversation.id, { content: 'Take the archive key.' })
  await app.turns.run(conversation.id, { content: 'Unlock the west door with the archive key.' })
  await app.turns.run(conversation.id, { content: 'Open the west door.' })

  const agenda = projection(app, conversation.id).agendas['open-west-hall']
  assert.equal(agenda.status, 'completed')
  assert.equal(agenda.evaluation_count, 3)
  const lifecycle = app.repository.events(conversation.id).find(event => event.type === 'agenda.updated' && event.payload.id === agenda.id)
  assert.equal(lifecycle.payload.lifecycle_rule, 'complete_when')
})

await test('narration guard discards a contradictory draft and persists only the corrected prose', async t => {
  const { app } = await testApp(t)
  const conversationId = SAMPLE_IDS.conversation
  await app.turns.run(conversationId, { content: 'Take the archive key.', idempotencyKey: 'guard-take-key' })

  const complete = app.providers.complete.bind(app.providers)
  let narrationAttempts = 0
  app.providers.complete = async (request, options) => {
    const isControl = request.messages.some(message => /control planner inside Harness Tavern/i.test(message.content))
    if (isControl) return complete(request, options)
    narrationAttempts += 1
    return providerResult(narrationAttempts === 1
      ? 'The door stands ajar, revealing a dark corridor beyond.'
      : 'The lock releases with a click, but the door remains closed.')
  }

  const result = await app.turns.run(conversationId, {
    content: 'Unlock the west door with the archive key.',
    idempotencyKey: 'guard-correct-unlock',
  })
  assert.equal(narrationAttempts, 2)
  assert.equal(result.messages.length, 1)
  assert.equal(result.messages[0].content, 'The lock releases with a click, but the door remains closed.')
  assert.equal(result.messages[0].causal_retry_count, 1)
  assert.equal(result.messages[0].causal_fallback, false)
  assert.doesNotMatch(projection(app, conversationId).messages.at(-1).content, /ajar|corridor/i)
  assert.equal(projection(app, conversationId).messages.at(-1).metadata.causal_retry_count, 1)

  const usage = app.db.raw.prepare('SELECT raw_json FROM usage_ledger WHERE turn_event_uid = ? ORDER BY id').all(result.turn_uid).map(row => JSON.parse(row.raw_json))
  assert.equal(usage.length, 3)
  assert.ok(usage.some(item => item.outcome === 'discarded_causal_conflict'))
  assert.ok(usage.some(item => item.outcome === 'completed_after_causal_retry'))
})

await test('narration guard falls back to canonical observations after a second contradiction', async t => {
  const { app } = await testApp(t)
  const conversationId = SAMPLE_IDS.conversation
  await app.turns.run(conversationId, { content: 'Take the archive key.', idempotencyKey: 'fallback-take-key' })

  const complete = app.providers.complete.bind(app.providers)
  let narrationAttempts = 0
  app.providers.complete = async (request, options) => {
    const isControl = request.messages.some(message => /control planner inside Harness Tavern/i.test(message.content))
    if (isControl) return complete(request, options)
    narrationAttempts += 1
    return providerResult('The door is ajar and reveals a corridor.')
  }

  const result = await app.turns.run(conversationId, {
    content: 'Unlock the west door with the archive key.',
    idempotencyKey: 'guard-fallback-unlock',
  })
  assert.equal(narrationAttempts, 2)
  assert.equal(result.messages[0].causal_fallback, true)
  assert.match(result.messages[0].content, /route remains closed until a separate open action succeeds/i)
  assert.doesNotMatch(result.messages[0].content, /ajar|reveals? a corridor/i)
  assert.equal(result.context_manifests.narration[SAMPLE_IDS.mira].causal_guard.fallback, true)
  assert.equal(projection(app, conversationId).world.doors.west_hall.open, false)
})

await test('commands survive model failure and resume exactly once', async t => {
  const { app } = await testApp(t)
  const conversation = app.repository.createConversation({
    title: 'Resumable command', story_id: SAMPLE_IDS.story, persona_id: SAMPLE_IDS.persona,
  })
  const complete = app.providers.complete.bind(app.providers)
  app.providers.complete = async () => ({
    content: 'not a control plan', finishReason: 'stop', providerId: 'mock', latencyMs: 1,
    usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
  })
  await assert.rejects(
    app.turns.run(conversation.id, { content: 'Take the archive key.', idempotencyKey: 'resume-key' }),
    error => error.code === 'invalid_model_output',
  )
  const failedProjection = projection(app, conversation.id)
  assert.equal(failedProjection.messages.filter(message => message.role === 'user').length, 1)
  assert.equal(failedProjection.world.items.archive_key.location, 'central-hall')
  const loop = app.turns.listRuns(conversation.id)[0]
  assert.equal(loop.status, 'suspended')
  assert.equal(loop.phase, 'interpretation')

  app.providers.complete = complete
  const resumed = await app.turns.resume(loop.id)
  assert.equal(resumed.status, 'completed')
  assert.equal(projection(app, conversation.id).messages.filter(message => message.role === 'user').length, 1)
  assert.equal(projection(app, conversation.id).world.items.archive_key.location, 'user')
})

await test('narration receives actor-scoped state while the planner can see director facts', async t => {
  const { app } = await testApp(t)
  const conversation = app.repository.getConversation(SAMPLE_IDS.conversation)
  const story = app.repository.getStory(conversation.story_id)
  const cast = app.repository.listConversationCast(conversation.id)
  const current = projection(app, conversation.id)
  const miraWorld = visibleWorld(story, current.world, SAMPLE_IDS.mira)
  const rowanWorld = visibleWorld(story, current.world, SAMPLE_IDS.rowan)
  assert.equal(miraWorld.items.lens_fragment, undefined)
  assert.equal(rowanWorld.items.lens_fragment.label, 'Celestial lens fragment')

  const miraContext = app.contextBuilder.buildNarration({
    conversation, story, persona: app.repository.getPersona(conversation.persona_id), cast, projection: current,
    actorId: SAMPLE_IDS.mira, userMessage: 'What do you see?', turnReceiptIds: [],
  })
  const rowanContext = app.contextBuilder.buildNarration({
    conversation, story, persona: app.repository.getPersona(conversation.persona_id), cast, projection: current,
    actorId: SAMPLE_IDS.rowan, userMessage: 'What do you see?', turnReceiptIds: [],
  })
  const miraText = miraContext.messages.map(message => message.content).join('\n')
  const rowanText = rowanContext.messages.map(message => message.content).join('\n')
  assert.doesNotMatch(miraText, /Celestial lens fragment/i)
  assert.match(rowanText, /Celestial lens fragment/i)
  assert.doesNotMatch(miraText, /Rowan carries a lens fragment/i)
  assert.match(rowanText, /Rowan carries a lens fragment/i)

  current.receipts.push({
    status: 'resolved', action_id: 'private-agenda-action', action_type: 'speak', actor_id: SAMPLE_IDS.rowan,
    outcome: 'succeeded', reason: 'PRIVATE_AGENDA_REASON: protect the lens in Rowan’s scarf', effects: [],
  })
  current.observations.push({
    id: 'private-agenda-observation', action_id: 'private-agenda-action', actor_id: SAMPLE_IDS.rowan,
    audience: ['director'], content: 'PRIVATE_AGENDA_OBSERVATION', kind: 'result',
  })
  const filteredContext = app.contextBuilder.buildNarration({
    conversation, story, persona: app.repository.getPersona(conversation.persona_id), cast, projection: current,
    actorId: SAMPLE_IDS.mira, userMessage: 'What happens next?', turnReceiptIds: ['private-agenda-action'],
  })
  const filteredText = filteredContext.messages.map(message => message.content).join('\n')
  assert.doesNotMatch(filteredText, /PRIVATE_AGENDA/)
  assert.deepEqual(filteredContext.receipts, [])
  assert.deepEqual(filteredContext.observations, [])
})

await test('default context has no Tavern ceiling and explicit budgets omit whole blocks only', async t => {
  const { app } = await testApp(t)
  const conversation = app.repository.getConversation(SAMPLE_IDS.conversation)
  const story = app.repository.getStory(conversation.story_id)
  const cast = app.repository.listConversationCast(conversation.id)
  const current = projection(app, conversation.id)
  const marker = `BEGIN_WHOLE_BLOCK_${'x'.repeat(16_000)}_END_WHOLE_BLOCK`
  current.messages.push({ event_id: 'long', role: 'user', actor_id: 'user', content: marker })

  const unlimited = app.contextBuilder.buildControl({
    conversation, story, persona: app.repository.getPersona(conversation.persona_id), cast, projection: current,
    userMessage: 'Continue.', resolvedIntensity: 'medium',
  })
  assert.equal(unlimited.manifest.policy, 'provider-managed-no-tavern-ceiling')
  assert.equal(unlimited.manifest.budget_tokens, null)
  assert.equal(unlimited.manifest.omitted.length, 0)
  assert.equal(unlimited.manifest.truncated_blocks, 0)
  assert.ok(unlimited.messages.some(message => message.content.includes(marker)))

  const budgetedConversation = { ...conversation, prompt: { ...conversation.prompt, context_budget_tokens: 512 } }
  const budgeted = app.contextBuilder.buildControl({
    conversation: budgetedConversation, story, persona: app.repository.getPersona(conversation.persona_id), cast, projection: current,
    userMessage: 'Continue.', resolvedIntensity: 'medium',
  })
  assert.equal(budgeted.manifest.policy, 'explicit-token-budget-whole-block-selection')
  assert.equal(budgeted.manifest.truncated_blocks, 0)
  assert.ok(budgeted.manifest.omitted.some(item => item.id === 'history-long'))
  assert.ok(!budgeted.messages.some(message => message.content.includes('BEGIN_WHOLE_BLOCK')))
})
