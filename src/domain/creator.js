import { assert, cleanText, id, slugify, titleCase, uniqueStrings } from '../util.js'

const CHARACTER_ARCHETYPES = [
  { role: 'The careful expert', trait: 'observant, patient and exacting', goal: 'Understand what others have missed', secret: 'They recognize a detail they are not ready to explain.' },
  { role: 'The guarded outsider', trait: 'resourceful, witty and difficult to read', goal: 'Protect a private obligation', secret: 'They possess something the group is searching for.' },
  { role: 'The responsible guardian', trait: 'calm, protective and burdened by duty', goal: 'Prevent the worst possible consequence', secret: 'They know the official version of events is incomplete.' },
  { role: 'The idealistic challenger', trait: 'bold, empathetic and impatient with half-truths', goal: 'Force an honest choice', secret: 'They have a personal connection to the central conflict.' },
  { role: 'The quiet witness', trait: 'gentle, perceptive and unexpectedly stubborn', goal: 'Keep a promise made before the story began', secret: 'Their memory of a key event differs from everyone else’s.' },
]

function pickTemplate(contributions, kind, templateId) {
  const list = contributions?.[`${kind}_templates`] ?? []
  return list.find(item => item.id === templateId) ?? list[0] ?? { defaults: {} }
}

function deriveTitle(brief, fallback) {
  const first = cleanText(brief, 180).split(/[.!?。！？\n]/)[0].trim()
  if (!first) return fallback
  return titleCase(first.split(/\s+/).slice(0, 8).join(' ')).slice(0, 100) || fallback
}

function characterName(index, genre) {
  const pools = {
    mystery: ['Mara Vale', 'Rowan Ash', 'Lyra Voss', 'Elias Thorn', 'June Mercer'],
    fantasy: ['Seren Vale', 'Kael Ash', 'Iria Voss', 'Tarin Moss', 'Nim Rowan'],
    romance: ['Avery Lane', 'Morgan Bell', 'Rin Harper', 'Sasha Quinn', 'Emery Wells'],
    adventure: ['Mira Stone', 'Rook Calder', 'Tess Arden', 'Vale Kestrel', 'Niko Reed'],
  }
  const key = Object.keys(pools).find(item => String(genre).toLowerCase().includes(item)) ?? 'mystery'
  return pools[key][index % pools[key].length]
}

export class CreatorService {
  constructor({ repository, extensions }) {
    this.repository = repository
    this.extensions = extensions
  }

  generateCharacterDraft(input = {}) {
    const brief = cleanText(input.brief, 10_000)
    assert(brief, 'Describe the character you want to create')
    const template = pickTemplate(this.extensions.contributions(), 'character', input.template_id)
    const defaults = template.defaults ?? {}
    const name = cleanText(input.name, 120) || deriveTitle(brief, 'New character')
    const relationship = cleanText(input.relationship, 300) || 'A character the user can get to know over time'
    const energy = cleanText(input.energy, 100) || 'grounded and engaging'
    const data = {
      name,
      description: `${brief}\n\nDesigned as ${relationship}.`,
      personality: cleanText(input.personality, 5000) || `${defaults.personality || 'Curious, internally consistent and capable of disagreeing respectfully.'} Their emotional tone is ${energy}.`,
      appearance: cleanText(input.appearance, 5000) || 'Leave visual details open for the creator to personalise.',
      scenario: cleanText(input.scenario, 10_000) || `The user meets ${name} at a moment when both have a reason to continue the conversation.`,
      first_message: cleanText(input.first_message, 10_000) || `*${name} looks up, taking a moment to understand who has arrived.* “I was hoping someone would come. What should I call you?”`,
      speech_style: cleanText(input.speech_style, 5000) || defaults.speech_style || 'Natural, distinctive and responsive; avoids repetitive assistant-like phrasing.',
      goals: uniqueStrings(input.goals?.length ? input.goals : ['Learn what matters to the user', 'Pursue an independent goal that can develop across conversations'], 20, 1000),
      secrets: uniqueStrings(input.secrets?.length ? input.secrets : ['There is one part of their past they reveal only when trust and context justify it.'], 20, 2000),
      boundaries: uniqueStrings([...(defaults.boundaries ?? []), ...(input.boundaries ?? []), 'Never narrates the user’s unspoken thoughts, emotions or decisions.'], 20, 2000),
      tags: uniqueStrings([...(defaults.tags ?? []), ...(input.tags ?? []), cleanText(input.relationship, 80)], 20, 80),
      creator_notes: 'Generated as an editable starting point. Review goals, secrets and the first message before publishing.',
      metadata: { creator: { template_id: template.id ?? null, brief, generated_offline: true } },
    }
    return this.repository.saveDraft({ type: 'character', title: name, brief, data })
  }

