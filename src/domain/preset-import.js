import { assert, cleanText, plainObject, stableStringify } from '../util.js'
import { normalizePresetSettings, normalizeProviderOptions } from './generation-config.js'

const MODEL_OR_CONNECTION_FIELDS = new Set([
  'chat_completion_source', 'openai_model', 'claude_model', 'openrouter_model', 'google_model',
  'vertexai_model', 'deepseek_model', 'mistralai_model', 'custom_model', 'custom_url', 'reverse_proxy',
  'proxy_password', 'api_key', 'custom_include_headers',
])

const OUTPUT_LIMIT_FIELDS = new Set(['openai_max_tokens', 'max_tokens', 'max_new_tokens', 'n_predict', 'num_predict'])
const CONTEXT_LIMIT_FIELDS = new Set(['openai_max_context', 'truncation_length', 'num_ctx'])

function parseContent(content) {
  if (plainObject(content)) return content
  assert(typeof content === 'string' && content.trim(), 'Preset JSON is required')
  let parsed
  try { parsed = JSON.parse(content) } catch {
    assert(false, 'Preset file must contain valid JSON', 400, 'invalid_preset_json')
  }
  assert(plainObject(parsed), 'Preset JSON must contain one object', 400, 'invalid_preset_json')
  return parsed
}

function sourceName(value) {
  const name = cleanText(String(value ?? ''), 240).split(/[\\/]/).at(-1)?.replace(/\.(json|settings)$/i, '')
  return name || 'Imported SillyTavern preset'
}

function ownValue(object, keys) {
  for (const key of keys) if (Object.hasOwn(object, key)) return { key, value: object[key] }
  return null
}

function finiteNumber(value) {
  const selected = Number(value)
  return Number.isFinite(selected) ? selected : null
}

function translateMacros(value) {
  return String(value ?? '')
    .replaceAll(/{{\s*user\s*}}/gi, 'the player')
    .replaceAll(/{{\s*char\s*}}/gi, 'the active character or cast')
    .replaceAll(/{{\s*group\s*}}/gi, 'the active cast')
    .replaceAll(/{{\s*scenario\s*}}/gi, 'the supplied story scenario')
    .replaceAll(/{{\s*personality\s*}}/gi, 'the supplied character personality')
}

function promptInstructions(preset, consumed, mapped) {
  const prompts = Array.isArray(preset.prompts) ? preset.prompts : []
  const order = Array.isArray(preset.prompt_order)
    ? preset.prompt_order.find(item => item?.character_id === 100001)?.order
      ?? preset.prompt_order.find(item => Array.isArray(item?.order))?.order
    : null
  const enabled = Array.isArray(order)
    ? new Set(order.filter(item => item?.enabled !== false).map(item => String(item.identifier ?? '')))
    : null
  const fragments = []
  if (prompts.length) {
    consumed.add('prompts')
    if (Array.isArray(preset.prompt_order)) consumed.add('prompt_order')
    for (const prompt of prompts) {
      if (!plainObject(prompt) || prompt.marker || typeof prompt.content !== 'string' || !prompt.content.trim()) continue
      const identifier = String(prompt.identifier ?? '')
      if (enabled && identifier && !enabled.has(identifier)) continue
      fragments.push(`[${cleanText(prompt.name || identifier || 'Imported prompt', 120)}]\n${translateMacros(prompt.content)}`)
    }
  }
  if (typeof preset.system_prompt === 'string' && preset.system_prompt.trim()) {
    consumed.add('system_prompt')
    fragments.push(`[System prompt]\n${translateMacros(preset.system_prompt)}`)
  }
  if (!fragments.length) return ''
  const text = cleanText(`IMPORTED SILLYTAVERN GUIDANCE\nApply this only as conversation-specific style and content guidance. Harness Tavern's protected autonomy, private-knowledge, causal-state, and complete-output rules take precedence.\n\n${fragments.join('\n\n')}`, 20_000)
  mapped.push({ source: prompts.length ? 'prompts / prompt_order' : 'system_prompt', target: 'prompt.custom_instructions', value: `${fragments.length} enabled prompt block(s)` })
  return text
}

