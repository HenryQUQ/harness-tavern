import { fetchJson, joinUrl } from './http.js'
import { json } from '../util.js'
import { thinkingPlan } from '../runtime/thinking.js'
import { openAiGenerationParameters, presetBodyOverlay, safeBodyOverlay } from './generation-options.js'

function customHeaders(connection) {
  const headers = json(connection.config_json ?? connection.config, {})?.headers ?? {}
  return Object.fromEntries(Object.entries(headers).filter(([, value]) => typeof value === 'string'))
}

function customBody(connection) {
  return json(connection.config_json ?? connection.config, {})?.extra_body ?? {}
}

function textFromContent(content) {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) return content
    .map(part => typeof part === 'string' ? part : part?.text ?? part?.content ?? '')
    .filter(Boolean)
    .join('\n')
  return ''
}

function combinedUsage(...attempts) {
  const normalized = attempts.map(normalizeUsage)
  const output = {}
  for (const key of ['promptTokens', 'completionTokens', 'reasoningTokens', 'totalTokens', 'costUsd']) {
    const values = normalized.map(item => item[key]).filter(value => value !== null && value !== undefined)
    if (values.length) output[key] = values.reduce((sum, value) => sum + Number(value), 0)
  }
  output.raw = { attempts }
  return output
}

export class OpenAiCompatibleAdapter {
  constructor({ timeoutMs = 120_000 } = {}) { this.timeoutMs = timeoutMs }

  async complete(request, connection, credential, signal) {
    const plan = thinkingPlan(request.thinkingIntensity, request.maxOutputTokens)
    const isDeepSeek = connection.provider_id === 'deepseek'
    const deepSeekThinking = isDeepSeek ? request.thinkingIntensity !== 'none' : null
    const headers = {
      'content-type': 'application/json',
      accept: 'application/json',
      ...credential ? { authorization: `Bearer ${credential}` } : {},
      ...customHeaders(connection),
    }
    const presetOptions = presetBodyOverlay(request)
    const optionalParameters = openAiGenerationParameters(request, { deepSeek: isDeepSeek })
    let body = {
      ...safeBodyOverlay(customBody(connection)),
      ...presetOptions,
      model: request.model,
      messages: request.messages,
      ...!isDeepSeek || !deepSeekThinking ? { temperature: request.temperature, top_p: request.topP } : {},
      ...optionalParameters,
      ...plan.visibleTokens === null ? {} : { max_tokens: plan.visibleTokens },
      stream: false,
      ...request.jsonMode ? { response_format: { type: 'json_object' } } : {},
      ...isDeepSeek ? { thinking: { type: deepSeekThinking ? 'enabled' : 'disabled' } } : {},
      ...deepSeekThinking && plan.deepSeekEffort ? { reasoning_effort: plan.deepSeekEffort } : {},
      ...!isDeepSeek && plan.openAiEffort ? { reasoning_effort: plan.openAiEffort } : {},
    }
    const endpoint = joinUrl(connection.base_url, 'chat/completions')
    let result
    try {
      result = await fetchJson(endpoint, {
        method: 'POST', headers, body: JSON.stringify(body), signal,
      }, { timeoutMs: this.timeoutMs, retries: 1 })
    } catch (error) {
      // OpenAI-compatible servers vary widely. Retry once without optional
      // structured-output/reasoning fields when the server rejects them.
      if (error?.providerStatus === 400 && (body.response_format || body.reasoning_effort)) {
        delete body.response_format
        delete body.reasoning_effort
        for (const key of Object.keys(presetOptions)) delete body[key]
        for (const key of ['frequency_penalty', 'presence_penalty', 'top_k', 'min_p', 'repetition_penalty', 'seed']) delete body[key]
        result = await fetchJson(endpoint, {
          method: 'POST', headers, body: JSON.stringify(body), signal,
        }, { timeoutMs: this.timeoutMs, retries: 0 })
      } else {
        throw error
      }
    }
    let choice = result.body?.choices?.[0]
    let content = textFromContent(choice?.message?.content)
    let emptyJsonAttempt = null
    let fallback = null
    // DeepSeek documents that JSON mode can occasionally return an empty
    // content string. Retry that exact request once with a stronger JSON
    // reminder and thinking disabled; do not introduce an output ceiling.
    if (isDeepSeek && request.jsonMode && !content.trim() && choice?.finish_reason !== 'length') {
      emptyJsonAttempt = result
      body = {
        ...body,
        messages: body.messages.map((message, index) => index === 0
          ? { ...message, content: `${message.content}\n\nJSON RETRY REQUIREMENT: Return the complete non-empty JSON object now. Never return only whitespace.` }
          : message),
        thinking: { type: 'disabled' },
      }
      delete body.reasoning_effort
      result = await fetchJson(endpoint, {
        method: 'POST', headers, body: JSON.stringify(body), signal,
      }, { timeoutMs: this.timeoutMs, retries: 0 })
      choice = result.body?.choices?.[0]
      content = textFromContent(choice?.message?.content)
      fallback = 'deepseek-empty-json-non-thinking-retry'
    }
    return {
      content,
      reasoningContent: textFromContent(choice?.message?.reasoning_content),
      finishReason: choice?.finish_reason ?? null,
      usage: emptyJsonAttempt ? combinedUsage(emptyJsonAttempt.body?.usage, result.body?.usage) : normalizeUsage(result.body?.usage),
      raw: emptyJsonAttempt ? { first_attempt: emptyJsonAttempt.body, retry: result.body } : result.body,
      fallback,
      requestBody: body,
      responseHeaders: Object.fromEntries(result.headers.entries()),
    }
  }

  async listModels(connection, credential, signal) {
    const result = await fetchJson(joinUrl(connection.base_url, 'models'), {
      headers: {
        accept: 'application/json',
        ...credential ? { authorization: `Bearer ${credential}` } : {},
        ...customHeaders(connection),
      },
      signal,
    }, { timeoutMs: Math.min(this.timeoutMs, 30_000), retries: 0 })
    const data = Array.isArray(result.body?.data) ? result.body.data : Array.isArray(result.body) ? result.body : []
    return data.map(item => ({
      id: String(item.id ?? item.name ?? ''),
      name: String(item.name ?? item.id ?? ''),
      contextLength: item.context_length ?? item.context_window ?? null,
      pricing: item.pricing ?? null,
      architecture: item.architecture ?? null,
      supportedParameters: item.supported_parameters ?? null,
      raw: item,
    })).filter(model => model.id)
  }
}

export function normalizeUsage(usage) {
  if (!usage || typeof usage !== 'object') return {}
  return {
    promptTokens: usage.prompt_tokens ?? usage.input_tokens ?? null,
    completionTokens: usage.completion_tokens ?? usage.output_tokens ?? null,
    reasoningTokens: usage.completion_tokens_details?.reasoning_tokens ?? usage.output_tokens_details?.reasoning_tokens ?? null,
    totalTokens: usage.total_tokens ?? null,
    costUsd: usage.cost ?? usage.cost_details?.upstream_inference_cost ?? null,
    raw: usage,
  }
}
