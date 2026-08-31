import { getProjectionPath } from '../domain/projection.js'
import { cleanText, plainObject, sha256Hex, slugify } from '../util.js'

const TRANSFORM_STAGES = new Set(['user_input', 'model_input', 'model_output', 'display', 'lore'])
const REGEX_FLAGS = /^[dgimsuvy]*$/

function list(value) {
  return Array.isArray(value) ? value : value === undefined || value === null ? [] : [value]
}

function repeatLengthAt(pattern, index) {
  if (pattern[index] === '*' || pattern[index] === '+') return 1
  if (pattern[index] !== '{') return 0
  const match = pattern.slice(index).match(/^\{(\d+)(?:,(\d*)?)?\}/)
  if (!match) return 0
  const maximum = match[2] === undefined ? Number(match[1]) : match[2] === '' ? Infinity : Number(match[2])
  return maximum > 1 ? match[0].length : 0
}

function ambiguousAlternation(source) {
  const body = source.replace(/^\?(?::|[=!]|<[=!]|<[^>]+>)/, '')
  const alternatives = []
  let current = ''
  let depth = 0
  let inClass = false
  for (let index = 0; index < body.length; index += 1) {
    const token = body[index]
    if (token === '\\') {
      current += token + (body[index + 1] ?? '')
      index += 1
      continue
    }
    if (token === '[') inClass = true
    if (token === ']' && inClass) inClass = false
    if (!inClass && token === '(') depth += 1
    if (!inClass && token === ')') depth = Math.max(0, depth - 1)
    if (!inClass && !depth && token === '|') {
      alternatives.push(current)
      current = ''
      continue
    }
    current += token
  }
  alternatives.push(current)
  return alternatives.some((left, leftIndex) => alternatives.some((right, rightIndex) => (
    leftIndex !== rightIndex && (!left || !right || left.startsWith(right))
  )))
}

function potentiallyUnsafeRegex(pattern) {
  const groups = [{ repeated: false, alternating: false, start: 0 }]
  let inClass = false
  for (let index = 0; index < pattern.length; index += 1) {
    const token = pattern[index]
    if (token === '\\') {
      if (!inClass && /[1-9]/.test(pattern[index + 1] ?? '')) return true
      index += 1
      continue
    }
    if (token === '[') { inClass = true; continue }
    if (token === ']' && inClass) { inClass = false; continue }
    if (inClass) continue
    if (token === '(') { groups.push({ repeated: false, alternating: false, start: index + 1 }); continue }
    if (token === '|') { groups.at(-1).alternating = true; continue }
    if (token === ')') {
      if (groups.length === 1) continue
      const group = groups.pop()
      const repeatLength = repeatLengthAt(pattern, index + 1)
      if (repeatLength && (group.repeated || (group.alternating && ambiguousAlternation(pattern.slice(group.start, index))))) return true
      groups.at(-1).repeated ||= group.repeated || Boolean(repeatLength)
      continue
    }
    if (repeatLengthAt(pattern, index)) groups.at(-1).repeated = true
  }
  return false
}

function regexParts(value, explicitFlags = '') {
  const source = String(value ?? '')
  let pattern = source
  let flags = String(explicitFlags ?? '')
  if (source.startsWith('/')) {
    const slash = source.lastIndexOf('/')
    if (slash > 0) {
      pattern = source.slice(1, slash)
      if (!flags) flags = source.slice(slash + 1)
    }
  }
  if (!pattern || pattern.length > 2000 || !REGEX_FLAGS.test(flags) || potentiallyUnsafeRegex(pattern)) return null
  try {
    return { pattern, flags, expression: new RegExp(pattern, flags) }
  } catch {
    return null
  }
}

function normalizedStages(rule) {
  const stages = list(rule.stages ?? rule.stage).map(String).filter(stage => TRANSFORM_STAGES.has(stage))
  return stages.length ? [...new Set(stages)] : ['model_output', 'display']
}

