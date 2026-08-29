import { setTimeout as delay } from 'node:timers/promises'

export class ProviderHttpError extends Error {
  constructor(message, { status = 502, providerStatus = null, body = null, retryable = false } = {}) {
    super(message)
    this.status = status
    this.code = 'provider_error'
    this.providerStatus = providerStatus
    this.body = body
    this.retryable = retryable
  }
}

export async function fetchJson(url, options = {}, policy = {}) {
  const timeoutMs = policy.timeoutMs ?? 120_000
  const retries = policy.retries ?? 1
  let lastError
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController()
    const onAbort = () => controller.abort(options.signal?.reason)
    if (options.signal) {
      if (options.signal.aborted) controller.abort(options.signal.reason)
      else options.signal.addEventListener('abort', onAbort, { once: true })
    }
    const timeout = setTimeout(() => controller.abort(new Error('Provider request timed out')), timeoutMs)
    try {
      const response = await fetch(url, { ...options, signal: controller.signal })
      const text = await response.text()
      let body = null
      try { body = text ? JSON.parse(text) : null } catch { body = text }
      if (!response.ok) {
        const retryable = [408, 409, 425, 429, 500, 502, 503, 504].includes(response.status)
        const message = body?.error?.message || body?.message || `Provider returned HTTP ${response.status}`
        throw new ProviderHttpError(message, { providerStatus: response.status, body, retryable })
      }
      return { body, headers: response.headers, status: response.status }
    } catch (error) {
      lastError = error
      const retryable = error instanceof ProviderHttpError ? error.retryable : error?.name !== 'AbortError'
      if (attempt >= retries || !retryable || options.signal?.aborted) throw error
      await delay(Math.min(2000, 250 * 2 ** attempt), undefined, { signal: options.signal })
    } finally {
      clearTimeout(timeout)
      options.signal?.removeEventListener?.('abort', onAbort)
    }
  }
  throw lastError
}

export function joinUrl(base, path) {
  return `${String(base).replace(/\/+$/, '')}/${String(path).replace(/^\/+/, '')}`
}
