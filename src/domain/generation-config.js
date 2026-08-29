import { assert, cleanText, id, json, nowIso, plainObject, stableStringify } from '../util.js'
import { assertThinkingIntensity } from '../runtime/thinking.js'
import { previewGenerationPresetImport } from './preset-import.js'

export const DEFAULT_GENERATION = Object.freeze({
  response_length: 'natural',
  initiative: 'balanced',
  pacing: 'natural',
  temperature: 0.8,
  top_p: 1,
  frequency_penalty: 0,
  presence_penalty: 0,
  top_k: 0,
  min_p: 0,
  repetition_penalty: 1,
  seed: null,
  stop_sequences: Object.freeze([]),
  provider_options: Object.freeze({}),
})

export const DEFAULT_PROMPT = Object.freeze({
  custom_instructions: '',
  history_messages: 32,
})

const OPTIONS = Object.freeze({
  response_length: ['short', 'natural', 'detailed'],
  initiative: ['reactive', 'balanced', 'proactive'],
  pacing: ['focused', 'natural', 'ensemble'],
})

function option(value, fallback, choices, label) {
  const selected = value === undefined ? fallback : String(value)
  assert(choices.includes(selected), `${label} is invalid`)
  return selected
}

function number(value, fallback, { min, max, integer = false, label }) {
  const selected = value === undefined || value === null || value === '' ? fallback : Number(value)
  assert(Number.isFinite(selected), `${label} must be a number`)
  assert(selected >= min && selected <= max, `${label} must be between ${min} and ${max}`)
  assert(!integer || Number.isInteger(selected), `${label} must be a whole number`)
  return selected
}

function nullableInteger(value, fallback, { min, max, label }) {
  const selected = value === undefined ? fallback : value
  if (selected === null || selected === '' || Number(selected) === -1) return null
  return number(selected, fallback, { min, max, integer: true, label })
}

function stopSequences(value, fallback = []) {
  const selected = value === undefined
    ? fallback
    : Array.isArray(value) ? value : typeof value === 'string' ? value.split(/\r?\n/) : []
  const output = []
  const seen = new Set()
  for (const item of selected) {
    const text = cleanText(String(item ?? ''), 200)
    if (!text || seen.has(text)) continue
    seen.add(text)
    output.push(text)
    assert(output.length <= 16, 'stop_sequences cannot contain more than 16 entries')
  }
  return output
}

const RESERVED_PROVIDER_OPTIONS = new Set([
  'model', 'messages', 'contents', 'systeminstruction', 'stream', 'n', 'maxtokens', 'maxoutputtokens',
  'responseformat', 'thinking', 'reasoning', 'reasoningeffort', 'temperature', 'topp', 'topk',
  'minp', 'frequencypenalty', 'presencepenalty', 'repetitionpenalty', 'seed', 'stop', 'stopsequences',
  'tools', 'toolchoice',
])

function providerOptionKey(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9]/g, '')
}

function providerOptionConflicts(value, path = '', output = []) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => providerOptionConflicts(item, `${path}[${index}]`, output))
    return output
  }
  if (!plainObject(value)) return output
  for (const [key, nested] of Object.entries(value)) {
    const nextPath = path ? `${path}.${key}` : key
    if (RESERVED_PROVIDER_OPTIONS.has(providerOptionKey(key))) output.push(nextPath)
    else providerOptionConflicts(nested, nextPath, output)
  }
  return output
}

export function normalizeProviderOptions(value, fallback = {}) {
  const selected = value === undefined ? fallback : value
  assert(plainObject(selected), 'provider_options must be a JSON object')
  const blocked = providerOptionConflicts(selected)
  assert(blocked.length === 0, `provider_options cannot override protected field(s): ${blocked.join(', ')}`)
  const serialized = stableStringify(selected)
  assert(serialized.length <= 20_000, 'provider_options must be 20,000 characters or fewer')
  return JSON.parse(serialized)
}

export function normalizeGeneration(input = {}, base = DEFAULT_GENERATION) {
  input = input && typeof input === 'object' && !Array.isArray(input) ? input : {}
  base = { ...DEFAULT_GENERATION, ...(base ?? {}) }
  return {
    response_length: option(input.response_length, base.response_length, OPTIONS.response_length, 'response_length'),
    initiative: option(input.initiative, base.initiative, OPTIONS.initiative, 'initiative'),
    pacing: option(input.pacing, base.pacing, OPTIONS.pacing, 'pacing'),
    temperature: number(input.temperature, base.temperature, { min: 0, max: 2, label: 'temperature' }),
    top_p: number(input.top_p, base.top_p, { min: 0.01, max: 1, label: 'top_p' }),
    frequency_penalty: number(input.frequency_penalty, base.frequency_penalty, { min: -2, max: 2, label: 'frequency_penalty' }),
    presence_penalty: number(input.presence_penalty, base.presence_penalty, { min: -2, max: 2, label: 'presence_penalty' }),
    top_k: number(input.top_k, base.top_k, { min: 0, max: 500, integer: true, label: 'top_k' }),
    min_p: number(input.min_p, base.min_p, { min: 0, max: 1, label: 'min_p' }),
    repetition_penalty: number(input.repetition_penalty, base.repetition_penalty, { min: 0.01, max: 2, label: 'repetition_penalty' }),
    seed: nullableInteger(input.seed, base.seed, { min: 0, max: 2_147_483_647, label: 'seed' }),
    stop_sequences: stopSequences(input.stop_sequences, base.stop_sequences),
    provider_options: normalizeProviderOptions(input.provider_options, base.provider_options),
  }
}

