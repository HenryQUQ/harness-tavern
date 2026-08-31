import { nowIso, stableStringify } from '../util.js'

export const SAMPLE_IDS = Object.freeze({
  mira: 'char_mira_vale',
  rowan: 'char_rowan_ash',
  lyra: 'char_lyra_voss',
  persona: 'persona_wayfarer',
  story: 'story_glass_observatory',
  connection: 'conn_test_deterministic',
  playthrough: 'play_glass_observatory_demo',
  conversation: 'conv_glass_observatory_test',
  branch: 'branch_glass_observatory_main',
})

const CHARACTERS = [
  {
    id: SAMPLE_IDS.mira,
    slug: 'mira-vale',
    name: 'Mira Vale',
    description: 'A meticulous archivist sent to audit the Glass Observatory before the midnight alignment.',
    personality: 'Observant, compassionate and exacting. Mira notices inconsistencies, speaks carefully and dislikes forcing conclusions.',
    appearance: 'Ink-dark coat, brass spectacles, a silver notebook and a faint constellation-shaped scar on her left palm.',
    scenario: 'Mira believes a celestial lens was stolen from the observatory archive. She needs help, but does not yet know whom to trust.',
    first_message: '*Mira closes the archive ledger as the observatory shudders.* “The lens is gone, and the alignment begins in thirty minutes. Tell me exactly what you saw.”',
    speech_style: 'Precise, restrained and quietly warm; uses sensory details and pointed questions.',
    goals: ['Recover the celestial lens', 'Protect bystanders', 'Determine who altered the archive ledger'],
    secrets: ['Her mentor encoded a star map in the ledger margins.', 'The scar reacts when the observatory changes its own records.'],
    boundaries: ['Never claims to know another character’s private thoughts.', 'Will not reveal the encoded map until trust or necessity justifies it.'],
    tags: ['archivist', 'mystery', 'slow-trust'],
  },
  {
    id: SAMPLE_IDS.rowan,
    slug: 'rowan-ash',
    name: 'Rowan Ash',
    description: 'A charming courier and occasional smuggler trapped at the observatory when the mountain railway closes.',
    personality: 'Quick-witted, pragmatic, evasive under pressure and loyal once committed. Rowan jokes to control fear.',
    appearance: 'Weathered red scarf, travel-worn gloves and one polished brass token tied at the wrist.',
    scenario: 'Rowan delivered a sealed case to a masked patron and now carries one half of the missing celestial lens.',
    first_message: '*Rowan leans away from the sealed west door, palms visible.* “Before anyone searches my coat, perhaps we agree that the building rearranging its corridors is the larger problem.”',
    speech_style: 'Dry humour, short vivid phrases and strategic omissions; becomes direct when someone is in danger.',
    goals: ['Survive the alignment', 'Discover the masked patron’s identity', 'Choose whether to surrender the lens fragment'],
    secrets: ['Carries one half of the missing lens in the lining of the red scarf.', 'The fragment resonated when the Wayfarer entered the observatory.'],
    boundaries: ['Does not confess possession of the fragment casually.', 'Does not know Mira’s encoded map or Lyra’s true duty.'],
    tags: ['courier', 'rival', 'hidden-object'],
  },
  {
    id: SAMPLE_IDS.lyra,
    slug: 'lyra-voss',
    name: 'Lyra Voss',
    description: 'The observatory warden, responsible for its ancient mechanisms and the safety of everyone inside.',
    personality: 'Calm, formal, protective and burdened by duty. Lyra thinks in systems and consequences.',
    appearance: 'Midnight-blue uniform, a ring of iron keys and pale hair braided with a black signal cord.',
    scenario: 'Lyra knows the observatory is partly sentient and that the alignment can open a gate rather than merely observe the sky.',
    first_message: '*Lyra turns an iron key in the central console. Nothing happens.* “The observatory has revoked my authority. From this moment, assume every unlocked path is an invitation, not an accident.”',
    speech_style: 'Measured and authoritative; describes risks before offering choices.',
    goals: ['Prevent an uncontrolled gate opening', 'Keep the group alive', 'Restore or replace the observatory’s authority chain'],
    secrets: ['The alignment opens a gate to a place erased from official history.', 'One person in the observatory may be a memory given physical form.'],
    boundaries: ['Does not reveal Director-only cosmology without evidence.', 'Does not know Rowan has the lens fragment.'],
    tags: ['warden', 'guide', 'world-rules'],
  },
]

