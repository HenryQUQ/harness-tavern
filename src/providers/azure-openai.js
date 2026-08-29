import { fetchJson } from './http.js'
import { json } from '../util.js'
import { thinkingPlan } from '../runtime/thinking.js'
import { openAiGenerationParameters, presetBodyOverlay, safeBodyOverlay } from './generation-options.js'
import { normalizeUsage } from './openai-compatible.js'

export class AzureOpenAiAdapter {
  constructor({ timeoutMs = 120_000 } = {}) { this.timeoutMs = timeoutMs }

  async complete(request, connection, credential, signal) {
    const config = json(connection.config_json ?? connection.config, {}) ?? {}
    const plan = thinkingPlan(request.thinkingIntensity, request.maxOutputTokens)
    const apiVersion = config.api_version || '2024-10-21'
    const url = `${String(connection.base_url).replace(/\/+$/, '')}/chat/completions?api-version=${encodeURIComponent(apiVersion)}`
    const body = {
      ...safeBodyOverlay(config.extra_body),
      ...presetBodyOverlay(request),
      messages: request.messages,
      temperature: request.temperature,
      top_p: request.topP,
      ...openAiGenerationParameters(request, { extended: false }),
      ...plan.visibleTokens === null ? {} : { max_tokens: plan.visibleTokens },
      ...request.jsonMode ? { response_format: { type: 'json_object' } } : {},
      ...plan.openAiEffort ? { reasoning_effort: plan.openAiEffort } : {},
    }
    const result = await fetchJson(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json', 'api-key': credential, ...(config.headers ?? {}) },
      body: JSON.stringify(body), signal,
    }, { timeoutMs: this.timeoutMs, retries: 1 })
    return {
      content: result.body?.choices?.[0]?.message?.content ?? '',
      finishReason: result.body?.choices?.[0]?.finish_reason ?? null,
      usage: normalizeUsage(result.body?.usage),
      raw: result.body,
      requestBody: body,
    }
  }

  async listModels() { return [] }
}
