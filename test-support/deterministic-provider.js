function systemText(request) {
  return request.messages.filter(message => message.role === 'system').map(message => message.content).join('\n\n')
}

function lastUser(request) {
  return [...request.messages].reverse().find(message => message.role === 'user')?.content ?? ''
}

function jsonAfter(text, marker) {
  const start = text.indexOf(marker)
  if (start < 0) return null
  const line = text.slice(start + marker.length).trimStart().split('\n')[0]
  try { return JSON.parse(line) } catch { return null }
}

function usage(request, completionTokens = 80) {
  const promptTokens = Math.max(120, Math.ceil(request.messages.reduce((sum, item) => sum + item.content.length, 0) / 4))
  const reasoningTokens = request.thinkingIntensity === 'none' ? 0 : 24
  return { promptTokens, completionTokens, reasoningTokens, totalTokens: promptTokens + completionTokens + reasoningTokens, costUsd: 0 }
}

function targetFrom(text) {
  if (/west|西侧|西廊/i.test(text)) return 'west_hall'
  if (/lens|透镜|镜室/i.test(text)) return 'lens_chamber'
  if (/archive|档案/i.test(text)) return 'archive'
  return 'west_hall'
}

function controlPlan(request, contract, userMessage) {
  const characterMatches = [...contract.matchAll(/CHARACTER_ID:\s*([^\s]+)\s*\|\s*NAME:\s*([^\n]+)/g)]
  const cast = characterMatches.map(match => ({ id: match[1], name: match[2].trim() }))
  const registered = new Set([...contract.matchAll(/"key":"([^"]+)"/g)].map(match => match[1]))
  const wantsEnsemble = /\b(all|everyone|each|three|together)\b|所有|每个人|三个人|一起/iu.test(userMessage) || /Multi-character pacing:\s*ensemble/i.test(contract)
  const participants = cast.length
    ? cast.slice(0, wantsEnsemble ? Math.min(3, cast.length) : 1).map(character => character.id)
    : []
  let action
  if (/remember|记住|my name is|我叫/i.test(userMessage)) {
    action = { type: 'remember', actor_id: 'user', parameters: { content: userMessage, visibility: 'public' }, reason: 'The player explicitly asked to preserve a fact.' }
  } else if (/\b(take|pick up|collect)\b|拿起|拾取|捡起/i.test(userMessage) && registered.has('take')) {
    action = { type: 'take', actor_id: 'user', parameters: { item: /key|钥匙/i.test(userMessage) ? 'archive_key' : 'item' }, reason: 'The player explicitly attempts to take an item.' }
  } else if (/unlock|解锁/i.test(userMessage) && registered.has('unlock')) {
    action = { type: 'unlock', actor_id: 'user', parameters: { target: targetFrom(userMessage), tool: 'archive_key' }, reason: 'The player explicitly attempts to unlock a target.' }
  } else if (/\bopen\b|打开/i.test(userMessage) && registered.has('open')) {
    action = { type: 'open', actor_id: 'user', parameters: { target: targetFrom(userMessage) }, reason: 'The player explicitly attempts to open a target.' }
  } else if (/\b(go|move|enter|walk)\b|前往|进入|移动/i.test(userMessage) && registered.has('move')) {
    action = { type: 'move', actor_id: 'user', parameters: { target: targetFrom(userMessage) }, reason: 'The player explicitly attempts to move.' }
  } else if (/look|inspect|observe|查看|观察|检查/i.test(userMessage)) {
    action = { type: 'observe', actor_id: 'user', parameters: { focus: userMessage }, reason: 'The player asks to observe.' }
  } else if (/wait|等待/i.test(userMessage)) {
    action = { type: 'wait', actor_id: 'user', parameters: {}, reason: 'The player waits.' }
  } else {
    action = { type: 'attempt', actor_id: 'user', parameters: { description: userMessage }, reason: 'Free-form input has no more specific registered action.' }
  }
  const agendas = jsonAfter(contract, 'ACTIVE PERSISTENT AGENDAS:\n') ?? {}
  const agendaDecisions = Object.values(agendas).filter(agenda => agenda?.status === 'active').map(agenda => ({
    agenda_id: agenda.id,
    decision: 'defer',
    reason: 'The deterministic test provider acknowledges this persistent intent; no independent action is required in this beat.',
  }))
  return {
    actions: [action],
    agenda_decisions: agendaDecisions,
    participants,
    internal_summary: `Deterministic causal test plan using ${request.thinkingIntensity} thinking intensity.`,
  }
}

function characterPlan(request, contract) {
  const identity = contract.match(/isolated Character runtime for\s+(.+?)\s+\(([^)]+)\)/i)
  const name = identity?.[1]?.trim() || 'Character'
  const characterId = identity?.[2]?.trim() || 'character'
  const userMessage = lastUser(request)
  const observations = jsonAfter(contract, 'ACTOR-VISIBLE OBSERVATIONS (perceived_event_ids must come from id or event_id here):\n') ?? []
  const agendas = jsonAfter(contract, "THIS CHARACTER'S ACTIVE PERSISTENT AGENDAS:\n") ?? []
  const directlyAddressed = new RegExp(`(?:@|\\b)${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:\\b|$)`, 'iu').test(userMessage)
  const speaks = directlyAddressed || !/Rowan|Lyra/i.test(name)
  const participation = speaks ? 'speak' : /Rowan/i.test(name) ? 'remain_silent' : 'react'
  return {
    character_id: characterId,
    participation,
    perceived_event_ids: observations.slice(-8).flatMap(item => [item.id, item.event_id]).filter(value => value !== undefined && value !== null).map(String),
    belief_updates: [{
      id: 'belief:latest-player-intent',
      subject: 'the player’s latest contribution',
      claim: userMessage,
      confidence: 0.8,
      source_event_ids: [],
    }],
    emotional_state: { tone: /Rowan/i.test(name) ? 'guarded' : /Lyra/i.test(name) ? 'watchful' : 'attentive', tension: 0.35, warmth: 0.1, resolve: 0.65 },
    relationship_shifts: [],
    intent: `${name} responds according to their own priorities without deciding for the player.`,
    agenda_decisions: agendas.map(agenda => ({ agenda_id: agenda.id, decision: 'defer', reason: 'No independent physical Action is required in this deterministic beat.' })),
    spontaneous_actions: [],
    speech_act: speaks ? { kind: 'response', meaning: `${name} answers the immediate situation without exposing private knowledge.`, disclose: [] } : null,
    public_cue: participation === 'remain_silent' ? `${name} keeps their reaction contained.` : `${name} visibly attends to the change in the scene.`,
  }
}

