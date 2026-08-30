import { deepClone } from '../util.js'
import { visibleObservations, visibleWorld } from './projection.js'

const PRIVATE_KEYS = /(^|[_-])(secret|private|director|internal|hidden|credential|token|password|thought|feeling)s?($|[_-])/i

function sanitize(value, depth = 0) {
  if (depth > 10) return '[nested]'
  if (Array.isArray(value)) return value.map(item => sanitize(item, depth + 1))
  if (!value || typeof value !== 'object') return value
  const output = {}
  for (const [key, child] of Object.entries(value)) {
    if (PRIVATE_KEYS.test(key)) continue
    output[key] = sanitize(child, depth + 1)
  }
  return output
}

function relationshipLabel(dimensions) {
  const entries = Object.entries(dimensions ?? {}).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
  const [dimension, score = 0] = entries[0] ?? ['trust', 0]
  if (dimension === 'trust') return score > 0.55 ? 'Deeply trusting' : score > 0.15 ? 'Cautiously trusting' : score < -0.4 ? 'Distrustful' : score < -0.1 ? 'Guarded' : 'Still getting to know you'
  if (dimension === 'affection') return score > 0.5 ? 'Strongly affectionate' : score > 0.1 ? 'Warmly disposed' : score < -0.2 ? 'Distant' : 'Neutral warmth'
  if (dimension === 'respect') return score > 0.4 ? 'Strongly respectful' : score > 0.1 ? 'Respectful, still evaluating' : score < -0.2 ? 'Dismissive' : 'Undecided'
  if (dimension === 'fear') return score > 0.4 ? 'Afraid and cautious' : score > 0.1 ? 'Uneasy' : 'Unafraid'
  if (dimension === 'tension') return score > 0.5 ? 'Highly tense' : score > 0.1 ? 'Tension beneath the surface' : 'At ease'
  return 'Relationship developing'
}

function openThreads(projection, story) {
  const fromState = projection.world?.story?.open_threads
  if (Array.isArray(fromState)) return fromState.filter(Boolean).slice(0, 12)
  const fromLore = (story?.lore ?? []).filter(item => item.visibility !== 'director' && item.open_thread).map(item => item.title || item.content)
  return fromLore.slice(0, 12)
}

function knownFacts(projection, story) {
  const memories = projection.memories
    .filter(memory => !['private', 'director'].includes(memory.visibility) && memory.scope !== 'character')
    .map(memory => ({ id: memory.id || memory.event_id, content: memory.content, importance: memory.importance ?? 0.5 }))
  const lore = (story?.lore ?? [])
    .filter(item => !item.visibility || item.visibility === 'public')
    .map(item => ({ id: item.id, content: item.content, title: item.title, source: 'story' }))
  const observations = visibleObservations(projection, 'user')
    .filter(item => item.kind !== 'rejection')
    .map(item => ({ id: item.id ?? item.event_id, content: item.content, source: 'observation', action_id: item.action_id }))
  return [...lore, ...memories, ...observations].filter(item => item.content).slice(-60)
}

export function buildPlayerJournal({ conversation, story, cast, projection, branches }) {
  const relationships = []
  for (const member of cast ?? []) {
    const values = projection.relationships?.[`${member.character_id}:user`] ?? {}
    relationships.push({
      character_id: member.character_id,
      name: member.character.name,
      avatar_url: member.character.avatar_url,
      label: relationshipLabel(values),
      dimensions: deepClone(values),
    })
  }
  const recap = projection.summary
    || projection.messages.slice(-6).map(message => `${message.actor_id === 'user' ? 'You' : cast?.find(item => item.character_id === message.actor_id)?.character.name || 'Narrator'}: ${message.content}`).join('\n')
  const observations = visibleObservations(projection, 'user')
  const visibleActionIds = new Set(observations.map(item => item.action_id).filter(Boolean))
  const world = sanitize(visibleWorld(story, projection.world, 'user'))
  return {
    current_scene: projection.scene ?? story?.initial_state?.scene ?? null,
    recap,
    open_threads: openThreads(projection, story),
    relationships,
    known_facts: knownFacts(projection, story),
    important_objects: world.inventory ?? world.objects ?? {},
    world,
    causal: {
      state_revision: projection.stateRevision,
      recent_actions: projection.receipts
        .filter(receipt => receipt.actor_id === 'user' || visibleActionIds.has(receipt.action_id))
        .slice(-20).map(receipt => ({
        action_id: receipt.action_id,
        action_type: receipt.action_type,
        actor_id: receipt.actor_id,
        status: receipt.status,
        outcome: receipt.outcome,
        ...receipt.actor_id === 'user' && receipt.status === 'rejected' ? { reason: receipt.reason } : {},
        changed_fact_count: receipt.effects?.length ?? 0,
      })),
      active_intents: Object.values(projection.agendas)
        .filter(agenda => agenda.status === 'active' && agenda.visibility === 'public')
        .map(agenda => ({ id: agenda.id, owner_id: agenda.owner_id, objective: agenda.objective, priority: agenda.priority, last_decision: agenda.last_decision ?? null })),
      observations: observations.slice(-30),
      clocks: deepClone(projection.clocks),
    },
    timelines: (branches ?? []).map(branch => ({
      id: branch.id,
      label: branch.label,
      current: branch.id === conversation.current_branch_id,
      parent_id: branch.parent_branch_id,
      created_at: branch.created_at,
    })),
  }
}
