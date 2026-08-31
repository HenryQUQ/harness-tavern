import { assert, cleanText, plainObject } from '../util.js'
import { characterDisclosureCatalog, normalizeCharacterRuntimeConfig, normalizeEmotionalState } from './character-runtime.js'

export function safeJsonObject(value) {
  if (plainObject(value)) return value
  if (typeof value !== 'string') return null
  const text = value.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  try {
    const parsed = JSON.parse(text)
    return plainObject(parsed) ? parsed : null
  } catch {
    return null
  }
}

function compatibilityActions(raw, userMessage) {
  if (Array.isArray(raw.actions)) return raw.actions
  if (Array.isArray(raw.user_actions)) return raw.user_actions
  if (!Array.isArray(raw.state_operations)) return []
  return raw.state_operations.map(operation => {
    if (operation?.type === 'memory.create') {
      return { type: 'remember', actor_id: 'user', parameters: { content: operation.content, visibility: operation.visibility } }
    }
    return {
      type: 'attempt',
      actor_id: 'user',
      parameters: { description: operation?.reason || `an action associated with ${operation?.type || 'an unrecognised operation'}` },
      reason: 'Legacy state operation was converted into a non-authoritative attempt.',
    }
  }).concat(raw.state_operations.length ? [] : [{ type: 'attempt', actor_id: 'user', parameters: { description: userMessage } }])
}

export function normalizeControlPlan(raw, {
  actionRegistry,
  activeAgendas = [],
  allowedParticipantIds = null,
  allowedSpeakerIds = [],
  userMessage = '',
  maxActions = 12,
  maxParticipants = null,
  maxSpeakers = null,
} = {}) {
  assert(plainObject(raw), 'The AI service did not return a control plan object', 502, 'invalid_model_output')
  let actionInputs = compatibilityActions(raw, userMessage)
  if (!actionInputs.length) actionInputs = [{ type: 'attempt', actor_id: 'user', parameters: { description: userMessage } }]
  assert(actionInputs.length <= maxActions, `The control plan proposed ${actionInputs.length} actions; the operational limit is ${maxActions}. Nothing was truncated.`, 502, 'control_plan_too_large')
  const actions = []
  const discardedActions = []
  for (const input of actionInputs) {
    const action = actionRegistry.normalizeProposal(input, { source: 'user' })
    if (action.actor_id !== 'user') {
      discardedActions.push({
        requested_type: action.requested_type,
        actor_id: action.actor_id,
        reason: 'character_action_requires_active_agenda',
      })
      continue
    }
    actions.push(action)
  }
  if (!actions.length) actions.push(actionRegistry.normalizeProposal({
    type: 'attempt', actor_id: 'user', parameters: { description: userMessage },
    reason: 'No authorised player Action remained after validating the control plan.',
  }, { source: 'user' }))

  const agendaById = new Map(activeAgendas.map(agenda => [agenda.id, agenda]))
  // Pre-v0.16 providers may still return Director-owned Agenda decisions. When
  // the caller supplies no Agendas, ignore that legacy field: isolated
  // Character runtimes now own those decisions.
  const rawDecisions = activeAgendas.length && Array.isArray(raw.agenda_decisions) ? raw.agenda_decisions : []
  assert(rawDecisions.length <= activeAgendas.length, 'The control plan returned more agenda decisions than active agendas', 502, 'invalid_model_output')
  const agendaDecisions = []
  const seenAgendas = new Set()
  for (const decision of rawDecisions) {
    const agendaId = String(decision?.agenda_id ?? '')
    if (!agendaById.has(agendaId) || seenAgendas.has(agendaId)) continue
    seenAgendas.add(agendaId)
    const requestedKind = ['act', 'defer', 'complete', 'fail', 'pause'].includes(decision.decision) ? decision.decision : 'defer'
    const kind = requestedKind === 'act' ? 'act' : 'defer'
    const normalized = {
      agenda_id: agendaId,
      decision: kind,
      requested_decision: requestedKind,
      reason: cleanText(decision.reason, 1000),
      action: null,
    }
    if (kind === 'act' && plainObject(decision.action)) {
      const action = actionRegistry.normalizeProposal(decision.action, { source: 'agenda', agendaId })
      if (action.actor_id === agendaById.get(agendaId).owner_id) normalized.action = action
      else {
        normalized.decision = 'defer'
        discardedActions.push({
          requested_type: action.requested_type,
          actor_id: action.actor_id,
          agenda_id: agendaId,
          reason: 'agenda_action_actor_must_match_owner',
        })
      }
    }
    agendaDecisions.push(normalized)
  }
  for (const agenda of activeAgendas) {
    if (!seenAgendas.has(agenda.id)) agendaDecisions.push({ agenda_id: agenda.id, decision: 'defer', requested_decision: 'defer', reason: 'No action was selected for this agenda in this beat.', action: null })
  }

  // `speakers` and `speaker_plan` remain accepted for persisted pre-v0.15
  // control loops, but the runtime now treats them as scene participants. A
  // participant is context for one Storyteller beat, never an instruction to
  // emit one message per Character.
  const rawParticipants = Array.isArray(raw.participants)
    ? raw.participants
    : Array.isArray(raw.speakers)
      ? raw.speakers
      : Array.isArray(raw.speaker_plan) ? raw.speaker_plan : []
  const participantCandidates = allowedParticipantIds ?? allowedSpeakerIds
  const participantLimit = maxParticipants ?? maxSpeakers ?? participantCandidates.length
  const participantIds = []
  for (const item of rawParticipants) {
    const participantId = String(plainObject(item) ? item.character_id ?? item.actor_id ?? '' : item)
    if (!participantCandidates.includes(participantId) || participantIds.includes(participantId) || participantIds.length >= participantLimit) continue
    participantIds.push(participantId)
  }

  return {
    actions,
    agenda_decisions: agendaDecisions,
    discarded_actions: discardedActions,
    participants: participantIds,
    internal_summary: cleanText(raw.internal_summary, 4000),
  }
}

