import test from 'node:test'
import assert from 'node:assert/strict'
import { testApp, captureServer } from './helpers.js'
import { OpenAiCompatibleAdapter } from '../src/providers/openai-compatible.js'
import { OpenRouterAdapter } from '../src/providers/openrouter.js'
import { AnthropicAdapter } from '../src/providers/anthropic.js'
import { GeminiAdapter } from '../src/providers/gemini.js'
import { PROVIDER_PRESETS } from '../src/providers/catalog.js'

const request = {
  model: 'test/model',
  messages: [{ role: 'system', content: 'Stay in character.' }, { role: 'user', content: 'Hello' }],
  thinkingIntensity: 'high',
  maxOutputTokens: 800,
  temperature: 0.7,
  topP: 0.86,
  jsonMode: true,
  route: {},
}

await test('ships a broad provider preset catalog plus a custom seam', () => {
  assert.ok(PROVIDER_PRESETS.length >= 30)
  for (const id of ['openrouter', 'openai', 'anthropic', 'google-ai-studio', 'deepseek', 'xai', 'mistral', 'groq', 'together', 'fireworks', 'ollama', 'vllm', 'custom']) {
    assert.ok(PROVIDER_PRESETS.some(preset => preset.id === id), `missing ${id}`)
  }
})

await test('OpenRouter sends provider routing, attribution, reasoning and usage requests', async t => {
  const capture = await captureServer(t, (record, response) => {
    response.writeHead(200, { 'content-type': 'application/json', 'x-openrouter-provider': 'Anthropic' })
    response.end(JSON.stringify({
      id: 'gen-1', provider: 'Anthropic', choices: [{ message: { content: '{"messages":[{"character_id":"assistant","content":"Hi"}],"state_operations":[]}' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30, cost: 0.002 },
    }))
  })
  const adapter = new OpenRouterAdapter({ timeoutMs: 5000, appName: 'Harness Tavern Test', siteUrl: 'https://tavern.example' })
  const result = await adapter.complete({
    ...request,
    generation: { frequency_penalty: 0.2, presence_penalty: 0.1, top_k: 40, min_p: 0.05, repetition_penalty: 1.06, seed: 9, stop_sequences: ['<END>'], provider_options: { logit_bias: { 42: -1 } } },
    route: { order: ['Anthropic', 'OpenAI'], allow_fallbacks: false, require_parameters: true, data_collection: 'deny', zdr: true, sort: 'latency' },
  }, {
    base_url: capture.baseUrl,
    config_json: JSON.stringify({}),
  }, 'or-key', undefined)
  const sent = capture.requests[0]
  assert.equal(sent.url, '/chat/completions')
  assert.equal(sent.headers.authorization, 'Bearer or-key')
  assert.equal(sent.headers['http-referer'], 'https://tavern.example')
  assert.equal(sent.headers['x-openrouter-title'], 'Harness Tavern Test')
  assert.deepEqual(sent.json.provider.order, ['Anthropic', 'OpenAI'])
  assert.equal(sent.json.provider.allow_fallbacks, false)
  assert.equal(sent.json.provider.data_collection, 'deny')
  assert.equal(sent.json.reasoning.effort, 'high')
  assert.equal(sent.json.reasoning.exclude, true)
  assert.equal(sent.json.temperature, 0.7)
  assert.equal(sent.json.top_p, 0.86)
  assert.equal(sent.json.frequency_penalty, 0.2)
  assert.equal(sent.json.presence_penalty, 0.1)
  assert.equal(sent.json.top_k, 40)
  assert.equal(sent.json.min_p, 0.05)
  assert.equal(sent.json.repetition_penalty, 1.06)
  assert.equal(sent.json.seed, 9)
  assert.deepEqual(sent.json.stop, ['<END>'])
  assert.deepEqual(sent.json.logit_bias, { 42: -1 })
  assert.deepEqual(sent.json.usage, { include: true })
  assert.equal(result.usage.costUsd, 0.002)
  assert.equal(result.routedProvider, 'Anthropic')
})

await test('maximum OpenRouter thinking uses an explicit budget without shrinking visible output', async t => {
  const capture = await captureServer(t, (record, response) => {
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ choices: [{ message: { content: '{}' } }], usage: {} }))
  })
  const adapter = new OpenRouterAdapter({ timeoutMs: 5000 })
  await adapter.complete({ ...request, thinkingIntensity: 'max', maxOutputTokens: 900 }, { base_url: capture.baseUrl, config_json: '{}' }, 'key')
  assert.equal(capture.requests[0].json.max_tokens, 900)
  assert.ok(capture.requests[0].json.reasoning.max_tokens > 900)
  assert.equal(capture.requests[0].json.reasoning.effort, undefined)
})