function narration(request, contract) {
  const participantMatch = contract.match(/selected participants are possibilities, not mandatory speakers:\s*([^\n]+)/i)
  const participantNames = participantMatch?.[1]?.split(',').map(value => value.replace(/\s*\([^)]*\)\s*$/, '').trim()).filter(Boolean) ?? []
  const actorName = participantNames[0] || 'The scene'
  const receipts = jsonAfter(contract, 'VERIFIED ACTION RECEIPTS:\n') ?? []
  const observations = jsonAfter(contract, 'OBSERVATIONS AVAILABLE TO THIS SPEAKER:\n') ?? []
  const rejected = receipts.find(receipt => receipt.status === 'rejected' || receipt.outcome === 'rejected')
  const changed = receipts.reduce((sum, receipt) => sum + Number(receipt.changed_fact_count ?? 0), 0)
  const observed = observations.map(item => item.content).filter(Boolean).join(' ')
  const content = rejected
    ? `*The story follows the attempt into the world's resistance.* ${actorName !== 'The scene' ? `${actorName} remains part of the unfolding scene. ` : ''}“${rejected.reason}”`
    : changed
      ? `*The scene turns on what verifiably changed.* ${observed || 'The story settles into its new, recorded state.'}`
      : `*The story continues without inventing a result.* ${observed || 'The attempt is acknowledged, but no unverified fact changes.'}`
  const briefs = jsonAfter(contract, 'Follow only these Character decisions: ') ?? []
  const blocks = [{ type: 'narration', content }]
  for (const brief of briefs) {
    if (brief.participation === 'remain_silent') continue
    if (brief.public_cue) blocks.push({ type: 'action', character_id: brief.character_id, content: brief.public_cue })
    if (brief.speech_act) blocks.push({ type: 'dialogue', character_id: brief.character_id, content: brief.speech_act.meaning })
  }
  return { blocks }
}

export class DeterministicTestAdapter {
  async complete(request) {
    const contract = systemText(request)
    const envelope = /control planner inside Harness Tavern/i.test(contract)
      ? controlPlan(request, contract, lastUser(request))
      : /isolated Character runtime for/i.test(contract)
        ? characterPlan(request, contract)
      : narration(request, contract)
    return {
      content: JSON.stringify(envelope),
      finishReason: 'stop',
      usage: usage(request),
      raw: envelope,
      requestBody: { model: request.model, messages: request.messages },
    }
  }

  async listModels() {
    return [{ id: 'test/causal-ensemble', name: 'Deterministic test model', contextLength: 32_000, supportedParameters: ['reasoning', 'structured_output'] }]
  }
}

export function installDeterministicTestProvider(app, { includeConversation = false } = {}) {
  const timestamp = new Date().toISOString()
  const testOnlySortOrder = '9999-12-31T23:59:59.999Z'
  app.providers.adapters.set('test', new DeterministicTestAdapter())
  app.db.raw.prepare(`
    INSERT INTO provider_connections(id, provider_id, label, base_url, default_model, secret_envelope, config_json, enabled, created_at, updated_at)
    VALUES (?, 'test', 'Deterministic test provider', 'test://local', 'test/causal-ensemble', NULL, '{}', 1, ?, ?)
    ON CONFLICT(id) DO UPDATE SET provider_id='test', label=excluded.label, base_url=excluded.base_url,
      default_model=excluded.default_model, secret_envelope=NULL, config_json='{}', enabled=1, updated_at=excluded.updated_at
  `).run(SAMPLE_IDS.connection, testOnlySortOrder, timestamp)
  seedDemo({ db: app.db, repository: app.repository, force: true, includeConversation })
  return SAMPLE_IDS.connection
}
import { SAMPLE_IDS, seedDemo } from '../src/domain/seed.js'
