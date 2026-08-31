import { deepClone } from '../util.js'

export function emptyProjection() {
  return {
    messages: [],
    memories: [],
    world: {},
    relationships: {},
    goals: {},
    commitments: {},
    agendas: {},
    clocks: {},
    commands: [],
    actions: [],
    receipts: [],
    observations: [],
    characterStates: {},
    scene: null,
    summary: '',
    turnCount: 0,
    stateRevision: 0,
    lastEventId: null,
    lastEventUid: null,
  }
}

function pathParts(path) {
  return Array.isArray(path) ? path : String(path ?? '').split('.').filter(Boolean)
}

export function getProjectionPath(target, path) {
  let cursor = target
  for (const part of pathParts(path)) {
    if (cursor === null || cursor === undefined || typeof cursor !== 'object') return undefined
    cursor = cursor[part]
  }
  return cursor
}

function parentAtPath(target, path, { create = true } = {}) {
  const parts = pathParts(path)
  if (!parts.length) return { parent: null, key: null }
  let cursor = target
  for (const part of parts.slice(0, -1)) {
    if (!cursor[part] || typeof cursor[part] !== 'object' || Array.isArray(cursor[part])) {
      if (!create) return { parent: null, key: null }
      cursor[part] = {}
    }
    cursor = cursor[part]
  }
  return { parent: cursor, key: parts.at(-1) }
}

function setPath(target, path, value) {
  const { parent, key } = parentAtPath(target, path)
  if (parent && key !== null) parent[key] = deepClone(value)
}

function deletePath(target, path) {
  const { parent, key } = parentAtPath(target, path, { create: false })
  if (parent && key !== null) delete parent[key]
}

function applyRelationship(state, effect) {
  const key = `${effect.source_id ?? 'world'}:${effect.target_id ?? 'user'}`
  const current = state.relationships[key] ?? {}
  const dimension = effect.dimension ?? 'trust'
  current[dimension] = Math.max(-1, Math.min(1, Number(current[dimension] ?? 0) + Number(effect.delta ?? 0)))
  state.relationships[key] = current
}

export function applyEffect(state, effect) {
  switch (effect?.op) {
    case 'set':
      setPath(state, effect.path, effect.value)
      break
    case 'delete':
      deletePath(state, effect.path)
      break
    case 'increment': {
      const current = Number(getProjectionPath(state, effect.path) ?? 0)
      setPath(state, effect.path, current + Number(effect.value ?? 0))
      break
    }
    case 'append': {
      const current = getProjectionPath(state, effect.path)
      const next = Array.isArray(current) ? [...current] : []
      if (!next.some(value => JSON.stringify(value) === JSON.stringify(effect.value))) next.push(deepClone(effect.value))
      setPath(state, effect.path, next)
      break
    }
    case 'remove': {
      const current = getProjectionPath(state, effect.path)
      if (Array.isArray(current)) {
        setPath(state, effect.path, current.filter(value => JSON.stringify(value) !== JSON.stringify(effect.value)))
      } else deletePath(state, effect.path)
      break
    }
    case 'merge': {
      const current = getProjectionPath(state, effect.path)
      const next = current && typeof current === 'object' && !Array.isArray(current) ? current : {}
      setPath(state, effect.path, { ...next, ...deepClone(effect.value ?? {}) })
      break
    }
    case 'relationship.adjust':
      applyRelationship(state, effect)
      break
    case 'memory.create':
      state.memories.push({ ...deepClone(effect.memory), action_id: effect.action_id ?? null })
      break
    case 'goal.upsert':
      state.goals[effect.goal.id] = { ...(state.goals[effect.goal.id] ?? {}), ...deepClone(effect.goal) }
      break
    case 'commitment.upsert':
      state.commitments[effect.commitment.id] = { ...(state.commitments[effect.commitment.id] ?? {}), ...deepClone(effect.commitment) }
      break
    case 'scene.change':
      state.scene = deepClone(effect.scene)
      break
    case 'clock.tick': {
      const clockId = String(effect.clock_id ?? 'world')
      const clock = state.clocks[clockId] ?? { id: clockId, value: 0 }
      clock.value = Number(clock.value ?? 0) + Number(effect.delta ?? 1)
      if (effect.label) clock.label = effect.label
      state.clocks[clockId] = clock
      break
    }
    default:
      break
  }
}

function updateAction(state, actionId, values) {
  const action = state.actions.find(item => item.id === actionId)
  if (action) Object.assign(action, deepClone(values))
}

function boundedRuntimeList(current, additions, maximum, identity) {
  const output = Array.isArray(current) ? current.map(deepClone) : []
  for (const value of Array.isArray(additions) ? additions : []) {
    const key = identity(value)
    const index = output.findIndex(item => identity(item) === key)
    if (index >= 0) output[index] = deepClone(value)
    else output.push(deepClone(value))
  }
  return output.slice(-maximum)
}