const CHARACTER_PARTICIPATION = new Set(['act', 'speak', 'react', 'observe', 'remain_silent'])
const AGENDA_DECISIONS = new Set(['act', 'defer'])

function boundedDelta(value) {
  const number = Number(value)
  return Number.isFinite(number) ? Math.max(-0.2, Math.min(0.2, number)) : 0
}

export function normalizeCharacterPlan(raw, {
  actionRegistry,
  member,
  activeAgendas = [],
  allowedEventIds = [],
  allowedRelationshipTargets = [],
  previousState = {},
} = {}) {
  assert(plainObject(raw), 'The AI service did not return a Character plan object', 502, 'invalid_model_output')
  assert(member?.character_id, 'Character planner is missing its assigned Character', 500, 'character_runtime_invalid')
  const characterId = String(member.character_id)
  if (raw.character_id !== undefined) {
    assert(String(raw.character_id) === characterId, 'The Character planner returned a plan for a different Character', 502, 'character_identity_mismatch')
  }
  const config = normalizeCharacterRuntimeConfig(member)
  const knownEvents = new Set(allowedEventIds.map(String))
  const perceivedEventIds = []
  for (const candidate of Array.isArray(raw.perceived_event_ids) ? raw.perceived_event_ids : []) {
    const eventId = String(candidate)
    if (knownEvents.has(eventId) && !perceivedEventIds.includes(eventId)) perceivedEventIds.push(eventId)
    if (perceivedEventIds.length >= 80) break
  }

  const beliefUpdates = []
  for (const [index, belief] of (Array.isArray(raw.belief_updates) ? raw.belief_updates : []).entries()) {
    if (!plainObject(belief)) continue
    const subject = cleanText(belief.subject, 300)
    const claim = cleanText(belief.claim, 2000)
    if (!subject || !claim) continue
    const confidenceNumber = Number(belief.confidence)
    beliefUpdates.push({
      id: cleanText(belief.id, 160) || `belief:${subject.toLocaleLowerCase().replace(/\s+/g, '-').slice(0, 120) || index + 1}`,
      subject,
      claim,
      confidence: Number.isFinite(confidenceNumber) ? Math.max(0, Math.min(1, confidenceNumber)) : 0.5,
      source_event_ids: [...new Set((Array.isArray(belief.source_event_ids) ? belief.source_event_ids : []).map(String).filter(value => knownEvents.has(value)))].slice(0, 20),
    })
    if (beliefUpdates.length >= 16) break
  }

  const relationshipTargets = new Set(['user', characterId, ...allowedRelationshipTargets.map(String)])
  const relationshipShifts = []
  for (const shift of Array.isArray(raw.relationship_shifts) ? raw.relationship_shifts : []) {
    if (!plainObject(shift)) continue
    const targetId = String(shift.target_id ?? '')
    const dimension = cleanText(shift.dimension, 120) || 'trust'
    if (!relationshipTargets.has(targetId) || !/^[\p{L}\p{N}_.-]{1,120}$/u.test(dimension)) continue
    relationshipShifts.push({ target_id: targetId, dimension, delta: boundedDelta(shift.delta), reason: cleanText(shift.reason, 1000) })
    if (relationshipShifts.length >= 12) break
  }

  const agendaById = new Map(activeAgendas.filter(agenda => agenda.owner_id === characterId).map(agenda => [agenda.id, agenda]))
  const agendaDecisions = []
  const agendaActions = []
  const seenAgendas = new Set()
  for (const decision of Array.isArray(raw.agenda_decisions) ? raw.agenda_decisions : []) {
    const agendaId = String(decision?.agenda_id ?? '')
    if (!agendaById.has(agendaId) || seenAgendas.has(agendaId)) continue
    seenAgendas.add(agendaId)
    const kind = AGENDA_DECISIONS.has(decision.decision) ? decision.decision : 'defer'
    let action = null
    if (kind === 'act' && plainObject(decision.action)) {
      action = actionRegistry.normalizeProposal({ ...decision.action, actor_id: characterId }, { source: 'character_agenda', agendaId })
      agendaActions.push(action)
    }
    agendaDecisions.push({ agenda_id: agendaId, decision: action ? 'act' : 'defer', reason: cleanText(decision.reason, 1000), action })
  }
  for (const agenda of agendaById.values()) {
    if (!seenAgendas.has(agenda.id)) agendaDecisions.push({ agenda_id: agenda.id, decision: 'defer', reason: 'This Character did not choose an Agenda action in this beat.', action: null })
  }

  const disclosureIds = new Set(characterDisclosureCatalog(member).map(item => item.id))
  let speechAct = null
  if (plainObject(raw.speech_act)) {
    const meaning = cleanText(raw.speech_act.meaning ?? raw.speech_act.intent, 3000)
    if (meaning) speechAct = {
      kind: cleanText(raw.speech_act.kind, 120) || 'statement',
      meaning,
      disclose: [...new Set((Array.isArray(raw.speech_act.disclose) ? raw.speech_act.disclose : []).map(String).filter(value => disclosureIds.has(value)))].slice(0, 20),
    }
  }

  const spontaneousActions = []
  const rawSpontaneous = Array.isArray(raw.spontaneous_actions) ? raw.spontaneous_actions : []
  for (const proposal of rawSpontaneous.slice(0, config.initiative === 'proactive' ? 2 : 1)) {
    if (!plainObject(proposal)) continue
    const action = actionRegistry.normalizeProposal({ ...proposal, actor_id: characterId }, { source: 'character_runtime' })
    if (action.type === 'speak') continue
    spontaneousActions.push(action)
  }

  let participation = CHARACTER_PARTICIPATION.has(raw.participation) ? raw.participation : 'observe'
  if (speechAct) participation = 'speak'
  else if (participation === 'speak') participation = 'react'
  const speechAction = speechAct ? actionRegistry.normalizeProposal({
    type: 'speak', actor_id: characterId, parameters: { content: speechAct.meaning }, reason: 'The Character runtime chose a speech act for this beat.',
  }, { source: 'character_runtime' }) : null

  return {
    character_id: characterId,
    participation,
    perceived_event_ids: perceivedEventIds,
    belief_updates: beliefUpdates,
    emotional_state: normalizeEmotionalState(raw.emotional_state, previousState.emotional_state),
    relationship_shifts: relationshipShifts,
    intent: cleanText(raw.intent, 2000),
    agenda_decisions: agendaDecisions,
    spontaneous_actions: spontaneousActions,
    speech_act: speechAct,
    public_cue: cleanText(raw.public_cue, 1000),
    disclosures: speechAct?.disclose ?? [],
    actions: [...agendaActions, ...spontaneousActions, ...(speechAction ? [speechAction] : [])],
  }
}

