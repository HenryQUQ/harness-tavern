import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizePresetSettings } from '../src/domain/generation-config.js'
import { previewGenerationPresetImport } from '../src/domain/preset-import.js'
import { jsonRequest, testApp } from './helpers.js'

const SILLYTAVERN_CHAT_PRESET = {
  chat_completion_source: 'openai',
  openai_model: 'gpt-4-turbo',
  temperature: 1.1,
  frequency_penalty: 0.2,
  presence_penalty: 0.15,
  top_p: 0.93,
  top_k: 40,
  min_p: 0.04,
  repetition_penalty: 1.06,
  seed: 42,
  stop: ['<END>'],
  reasoning_effort: 'max',
  openai_max_tokens: 300,
  openai_max_context: 8192,
  custom_include_body: JSON.stringify({
    logit_bias: { 123: -1 },
    metadata: { imported_by: 'test' },
    generationConfig: { maxOutputTokens: 42 },
  }),
  prompts: [
    { identifier: 'main', name: 'Main Prompt', role: 'system', content: 'Write for {{char}} opposite {{user}}.' },
    { identifier: 'disabled', name: 'Disabled Prompt', role: 'system', content: 'Do not import me.' },
    { identifier: 'chatHistory', name: 'Chat History', marker: true },
  ],
  prompt_order: [{ character_id: 100001, order: [{ identifier: 'main', enabled: true }, { identifier: 'disabled', enabled: false }] }],
  stream_openai: true,
}

await test('expanded generation presets normalize portable and provider-specific controls', () => {
  const settings = normalizePresetSettings({
    thinking_intensity: 'high',
    generation: {
      temperature: 0.7,
      top_p: 0.9,
      frequency_penalty: 0.25,
      presence_penalty: -0.1,
      top_k: 50,
      min_p: 0.05,
      repetition_penalty: 1.07,
      seed: 7,
      stop_sequences: ['END', 'END', 'STOP'],
      provider_options: { logit_bias: { 42: -2 }, metadata: { purpose: 'roleplay' } },
    },
  })
  assert.equal(settings.thinking_intensity, 'high')
  assert.equal(settings.generation.top_k, 50)
  assert.equal(settings.generation.min_p, 0.05)
  assert.equal(settings.generation.seed, 7)
  assert.deepEqual(settings.generation.stop_sequences, ['END', 'STOP'])
  assert.equal(settings.generation.provider_options.metadata.purpose, 'roleplay')
  assert.throws(
    () => normalizePresetSettings({ generation: { provider_options: { generationConfig: { maxOutputTokens: 50 } } } }),
    /protected field.*generationConfig\.maxOutputTokens/i,
  )
})

await test('SillyTavern Chat Completion presets preview sampler, reasoning and prompt mappings without token caps', () => {
  const preview = previewGenerationPresetImport({ content: SILLYTAVERN_CHAT_PRESET, source_name: 'Official Default.json' })
  assert.equal(preview.format, 'sillytavern-chat-completion')
  assert.equal(preview.name, 'Official Default')
  assert.equal(preview.settings.thinking_intensity, 'max')
  assert.equal(preview.settings.generation.temperature, 1.1)
  assert.equal(preview.settings.generation.frequency_penalty, 0.2)
  assert.equal(preview.settings.generation.top_k, 40)
  assert.equal(preview.settings.generation.min_p, 0.04)
  assert.equal(preview.settings.generation.repetition_penalty, 1.06)
  assert.equal(preview.settings.generation.seed, 42)
  assert.deepEqual(preview.settings.generation.stop_sequences, ['<END>'])
  assert.deepEqual(preview.settings.generation.provider_options.logit_bias, { 123: -1 })
  assert.equal(preview.settings.generation.provider_options.generationConfig.maxOutputTokens, undefined)
  assert.match(preview.settings.prompt.custom_instructions, /active character or cast opposite the player/i)
  assert.doesNotMatch(preview.settings.prompt.custom_instructions, /Do not import me/)
  assert.ok(preview.warnings.some(message => /token limits were intentionally not imported/i.test(message)))
  assert.ok(preview.warnings.some(message => /API connection and model selections/i.test(message)))
  assert.ok(preview.warnings.some(message => /generationConfig\.maxOutputTokens/.test(message)))
  assert.ok(preview.ignored_fields.includes('stream_openai'))
})

await test('SillyTavern Text Completion aliases and extended samplers remain portable', () => {
  const preview = previewGenerationPresetImport({
    source_name: 'Local roleplay.settings',
    content: {
      temp: 0.72,
      top_p: 0.91,
      top_k: 80,
      min_p: 0.06,
      rep_pen: 1.05,
      top_a: 0.2,
      typical: 0.92,
      stopping_strings: ['User:', '</s>'],
      reasoning_effort: 'low',
      truncation_length: 32768,
      system_prompt: 'Keep {{user}} in control.',
    },
  })
  assert.equal(preview.format, 'sillytavern-text-completion')
  assert.equal(preview.settings.thinking_intensity, 'low')
  assert.equal(preview.settings.generation.temperature, 0.72)
  assert.equal(preview.settings.generation.repetition_penalty, 1.05)
  assert.equal(preview.settings.generation.provider_options.top_a, 0.2)
  assert.equal(preview.settings.generation.provider_options.typical_p, 0.92)
  assert.deepEqual(preview.settings.generation.stop_sequences, ['User:', '</s>'])
  assert.match(preview.settings.prompt.custom_instructions, /the player in control/i)
  assert.ok(preview.warnings.some(message => /message count/i.test(message)))
})

await test('generation preset import API previews and persists a reusable mapped preset', async t => {
  const { baseUrl } = await testApp(t)
  const preview = await jsonRequest(baseUrl, '/api/generation-presets/import/preview', {
    method: 'POST', body: JSON.stringify({ content: JSON.stringify(SILLYTAVERN_CHAT_PRESET), source_name: 'Cinematic ST.json' }),
  })
  assert.equal(preview.response.status, 200)
  assert.equal(preview.body.settings.thinking_intensity, 'max')
  const imported = await jsonRequest(baseUrl, '/api/generation-presets/import', {
    method: 'POST', body: JSON.stringify({ content: SILLYTAVERN_CHAT_PRESET, source_name: 'Cinematic ST.json', name: 'Imported cinematic' }),
  })
  assert.equal(imported.response.status, 201)
  assert.equal(imported.body.preset.name, 'Imported cinematic')
  assert.equal(imported.body.preset.builtin, false)
  assert.equal(imported.body.preset.settings.generation.top_k, 40)
  const listed = await jsonRequest(baseUrl, '/api/generation-presets')
  assert.ok(listed.body.some(preset => preset.id === imported.body.preset.id))
})
