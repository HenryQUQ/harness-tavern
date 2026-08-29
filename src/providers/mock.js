export class MockAdapter {
  async complete(request) {
    const last = [...request.messages].reverse().find(message => message.role === 'user')?.content ?? ''
    const contract = request.messages.filter(message => message.role === 'system').map(message => message.content).join('\n\n')
    const characterMatches = [...contract.matchAll(/CHARACTER_ID:\s*([^\s]+)\s*\|\s*NAME:\s*([^\n]+)/g)]
    const cast = characterMatches.map(match => ({ id: match[1], name: match[2].trim() }))
    const priorityMatch = contract.match(/Speaker priority:\s*([^\n]+)/i)
    const priority = priorityMatch?.[1].split(',').map(item => item.trim().split(/\s+/)[0]) ?? []
    const ordered = [...cast].sort((a, b) => {
      const ai = priority.indexOf(a.id)
      const bi = priority.indexOf(b.id)
      return (ai < 0 ? 999 : ai) - (bi < 0 ? 999 : bi)
    })
    const wantsEnsemble = /\b(all|everyone|each|three|together)\b|所有|每个人|三个人|一起/iu.test(last) || /Multi-character pacing:\s*ensemble/i.test(contract)
    const selected = ordered.length ? ordered.slice(0, wantsEnsemble ? Math.min(3, ordered.length) : 1) : [{ id: 'assistant', name: 'Tavern companion' }]
    const blocked = /door|门|lock|锁|sealed|封印/i.test(last)
    const messages = selected.map((character, index) => ({
      character_id: character.id,
      content: index === 0
        ? `*${character.name} takes the request seriously before answering.* “${last.slice(0, 120) || 'You have my attention.'}” ${blocked ? 'The sealed mechanism does not yield merely because the attempt was declared; its condition still has to be resolved.' : 'The response follows from the current relationship and scene rather than resetting them.'}`
        : `*${character.name} offers a distinct reaction, careful not to borrow knowledge from anyone else.*`,
    }))
    const stateOperations = []
    if (/remember|记住|my name is|我叫/i.test(last)) stateOperations.push({ type: 'memory.create', scope: 'conversation', visibility: 'public', content: last.slice(0, 500), importance: 0.7 })
    if (blocked && /open|enter|walk through|打开|进入|穿过/i.test(last)) stateOperations.push({ type: 'summary.update', summary: 'The user tested a sealed route; the world did not silently grant success.' })
    const envelope = {
      messages,
      state_operations: stateOperations,
      internal_summary: `Deterministic mock turn using ${request.thinkingIntensity} effective thinking intensity.`,
    }
    return {
      content: JSON.stringify(envelope),
      finishReason: 'stop',
      usage: {
        promptTokens: 120,
        completionTokens: 80,
        reasoningTokens: request.thinkingIntensity === 'none' ? 0 : 24,
        totalTokens: request.thinkingIntensity === 'none' ? 200 : 224,
        costUsd: 0,
      },
      raw: envelope,
      requestBody: { model: request.model, messages: request.messages },
    }
  }

  async listModels() {
    return [
      { id: 'mock/roleplay-ensemble', name: 'Built-in Ensemble Test Model', contextLength: 32_000, supportedParameters: ['reasoning'] },
      { id: 'mock/chat', name: 'Built-in Chat Test Model', contextLength: 16_000, supportedParameters: [] },
    ]
  }
}