function stripProtocolMarkers(value) {
  return String(value ?? '')
    .replace(/^\s*\[(?:speaker|character):[^\]]+\]\s*/i, '')
    .replace(/^\s*```(?:json|markdown|text)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim()
}

export function normalizeNarration(raw, speakerId) {
  const parsed = safeJsonObject(raw)
  let content = ''
  if (parsed) {
    if (typeof parsed.content === 'string') content = parsed.content
    else if (typeof parsed.message === 'string') content = parsed.message
    else if (Array.isArray(parsed.messages)) {
      const selected = parsed.messages.find(message => message?.character_id === speakerId) ?? parsed.messages[0]
      content = selected?.content ?? ''
    }
  } else content = raw
  // Narration is provider output, not a bounded metadata field. Preserve the
  // complete response and only remove protocol wrappers/NUL bytes; silently
  // slicing prose here would recreate an application-level output ceiling.
  content = stripProtocolMarkers(content).replaceAll('\u0000', '').trim()
  assert(content, 'The AI service returned no usable narration', 502, 'invalid_model_output')
  return { character_id: speakerId, content }
}

function sceneBlockContent(value) {
  return stripProtocolMarkers(value).replaceAll('\u0000', '').trim()
}

export function normalizeSceneOutput(raw, {
  participantIds = [],
  characterPlans = [],
  cast = [],
} = {}) {
  const parsed = safeJsonObject(raw)
  const rawBlocks = Array.isArray(parsed?.blocks)
    ? parsed.blocks
    : [{ type: 'narration', content: parsed?.content ?? parsed?.message ?? raw }]
  assert(rawBlocks.length > 0 && rawBlocks.length <= 80, 'The Storyteller returned an invalid number of Scene Blocks', 502, 'invalid_scene_output')
  const participantSet = new Set(participantIds.map(String))
  const plans = new Map(characterPlans.map(plan => [String(plan.character_id), plan]))
  const names = new Map(cast.map(member => [String(member.character_id), member.character?.name ?? member.character_id]))
  const blocks = []
  for (const [index, block] of rawBlocks.entries()) {
    assert(plainObject(block), `Scene Block ${index + 1} is not an object`, 502, 'invalid_scene_output')
    const type = String(block.type ?? '')
    assert(['narration', 'action', 'dialogue'].includes(type), `Scene Block ${index + 1} has an unsupported type`, 502, 'invalid_scene_output')
    const content = sceneBlockContent(block.content)
    assert(content, `Scene Block ${index + 1} is empty`, 502, 'invalid_scene_output')
    const normalized = { type, content }
    if (type !== 'narration') {
      const characterId = String(block.character_id ?? '')
      const plan = plans.get(characterId)
      assert(participantSet.has(characterId) && plan, `Scene Block ${index + 1} names a Character who did not participate`, 502, 'invalid_scene_output')
      if (type === 'dialogue') assert(plan.speech_act, `Scene Block ${index + 1} gives dialogue to a Character who chose not to speak`, 502, 'invalid_scene_output')
      if (type === 'action') assert(plan.participation !== 'remain_silent', `Scene Block ${index + 1} gives action to a silent Character`, 502, 'invalid_scene_output')
      normalized.character_id = characterId
    }
    blocks.push(normalized)
  }
  const content = blocks.map(block => {
    if (block.type === 'narration') return block.content
    const name = names.get(block.character_id) ?? block.character_id
    if (block.type === 'dialogue') return `${name}: “${block.content}”`
    return `*${name} ${block.content}*`
  }).join('\n\n')
  return { character_id: 'narrator', content, scene_blocks: blocks }
}

export function narrationPrivateLeak(content, fragments = []) {
  const source = String(content ?? '').toLocaleLowerCase()
  for (const fragment of fragments) {
    const exact = cleanText(fragment, 5000).toLocaleLowerCase()
    if (exact.length >= 12 && source.includes(exact)) return 'Narration exposed Character-private source text that was not authorized for disclosure.'
  }
  return null
}

const OPEN_SUCCESS_PATTERNS = [
  /\bajar\b/i,
  /\bswings?\s+(?:partly\s+|slightly\s+|fully\s+)?(?:open|inward|outward)\b/i,
  /\b(?:door|gate|hatch|route)\s+opens?\b/i,
  /\b(?:stands?|hangs?|is|remains?)\s+(?:partly\s+|slightly\s+|fully\s+)?open\b/i,
  /\breveal(?:s|ed|ing)\s+(?:a|the)\s+(?:dark\s+|narrow\s+)?(?:corridor|passage|room|space)\b/i,
  /(?:门|闸门|舱门|通道)[^。！？\n]{0,8}(?:打开|开启|敞开|半开)/u,
  /(?:呈|变成|保持|处于)?(?:半开|敞开)(?:状态)?/u,
  /(?:露出|显露|展现)[^。！？\n]{0,12}(?:走廊|通道|房间|空间)/u,
]

export function narrationContradiction(content, projection, receipts = []) {
  const source = String(content ?? '')
  const withoutNegatedOpen = source
    .replace(/\b(?:not|never|isn't|is\s+not|doesn't|does\s+not|won't|will\s+not|cannot|can't|fails?\s+to|refuses?\s+to)\b[^.!?\n]{0,32}\b(?:open|ajar)\b/giu, '')
    .replace(/(?:没有|并未|未能|不能|无法|不会|拒绝|仍未|尚未)[^。！？\n]{0,24}(?:打开|开启|敞开|半开)/gu, '')
  for (const receipt of receipts) {
    if (!['open', 'unlock'].includes(receipt.action_type)) continue
    const action = projection.actions.find(item => item.id === receipt.action_id)
    const target = action?.parameters?.target
    if (!target || projection.world?.doors?.[target]?.open !== false) continue
    if (OPEN_SUCCESS_PATTERNS.some(pattern => pattern.test(withoutNegatedOpen))) {
      return `Narration claimed that ${target} opened or became ajar while authoritative state says its open flag is false.`
    }
  }
  return null
}

const PLAYER_AGENCY_CONCEPTS = [
  {
    id: 'movement',
    label: 'movement or posture',
    narration: [
      /\byou(?:[\s,]+[a-z'-]+){0,3}[\s,]+(?:step|walk|enter|cross|move|follow|approach|leave|run|sit|stand|kneel|turn|climb|descend|advance|retreat)\b/iu,
      /\byour\s+(?:feet|body|legs)\b[^.!?\n]{0,24}\b(?:carry|move|step|turn|cross)\b/iu,
      /你[^。！？\n]{0,10}(?:走|踏|迈|进入|越过|穿过|跟随|靠近|离开|跑|坐下|站起|跪下|转身|攀爬|前进|后退)/u,
    ],
    input: [
      /\b(?:i|we)\b(?:[\s,]+[a-z'-]+){0,4}[\s,]+(?:step|walk|enter|cross|move|follow|approach|leave|run|sit|stand|kneel|turn|climb|descend|advance|retreat)\b/iu,
      /^\s*(?:please\s+)?(?:step|walk|enter|cross|move|follow|approach|leave|run|sit|stand|kneel|turn|climb|descend|advance|retreat)\b/iu,
      /(?:我|我们)[^。！？\n]{0,14}(?:走|踏|迈|进入|越过|穿过|跟随|靠近|离开|跑|坐下|站起|跪下|转身|攀爬|前进|后退)/u,
      /^\s*(?:请)?(?:走|踏|迈|进入|越过|穿过|跟随|靠近|离开|跑|坐下|站起|跪下|转身|攀爬|前进|后退)/u,
    ],
  },
  {
    id: 'manipulation',
    label: 'physical interaction',
    narration: [
      /\byou(?:[\s,]+[a-z'-]+){0,3}[\s,]+(?:take|pick|grab|touch|push|pull|open|close|unlock|lift|drop|place|hand|give|draw|hold|reach)\b/iu,
      /你[^。！？\n]{0,10}(?:拿|拾|捡|抓|触碰|触摸|推|拉|打开|关上|解锁|举起|放下|递给|交给|握住|伸手)/u,
    ],
    input: [
      /\b(?:i|we)\b(?:[\s,]+[a-z'-]+){0,4}[\s,]+(?:take|pick|grab|touch|push|pull|open|close|unlock|lift|drop|place|hand|give|draw|hold|reach)\b/iu,
      /^\s*(?:please\s+)?(?:take|pick|grab|touch|push|pull|open|close|unlock|lift|drop|place|hand|give|draw|hold|reach)\b/iu,
      /(?:我|我们)[^。！？\n]{0,14}(?:拿|拾|捡|抓|触碰|触摸|推|拉|打开|关上|解锁|举起|放下|递给|交给|握住|伸手)/u,
      /^\s*(?:请)?(?:拿|拾|捡|抓|触碰|触摸|推|拉|打开|关上|解锁|举起|放下|递给|交给|握住|伸手)/u,
    ],
  },
  {
    id: 'speech',
    label: 'speech',
    narration: [
      /\byou(?:[\s,]+[a-z'-]+){0,3}[\s,]+(?:say|ask|reply|answer|tell|whisper|shout|promise|agree|refuse)\b/iu,
      /你[^。！？\n]{0,10}(?:说|问|回答|答道|告诉|低语|喊|承诺|同意|拒绝)/u,
    ],
    input: [
      /\b(?:i|we)\b(?:[\s,]+[a-z'-]+){0,4}[\s,]+(?:say|ask|reply|answer|tell|whisper|shout|promise|agree|refuse)\b/iu,
      /(?:我|我们)[^。！？\n]{0,14}(?:说|问|回答|答道|告诉|低语|喊|承诺|同意|拒绝)/u,
      /["“][^"”\n]+["”]/u,
    ],
  },
  {
    id: 'inner-state',
    label: 'thought, feeling, memory, or choice',
    narration: [
      /\byou(?:[\s,]+[a-z'-]+){0,3}[\s,]+(?:think|decide|realize|remember|want|believe|hope|fear|choose|resolve|understand|recognize)\b/iu,
      /\byou\s+(?:are|feel|become)\s+(?:afraid|angry|relieved|happy|sad|ashamed|certain|determined|eager|unwilling)\b/iu,
      /(?:fear|relief|anger|certainty|resolve)\b[^.!?\n]{0,18}\b(?:grips|fills|washes over|settles over)\s+you\b/iu,
      /你[^。！？\n]{0,10}(?:想|觉得|决定|意识到|记起|想要|相信|希望|害怕|选择|明白|认出|感到)/u,
    ],
    input: [
      /\b(?:i|we)\b(?:[\s,]+[a-z'-]+){0,4}[\s,]+(?:think|decide|realize|remember|want|believe|hope|fear|choose|resolve|understand|recognize|feel)\b/iu,
      /(?:我|我们)[^。！？\n]{0,14}(?:想|觉得|决定|意识到|记起|想要|相信|希望|害怕|选择|明白|认出|感到)/u,
    ],
  },
]

function outsideDialogue(value) {
  return String(value ?? '')
    .replace(/["“][^"”\n]{0,1000}["”]/gu, '')
}

function hasAssertedMatch(source, patterns) {
  for (const pattern of patterns) {
    const flags = pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`
    for (const match of source.matchAll(new RegExp(pattern.source, flags))) {
      const nearby = source.slice(Math.max(0, match.index - 14), match.index + match[0].length)
      if (/\b(?:not|never|don't|doesn't|didn't|cannot|can't|won't|may|might|could|should|would)\b/iu.test(nearby)) continue
      if (/(?:不|没|未|别|不要|无法|不会)[^。！？\n]{0,12}$/u.test(nearby)) continue
      return match[0].trim()
    }
  }
  return ''
}

export function narrationAutonomyConflict(content, userMessage) {
  const narration = outsideDialogue(content)
  const playerInput = String(userMessage ?? '')
  for (const concept of PLAYER_AGENCY_CONCEPTS) {
    const asserted = hasAssertedMatch(narration, concept.narration)
    if (!asserted || hasAssertedMatch(playerInput, concept.input)) continue
    return `Narration assigned unrequested player ${concept.label} (${JSON.stringify(asserted)}), but the player's latest message did not authorize it.`
  }
  return null
}
