import { plainObject } from '../util.js'

const PROTECTED_BODY_FIELDS = new Set([
  'model', 'messages', 'contents', 'systeminstruction', 'stream', 'n', 'maxtokens', 'maxoutputtokens',
  'responseformat', 'thinking', 'reasoning', 'reasoningeffort', 'temperature', 'topp', 'topk', 'minp',
  'frequencypenalty', 'presencepenalty', 'repetitionpenalty', 'seed', 'stop', 'stopsequences', 'tools',
  'toolchoice',
])

function generation(request) {
  return plainObject(request?.generation) ? request.generation : {}
}

export function safeBodyOverlay(value) {
  if (!plainObject(value)) return {}
  const clean = input => {
    if (Array.isArray(input)) return input.map(clean)
    if (!plainObject(input)) return input
    const output = {}
    for (const [key, nested] of Object.entries(input)) {
      const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, '')
      if (!PROTECTED_BODY_FIELDS.has(normalized)) output[key] = clean(nested)
    }
    return output
  }
  return clean(value)
}

export function presetBodyOverlay(request) {
  return safeBodyOverlay(generation(request).provider_options)
}

export function openAiGenerationParameters(request, { deepSeek = false, extended = true } = {}) {
  const options = generation(request)
  const output = {}
  if (Array.isArray(options.stop_sequences) && options.stop_sequences.length) output.stop = [...options.stop_sequences]
  if (deepSeek) return output
  if (options.frequency_penalty) output.frequency_penalty = options.frequency_penalty
  if (options.presence_penalty) output.presence_penalty = options.presence_penalty
  if (Number.isInteger(options.seed)) output.seed = options.seed
  if (extended && options.top_k) output.top_k = options.top_k
  if (extended && options.min_p) output.min_p = options.min_p
  if (extended && options.repetition_penalty && options.repetition_penalty !== 1) output.repetition_penalty = options.repetition_penalty
  return output
}

export function anthropicGenerationParameters(request) {
  const options = generation(request)
  return {
    ...options.top_k ? { top_k: options.top_k } : {},
    ...Array.isArray(options.stop_sequences) && options.stop_sequences.length ? { stop_sequences: [...options.stop_sequences] } : {},
  }
}

export function geminiGenerationParameters(request) {
  const options = generation(request)
  return {
    ...options.top_k ? { topK: options.top_k } : {},
    ...Number.isInteger(options.seed) ? { seed: options.seed } : {},
    ...Array.isArray(options.stop_sequences) && options.stop_sequences.length ? { stopSequences: [...options.stop_sequences] } : {},
  }
}
