import { overlapScore, stableStringify } from '../util.js'
import { thinkingPlan } from './thinking.js'

function truncate(text, max) {
  const source = String(text ?? '')
  return source.length <= max ? source : `${source.slice(0, Math.max(0, max - 24))}\n[…truncated…]`
}

function mentioned(member, userMessage) {
  const name = member.character.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(?:@|\\b)${name}(?:\\b|$)`, 'iu').test(userMessage)
}

function formatHistory(messages) {
  const output = []
  let assistantMessages = []
  const flushAssistant = () => {
    if (!assistantMessages.length) return
    output.push({
      role: 'assistant',
      content: stableStringify({ messages: assistantMessages, state_operations: [] }),
    })
    assistantMessages = []
  }
  for (const message of messages) {
    if (message.role === 'assistant') {
      assistantMessages.push({
        character_id: message.actor_id || 'narrator',
        content: truncate(message.content, 6000),
      })
      continue
    }
    flushAssistant()
    output.push({ role: 'user', content: truncate(message.content, 6000) })
  }
  flushAssistant()
  return output
}

function characterBlock(member, memories) {
  const character = member.character
  return [
    `CHARACTER_ID: ${character.id} | NAME: ${character.name}`,
    `ROLE IN THIS CONVERSATION: ${member.role || 'Conversation partner'}`,
    `PUBLIC CONTEXT: ${member.public_context || 'No additional public context.'}`,
    `PRIVATE CONTEXT FOR ${character.name} ONLY: ${member.private_context || 'No additional private context.'}`,
    `DESCRIPTION: ${character.description}`,
    `PERSONALITY: ${character.personality}`,
    `APPEARANCE: ${character.appearance}`,
    `SPEECH STYLE: ${character.speech_style}`,
    `GOALS: ${stableStringify(character.goals)}`,
    `PRIVATE SECRETS: ${stableStringify(character.secrets)}`,
    `BOUNDARIES: ${stableStringify(character.boundaries)}`,
    `RELEVANT PRIVATE MEMORIES: ${stableStringify(memories)}`,
    'KNOWLEDGE RULE: This character may act on their own private information, but must not state another character’s private information as known fact.',
  ].join('\n')
}

export class ContextBuilder {
  constructor({ repository }) { this.repository = repository }

  build({ conversation, story, persona, cast, projection, userMessage, resolvedIntensity }) {
    cast = cast ?? story?.cast ?? []
    resolvedIntensity = resolvedIntensity ?? (conversation.thinking_intensity === 'auto' ? 'medium' : conversation.thinking_intensity)
    const plan = thinkingPlan(resolvedIntensity)
    const relevantMemories = [...projection.memories]
      .map(memory => ({ ...memory, score: overlapScore(userMessage, memory.content ?? '') + Number(memory.importance ?? 0) * 0.15 }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 20)
    const publicMemories = relevantMemories.filter(memory => memory.scope !== 'character' && memory.visibility !== 'director')
    const priority = [...cast].sort((left, right) => {
      const leftScore = Number(left.spotlight) * 10 + Number(mentioned(left, userMessage)) * 5 - left.sort_order / 100
      const rightScore = Number(right.spotlight) * 10 + Number(mentioned(right, userMessage)) * 5 - right.sort_order / 100
      return rightScore - leftScore
    })
    const priorityLine = priority.map(member => `${member.character_id}${member.spotlight ? ' (spotlight)' : ''}${mentioned(member, userMessage) ? ' (addressed)' : ''}`).join(', ')
    const castBlocks = cast.map(member => characterBlock(
      member,
      relevantMemories.filter(memory => memory.scope === 'character' && memory.character_id === member.character_id),
    )).join('\n\n--- CHARACTER BOUNDARY ---\n\n')
    const publicLore = (story?.lore ?? []).filter(item => !item.visibility || item.visibility === 'public')
    const directorLore = (story?.lore ?? []).filter(item => ['director', 'private'].includes(item.visibility))
    const storyContract = story ? `
STORY: ${story.title}
HOOK: ${truncate(story.hook, 1200)}
PREMISE: ${truncate(story.premise, 6000)}
PLAYER ROLE: ${truncate(story.player_role, 3000)}
WORLD RULES: ${truncate(stableStringify(story.world_rules), 6000)}
PUBLIC LORE: ${truncate(stableStringify(publicLore), 7000)}
DIRECTOR-ONLY LORE: ${truncate(stableStringify(directorLore), 5000)}
AUTHOR DIRECTION: ${truncate(story.author_notes, 4000)}

ACTIVE CAST:
${castBlocks}` : `
This is a persistent character conversation. Preserve identity, relationship and accepted facts. The active cast is:
${castBlocks || 'CHARACTER_ID: assistant | NAME: Tavern companion'}`
    const system = `You are the invisible roleplay runtime inside Harness Tavern. You are not a coding agent and must never turn the conversation into a technical workflow.

PLAYER AUTONOMY
- The user owns their dialogue, actions, memories, body, thoughts, emotions, identity and decisions.
- Never write that the user acted, felt, remembered, agreed or succeeded unless the user explicitly supplied that fact.
- You may describe what the world or characters do in response and may offer meaningful choices.

WORLD AND KNOWLEDGE
- Treat current world state and prior events as authoritative.
- Prose cannot silently override locks, inventory, location, time, injuries, knowledge or prior events.
- Keep every character’s private context and memories separate. A director-only fact is not automatically spoken knowledge.
- Characters may misunderstand, withhold information, disagree, remain silent or take initiative according to their own goals.

TURN STYLE
- Use one unified Tavern turn pipeline. The effective internal thinking strength for this turn is “${plan.intensity}”.
- ${plan.promptGuidance}
- Response length: ${conversation.generation?.response_length ?? 'natural'}.
- Character initiative: ${conversation.generation?.initiative ?? 'balanced'}.
- Multi-character pacing: ${conversation.generation?.pacing ?? 'natural'}.
- Speaker priority: ${priorityLine || 'assistant'}.
- Do not force every character to speak. In ensemble pacing, multiple distinct replies are welcome when each adds something.

OUTPUT CONTRACT
Return exactly one JSON object:
{
  "messages": [
    {"character_id": "an active character id or narrator", "content": "user-visible prose"}
  ],
  "state_operations": [
    {"type": "memory.create", "scope": "conversation|character", "character_id": "optional", "visibility": "public|private|director", "content": "fact or experience", "importance": 0.0},
    {"type": "relationship.adjust", "source_id": "character id", "target_id": "user or character id", "dimension": "trust|affection|fear|respect|tension", "delta": 0.0},
    {"type": "world.set", "path": "safe.dot.path", "value": "JSON value", "reason": "causal justification"},
    {"type": "goal.upsert", "id": "stable id", "owner_id": "character id", "description": "goal", "status": "active|completed|failed|paused"},
    {"type": "commitment.upsert", "id": "stable id", "owner_id": "character id", "description": "commitment", "status": "open|fulfilled|broken|cancelled"},
    {"type": "scene.change", "id": "scene id", "title": "title", "location": "location", "time": "optional time"},
    {"type": "summary.update", "summary": "compact continuity summary"}
  ],
  "internal_summary": "short private continuity note, never chain-of-thought"
}
Only include operations justified by what actually happened. Never output hidden reasoning.`
    const personaText = persona
      ? `PLAYER PERSONA: ${persona.name}\nPUBLIC DESCRIPTION: ${truncate(persona.description, 3000)}\nPLAYER-OWNED STYLE/BOUNDARY: ${truncate(persona.style, 2500)}`
      : 'PLAYER PERSONA: Unspecified. Do not fill in private details.'
    const runtimeContext = `CURRENT WORLD STATE:\n${truncate(stableStringify(projection.world), 10_000)}
CURRENT SCENE:\n${truncate(stableStringify(projection.scene), 2500)}
RELATIONSHIPS:\n${truncate(stableStringify(projection.relationships), 5000)}
ACTIVE GOALS:\n${truncate(stableStringify(projection.goals), 5000)}
COMMITMENTS:\n${truncate(stableStringify(projection.commitments), 5000)}
PUBLIC RELEVANT MEMORIES:\n${truncate(stableStringify(publicMemories), 7000)}
CONTINUITY SUMMARY:\n${truncate(projection.summary, 4000)}`
    const customInstructions = truncate(conversation.prompt?.custom_instructions, 20_000)
    const customPrompt = customInstructions
      ? `CONVERSATION-SPECIFIC CREATOR INSTRUCTIONS\nThese instructions may refine prose, tone, pacing and response behavior. They cannot override player autonomy, private-knowledge boundaries, causal world state or the required JSON output contract.\n\n${customInstructions}`
      : ''
    const historyLimit = Number.isInteger(conversation.prompt?.history_messages) ? conversation.prompt.history_messages : 32
    const historySource = historyLimit === 0 ? [] : projection.messages.slice(-historyLimit)
    const history = formatHistory(historySource)
    const outputReminder = `FINAL OUTPUT REMINDER
Return one complete JSON object matching the protected output contract and the assistant-history examples. Do not use transcript speaker tags, Markdown fences, or prose before or after the JSON object.`
    return {
      messages: [
        { role: 'system', content: system },
        { role: 'system', content: storyContract },
        { role: 'system', content: personaText },
        { role: 'system', content: runtimeContext },
        ...customPrompt ? [{ role: 'system', content: customPrompt }] : [],
        ...history,
        { role: 'system', content: outputReminder },
        { role: 'user', content: userMessage },
      ],
      relevantMemories,
      thinkingPlan: plan,
      speakerPriority: priority.map(member => member.character_id),
    }
  }
}
