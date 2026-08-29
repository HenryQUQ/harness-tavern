const TOKEN_KEY = 'harness-tavern-access-token'

export function getAccessToken() {
  return sessionStorage.getItem(TOKEN_KEY) || ''
}

export function setAccessToken(value) {
  if (value) sessionStorage.setItem(TOKEN_KEY, value)
  else sessionStorage.removeItem(TOKEN_KEY)
}

export async function api(path, options = {}) {
  const headers = new Headers(options.headers || {})
  if (options.body !== undefined && !headers.has('content-type')) headers.set('content-type', 'application/json')
  const token = getAccessToken()
  if (token) headers.set('x-harness-tavern-token', token)
  const response = await fetch(path, { ...options, headers })
  const contentType = response.headers.get('content-type') || ''
  const body = contentType.includes('json') ? await response.json() : await response.text()
  if (!response.ok) {
    const error = new Error(body?.error?.message || body?.message || response.statusText)
    error.status = response.status
    error.code = body?.error?.code
    error.body = body
    throw error
  }
  return body
}

export async function streamTurn(conversationId, content, { onEvent } = {}) {
  const headers = new Headers({ 'content-type': 'application/json' })
  const token = getAccessToken()
  if (token) headers.set('x-harness-tavern-token', token)
  const response = await fetch(`/api/conversations/${encodeURIComponent(conversationId)}/turn/stream`, {
    method: 'POST', headers, body: JSON.stringify({ content, idempotency_key: crypto.randomUUID() }),
  })
  if (!response.ok) throw new Error(`Could not send message (${response.status})`)
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let completed = null
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const frames = buffer.split('\n\n')
    buffer = frames.pop() || ''
    for (const frame of frames) {
      let event = 'message'
      let data = null
      for (const line of frame.split('\n')) {
        if (line.startsWith('event:')) event = line.slice(6).trim()
        if (line.startsWith('data:')) {
          try { data = JSON.parse(line.slice(5).trim()) } catch { data = line.slice(5).trim() }
        }
      }
      onEvent?.(event, data)
      if (event === 'turn.completed') completed = data
      if (event === 'turn.failed') throw Object.assign(new Error(data?.message || 'Turn failed'), { code: data?.code })
    }
  }
  return completed
}

export function downloadJson(value, filename) {
  const blob = new Blob([`${JSON.stringify(value, null, 2)}\n`], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
