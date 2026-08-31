import test from 'node:test'
import assert from 'node:assert/strict'
import { reduceEvents } from '../src/domain/projection.js'
import { activatedStoryLore, applyDisplayTransforms, applyStoryTransforms, characterCardTransforms, evaluateStoryLore, expandStoryMacros, normalizeTransform, storyLoreEntries } from '../src/runtime/story-runtime.js'
import { jsonRequest, testApp } from './helpers.js'

test('a SillyTavern Character Card becomes a complete single-cast Story', async t => {
  const { app } = await testApp(t)
  const card = {
    spec: 'chara_card_v3',
    spec_version: '3.0',
    data: {
      name: 'Aster',
      description: 'Keeper of the Moon Gate.',
      personality: 'Patient and exact.',
      scenario: 'The player arrives at the sealed observatory.',
      first_mes: 'The gate is waiting, {{user}}.',
      mes_example: '<START>\n{{user}}: What is this place?\n{{char}}: A promise with hinges.',
      system_prompt: 'Protect player agency and speak as {{char}}.',
      alternate_greetings: ['The second bell rings for {{user}}.'],
      extensions: {
        depth_prompt: { prompt: 'Remember the silver key.', depth: 4, role: 'system' },
        regex_scripts: [{ scriptName: 'Moon glyph', findRegex: 'MOON', replaceString: 'LUNA', placement: [1, 2, 5] }],
      },
      character_book: {
        entries: [{ id: 1, comment: 'Moon Gate', content: 'The Moon Gate opens only for a silver key.', keys: ['gate'], keysecondary: ['silver'], selective: true, order: 20 }],
      },
    },
  }

  const preview = app.sharing.preview(card)
  assert.equal(preview.kind, 'story')
  assert.equal(preview.counts.stories, 1)
  assert.equal(preview.counts.actors, 1)

  const imported = app.sharing.import(card, { strategy: 'copy', source_name: 'Aster card' })
  assert.equal(imported.result.stories.length, 1)
  const story = imported.result.stories[0]
  assert.equal(story.cast.length, 1)
  assert.equal(story.cast[0].character.metadata.system_prompt, 'Protect player agency and speak as {{char}}.')
  assert.match(story.cast[0].character.metadata.example_dialogue, /promise with hinges/)
  assert.deepEqual(story.cast[0].character.metadata.alternate_greetings, ['The second bell rings for {{user}}.'])
  assert.equal(story.runtime.transforms.length, 1)
  assert.equal(story.lore[0].selective, true)
  assert.equal(storyLoreEntries(story, story.cast).length, 1)

  const created = app.repository.createPlaythrough({ story_id: story.id, route: { opening_greeting_index: 1 } })
  const messages = reduceEvents(app.repository.events(created.conversation.id), story.initial_state).messages
  assert.equal(messages.at(-1).content, 'The second bell rings for User.')

  const cast = app.repository.listConversationCast(created.conversation.id)
  const projection = reduceEvents(app.repository.events(created.conversation.id), story.initial_state)
  const actorContext = app.contextBuilder.buildCharacter({
    conversation: created.conversation,
    story: app.repository.getStory(story.id),
    persona: null,
    cast,
    projection,
    member: cast[0],
    userMessage: 'I place the silver key at the gate.',
    turnReceiptIds: [],
  })
  const context = actorContext.messages.map(message => message.content).join('\n')
  assert.match(context, /Protect player agency and speak as Aster/)
  assert.match(context, /A promise with hinges/)
  assert.match(context, /Moon Gate opens only for a silver key/)
  assert.match(context, /Remember the silver key/)
})

test('Story runtime applies scoped transforms, macros, and selective actor lore', () => {
  const cast = [{
    character_id: 'actor_aster',
    character: {
      name: 'Aster',
      slug: 'aster',
      description: '', personality: '', scenario: '', first_message: '', speech_style: '', creator_notes: '',
      metadata: {},
      extensions: { imported_lore: [{ id: 'key-lore', title: 'Key', content: 'The key is warm.', keywords: ['key'], secondary_keywords: ['silver'], selective: true }] },
    },
  }]
  const story = {
    title: 'The Gate',
    lore: [],
    runtime: {
      transforms: [
        { id: 'input', pattern: 'MOON', flags: 'g', replacement: 'LUNA', stages: ['user_input'], actor: 'actor_aster' },
        { id: 'output', pattern: 'secret', flags: 'gi', replacement: 'whisper', stages: ['model_output', 'display'], actor: 'actor_aster' },
      ],
    },
  }
  assert.equal(applyStoryTransforms(story, 'user_input', 'MOON MOON', { actorId: 'user', cast }), 'LUNA LUNA')
  assert.equal(applyStoryTransforms(story, 'model_output', 'A Secret', { actorId: 'actor_aster', cast }), 'A whisper')
  assert.equal(applyStoryTransforms(story, 'model_output', 'A Secret', { actorId: 'someone_else', cast }), 'A Secret')
  assert.equal(applyDisplayTransforms(story, [{ actor_id: 'actor_aster', content: 'secret' }], cast)[0].content, 'whisper')
  assert.equal(expandStoryMacros('{{char}} welcomes {{user}} to {{story}}.', { story, member: cast[0], persona: { name: 'Lin' } }), 'Aster welcomes Lin to The Gate.')
  assert.equal(activatedStoryLore({ story, cast, userMessage: 'I found a key.' }).length, 0)
  assert.equal(activatedStoryLore({ story, cast, userMessage: 'I found a silver key.' })[0].content, 'The key is warm.')
})