export function normalizeTransform(rule, index = 0) {
  if (!plainObject(rule)) return null
  const parsed = regexParts(rule.pattern ?? rule.find_regex ?? rule.findRegex ?? rule.regex, rule.flags)
  if (!parsed) return null
  return {
    id: cleanText(rule.id ?? rule.key ?? rule.script_name ?? rule.scriptName, 160) || `transform-${index + 1}`,
    name: cleanText(rule.name ?? rule.script_name ?? rule.scriptName, 200) || `Transform ${index + 1}`,
    pattern: parsed.pattern,
    flags: parsed.flags,
    replacement: String(rule.replacement ?? rule.replace_string ?? rule.replaceString ?? ''),
    stages: normalizedStages(rule),
    actor: cleanText(rule.actor ?? rule.character_id ?? rule.character, 160),
    enabled: rule.enabled !== false && rule.disabled !== true,
    source: cleanText(rule.source, 120) || 'story',
    trim_strings: list(rule.trim_strings ?? rule.trimStrings).map(String).filter(Boolean).slice(0, 100),
    substitute_regex: [0, 1, 2].includes(Number(rule.substitute_regex ?? rule.substituteRegex)) ? Number(rule.substitute_regex ?? rule.substituteRegex) : 0,
    min_depth: (rule.min_depth ?? rule.minDepth) !== undefined && (rule.min_depth ?? rule.minDepth) !== null && Number.isInteger(Number(rule.min_depth ?? rule.minDepth)) ? Number(rule.min_depth ?? rule.minDepth) : null,
    max_depth: (rule.max_depth ?? rule.maxDepth) !== undefined && (rule.max_depth ?? rule.maxDepth) !== null && Number.isInteger(Number(rule.max_depth ?? rule.maxDepth)) ? Number(rule.max_depth ?? rule.maxDepth) : null,
    run_on_edit: rule.run_on_edit === true || rule.runOnEdit === true,
  }
}

function actorMatches(rule, actorId, cast = [], stage = '') {
  if (!rule.actor || rule.actor === 'all' || rule.actor === 'story') return true
  if (rule.actor === actorId) return true
  if (['user_input', 'model_input'].includes(stage) && ['user', 'director'].includes(actorId)) {
    return cast.some(item => [item.character_id, item.character?.slug, item.character?.name].filter(Boolean)
      .some(value => String(value).toLocaleLowerCase() === rule.actor.toLocaleLowerCase()))
  }
  const member = cast.find(item => item.character_id === actorId)
  return [member?.character?.slug, member?.character?.name].filter(Boolean)
    .some(value => String(value).toLocaleLowerCase() === rule.actor.toLocaleLowerCase())
}

function replacementValue(rule, match, captures, groups) {
  let trimmed = match
  for (const value of rule.trim_strings) trimmed = trimmed.split(value).join('')
  return rule.replacement
    .replaceAll('{{match}}', trimmed)
    .replace(/\$\$|\$&|\$(\d{1,2})|\$<([^>]+)>/g, (token, captureIndex, groupName) => {
      if (token === '$$') return '$'
      if (token === '$&') return trimmed
      if (captureIndex) return captures[Number(captureIndex) - 1] ?? ''
      if (groupName) return groups?.[groupName] ?? ''
      return token
    })
}

function transformPattern(rule, macroContext) {
  if (!rule.substitute_regex) return rule.pattern
  return rule.pattern.replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (match, token) => {
    const resolved = macroValue(token, macroContext)
    if (resolved === null) return match
    const value = String(resolved)
    return rule.substitute_regex === 2 ? value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') : value
  })
}

