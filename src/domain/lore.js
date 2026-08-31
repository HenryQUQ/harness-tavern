import { cleanText, plainObject, uniqueStrings } from '../util.js'

function first(value, ...aliases) {
  if (value !== undefined) return value
  return aliases.find(candidate => candidate !== undefined)
}

function boundedNumber(value, min, max, { integer = false } = {}) {
  if (value === undefined || value === null || value === '') return undefined
  const number = Number(value)
  if (!Number.isFinite(number)) return undefined
  const bounded = Math.max(min, Math.min(max, number))
  return integer ? Math.round(bounded) : bounded
}

function booleanField(entry, snake, camel) {
  const value = first(entry[snake], entry[camel])
  return value === undefined ? undefined : Boolean(value)
}

export function loreCompatibilityFields(entry = {}) {
  const selectiveLogic = first(entry.selective_logic, entry.selectiveLogic)
  const insertionSource = plainObject(entry.insertion) ? entry.insertion : {}
  const insertion = {
    ...first(insertionSource.position, entry.position) !== undefined ? { position: first(insertionSource.position, entry.position) } : {},
    ...boundedNumber(first(insertionSource.order, entry.order), -1_000_000, 1_000_000) !== undefined ? { order: boundedNumber(first(insertionSource.order, entry.order), -1_000_000, 1_000_000) } : {},
    ...boundedNumber(first(insertionSource.depth, entry.depth), 0, 1000, { integer: true }) !== undefined ? { depth: boundedNumber(first(insertionSource.depth, entry.depth), 0, 1000, { integer: true }) } : {},
    ...['system', 'user', 'assistant'].includes(first(insertionSource.role, entry.role)) ? { role: first(insertionSource.role, entry.role) } : {},
  }
  const characterFilter = first(entry.character_filter, entry.characterFilter)
  const normalizedFilter = plainObject(characterFilter) ? {
    names: uniqueStrings(characterFilter.names ?? characterFilter.characters, 100, 160),
    tags: uniqueStrings(characterFilter.tags, 100, 100),
    exclude: Boolean(characterFilter.exclude ?? characterFilter.isExclude),
  } : undefined
  const output = {
    ...boundedNumber(first(entry.scan_depth, entry.scanDepth), 0, 1000, { integer: true }) !== undefined ? { scan_depth: boundedNumber(first(entry.scan_depth, entry.scanDepth), 0, 1000, { integer: true }) } : {},
    ...booleanField(entry, 'case_sensitive', 'caseSensitive') !== undefined ? { case_sensitive: booleanField(entry, 'case_sensitive', 'caseSensitive') } : {},
    ...booleanField(entry, 'match_whole_words', 'matchWholeWords') !== undefined ? { match_whole_words: booleanField(entry, 'match_whole_words', 'matchWholeWords') } : {},
    ...selectiveLogic !== undefined ? { selective_logic: ['and_any', 'not_all', 'not_any', 'and_all'].includes(selectiveLogic) ? selectiveLogic : boundedNumber(selectiveLogic, 0, 3, { integer: true }) ?? 0 } : {},
    ...booleanField(entry, 'use_probability', 'useProbability') !== undefined ? { use_probability: booleanField(entry, 'use_probability', 'useProbability') } : {},
    ...boundedNumber(entry.probability, 0, 100) !== undefined ? { probability: boundedNumber(entry.probability, 0, 100) } : {},
    ...cleanText(entry.group, 160) ? { group: cleanText(entry.group, 160) } : {},
    ...booleanField(entry, 'group_override', 'groupOverride') !== undefined ? { group_override: booleanField(entry, 'group_override', 'groupOverride') } : {},
    ...boundedNumber(first(entry.group_weight, entry.groupWeight), 0, 1_000_000) !== undefined ? { group_weight: boundedNumber(first(entry.group_weight, entry.groupWeight), 0, 1_000_000) } : {},
    ...boundedNumber(entry.sticky, 0, 1000, { integer: true }) !== undefined ? { sticky: boundedNumber(entry.sticky, 0, 1000, { integer: true }) } : {},
    ...boundedNumber(entry.cooldown, 0, 1000, { integer: true }) !== undefined ? { cooldown: boundedNumber(entry.cooldown, 0, 1000, { integer: true }) } : {},
    ...boundedNumber(entry.delay, 0, 1000, { integer: true }) !== undefined ? { delay: boundedNumber(entry.delay, 0, 1000, { integer: true }) } : {},
    ...booleanField(entry, 'prevent_recursion', 'preventRecursion') !== undefined ? { prevent_recursion: booleanField(entry, 'prevent_recursion', 'preventRecursion') } : {},
    ...booleanField(entry, 'exclude_recursion', 'excludeRecursion') !== undefined ? { exclude_recursion: booleanField(entry, 'exclude_recursion', 'excludeRecursion') } : {},
    ...Object.keys(insertion).length ? { insertion } : {},
    ...normalizedFilter ? { character_filter: normalizedFilter } : {},
  }
  return output
}