await test('generic OpenAI-compatible adapter retries without optional unsupported fields', async t => {
  const capture = await captureServer(t, (record, response, count) => {
    if (count === 1) {
      response.writeHead(400, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ error: { message: 'unknown field response_format' } }))
      return
    }
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ choices: [{ message: { content: 'fallback worked' }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 } }))
  })
  const adapter = new OpenAiCompatibleAdapter({ timeoutMs: 5000 })
  const result = await adapter.complete({
    ...request,
    generation: { frequency_penalty: 0.2, top_k: 55, min_p: 0.04, repetition_penalty: 1.05, seed: 12, provider_options: { mirostat: 1 } },
  }, { base_url: capture.baseUrl, config_json: '{}' }, 'key')
  assert.equal(capture.requests.length, 2)
  assert.ok(capture.requests[0].json.response_format)
  assert.equal(capture.requests[0].json.top_p, 0.86)
  assert.equal(capture.requests[0].json.top_k, 55)
  assert.equal(capture.requests[0].json.mirostat, 1)
  assert.equal(capture.requests[1].json.response_format, undefined)
  assert.equal(capture.requests[1].json.reasoning_effort, undefined)
  assert.equal(capture.requests[1].json.top_k, undefined)
  assert.equal(capture.requests[1].json.mirostat, undefined)
  assert.equal(result.content, 'fallback worked')
})