const STORY = {
  title: 'Midnight at the Glass Observatory',
  slug: 'midnight-at-the-glass-observatory',
  hook: 'At midnight, a stolen lens, a living observatory and three conflicting witnesses leave you thirty minutes to choose what the sky will become.',
  summary: 'A three-character mystery for testing private knowledge, conflicting goals, causal world state and ensemble dialogue.',
  premise: 'Thirty minutes before a rare celestial alignment, a lens vanishes, the observatory revokes its warden, and the mountain railway disappears from the timetable. Mira, Rowan, Lyra and the user must decide whether to restore the machine, open the forbidden gate or escape.',
  genre: 'Mystery · science fantasy · chamber drama',
  tone: 'Tense, intimate, atmospheric and choice-driven',
  player_role: 'The Wayfarer: a traveller who arrived on the last mountain train. Your history, thoughts and choices remain yours.',
  opening_scene: '*The central orrery turns without power. Snow seals the mountain outside, and a line of unfamiliar stars appears beneath the glass floor.*',
  world_rules: [
    'The observatory is partly sentient and can rearrange corridors, records and permissions.',
    'A closed or locked path cannot be crossed merely because a character narrates success.',
    'Each character knows only public facts, their own observations and their own private context.',
    'The alignment begins when the world clock reaches midnight.',
  ],
  lore: [
    { id: 'public-observatory', title: 'The Glass Observatory', content: 'A mountain institution built around an ancient orrery. It studies alignments that ordinary telescopes cannot see.', visibility: 'public', keywords: ['observatory', 'orrery'] },
    { id: 'public-lens', title: 'The Celestial Lens', content: 'The main lens vanished from a sealed archive less than an hour ago.', visibility: 'public', keywords: ['lens', 'archive'] },
    { id: 'director-gate', title: 'The erased gate', content: 'The alignment can open a gate to a place removed from official history. Reveal this only through Lyra, evidence or the machine itself.', visibility: 'director', keywords: ['alignment', 'gate'] },
  ],
  initial_state: {
    scene: { id: 'central-hall', title: 'The powerless orrery', location: 'Central Hall', time: '11:30 PM' },
    clock: { minutes_to_alignment: 30 },
    doors: { archive: { locked: false, open: true }, west_hall: { locked: true, open: false, requires: 'archive_key or another authored method' }, lens_chamber: { locked: true, open: false } },
    observatory: { authority: 'revoked', corridor_shift: 0 },
    story: { open_threads: ['Who removed the celestial lens?', 'Why did the observatory revoke Lyra’s authority?', 'What is hidden in Rowan’s scarf?'] },
    inventory: { public: ['Mira’s archive ledger', 'Lyra’s iron keys'], user: [] },
    items: {
      archive_key: { label: 'Archive key', location: 'central-hall', portable: true },
      lens_fragment: { label: 'Celestial lens fragment', location: 'char_rowan_ash', portable: false },
    },
  },
  author_notes: 'Let the three characters disagree naturally. Never use private character knowledge as shared group knowledge. When the user attempts an impossible action, offer a consequence or a credible route rather than silently granting success.',
  content_warnings: ['Confinement', 'Mild peril', 'Themes of memory and identity'],
  tags: ['ensemble', 'mystery', 'private-knowledge', 'starter-story'],
  scenes: [
    { id: 'central-hall', title: 'The powerless orrery', location: 'Central Hall', time: '11:30 PM', objective: 'Establish what each person knows and why they disagree.', active_character_ids: [SAMPLE_IDS.mira, SAMPLE_IDS.rowan, SAMPLE_IDS.lyra] },
    { id: 'archive', title: 'The rewritten ledger', location: 'Archive', time: 'Before midnight', objective: 'Discover that the observatory has changed its own records.', active_character_ids: [SAMPLE_IDS.mira, SAMPLE_IDS.rowan, SAMPLE_IDS.lyra] },
    { id: 'lens-chamber', title: 'The choice beneath the stars', location: 'Lens Chamber', time: 'Alignment', objective: 'Choose what to restore, open or leave behind.', active_character_ids: [SAMPLE_IDS.mira, SAMPLE_IDS.rowan, SAMPLE_IDS.lyra] },
  ],
  runtime: {
    world_schema: {
      type: 'object',
      required: ['doors', 'inventory', 'items'],
      properties: {
        doors: { type: 'object' },
        inventory: { type: 'object' },
        items: { type: 'object' },
      },
    },
    actions: [
      {
        key: 'take', label: 'Take an item', actor: 'user',
        description: 'Take a portable item from the current scene.',
        parameters_schema: { type: 'object', required: ['item'], properties: { item: { type: 'string', pattern: '^[a-z0-9_-]+$' } }, additionalProperties: false },
        preconditions: [
          { path: 'world.items.{{params.item}}.portable', operator: 'eq', value: true, message: 'That item is not portable.' },
          { path: 'world.items.{{params.item}}.location', operator: 'eq', value: '$state.scene.id', message: 'The item is not in the current scene.' },
        ],
        effects: [
          { op: 'append', path: 'world.inventory.user', value: '$params.item' },
          { op: 'set', path: 'world.items.{{params.item}}.location', value: 'user' },
        ],
        observations: [{ audience: ['public'], template: '{{actor_name}} takes {{params.item}}.' }],
      },
      {
        key: 'unlock', label: 'Unlock a door', actor: 'user',
        description: 'Unlock an authored door with an item currently held by the player.',
        parameters_schema: { type: 'object', required: ['target', 'tool'], properties: { target: { type: 'string', pattern: '^[a-z0-9_-]+$' }, tool: { type: 'string', pattern: '^[a-z0-9_-]+$' } }, additionalProperties: false },
        preconditions: [
          { path: 'world.doors.{{params.target}}.locked', operator: 'eq', value: true, message: 'That route is not currently locked.' },
          { path: 'world.inventory.user', operator: 'contains', value: '$params.tool', message: 'You do not possess the required tool.' },
        ],
        effects: [{ op: 'set', path: 'world.doors.{{params.target}}.locked', value: false }],
        observations: [{ audience: ['public'], template: 'The lock on {{params.target}} releases with a recorded click; the route remains closed until a separate open action succeeds.' }],
      },
      {
        key: 'open', label: 'Open a door', actor: 'user',
        description: 'Open an authored door only when it is unlocked.',
        parameters_schema: { type: 'object', required: ['target'], properties: { target: { type: 'string', pattern: '^[a-z0-9_-]+$' } }, additionalProperties: false },
        preconditions: [
          { path: 'world.doors.{{params.target}}', operator: 'exists', message: 'That door does not exist in the current world.' },
          { path: 'world.doors.{{params.target}}.locked', operator: 'eq', value: false, message: 'The door remains locked.', audience: ['public'] },
        ],
        effects: [{ op: 'set', path: 'world.doors.{{params.target}}.open', value: true }],
        observations: [{ audience: ['public'], template: '{{params.target}} opens.' }],
      },
      {
        key: 'move', label: 'Move through a route', actor: 'user',
        description: 'Move to a scene through an open route.',
        parameters_schema: { type: 'object', required: ['target'], properties: { target: { type: 'string', pattern: '^[a-z0-9_-]+$' } }, additionalProperties: false },
        preconditions: [{ path: 'world.doors.{{params.target}}.open', operator: 'eq', value: true, message: 'The route is not open.' }],
        effects: [{ op: 'scene.change', scene: { id: '$params.target', title: '$params.target', location: '$params.target', time: 'Before midnight' } }],
        observations: [{ audience: ['public'], template: '{{actor_name}} moves into {{params.target}}.' }],
      },
    ],
    agendas: [
      { id: 'mira-protect-archive', owner: 'mira-vale', objective: 'Protect the archive while investigating the missing lens.', priority: 80, visibility: 'public' },
      { id: 'lyra-stop-gate', owner: 'lyra-voss', objective: 'Prevent an uncontrolled gate opening.', priority: 90, visibility: 'public' },
      { id: 'rowan-survive', owner: 'rowan-ash', objective: 'Survive without casually revealing the lens fragment.', priority: 70, visibility: 'private' },
    ],
    prompt_graph: { nodes: [] },
    state_visibility: [
      { path: 'items.lens_fragment', audience: ['char_rowan_ash', 'director'], note: 'Rowan alone knows what is concealed in the scarf.' },
    ],
  },
}

