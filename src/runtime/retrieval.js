const VECTOR_SIZE = 512

function hash(value) {
  let output = 2166136261
  for (const character of String(value)) {
    output ^= character.codePointAt(0)
    output = Math.imul(output, 16777619)
  }
  return output >>> 0
}

function stem(value) {
  if (!/^[a-z]{5,}$/i.test(value)) return value
  return value.replace(/(?:ingly|edly|ing|ed|ies|es|s)$/i, match => match.toLowerCase() === 'ies' ? 'y' : '') || value
}

export function retrievalTerms(value) {
  const normalized = String(value ?? '').normalize('NFKC').toLocaleLowerCase()
  const terms = []
  const words = normalized.match(/[\p{L}\p{N}_'-]+/gu) ?? []
  for (const word of words) {
    if (/\p{Script=Han}/u.test(word)) {
      const characters = [...word]
      terms.push(...characters.map(character => `han:${character}`))
      for (let index = 0; index < characters.length - 1; index += 1) terms.push(`han2:${characters[index]}${characters[index + 1]}`)
    } else {
      terms.push(`word:${stem(word)}`)
    }
  }
  for (let index = 0; index < words.length - 1; index += 1) terms.push(`pair:${stem(words[index])}:${stem(words[index + 1])}`)
  return terms
}

export function vectorize(value) {
  const vector = new Map()
  for (const term of retrievalTerms(value)) {
    const index = hash(term) % VECTOR_SIZE
    vector.set(index, (vector.get(index) ?? 0) + 1)
  }
  let magnitude = 0
  for (const count of vector.values()) magnitude += count * count
  magnitude = Math.sqrt(magnitude)
  if (magnitude) for (const [index, count] of vector) vector.set(index, count / magnitude)
  return vector
}

export function serializeVector(value) {
  const vector = value instanceof Map ? value : vectorize(value)
  return [...vector.entries()].sort((left, right) => left[0] - right[0])
}

export function deserializeVector(value) {
  const rows = Array.isArray(value) ? value : []
  return new Map(rows
    .filter(item => Array.isArray(item) && Number.isInteger(Number(item[0])) && Number.isFinite(Number(item[1])))
    .map(item => [Number(item[0]), Number(item[1])]))
}

export function vectorSimilarity(left, right) {
  const leftVector = left instanceof Map ? left : vectorize(left)
  const rightVector = right instanceof Map ? right : vectorize(right)
  if (!leftVector.size || !rightVector.size) return 0
  const [small, large] = leftVector.size <= rightVector.size ? [leftVector, rightVector] : [rightVector, leftVector]
  let score = 0
  for (const [index, weight] of small) score += weight * (large.get(index) ?? 0)
  return Math.max(0, Math.min(1, score))
}

export function rankRelevant(items, query, { text = item => item?.content ?? '', limit = 8, minimum = 0.035 } = {}) {
  const queryVector = vectorize(query)
  return items
    .map((item, index) => ({ item, index, score: vectorSimilarity(queryVector, text(item)) }))
    .filter(candidate => candidate.score >= minimum)
    .sort((left, right) => right.score - left.score || right.index - left.index)
    .slice(0, limit)
}
