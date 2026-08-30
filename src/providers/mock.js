function systemText(request) {
  return request.messages.filter(message => message.role === 'system').map(message => message.content).join('\n\n')
}

function lastUser(request) {
  return [...request.messages].reverse().find(message => message.role === 'user')?.content ?? ''
}

function jsonAfter(text, marker) {
  const start = text.indexOf(marker)
  if (start < 0) return null
  const line = text.slice(start + marker.length).trimStart().split('\n')[0]
  try { return JSON.parse(line) } catch { return null }
}

function usage(request, completionTokens = 80) {
  const promptTokens = Math.max(120, Math.ceil(request.messages.reduce((sum, item) => sum + item.content.length, 0) / 4))
  const reasoningTokens = request.thinkingIntensity === 'none' ? 0 : 24
  return { promptTokens, completionTokens, reasoningTokens, totalTokens: promptTokens + completionTokens + reasoningTokens, costUsd: 0 }
}

function targetFrom(text) {
  if (/west|西侧|西廊/i.test(text)) return 'west_hall'
  if (/lens|透镜|镜室/i.test(text)) return 'lens_chamber'
  if (/archive|档案/i.test(text)) return 'archive'
  return 'west_hall'
}

function controlPlan(request, contract, userMessage) {
  const characterMatches = [...contract.matchAll(/CHARACTER_ID:\s*([^\s]+)\s*\|\s*NAME:\s*([^\n]+)/g)]
  const cast = characterMatches.map(match => ({ id: match[1], name: match[2].trim() }))
  const registered = new Set([...contract.matchAll(/"key":"([^"]+)"/g)].map(match => match[1]))
  const wantsEnsemble = /\b(all|everyone|each|three|together)\b|所有|每个人|三个人|一起/iu.test(userMessage) || /Multi-character pacing:\s*ensemble/i.test(contract)
  const speakers = cast.length
    ? cast.slice(0, wantsEnsemble ? Math.min(3, cast.length) : 1).map(character => character.id)
    : ['assistant']
  let action
  if (/remember|记住|my name is|我叫/i.test(userMessage)) {
    action = { type: 'remember', actor_id: 'user', parameters: { content: userMessage, visibility: 'public' }, reason: 'The player explicitly asked to preserve a fact.' }
  } else if (/\b(take|pick up|collect)\b|拿起|拾取|捡起/i.test(userMessage) && registered.has('take')) {
    action = { type: 'take', actor_id: 'user', parameters: { item: /key|钥匙/i.test(userMessage) ? 'archive_key' : 'item' }, reason: 'The player explicitly attempts to take an item.' }
  } else if (/unlock|解锁/i.test(userMessage) && registered.has('unlock')) {
    action = { type: 'unlock', actor_id: 'user', parameters: { target: targetFrom(userMessage), tool: /key|钥匙/i.test(userMessage) ? 'archive_key' : 'archive_key' }, reason: 'The player explicitly attempts to unlock a target.' }
  } else if (/\bopen\b|打开/i.test(userMessage) && registered.has('open')) {
    action = { type: 'open', actor_id: 'user', parameters: { target: targetFrom(userMessage) }, reason: 'The player explicitly attempts to open a target.' }
  } else if (/\b(go|move|enter|walk)\b|前往|进入|移动/i.test(userMessage) && registered.has('move')) {
    action = { type: 'move', actor_id: 'user', parameters: { target: targetFrom(userMessage) }, reason: 'The player explicitly attempts to move.' }
  } else if (/look|inspect|observe|查看|观察|检查/i.test(userMessage)) {
    action = { type: 'observe', actor_id: 'user', parameters: { focus: userMessage }, reason: 'The player asks to observe.' }
  } else if (/wait|等待/i.test(userMessage)) {
    action = { type: 'wait', actor_id: 'user', parameters: {}, reason: 'The player waits.' }
  } else {
    action = { type: 'attempt', actor_id: 'user', parameters: { description: userMessage }, reason: 'Free-form input has no more specific registered action.' }
  }
  const agendas = jsonAfter(contract, 'ACTIVE PERSISTENT AGENDAS:\n') ?? {}
  const agendaDecisions = Object.values(agendas).filter(agenda => agenda?.status === 'active').map(agenda => ({
    agenda_id: agenda.id,
    decision: 'defer',
    reason: 'The deterministic mock acknowledges this persistent intent; no independent action is required in this beat.',
  }))
  return {
    actions: [action],
    agenda_decisions: agendaDecisions,
    speakers,
    internal_summary: `Deterministic causal control plan using ${request.thinkingIntensity} thinking intensity.`,
  }
}

function narration(request, contract) {
  const actorMatch = contract.match(/render one user-visible story message for ([^(]+) \(([^)]+)\)/i)
  const actorName = actorMatch?.[1]?.trim() || 'The narrator'
  const receipts = jsonAfter(contract, 'VERIFIED ACTION RECEIPTS:\n') ?? []
  const observations = jsonAfter(contract, 'OBSERVATIONS AVAILABLE TO THIS SPEAKER:\n') ?? []
  const rejected = receipts.find(receipt => receipt.status === 'rejected' || receipt.outcome === 'rejected')
  const changed = receipts.reduce((sum, receipt) => sum + Number(receipt.changed_fact_count ?? 0), 0)
  const observed = observations.map(item => item.content).filter(Boolean).join(' ')
  const content = rejected
    ? `*${actorName} watches the attempt meet the world's resistance.* “${rejected.reason}”`
    : changed
      ? `*${actorName} responds to what verifiably changed.* ${observed || 'The scene settles into its new, recorded state.'}`
      : `*${actorName} answers without inventing a result.* ${observed || 'The attempt is acknowledged, but no unverified fact changes.'}`
  return { content }
}

export class MockAdapter {
  async complete(request) {
    const contract = systemText(request)
    const envelope = /control planner inside Harness Tavern/i.test(contract)
      ? controlPlan(request, contract, lastUser(request))
      : narration(request, contract)
    return {
      content: JSON.stringify(envelope),
      finishReason: 'stop',
      usage: usage(request),
      raw: envelope,
      requestBody: { model: request.model, messages: request.messages },
    }
  }

  async listModels() {
    return [
      { id: 'mock/roleplay-ensemble', name: 'Built-in Causal Ensemble Model', contextLength: 32_000, supportedParameters: ['reasoning', 'structured_output'] },
      { id: 'mock/chat', name: 'Built-in Causal Chat Model', contextLength: 16_000, supportedParameters: ['structured_output'] },
    ]
  }
}