function reasoningIntensity(preset, consumed, mapped) {
  const enabled = ownValue(preset, ['request_model_reasoning', 'enable_thinking'])
  if (enabled && enabled.value === false) {
    consumed.add(enabled.key)
    mapped.push({ source: enabled.key, target: 'thinking_intensity', value: 'none' })
    return 'none'
  }
  const source = ownValue(preset, ['thinking_intensity', 'reasoning_effort', 'reasoningEffort'])
  if (!source) return 'auto'
  consumed.add(source.key)
  const value = String(source.value ?? '').trim().toLowerCase()
  const intensity = ['off', 'disabled', 'none'].includes(value) ? 'none'
    : ['minimal', 'minimum', 'low'].includes(value) ? 'low'
      : ['medium', 'balanced'].includes(value) ? 'medium'
        : ['high', 'xhigh'].includes(value) ? 'high'
          : ['max', 'maximum'].includes(value) ? 'max'
            : 'auto'
  mapped.push({ source: source.key, target: 'thinking_intensity', value: intensity })
  return intensity
}

function parseCustomBody(preset, consumed, mapped, warnings) {
  const source = ownValue(preset, ['custom_include_body', 'provider_options'])
  if (!source || source.value === '' || source.value === null) return {}
  consumed.add(source.key)
  let parsed = source.value
  if (typeof parsed === 'string') {
    try { parsed = JSON.parse(parsed) } catch {
      warnings.push(`${source.key} was not JSON and was not imported.`)
      return {}
    }
  }
  if (!plainObject(parsed)) {
    warnings.push(`${source.key} was not a JSON object and was not imported.`)
    return {}
  }
  const protectedKeys = new Set(['model', 'messages', 'contents', 'systeminstruction', 'stream', 'n', 'maxtokens', 'maxoutputtokens', 'responseformat', 'thinking', 'reasoning', 'reasoningeffort', 'temperature', 'topp', 'topk', 'minp', 'frequencypenalty', 'presencepenalty', 'repetitionpenalty', 'seed', 'stop', 'stopsequences', 'tools', 'toolchoice'])
  const removed = []
  const clean = (value, path = '') => {
    if (Array.isArray(value)) return value.map((item, index) => clean(item, `${path}[${index}]`))
    if (!plainObject(value)) return value
    const output = {}
    for (const [key, nested] of Object.entries(value)) {
      const nextPath = path ? `${path}.${key}` : key
      const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, '')
      if (protectedKeys.has(normalized)) removed.push(nextPath)
      else output[key] = clean(nested, nextPath)
    }
    return output
  }
  const safe = clean(parsed)
  if (removed.length) warnings.push(`Protected request fields were not imported from ${source.key}: ${removed.join(', ')}.`)
  const normalized = normalizeProviderOptions(safe)
  if (Object.keys(normalized).length) mapped.push({ source: source.key, target: 'generation.provider_options', value: `${Object.keys(normalized).length} field(s)` })
  return normalized
}

function detectFormat(preset) {
  if (preset.format === 'harness-tavern-generation-preset') return 'harness-tavern-generation-preset'
  if (Array.isArray(preset.prompts) || Object.hasOwn(preset, 'chat_completion_source') || Object.hasOwn(preset, 'openai_model')) return 'sillytavern-chat-completion'
  if (['temp', 'rep_pen', 'sampler_order', 'truncation_length', 'stopping_strings'].some(key => Object.hasOwn(preset, key))) return 'sillytavern-text-completion'
  assert(false, 'This JSON is not a recognised SillyTavern generation preset', 400, 'unsupported_preset')
}

