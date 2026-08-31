import { fetchJson, joinUrl } from './http.js'
import { thinkingPlan } from '../runtime/thinking.js'
import { anthropicGenerationParameters, presetBodyOverlay, safeBodyOverlay } from './generation-options.js'
import { json } from '../util.js'

function splitSystem(messages, attachments = []) {
  const system = messages.filter(message => message.role === 'system').map(message => message.content).join('\n\n')
  const rest = messages.filter(message => message.role !== 'system').map(message => ({
    role: message.role === 'assistant' ? 'assistant' : 'user',
    content: String(message.content ?? ''),
  }))
  const images = attachments.filter(item => item.delivery === 'inline' && item.mime_type?.startsWith('image/') && item.data_base64)
  const targetIndex = rest.findLastIndex(message => message.role === 'user')
  if (images.length && targetIndex >= 0) rest[targetIndex] = {
    ...rest[targetIndex],
    content: [
      { type: 'text', text: rest[targetIndex].content },
      ...images.map(item => ({ type: 'image', source: { type: 'base64', media_type: item.mime_type, data: item.data_base64 } })),
    ],
  }
  return { system, messages: rest }
}

export class AnthropicAdapter {
  constructor({ timeoutMs = 120_000 } = {}) { this.timeoutMs = timeoutMs }

  async complete(request, connection, credential, signal) {
    const plan = thinkingPlan(request.thinkingIntensity, request.maxOutputTokens)
    const prompt = splitSystem(request.messages, request.attachments)
    const reasoningBudget = plan.reasoningTokens ? Math.max(1024, plan.reasoningTokens) : 0
    // Anthropic requires max_tokens. When Tavern is in automatic mode, use a
    // generous protocol fallback rather than exposing a low creative limit.
    const visibleBudget = plan.visibleTokens ?? 16_384
    const connectionConfig = json(connection.config_json ?? connection.config, {}) ?? {}
    const body = {
      ...safeBodyOverlay(connectionConfig.extra_body),
      ...presetBodyOverlay(request),
      model: request.model,
      system: prompt.system,
      messages: prompt.messages,
      max_tokens: visibleBudget + reasoningBudget,
      ...anthropicGenerationParameters(request),
      ...reasoningBudget ? { thinking: { type: 'enabled', budget_tokens: reasoningBudget } } : { temperature: request.temperature, top_p: request.topP },
    }
    const result = await fetchJson(joinUrl(connection.base_url, 'messages'), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
        'x-api-key': credential,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body), signal,
    }, { timeoutMs: this.timeoutMs, retries: 1 })
    const content = (result.body?.content ?? []).filter(part => part?.type === 'text').map(part => part.text).join('\n')
    return {
      content,
      finishReason: result.body?.stop_reason ?? null,
      usage: {
        promptTokens: result.body?.usage?.input_tokens ?? null,
        completionTokens: result.body?.usage?.output_tokens ?? null,
        reasoningTokens: null,
        totalTokens: (result.body?.usage?.input_tokens ?? 0) + (result.body?.usage?.output_tokens ?? 0),
        raw: result.body?.usage ?? {},
      },
      raw: result.body,
      requestBody: body,
    }
  }

  async listModels(connection, credential, signal) {
    const result = await fetchJson(joinUrl(connection.base_url, 'models'), {
      headers: { accept: 'application/json', 'x-api-key': credential, 'anthropic-version': '2023-06-01' }, signal,
    }, { timeoutMs: 30_000, retries: 0 })
    return (result.body?.data ?? []).map(model => ({ id: model.id, name: model.display_name ?? model.id, raw: model }))
  }
}