export function applyStoryTransforms(story, stage, value, { actorId = '', cast = [], depth = 0, edited = false, macroContext = {} } = {}) {
  if (!TRANSFORM_STAGES.has(stage)) return String(value ?? '')
  let output = String(value ?? '')
  for (const [index, candidate] of (story?.runtime?.transforms ?? []).entries()) {
    const rule = normalizeTransform(candidate, index)
    if (!rule?.enabled || !rule.stages.includes(stage) || !actorMatches(rule, actorId, cast, stage)) continue
    if (edited && !rule.run_on_edit) continue
    if (rule.min_depth !== null && depth < rule.min_depth) continue
    if (rule.max_depth !== null && depth > rule.max_depth) continue
    const member = cast.find(item => item.character_id === actorId) ?? macroContext.member ?? null
    const parsed = regexParts(transformPattern(rule, { ...macroContext, story, member, character: member?.character }), rule.flags)
    if (!parsed) continue
    output = output.replace(parsed.expression, (...args) => {
      const groups = plainObject(args.at(-1)) ? args.at(-1) : null
      const captureEnd = groups ? args.length - 3 : args.length - 2
      return replacementValue(rule, args[0], args.slice(1, captureEnd), groups)
    })
  }
  return output
}

function macroValue(token, context) {
  const key = token.trim()
  const lower = key.toLocaleLowerCase()
  const character = context.member?.character ?? context.character ?? null
  if (lower === 'char') return character?.name ?? context.actorName ?? ''
  if (lower === 'user') return context.persona?.name ?? 'User'
  if (lower === 'description') return character?.description ?? ''
  if (lower === 'personality') return character?.personality ?? ''
  if (lower === 'scenario') return character?.scenario ?? context.story?.premise ?? ''
  if (lower === 'charprompt') return character?.metadata?.system_prompt ?? ''
  if (lower === 'charinstruction') return character?.speech_style ?? ''
  if (lower === 'charcreatornotes') return character?.creator_notes ?? ''
  if (lower === 'mesexamples' || lower === 'mesexamplesraw') return character?.metadata?.example_dialogue ?? ''
  if (lower === 'charfirstmessage') return character?.first_message ?? ''
  if (lower === 'lastmessage') return context.projection?.messages?.at(-1)?.content ?? ''
  if (lower === 'lastusermessage') return [...(context.projection?.messages ?? [])].reverse().find(item => item.role === 'user')?.content ?? context.userMessage ?? ''
  if (lower === 'lastcharmessage') return [...(context.projection?.messages ?? [])].reverse().find(item => item.role === 'assistant')?.content ?? ''
  if (lower === 'story') return context.story?.title ?? ''
  if (lower === 'scene') return context.projection?.scene?.title ?? ''
  if (lower.startsWith('getvar::')) return getProjectionPath(context.projection ?? {}, key.slice(key.indexOf('::') + 2)) ?? ''
  return null
}

export function expandStoryMacros(value, context = {}) {
  return String(value ?? '').replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (match, token) => {
    const resolved = macroValue(token, context)
    return resolved === null ? match : String(resolved)
  })
}

function keywordMatches(keyword, text, entry = {}) {
  const raw = String(keyword ?? '')
  if (!raw) return false
  const parsed = regexParts(raw)
  if (raw.startsWith('/') && parsed) return parsed.expression.test(text)
  const caseSensitive = entry.case_sensitive === true || entry.caseSensitive === true
  const source = caseSensitive ? String(text) : String(text).toLocaleLowerCase()
  const needle = caseSensitive ? raw : raw.toLocaleLowerCase()
  if (!(entry.match_whole_words === true || entry.matchWholeWords === true || entry.matchWholeWords === 'enabled')) return source.includes(needle)
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  try {
    return new RegExp(`(?<![\\p{L}\\p{N}_])${escaped}(?![\\p{L}\\p{N}_])`, caseSensitive ? 'u' : 'iu').test(String(text))
  } catch {
    return source.includes(needle)
  }
}

function selectiveMatches(entry, secondary, scanText) {
  if (!entry.selective || !secondary.length) return true
  const matches = secondary.map(keyword => keywordMatches(keyword, scanText, entry))
  const logic = entry.selective_logic ?? entry.selectiveLogic ?? 0
  if (logic === 1 || logic === 'not_all') return !matches.every(Boolean)
  if (logic === 2 || logic === 'not_any') return !matches.some(Boolean)
  if (logic === 3 || logic === 'and_all') return matches.every(Boolean)
  return matches.some(Boolean)
}