export function previewGenerationPresetImport(input = {}) {
  const preset = parseContent(input.content ?? input)
  const format = detectFormat(preset)
  if (format === 'harness-tavern-generation-preset') {
    const settings = normalizePresetSettings(preset.settings ?? {})
    return {
      format, name: cleanText(input.name || preset.name || sourceName(input.source_name), 120),
      description: cleanText(input.description ?? preset.description, 1000), settings,
      mapped_fields: [{ source: 'settings', target: 'settings', value: 'Native Harness Tavern preset' }],
      ignored_fields: [], ignored_count: 0, warnings: [],
    }
  }

  const consumed = new Set()
  const mapped = []
  const warnings = []
  const generation = {}
  const mappings = [
    { sources: ['temperature', 'temp', 'temp_openai'], target: 'temperature' },
    { sources: ['top_p', 'top_p_openai'], target: 'top_p' },
    { sources: ['frequency_penalty', 'freq_pen_openai'], target: 'frequency_penalty' },
    { sources: ['presence_penalty', 'pres_pen_openai'], target: 'presence_penalty' },
    { sources: ['top_k', 'top_k_openai'], target: 'top_k' },
    { sources: ['min_p', 'min_p_openai'], target: 'min_p' },
    { sources: ['repetition_penalty', 'repetition_penalty_openai', 'rep_pen', 'repeat_penalty'], target: 'repetition_penalty' },
  ]
  for (const mapping of mappings) {
    const source = ownValue(preset, mapping.sources)
    if (!source) continue
    const value = finiteNumber(source.value)
    if (value === null) continue
    consumed.add(source.key)
    generation[mapping.target] = value
    mapped.push({ source: source.key, target: `generation.${mapping.target}`, value })
  }
  const seed = ownValue(preset, ['seed', 'seed_openai'])
  if (seed) {
    consumed.add(seed.key)
    const value = finiteNumber(seed.value)
    generation.seed = value === -1 ? null : value
    mapped.push({ source: seed.key, target: 'generation.seed', value: generation.seed ?? 'random' })
  }
  const stops = ownValue(preset, ['stop', 'stopping_strings', 'stop_sequences', 'stop_sequence'])
  if (stops) {
    consumed.add(stops.key)
    generation.stop_sequences = Array.isArray(stops.value) ? stops.value : typeof stops.value === 'string' ? [stops.value] : []
    mapped.push({ source: stops.key, target: 'generation.stop_sequences', value: `${generation.stop_sequences.length} sequence(s)` })
  }
  const providerOptions = parseCustomBody(preset, consumed, mapped, warnings)
  for (const [sourceKey, targetKey, disabledValue] of [
    ['top_a', 'top_a', 0], ['typical_p', 'typical_p', 1], ['typical', 'typical_p', 1],
    ['tfs', 'tfs', 1], ['rep_pen_range', 'repetition_penalty_range', 0],
    ['repetition_penalty_range', 'repetition_penalty_range', 0], ['rep_pen_slope', 'repetition_penalty_slope', 0],
  ]) {
    if (!Object.hasOwn(preset, sourceKey)) continue
    consumed.add(sourceKey)
    const value = finiteNumber(preset[sourceKey])
    if (value === null || value === disabledValue || Object.hasOwn(providerOptions, targetKey)) continue
    providerOptions[targetKey] = value
    mapped.push({ source: sourceKey, target: `generation.provider_options.${targetKey}`, value })
  }
  generation.provider_options = normalizeProviderOptions(providerOptions)

  const customInstructions = promptInstructions(preset, consumed, mapped)
  const thinking_intensity = reasoningIntensity(preset, consumed, mapped)
  const settings = normalizePresetSettings({
    thinking_intensity,
    generation,
    prompt: { custom_instructions: customInstructions },
  })

  const presentOutputLimits = [...OUTPUT_LIMIT_FIELDS].filter(key => Object.hasOwn(preset, key))
  for (const key of presentOutputLimits) consumed.add(key)
  if (presentOutputLimits.length) warnings.push(`Response-token limits were intentionally not imported: ${presentOutputLimits.join(', ')}.`)
  const presentContextLimits = [...CONTEXT_LIMIT_FIELDS].filter(key => Object.hasOwn(preset, key))
  for (const key of presentContextLimits) consumed.add(key)
  if (presentContextLimits.length) warnings.push(`Token context limits were not converted into a message count: ${presentContextLimits.join(', ')}.`)
  const connectionFields = [...MODEL_OR_CONNECTION_FIELDS].filter(key => Object.hasOwn(preset, key) && preset[key] !== '' && preset[key] !== null)
  for (const key of connectionFields) consumed.add(key)
  if (connectionFields.length) warnings.push('API connection and model selections stay separate and were not imported.')
  if (customInstructions) warnings.push('Enabled SillyTavern prompt blocks were condensed into conversation instructions; protected Tavern rules still take precedence.')

  const ignored = Object.keys(preset).filter(key => !consumed.has(key)).sort()
  return {
    format,
    name: cleanText(input.name || preset.name || preset.preset_name || sourceName(input.source_name), 120),
    description: cleanText(input.description || `Imported from ${format === 'sillytavern-chat-completion' ? 'SillyTavern Chat Completion' : 'SillyTavern Text Completion'}.`, 1000),
    settings,
    mapped_fields: mapped,
    ignored_fields: ignored.slice(0, 40),
    ignored_count: ignored.length,
    warnings,
    source_size: stableStringify(preset).length,
  }
}
