import { deepClone } from '../util.js'

export function emptyProjection() {
  return {
    messages: [],
    memories: [],
    world: {},
    relationships: {},
    goals: {},
    commitments: {},
    scene: null,
    summary: '',
    turnCount: 0,
    lastEventId: null,
  }
}

function setPath(target, path, value) {
  const parts = Array.isArray(path) ? path : String(path).split('.').filter(Boolean)
  let cursor = target
  for (let index = 0; index < parts.length - 1; index += 1) {
    const part = parts[index]
    if (!cursor[part] || typeof cursor[part] !== 'object' || Array.isArray(cursor[part])) cursor[part] = {}
    cursor = cursor[part]
  }
  if (parts.length) cursor[parts.at(-1)] = deepClone(value)
}

export function reduceEvents(events, initialState = {}) {
  const state = emptyProjection()
  state.world = deepClone(initialState ?? {})
  for (const event of events) {
    state.lastEventId = event.id
    switch (event.type) {
      case 'user.message':
      case 'assistant.message':
        state.messages.push({
          event_id: event.id,
          event_uid: event.event_uid,
          role: event.type === 'user.message' ? 'user' : 'assistant',
          actor_id: event.actor_id,
          content: event.payload.content ?? '',
          metadata: event.payload.metadata ?? {},
          created_at: event.created_at,
        })
        break
      case 'memory.created':
        state.memories.push({ event_id: event.id, ...event.payload })
        break
      case 'memory.deleted':
        state.memories = state.memories.filter(memory => memory.id !== event.payload.id && memory.event_id !== event.payload.event_id)
        break
      case 'world.state_set':
        setPath(state.world, event.payload.path, event.payload.value)
        break
      case 'relationship.adjusted': {
        const key = `${event.payload.source_id ?? 'world'}:${event.payload.target_id ?? 'user'}`
        const current = state.relationships[key] ?? {}
        const dimension = event.payload.dimension ?? 'trust'
        current[dimension] = Math.max(-1, Math.min(1, Number(current[dimension] ?? 0) + Number(event.payload.delta ?? 0)))
        state.relationships[key] = current
        break
      }
      case 'goal.upserted':
        state.goals[event.payload.id] = { ...(state.goals[event.payload.id] ?? {}), ...event.payload }
        break
      case 'commitment.upserted':
        state.commitments[event.payload.id] = { ...(state.commitments[event.payload.id] ?? {}), ...event.payload }
        break
      case 'scene.changed':
        state.scene = event.payload
        break
      case 'summary.updated':
        state.summary = event.payload.summary ?? ''
        break
      case 'turn.completed':
        state.turnCount += 1
        break
      default:
        break
    }
  }
  return state
}
