#!/usr/bin/env node
import assert from 'node:assert/strict'
import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { createApp } from '../src/app.js'
import { reduceEvents } from '../src/domain/projection.js'
import { SAMPLE_IDS } from '../src/domain/seed.js'
import { narrationContradiction } from '../src/runtime/contracts.js'
import { PRODUCT_VERSION } from '../src/version.js'

function quietSink() { return { log() {}, info() {}, warn() {}, error() {}, debug() {} } }

function parseSse(value) {
  return String(value).split(/\n\n/).filter(Boolean).map(frame => {
    let event = 'message'
    let data = null
    for (const line of frame.split('\n')) {
      if (line.startsWith('event:')) event = line.slice(6).trim()
      if (line.startsWith('data:')) data = JSON.parse(line.slice(5).trim())
    }
    return { event, data }
  })
}

async function streamTurn(baseUrl, conversationId, step) {
  const started = Date.now()
  const response = await fetch(`${baseUrl}/api/conversations/${encodeURIComponent(conversationId)}/turn/stream`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ content: step.content, idempotency_key: step.idempotencyKey }),
  })
  const body = await response.text()
  assert.equal(response.status, 200, `Streaming endpoint returned ${response.status}`)
  const events = parseSse(body)
  const failed = events.find(item => item.event === 'turn.failed')
  if (failed) throw Object.assign(new Error(failed.data?.message || 'DeepSeek turn failed'), { code: failed.data?.code })
  const completed = events.findLast(item => item.event === 'turn.completed')?.data
  assert.ok(completed, 'Streaming response did not contain turn.completed')
  const receiptIndex = events.findIndex(item => item.event === 'action.receipt')
  const messageIndex = events.findIndex(item => item.event === 'message.completed')
  assert.ok(receiptIndex >= 0, 'Streaming response did not expose a player-visible Action receipt')
  assert.ok(messageIndex > receiptIndex, 'Action receipt must arrive before narrated prose')
  const receipts = events.filter(item => item.event === 'action.receipt').map(item => item.data)
  assert.ok(receipts.every(receipt => !Object.hasOwn(receipt, 'effects')), 'Player stream exposed internal effect paths')
  return {
    completed,
    receipts,
    messages: events.filter(item => item.event === 'message.completed').map(item => item.data),
    elapsedMs: Date.now() - started,
  }
}

function projection(app, conversationId) {
  const conversation = app.repository.getConversation(conversationId)
  const story = app.repository.getStory(conversation.story_id)
  return reduceEvents(app.repository.events(conversationId), story.initial_state)
}

const sourceDataDir = process.env.HT_SOURCE_DATA_DIR || join(homedir(), '.harness-tavern')
const sourceDatabasePath = join(sourceDataDir, 'tavern.sqlite3')
const sourceKeyPath = join(sourceDataDir, 'credentials.key')
assert.ok(existsSync(sourceDatabasePath), `No source database found at ${sourceDatabasePath}`)
assert.ok(existsSync(sourceKeyPath), `No credential key found at ${sourceKeyPath}`)

const isolatedDataDir = mkdtempSync(join(tmpdir(), 'harness-tavern-deepseek-verification-'))
copyFileSync(sourceKeyPath, join(isolatedDataDir, 'credentials.key'))
let app = null
let sourceDatabase = null
const providerCalls = []

const report = {
  version: PRODUCT_VERSION,
  provider: 'deepseek',
  isolation: 'temporary database with one encrypted connection copied read-only; source library unchanged',
  started_at: new Date().toISOString(),
  steps: [],
}

