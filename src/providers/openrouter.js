import { OpenAiCompatibleAdapter, normalizeUsage, openAiMultimodalMessages } from './openai-compatible.js'
import { fetchJson, joinUrl } from './http.js'
import { json } from '../util.js'
import { thinkingPlan } from '../runtime/thinking.js'
import { openAiGenerationParameters, presetBodyOverlay, safeBodyOverlay } from './generation-options.js'

function routeBody(route = {}) {
  const provider = {}
  const copy = (target, source, name) => {
    if (source[name] !== undefined && source[name] !== null && source[name] !== '') target[name] = source[name]
  }
  for (const name of ['order', 'only', 'ignore', 'allow_fallbacks', 'require_parameters', 'data_collection', 'zdr', 'sort', 'quantizations', 'max_price']) {
    copy(provider, route, name)
  }
  return Object.keys(provider).length ? provider : undefined
}

export class OpenRouterAdapter extends OpenAiCompatibleAdapter {
  constructor(options = {}) {
    super(options)
    this.appName = options.appName || 'Harness Tavern'
    this.siteUrl = options.siteUrl || 'https://localhost'
  }

  async complete(request, connection, credential, signal) {
    const plan = thinkingPlan(request.thinkingIntensity, request.maxOutputTokens)
    const config = json(connection.config_json ?? connection.config, {}) ?? {}
    const route = { ...(config.route ?? {}), ...(request.route ?? {}) }
    const provider = routeBody(route)
    const body = {
      ...safeBodyOverlay(config.extra_body),
      ...presetBodyOverlay(request),
      model: request.model,
      ...Array.isArray(route.models) && route.models.length ? { models: route.models } : {},
      messages: openAiMultimodalMessages(request.messages, request.attachments),
      temperature: request.temperature,
      top_p: request.topP,
      ...openAiGenerationParameters(request),
      ...plan.visibleTokens === null ? {} : { max_tokens: plan.visibleTokens },
      stream: false,
      usage: { include: true },
      ...request.jsonMode ? { response_format: { type: 'json_object' } } : {},
      ...plan.openRouterEffort ? {
        reasoning: plan.intensity === 'max'
          ? { max_tokens: plan.reasoningTokens, exclude: true }
          : { effort: plan.openRouterEffort, exclude: true },
      } : {},
      ...provider ? { provider } : {},
    }
    const result = await fetchJson(joinUrl(connection.base_url, 'chat/completions'), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
        authorization: `Bearer ${credential}`,
        'HTTP-Referer': config.site_url || this.siteUrl,
        'X-OpenRouter-Title': config.app_name || this.appName,
        ...(config.headers ?? {}),
      },
      body: JSON.stringify(body),
      signal,
    }, { timeoutMs: this.timeoutMs, retries: 1 })
    const choice = result.body?.choices?.[0]
    const content = typeof choice?.message?.content === 'string'
      ? choice.message.content
      : Array.isArray(choice?.message?.content)
        ? choice.message.content.map(part => part?.text ?? '').join('\n')
        : ''
    return {
      content,
      finishReason: choice?.finish_reason ?? null,
      usage: normalizeUsage(result.body?.usage),
      raw: result.body,
      requestBody: body,
      responseHeaders: Object.fromEntries(result.headers.entries()),
      routedProvider: result.body?.provider ?? result.headers.get('x-openrouter-provider') ?? null,
    }
  }

  async listProviders(connection, credential, signal) {
    const result = await fetchJson(joinUrl(connection.base_url, 'providers'), {
      headers: { accept: 'application/json', authorization: `Bearer ${credential}` }, signal,
    }, { timeoutMs: 30_000, retries: 0 })
    return result.body?.data ?? result.body ?? []
  }
}