test('Story Runtime rejects regex forms with catastrophic backtracking risk', () => {
  assert.equal(normalizeTransform({ pattern: '(a+)+$', replacement: '' }), null)
  assert.equal(normalizeTransform({ pattern: '(a|aa)+$', replacement: '' }), null)
  assert.equal(normalizeTransform({ pattern: '(a)\\1+', replacement: '' }), null)
  assert.ok(normalizeTransform({ pattern: '(?:rain|snow)+', flags: 'gi', replacement: 'weather' }))
})

test('SillyTavern Regex compatibility preserves placement, macro, trim, capture, depth, and edit semantics', () => {
  const cast = [{ character_id: 'aster', character: { id: 'aster', name: 'Aster.1', slug: 'aster-1', tags: [] } }]
  const converted = characterCardTransforms({
    extensions: {
      regex_scripts: [{
        scriptName: 'Lore only', findRegex: 'MOON', replaceString: 'LUNA', placement: [5],
      }],
    },
  }, 'aster')
  assert.deepEqual(converted[0].stages, ['lore'])

  const story = {
    runtime: {
      transforms: [
        {
          id: 'macro-trim', pattern: '^{{char}}: (.+)$', flags: 'g', replacement: '$1|{{match}}',
          stages: ['model_output'], actor: 'aster', substitute_regex: 2, trim_strings: ['Aster.1: '],
        },
        { id: 'depth', pattern: 'rain', flags: 'g', replacement: 'mist', stages: ['display'], min_depth: 1, max_depth: 1 },
        { id: 'edit', pattern: 'draft', flags: 'g', replacement: 'edited', stages: ['display'], run_on_edit: true },
      ],
    },
  }
  assert.equal(applyStoryTransforms(story, 'model_output', 'Aster.1: hello', { actorId: 'aster', cast }), 'hello|hello')
  const displayed = applyDisplayTransforms(story, [
    { actor_id: 'narrator', content: 'rain draft' },
    { actor_id: 'narrator', content: 'rain draft', metadata: { edited: true } },
  ], cast)
  assert.equal(displayed[0].content, 'mist edited')
  assert.equal(displayed[1].content, 'rain edited')
})

test('SillyTavern lore compatibility evaluates recursion, groups, timing, probability, and Character filters with a trace', () => {
  const cast = [
    { character_id: 'aster', muted: false, character: { id: 'aster', name: 'Aster', slug: 'aster', tags: ['keeper'] } },
    { character_id: 'cass', muted: true, character: { id: 'cass', name: 'Cass', slug: 'cass', tags: ['courier'] } },
  ]
  const story = {
    lore: [
      { id: 'seed', content: 'The cobalt archive lies below.', keywords: ['gate'] },
      { id: 'recursive', content: 'Archive lamps burn blue.', keywords: ['cobalt'] },
      { id: 'excluded-recursion', content: 'Must stay dormant.', keywords: ['cobalt'], exclude_recursion: true },
      { id: 'group-a', content: 'First weather.', constant: true, group: 'weather', group_override: true },
      { id: 'group-b', content: 'Second weather.', constant: true, group: 'weather' },
      { id: 'never', content: 'Never selected.', constant: true, use_probability: true, probability: 0 },
      { id: 'keeper-only', content: 'Keeper context.', constant: true, character_filter: { names: ['Aster'] } },
      { id: 'muted-courier', content: 'Muted courier context.', constant: true, character_filter: { tags: ['courier'] } },
      { id: 'delayed', content: 'Later.', constant: true, delay: 1 },
    ],
  }
  const first = evaluateStoryLore({ story, cast, userMessage: 'I touch the gate.' })
  assert.ok(first.entries.some(entry => entry.id === 'seed'))
  assert.ok(first.entries.some(entry => entry.id === 'recursive'))
  assert.equal(first.entries.some(entry => entry.id === 'excluded-recursion'), false)
  assert.ok(first.entries.some(entry => entry.id === 'group-a'))
  assert.equal(first.entries.some(entry => entry.id === 'group-b'), false)
  assert.equal(first.entries.some(entry => entry.id === 'never'), false)
  assert.ok(first.entries.some(entry => entry.id === 'keeper-only'))
  assert.equal(first.entries.some(entry => entry.id === 'muted-courier'), false)
  assert.equal(first.entries.some(entry => entry.id === 'delayed'), false)
  assert.equal(first.trace.find(item => item.id === 'recursive').reason, 'recursive')
  assert.equal(first.trace.find(item => item.id === 'group-b').reason, 'group_lost')
  assert.equal(first.trace.find(item => item.id === 'muted-courier').reason, 'character_filter')

  const timingStory = { lore: [{ id: 'timed', content: 'Timed.', keywords: ['bell'], sticky: 2, cooldown: 3 }] }
  const prior = [{ role: 'assistant', content: 'Earlier.', metadata: { turn_uid: 'one', activated_lore_ids: ['timed'] } }]
  assert.equal(evaluateStoryLore({ story: timingStory, cast, messages: prior, userMessage: 'silence' }).trace[0].reason, 'sticky')
  const afterSticky = [
    ...prior,
    { role: 'assistant', content: 'Next.', metadata: { turn_uid: 'two', activated_lore_ids: [] } },
    { role: 'assistant', content: 'Again.', metadata: { turn_uid: 'three', activated_lore_ids: [] } },
  ]
  assert.equal(evaluateStoryLore({ story: timingStory, cast, messages: afterSticky, userMessage: 'silence' }).trace[0].reason, 'cooldown')
})