function loreKeywordEnabled(entry, scanText) {
  const primary = entry.keywords ?? entry.keys ?? []
  if (entry.constant || !primary.length) return { enabled: true, matched: [] }
  const matched = primary.filter(keyword => keywordMatches(keyword, scanText, entry))
  if (!matched.length) return { enabled: false, matched: [] }
  const secondary = entry.secondary_keywords ?? entry.secondary_keys ?? []
  return { enabled: selectiveMatches(entry, secondary, scanText), matched }
}

function loreId(entry, index = 0) {
  return String(entry.id ?? entry.key ?? `${entry.title ?? 'lore'}-${index + 1}`)
}

function activationDistance(entryId, messages) {
  let distance = 0
  const seenTurns = new Set()
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message.role !== 'assistant') continue
    const turnKey = message.metadata?.turn_uid ?? message.event_uid ?? message.event_id ?? index
    if (seenTurns.has(turnKey)) continue
    seenTurns.add(turnKey)
    distance += 1
    if ((message.metadata?.activated_lore_ids ?? []).includes(entryId)) return distance
  }
  return null
}

function deterministicPercent(seed) {
  return Number.parseInt(sha256Hex(seed).slice(0, 8), 16) / 0xffffffff * 100
}

function probabilityAllows(entry, seed) {
  const enabled = entry.use_probability === true || entry.useProbability === true || entry.probability !== undefined
  if (!enabled) return true
  const probability = Math.max(0, Math.min(100, Number(entry.probability ?? 100)))
  return deterministicPercent(`${loreId(entry)}:${seed}`) < probability
}

function scanTextFor(entry, messages, userMessage) {
  const depthValue = entry.scan_depth ?? entry.scanDepth
  const depth = Number.isInteger(Number(depthValue)) ? Math.max(0, Math.min(1000, Number(depthValue))) : 20
  return [...(depth ? messages.slice(-depth) : []).map(message => `${message.actor_id ?? message.role ?? ''}: ${message.content}`), userMessage].join('\n')
}

function characterFilterAllows(entry, cast) {
  const filter = entry.character_filter ?? entry.characterFilter
  if (!plainObject(filter)) return true
  const names = list(filter.names ?? filter.characters).map(value => String(value).trim().toLocaleLowerCase()).filter(Boolean)
  const tags = list(filter.tags).map(value => String(value).trim().toLocaleLowerCase()).filter(Boolean)
  if (!names.length && !tags.length) return true
  const matchingCharacterPresent = cast.filter(member => !member.muted).some(member => {
    const character = member.character ?? {}
    const identities = [member.character_id, character.id, character.slug, character.name]
      .filter(Boolean).map(value => String(value).toLocaleLowerCase())
    const characterTags = list(character.tags).map(value => String(value).toLocaleLowerCase())
    return names.some(name => identities.includes(name)) || tags.some(tag => characterTags.includes(tag))
  })
  const exclude = filter.exclude === true || filter.isExclude === true
  return exclude ? !matchingCharacterPresent : matchingCharacterPresent
}

function chooseGroupEntry(entries, seed) {
  const preferred = entries.some(entry => entry.group_override === true || entry.groupOverride === true)
    ? entries.filter(entry => entry.group_override === true || entry.groupOverride === true)
    : entries
  const weights = preferred.map(entry => Math.max(0, Number(entry.group_weight ?? entry.groupWeight ?? 1)))
  const total = weights.reduce((sum, weight) => sum + weight, 0)
  if (!total) return preferred[0]
  let point = deterministicPercent(`${seed}:${preferred.map(entry => loreId(entry)).join(':')}`) / 100 * total
  for (let index = 0; index < preferred.length; index += 1) {
    point -= weights[index]
    if (point < 0) return preferred[index]
  }
  return preferred.at(-1)
}

export function characterLore(cast = []) {
  return cast.flatMap(member => (member.character?.extensions?.imported_lore ?? []).map((entry, index) => ({
    ...entry,
    id: entry.id || `${member.character.slug || member.character_id}-lore-${index + 1}`,
    owner_id: member.character_id,
    source: 'character-card',
  })))
}

