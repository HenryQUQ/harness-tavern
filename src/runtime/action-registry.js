import Ajv2020 from 'ajv/dist/2020.js'
import { getProjectionPath } from '../domain/projection.js'
import { assert, cleanText, deepClone, id, plainObject } from '../util.js'

const ajv = new Ajv2020({ allErrors: true, allowUnionTypes: true, strict: false })
const SAFE_PATH = /^(world|relationships|goals|commitments|scene|clocks)(?:\.[A-Za-z0-9_-]{1,100}){0,15}$/
const FORBIDDEN_PATH_PARTS = new Set(['__proto__', 'prototype', 'constructor'])
const EFFECT_OPERATIONS = new Set([
  'set', 'delete', 'increment', 'append', 'remove', 'merge', 'relationship.adjust',
  'memory.create', 'goal.upsert', 'commitment.upsert', 'scene.change', 'clock.tick',
])
const CONDITION_OPERATORS = new Set(['exists', 'absent', 'eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'contains', 'includes', 'truthy', 'falsy'])

export const BUILTIN_ACTIONS = Object.freeze([
  {
    key: 'speak',
    label: 'Speak',
    description: 'Say something without asserting a physical world-state change.',
    actor: 'any',
    parameters_schema: { type: 'object', properties: { content: { type: 'string' } }, additionalProperties: true },
    effects: [],
    observations: [{ audience: ['public'], template: '{{actor_name}} speaks.' }],
  },
  {
    key: 'observe',
    label: 'Observe',
    description: 'Inspect or attend to something. This reveals an observation but does not invent a state change.',
    actor: 'any',
    parameters_schema: { type: 'object', properties: { focus: { type: 'string' } }, additionalProperties: true },
    effects: [],
    observations: [{ audience: ['actor', 'user'], template: '{{actor_name}} examines {{params.focus}}.' }],
  },
  {
    key: 'wait',
    label: 'Wait',
    description: 'Let one beat pass.',
    actor: 'any',
    parameters_schema: { type: 'object', additionalProperties: true },
    effects: [{ op: 'clock.tick', clock_id: 'turn', delta: 1, label: 'Story beats' }],
    observations: [{ audience: ['public'], template: 'A story beat passes.' }],
  },
  {
    key: 'remember',
    label: 'Remember',
    description: 'Persist an explicitly stated fact as memory without changing the physical world.',
    actor: 'user',
    parameters_schema: {
      type: 'object',
      required: ['content'],
      properties: { content: { type: 'string', minLength: 1 }, visibility: { enum: ['public', 'private'] } },
      additionalProperties: false,
    },
    effects: [{
      op: 'memory.create',
      memory: { id: '$generated_id', scope: 'conversation', visibility: '$params.visibility', content: '$params.content', importance: 0.7 },
    }],
    observations: [{ audience: ['user'], template: 'The stated fact is now part of persistent memory.' }],
  },
  {
    key: 'attempt',
    label: 'Attempt',
    description: 'Represent an unregistered free-form attempt. It never changes authoritative state by itself.',
    actor: 'any',
    parameters_schema: {
      type: 'object',
      required: ['description'],
      properties: { description: { type: 'string', minLength: 1 } },
      additionalProperties: true,
    },
    effects: [],
    observations: [{ audience: ['public'], template: '{{actor_name}} attempts {{params.description}}; no success is inferred without a matching rule.' }],
  },
])

function sourceValue(context, path) {
  if (path === '$actor_id') return context.action.actor_id
  if (path === '$action_id') return context.action.id
  if (path === '$generated_id') return id('runtime')
  if (path.startsWith('$params.')) return getProjectionPath(context.action.parameters, path.slice('$params.'.length))
  if (path.startsWith('$state.')) return getProjectionPath(context.projection, path.slice('$state.'.length))
  return undefined
}

function interpolate(value, context) {
  if (typeof value !== 'string') return value
  if (value.startsWith('$')) {
    const resolved = sourceValue(context, value)
    if (resolved !== undefined) return deepClone(resolved)
  }
  return value.replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (_match, token) => {
    if (token === 'actor_id') return context.action.actor_id
    if (token === 'actor_name') return context.actorName
    if (token.startsWith('params.')) return String(getProjectionPath(context.action.parameters, token.slice(7)) ?? '')
    if (token.startsWith('state.')) return String(getProjectionPath(context.projection, token.slice(6)) ?? '')
    return ''
  })
}

function materialize(value, context) {
  if (Array.isArray(value)) return value.map(item => materialize(item, context))
  if (plainObject(value)) return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, materialize(child, context)]))
  return interpolate(value, context)
}

