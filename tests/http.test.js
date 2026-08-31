import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { testApp, jsonRequest } from './helpers.js'
import { SAMPLE_IDS } from '../src/domain/seed.js'

await test('bootstrap exposes the Tavern-first experience, model choices, and ensemble sample', async t => {
  const { baseUrl } = await testApp(t)
  const { response, body } = await jsonRequest(baseUrl, '/api/bootstrap')
  assert.equal(response.status, 200)
  assert.equal(body.version, '0.16.0')
  assert.deepEqual(body.deployment, { scope: 'local-single-owner', multi_tenant: false })
  assert.deepEqual(body.thinking_intensities, ['auto', 'none', 'low', 'medium', 'high', 'max'])
  assert.ok(body.provider_presets.length >= 30)
  assert.equal(body.generation_presets.length, 3)
  assert.ok(body.capabilities.includes('conversation-model-switching'))
  assert.deepEqual(body.account_connectors.map(item => item.id), ['openrouter-oauth'])
  assert.equal(body.sample.story_id, SAMPLE_IDS.story)
  assert.equal(body.sample.cast_member_ids.length, 3)
  assert.equal(body.conversations.some(item => 'mode' in item), false)
  const sampleConversation = body.conversations.find(item => item.id === SAMPLE_IDS.conversation)
  assert.equal(sampleConversation.group.kind, 'story')
  assert.equal(sampleConversation.group.id, SAMPLE_IDS.story)
  assert.equal(sampleConversation.group.cast.length, 3)
  assert.ok(body.home.continue.length >= 1)
  assert.ok(body.capabilities.includes('framework-first-content'))
  assert.ok(body.capabilities.includes('explicit-content-lifecycle'))
  assert.ok(body.capabilities.includes('portable-sharing'))
  assert.deepEqual(body.content_types.map(item => item.kind), ['story'])
  assert.equal(Object.hasOwn(body, 'characters'), false)
  assert.ok(body.capabilities.includes('story-owned-cast'))
  assert.ok(body.capabilities.includes('story-bundled-runtime'))
  assert.ok(body.capabilities.includes('single-storyteller-beat'))
  assert.ok(body.capabilities.includes('bounded-long-context-retrieval'))
  assert.ok(body.capabilities.includes('conversation-attachments'))
  assert.ok(body.content_types.every(item => item.creation_mode === 'explicit' && item.generated === false))
  assert.deepEqual(body.contributions.quick_actions, [])
})

await test('health, static UI, and public share page include security headers', async t => {
  const { baseUrl } = await testApp(t)
  const health = await fetch(`${baseUrl}/api/health`)
  assert.equal(health.status, 200)
  assert.equal((await health.clone().json()).deployment_scope, 'local-single-owner')
  assert.equal(health.headers.get('x-content-type-options'), 'nosniff')
  assert.match(health.headers.get('content-security-policy'), /frame-ancestors 'none'/)
  const page = await fetch(`${baseUrl}/`)
  assert.equal(page.status, 200)
  assert.match(await page.text(), /Harness Tavern/)
  const sharePage = await fetch(`${baseUrl}/share/example-token`)
  assert.equal(sharePage.status, 200)
  assert.match(await sharePage.text(), /Shared through Harness Tavern/)
})

await test('updates friendly response settings without introducing execution modes', async t => {
  const { baseUrl } = await testApp(t)
  const result = await jsonRequest(baseUrl, `/api/conversations/${SAMPLE_IDS.conversation}`, {
    method: 'PATCH',
    body: JSON.stringify({
      thinking_intensity: 'max',
      generation: { response_length: 'detailed', initiative: 'proactive', pacing: 'ensemble', temperature: 1.1, top_p: 0.92, max_output_tokens: 2600 },
      prompt: { custom_instructions: 'Keep the prose atmospheric.', history_messages: 18 },
    }),
  })
  assert.equal(result.response.status, 200)
  assert.equal(result.body.thinking_intensity, 'max')
  assert.equal(result.body.generation.response_length, 'detailed')
  assert.equal(result.body.generation.temperature, 1.1)
  assert.equal(result.body.generation.max_output_tokens, undefined)
  assert.equal(result.body.prompt.custom_instructions, 'Keep the prose atmospheric.')
  assert.equal(result.body.prompt.history_messages, 18)
  assert.equal(result.body.mode, undefined)
})