await test('DeepSeek explicitly disables thinking and leaves automatic output uncapped', async t => {
  const capture = await captureServer(t, (record, response) => {
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(JSON.stringify({
      choices: [{ message: { content: '{"messages":[{"character_id":"assistant","content":"Ready"}],"state_operations":[]}' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 5, completion_tokens: 6, total_tokens: 11 },
    }))
  })
  const adapter = new OpenAiCompatibleAdapter({ timeoutMs: 5000 })
  await adapter.complete({
    ...request,
    thinkingIntensity: 'none',
    maxOutputTokens: null,
    generation: { frequency_penalty: 0.2, presence_penalty: 0.1, top_k: 40, min_p: 0.05, repetition_penalty: 1.05, seed: 5, stop_sequences: ['<END>'] },
  }, {
    provider_id: 'deepseek', base_url: capture.baseUrl, config_json: '{}',
  }, 'deepseek-key')
  const body = capture.requests[0].json
  assert.deepEqual(body.thinking, { type: 'disabled' })
  assert.equal(body.reasoning_effort, undefined)
  assert.equal(body.max_tokens, undefined)
  assert.equal(body.temperature, 0.7)
  assert.equal(body.top_p, 0.86)
  assert.deepEqual(body.stop, ['<END>'])
  assert.equal(body.frequency_penalty, undefined)
  assert.equal(body.top_k, undefined)
  assert.equal(body.seed, undefined)
})

await test('DeepSeek enables requested reasoning without sending ignored samplers or an output cap', async t => {
  const capture = await captureServer(t, (record, response) => {
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(JSON.stringify({
      choices: [{ message: { reasoning_content: 'private', content: '{"messages":[{"character_id":"assistant","content":"Ready"}],"state_operations":[]}' }, finish_reason: 'stop' }],
      usage: {},
    }))
  })
  const adapter = new OpenAiCompatibleAdapter({ timeoutMs: 5000 })
  const result = await adapter.complete({ ...request, thinkingIntensity: 'high', maxOutputTokens: null }, {
    provider_id: 'deepseek', base_url: capture.baseUrl, config_json: '{}',
  }, 'deepseek-key')
  const body = capture.requests[0].json
  assert.deepEqual(body.thinking, { type: 'enabled' })
  assert.equal(body.reasoning_effort, 'high')
  assert.equal(body.max_tokens, undefined)
  assert.equal(body.temperature, undefined)
  assert.equal(body.top_p, undefined)
  assert.equal(result.reasoningContent, 'private')
})

await test('Anthropic thinking budget is separate from visible response budget', async t => {
  const capture = await captureServer(t, (record, response) => {
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ content: [{ type: 'thinking', thinking: 'private' }, { type: 'text', text: 'Visible' }], stop_reason: 'end_turn', usage: { input_tokens: 5, output_tokens: 10 } }))
  })
  const adapter = new AnthropicAdapter({ timeoutMs: 5000 })
  const result = await adapter.complete({ ...request, thinkingIntensity: 'low', maxOutputTokens: 700, generation: { top_k: 30, stop_sequences: ['END'] } }, { base_url: capture.baseUrl }, 'anthropic-key')
  assert.equal(capture.requests[0].headers['x-api-key'], 'anthropic-key')
  assert.ok(capture.requests[0].json.thinking.budget_tokens >= 1024)
  assert.equal(capture.requests[0].json.max_tokens, 700 + capture.requests[0].json.thinking.budget_tokens)
  assert.equal(capture.requests[0].json.top_k, 30)
  assert.deepEqual(capture.requests[0].json.stop_sequences, ['END'])
  assert.equal(result.content, 'Visible')
})

await test('Gemini maps thinking intensity to native thinkingConfig', async t => {
  const capture = await captureServer(t, (record, response) => {
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'Gemini reply' }] }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 3, candidatesTokenCount: 4, thoughtsTokenCount: 5, totalTokenCount: 12 } }))
  })
  const adapter = new GeminiAdapter({ timeoutMs: 5000 })
  const result = await adapter.complete({ ...request, generation: { top_k: 45, seed: 19, stop_sequences: ['END'] } }, { base_url: capture.baseUrl }, 'gemini-key')
  assert.match(capture.requests[0].url, /models\/test%2Fmodel:generateContent\?key=gemini-key/)
  assert.ok(capture.requests[0].json.generationConfig.thinkingConfig.thinkingBudget > 0)
  assert.equal(capture.requests[0].json.generationConfig.maxOutputTokens, 800)
  assert.equal(capture.requests[0].json.generationConfig.topP, 0.86)
  assert.equal(capture.requests[0].json.generationConfig.topK, 45)
  assert.equal(capture.requests[0].json.generationConfig.seed, 19)
  assert.deepEqual(capture.requests[0].json.generationConfig.stopSequences, ['END'])
  assert.equal(result.usage.reasoningTokens, 5)
})

await test('provider registry caches dynamic model catalogs', async t => {
  const { app } = await testApp(t)
  const capture = await captureServer(t, (record, response) => {
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ data: [{ id: 'model-a', context_length: 100000 }] }))
  })
  const connection = app.providers.createConnection({ provider_id: 'custom', label: 'Local catalog', base_url: capture.baseUrl, api_key: 'key', default_model: 'model-a' })
  const first = await app.providers.listModels(connection.id)
  const second = await app.providers.listModels(connection.id)
  assert.equal(first.cached, false)
  assert.equal(second.cached, true)
  assert.equal(capture.requests.length, 1)
  assert.equal(first.models[0].id, 'model-a')
})
