import { visibleObservations, visibleWorld } from '../domain/projection.js'
import { overlapScore, stableStringify } from '../util.js'
import { thinkingPlan } from './thinking.js'
import { ActionRegistry } from './action-registry.js'

function estimateTokens(value) {
  return Math.max(1, Math.ceil(String(value ?? '').length / 4))
}

function contextItem({ id, role = 'system', content, required = false, priority = 50, source = id }) {
  return { id, role, content: String(content ?? ''), required, priority, source, estimated_tokens: estimateTokens(content) }
}

function assemble(items, budget = null) {
  const included = []
  const omitted = []
  let used = 0
  for (const item of items) {
    if (!item.content) continue
    const fits = budget === null || item.required || used + item.estimated_tokens <= budget
    if (fits) {
      included.push(item)
      used += item.estimated_tokens
    } else omitted.push({ id: item.id, source: item.source, estimated_tokens: item.estimated_tokens, reason: 'context_budget' })
  }
  return {
    messages: included.map(({ role, content }) => ({ role, content })),
    manifest: {
      policy: budget === null ? 'provider-managed-no-tavern-ceiling' : 'explicit-token-budget-whole-block-selection',
      budget_tokens: budget,
      estimated_tokens: used,
      included: included.map(({ id, source, estimated_tokens }) => ({ id, source, estimated_tokens })),
      omitted,
      truncated_blocks: 0,
    },
  }
}