function applyCharacterDeliberation(state, event) {
  const payload = event.payload ?? {}
  const characterId = String(payload.character_id ?? event.actor_id ?? '')
  if (!characterId) return
  const current = state.characterStates[characterId] ?? {
    character_id: characterId,
    presence: 'present',
    initiative: 'balanced',
    perceived_event_ids: [],
    beliefs: [],
    emotional_state: {},
    relationship_stances: {},
    disclosures: [],
  }
  current.perceived_event_ids = boundedRuntimeList(
    current.perceived_event_ids,
    payload.perceived_event_ids,
    160,
    value => String(value),
  )
  current.beliefs = boundedRuntimeList(
    current.beliefs,
    payload.belief_updates,
    64,
    value => String(value?.id ?? `${value?.subject ?? ''}:${value?.claim ?? ''}`).toLocaleLowerCase(),
  )
  current.emotional_state = { ...(current.emotional_state ?? {}), ...deepClone(payload.emotional_state ?? {}) }
  const stances = { ...(current.relationship_stances ?? {}) }
  for (const shift of payload.relationship_shifts ?? []) {
    const targetId = String(shift.target_id ?? '')
    const dimension = String(shift.dimension ?? 'trust')
    if (!targetId || !dimension) continue
    const target = { ...(stances[targetId] ?? {}) }
    target[dimension] = Math.max(-1, Math.min(1, Number(target[dimension] ?? 0) + Number(shift.delta ?? 0)))
    stances[targetId] = target
  }
  current.relationship_stances = stances
  current.disclosures = boundedRuntimeList(current.disclosures, payload.disclosures, 80, value => String(value))
  current.current_intent = payload.intent ?? current.current_intent ?? ''
  current.last_participation = payload.participation ?? current.last_participation ?? 'observe'
  current.last_public_cue = payload.public_cue ?? ''
  current.last_turn_uid = payload.turn_uid ?? null
  current.last_active_at = event.created_at
  state.characterStates[characterId] = current
}

export function visibleObservations(projection, actorId = 'user', { includeDirector = false } = {}) {
  return projection.observations.filter(observation => {
    const audience = Array.isArray(observation.audience) ? observation.audience : [observation.audience ?? 'public']
    return audience.includes('all')
      || audience.includes('public')
      || audience.includes(actorId)
      || (actorId !== 'user' && audience.includes('actor') && observation.actor_id === actorId)
      || (includeDirector && audience.includes('director'))
  })
}

function deleteWorldPath(target, path) {
  const parts = String(path ?? '').split('.').filter(Boolean)
  if (!parts.length) return
  let cursor = target
  for (const part of parts.slice(0, -1)) {
    if (!cursor || typeof cursor !== 'object') return
    cursor = cursor[part]
  }
  if (cursor && typeof cursor === 'object') delete cursor[parts.at(-1)]
}

export function visibleWorld(story, world, actorId = 'user') {
  const output = deepClone(world ?? {})
  const effectiveActor = actorId === 'narrator' ? 'user' : actorId
  for (const rule of story?.runtime?.state_visibility ?? []) {
    const audience = Array.isArray(rule.audience) ? rule.audience : []
    if (audience.includes('public') || audience.includes(effectiveActor)) continue
    deleteWorldPath(output, rule.path)
  }
  return output
}

export function reduceEvents(events, initialState = {}) {
  const state = emptyProjection()
  state.world = deepClone(initialState ?? {})
  if (state.world?.scene) state.scene = deepClone(state.world.scene)
  if (state.world?.clock && typeof state.world.clock === 'object') {
    state.clocks.world = { id: 'world', ...deepClone(state.world.clock) }
  }
  for (const event of events) {
    state.lastEventId = event.id
    state.lastEventUid = event.event_uid
    switch (event.type) {
      case 'user.message':
      case 'assistant.message':
      case 'message.rendered':
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
      case 'command.received':
        state.commands.push({ event_id: event.id, event_uid: event.event_uid, ...deepClone(event.payload) })
        break
      case 'action.proposed':
        state.actions.push({ event_id: event.id, status: 'proposed', ...deepClone(event.payload) })
        break
      case 'action.resolved': {
        const receipt = { event_id: event.id, status: 'resolved', ...deepClone(event.payload) }
        state.receipts.push(receipt)
        updateAction(state, event.payload.action_id, { status: 'resolved', receipt_event_id: event.id, outcome: event.payload.outcome })
        for (const effect of event.payload.effects ?? []) applyEffect(state, effect)
        if ((event.payload.effects ?? []).length) state.stateRevision += 1
        break
      }
      case 'action.rejected': {
        const receipt = { event_id: event.id, status: 'rejected', ...deepClone(event.payload) }
        state.receipts.push(receipt)
        updateAction(state, event.payload.action_id, { status: 'rejected', receipt_event_id: event.id, reason: event.payload.reason })
        break
      }
      case 'observation.created':
        state.observations.push({ event_id: event.id, ...deepClone(event.payload) })
        break
      case 'character.runtime.initialized': {
        const characterId = String(event.payload.character_id ?? event.actor_id ?? '')
        if (characterId && !state.characterStates[characterId]) {
          state.characterStates[characterId] = deepClone(event.payload)
        }
        break
      }
      case 'character.deliberated':
        applyCharacterDeliberation(state, event)
        break
      case 'agenda.created':
        state.agendas[event.payload.id] = { status: 'active', evaluation_count: 0, ...deepClone(event.payload) }
        break
      case 'agenda.evaluated': {
        const current = state.agendas[event.payload.agenda_id]
        if (current) {
          current.evaluation_count = Number(current.evaluation_count ?? 0) + 1
          current.last_decision = event.payload.decision
          current.last_reason = event.payload.reason
          current.last_evaluated_at = event.created_at
        }
        break
      }
      case 'agenda.updated':
        state.agendas[event.payload.id] = { ...(state.agendas[event.payload.id] ?? {}), ...deepClone(event.payload) }
        break
      case 'memory.created':
        state.memories.push({ event_id: event.id, ...event.payload })
        break
      case 'memory.deleted':
        state.memories = state.memories.filter(memory => memory.id !== event.payload.id && memory.event_id !== event.payload.event_id)
        break
      case 'world.state_set':
        setPath(state.world, event.payload.path, event.payload.value)
        state.stateRevision += 1
        break
      case 'relationship.adjusted':
        applyRelationship(state, event.payload)
        state.stateRevision += 1
        break
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