await test('starts without dummy conversations unless the test fixture is explicitly requested', async t => {
  const { baseUrl } = await testApp(t, { HT_SEED_SAMPLE_CONVERSATION: 'false' })
  const { body } = await jsonRequest(baseUrl, '/api/bootstrap')
  assert.equal(body.conversations.length, 0)
  assert.equal(body.sample.conversation_id, null)
  assert.ok(body.stories.length >= 1)
  assert.equal(Object.hasOwn(body, 'characters'), false)
})

await test('a fresh product instance has no built-in model and requires an explicit AI connection to play', async t => {
  const { baseUrl } = await testApp(t, { HT_SEED_SAMPLE_CONVERSATION: 'false' }, { deterministicProvider: false })
  const { body } = await jsonRequest(baseUrl, '/api/bootstrap')
  assert.deepEqual(body.provider_connections, [])
  assert.equal(body.provider_presets.some(item => item.id === 'mock'), false)
  const started = await jsonRequest(baseUrl, '/api/playthroughs', {
    method: 'POST',
    body: JSON.stringify({ story_id: SAMPLE_IDS.story, persona_id: SAMPLE_IDS.persona }),
  })
  assert.equal(started.response.status, 409)
  assert.equal(started.body.error.code, 'connection_required')
})

await test('bootstrap groups single-actor playthroughs by Story identity', async t => {
  const { app, baseUrl } = await testApp(t)
  const story = app.library.add({
    kind: 'story',
    content: { title: 'A quiet Story with Mira', cast: [{ character: { name: 'Mira of the shore' } }] },
  }).item
  const { conversation } = app.repository.createPlaythrough({
    story_id: story.id,
    persona_id: SAMPLE_IDS.persona,
    skip_opening: true,
  })
  const { body } = await jsonRequest(baseUrl, '/api/bootstrap')
  const item = body.conversations.find(candidate => candidate.id === conversation.id)
  assert.equal(item.group.kind, 'story')
  assert.equal(item.group.id, story.id)
  assert.equal(item.group.title, story.title)
  assert.deepEqual(item.group.cast.map(member => member.id), [story.cast[0].character_id])
  assert.equal('private_context' in item.group.cast[0], false)
})

await test('prefers a connected real API and its default model for new conversations', async t => {
  const { app } = await testApp(t, { HT_SEED_SAMPLE_CONVERSATION: 'false' })
  const connection = app.providers.createConnection({ provider_id: 'deepseek', label: 'DeepSeek', api_key: 'test-key' })
  const conversation = app.repository.createConversation({ title: 'Real model chat', character_ids: [SAMPLE_IDS.mira], persona_id: SAMPLE_IDS.persona })
  assert.equal(conversation.connection_id, connection.id)
  assert.equal(conversation.model_id, 'deepseek-v4-flash')
})

await test('creates reusable generation presets and removes custom presets', async t => {
  const { baseUrl } = await testApp(t)
  const created = await jsonRequest(baseUrl, '/api/generation-presets', {
    method: 'POST',
    body: JSON.stringify({
      name: 'Quiet mystery',
      description: 'Low-variance mystery dialogue.',
      settings: {
        thinking_intensity: 'medium',
        generation: { temperature: 0.55, top_p: 0.88, max_output_tokens: 1200 },
        prompt: { custom_instructions: 'Keep clues subtle.', history_messages: 40 },
      },
    }),
  })
  assert.equal(created.response.status, 201)
  assert.equal(created.body.builtin, false)
  assert.equal(created.body.settings.generation.temperature, 0.55)
  assert.equal(created.body.settings.generation.max_output_tokens, undefined)
  assert.equal(created.body.settings.prompt.custom_instructions, 'Keep clues subtle.')

  const removed = await jsonRequest(baseUrl, `/api/generation-presets/${created.body.id}`, { method: 'DELETE' })
  assert.equal(removed.response.status, 200)
  assert.equal(removed.body.deleted, true)
})