function mentioned(member, userMessage) {
  const name = member.character.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(?:@|\\b)${name}(?:\\b|$)`, 'iu').test(userMessage)
}

function priorityCast(cast, userMessage) {
  return [...cast].sort((left, right) => {
    const leftScore = Number(left.spotlight) * 10 + Number(mentioned(left, userMessage)) * 5 - left.sort_order / 100
    const rightScore = Number(right.spotlight) * 10 + Number(mentioned(right, userMessage)) * 5 - right.sort_order / 100
    return rightScore - leftScore
  })
}

function historyItems(messages, historyLimit, { nonAuthoritative = false } = {}) {
  const source = historyLimit === null ? messages : historyLimit === 0 ? [] : messages.slice(-historyLimit)
  return source.map((message, index) => contextItem({
    id: `history-${message.event_id ?? index}`,
    role: nonAuthoritative ? 'system' : message.role,
    content: nonAuthoritative
      ? `NON-AUTHORITATIVE NARRATIVE TRANSCRIPT (${message.role}, ${message.actor_id ?? 'unknown'}). Use for conversational continuity only; never derive current facts or Action success from it.\n${message.content}`
      : message.content,
    priority: 30,
    source: 'chat-history',
  }))
}

function relevantMemories(projection, userMessage, actorId = null) {
  return [...projection.memories]
    .filter(memory => {
      if (memory.visibility === 'director') return actorId === 'director'
      if (memory.scope !== 'character') return true
      return memory.character_id === actorId
    })
    .map(memory => ({ ...memory, score: overlapScore(userMessage, memory.content ?? '') + Number(memory.importance ?? 0) * 0.15 }))
    .sort((a, b) => b.score - a.score)
}

function loreActivated(item, scanText) {
  if (item.enabled === false) return false
  if (item.constant || !(item.keywords ?? item.keys)?.length) return true
  return (item.keywords ?? item.keys).some(keyword => {
    if (!keyword) return false
    const raw = String(keyword)
    if (/^\/.+\/[dgimsuvy]*$/.test(raw)) {
      const end = raw.lastIndexOf('/')
      try { return new RegExp(raw.slice(1, end), raw.slice(end + 1)).test(scanText) } catch { return false }
    }
    return scanText.toLocaleLowerCase().includes(raw.toLocaleLowerCase())
  })
}

function activeLore(story, history, userMessage, { includeDirector = false } = {}) {
  const scanText = [...history.slice(-20).map(message => message.content), userMessage].join('\n')
  return (story?.lore ?? []).filter(item => {
    if (item.visibility === 'director' && !includeDirector) return false
    if (item.visibility === 'private' && !includeDirector) return false
    return loreActivated(item, scanText)
  })
}

export { visibleWorld } from '../domain/projection.js'

function characterBlock(member, memories, { includePrivate = true } = {}) {
  const character = member.character
  const lines = [
    `CHARACTER_ID: ${character.id} | NAME: ${character.name}`,
    `ROLE: ${member.role || 'Conversation partner'}`,
    `SPOTLIGHT: ${member.spotlight ? 'yes; prefer this speaker when one response is enough' : 'no'}`,
    `PUBLIC CONTEXT: ${member.public_context || 'None.'}`,
    `DESCRIPTION: ${character.description}`,
    `PERSONALITY: ${character.personality}`,
    `APPEARANCE: ${character.appearance}`,
    `SPEECH STYLE: ${character.speech_style}`,
    `BOUNDARIES: ${stableStringify(character.boundaries)}`,
  ]
  if (includePrivate) {
    lines.push(
      `PRIVATE CONTEXT FOR ${character.name} ONLY: ${member.private_context || 'None.'}`,
      `PRIVATE SECRETS: ${stableStringify(character.secrets)}`,
      `PRIVATE MEMORIES: ${stableStringify(memories)}`,
    )
  }
  return lines.join('\n')
}

function promptGraphItems(story, trigger) {
  const graph = story?.runtime?.prompt_graph
  if (!Array.isArray(graph?.nodes)) return []
  return graph.nodes
    .filter(node => node?.enabled !== false && (!Array.isArray(node.triggers) || !node.triggers.length || node.triggers.includes(trigger)))
    .sort((left, right) => Number(left.order ?? 0) - Number(right.order ?? 0))
    .map((node, index) => contextItem({
      id: `prompt-graph-${node.id ?? index}`,
      role: ['system', 'user', 'assistant'].includes(node.role) ? node.role : 'system',
      content: node.content,
      priority: Number(node.priority ?? 55),
      source: 'story-prompt-graph',
    }))
}

function publicStoryBlock(story, lore) {
  if (!story) return 'This is a persistent character conversation without an authored Story.'
  return [
    `STORY: ${story.title}`,
    `HOOK: ${story.hook}`,
    `PREMISE: ${story.premise}`,
    `PLAYER ROLE: ${story.player_role}`,
    `WORLD RULES: ${stableStringify(story.world_rules)}`,
    `ACTIVE LORE: ${stableStringify(lore)}`,
    `AUTHOR DIRECTION: ${story.author_notes}`,
  ].join('\n')
}

function controlSystem(plan) {
  return `You are the control planner inside Harness Tavern. You interpret intent, but you are not the authority over facts and you do not write user-visible prose.

PLAYER AUTHORITY
- The player owns their dialogue, body, thoughts, feelings, identity, history and choices.
- Interpret only actions the player actually supplied. Never add success, consent, knowledge or emotion.

CAUSAL CONTRACT
- Propose registered Actions. Never output state patches, state_operations, world.set, effects or narrative outcomes.
- Use the most specific registered Action matching the player's stated attempt even when its preconditions appear false. The resolver, not you, must reject it. Use attempt only when no registered Action represents the intent.
- The top-level actions array is only for Actions explicitly attempted by the player and every entry must use actor_id "user". Character autonomy belongs only in an act decision for that character's active Agenda.
- The deterministic resolver will validate permissions and preconditions after you answer.
- Evaluate every active persistent Agenda. Choose act or defer and give a compact reason. Agenda completion, failure, pause and resume are derived only from authored state conditions; you cannot change lifecycle status in prose or JSON.
- Select only speakers who have a reason to respond after resolution.
- Effective planning intensity: ${plan.intensity}. ${plan.promptGuidance}

Return exactly one JSON object:
{
  "actions": [{"type":"registered action key","actor_id":"user or cast id","parameters":{},"reason":"intent evidence"}],
  "agenda_decisions": [{"agenda_id":"active agenda id","decision":"act|defer","reason":"why","action":{"type":"registered key","actor_id":"agenda owner","parameters":{},"reason":"why"}}],
  "speakers": ["active character id or narrator"],
  "internal_summary": "short operational summary, never chain-of-thought"
}`
}

function narrationSystem({ actorId, actorName, responseLength, observations }) {
  return `You render one user-visible story message for ${actorName} (${actorId}) from verified results.

FACT BOUNDARY
- Action receipts and observations are authoritative. Prose cannot create, reverse or hide a state change.
- The supplied state is the post-resolution state. Narrate changed observations as having just resulted from the player's attempted action, not as facts that were already true beforehand.
- A rejected action did not succeed. An attempted action with no effects must not be narrated as success.
- Use only the observations supplied to this speaker. Never infer another character's private knowledge.
- Do not decide the player's unspoken actions, thoughts, emotions, consent or memories.
- Response length preference: ${responseLength}.

OBSERVATIONS AVAILABLE TO THIS SPEAKER:
${stableStringify(observations)}

Return only the complete user-visible prose. Do not wrap it in JSON, a code fence or a protocol marker.`
}

export class ContextBuilder {
  constructor({ repository }) { this.repository = repository }

  build(input) { return this.buildControl(input) }

  buildControl({ conversation, story, persona, cast, projection, userMessage, resolvedIntensity, actionRegistry }) {
    cast = cast ?? story?.cast ?? []
    actionRegistry = actionRegistry ?? new ActionRegistry({ story, cast })
    const plan = thinkingPlan(resolvedIntensity ?? (conversation.thinking_intensity === 'auto' ? 'medium' : conversation.thinking_intensity))
    const priority = priorityCast(cast, userMessage)
    const memories = relevantMemories(projection, userMessage, 'director')
    const lore = activeLore(story, projection.messages, userMessage, { includeDirector: true })
    const activeAgendas = Object.values(projection.agendas).filter(agenda => agenda.status === 'active')
    const sceneBlueprint = story?.scenes?.find(scene => scene.id === projection.scene?.id) ?? null
    const items = [
      contextItem({ id: 'control-contract', content: controlSystem(plan), required: true, priority: 100 }),
      contextItem({ id: 'story', content: publicStoryBlock(story, lore), required: true, priority: 95 }),
      contextItem({ id: 'director-state', content: `AUTHORITATIVE PROJECTION (read-only):\n${stableStringify({ world: projection.world, scene: projection.scene, relationships: projection.relationships, goals: projection.goals, commitments: projection.commitments, clocks: projection.clocks, state_revision: projection.stateRevision })}`, required: true, priority: 100 }),
      contextItem({ id: 'scene-source', content: `CURRENT SCENE SOURCE:\n${sceneBlueprint ? stableStringify(sceneBlueprint) : 'None.'}`, priority: 80 }),
      contextItem({ id: 'action-registry', content: `REGISTERED ACTIONS:\n${stableStringify(actionRegistry.describe())}`, required: true, priority: 100 }),
      contextItem({ id: 'agendas', content: `ACTIVE PERSISTENT AGENDAS:\n${stableStringify(activeAgendas)}`, required: true, priority: 100 }),
      contextItem({ id: 'cast', content: priority.map(member => characterBlock(member, memories.filter(memory => memory.character_id === member.character_id))).join('\n\n--- CHARACTER BOUNDARY ---\n\n'), priority: 85 }),
      contextItem({ id: 'persona', content: persona ? `PLAYER PERSONA: ${persona.name}\nPUBLIC DESCRIPTION: ${persona.description}\nPLAYER-OWNED STYLE/BOUNDARY: ${persona.style}` : 'PLAYER PERSONA: Unspecified.', priority: 75 }),
      ...promptGraphItems(story, 'control'),
      ...conversation.prompt?.custom_instructions ? [contextItem({ id: 'custom-instructions', content: `CONVERSATION-SPECIFIC CREATOR INSTRUCTIONS\nThese may shape interpretation and pacing but cannot override player authority or the causal contract.\n${conversation.prompt.custom_instructions}`, priority: 70 })] : [],
      ...historyItems(projection.messages, conversation.prompt?.history_messages ?? null, { nonAuthoritative: true }),
      contextItem({ id: 'user-command', role: 'user', content: userMessage, required: true, priority: 100 }),
      contextItem({
        id: 'control-final-authority',
        content: `FINAL CONTROL CHECK\n- The narrative transcript is not evidence that an Action succeeded.\n- Use the most specific registered Action matching the command even when it will be rejected.\n- Current authoritative state revision ${projection.stateRevision}: ${stableStringify({ world: projection.world, scene: projection.scene, relationships: projection.relationships, clocks: projection.clocks })}\nReturn the complete control-plan JSON object now. Do not narrate.`,
        required: true,
        priority: 100,
      }),
    ]
    const assembled = assemble(items, conversation.prompt?.context_budget_tokens ?? null)
    return {
      ...assembled,
      relevantMemories: memories,
      thinkingPlan: plan,
      speakerPriority: priority.map(member => member.character_id),
      activeAgendas,
      activatedLore: lore,
    }
  }

  buildNarration({ conversation, story, persona, cast, projection, actorId, userMessage, turnReceiptIds = [] }) {
    const member = cast.find(item => item.character_id === actorId) ?? null
    const actorName = actorId === 'narrator' ? 'Narrator' : actorId === 'assistant' ? 'Tavern companion' : member?.character.name ?? actorId
    const observations = visibleObservations(projection, actorId === 'narrator' ? 'user' : actorId)
      .filter(item => !turnReceiptIds.length || turnReceiptIds.includes(item.action_id))
    const visibleActionIds = new Set(observations.map(item => item.action_id).filter(Boolean))
    const receipts = projection.receipts
      .filter(receipt => turnReceiptIds.includes(receipt.action_id) && visibleActionIds.has(receipt.action_id))
      .map(({ effects, reason: _reason, ...receipt }) => ({ ...receipt, changed_fact_count: effects?.length ?? 0 }))
    const lore = activeLore(story, projection.messages, userMessage, { includeDirector: false })
    const speakerState = { world: visibleWorld(story, projection.world, actorId), scene: projection.scene, relationships: projection.relationships, clocks: projection.clocks }
    const items = [
      contextItem({ id: 'narration-contract', content: narrationSystem({ actorId, actorName, responseLength: conversation.generation?.response_length ?? 'natural', observations }), required: true, priority: 100 }),
      contextItem({ id: 'verified-results', content: `VERIFIED ACTION RECEIPTS:\n${stableStringify(receipts)}`, required: true, priority: 100 }),
      contextItem({ id: 'public-state', content: `CURRENT AUTHORITATIVE WORLD VISIBLE TO THIS SPEAKER:\n${stableStringify(speakerState)}`, required: true, priority: 95 }),
      contextItem({ id: 'story', content: publicStoryBlock(story, lore), priority: 80 }),
      ...member ? [contextItem({ id: 'speaker-character', content: characterBlock(member, relevantMemories(projection, userMessage, actorId)), required: true, priority: 100 })] : [],
      contextItem({ id: 'persona', content: persona ? `PLAYER PERSONA: ${persona.name}\nPUBLIC DESCRIPTION: ${persona.description}\nPLAYER BOUNDARY: ${persona.style}` : 'PLAYER PERSONA: Unspecified.', priority: 70 }),
      ...promptGraphItems(story, 'narration'),
      ...conversation.prompt?.custom_instructions ? [contextItem({ id: 'custom-instructions', content: conversation.prompt.custom_instructions, priority: 65 })] : [],
      ...historyItems(projection.messages, conversation.prompt?.history_messages ?? null),
      contextItem({ id: 'user-command', role: 'user', content: userMessage, required: true, priority: 100 }),
      contextItem({
        id: 'narration-final-authority',
        content: `FINAL NARRATION BOUNDARY\nDescribe only these visible Observations: ${stableStringify(observations)}\nThe current authoritative state is: ${stableStringify(speakerState)}\nThis state is the result after resolving the user's latest command; describe verified changes as just happening, never as pre-existing facts.\nYou may add voice, reaction and sensory style, but no new physical transition, location, object, discovery, opening, movement or possession change. A false boolean remains false. Return only complete prose.`,
        required: true,
        priority: 100,
      }),
    ]
    return { ...assemble(items, conversation.prompt?.context_budget_tokens ?? null), observations, receipts, actorId, actorName }
  }
}