test('the Story workspace creates and edits its own multi-actor Cast and Runtime', async t => {
  const { app, baseUrl } = await testApp(t)
  const created = await jsonRequest(baseUrl, '/api/library/items', {
    method: 'POST',
    body: JSON.stringify({
      kind: 'story',
      content: {
        title: 'Harbour at Dusk',
        cast: [{ character: { name: 'Iona', first_message: 'The tide remembers.' }, client_id: 'draft-iona', role: 'Harbour keeper' }],
      },
    }),
  })
  assert.equal(created.response.status, 201)
  const storyId = created.body.item.id
  assert.equal(created.body.item.cast[0].character.name, 'Iona')

  const opened = await jsonRequest(baseUrl, `/api/creator/stories/${storyId}`)
  const firstActor = opened.body.story.cast[0]
  const updated = await jsonRequest(baseUrl, `/api/creator/stories/${storyId}`, {
    method: 'PUT',
    body: JSON.stringify({
      expected_digest: opened.body.binding.digest,
      story: {
        title: 'Harbour at Dusk',
        opening_scene: '',
        cast: [
          { character_id: firstActor.character_id, character: { ...firstActor.character, personality: 'Unhurried.' }, role: 'Harbour keeper' },
          { client_id: 'draft-cass', character: { name: 'Cass', first_message: 'You are late.', metadata: { system_prompt: 'Use clipped sentences.' } }, role: 'Courier' },
        ],
        scenes: [{ id: 'pier', title: 'The Pier', active_character_ids: [firstActor.character_id, 'draft-cass'] }],
        runtime: {
          transforms: [{ id: 'rain', name: 'Rain', pattern: 'rain', flags: 'gi', replacement: 'drizzle', stages: ['display'], actor: 'story', enabled: true }],
          automations: [{ id: 'weather', key: 'weather', name: 'Weather', trigger: 'narration', prompt: 'Keep the harbour weather present.', enabled: true }],
        },
      },
    }),
  })
  assert.equal(updated.response.status, 200)
  assert.equal(updated.body.story.cast.length, 2)
  assert.equal(updated.body.story.cast[0].character.personality, 'Unhurried.')
  assert.equal(updated.body.story.cast[1].character.name, 'Cass')
  assert.deepEqual(updated.body.story.scenes[0].active_character_ids.sort(), updated.body.story.cast.map(member => member.character_id).sort())
  assert.equal(updated.body.story.runtime.transforms.length, 1)
  assert.equal(updated.body.story.runtime.automations.length, 1)

  const bootstrap = await jsonRequest(baseUrl, '/api/bootstrap')
  assert.equal(Object.hasOwn(bootstrap.body, 'characters'), false)
  assert.deepEqual(bootstrap.body.content_types.map(item => item.kind), ['story'])
  assert.ok(bootstrap.body.stories.some(story => story.id === storyId && story.cast.length === 2))

  const source = app.storySources.get(storyId).source
  assert.equal(source.characters.length, 2)
  assert.ok(source.characters.every(resource => !JSON.stringify(resource).includes(firstActor.character_id)))
  assert.equal(source.transforms.length, 1)
  assert.equal(source.automations.length, 1)
})