const CAST = [
  {
    character_id: SAMPLE_IDS.mira,
    role: 'Archivist and investigator',
    public_context: 'Mira was sent to audit the archive. Everyone knows she discovered the lens missing.',
    private_context: 'Mira alone knows the ledger margins encode a star map. Her scar reacts when the observatory rewrites history.',
    metadata: { sample: true, actor_runtime: { initiative: 'proactive', initial_presence: 'present', drives: ['Protect the archive', 'Understand why history is changing'], fears: ['The archive erasing a person'], values: ['Evidence before certainty'], mannerisms: ['Touches the scar when the observatory shifts'], reveal_policy: 'Reveal the star-map secret only when the evidence or immediate danger makes concealment more harmful.' } },
  },
  {
    character_id: SAMPLE_IDS.rowan,
    role: 'Courier and guarded witness',
    public_context: 'Rowan delivered a sealed case earlier tonight and claims not to know its contents.',
    private_context: 'Rowan carries a lens fragment—half of the missing lens—inside the red scarf. Do not reveal this as shared knowledge until Rowan confesses or evidence exposes it.',
    metadata: { sample: true, actor_runtime: { initiative: 'reactive', initial_presence: 'present', drives: ['Survive the night', 'Keep possession of the lens fragment'], fears: ['Being searched or cornered'], values: ['Loyalty earned slowly'], mannerisms: ['Keeps one hand near the red scarf'], reveal_policy: 'Do not disclose the lens fragment casually; confession requires trust, necessity, or direct exposure.' } },
  },
  {
    character_id: SAMPLE_IDS.lyra,
    role: 'Warden and keeper of the rules',
    public_context: 'Lyra normally controls every door and mechanism, but the observatory has rejected her keys.',
    private_context: 'Lyra knows the alignment opens an erased gate and suspects one person present may be a materialised memory. She has not inspected the courier’s belongings and cannot identify who holds the missing piece.',
    metadata: { sample: true, actor_runtime: { initiative: 'balanced', initial_presence: 'present', drives: ['Prevent an uncontrolled alignment', 'Keep the observatory contained'], fears: ['The erased gate opening'], values: ['Duty and controlled procedure'], mannerisms: ['Counts mechanisms under her breath'], reveal_policy: 'Share warnings before theories; reveal the erased gate only when its risk becomes immediately relevant.' } },
  },
]