export function storyLoreEntries(story, cast = []) {
  const seen = new Set()
  return [...(story?.lore ?? []), ...characterLore(cast)].filter(entry => {
    const identity = String(entry.id ?? entry.key ?? `${entry.title ?? ''}:${entry.content ?? ''}`)
    if (seen.has(identity)) return false
    seen.add(identity)
    return true
  })
}

export function evaluateStoryLore({ story, cast = [], messages = [], userMessage = '', includeDirector = false } = {}) {
  const entries = storyLoreEntries(story, cast)
  const turnNumber = messages.filter(message => message.role === 'user').length + 1
  const seed = `${turnNumber}:${userMessage}`
  const active = new Map()
  const trace = []

  for (const [index, entry] of entries.entries()) {
    const id = loreId(entry, index)
    let reason = 'keywords_not_matched'
    let matched = []
    const distance = activationDistance(id, messages)
    const sticky = Math.max(0, Number(entry.sticky ?? 0))
    const cooldown = Math.max(0, Number(entry.cooldown ?? 0))
    const delay = Math.max(0, Number(entry.delay ?? 0))
    let enabled = entry.enabled !== false
    if (!characterFilterAllows(entry, cast)) { enabled = false; reason = 'character_filter' }
    else if (entry.visibility === 'director' && !includeDirector) { enabled = false; reason = 'director_only' }
    else if (entry.visibility === 'private' && !includeDirector) { enabled = false; reason = 'private_only' }
    else if (turnNumber <= delay) { enabled = false; reason = 'delayed' }
    else if (enabled && distance !== null && sticky > 0 && distance <= sticky) { reason = 'sticky'; active.set(id, entry) }
    else if (enabled && distance !== null && cooldown > 0 && distance <= cooldown) { enabled = false; reason = 'cooldown' }
    else if (enabled) {
      const keyword = loreKeywordEnabled(entry, scanTextFor(entry, messages, userMessage))
      matched = keyword.matched
      enabled = keyword.enabled
      if (enabled && probabilityAllows(entry, seed)) { reason = entry.constant ? 'constant' : matched.length ? 'keyword' : 'unconditional'; active.set(id, entry) }
      else if (enabled) { enabled = false; reason = 'probability' }
    }
    if (entry.enabled === false) reason = 'disabled'
    trace.push({ id, title: entry.title ?? entry.name ?? id, active: active.has(id), reason, matched_keywords: matched, recursive: false })
  }

  for (let pass = 0; pass < 4; pass += 1) {
    const recursiveText = [...active.entries()]
      .filter(([id, entry]) => entry.prevent_recursion !== true && entry.preventRecursion !== true && trace.find(item => item.id === id)?.reason !== 'sticky')
      .map(([, entry]) => entry.content).join('\n')
    if (!recursiveText) break
    let changed = false
    for (const [index, entry] of entries.entries()) {
      const id = loreId(entry, index)
      const item = trace.find(candidate => candidate.id === id)
      if (active.has(id) || !item || item.reason !== 'keywords_not_matched' || entry.exclude_recursion === true || entry.excludeRecursion === true) continue
      if ((entry.visibility === 'director' || entry.visibility === 'private') && !includeDirector) continue
      const keyword = loreKeywordEnabled(entry, recursiveText)
      if (!keyword.enabled || !probabilityAllows(entry, `${seed}:recursive:${pass}`)) continue
      active.set(id, entry)
      Object.assign(item, { active: true, reason: 'recursive', matched_keywords: keyword.matched, recursive: true })
      changed = true
    }
    if (!changed) break
  }

  const groups = new Map()
  for (const [id, entry] of active) {
    const group = String(entry.group ?? '').trim()
    if (!group) continue
    if (!groups.has(group)) groups.set(group, [])
    groups.get(group).push(entry)
  }
  for (const [group, candidates] of groups) {
    if (candidates.length < 2) continue
    const winner = chooseGroupEntry(candidates, `${seed}:${group}`)
    for (const entry of candidates) {
      if (entry === winner) continue
      const id = loreId(entry, entries.indexOf(entry))
      active.delete(id)
      const item = trace.find(candidate => candidate.id === id)
      Object.assign(item, { active: false, reason: 'group_lost', group, selected_id: loreId(winner, entries.indexOf(winner)) })
    }
  }

  const activated = [...active.values()].sort((left, right) => Number(left.position ?? left.order ?? left.insertion?.order ?? 100) - Number(right.position ?? right.order ?? right.insertion?.order ?? 100))
  return { entries: activated, trace }
}

