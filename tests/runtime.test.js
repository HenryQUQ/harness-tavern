import test from 'node:test'
import assert from 'node:assert/strict'
import { testApp } from './helpers.js'
import { SAMPLE_IDS } from '../src/domain/seed.js'
import { reduceEvents } from '../src/domain/projection.js'
import { thinkingPlan } from '../src/runtime/thinking.js'
import { validateOperations } from '../src/runtime/operations.js'

await test('runs one unified Tavern transaction with multiple character messages', async t => {
  const { app } = await testApp(t)
  const result = await app.turns.run(SAMPLE_IDS.conversation, { content: 'What does each of you think we should do first?' })
  assert.equal(result.thinking_intensity, 'auto')
  assert.equal(result.effective_thinking_intensity, 'high')
  assert.equal(result.messages.length, 3)
  assert.deepEqual(result.messages.map(message => message.character_id), [SAMPLE_IDS.mira, SAMPLE_IDS.rowan, SAMPLE_IDS.lyra])
  const events = app.repository.events(SAMPLE_IDS.conversation)
  assert.ok(events.some(event => event.type === 'turn.completed'))
  assert.ok(events.some(event => event.type === 'model.usage'))
})

await test('state operations are committed after a valid model envelope', async t => {
  const { app } = await testApp(t)
  await app.turns.run(SAMPLE_IDS.conversation, { content: 'Please remember that my name is Henry.' })
  const story = app.repository.getStory(SAMPLE_IDS.story)
  const projection = reduceEvents(app.repository.events(SAMPLE_IDS.conversation), story.initial_state)
  assert.ok(projection.memories.some(memory => /Henry/.test(memory.content)))
})

await test('thinking intensity changes budgets without changing pipeline type', () => {
  const none = thinkingPlan('none', 1000)
  const max = thinkingPlan('max', 1000)
  assert.equal(none.reasoningTokens, 0)
  assert.ok(max.reasoningTokens > none.reasoningTokens)
  assert.equal(none.visibleTokens, max.visibleTokens)
  assert.equal('mode' in none, false)
  assert.equal('mode' in max, false)
})

await test('automatic output planning does not impose a visible token ceiling', () => {
  const plan = thinkingPlan('high')
  assert.equal(plan.visibleTokens, null)
  assert.equal(plan.totalOutputTokens, null)
  assert.ok(plan.reasoningTokens > 0)
})

await test('truncated provider output records usage without committing the user message', async t => {
  const { app } = await testApp(t)
  app.providers.adapters.set('mock', {
    async complete() {
      return {
        content: '{"messages":[{"character_id":"char_mira_vale","content":"cut off',
        finishReason: 'length',
        usage: { promptTokens: 100, completionTokens: 200, reasoningTokens: 150, totalTokens: 300 },
      }
    },
  })
  const content = 'This message must remain retryable.'
  await assert.rejects(
    app.turns.run(SAMPLE_IDS.conversation, { content }),
    error => error.code === 'model_output_truncated',
  )
  const events = app.repository.events(SAMPLE_IDS.conversation)
  assert.equal(events.some(event => event.type === 'user.message' && event.payload.content === content), false)
  assert.equal(events.some(event => event.type === 'assistant.message' && /cut off/.test(event.payload.content)), false)
  const failure = events.findLast(event => event.type === 'turn.failed')
  assert.equal(failure.payload.user_message_committed, false)
  assert.equal(failure.payload.error_code, 'model_output_truncated')
  const usageEvent = events.findLast(event => event.type === 'model.usage')
  assert.equal(usageEvent.payload.outcome, 'failed')
  assert.equal(usageEvent.payload.finish_reason, 'length')
  const ledger = app.db.raw.prepare('SELECT * FROM usage_ledger WHERE turn_event_uid = ?').get(failure.payload.turn_uid)
  assert.equal(ledger.total_tokens, 300)
  assert.equal(JSON.parse(ledger.raw_json).outcome, 'failed')
})