try {
  app = createApp({
    env: {
      ...process.env,
      HT_DATA_DIR: isolatedDataDir,
      HT_HOST: '127.0.0.1',
      HT_PORT: '0',
      HT_LOG_LEVEL: 'error',
      HT_PROVIDER_TIMEOUT_MS: process.env.HT_PROVIDER_TIMEOUT_MS || '240000',
      HT_SEED_SAMPLE_CONVERSATION: 'false',
    },
    loggerSink: quietSink(),
  })
  const complete = app.providers.complete.bind(app.providers)
  app.providers.complete = async (request, options) => {
    const result = await complete(request, options)
    const contract = request.messages.filter(message => message.role === 'system').map(message => message.content).join('\n\n')
    const character = contract.match(/isolated Character runtime for\s+.+?\s+\(([^)]+)\)/i)
    const phase = /control planner inside Harness Tavern/i.test(contract)
      ? 'interpretation'
      : character ? `character:${character[1]}` : 'narration:storyteller'
    providerCalls.push({
      phase,
      finish_reason: result.finishReason,
      content_length: String(result.content ?? '').length,
      reasoning_length: String(result.reasoningContent ?? '').length,
      content_excerpt: String(result.content ?? '').replace(/\s+/g, ' ').trim().slice(0, 500),
      fallback: result.fallback ?? null,
      usage: result.usage,
      latency_ms: result.latencyMs,
    })
    return result
  }

  sourceDatabase = new DatabaseSync(sourceDatabasePath, { readOnly: true })
  const connection = sourceDatabase.prepare(`
    SELECT provider_id, label, base_url, default_model, secret_envelope, config_json, created_at, updated_at
    FROM provider_connections
    WHERE provider_id = 'deepseek' AND enabled = 1 AND secret_envelope IS NOT NULL
    ORDER BY updated_at DESC LIMIT 1
  `).get()
  assert.ok(connection, 'No enabled DeepSeek API connection with a credential was found')
  sourceDatabase.close()
  sourceDatabase = null

  const connectionId = 'conn_deepseek_real_verification'
  app.db.raw.prepare(`
    INSERT INTO provider_connections(id, provider_id, label, base_url, default_model, secret_envelope, config_json, enabled, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
  `).run(
    connectionId, connection.provider_id, 'DeepSeek isolated verification', connection.base_url,
    connection.default_model, connection.secret_envelope, connection.config_json,
    connection.created_at, connection.updated_at,
  )

  const catalog = await app.providers.listModels(connectionId, { refresh: true })
  const modelIds = catalog.models.map(model => model.id)
  const modelId = modelIds.includes(connection.default_model)
    ? connection.default_model
    : modelIds.includes('deepseek-v4-flash') ? 'deepseek-v4-flash' : modelIds[0]
  assert.ok(modelId, 'DeepSeek returned an empty model catalog')
  report.model = modelId
  report.catalog_models = modelIds

  const conversation = app.repository.createConversation({
    title: 'Isolated DeepSeek causal verification',
    story_id: SAMPLE_IDS.story,
    persona_id: SAMPLE_IDS.persona,
    connection_id: connectionId,
    model_id: modelId,
    thinking_intensity: 'low',
    generation: { response_length: 'short', initiative: 'reactive', pacing: 'focused', temperature: 0.2, top_p: 0.9 },
    prompt: {
      custom_instructions: 'Use English. Keep each narration to one or two sentences. Address only the attempted action and do not reveal private character knowledge.',
      history_messages: null,
      context_budget_tokens: null,
    },
  })
  app.repository.updateConversationCast(conversation.id, SAMPLE_IDS.mira, { spotlight: true })
  const address = await app.listen()
  const baseUrl = `http://127.0.0.1:${address.port}`

  const steps = [
    { id: 'blocked-open', content: 'Mira, I pull at the locked west-hall door and try to open it.', action: 'open', status: 'rejected', idempotencyKey: 'deepseek-real-blocked-open' },
    { id: 'take-key', content: 'Mira, I pick up the archive key from the central hall.', action: 'take', status: 'resolved', idempotencyKey: 'deepseek-real-take-key' },
    { id: 'unlock-door', content: 'Mira, I use the archive key to unlock the west-hall door.', action: 'unlock', status: 'resolved', idempotencyKey: 'deepseek-real-unlock-door' },
    { id: 'open-door', content: 'Mira, I open the west-hall door.', action: 'open', status: 'resolved', idempotencyKey: 'deepseek-real-open-door' },
  ]

  let finalResult = null
  for (const step of steps) {
    const turn = await streamTurn(baseUrl, conversation.id, step)
    const receipt = turn.receipts.find(item => item.actor_id === 'user' && item.action_type === step.action)
    assert.ok(receipt, `${step.id} did not resolve the expected ${step.action} Action`)
    assert.equal(receipt.status, step.status, `${step.id} returned the wrong Action status`)
    assert.equal(turn.messages.length, 1, `${step.id} did not respect focused one-speaker pacing`)
    assert.deepEqual(turn.messages[0].participant_ids, [SAMPLE_IDS.mira], `${step.id} selected a Character outside the spotlight`)
    assert.ok(turn.messages[0].scene_blocks?.some(block => block.type === 'narration'), `${step.id} did not return structured narration`)
    assert.ok(
      turn.messages[0].scene_blocks.every(block => block.type !== 'dialogue' || block.character_id === SAMPLE_IDS.mira),
      `${step.id} attributed dialogue to a Character that did not choose to speak`,
    )
    assert.equal(turn.completed.context_manifests.control.policy, 'provider-managed-no-tavern-ceiling')
    assert.equal(turn.completed.context_manifests.control.truncated_blocks, 0)

    const current = projection(app, conversation.id)
    if (step.id === 'blocked-open') {
      assert.equal(current.world.doors.west_hall.locked, true)
      assert.equal(current.world.doors.west_hall.open, false)
      const narration = turn.messages.map(message => message.content).join(' ')
      assert.match(narration, /lock|shut|closed|holds? fast|unyield|resist|cannot|can't|not open|refus|remain/i, 'Rejected action was narrated as if it might have succeeded')
    }
    if (step.id === 'take-key') assert.ok(current.world.inventory.user.includes('archive_key'))
    if (step.id === 'unlock-door') {
      assert.equal(current.world.doors.west_hall.locked, false)
      assert.equal(current.world.doors.west_hall.open, false)
      assert.equal(
        narrationContradiction(turn.messages[0].content, current, current.receipts.filter(item => item.action_id === receipt.action_id)),
        null,
        'Unlock narration contradicted the committed closed-door state',
      )
    }
    if (step.id === 'open-door') {
      assert.equal(current.world.doors.west_hall.open, true)
      assert.match(turn.messages[0].content, /\bopen|swings?|gives way|moves? inward/i, 'Open narration did not reflect the committed effect')
    }

    const excerpt = turn.messages[0].content.replace(/\s+/g, ' ').trim().slice(0, 240)
    report.steps.push({
      id: step.id,
      action: receipt.action_type,
      status: receipt.status,
      narration_count: turn.messages.length,
      narration_excerpt: excerpt,
      elapsed_ms: turn.elapsedMs,
      usage: turn.completed.usage,
    })
    finalResult = turn.completed
    console.error(`[deepseek] ${step.id}: ${receipt.status}, ${turn.messages.length} narration(s), ${turn.elapsedMs} ms`)
  }

  const finalProjection = projection(app, conversation.id)
  const discardedActionCount = app.repository.events(conversation.id)
    .filter(event => event.type === 'intent.interpreted')
    .reduce((sum, event) => sum + Number(event.payload.discarded_action_count ?? 0), 0)
  report.final_state = {
    state_revision: finalProjection.stateRevision,
    archive_key_held: finalProjection.world.inventory.user.includes('archive_key'),
    west_hall_locked: finalProjection.world.doors.west_hall.locked,
    west_hall_open: finalProjection.world.doors.west_hall.open,
    agenda_evaluations: Object.fromEntries(Object.values(finalProjection.agendas).map(agenda => [agenda.id, agenda.evaluation_count])),
    agenda_statuses: Object.fromEntries(Object.values(finalProjection.agendas).map(agenda => [agenda.id, agenda.status])),
    discarded_unauthorised_actions: discardedActionCount,
  }
  assert.ok(finalProjection.world.inventory.user.includes('archive_key'))
  assert.equal(finalProjection.world.doors.west_hall.locked, false)
  assert.equal(finalProjection.world.doors.west_hall.open, true)
  assert.equal(Object.values(finalProjection.agendas).length, 3, 'Story-specific intent should not be duplicated by generic card-goal loops')
  assert.ok(Object.values(finalProjection.agendas).every(agenda => agenda.status === 'active'), 'A model assertion incorrectly closed a persistent Agenda')
  assert.ok(finalProjection.agendas['mira-protect-archive'].evaluation_count >= 4, 'The selected Character did not evaluate her persistent Agenda on every command')
  assert.equal(finalProjection.agendas['rowan-survive'].evaluation_count, 0, 'An unselected Character evaluated private intent outside its isolated runtime')
  assert.equal(finalProjection.agendas['lyra-stop-gate'].evaluation_count, 0, 'An unselected Character evaluated intent outside its isolated runtime')
  assert.equal(finalProjection.characterStates[SAMPLE_IDS.mira].initiative, 'proactive')
  assert.ok(finalProjection.characterStates[SAMPLE_IDS.mira].perceived_event_ids.length > 0, 'Character perceptions were not persisted')
  assert.equal(finalProjection.characterStates[SAMPLE_IDS.rowan], undefined, 'An unselected Character received an inner-state event')
  assert.equal(finalProjection.characterStates[SAMPLE_IDS.lyra], undefined, 'An unselected Character received an inner-state event')
  assert.ok(providerCalls.some(call => call.phase === `character:${SAMPLE_IDS.mira}`), 'DeepSeek was not invoked as the isolated Character runtime')
  assert.ok(providerCalls.some(call => call.phase === 'narration:storyteller'), 'DeepSeek was not invoked as the Storyteller')
  assert.doesNotMatch(report.steps.map(step => step.narration_excerpt).join('\n'), /inside (?:his|the) (?:red )?scarf|carries (?:one half|a fragment)|PRIVATE_/i, 'Narration leaked Rowan’s private lens state')

  const eventCount = app.repository.events(conversation.id).length
  const replayResponse = await fetch(`${baseUrl}/api/conversations/${encodeURIComponent(conversation.id)}/turn`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ content: steps.at(-1).content, idempotency_key: steps.at(-1).idempotencyKey }),
  })
  const replay = await replayResponse.json()
  assert.equal(replayResponse.status, 200)
  assert.equal(replay.loop_id, finalResult.loop_id)
  assert.equal(app.repository.events(conversation.id).length, eventCount, 'Idempotent retry appended duplicate events')

  report.idempotent_retry = true
  report.source_database_writes = 0
  report.provider_calls = providerCalls
  report.passed = true
  report.completed_at = new Date().toISOString()
  console.log(JSON.stringify(report, null, 2))
} catch (error) {
  report.provider_calls = providerCalls
  report.passed = false
  report.error = { code: error.code || 'verification_failed', message: error.message }
  report.completed_at = new Date().toISOString()
  console.error(JSON.stringify(report, null, 2))
  throw error
} finally {
  if (sourceDatabase) sourceDatabase.close()
  if (app) await app.close().catch(() => {})
  rmSync(isolatedDataDir, { recursive: true, force: true })
}
