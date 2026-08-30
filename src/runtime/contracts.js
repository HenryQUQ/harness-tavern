import { assert, cleanText, plainObject } from '../util.js'

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
  allowedSpeakerIds = [],
  userMessage = '',
  maxActions = 12,
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
  const rawDecisions = Array.isArray(raw.agenda_decisions) ? raw.agenda_decisions : []
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

  const rawSpeakers = Array.isArray(raw.speakers)
    ? raw.speakers
    : Array.isArray(raw.speaker_plan) ? raw.speaker_plan : []
  const speakerLimit = maxSpeakers ?? Math.max(1, allowedSpeakerIds.length)
  const speakerIds = []
  for (const item of rawSpeakers) {
    const speakerId = String(plainObject(item) ? item.character_id ?? item.actor_id ?? '' : item)
    if (!allowedSpeakerIds.includes(speakerId) || speakerIds.includes(speakerId) || speakerIds.length >= speakerLimit) continue
    speakerIds.push(speakerId)
  }
  if (!speakerIds.length) speakerIds.push(allowedSpeakerIds[0] ?? 'assistant')

  return {
    actions,
    agenda_decisions: agendaDecisions,
    discarded_actions: discardedActions,
    speakers: speakerIds,
    internal_summary: cleanText(raw.internal_summary, 4000),
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