function safePath(value) {
  const path = String(value ?? '').trim()
  assert(SAFE_PATH.test(path), `Action effect path is not allowed: ${path}`, 400, 'invalid_action_definition')
  assert(path.split('.').every(part => !FORBIDDEN_PATH_PARTS.has(part)), 'Action effect path contains a forbidden segment', 400, 'invalid_action_definition')
  assert(!['world.user.thoughts', 'world.user.feelings', 'world.user.actions', 'world.persona.thoughts', 'world.persona.feelings', 'world.persona.actions'].some(prefix => path.startsWith(prefix)), 'Action rules cannot take ownership of the player', 400, 'invalid_action_definition')
  return path
}

function compare(actual, operator, expected) {
  switch (operator) {
    case 'exists': return actual !== undefined && actual !== null
    case 'absent': return actual === undefined || actual === null
    case 'eq': return JSON.stringify(actual) === JSON.stringify(expected)
    case 'neq': return JSON.stringify(actual) !== JSON.stringify(expected)
    case 'gt': return Number(actual) > Number(expected)
    case 'gte': return Number(actual) >= Number(expected)
    case 'lt': return Number(actual) < Number(expected)
    case 'lte': return Number(actual) <= Number(expected)
    case 'contains': return Array.isArray(actual) ? actual.some(item => JSON.stringify(item) === JSON.stringify(expected)) : String(actual ?? '').includes(String(expected ?? ''))
    case 'includes': return String(actual ?? '').includes(String(expected ?? ''))
    case 'truthy': return Boolean(actual)
    case 'falsy': return !actual
    default: return false
  }
}

function normalizeLifecycleConditions(value, label) {
  if (value === undefined) return []
  assert(Array.isArray(value), `${label} must be an array`, 400, 'invalid_agenda_definition')
  return value.map((condition, index) => {
    assert(plainObject(condition), `${label}[${index}] must be an object`, 400, 'invalid_agenda_definition')
    const operator = String(condition.operator ?? 'eq')
    assert(CONDITION_OPERATORS.has(operator), `${label}[${index}] has an unsupported operator`, 400, 'invalid_agenda_definition')
    return {
      path: safePath(condition.path),
      operator,
      ...Object.hasOwn(condition, 'value') ? { value: deepClone(condition.value) } : {},
    }
  })
}

function conditionsMet(conditions, projection) {
  return conditions.length > 0 && conditions.every(condition => compare(
    getProjectionPath(projection, condition.path),
    condition.operator,
    condition.value,
  ))
}

export function agendaLifecycleTransition(agenda, projection) {
  if (agenda.status === 'paused') {
    return conditionsMet(agenda.resume_when ?? [], projection)
      ? { status: 'active', rule: 'resume_when' }
      : null
  }
  if (agenda.status !== 'active') return null
  if (conditionsMet(agenda.fail_when ?? [], projection)) return { status: 'failed', rule: 'fail_when' }
  if (conditionsMet(agenda.complete_when ?? [], projection)) return { status: 'completed', rule: 'complete_when' }
  if (conditionsMet(agenda.pause_when ?? [], projection)) return { status: 'paused', rule: 'pause_when' }
  return null
}

function normalizeAudience(value, action, castIds) {
  const list = Array.isArray(value) ? value : [value ?? 'public']
  const allowed = new Set(['all', 'public', 'user', 'actor', 'director', ...castIds])
  return [...new Set(list.map(item => item === '$actor_id' ? action.actor_id : String(item)).filter(item => allowed.has(item)))]
}

function normalizeDefinition(raw) {
  assert(plainObject(raw), 'Action definition must be an object', 400, 'invalid_action_definition')
  const key = cleanText(raw.key ?? raw.id, 120)
  assert(/^[a-z][a-z0-9._-]{0,119}$/.test(key), `Action key is invalid: ${key}`, 400, 'invalid_action_definition')
  const effects = Array.isArray(raw.effects) ? raw.effects : []
  for (const effect of effects) {
    assert(EFFECT_OPERATIONS.has(effect?.op), `Unsupported effect operation in ${key}`, 400, 'invalid_action_definition')
    if (['set', 'delete', 'increment', 'append', 'remove', 'merge'].includes(effect.op)) safePath(String(effect.path ?? '').replace(/\{\{\s*(?:params\.)?[^{}]+\s*\}\}/g, 'value'))
  }
  return {
    key,
    label: cleanText(raw.label ?? key, 160) || key,
    description: cleanText(raw.description, 2000),
    actor: cleanText(raw.actor ?? 'any', 160) || 'any',
    parameters_schema: plainObject(raw.parameters_schema) ? raw.parameters_schema : { type: 'object', additionalProperties: true },
    preconditions: Array.isArray(raw.preconditions) ? raw.preconditions : [],
    effects,
    observations: Array.isArray(raw.observations) ? raw.observations : [],
    outcome: cleanText(raw.outcome ?? 'succeeded', 200) || 'succeeded',
    extensions: plainObject(raw.extensions) ? raw.extensions : {},
  }
}