  generateStoryDraft(input = {}) {
    const brief = cleanText(input.brief, 15_000)
    assert(brief, 'Describe the story you want to create')
    const template = pickTemplate(this.extensions.contributions(), 'story', input.template_id)
    const defaults = template.defaults ?? {}
    const genre = cleanText(input.genre, 300) || defaults.genre || 'Character drama'
    const tone = cleanText(input.tone, 1000) || defaults.tone || 'Immersive, character-led and choice-driven'
    const castSize = Math.max(1, Math.min(5, Number(input.cast_size || defaults.cast_size || 3)))
    const title = cleanText(input.title, 200) || deriveTitle(brief, 'Untitled story')
    const playerRole = cleanText(input.player_role, 5000) || cleanText(defaults.player_role, 5000) || 'A newcomer whose history, thoughts and decisions remain entirely under the user’s control.'
    const castBlueprint = Array.isArray(defaults.cast_blueprint) ? defaults.cast_blueprint : []
    const characters = Array.from({ length: castSize }, (_, index) => {
      const archetype = CHARACTER_ARCHETYPES[index % CHARACTER_ARCHETYPES.length]
      const blueprint = castBlueprint[index] ?? {}
      const sourceCharacter = blueprint.character ?? {}
      const name = cleanText(sourceCharacter.name, 120) || characterName(index, genre)
      return {
        temporary_id: `draft-character-${index + 1}`,
        name,
        description: cleanText(sourceCharacter.description, 10_000) || `${archetype.role} in “${title}”. ${name} has a reason to engage with the player and a life beyond answering questions.`,
        personality: cleanText(sourceCharacter.personality, 10_000) || titleCase(archetype.trait),
        appearance: cleanText(sourceCharacter.appearance, 5000) || 'An editable visual description can be added before publishing.',
        scenario: `They are present when the central situation begins: ${brief}`,
        first_message: `*${name} reacts to the opening situation from their own priorities.* “Before we go any further, there is something we need to settle.”`,
        speech_style: cleanText(sourceCharacter.speech_style, 5000) || (index % 2 === 0 ? 'Measured, specific and observant.' : 'Direct, vivid and willing to leave important things unsaid.'),
        goals: uniqueStrings(sourceCharacter.goals?.length ? sourceCharacter.goals : [archetype.goal, `Reach an outcome in ${title} that reflects their own values`], 20, 1000),
        secrets: uniqueStrings(sourceCharacter.secrets?.length ? sourceCharacter.secrets : [archetype.secret], 20, 2000),
        boundaries: uniqueStrings([...(sourceCharacter.boundaries ?? []), 'Does not know another character’s private context unless it is revealed in the story.', 'Never decides the player’s dialogue, private thoughts or actions.'], 20, 2000),
        tags: uniqueStrings([...(sourceCharacter.tags ?? []), slugify(archetype.role), 'story-cast'], 20, 100),
        metadata: { creator: { generated_offline: true, archetype: archetype.role } },
      }
    })
    const cast = characters.map((character, index) => ({
      ...castBlueprint[index],
      character_id: character.temporary_id,
      source_character_id: undefined,
      character: undefined,
      role: cleanText(castBlueprint[index]?.role, 1000) || CHARACTER_ARCHETYPES[index % CHARACTER_ARCHETYPES.length].role,
      public_context: cleanText(castBlueprint[index]?.public_context, 10_000) || `${character.name} is known to the group by this role. Their current public concern is the opening crisis.`,
      private_context: cleanText(castBlueprint[index]?.private_context, 10_000) || `${character.secrets[0]} They should reveal it only through evidence, choice or earned trust.`,
      metadata: { entrance: index === 0 ? 'opening' : 'present', speaking_priority: index + 1, ...(castBlueprint[index]?.metadata ?? {}) },
    }))
    const generatedScenes = [
      { id: 'opening', title: 'The first disruption', location: 'The story’s central meeting place', time: 'The beginning', objective: 'Let the cast establish different interpretations of the crisis.', active_character_ids: characters.map(item => item.temporary_id) },
      { id: 'pressure', title: 'The cost becomes clear', location: 'A place that reveals a consequence', time: 'Later', objective: 'Introduce evidence that makes the characters’ goals conflict.', active_character_ids: characters.map(item => item.temporary_id) },
      { id: 'choice', title: 'An irreversible choice', location: 'The place where the group must decide', time: 'Before the opportunity closes', objective: 'Offer meaningful outcomes without choosing for the player.', active_character_ids: characters.map(item => item.temporary_id) },
    ]
    const sourceIdToTemporary = new Map(castBlueprint.map((item, index) => [item.source_character_id, characters[index]?.temporary_id]).filter(([source]) => source))
    const remapTemplateIds = value => {
      if (Array.isArray(value)) return value.map(remapTemplateIds)
      if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, typeof child === 'string' && (key.endsWith('_id') || key.endsWith('_ids')) ? sourceIdToTemporary.get(child) ?? child : remapTemplateIds(child)]))
      if (typeof value === 'string') return sourceIdToTemporary.get(value) ?? value
      return value
    }
    const scenes = Array.isArray(defaults.scene_blueprints) && defaults.scene_blueprints.length
      ? remapTemplateIds(structuredClone(defaults.scene_blueprints))
      : generatedScenes
    const data = {
      title,
      hook: cleanText(input.hook, 1000) || `${title}: ${brief.slice(0, 240)}`,
      summary: cleanText(input.summary, 4000) || brief.slice(0, 1000),
      premise: brief,
      genre,
      tone,
      player_role: playerRole,
      opening_scene: cleanText(input.opening_scene, 15_000) || cleanText(defaults.opening_scene, 15_000) || `The normal order of things breaks without warning. Everyone in the room notices a different detail, and no one has enough information to act alone.`,
      world_rules: uniqueStrings(input.world_rules?.length ? input.world_rules : defaults.world_rules?.length ? defaults.world_rules : [
        'The world does not accept an action as successful merely because the user writes that it succeeded.',
        'Characters know only public facts, their own observations and their own private context.',
        'Consequences persist until another event changes them.',
      ], 50, 3000),
      lore: Array.isArray(input.lore) && input.lore.length ? input.lore : [
        { id: 'public-premise', title: 'What everyone knows', content: brief, visibility: 'public', keywords: [] },
        { id: 'director-pressure', title: 'What drives the story forward', content: 'If the scene stalls, reveal a consequence or a clue rather than taking control of the player.', visibility: 'director', keywords: [] },
      ],
      initial_state: { scene: { id: 'opening', title: scenes[0].title, location: scenes[0].location, time: scenes[0].time }, story: { pressure: 0, open_threads: ['What actually caused the disruption?', 'Which character is withholding the most important fact?'] } },
      author_notes: cleanText(input.author_notes, 10_000) || cleanText(defaults.author_notes, 10_000) || 'Keep the story responsive. Use character goals and world consequences to create motion; do not force a predetermined player choice.',
      content_warnings: uniqueStrings(input.content_warnings?.length ? input.content_warnings : defaults.content_warnings, 30, 500),
      tags: uniqueStrings([...(defaults.tags ?? []), ...(input.tags ?? []), genre], 30, 100),
      scenes,
      characters,
      cast,
      visibility: 'private',
      metadata: { creator: { template_id: template.id ?? null, brief, generated_offline: true } },
    }
    return this.repository.saveDraft({ type: 'story', title, brief, data })
  }

  updateDraft(draftId, input = {}) {
    const current = this.repository.getDraft(draftId)
    const data = input.data === undefined ? current.data : structuredClone(input.data)
    return this.repository.saveDraft({
      id: current.id,
      type: current.type,
      title: input.title ?? data.name ?? data.title ?? current.title,
      brief: input.brief ?? current.brief,
      data,
      status: input.status ?? current.status,
    })
  }

  publishDraft(draftId, options = {}) {
    const draft = this.repository.getDraft(draftId)
    if (draft.type === 'character') {
      const character = this.repository.createCharacter(draft.data)
      this.repository.saveDraft({ ...draft, data: { ...draft.data, published_character_id: character.id }, status: 'published' })
      return { type: 'character', character, draft: this.repository.getDraft(draft.id) }
    }
    let story
    let playthrough = null
    this.repository.db.transaction(() => {
      const map = new Map()
      for (const characterData of draft.data.characters ?? []) {
        if (characterData.character_id) {
          const existing = this.repository.getCharacter(characterData.character_id)
          map.set(characterData.temporary_id || existing.id, existing.id)
          continue
        }
        const created = this.repository.createCharacter(characterData)
        map.set(characterData.temporary_id, created.id)
      }
      const remapIds = value => {
        if (Array.isArray(value)) return value.map(remapIds)
        if (value && typeof value === 'object') {
          const output = {}
          for (const [key, child] of Object.entries(value)) output[key] = key.endsWith('_id') && typeof child === 'string' ? map.get(child) ?? child : remapIds(child)
          return output
        }
        return value
      }
      story = this.repository.createStory({
        ...draft.data,
        cast: (draft.data.cast ?? []).map(member => ({ ...member, character_id: map.get(member.character_id) ?? member.character_id })),
        scenes: remapIds(draft.data.scenes ?? []),
      })
      this.repository.saveDraft({ ...draft, data: { ...draft.data, published_story_id: story.id }, status: 'published' })
      if (options.start_playthrough) {
        playthrough = this.repository.createPlaythrough({
          story_id: story.id,
          persona_id: options.persona_id,
          player_role: options.player_role || story.player_role,
          thinking_intensity: options.thinking_intensity || 'auto',
        })
      }
    })
    return { type: 'story', story, playthrough, draft: this.repository.getDraft(draft.id) }
  }
}