export function normalizePrompt(input = {}, base = DEFAULT_PROMPT) {
  input = input && typeof input === 'object' && !Array.isArray(input) ? input : {}
  base = { ...DEFAULT_PROMPT, ...(base ?? {}) }
  return {
    custom_instructions: cleanText(input.custom_instructions === undefined ? base.custom_instructions : input.custom_instructions, 20_000),
    history_messages: number(input.history_messages, base.history_messages, { min: 0, max: 200, integer: true, label: 'history_messages' }),
  }
}

export function normalizePresetSettings(input = {}, base = {}) {
  const fallbackIntensity = base.thinking_intensity ?? 'auto'
  return {
    thinking_intensity: assertThinkingIntensity(String(input.thinking_intensity ?? fallbackIntensity).toLowerCase()),
    generation: normalizeGeneration(input.generation ?? {}, base.generation),
    prompt: normalizePrompt(input.prompt ?? {}, base.prompt),
  }
}

const BUILTIN_PRESETS = Object.freeze([
  {
    id: 'preset_balanced',
    name: 'Balanced',
    description: 'Natural pacing and dependable roleplay for everyday conversations.',
    settings: normalizePresetSettings({}),
  },
  {
    id: 'preset_cinematic',
    name: 'Cinematic',
    description: 'Richer description, more initiative and room for ensemble scenes.',
    settings: normalizePresetSettings({
      thinking_intensity: 'high',
      generation: { response_length: 'detailed', initiative: 'proactive', pacing: 'ensemble', temperature: 1, top_p: 0.95 },
      prompt: { history_messages: 48, custom_instructions: 'Use vivid sensory detail, distinct character voices, and purposeful scene movement. Keep the player in control of their own actions and feelings.' },
    }),
  },
  {
    id: 'preset_focused',
    name: 'Focused',
    description: 'Concise replies with lower variation and less unsolicited scene movement.',
    settings: normalizePresetSettings({
      thinking_intensity: 'low',
      generation: { response_length: 'short', initiative: 'reactive', pacing: 'focused', temperature: 0.45, top_p: 0.9 },
      prompt: { history_messages: 24, custom_instructions: 'Prefer concise, direct replies. Advance only the part of the scene addressed by the player.' },
    }),
  },
])

function fromRow(row) {
  if (!row) return null
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    builtin: Boolean(row.builtin),
    settings: normalizePresetSettings(json(row.settings_json, {})),
    created_at: row.created_at,
    updated_at: row.updated_at,
  }
}

export class GenerationPresetRegistry {
  constructor({ db }) {
    this.db = db
    this.#seedBuiltins()
  }

  #seedBuiltins() {
    const timestamp = nowIso()
    const statement = this.db.raw.prepare(`
      INSERT INTO generation_presets(id, name, description, settings_json, builtin, created_at, updated_at)
      VALUES (?, ?, ?, ?, 1, ?, ?)
      ON CONFLICT(id) DO UPDATE SET name=excluded.name, description=excluded.description,
        settings_json=excluded.settings_json, builtin=1, updated_at=excluded.updated_at
    `)
    this.db.transaction(() => {
      for (const preset of BUILTIN_PRESETS) {
        statement.run(preset.id, preset.name, preset.description, stableStringify(preset.settings), timestamp, timestamp)
      }
    })
  }

  list() {
    return this.db.raw.prepare('SELECT * FROM generation_presets ORDER BY builtin DESC, name COLLATE NOCASE').all().map(fromRow)
  }

  get(presetId) {
    const preset = fromRow(this.db.raw.prepare('SELECT * FROM generation_presets WHERE id = ?').get(presetId))
    assert(preset, 'Generation preset not found', 404, 'not_found')
    return preset
  }

  create(input) {
    const presetId = id('preset')
    const name = cleanText(input.name, 120)
    assert(name, 'Preset name is required')
    const timestamp = nowIso()
    const settings = normalizePresetSettings(input.settings ?? input)
    this.db.raw.prepare(`
      INSERT INTO generation_presets(id, name, description, settings_json, builtin, created_at, updated_at)
      VALUES (?, ?, ?, ?, 0, ?, ?)
    `).run(presetId, name, cleanText(input.description, 1000), stableStringify(settings), timestamp, timestamp)
    this.db.audit('generation_preset.created', 'generation_preset', presetId)
    return this.get(presetId)
  }

  previewImport(input) {
    return previewGenerationPresetImport(input)
  }

  importPreset(input) {
    const preview = this.previewImport(input)
    const preset = this.create({
      name: input.name || preview.name,
      description: input.description ?? preview.description,
      settings: preview.settings,
    })
    return { preset, preview }
  }

  update(presetId, input) {
    const current = this.get(presetId)
    assert(!current.builtin, 'Built-in presets cannot be changed', 409, 'builtin_preset')
    const name = cleanText(input.name ?? current.name, 120)
    assert(name, 'Preset name is required')
    const settings = input.settings === undefined ? current.settings : normalizePresetSettings(input.settings, current.settings)
    this.db.raw.prepare('UPDATE generation_presets SET name=?, description=?, settings_json=?, updated_at=? WHERE id=?')
      .run(name, cleanText(input.description ?? current.description, 1000), stableStringify(settings), nowIso(), current.id)
    this.db.audit('generation_preset.updated', 'generation_preset', current.id)
    return this.get(current.id)
  }

  remove(presetId) {
    const current = this.get(presetId)
    assert(!current.builtin, 'Built-in presets cannot be removed', 409, 'builtin_preset')
    this.db.raw.prepare('DELETE FROM generation_presets WHERE id = ?').run(current.id)
    this.db.audit('generation_preset.deleted', 'generation_preset', current.id)
  }
}