export class ActionRegistry {
  constructor({ story = null, cast = [] } = {}) {
    this.cast = cast
    this.castIds = cast.map(member => member.character_id)
    this.castNames = new Map(cast.map(member => [member.character_id, member.character?.name ?? member.character_id]))
    this.definitions = new Map(BUILTIN_ACTIONS.map(item => [item.key, normalizeDefinition(item)]))
    for (const definition of story?.runtime?.actions ?? []) {
      const normalized = normalizeDefinition(definition)
      this.definitions.set(normalized.key, normalized)
    }
  }

  describe() {
    return [...this.definitions.values()].map(({ key, label, description, actor, parameters_schema }) => ({ key, label, description, actor, parameters_schema }))
  }

  normalizeProposal(raw, { source = 'user', agendaId = null } = {}) {
    assert(plainObject(raw), 'Action proposal must be an object', 502, 'invalid_model_output')
    let type = cleanText(raw.type ?? raw.action, 120)
    const originalType = type
    if (!this.definitions.has(type)) type = 'attempt'
    const parameters = plainObject(raw.parameters) ? deepClone(raw.parameters) : {}
    if (type === 'attempt' && !parameters.description) parameters.description = cleanText(raw.description ?? raw.reason ?? originalType, 2000) || 'an unspecified action'
    const actorId = String(raw.actor_id ?? (source === 'user' ? 'user' : ''))
    assert(actorId === 'user' || this.castIds.includes(actorId), `Action actor is not available: ${actorId}`, 502, 'invalid_model_output')
    return {
      id: id('action'),
      type,
      requested_type: originalType || type,
      actor_id: actorId,
      parameters,
      reason: cleanText(raw.reason, 1000),
      source,
      agenda_id: agendaId,
    }
  }

  resolve(action, projection) {
    const definition = this.definitions.get(action.type)
    if (!definition) return this.#rejected(action, 'No registered rule can resolve this action.')
    const actorAllowed = definition.actor === 'any'
      || definition.actor === action.actor_id
      || (definition.actor === 'user' && action.actor_id === 'user')
      || (definition.actor === 'character' && this.castIds.includes(action.actor_id))
    if (!actorAllowed) return this.#rejected(action, `${this.#actorName(action.actor_id)} is not allowed to perform ${definition.label}.`)

    let validate
    try { validate = ajv.compile(definition.parameters_schema) } catch (error) {
      return this.#rejected(action, `The action definition has an invalid parameter schema: ${error.message}`)
    }
    if (!validate(action.parameters)) {
      const details = (validate.errors ?? []).map(error => `${error.instancePath || '/'} ${error.message}`).join('; ')
      return this.#rejected(action, `The action parameters are invalid: ${details}`)
    }

    const context = { action, projection, actorName: this.#actorName(action.actor_id) }
    for (const condition of definition.preconditions) {
      const path = safePath(materialize(condition.path, context))
      const actual = getProjectionPath(projection, path)
      const expected = materialize(condition.value, context)
      if (!compare(actual, condition.operator ?? 'eq', expected)) {
        return this.#rejected(
          action,
          cleanText(materialize(condition.message, context), 1000) || `The precondition at ${path} is not satisfied.`,
          condition.audience,
        )
      }
    }

    const effects = definition.effects.map(raw => {
      const effect = materialize(raw, context)
      if (['set', 'delete', 'increment', 'append', 'remove', 'merge'].includes(effect.op)) effect.path = safePath(effect.path)
      if (effect.op === 'memory.create') {
        effect.memory.visibility = ['public', 'private', 'director'].includes(effect.memory.visibility) ? effect.memory.visibility : 'public'
        effect.memory.content = cleanText(effect.memory.content, 10_000)
        effect.action_id = action.id
      }
      return effect
    })
    const observations = definition.observations.map(raw => ({
      id: id('observation'),
      action_id: action.id,
      actor_id: action.actor_id,
      audience: normalizeAudience(raw.audience, action, this.castIds),
      content: cleanText(materialize(raw.template ?? raw.content, context), 5000),
      kind: cleanText(raw.kind ?? 'result', 80) || 'result',
    })).filter(item => item.content && item.audience.length)
    return {
      status: 'resolved',
      action,
      receipt: {
        status: 'resolved',
        action_id: action.id,
        action_type: action.type,
        actor_id: action.actor_id,
        outcome: definition.outcome,
        reason: cleanText(action.reason, 1000),
        effects,
        state_revision_before: projection.stateRevision,
        state_revision_after: projection.stateRevision + (effects.length ? 1 : 0),
      },
      observations,
    }
  }