await test('deletes a conversation and its playthrough instead of only hiding it', async t => {
  const { baseUrl } = await testApp(t)
  const created = await jsonRequest(baseUrl, '/api/playthroughs', {
    method: 'POST',
    body: JSON.stringify({ story_id: SAMPLE_IDS.story, persona_id: SAMPLE_IDS.persona, connection_id: SAMPLE_IDS.connection }),
  })
  const conversationId = created.body.conversation.id
  const playthroughId = created.body.playthrough.id
  const removed = await jsonRequest(baseUrl, `/api/conversations/${conversationId}`, { method: 'DELETE' })
  assert.equal(removed.response.status, 200)
  const bootstrap = await jsonRequest(baseUrl, '/api/bootstrap')
  assert.equal(bootstrap.body.conversations.some(item => item.id === conversationId), false)
  assert.equal(bootstrap.body.playthroughs.some(item => item.id === playthroughId), false)
})

await test('streams one complete Storyteller beat for a multi-character turn over SSE', async t => {
  const { baseUrl } = await testApp(t)
  const response = await fetch(`${baseUrl}/api/conversations/${SAMPLE_IDS.conversation}/turn/stream`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ content: 'All three of you: what changed when the lights went out?' }),
  })
  assert.equal(response.status, 200)
  assert.match(response.headers.get('content-type'), /text\/event-stream/)
  const text = await response.text()
  assert.match(text, /event: turn.started/)
  assert.equal((text.match(/event: message.completed/g) ?? []).length, 1)
  assert.match(text, /"character_id":"narrator"/)
  assert.match(text, /event: turn.completed/)
  assert.doesNotMatch(text, /event: turn.failed/)
})

await test('player APIs expose causal outcomes without private effect paths or control plans', async t => {
  const { app, baseUrl } = await testApp(t)
  const turn = await jsonRequest(baseUrl, `/api/conversations/${SAMPLE_IDS.conversation}/turn`, {
    method: 'POST',
    body: JSON.stringify({ content: 'Take the archive key.', idempotency_key: 'http-private-receipt' }),
  })
  assert.equal(turn.response.status, 200)
  assert.equal(turn.body.action_receipts[0].status, 'resolved')
  assert.equal(turn.body.action_receipts[0].changed_fact_count, 2)
  assert.equal('effects' in turn.body.action_receipts[0], false)
  assert.equal('actions' in turn.body, false)

  const view = await jsonRequest(baseUrl, `/api/conversations/${SAMPLE_IDS.conversation}`)
  assert.equal('effects' in view.body.causal.recent_receipts[0], false)
  const loop = await jsonRequest(baseUrl, `/api/control-loops/${turn.body.loop_id}`)
  assert.equal('result' in loop.body, false)
  assert.equal('included' in loop.body.context_manifests.control, false)
  const narrationManifest = Object.values(loop.body.context_manifests.narration)[0]
  assert.equal(narrationManifest.policy, 'provider-managed-no-tavern-ceiling')
  assert.equal('included' in narrationManifest, false)

  const conversation = app.repository.getConversation(SAMPLE_IDS.conversation)
  app.db.appendEvent({
    conversationId: conversation.id, branchId: conversation.current_branch_id, type: 'action.resolved', actorId: SAMPLE_IDS.rowan,
    payload: { status: 'resolved', action_id: 'npc-private-action', action_type: 'speak', actor_id: SAMPLE_IDS.rowan, outcome: 'succeeded', reason: 'PRIVATE_NPC_AGENDA_REASON', effects: [] },
  })
  app.db.appendEvent({
    conversationId: conversation.id, branchId: conversation.current_branch_id, type: 'observation.created', actorId: SAMPLE_IDS.rowan,
    payload: { id: 'npc-private-observation', action_id: 'npc-private-action', actor_id: SAMPLE_IDS.rowan, audience: ['director'], content: 'PRIVATE_NPC_OBSERVATION', kind: 'result' },
  })
  app.db.appendEvent({
    conversationId: conversation.id, branchId: conversation.current_branch_id, type: 'action.resolved', actorId: SAMPLE_IDS.mira,
    payload: { status: 'resolved', action_id: 'npc-public-action', action_type: 'speak', actor_id: SAMPLE_IDS.mira, outcome: 'succeeded', reason: 'PRIVATE_MOTIVE_BEHIND_PUBLIC_ACTION', effects: [] },
  })
  app.db.appendEvent({
    conversationId: conversation.id, branchId: conversation.current_branch_id, type: 'observation.created', actorId: SAMPLE_IDS.mira,
    payload: { id: 'npc-public-observation', action_id: 'npc-public-action', actor_id: SAMPLE_IDS.mira, audience: ['public'], content: 'Mira speaks.', kind: 'result' },
  })
  app.db.appendEvent({
    conversationId: conversation.id, branchId: conversation.current_branch_id, type: 'agenda.created', actorId: SAMPLE_IDS.mira,
    payload: { id: 'public-agenda', owner_id: SAMPLE_IDS.mira, objective: 'Keep the archive safe.', priority: 1, visibility: 'public', complete_when: [{ path: 'PRIVATE_AGENDA_PATH', equals: true }] },
  })
  app.db.appendEvent({
    conversationId: conversation.id, branchId: conversation.current_branch_id, type: 'agenda.evaluated', actorId: SAMPLE_IDS.mira,
    payload: { agenda_id: 'public-agenda', decision: 'defer', reason: 'PRIVATE_AGENDA_REASON' },
  })
  const privateSafeView = await jsonRequest(baseUrl, `/api/conversations/${SAMPLE_IDS.conversation}`)
  assert.equal(privateSafeView.body.causal.recent_receipts.some(item => item.action_id === 'npc-private-action'), false)
  const publicNpcReceipt = privateSafeView.body.causal.recent_receipts.find(item => item.action_id === 'npc-public-action')
  assert.ok(publicNpcReceipt)
  assert.equal('reason' in publicNpcReceipt, false)
  const publicAgenda = privateSafeView.body.causal.active_agendas.find(item => item.id === 'public-agenda')
  assert.deepEqual(publicAgenda, {
    id: 'public-agenda', owner_id: SAMPLE_IDS.mira, objective: 'Keep the archive safe.', priority: 1,
    status: 'active', visibility: 'public', evaluation_count: 1,
  })
  assert.doesNotMatch(JSON.stringify(privateSafeView.body), /PRIVATE_(?:NPC|MOTIVE|AGENDA)/)
})

