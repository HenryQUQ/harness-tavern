import { visibleObservations, visibleWorld } from '../domain/projection.js'
import { overlapScore, stableStringify } from '../util.js'
import { thinkingPlan } from './thinking.js'
import { ActionRegistry } from './action-registry.js'
import {
  characterDisclosureCatalog,
  characterPerformanceBrief,
  initialCharacterRuntimeState,
  normalizeCharacterRuntimeConfig,
  privateFragmentsNotDisclosed,
} from './character-runtime.js'
import { activatedStoryLore, applyStoryTransforms, expandStoryMacros } from './story-runtime.js'
import { rankRelevant, vectorSimilarity } from './retrieval.js'

function estimateTokens(value, calibratedRatio = null) {
  const source = String(value ?? '')
  if (calibratedRatio) return Math.max(1, Math.ceil(source.length * calibratedRatio))
  const nonAscii = (source.match(/[^\x00-\x7f]/g) ?? []).length
  const ascii = source.length - nonAscii
  return Math.max(1, Math.ceil(ascii / 4 + nonAscii * 0.85))
}

function contextItem({ id, role = 'system', content, required = false, priority = 50, source = id }) {
  return { id, role, content: String(content ?? ''), required, priority, source }
}

function assemble(items, budget = null, calibratedRatio = null) {
  const included = []
  const omitted = []
  let used = 0
  for (const sourceItem of items) {
    const item = { ...sourceItem, estimated_tokens: estimateTokens(sourceItem.content, calibratedRatio) }
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

function recalledHistoryItems(messages, historyLimit, userMessage) {
  if (historyLimit === null || historyLimit === 0 || messages.length <= historyLimit) return []
  const older = messages.slice(0, -historyLimit)
  return rankRelevant(older, userMessage, { limit: 8, minimum: 0.04 })
    .sort((left, right) => left.index - right.index)
    .map(({ item, score }) => contextItem({
      id: `recalled-history-${item.event_id ?? item.event_uid}`,
      content: `RECALLED EARLIER NARRATIVE (${item.role}, ${item.actor_id ?? 'unknown'}, relevance ${score.toFixed(3)}). This is continuity evidence, not authoritative causal state.\n${item.content}`,
      priority: 42,
      source: 'retrieved-history',
    }))
}

function attachmentItems(attachments = []) {
  if (!attachments.length) return []
  const manifest = attachments.map(item => ({
    id: item.id,
    filename: item.filename,
    mime_type: item.mime_type,
    byte_size: item.byte_size,
    delivery: item.delivery ?? 'metadata_only',
  }))
  const extracted = attachments.filter(item => item.extracted_text).map(item => `FILE ${item.filename} (${item.mime_type})\n${item.extracted_text}`).join('\n\n--- ATTACHMENT BOUNDARY ---\n\n')
  return [
    contextItem({
      id: 'attachment-manifest',
      content: `PLAYER ATTACHMENTS\n${stableStringify(manifest)}\nOnly describe visual or audio details when the provider supplied inline media. Items marked metadata_only expose filename and type only; never invent their contents.`,
      required: true,
      priority: 100,
      source: 'attachments',
    }),
    ...extracted ? [contextItem({ id: 'attachment-text', content: `EXTRACTED TEXT ATTACHMENTS\n${extracted}`, required: true, priority: 100, source: 'attachments' })] : [],
  ]
}

function relevantMemories(projection, userMessage, actorId = null) {
  return [...projection.memories]
    .filter(memory => {
      if (memory.visibility === 'director') return actorId === 'director'
      if (memory.scope !== 'character') return true
      return memory.character_id === actorId
    })
    .map(memory => ({
      ...memory,
      score: Math.max(overlapScore(userMessage, memory.content ?? ''), vectorSimilarity(userMessage, memory.content ?? ''))
        + Number(memory.importance ?? 0) * 0.15,
    }))
    .sort((a, b) => b.score - a.score)
}

export { visibleWorld } from '../domain/projection.js'

function characterBlock(member, memories, { includePrivate = true, macroContext = {} } = {}) {
  const character = member.character
  const expand = value => expandStoryMacros(value, { ...macroContext, member, character })
  const lines = [
    `CHARACTER_ID: ${character.id} | NAME: ${character.name}`,
    `ROLE: ${member.role || 'Conversation partner'}`,
    `SPOTLIGHT: ${member.spotlight ? 'yes; prioritize this Character as a scene participant or focus' : 'no'}`,
    `PUBLIC CONTEXT: ${expand(member.public_context) || 'None.'}`,
    `DESCRIPTION: ${expand(character.description)}`,
    `APPEARANCE: ${expand(character.appearance)}`,
    `BOUNDARIES: ${stableStringify(character.boundaries)}`,
  ]
  if (includePrivate) {
    lines.push(
      `PERSONALITY: ${expand(character.personality)}`,
      `SPEECH STYLE / POST-HISTORY INSTRUCTIONS: ${expand(character.speech_style)}`,
      `CHARACTER AUTHOR PROMPT: ${expand(character.metadata?.system_prompt) || 'None.'}`,
      `CHARACTER NOTE: ${expand(character.metadata?.character_note?.content ?? character.metadata?.character_note) || 'None.'}`,
      `EXAMPLE DIALOGUE: ${expand(character.metadata?.example_dialogue) || 'None.'}`,
      `PRIVATE CONTEXT FOR ${character.name} ONLY: ${expand(member.private_context) || 'None.'}`,
      `PRIVATE SECRETS: ${stableStringify(character.secrets)}`,
      `PRIVATE MEMORIES: ${stableStringify(memories)}`,
    )
  }
  return lines.join('\n')
}

function promptGraphItems(story, trigger, macroContext = {}) {
  const graph = story?.runtime?.prompt_graph
  const nodes = Array.isArray(graph?.nodes) ? graph.nodes : []
  const automationPrompts = (story?.runtime?.automations ?? [])
    .filter(item => item?.enabled !== false && item?.prompt && (!item.trigger || item.trigger === trigger || item.trigger === `prompt.${trigger}`))
    .map((item, index) => ({ ...item, id: item.id ?? item.key ?? `automation-prompt-${index + 1}`, content: item.prompt }))
  return [...nodes, ...automationPrompts]
    .filter(node => node?.enabled !== false && (!Array.isArray(node.triggers) || !node.triggers.length || node.triggers.includes(trigger)))
    .sort((left, right) => Number(left.order ?? 0) - Number(right.order ?? 0))
    .map((node, index) => contextItem({
      id: `prompt-graph-${node.id ?? index}`,
      role: ['system', 'user', 'assistant'].includes(node.role) ? node.role : 'system',
      content: expandStoryMacros(node.content, macroContext),
      priority: Number(node.priority ?? 55),
      source: node.prompt ? 'story-automation-prompt' : 'story-prompt-graph',
    }))
}

function publicStoryBlock(story, lore, macroContext = {}) {
  if (!story) return 'This conversation has no authored Story.'
  const expand = value => expandStoryMacros(value, macroContext)
  return [
    `STORY: ${story.title}`,
    `HOOK: ${expand(story.hook)}`,
    `PREMISE: ${expand(story.premise)}`,
    `PLAYER ROLE: ${expand(story.player_role)}`,
    `WORLD RULES: ${stableStringify((story.world_rules ?? []).map(expand))}`,
    `ACTIVE LORE: ${stableStringify(lore.map(item => ({
      ...item,
      content: applyStoryTransforms(story, 'lore', expand(item.content), { actorId: macroContext.actorId ?? 'narrator', cast: macroContext.cast ?? [], macroContext }),
    })))}`,
    `AUTHOR DIRECTION: ${expand(story.author_notes)}`,
  ].join('\n')
}

function runtimeInput(story, assembled, { actorId, cast }) {
  return {
    ...assembled,
    messages: assembled.messages.map((message, index, all) => ({
      ...message,
      content: applyStoryTransforms(story, 'model_input', message.content, { actorId, cast, depth: all.length - index - 1 }),
    })),
  }
}

function controlSystem(plan) {
  return `You are the control planner inside Harness Tavern. You interpret intent, but you are not the authority over facts and you do not write user-visible prose.

PLAYER AUTHORITY
- The player owns their dialogue, body, thoughts, feelings, identity, history and choices.
- Interpret only actions the player actually supplied. Never add success, consent, knowledge or emotion.

CAUSAL CONTRACT
- Propose registered Actions. Never output state patches, state_operations, world.set, effects or narrative outcomes.
- Use the most specific registered Action matching the player's stated attempt even when its preconditions appear false. The resolver, not you, must reject it. Use attempt only when no registered Action represents the intent.
- The actions array is only for Actions explicitly attempted by the player and every entry must use actor_id "user". Character autonomy is evaluated later by isolated Character runtimes.
- The deterministic resolver will validate permissions and preconditions after you answer.
- Select only Characters who are materially present in, directly addressed by, or causally relevant to the next story beat.
- Participants are context for the Storyteller. They are not a roll call and do not all need to speak or react.
- Do not select the complete Cast by default. An empty participant list is valid when the world alone responds.
- Effective planning intensity: ${plan.intensity}. ${plan.promptGuidance}

Return exactly one JSON object:
{
  "actions": [{"type":"registered action key","actor_id":"user","parameters":{},"reason":"intent evidence"}],
  "participants": ["relevant active character id"],
  "internal_summary": "short operational summary, never chain-of-thought"
}`
}

function characterSystem({ member, config }) {
  return `You are the isolated Character runtime for ${member.character.name} (${member.character_id}) inside Harness Tavern. Decide only this Character's inner response and intended contribution to the next beat. You do not narrate the scene and you never decide the player or another Character.

ISOLATION AND AUTHORITY
- You may use this Character's private file, own memories, own beliefs, actor-visible facts and own active Agendas.
- You have not seen any other Character's private context. Never infer that private knowledge exists.
- Authoritative facts come only from the supplied world state and Observations. Propose an Action; never claim its success.
- Player dialogue, body, thoughts, feelings, consent, identity, history and choices belong to the player.
- Initiative mode is ${config.initiative}: reactive responds when directly engaged; balanced may contribute when materially relevant; proactive may initiate a useful beat without stealing player agency.
- A Character can remain silent. Do not manufacture a reaction just to fill a roster.
- Do not write final dialogue. If speaking is warranted, provide the speech act's meaning and disclosure IDs; the Storyteller will realize the wording in one coherent scene.
- Private facts may be revealed only by listing their exact IDs in speech_act.disclose, following this reveal policy: ${config.reveal_policy}

Return exactly one JSON object:
{
  "character_id": "${member.character_id}",
  "participation": "act|speak|react|observe|remain_silent",
  "perceived_event_ids": ["only IDs supplied in actor-visible observations"],
  "belief_updates": [{"id":"stable belief id","subject":"topic","claim":"what this Character now believes","confidence":0.0,"source_event_ids":[]}],
  "emotional_state": {"tone":"brief public-facing tone","tension":0.0,"warmth":0.0,"resolve":0.0},
  "relationship_shifts": [{"target_id":"user or cast id","dimension":"trust","delta":0.0,"reason":"brief reason"}],
  "intent": "private motivation for the Storyteller, not exposition",
  "agenda_decisions": [{"agenda_id":"this Character's active agenda","decision":"act|defer","reason":"why","action":{"type":"registered action","parameters":{},"reason":"why"}}],
  "spontaneous_actions": [{"type":"registered action","parameters":{},"reason":"why"}],
  "speech_act": {"kind":"statement|question|warning|offer|refusal|other","meaning":"semantic intent, not polished dialogue","disclose":["authorized private fact id"]},
  "public_cue": "one short externally perceptible cue, or empty"
}`
}

function narrationSystem({ participants, responseLength, observations }) {
  const participantSummary = participants.length
    ? participants.map(member => `${member.character.name} (${member.character_id})`).join(', ')
    : 'No Character is required in this beat'
  return `You are the Storyteller inside Harness Tavern. Render exactly one continuous, user-visible story beat from verified results.

STORYTELLING CONTRACT
- Continue the scene as prose, naturally combining setting, action, atmosphere and dialogue.
- Do not answer once per Character. Do not enumerate reactions or make every present Character speak.
- Dialogue is optional. Use zero, one, or several Characters only when the scene genuinely calls for it.
- The selected participants are possibilities, not mandatory speakers: ${participantSummary}.
- Maintain a single coherent narrative voice even when more than one Character appears.
- Address the player's latest contribution by advancing the immediate dramatic beat rather than holding a group roll call.

FACT BOUNDARY
- Action receipts and observations are authoritative. Prose cannot create, reverse or hide a state change.
- The supplied state is the post-resolution state. Narrate changed observations as having just resulted from the player's attempted action, not as facts that were already true beforehand.
- A rejected action did not succeed. An attempted action with no effects must not be narrated as success.
- Use only player-visible observations for factual claims.
- Character Performance Briefs are already isolated and filtered. Follow each chosen participation and speech act. Never give dialogue to a Character whose speech_act is null.
- Private motivation is writer-only. Only facts listed under authorized_disclosures may be exposed through narration or dialogue.
- Do not decide the player's unspoken actions, thoughts, emotions, consent or memories.
- Keep the player's body at the exact boundary established by their latest message. Never add second-person movement, posture, object interaction, speech, thought, feeling, memory, or choice unless that same kind of act was explicitly authored by the player.
- Response length preference: ${responseLength}.

PLAYER-VISIBLE OBSERVATIONS AVAILABLE TO THE STORYTELLER:
${stableStringify(observations)}

SCENE BLOCK CONTRACT
- Return exactly one JSON object with a "blocks" array.
- Each block is one of {"type":"narration","content":"..."}, {"type":"action","character_id":"participant id","content":"externally visible action or reaction"}, or {"type":"dialogue","character_id":"participant id","content":"spoken words only"}.
- Use narration blocks for setting and transitions. Action and dialogue blocks preserve Character identity inside the single Storyteller beat.
- Do not include markdown quote marks, speaker names or protocol labels inside dialogue content.

Return only the JSON object: {"blocks":[...]}`
}

export class ContextBuilder {
  constructor({ repository, retrievalIndex = null }) {
    this.repository = repository
    this.retrievalIndex = retrievalIndex
  }

  #tokenRatio(conversation) {
    if (!conversation?.model_id) return null
    const rows = this.repository.db.raw.prepare(`
      SELECT prompt_tokens, raw_json FROM usage_ledger
      WHERE model_id = ? AND prompt_tokens > 0
      ORDER BY id DESC LIMIT 12
    `).all(conversation.model_id)
    let promptTokens = 0
    let promptCharacters = 0
    for (const row of rows) {
      let raw = {}
      try { raw = JSON.parse(row.raw_json) } catch {}
      if (!Number(raw.promptCharacters)) continue
      promptTokens += Number(row.prompt_tokens)
      promptCharacters += Number(raw.promptCharacters)
    }
    if (!promptCharacters) return null
    return Math.max(0.12, Math.min(1.25, promptTokens / promptCharacters))
  }

  build(input) { return this.buildControl(input) }

  buildControl({ conversation, story, persona, cast, projection, userMessage, resolvedIntensity, actionRegistry, attachments = [] }) {
    cast = cast ?? story?.cast ?? []
    actionRegistry = actionRegistry ?? new ActionRegistry({ story, cast })
    const plan = thinkingPlan(resolvedIntensity ?? (conversation.thinking_intensity === 'auto' ? 'medium' : conversation.thinking_intensity))
    const priority = priorityCast(cast, userMessage)
    const memories = relevantMemories(projection, userMessage, 'director')
    const macroContext = { story, persona, projection, userMessage, cast, actorId: 'director' }
    const lore = activatedStoryLore({ story, cast, messages: projection.messages, userMessage, includeDirector: true })
    const activeAgendas = Object.values(projection.agendas).filter(agenda => agenda.status === 'active' && agenda.visibility === 'public')
    const sceneBlueprint = story?.scenes?.find(scene => scene.id === projection.scene?.id) ?? null
    const items = [
      contextItem({ id: 'control-contract', content: controlSystem(plan), required: true, priority: 100 }),
      contextItem({ id: 'story', content: publicStoryBlock(story, lore, macroContext), required: true, priority: 95 }),
      contextItem({ id: 'director-state', content: `AUTHORITATIVE PROJECTION (read-only):\n${stableStringify({ world: projection.world, scene: projection.scene, relationships: projection.relationships, goals: projection.goals, commitments: projection.commitments, clocks: projection.clocks, state_revision: projection.stateRevision })}`, required: true, priority: 100 }),
      contextItem({ id: 'scene-source', content: `CURRENT SCENE SOURCE:\n${sceneBlueprint ? stableStringify(sceneBlueprint) : 'None.'}`, priority: 80 }),
      contextItem({ id: 'action-registry', content: `REGISTERED ACTIONS:\n${stableStringify(actionRegistry.describe())}`, required: true, priority: 100 }),
      contextItem({ id: 'agendas', content: `PUBLIC ACTIVE CHARACTER INTENTS (selection context only; isolated Character runtimes decide them):\n${stableStringify(activeAgendas)}`, priority: 82 }),
      ...projection.summary ? [contextItem({ id: 'continuity-summary', content: `DURABLE CONTINUITY SUMMARY\nThis is a compact player-visible record of earlier beats. Authoritative state below wins on conflict.\n${projection.summary}`, required: true, priority: 92, source: 'continuity-summary' })] : [],
      contextItem({ id: 'cast', content: priority.map(member => characterBlock(member, [], { includePrivate: false, macroContext })).join('\n\n--- PUBLIC CHARACTER BOUNDARY ---\n\n'), priority: 85 }),
      contextItem({ id: 'persona', content: persona ? `PLAYER PERSONA: ${persona.name}\nPUBLIC DESCRIPTION: ${persona.description}\nPLAYER-OWNED STYLE/BOUNDARY: ${persona.style}` : 'PLAYER PERSONA: Unspecified.', priority: 75 }),
      ...promptGraphItems(story, 'control', macroContext),
      ...conversation.prompt?.custom_instructions ? [contextItem({ id: 'custom-instructions', content: `CONVERSATION-SPECIFIC CREATOR INSTRUCTIONS\nThese may shape interpretation and pacing but cannot override player authority or the causal contract.\n${conversation.prompt.custom_instructions}`, priority: 70 })] : [],
      ...recalledHistoryItems(projection.messages, conversation.prompt?.history_messages ?? null, userMessage),
      ...historyItems(projection.messages, conversation.prompt?.history_messages ?? null, { nonAuthoritative: true }),
      ...attachmentItems(attachments),
      contextItem({ id: 'user-command', role: 'user', content: userMessage, required: true, priority: 100 }),
      contextItem({
        id: 'control-final-authority',
        content: `FINAL CONTROL CHECK\n- The narrative transcript is not evidence that an Action succeeded.\n- Use the most specific registered Action matching the command even when it will be rejected.\n- Current authoritative state revision ${projection.stateRevision}: ${stableStringify({ world: projection.world, scene: projection.scene, relationships: projection.relationships, clocks: projection.clocks })}\nReturn the complete control-plan JSON object now. Do not narrate.`,
        required: true,
        priority: 100,
      }),
    ]
    const assembled = runtimeInput(story, assemble(items, conversation.prompt?.context_budget_tokens ?? null, this.#tokenRatio(conversation)), { actorId: 'director', cast })
    return {
      ...assembled,
      relevantMemories: memories,
      thinkingPlan: plan,
      participantPriority: priority.map(member => member.character_id),
      activeAgendas: [],
      activatedLore: lore,
    }
  }

  buildCharacter({ conversation, story, persona, cast, projection, member, userMessage, turnReceiptIds = [], attachments = [], actionRegistry = null }) {
    actionRegistry = actionRegistry ?? new ActionRegistry({ story, cast })
    const actorId = member.character_id
    const config = normalizeCharacterRuntimeConfig(member)
    const currentState = projection.characterStates?.[actorId] ?? initialCharacterRuntimeState(member)
    const observations = visibleObservations(projection, actorId)
      .filter(item => !turnReceiptIds.length || turnReceiptIds.includes(item.action_id))
      .slice(-80)
    const allowedEventIds = [...new Set(observations.flatMap(item => [item.id, item.event_id]).filter(value => value !== undefined && value !== null).map(String))]
    const activeAgendas = Object.values(projection.agendas).filter(agenda => agenda.status === 'active' && agenda.owner_id === actorId)
    const ownMemories = relevantMemories(projection, userMessage, actorId)
    const disclosureCatalog = characterDisclosureCatalog(member)
    const macroContext = { story, persona, projection, userMessage, member, character: member.character, cast, actorId }
    const lore = activatedStoryLore({ story, cast: [member], messages: projection.messages, userMessage, includeDirector: false })
    const otherCast = cast.filter(candidate => candidate.character_id !== actorId).map(candidate => ({
      character_id: candidate.character_id,
      name: candidate.character.name,
      role: candidate.role,
      public_context: candidate.public_context,
      presence: projection.characterStates?.[candidate.character_id]?.presence ?? normalizeCharacterRuntimeConfig(candidate).initial_presence,
    }))
    const items = [
      contextItem({ id: 'character-contract', content: characterSystem({ member, config }), required: true, priority: 100 }),
      contextItem({ id: 'own-character-file', content: characterBlock(member, ownMemories, { includePrivate: true, macroContext }), required: true, priority: 100 }),
      contextItem({ id: 'actor-runtime-config', content: `AUTHORED CHARACTER RUNTIME PROFILE:\n${stableStringify(config)}`, required: true, priority: 100 }),
      contextItem({ id: 'disclosure-catalog', content: `PRIVATE DISCLOSURE CATALOG\nOnly this Character can authorize these IDs. Listing an ID in speech_act.disclose allows the Storyteller to reveal its content in this beat.\n${stableStringify(disclosureCatalog)}`, required: true, priority: 100 }),
      contextItem({ id: 'own-runtime-state', content: `THIS CHARACTER'S PERSISTENT INNER STATE:\n${stableStringify(currentState)}`, required: true, priority: 100 }),
      contextItem({ id: 'actor-visible-state', content: `AUTHORITATIVE STATE VISIBLE TO THIS CHARACTER:\n${stableStringify({ world: visibleWorld(story, projection.world, actorId), scene: projection.scene, relationships: projection.relationships, clocks: projection.clocks, state_revision: projection.stateRevision })}`, required: true, priority: 100 }),
      contextItem({ id: 'actor-observations', content: `ACTOR-VISIBLE OBSERVATIONS (perceived_event_ids must come from id or event_id here):\n${stableStringify(observations)}`, required: true, priority: 100 }),
      contextItem({ id: 'own-agendas', content: `THIS CHARACTER'S ACTIVE PERSISTENT AGENDAS:\n${stableStringify(activeAgendas)}`, required: true, priority: 100 }),
      contextItem({ id: 'available-actions', content: `REGISTERED ACTIONS THIS CHARACTER MAY PROPOSE (the resolver decides success):\n${stableStringify(actionRegistry.describe())}`, required: true, priority: 95 }),
      contextItem({ id: 'other-public-cast', content: `OTHER CAST — PUBLIC INFORMATION ONLY:\n${stableStringify(otherCast)}`, priority: 78 }),
      contextItem({ id: 'story', content: publicStoryBlock(story, lore, macroContext), priority: 78 }),
      contextItem({ id: 'persona', content: persona ? `PLAYER PERSONA: ${persona.name}\nPUBLIC DESCRIPTION: ${persona.description}\nPLAYER-OWNED BOUNDARY: ${persona.style}` : 'PLAYER PERSONA: Unspecified.', priority: 75 }),
      ...projection.summary ? [contextItem({ id: 'continuity-summary', content: `DURABLE PLAYER-VISIBLE CONTINUITY SUMMARY\n${projection.summary}`, priority: 80 })] : [],
      ...promptGraphItems(story, 'character', macroContext),
      ...recalledHistoryItems(projection.messages, conversation.prompt?.history_messages ?? null, userMessage),
      ...historyItems(projection.messages, conversation.prompt?.history_messages ?? null),
      ...attachmentItems(attachments),
      contextItem({ id: 'user-command', role: 'user', content: userMessage, required: true, priority: 100 }),
      contextItem({ id: 'character-final-authority', content: `FINAL CHARACTER CHECK\nYou are ${member.character.name} (${actorId}), and no one else. Decide this Character's participation from only the private file and actor-visible evidence above. Remain silent when that is the honest choice. Return the complete JSON plan now; do not narrate.`, required: true, priority: 100 }),
    ]
    return {
      ...runtimeInput(story, assemble(items, conversation.prompt?.context_budget_tokens ?? null, this.#tokenRatio(conversation)), { actorId, cast }),
      member,
      currentState,
      activeAgendas,
      observations,
      allowedEventIds,
      disclosureCatalog,
      activatedLore: lore,
    }
  }

  buildNarration({ conversation, story, persona, cast, projection, participantIds = null, characterPlans = [], actorId = null, userMessage, turnReceiptIds = [], attachments = [] }) {
    // `actorId` keeps direct callers from older integrations compatible. The
    // visible result is nevertheless always a Storyteller beat.
    const selectedIds = participantIds ?? (actorId && !['narrator', 'assistant'].includes(actorId) ? [actorId] : [])
    const selectedSet = new Set(selectedIds)
    const participants = cast.filter(member => selectedSet.has(member.character_id))
    const plansById = new Map(characterPlans.map(plan => [plan.character_id, plan]))
    const observations = visibleObservations(projection, 'user')
      .filter(item => !turnReceiptIds.length || turnReceiptIds.includes(item.action_id))
    const visibleActionIds = new Set(observations.map(item => item.action_id).filter(Boolean))
    const receipts = projection.receipts
      .filter(receipt => turnReceiptIds.includes(receipt.action_id) && visibleActionIds.has(receipt.action_id))
      .map(({ effects, reason: _reason, ...receipt }) => ({ ...receipt, changed_fact_count: effects?.length ?? 0 }))
    const macroContext = { story, persona, projection, userMessage, member: participants[0] ?? null, actorName: 'Storyteller', cast, actorId: 'narrator' }
    const lore = activatedStoryLore({ story, cast, messages: projection.messages, userMessage, includeDirector: false })
    const speakerState = { world: visibleWorld(story, projection.world, 'user'), scene: projection.scene, relationships: projection.relationships, clocks: projection.clocks }
    const performanceBriefs = participants
      .filter(member => plansById.has(member.character_id))
      .map(member => characterPerformanceBrief(member, plansById.get(member.character_id), receipts))
    const protectedPrivateFragments = participants.flatMap(member => privateFragmentsNotDisclosed(member, plansById.get(member.character_id)))
    const items = [
      contextItem({ id: 'narration-contract', content: narrationSystem({ participants, responseLength: conversation.generation?.response_length ?? 'natural', observations }), required: true, priority: 100 }),
      contextItem({ id: 'verified-results', content: `VERIFIED ACTION RECEIPTS:\n${stableStringify(receipts)}`, required: true, priority: 100 }),
      contextItem({ id: 'public-state', content: `CURRENT AUTHORITATIVE WORLD VISIBLE TO THE PLAYER:\n${stableStringify(speakerState)}`, required: true, priority: 95 }),
      contextItem({ id: 'story', content: publicStoryBlock(story, lore, macroContext), priority: 80 }),
      ...projection.summary ? [contextItem({ id: 'continuity-summary', content: `DURABLE CONTINUITY SUMMARY\n${projection.summary}`, required: true, priority: 92, source: 'continuity-summary' })] : [],
      ...performanceBriefs.length ? [contextItem({
        id: 'character-performance-briefs',
        content: `ISOLATED CHARACTER PERFORMANCE BRIEFS\nThese are decisions already made by separate Character runtimes. Realize them without inventing additional Character knowledge, decisions or speech.\n${stableStringify(performanceBriefs)}`,
        required: true,
        priority: 100,
      })] : [],
      contextItem({ id: 'persona', content: persona ? `PLAYER PERSONA: ${persona.name}\nPUBLIC DESCRIPTION: ${persona.description}\nPLAYER BOUNDARY: ${persona.style}` : 'PLAYER PERSONA: Unspecified.', priority: 70 }),
      ...promptGraphItems(story, 'narration', macroContext),
      ...conversation.prompt?.custom_instructions ? [contextItem({ id: 'custom-instructions', content: conversation.prompt.custom_instructions, priority: 65 })] : [],
      ...recalledHistoryItems(projection.messages, conversation.prompt?.history_messages ?? null, userMessage),
      ...historyItems(projection.messages, conversation.prompt?.history_messages ?? null),
      ...attachmentItems(attachments),
      contextItem({ id: 'user-command', role: 'user', content: userMessage, required: true, priority: 100 }),
      contextItem({
        id: 'narration-final-authority',
        content: `FINAL STORYTELLER BOUNDARY\nWrite one coherent story continuation as Scene Blocks, not separate Character replies. No Character is required to speak.\nDescribe only these visible Observations as factual changes: ${stableStringify(observations)}\nFollow only these Character decisions: ${stableStringify(performanceBriefs)}\nThe current authoritative state is: ${stableStringify(speakerState)}\nThis state is the result after resolving the user's latest command; describe verified changes as just happening, never as pre-existing facts.\nYou may add voice, reaction and sensory style, but no new physical transition, location, object, discovery, opening, movement or possession change. Keep the player exactly where and as they left themselves; never add unrequested second-person action, speech, thought, feeling, memory, decision, or movement. A false boolean remains false. Return only the complete JSON Scene Block object.`,
        required: true,
        priority: 100,
      }),
    ]
    return {
      ...runtimeInput(story, assemble(items, conversation.prompt?.context_budget_tokens ?? null, this.#tokenRatio(conversation)), { actorId: 'narrator', cast }),
      observations,
      receipts,
      actorId: 'narrator',
      actorName: 'Storyteller',
      participantIds: participants.map(member => member.character_id),
      characterPlans,
      performanceBriefs,
      protectedPrivateFragments,
      activatedLore: lore,
    }
  }
}
