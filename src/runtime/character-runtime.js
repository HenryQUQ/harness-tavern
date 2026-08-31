import { cleanText, deepClone, plainObject, uniqueStrings } from '../util.js'

const INITIATIVES = new Set(['reactive', 'balanced', 'proactive'])
const PRESENCES = new Set(['present', 'nearby', 'off_scene'])

function boundedNumber(value, fallback = 0, min = -1, max = 1) {
  const number = Number(value)
  return Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : fallback
}

export function normalizeCharacterRuntimeConfig(member = {}) {
  const authored = plainObject(member.metadata?.actor_runtime) ? member.metadata.actor_runtime : {}
  const character = member.character ?? {}
  const initiative = INITIATIVES.has(authored.initiative) ? authored.initiative : 'balanced'
  const initialPresence = PRESENCES.has(authored.initial_presence) ? authored.initial_presence : 'present'
  return {
    initiative,
    initial_presence: initialPresence,
    drives: uniqueStrings(authored.drives?.length ? authored.drives : character.goals, 24, 1000),
    fears: uniqueStrings(authored.fears, 24, 1000),
    values: uniqueStrings(authored.values, 24, 1000),
    mannerisms: uniqueStrings(authored.mannerisms, 24, 1000),
    reveal_policy: cleanText(authored.reveal_policy, 3000) || 'Reveal private information only when dramatically justified and safe for this character to disclose.',
  }
}

export function initialCharacterRuntimeState(member = {}) {
  const config = normalizeCharacterRuntimeConfig(member)
  return {
    character_id: String(member.character_id ?? member.character?.id ?? ''),
    presence: config.initial_presence,
    initiative: config.initiative,
    perceived_event_ids: [],
    beliefs: [],
    emotional_state: { tone: 'composed', tension: 0, warmth: 0, resolve: 0.5 },
    relationship_stances: {},
    current_intent: '',
    disclosures: [],
    last_participation: 'not_yet_active',
    last_public_cue: '',
    last_turn_uid: null,
    last_active_at: null,
  }
}

function disclosureValue(value) {
  if (typeof value === 'string') return cleanText(value, 5000)
  if (!plainObject(value)) return ''
  return cleanText(value.content ?? value.description ?? value.text ?? value.secret, 5000)
}

export function characterDisclosureCatalog(member = {}) {
  const catalog = []
  const privateContext = cleanText(member.private_context, 5000)
  if (privateContext) catalog.push({ id: 'private-context', content: privateContext, source: 'cast.private_context' })
  for (const [index, secret] of (member.character?.secrets ?? []).entries()) {
    const content = disclosureValue(secret)
    if (!content) continue
    const authoredId = plainObject(secret) ? cleanText(secret.id ?? secret.key, 120) : ''
    catalog.push({ id: authoredId || `secret-${index + 1}`, content, source: 'character.secrets' })
  }
  return catalog
}

export function characterPublicRuntime(member, state = null) {
  const current = state ?? initialCharacterRuntimeState(member)
  return {
    character_id: member.character_id,
    name: member.character?.name ?? member.character_id,
    avatar_url: member.character?.avatar_url ?? '',
    role: member.role ?? '',
    spotlight: Boolean(member.spotlight),
    muted: Boolean(member.muted),
    presence: current.presence ?? normalizeCharacterRuntimeConfig(member).initial_presence,
    initiative: current.initiative ?? normalizeCharacterRuntimeConfig(member).initiative,
    last_participation: current.last_participation ?? 'not_yet_active',
    last_public_cue: cleanText(current.last_public_cue, 1000),
    last_active_at: current.last_active_at ?? null,
  }
}

function disclosedFacts(member, plan) {
  const requested = new Set(plan?.speech_act?.disclose ?? [])
  return characterDisclosureCatalog(member)
    .filter(item => requested.has(item.id))
    .map(item => ({ id: item.id, content: item.content }))
}

export function characterPerformanceBrief(member, plan, receipts = []) {
  const ownReceipts = receipts
    .filter(receipt => receipt.actor_id === member.character_id)
    .map(({ effects: _effects, reason: _reason, ...receipt }) => receipt)
  return {
    character_id: member.character_id,
    name: member.character?.name ?? member.character_id,
    role: member.role ?? '',
    public_context: cleanText(member.public_context, 3000),
    appearance: cleanText(member.character?.appearance, 3000),
    speech_style: cleanText(member.character?.speech_style, 3000),
    participation: plan.participation,
    private_motivation_for_storyteller_only: cleanText(plan.intent, 2000),
    emotional_expression: deepClone(plan.emotional_state),
    public_cue: cleanText(plan.public_cue, 1000),
    speech_act: plan.speech_act ? {
      kind: plan.speech_act.kind,
      meaning: plan.speech_act.meaning,
      authorized_disclosures: disclosedFacts(member, plan),
    } : null,
    verified_action_receipts: ownReceipts,
  }
}

export function privateFragmentsNotDisclosed(member, plan) {
  const disclosed = new Set(plan?.speech_act?.disclose ?? [])
  return characterDisclosureCatalog(member)
    .filter(item => !disclosed.has(item.id) && item.content.length >= 12)
    .map(item => item.content)
}

export function normalizeEmotionalState(value, previous = {}) {
  const source = plainObject(value) ? value : {}
  return {
    tone: cleanText(source.tone, 160) || cleanText(previous.tone, 160) || 'composed',
    tension: boundedNumber(source.tension, boundedNumber(previous.tension, 0), 0, 1),
    warmth: boundedNumber(source.warmth, boundedNumber(previous.warmth, 0), -1, 1),
    resolve: boundedNumber(source.resolve, boundedNumber(previous.resolve, 0.5), 0, 1),
  }
}