await test('creates a provider connection through the advanced settings API', async t => {
  const { baseUrl } = await testApp(t)
  const created = await jsonRequest(baseUrl, '/api/provider-connections', {
    method: 'POST',
    body: JSON.stringify({ provider_id: 'ollama', label: 'Local Ollama', base_url: 'http://127.0.0.1:11434/v1', default_model: 'llama3.2', allow_empty_key: true }),
  })
  assert.equal(created.response.status, 201)
  assert.equal(created.body.provider_id, 'ollama')
  assert.equal(created.body.has_api_key, false)
})

await test('creator runtime debugging explains Storyteller participation, Lore, transforms, actions, and retrieval without calling a model', async t => {
  const { baseUrl } = await testApp(t)
  const result = await jsonRequest(baseUrl, `/api/creator/stories/${SAMPLE_IDS.story}/runtime-debug`, {
    method: 'POST',
    body: JSON.stringify({ user_message: 'Mira, inspect the celestial lens archive.' }),
  })
  assert.equal(result.response.status, 200)
  assert.equal(result.body.storyteller.mode, 'single_storyteller_beat')
  assert.equal(result.body.storyteller.mandatory_speakers, 0)
  assert.equal(result.body.storyteller.participant_candidates[0].character_id, SAMPLE_IDS.mira)
  assert.ok(result.body.lore.active_ids.includes('public-lens'))
  assert.ok(result.body.actions.some(item => item.key === 'observe'))
  assert.ok(result.body.context.included.some(item => item.id === 'control-contract'))
  assert.ok(result.body.retrieval.length > 0)
})

