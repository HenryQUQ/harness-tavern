import { fetchJson, joinUrl } from './http.js'
import { thinkingPlan } from '../runtime/thinking.js'
import { geminiGenerationParameters, presetBodyOverlay, safeBodyOverlay } from './generation-options.js'
import { json } from '../util.js'

function transformMessages(messages, attachments = []) {
  const system = messages.filter(message => message.role === 'system').map(message => message.content).join('\n\n')
  const contents = messages.filter(message => message.role !== 'system').map(message => ({
    role: message.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: String(message.content ?? '') }],
  }))
  const images = attachments.filter(item => item.delivery === 'inline' && item.mime_type?.startsWith('image/') && item.data_base64)
  const targetIndex = contents.findLastIndex(message => message.role === 'user')
  if (images.length && targetIndex >= 0) contents[targetIndex].parts.push(...images.map(item => ({ inlineData: { mimeType: item.mime_type, data: item.data_base64 } })))
  return { system, contents }
}

export class GeminiAdapter {
  constructor({ timeoutMs = 120_000 } = {}) { this.timeoutMs = timeoutMs }

  async complete(request, connection, credential, signal) {
    const plan = thinkingPlan(request.thinkingIntensity, request.maxOutputTokens)
    const prompt = transformMessages(request.messages, request.attachments)
    const connectionConfig = json(connection.config_json ?? connection.config, {}) ?? {}
    const connectionOptions = safeBodyOverlay(connectionConfig.extra_body)
    const presetOptions = presetBodyOverlay(request)
    const extraGenerationConfig = {
      ...(connectionOptions.generationConfig && typeof connectionOptions.generationConfig === 'object' ? connectionOptions.generationConfig : {}),
      ...(presetOptions.generationConfig && typeof presetOptions.generationConfig === 'object' ? presetOptions.generationConfig : {}),
    }
    delete connectionOptions.generationConfig
    delete presetOptions.generationConfig
    const body = {
      ...connectionOptions,
      ...presetOptions,
      ...prompt.system ? { systemInstruction: { parts: [{ text: prompt.system }] } } : {},
      contents: prompt.contents,
      generationConfig: {
        ...extraGenerationConfig,
        temperature: request.temperature,
        topP: request.topP,
        ...geminiGenerationParameters(request),
        ...plan.visibleTokens === null ? {} : { maxOutputTokens: plan.visibleTokens },
        ...plan.reasoningTokens ? { thinkingConfig: { thinkingBudget: plan.reasoningTokens, includeThoughts: false } } : {},
        ...request.jsonMode ? { responseMimeType: 'application/json' } : {},
      },
    }
    const endpoint = joinUrl(connection.base_url, `models/${encodeURIComponent(request.model)}:generateContent?key=${encodeURIComponent(credential)}`)
    const result = await fetchJson(endpoint, {
      method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify(body), signal,
    }, { timeoutMs: this.timeoutMs, retries: 1 })
    const content = result.body?.candidates?.[0]?.content?.parts?.map(part => part.text ?? '').join('\n') ?? ''
    const usage = result.body?.usageMetadata ?? {}
    return {
      content,
      finishReason: result.body?.candidates?.[0]?.finishReason ?? null,
      usage: {
        promptTokens: usage.promptTokenCount ?? null,
        completionTokens: usage.candidatesTokenCount ?? null,
        reasoningTokens: usage.thoughtsTokenCount ?? null,
        totalTokens: usage.totalTokenCount ?? null,
        raw: usage,
      },
      raw: result.body,
      requestBody: body,
    }
  }

  async listModels(connection, credential, signal) {
    const result = await fetchJson(`${joinUrl(connection.base_url, 'models')}?key=${encodeURIComponent(credential)}`, {
      headers: { accept: 'application/json' }, signal,
    }, { timeoutMs: 30_000, retries: 0 })
    return (result.body?.models ?? []).filter(model => (model.supportedGenerationMethods ?? []).includes('generateContent')).map(model => ({
      id: String(model.name ?? '').replace(/^models\//, ''), name: model.displayName ?? model.name, contextLength: model.inputTokenLimit ?? null, raw: model,
    }))
  }
}
