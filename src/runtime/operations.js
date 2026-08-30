import { assert, clamp, cleanText, id } from '../util.js'

const FORBIDDEN_PATH_PARTS = new Set(['__proto__', 'prototype', 'constructor'])
const RELATIONSHIP_DIMENSIONS = new Set(['trust', 'affection', 'fear', 'respect', 'tension'])

function safePath(path) {
  const normalized = String(path ?? '').trim()
  const parts = normalized.split('.').filter(Boolean)
  assert(parts.length > 0 && parts.length <= 12, 'world.set path is invalid')
  assert(parts.every(part => /^[A-Za-z0-9_-]{1,80}$/.test(part) && !FORBIDDEN_PATH_PARTS.has(part)), 'world.set path contains a forbidden segment')
  assert(!['user.thoughts', 'user.feelings', 'user.actions', 'persona.thoughts', 'persona.feelings', 'persona.actions'].some(prefix => normalized.startsWith(prefix)), 'The model cannot set user autonomy state')
  return parts.join('.')
}

export function normalizeEnvelope(raw, { castIds = [] } = {}) {
  const source = raw && typeof raw === 'object' ? raw : {}
  let messages = Array.isArray(source.messages) ? source.messages : []
  if (messages.length === 0 && typeof source.response === 'string') messages = [{ character_id: castIds[0] ?? 'assistant', content: source.response }]
  messages = messages.map(message => ({
    character_id: castIds.includes(message?.character_id) ? message.character_id : castIds[0] ?? 'assistant',
    content: typeof message?.content === 'string' ? message.content.replaceAll('\u0000', '').trim() : '',
  })).filter(message => message.content)
  assert(messages.length > 0, 'Model response did not contain a user-visible message', 502, 'invalid_model_output')
  return {
    messages,
    state_operations: Array.isArray(source.state_operations) ? source.state_operations : [],
    internal_summary: cleanText(source.internal_summary, 4000),
  }
}

export function validateOperations(operations, { castIds, hasStory }) {
  const allowedActors = new Set([...castIds, 'assistant'])
  const output = []
  for (const candidate of operations) {
    if (!candidate || typeof candidate !== 'object') continue
    const type = String(candidate.type ?? '')
    switch (type) {
      case 'memory.create': {
        const scope = ['conversation', 'character'].includes(candidate.scope) ? candidate.scope : 'conversation'
        const characterId = scope === 'character' ? String(candidate.character_id ?? '') : null
        if (characterId) assert(allowedActors.has(characterId), 'memory.create character_id is not in the cast')
        const content = cleanText(candidate.content, 3000)
        if (!content) continue
        output.push({ type, id: id('memory'), scope, character_id: characterId, visibility: ['public', 'private', 'director'].includes(candidate.visibility) ? candidate.visibility : (scope === 'character' ? 'private' : 'public'), content, importance: clamp(candidate.importance ?? 0.5, 0, 1) })
        break
      }
      case 'relationship.adjust': {
        const sourceId = String(candidate.source_id ?? '')
        const targetId = String(candidate.target_id ?? 'user')
        const dimension = String(candidate.dimension ?? 'trust')
        assert(allowedActors.has(sourceId), 'relationship.adjust source_id is not in the cast')
        assert(targetId === 'user' || allowedActors.has(targetId), 'relationship.adjust target_id is invalid')
        assert(RELATIONSHIP_DIMENSIONS.has(dimension), 'relationship dimension is invalid')
        output.push({ type, source_id: sourceId, target_id: targetId, dimension, delta: clamp(candidate.delta, -0.2, 0.2) })
        break
      }
      case 'world.set': {
        assert(hasStory, 'world.set requires a story conversation')
        output.push({ type, path: safePath(candidate.path), value: structuredClone(candidate.value), reason: cleanText(candidate.reason, 500) })
        break
      }
      case 'goal.upsert': {
        const ownerId = String(candidate.owner_id ?? '')
        assert(allowedActors.has(ownerId), 'goal owner_id is not in the cast')
        output.push({ type, id: cleanText(candidate.id, 160) || id('goal'), owner_id: ownerId, description: cleanText(candidate.description, 2000), status: ['active', 'completed', 'failed', 'paused'].includes(candidate.status) ? candidate.status : 'active' })
        break
      }
      case 'commitment.upsert': {
        const ownerId = String(candidate.owner_id ?? '')
        assert(allowedActors.has(ownerId), 'commitment owner_id is not in the cast')
        output.push({ type, id: cleanText(candidate.id, 160) || id('commitment'), owner_id: ownerId, description: cleanText(candidate.description, 2000), status: ['open', 'fulfilled', 'broken', 'cancelled'].includes(candidate.status) ? candidate.status : 'open' })
        break
      }
      case 'scene.change': {
        assert(hasStory, 'scene.change requires a story conversation')
        output.push({ type, id: cleanText(candidate.id, 160) || id('scene'), title: cleanText(candidate.title, 500), location: cleanText(candidate.location, 500), time: cleanText(candidate.time, 200) })
        break
      }
      case 'summary.update': {
        const summary = cleanText(candidate.summary, 6000)
        if (summary) output.push({ type, summary })
        break
      }
      default:
        break
    }
  }
  return output
}

export function operationEvent(operation) {
  switch (operation.type) {
    case 'memory.create': return { type: 'memory.created', actorId: operation.character_id, payload: operation }
    case 'relationship.adjust': return { type: 'relationship.adjusted', actorId: operation.source_id, payload: operation }
    case 'world.set': return { type: 'world.state_set', actorId: null, payload: operation }
    case 'goal.upsert': return { type: 'goal.upserted', actorId: operation.owner_id, payload: operation }
    case 'commitment.upsert': return { type: 'commitment.upserted', actorId: operation.owner_id, payload: operation }
    case 'scene.change': return { type: 'scene.changed', actorId: null, payload: operation }
    case 'summary.update': return { type: 'summary.updated', actorId: null, payload: operation }
    default: return null
  }
}