await test('malformed structured output is never displayed as a character reply', async t => {
  const { app } = await testApp(t)
  app.providers.adapters.set('mock', {
    async complete() {
      return {
        content: '{"messages":[{"character_id":"char_mira_vale","content":"raw json',
        finishReason: 'stop',
        usage: { promptTokens: 10, completionTokens: 10, totalTokens: 20 },
      }
    },
  })
  const messagesBefore = app.repository.events(SAMPLE_IDS.conversation).filter(event => ['user.message', 'assistant.message'].includes(event.type)).length
  await assert.rejects(
    app.turns.run(SAMPLE_IDS.conversation, { content: 'Do not persist me on failure.' }),
    error => error.code === 'invalid_model_output',
  )
  const visibleAfter = app.repository.events(SAMPLE_IDS.conversation).filter(event => ['user.message', 'assistant.message'].includes(event.type))
  assert.equal(visibleAfter.length, messagesBefore)
  assert.equal(visibleAfter.some(event => /raw json/.test(event.payload.content)), false)
})

await test('complete plain text is safely wrapped while transcript protocol markers stay hidden', async t => {
  const { app } = await testApp(t)
  app.providers.adapters.set('mock', {
    async complete() {
      return {
        content: '[speaker:narrator] The snow settles. Mira asks one careful question.',
        finishReason: 'stop',
        usage: { promptTokens: 10, completionTokens: 12, totalTokens: 22 },
      }
    },
  })
  const result = await app.turns.run(SAMPLE_IDS.conversation, { content: 'Continue safely.' })
  assert.equal(result.structured_output, false)
  assert.equal(result.messages.length, 1)
  assert.equal(result.messages[0].character_id, 'narrator')
  assert.equal(result.messages[0].content, 'The snow settles. Mira asks one careful question.')
  assert.doesNotMatch(result.messages[0].content, /\[speaker:/)
  const completed = app.repository.events(SAMPLE_IDS.conversation).findLast(event => event.type === 'turn.completed')
  assert.equal(completed.payload.structured_output, false)
})

await test('rejects state operations that take over user autonomy', () => {
  assert.throws(() => validateOperations([
    { type: 'world.set', path: 'user.thoughts', value: 'secret' },
  ], { castIds: [SAMPLE_IDS.mira], hasStory: true }), /cannot set user autonomy/i)
})

await test('caps relationship changes and ignores unknown operation types', () => {
  const operations = validateOperations([
    { type: 'relationship.adjust', source_id: SAMPLE_IDS.mira, target_id: 'user', dimension: 'trust', delta: 0.9 },
    { type: 'execute.shell', command: 'rm -rf /' },
  ], { castIds: [SAMPLE_IDS.mira], hasStory: true })
  assert.equal(operations.length, 1)
  assert.equal(operations[0].delta, 0.2)
})

await test('context explicitly includes cast ids and separate private knowledge', async t => {
  const { app } = await testApp(t)
  const conversation = app.repository.getConversation(SAMPLE_IDS.conversation)
  const story = app.repository.getStory(SAMPLE_IDS.story)
  const projection = reduceEvents(app.repository.events(conversation.id), story.initial_state)
  const cast = app.repository.listConversationCast(conversation.id).map(member => ({
    ...member,
    role: story.cast.find(item => item.character_id === member.character_id)?.role,
    public_context: story.cast.find(item => item.character_id === member.character_id)?.public_context,
    private_context: story.cast.find(item => item.character_id === member.character_id)?.private_context,
  }))
  const context = app.contextBuilder.build({
    conversation,
    story,
    persona: app.repository.getPersona(conversation.persona_id),
    cast,
    projection,
    userMessage: 'Who knows what?',
    resolvedIntensity: 'medium',
  })
  const text = context.messages.map(message => message.content).join('\n')
  assert.match(text, new RegExp(`CHARACTER_ID: ${SAMPLE_IDS.mira}`))
  assert.match(text, new RegExp(`CHARACTER_ID: ${SAMPLE_IDS.rowan}`))
  assert.match(text, new RegExp(`CHARACTER_ID: ${SAMPLE_IDS.lyra}`))
  assert.match(text, /one unified Tavern turn pipeline/i)
  assert.match(text, /PRIVATE CONTEXT FOR Rowan Ash ONLY/i)
  assert.match(text, /CURRENT SCENE SOURCE/)
  assert.match(text, /Establish what each person knows and why they disagree/)
  assert.doesNotMatch(text, /coding agent powered by/i)
})

await test('the active Markdown scene reaches the model input without a Tavern hard truncation', async t => {
  const { app } = await testApp(t)
  const conversation = app.repository.getConversation(SAMPLE_IDS.conversation)
  const story = app.repository.getStory(SAMPLE_IDS.story)
  story.scenes[0].content = `${'scene detail '.repeat(900)}END-OF-AUTHORED-SCENE`
  const projection = reduceEvents(app.repository.events(conversation.id), story.initial_state)
  const context = app.contextBuilder.build({
    conversation,
    story,
    persona: app.repository.getPersona(conversation.persona_id),
    cast: app.repository.listConversationCast(conversation.id),
    projection,
    userMessage: 'Continue from the authored scene.',
    resolvedIntensity: 'medium',
  })
  const storyInput = context.messages[1].content
  assert.match(storyInput, /END-OF-AUTHORED-SCENE/)
  assert.doesNotMatch(storyInput.match(/CURRENT SCENE SOURCE:[\s\S]*?\n\nACTIVE CAST:/)?.[0] ?? '', /…truncated…/)
})

await test('conversation-specific AI input is included without replacing protected runtime rules', async t => {
  const { app } = await testApp(t)
  const conversation = app.repository.updateConversation(SAMPLE_IDS.conversation, {
    prompt: { custom_instructions: 'Use restrained dialogue and end with one concrete choice.', history_messages: 12 },
  })
  const story = app.repository.getStory(SAMPLE_IDS.story)
  const projection = reduceEvents(app.repository.events(conversation.id), story.initial_state)
  const context = app.contextBuilder.build({
    conversation,
    story,
    persona: app.repository.getPersona(conversation.persona_id),
    cast: app.repository.listConversationCast(conversation.id),
    projection,
    userMessage: 'What now?',
    resolvedIntensity: 'medium',
  })
  const text = context.messages.map(message => message.content).join('\n')
  assert.match(text, /CONVERSATION-SPECIFIC CREATOR INSTRUCTIONS/)
  assert.match(text, /Use restrained dialogue/)
  assert.match(text, /cannot override player autonomy/i)
  assert.match(text, /Return exactly one JSON object/)
  assert.match(text, /FINAL OUTPUT REMINDER/)
  assert.doesNotMatch(text, /\[speaker:/)
  const assistantHistory = context.messages.filter(message => message.role === 'assistant')
  assert.ok(assistantHistory.length > 0)
  for (const message of assistantHistory) assert.ok(Array.isArray(JSON.parse(message.content).messages))
})

await test('muted characters cannot speak while spotlight changes speaker priority', async t => {
  const { app } = await testApp(t)
  app.repository.updateConversationCast(SAMPLE_IDS.conversation, SAMPLE_IDS.rowan, { muted: true })
  app.repository.updateConversationCast(SAMPLE_IDS.conversation, SAMPLE_IDS.lyra, { spotlight: true })
  const result = await app.turns.run(SAMPLE_IDS.conversation, { content: 'Lyra, lead this discussion. Mira may add one thought.' })
  assert.equal(result.messages.some(message => message.character_id === SAMPLE_IDS.rowan), false)
  assert.ok(result.messages.some(message => message.character_id === SAMPLE_IDS.lyra))
})