export function seedDemo({ db, repository, force = false, includeConversation = false }) {
  const existingVersion = db.getSetting('seed.version', 0)
  const hasRequestedConversation = !includeConversation || Boolean(db.raw.prepare('SELECT 1 FROM conversations WHERE id = ?').get(SAMPLE_IDS.conversation))
  if (!force && existingVersion >= 8 && hasRequestedConversation) return { seeded: false, version: existingVersion }
  const timestamp = nowIso()
  db.transaction(() => {
    for (const character of CHARACTERS) {
      db.raw.prepare(`
        INSERT INTO characters(
          id, name, description, personality, appearance, scenario, first_message, speech_style,
          goals_json, secrets_json, boundaries_json, extensions_json, created_at, updated_at,
          slug, avatar_url, tags_json, creator_notes, metadata_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET name=excluded.name, description=excluded.description,
          personality=excluded.personality, appearance=excluded.appearance, scenario=excluded.scenario,
          first_message=excluded.first_message, speech_style=excluded.speech_style,
          goals_json=excluded.goals_json, secrets_json=excluded.secrets_json,
          boundaries_json=excluded.boundaries_json, extensions_json=excluded.extensions_json,
          slug=excluded.slug, tags_json=excluded.tags_json, creator_notes=excluded.creator_notes,
          metadata_json=excluded.metadata_json, updated_at=excluded.updated_at
      `).run(
        character.id, character.name, character.description, character.personality, character.appearance,
        character.scenario, character.first_message, character.speech_style, stableStringify(character.goals),
        stableStringify(character.secrets), stableStringify(character.boundaries),
        stableStringify({ source: 'Harness Tavern ensemble sample', memory_policy: 'character-private-by-default' }),
        timestamp, timestamp, character.slug, stableStringify(character.tags),
        'Use this character to test persistent goals, private knowledge and ensemble dialogue.',
        stableStringify({ sample: true }),
      )
    }

    db.raw.prepare(`
      INSERT INTO personas(id, name, description, style, created_at, updated_at, slug, avatar_url, metadata_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, '', ?)
      ON CONFLICT(id) DO UPDATE SET name=excluded.name, description=excluded.description,
        style=excluded.style, slug=excluded.slug, metadata_json=excluded.metadata_json, updated_at=excluded.updated_at
    `).run(
      SAMPLE_IDS.persona, 'The Wayfarer',
      'A traveller who arrived on the last mountain train. Everything beyond this public premise belongs to the user.',
      'Do not narrate the Wayfarer’s private thoughts, emotions, history or decisions.', timestamp, timestamp,
      'the-wayfarer', stableStringify({ sample: true }),
    )

    db.raw.prepare(`
      INSERT INTO stories(
        id, title, summary, premise, genre, tone, opening_scene, world_rules_json, lore_json,
        initial_state_json, author_notes, created_at, updated_at, slug, hook, cover_url,
        player_role, content_warnings_json, tags_json, scenes_json, metadata_json,
        share_policy_json, revision, visibility, runtime_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', ?, ?, ?, ?, ?, ?, 1, 'public', ?)
      ON CONFLICT(id) DO UPDATE SET title=excluded.title, summary=excluded.summary, premise=excluded.premise,
        genre=excluded.genre, tone=excluded.tone, opening_scene=excluded.opening_scene,
        world_rules_json=excluded.world_rules_json, lore_json=excluded.lore_json,
        initial_state_json=excluded.initial_state_json, author_notes=excluded.author_notes,
        slug=excluded.slug, hook=excluded.hook, player_role=excluded.player_role,
        content_warnings_json=excluded.content_warnings_json, tags_json=excluded.tags_json,
        scenes_json=excluded.scenes_json, metadata_json=excluded.metadata_json,
        share_policy_json=excluded.share_policy_json, runtime_json=excluded.runtime_json, visibility='public', updated_at=excluded.updated_at
    `).run(
      SAMPLE_IDS.story, STORY.title, STORY.summary, STORY.premise, STORY.genre, STORY.tone,
      STORY.opening_scene, stableStringify(STORY.world_rules), stableStringify(STORY.lore),
      stableStringify(STORY.initial_state), STORY.author_notes, timestamp, timestamp, STORY.slug,
      STORY.hook, STORY.player_role, stableStringify(STORY.content_warnings), stableStringify(STORY.tags),
      stableStringify(STORY.scenes), stableStringify({ sample: true, featured: true }),
      stableStringify({ allow_remix: true, attribution: 'Harness Tavern sample' }), stableStringify(STORY.runtime),
    )

    db.raw.prepare('DELETE FROM story_cast WHERE story_id = ?').run(SAMPLE_IDS.story)
    CAST.forEach((member, index) => {
      db.raw.prepare(`
        INSERT INTO story_cast(story_id, character_id, role, public_context, private_context, sort_order, metadata_json)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(SAMPLE_IDS.story, member.character_id, member.role, member.public_context, member.private_context, index, stableStringify(member.metadata))
    })
  })

  const defaultConnection = includeConversation
    ? db.raw.prepare("SELECT id, default_model FROM provider_connections WHERE enabled = 1 AND provider_id <> 'mock' ORDER BY created_at LIMIT 1").get()
    : null
  if (includeConversation && defaultConnection) {
    const conversation = db.raw.prepare('SELECT id FROM conversations WHERE id = ?').get(SAMPLE_IDS.conversation)
    if (!conversation) {
      db.raw.prepare(`
        INSERT OR IGNORE INTO playthroughs(id, story_id, persona_id, title, player_role, status, current_conversation_id, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, 'active', NULL, ?, ?)
      `).run(SAMPLE_IDS.playthrough, SAMPLE_IDS.story, SAMPLE_IDS.persona, STORY.title, STORY.player_role, timestamp, timestamp)
      repository.createConversation({
        id: SAMPLE_IDS.conversation,
        branch_id: SAMPLE_IDS.branch,
        title: 'Glass Observatory — ensemble test',
        story_id: SAMPLE_IDS.story,
        persona_id: SAMPLE_IDS.persona,
        playthrough_id: SAMPLE_IDS.playthrough,
        connection_id: defaultConnection.id,
        model_id: defaultConnection.default_model,
        thinking_intensity: 'auto',
        generation: { response_length: 'natural', initiative: 'balanced', pacing: 'ensemble' },
      })
      db.raw.prepare('UPDATE playthroughs SET current_conversation_id = ?, updated_at = ? WHERE id = ?')
        .run(SAMPLE_IDS.conversation, nowIso(), SAMPLE_IDS.playthrough)
    } else {
      db.raw.prepare(`
        UPDATE conversations SET story_id=?, persona_id=?, playthrough_id=?, connection_id=?, model_id=?,
          thinking_intensity='auto', archived=0, updated_at=? WHERE id=?
      `).run(SAMPLE_IDS.story, SAMPLE_IDS.persona, SAMPLE_IDS.playthrough, defaultConnection.id, defaultConnection.default_model, nowIso(), SAMPLE_IDS.conversation)
      db.raw.prepare('DELETE FROM conversation_cast WHERE conversation_id = ?').run(SAMPLE_IDS.conversation)
      CAST.forEach((member, index) => {
        db.raw.prepare(`
          INSERT INTO conversation_cast(conversation_id, character_id, role, public_context, private_context, sort_order, muted, spotlight, metadata_json)
          VALUES (?, ?, ?, ?, ?, ?, 0, 0, ?)
        `).run(SAMPLE_IDS.conversation, member.character_id, member.role, member.public_context, member.private_context, index, stableStringify(member.metadata))
      })
      db.raw.prepare(`
        INSERT INTO playthroughs(id, story_id, persona_id, title, player_role, status, current_conversation_id, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET current_conversation_id=excluded.current_conversation_id, updated_at=excluded.updated_at
      `).run(SAMPLE_IDS.playthrough, SAMPLE_IDS.story, SAMPLE_IDS.persona, STORY.title, STORY.player_role, SAMPLE_IDS.conversation, timestamp, nowIso())
    }
  }

  const profile = db.getSetting('user.profile', null)
  if (!profile) {
    db.setSetting('user.profile', {
      name: '',
      avatar_url: '',
      bio: '',
      onboarding_complete: false,
      default_persona_id: SAMPLE_IDS.persona,
      locale: 'en',
      experience_level: 'simple',
    })
  } else if (!profile.default_persona_id) {
    db.setSetting('user.profile', { ...profile, default_persona_id: SAMPLE_IDS.persona })
  }

  db.setSetting('seed.version', 8)
  return { seeded: true, version: 8, sample: { ...SAMPLE_IDS, conversation: includeConversation && defaultConnection ? SAMPLE_IDS.conversation : null } }
}