export function activatedStoryLore(input = {}) {
  return evaluateStoryLore(input).entries
}

function regexScriptStages(script) {
  const placements = list(script.placement).map(Number)
  const stages = new Set()
  if (placements.includes(1)) stages.add('user_input')
  if (placements.includes(2)) {
    if (!script.markdownOnly) stages.add('model_output')
    if (!script.promptOnly) stages.add('display')
  }
  if (placements.includes(5)) stages.add('lore')
  if (!stages.size) {
    stages.add('model_output')
    stages.add('display')
  }
  return [...stages]
}

export function characterCardTransforms(character, actorRef = '') {
  const scripts = character?.extensions?.regex_scripts
    ?? character?.extensions?.regexScripts
    ?? character?.extensions?.sillytavern?.regex_scripts
    ?? []
  return (Array.isArray(scripts) ? scripts : []).map((script, index) => {
    const parsed = regexParts(script.findRegex ?? script.find_regex ?? script.regex, script.flags)
    if (!parsed) return null
    return {
      id: slugify(script.id ?? script.scriptName ?? `regex-${index + 1}`, `regex-${index + 1}`),
      name: cleanText(script.scriptName ?? script.name, 200) || `Regex ${index + 1}`,
      pattern: parsed.pattern,
      flags: parsed.flags,
      replacement: String(script.replaceString ?? script.replace_string ?? ''),
      stages: regexScriptStages(script),
      actor: actorRef,
      enabled: script.disabled !== true,
      source: 'sillytavern-scoped-regex',
      trim_strings: list(script.trimStrings ?? script.trim_strings).map(String).filter(Boolean),
      substitute_regex: [0, 1, 2].includes(Number(script.substituteRegex ?? script.substitute_regex)) ? Number(script.substituteRegex ?? script.substitute_regex) : 0,
      min_depth: (script.minDepth ?? script.min_depth) !== undefined && (script.minDepth ?? script.min_depth) !== null && Number.isInteger(Number(script.minDepth ?? script.min_depth)) ? Number(script.minDepth ?? script.min_depth) : null,
      max_depth: (script.maxDepth ?? script.max_depth) !== undefined && (script.maxDepth ?? script.max_depth) !== null && Number.isInteger(Number(script.maxDepth ?? script.max_depth)) ? Number(script.maxDepth ?? script.max_depth) : null,
      run_on_edit: script.runOnEdit === true || script.run_on_edit === true,
    }
  }).filter(Boolean)
}

export function applyDisplayTransforms(story, messages, cast = []) {
  return (messages ?? []).map((message, index, all) => {
    const participantIds = message.participant_ids ?? message.metadata?.participant_ids ?? []
    const actorId = participantIds.length === 1
      ? participantIds[0]
      : message.actor_id ?? message.character_id ?? ''
    const sceneBlocks = message.scene_blocks ?? message.metadata?.scene_blocks
    const transformedBlocks = Array.isArray(sceneBlocks) ? sceneBlocks.map(block => ({
      ...block,
      content: applyStoryTransforms(story, 'display', block.content, {
        actorId: block.character_id ?? actorId,
        cast,
        depth: all.length - index - 1,
        edited: Boolean(message.metadata?.edited),
      }),
    })) : null
    return {
      ...message,
      content: applyStoryTransforms(story, 'display', message.content, { actorId, cast, depth: all.length - index - 1, edited: Boolean(message.metadata?.edited) }),
      ...(transformedBlocks ? {
        scene_blocks: transformedBlocks,
        metadata: { ...(message.metadata ?? {}), scene_blocks: transformedBlocks },
      } : {}),
    }
  })
}
