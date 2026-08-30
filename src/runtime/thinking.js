import { assert, clamp } from '../util.js'

export const THINKING_INTENSITIES = Object.freeze(['auto', 'none', 'low', 'medium', 'high', 'max'])

export function normalizeThinkingIntensity(value, fallback = 'auto') {
  const normalized = String(value ?? '').toLowerCase()
  return THINKING_INTENSITIES.includes(normalized) ? normalized : fallback
}

export function assertThinkingIntensity(value) {
  assert(THINKING_INTENSITIES.includes(value), `thinking_intensity must be one of ${THINKING_INTENSITIES.join(', ')}`)
  return value
}

export function resolveThinkingIntensity(configured, { userMessage = '', castSize = 1, hasStory = false, hasWorldState = false } = {}) {
  const normalized = normalizeThinkingIntensity(configured)
  if (normalized !== 'auto') return normalized
  let score = 0
  const text = String(userMessage ?? '')
  if (text.length > 500) score += 1
  if (castSize > 1) score += 1
  if (castSize >= 3) score += 1
  if (hasStory) score += 1
  if (hasWorldState) score += 1
  if (/\b(if|unless|because|plan|decide|investigate|remember|secret|promise|why|what if)\b|如果|除非|因为|计划|决定|调查|记得|秘密|承诺|为什么|假如/iu.test(text)) score += 1
  if (/\b(all|everyone|each|together)\b|所有|每个人|一起/iu.test(text)) score += 1
  return score >= 5 ? 'high' : score >= 2 ? 'medium' : 'low'
}

export function thinkingPlan(intensity, visibleTokens = null) {
  const level = normalizeThinkingIntensity(intensity) === 'auto' ? 'medium' : normalizeThinkingIntensity(intensity)
  const visible = visibleTokens === null || visibleTokens === undefined || visibleTokens === ''
    ? null
    : clamp(visibleTokens, 128, 32_000)
  // Some native reasoning APIs require a separate thinking budget even when
  // the user has not imposed an output ceiling. This reference sizes that
  // private budget; it is never sent as a visible-response limit.
  const budgetReference = visible ?? 4096
  const multiplier = { none: 0, low: 0.25, medium: 0.75, high: 1.5, max: 3 }[level]
  const reasoningTokens = level === 'none' ? 0 : Math.max(256, Math.round(budgetReference * multiplier))
  return {
    intensity: level,
    visibleTokens: visible,
    reasoningTokens,
    totalOutputTokens: visible === null ? null : visible + reasoningTokens,
    openRouterEffort: { none: null, low: 'low', medium: 'medium', high: 'high', max: 'high' }[level],
    openAiEffort: { none: null, low: 'low', medium: 'medium', high: 'high', max: 'high' }[level],
    deepSeekEffort: { none: null, low: 'low', medium: 'high', high: 'high', max: 'max' }[level],
    promptGuidance: {
      none: 'Respond naturally and directly. Do not expose hidden reasoning.',
      low: 'Pause briefly to preserve persona and continuity before responding. Do not expose hidden reasoning.',
      medium: 'Check persona, knowledge boundaries, continuity, and likely consequences before responding. Do not expose hidden reasoning.',
      high: 'Carefully resolve motivations, knowledge boundaries, causality, and continuity before responding. Do not expose hidden reasoning.',
      max: 'Use the strongest available internal reasoning budget. Resolve competing goals, hidden knowledge, causal consequences, and continuity before responding. Do not expose hidden reasoning.',
    }[level],
  }
}