await test('connection diagnostics and aggregate usage are inspectable without exposing credentials', async t => {
  const { app, baseUrl } = await testApp(t)
  const diagnostic = await jsonRequest(baseUrl, `/api/provider-connections/${SAMPLE_IDS.connection}/test`, { method: 'POST', body: '{}' })
  assert.equal(diagnostic.response.status, 200)
  assert.equal(diagnostic.body.ok, true)
  assert.equal(diagnostic.body.default_model_available, true)
  assert.equal(diagnostic.body.model_count, 1)
  assert.equal(JSON.stringify(diagnostic.body).includes('api_key'), false)

  await app.turns.run(SAMPLE_IDS.conversation, { content: 'Look at the archive.' })
  const usage = await jsonRequest(baseUrl, '/api/usage')
  assert.equal(usage.response.status, 200)
  assert.ok(usage.body.totals.calls >= 2)
  assert.ok(usage.body.totals.total_tokens > 0)
  assert.ok(usage.body.by_model.some(item => item.model_id === 'test/causal-ensemble'))
  assert.ok(usage.body.retrieval.documents > 0)
})

await test('begins OpenRouter account authorization over API', async t => {
  const { baseUrl } = await testApp(t)
  const result = await jsonRequest(baseUrl, '/api/account-connections/openrouter-oauth/begin', { method: 'POST', body: '{}' })
  assert.equal(result.response.status, 200)
  const url = new URL(result.body.authorization_url)
  assert.equal(url.origin, 'https://openrouter.ai')
  assert.ok(url.searchParams.get('code_challenge'))
})

await test('non-loopback-style access token gate rejects missing and accepts valid token', async t => {
  const { baseUrl } = await testApp(t, { HT_ACCESS_TOKEN: 'test-access-token' })
  const rejected = await fetch(`${baseUrl}/api/bootstrap`)
  assert.equal(rejected.status, 401)
  const accepted = await fetch(`${baseUrl}/api/bootstrap`, { headers: { 'x-harness-tavern-token': 'test-access-token' } })
  assert.equal(accepted.status, 200)
})

await test('browser surface is Tavern-first and keeps technical controls out of primary navigation', () => {
  const root = fileURLToPath(new URL('../public/', import.meta.url))
  const html = readFileSync(`${root}/index.html`, 'utf8')
  const js = readFileSync(`${root}/app.js`, 'utf8')
  const css = readFileSync(`${root}/styles.css`, 'utf8')
  assert.match(html, />Home</)
  assert.match(html, />Chats</)
  assert.match(html, />Library</)
  assert.doesNotMatch(html, />Create</)
  assert.match(html, /data-action="new-content"/)
  assert.match(html, /AI services/i)
  assert.doesNotMatch(html, /data-view=["']models["']/i)
  assert.doesNotMatch(html, />State</i)
  assert.doesNotMatch(js, /name:\s*["']max_output_tokens["']/)
  assert.match(js, /Import SillyTavern/)
  assert.match(js, /\/api\/library\/items/)
  assert.doesNotMatch(js, /quickCreate|Describe a story|Create editable draft/)
  assert.match(html, /id="conversationRail"/)
  assert.match(html, /id="conversationGroups"/)
  assert.match(js, /function groupedConversations\(/)
  assert.match(js, /function openNewChatChooser\(/)
  assert.match(js, /\['story', uiText\('故事'/)
  assert.doesNotMatch(html, /data-tab="characters"/)
  assert.match(html, /Every Story can contain its own cast, lore, prompt layers, transforms, actions/)
  assert.match(js, /Cast owned by this Story/)
  assert.match(js, /Text transforms JSON/)
  assert.match(js, /class: 'quick-settings-grid'/)
  assert.match(css, /\.conversation-row\.active/)
  assert.match(css, /\.drawer\.modeless/)
  assert.match(js, /name:\s*["']thinking_intensity["']/)
  assert.match(js, /numericField\(["']frequency_penalty["']/)
  for (const legacy of ['direct', 'stateful', 'agentic', 'adaptive']) {
    assert.doesNotMatch(html.toLowerCase(), new RegExp(`value=["']${legacy}["']`))
    assert.doesNotMatch(js.toLowerCase(), new RegExp(`thinking_intensity:\\s*["']${legacy}["']`))
  }
})