  #rejected(action, reason, audience = null) {
    return {
      status: 'rejected',
      action,
      receipt: {
        status: 'rejected',
        action_id: action.id,
        action_type: action.type,
        actor_id: action.actor_id,
        outcome: 'rejected',
        reason: cleanText(reason, 1000),
        effects: [],
      },
      observations: [{
        id: id('observation'),
        action_id: action.id,
        actor_id: action.actor_id,
        audience: audience
          ? normalizeAudience(audience, action, this.castIds)
          : action.actor_id === 'user' ? ['user'] : ['public', action.actor_id],
        content: cleanText(reason, 5000),
        kind: 'rejection',
      }],
    }
  }

  #actorName(actorId) {
    return actorId === 'user' ? 'The player' : this.castNames.get(actorId) ?? actorId
  }
}

export function normalizeStoryAgendas(story, cast = []) {
  const castIds = new Set(cast.map(member => member.character_id))
  const bySlug = new Map(cast.map(member => [member.character?.slug, member.character_id]))
  const explicit = (story?.runtime?.agendas ?? []).map((agenda, index) => {
    const owner = agenda.owner_id ?? agenda.owner ?? ''
    const ownerId = owner === 'user' || castIds.has(owner) ? owner : bySlug.get(owner)
    assert(ownerId, `Agenda owner is not in the Story cast: ${owner}`, 400, 'invalid_agenda_definition')
    return {
      id: cleanText(agenda.id ?? agenda.key, 160) || `agenda-${index + 1}`,
      owner_id: ownerId,
      objective: cleanText(agenda.objective ?? agenda.description, 3000),
      priority: Math.max(0, Math.min(100, Number(agenda.priority ?? 50))),
      status: ['active', 'paused', 'completed', 'failed'].includes(agenda.status) ? agenda.status : 'active',
      triggers: Array.isArray(agenda.triggers) ? deepClone(agenda.triggers) : [],
      constraints: Array.isArray(agenda.constraints) ? deepClone(agenda.constraints) : [],
      next_action: plainObject(agenda.next_action) ? deepClone(agenda.next_action) : null,
      complete_when: normalizeLifecycleConditions(agenda.complete_when, `Agenda ${agenda.id ?? agenda.key ?? index + 1} complete_when`),
      fail_when: normalizeLifecycleConditions(agenda.fail_when, `Agenda ${agenda.id ?? agenda.key ?? index + 1} fail_when`),
      pause_when: normalizeLifecycleConditions(agenda.pause_when, `Agenda ${agenda.id ?? agenda.key ?? index + 1} pause_when`),
      resume_when: normalizeLifecycleConditions(agenda.resume_when, `Agenda ${agenda.id ?? agenda.key ?? index + 1} resume_when`),
      visibility: ['public', 'private', 'director'].includes(agenda.visibility) ? agenda.visibility : 'private',
      provenance: 'story',
    }
  })
  const usedIds = new Set()
  for (const agenda of explicit) {
    assert(!usedIds.has(agenda.id), `Agenda id is duplicated: ${agenda.id}`, 400, 'invalid_agenda_definition')
    usedIds.add(agenda.id)
  }
  const explicitOwnerIds = new Set(explicit.map(agenda => agenda.owner_id))
  for (const member of cast) {
    // A Story-authored Agenda is the contextual intent for that character.
    // Card goals remain available as fallback Agendas in ordinary character
    // chats, but duplicating both sets in a Story makes every control response
    // longer and can produce competing autonomous actions for one owner.
    if (explicitOwnerIds.has(member.character_id)) continue
    for (const [index, objective] of (member.character?.goals ?? []).entries()) {
      const baseId = `character-goal-${member.character_id}-${index + 1}`
      let agendaId = baseId
      let suffix = 2
      while (usedIds.has(agendaId)) agendaId = `${baseId}-${suffix++}`
      usedIds.add(agendaId)
      explicit.push({
        id: agendaId,
        owner_id: member.character_id,
        objective,
        priority: 40,
        status: 'active',
        triggers: [],
        constraints: [],
        next_action: null,
        complete_when: [],
        fail_when: [],
        pause_when: [],
        resume_when: [],
        visibility: 'private',
        provenance: 'character-card',
      })
    }
  }
  return explicit
}
