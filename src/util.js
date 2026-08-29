import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'

export function id(prefix = 'id') {
  return `${prefix}_${randomUUID().replaceAll('-', '')}`
}

export function nowIso() {
  return new Date().toISOString()
}

export function isoAfterDays(days) {
  const date = new Date()
  date.setUTCDate(date.getUTCDate() + Number(days || 0))
  return date.toISOString()
}

export function isExpired(value) {
  if (!value) return false
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) && timestamp <= Date.now()
}

export function json(value, fallback = null) {
  if (value === null || value === undefined || value === '') return fallback
  if (typeof value === 'object') return value
  try { return JSON.parse(value) } catch { return fallback }
}

export function clamp(number, min, max) {
  const n = Number(number)
  if (!Number.isFinite(n)) return min
  return Math.max(min, Math.min(max, n))
}

export function cleanText(value, max = 100_000) {
  if (typeof value !== 'string') return ''
  return value.replaceAll('\u0000', '').slice(0, max).trim()
}

export function assert(condition, message, status = 400, code = 'bad_request') {
  if (condition) return
  const error = new Error(message)
  error.status = status
  error.code = code
  throw error
}

export function safeJsonParse(text) {
  const source = String(text ?? '').trim()
  try { return JSON.parse(source) } catch {}
  const fenced = source.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fenced) {
    try { return JSON.parse(fenced[1]) } catch {}
  }
  const first = Math.min(...['{', '['].map(char => {
    const index = source.indexOf(char)
    return index < 0 ? Number.POSITIVE_INFINITY : index
  }))
  if (Number.isFinite(first)) {
    for (let end = source.length; end > first; end -= 1) {
      try { return JSON.parse(source.slice(first, end)) } catch {}
    }
  }
  return null
}

export function sha256Base64Url(value) {
  return createHash('sha256').update(value).digest('base64url')
}

export function sha256Hex(value) {
  return createHash('sha256').update(typeof value === 'string' || Buffer.isBuffer(value) ? value : stableStringify(value)).digest('hex')
}

export function randomToken(bytes = 32) {
  return randomBytes(bytes).toString('base64url')
}

export function constantTimeEqual(left, right) {
  const a = Buffer.from(String(left ?? ''))
  const b = Buffer.from(String(right ?? ''))
  return a.length === b.length && timingSafeEqual(a, b)
}

export function parseBoolean(value, fallback = false) {
  if (typeof value === 'boolean') return value
  if (typeof value !== 'string') return fallback
  if (['1', 'true', 'yes', 'on'].includes(value.toLowerCase())) return true
  if (['0', 'false', 'no', 'off'].includes(value.toLowerCase())) return false
  return fallback
}

export function tokenize(value) {
  return String(value ?? '').toLocaleLowerCase().match(/[\p{L}\p{N}_'-]+/gu) ?? []
}

export function overlapScore(query, candidate) {
  const q = new Set(tokenize(query))
  if (q.size === 0) return 0
  const c = new Set(tokenize(candidate))
  let overlap = 0
  for (const token of q) if (c.has(token)) overlap += 1
  return overlap / Math.sqrt(q.size * Math.max(1, c.size))
}

export function redact(value) {
  if (!value) return ''
  const text = String(value)
  if (text.length <= 8) return '••••••••'
  return `${text.slice(0, 3)}…${text.slice(-4)}`
}

export function deepClone(value) {
  return structuredClone(value)
}

export function plainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

export function slugify(value, fallback = 'item') {
  const slug = String(value ?? '')
    .normalize('NFKD')
    .toLocaleLowerCase()
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120)
  return slug || fallback
}

export function titleCase(value) {
  return cleanText(String(value ?? ''), 500)
    .replace(/[-_]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map(word => word.length <= 2 ? word.toLocaleUpperCase() : `${word[0].toLocaleUpperCase()}${word.slice(1)}`)
    .join(' ')
}

export function uniqueStrings(values, maxItems = 100, maxLength = 1000) {
  const output = []
  const seen = new Set()
  for (const value of Array.isArray(values) ? values : []) {
    const text = cleanText(String(value ?? ''), maxLength)
    const key = text.toLocaleLowerCase()
    if (!text || seen.has(key)) continue
    seen.add(key)
    output.push(text)
    if (output.length >= maxItems) break
  }
  return output
}

function stableValue(value, inArray = false) {
  if (value === undefined || typeof value === 'function' || typeof value === 'symbol') return inArray ? null : undefined
  if (typeof value === 'bigint') return value.toString()
  if (typeof value === 'number' && !Number.isFinite(value)) return null
  if (value === null || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map(item => stableValue(item, true))
  const output = {}
  for (const key of Object.keys(value).sort()) {
    const normalized = stableValue(value[key], false)
    if (normalized !== undefined) output[key] = normalized
  }
  return output
}

export function stableStringify(value) {
  return JSON.stringify(stableValue(value, false))
}
