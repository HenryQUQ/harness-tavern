import { createServer } from 'node:http'
import { createReadStream, existsSync, statSync } from 'node:fs'
import { extname, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { constantTimeEqual, id } from '../util.js'
import { reduceEvents, visibleObservations } from '../domain/projection.js'
import { buildPlayerJournal } from '../domain/journal.js'
import { THINKING_INTENSITIES } from '../runtime/thinking.js'
import { ActionRegistry } from '../runtime/action-registry.js'
import { characterPublicRuntime, normalizeCharacterRuntimeConfig } from '../runtime/character-runtime.js'
import { applyDisplayTransforms, applyStoryTransforms, evaluateStoryLore, normalizeTransform, storyLoreEntries } from '../runtime/story-runtime.js'
import { isStorySourceInput } from '../story/source.js'
import { PRODUCT_NAME, PRODUCT_VERSION } from '../version.js'

const PUBLIC_DIR = fileURLToPath(new URL('../../public', import.meta.url))
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.webmanifest': 'application/manifest+json',
}

function securityHeaders(response, requestId) {
  response.setHeader('X-Request-Id', requestId)
  response.setHeader('X-Content-Type-Options', 'nosniff')
  response.setHeader('Referrer-Policy', 'same-origin')
  response.setHeader('Permissions-Policy', 'camera=(), microphone=(self), geolocation=()')
  response.setHeader('Cross-Origin-Opener-Policy', 'same-origin')
  response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; connect-src 'self' https://openrouter.ai; frame-ancestors 'none'; base-uri 'self'; form-action 'self' https://openrouter.ai")
  if (response.req?.url?.startsWith('/api/')) response.setHeader('Cache-Control', 'no-store')
}

async function bodyJson(request, limit) {
  const chunks = []
  let size = 0
  for await (const chunk of request) {
    size += chunk.length
    if (size > limit) {
      const error = new Error('Request body too large')
      error.status = 413
      error.code = 'request_too_large'
      throw error
    }
    chunks.push(chunk)
  }
  if (!chunks.length) return {}
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch {
    const error = new Error('Request body must be valid JSON')
    error.status = 400
    error.code = 'invalid_json'
    throw error
  }
}

function sendJson(response, status, value, headers = {}) {
  const text = JSON.stringify(value)
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(text), ...headers })
  response.end(text)
}

function sendJsonDownload(response, value, filename) {
  return sendJson(response, 200, value, { 'content-disposition': `attachment; filename="${String(filename).replace(/[^A-Za-z0-9._-]/g, '-')}.json"` })
}

function sendAssetContent(response, asset) {
  const filename = String(asset.metadata.filename).replace(/["\\\r\n]/g, '-')
  const fallbackFilename = filename.replace(/[^\x20-\x7E]/g, '_')
  response.writeHead(200, {
    'content-type': asset.metadata.mime_type,
    'content-length': asset.data.length,
    'content-disposition': `inline; filename="${fallbackFilename}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
    'cache-control': 'private, no-store',
  })
  response.end(asset.data)
}

function redirect(response, location) {
  response.writeHead(302, { location, 'cache-control': 'no-store' })
  response.end()
}

function matchPath(pathname, template) {
  const pathParts = pathname.split('/').filter(Boolean)
  const templateParts = template.split('/').filter(Boolean)
  if (pathParts.length !== templateParts.length) return null
  const params = {}
  for (let index = 0; index < templateParts.length; index += 1) {
    const expected = templateParts[index]
    const actual = pathParts[index]
    if (expected.startsWith(':')) params[expected.slice(1)] = decodeURIComponent(actual)
    else if (expected !== actual) return null
  }
  return params
}

function playerCharacter(character) {
  return {
    id: character.id,
    slug: character.slug,
    name: character.name,
    description: character.description,
    personality: character.personality,
    appearance: character.appearance,
    scenario: character.scenario,
    first_message: character.first_message,
    speech_style: character.speech_style,
    alternate_greetings: Array.isArray(character.metadata?.alternate_greetings) ? character.metadata.alternate_greetings : [],
    avatar_url: character.avatar_url,
    tags: character.tags,
    updated_at: character.updated_at,
  }
}

function playerStory(story, playthroughs = []) {
  return {
    id: story.id,
    slug: story.slug,
    title: story.title,
    hook: story.hook,
    summary: story.summary,
    premise: story.premise,
    genre: story.genre,
    tone: story.tone,
    opening_scene: story.opening_scene,
    player_role: story.player_role,
    content_warnings: story.content_warnings,
    tags: story.tags,
    cover_url: story.cover_url,
    visibility: story.visibility,
    cast: story.cast.map(member => ({
      character_id: member.character_id,
      role: member.role,
      public_context: member.public_context,
      sort_order: member.sort_order,
      character: playerCharacter(member.character),
    })),
    public_lore: story.lore.filter(item => !item.visibility || item.visibility === 'public'),
    scene_count: story.scenes.length,
    runtime_summary: {
      lore: storyLoreEntries(story, story.cast).length,
      transforms: story.runtime?.transforms?.length ?? 0,
      automations: story.runtime?.automations?.length ?? 0,
      actions: story.runtime?.actions?.length ?? 0,
      agendas: story.runtime?.agendas?.length ?? 0,
    },
    playthroughs,
    updated_at: story.updated_at,
  }
}

function playerCast(cast, projection = null) {
  return cast.map(member => ({
    conversation_id: member.conversation_id,
    character_id: member.character_id,
    role: member.role,
    public_context: member.public_context,
    sort_order: member.sort_order,
    muted: member.muted,
    spotlight: member.spotlight,
    character: playerCharacter(member.character),
    runtime: characterPublicRuntime(member, projection?.characterStates?.[member.character_id]),
  }))
}

function words(value) {
  return new Set(String(value ?? '').toLocaleLowerCase().match(/[\p{L}\p{N}_-]+/gu) ?? [])
}

function wordScore(query, value) {
  const queryWords = words(query)
  const candidateWords = words(value)
  if (!queryWords.size || !candidateWords.size) return 0
  let shared = 0
  for (const token of queryWords) if (candidateWords.has(token)) shared += 1
  return shared / Math.sqrt(queryWords.size * candidateWords.size)
}

function storyRuntimeDebug(app, storyId, input = {}) {
  const story = app.repository.getStory(storyId)
  const userMessage = String(input.user_message ?? '').trim()
  const conversation = input.conversation_id ? app.repository.getConversation(input.conversation_id) : null
  if (conversation && conversation.story_id !== story.id) {
    const error = new Error('The selected conversation does not belong to this Story')
    error.status = 409
    error.code = 'story_conversation_mismatch'
    throw error
  }
  const cast = conversation ? app.repository.listConversationCast(conversation.id) : story.cast.map((member, index) => ({ ...member, muted: false, spotlight: false, sort_order: member.sort_order ?? index }))
  const projection = reduceEvents(conversation ? app.repository.events(conversation.id) : [], story.initial_state)
  const activeCast = cast.filter(member => !member.muted)
  const lore = evaluateStoryLore({ story, cast: activeCast, messages: projection.messages, userMessage, includeDirector: true })
  const transformedInput = applyStoryTransforms(story, 'user_input', userMessage, { actorId: 'user', cast: activeCast })
  const participants = activeCast.map(member => {
    const name = member.character?.name ?? member.character_id
    const mentioned = String(userMessage).toLocaleLowerCase().includes(String(name).toLocaleLowerCase())
    return {
      character_id: member.character_id,
      name,
      score: Number(member.spotlight) * 10 + Number(mentioned) * 5 - Number(member.sort_order ?? 0) / 100,
      reasons: [member.spotlight ? 'spotlight' : '', mentioned ? 'mentioned' : '', 'available'].filter(Boolean),
    }
  }).sort((left, right) => right.score - left.score)
  const actionRegistry = new ActionRegistry({ story, cast: activeCast })
  const actions = actionRegistry.describe().map(action => ({
    ...action,
    relevance: wordScore(userMessage, `${action.key} ${action.label} ${action.description}`),
  })).sort((left, right) => right.relevance - left.relevance)
  const transformTrace = (story.runtime?.transforms ?? []).map((candidate, index) => {
    const rule = normalizeTransform(candidate, index)
    if (!rule) return { id: candidate?.id ?? `transform-${index + 1}`, valid: false, reason: 'invalid_or_unsafe_regex' }
    const stages = {}
    for (const stage of rule.stages) {
      const sample = stage === 'lore' ? lore.entries.map(entry => entry.content).join('\n') : userMessage
      const output = applyStoryTransforms({ runtime: { transforms: [rule] } }, stage, sample, { actorId: stage === 'user_input' ? 'user' : 'narrator', cast: activeCast })
      stages[stage] = { changed: output !== sample, preview: output.slice(0, 300) }
    }
    return { id: rule.id, name: rule.name, valid: true, enabled: rule.enabled, stages }
  })
  const debugConversation = conversation ?? {
    id: 'runtime-debug', model_id: '', thinking_intensity: 'medium',
    generation: { response_length: 'natural' },
    prompt: { history_messages: 80, context_budget_tokens: null, custom_instructions: '' },
  }
  const control = app.contextBuilder.buildControl({
    conversation: debugConversation, story, persona: null, cast: activeCast, projection,
    userMessage: transformedInput, resolvedIntensity: 'medium', actionRegistry,
  })
  return {
    story_id: story.id,
    conversation_id: conversation?.id ?? null,
    storyteller: { mode: 'single_storyteller_beat', mandatory_speakers: 0, participant_candidates: participants },
    character_runtime: {
      mode: 'isolated_actor_plans',
      profiles: activeCast.map(member => ({
        character_id: member.character_id,
        name: member.character.name,
        ...normalizeCharacterRuntimeConfig(member),
        public_state: characterPublicRuntime(member, projection.characterStates?.[member.character_id]),
      })),
    },
    input: { original: userMessage, transformed: transformedInput },
    lore: { active_ids: lore.entries.map(entry => String(entry.id ?? entry.key)), trace: lore.trace },
    transforms: transformTrace,
    actions,
    context: control.manifest,
    retrieval: app.retrievalIndex.search({ storyId: story.id, query: userMessage, limit: 6 }).map(item => ({ source_type: item.source_type, source_id: item.source_id, score: item.score, preview: item.content.slice(0, 240) })),
  }
}

function usageOverview(app) {
  const totals = app.db.raw.prepare(`
    SELECT COUNT(*) AS calls,
      COALESCE(SUM(prompt_tokens), 0) AS prompt_tokens,
      COALESCE(SUM(completion_tokens), 0) AS completion_tokens,
      COALESCE(SUM(reasoning_tokens), 0) AS reasoning_tokens,
      COALESCE(SUM(total_tokens), 0) AS total_tokens,
      COALESCE(SUM(cost_usd), 0) AS cost_usd
    FROM usage_ledger
  `).get()
  const byModel = app.db.raw.prepare(`
    SELECT provider_id, model_id, COUNT(*) AS calls,
      COALESCE(SUM(total_tokens), 0) AS total_tokens,
      COALESCE(SUM(cost_usd), 0) AS cost_usd,
      MAX(created_at) AS last_used_at
    FROM usage_ledger GROUP BY provider_id, model_id ORDER BY last_used_at DESC
  `).all()
  const daily = app.db.raw.prepare(`
    SELECT substr(created_at, 1, 10) AS day, COUNT(*) AS calls,
      COALESCE(SUM(total_tokens), 0) AS total_tokens,
      COALESCE(SUM(cost_usd), 0) AS cost_usd
    FROM usage_ledger GROUP BY day ORDER BY day DESC LIMIT 30
  `).all().reverse()
  return { totals, by_model: byModel, daily, retrieval: app.retrievalIndex.stats() }
}

function playerManifest(manifest) {
  if (!manifest || typeof manifest !== 'object') return null
  return {
    policy: manifest.policy,
    budget_tokens: manifest.budget_tokens ?? null,
    estimated_tokens: manifest.estimated_tokens ?? null,
    included_count: Array.isArray(manifest.included) ? manifest.included.length : Number(manifest.included_count ?? 0),
    omitted_count: Array.isArray(manifest.omitted) ? manifest.omitted.length : Number(manifest.omitted_count ?? 0),
    truncated_blocks: Number(manifest.truncated_blocks ?? 0),
  }
}

function playerContextManifests(manifests = {}) {
  return Object.fromEntries(Object.entries(manifests).map(([phase, manifest]) => {
    if (manifest?.policy) return [phase, playerManifest(manifest)]
    return [phase, Object.fromEntries(Object.entries(manifest ?? {})
      .map(([actorId, actorManifest]) => [actorId, playerManifest(actorManifest)])
      .filter(([, actorManifest]) => actorManifest))]
  }))
}

function playerReceipt(receipt, { includeReason = false } = {}) {
  return {
    status: receipt.status,
    action_id: receipt.action_id,
    action_type: receipt.action_type,
    actor_id: receipt.actor_id,
    outcome: receipt.outcome,
    ...includeReason ? { reason: receipt.reason } : {},
    changed_fact_count: Array.isArray(receipt.effects) ? receipt.effects.length : Number(receipt.changed_fact_count ?? 0),
    state_revision_before: receipt.state_revision_before,
    state_revision_after: receipt.state_revision_after,
  }
}

function playerCausalResults(receipts = [], observations = []) {
  const visible = visibleObservations({ observations }, 'user')
  const visibleActionIds = new Set(visible.map(item => item.action_id).filter(Boolean))
  return {
    receipts: receipts.filter(item => item.actor_id === 'user' || visibleActionIds.has(item.action_id))
      .map(item => playerReceipt(item, { includeReason: item.actor_id === 'user' && item.status === 'rejected' })),
    observations: visible,
  }
}

function playerAgenda(agenda) {
  return {
    id: agenda.id,
    owner_id: agenda.owner_id,
    objective: agenda.objective,
    priority: agenda.priority,
    status: agenda.status,
    visibility: agenda.visibility,
    evaluation_count: Number(agenda.evaluation_count ?? 0),
  }
}

function playerLoop(run) {
  if (!run) return null
  const manifests = playerContextManifests(run.result?.context_manifests)
  return {
    id: run.id,
    status: run.status,
    phase: run.phase,
    step_count: run.step_count,
    error: run.error?.code ? { code: run.error.code, message: run.error.message } : {},
    context_manifests: manifests,
    created_at: run.created_at,
    updated_at: run.updated_at,
  }
}

function playerTurnResult(app, conversationId, result) {
  const causal = playerCausalResults(result.action_receipts, result.observations)
  const conversation = app.repository.getConversation(conversationId)
  const story = conversation.story_id ? app.repository.getStory(conversation.story_id) : null
  const cast = app.repository.listConversationCast(conversationId)
  return {
    turn_uid: result.turn_uid,
    loop_id: result.loop_id,
    command_id: result.command_id,
    status: result.status,
    phase: result.phase,
    thinking_intensity: result.thinking_intensity,
    effective_thinking_intensity: result.effective_thinking_intensity,
    messages: story ? applyDisplayTransforms(story, result.messages ?? [], cast) : result.messages ?? [],
    action_receipts: causal.receipts,
    observations: causal.observations,
    pending_action_count: Array.isArray(result.pending_actions) ? result.pending_actions.length : 0,
    usage: result.usage,
    structured_output: result.structured_output,
    context_manifests: playerContextManifests(result.context_manifests),
  }
}

function playerHome(app) {
  const home = app.repository.getHome()
  return {
    continue: home.continue.map(item => ({
      id: item.id,
      title: item.title,
      story_id: item.story_id,
      playthrough_id: item.playthrough_id,
      last_preview: item.last_preview,
      updated_at: item.updated_at,
      subtitle: item.subtitle,
      current_scene: item.current_scene,
      cast: item.cast,
      favorite: item.favorite,
    })),
    stories: home.stories.map(item => ({ ...playerStory(item, item.playthroughs), favorite: Boolean(item.favorite) })),
  }
}

function playerConversationListItem(app, conversation) {
  const cast = app.repository.listConversationCast(conversation.id)
  const story = conversation.story_id ? app.repository.getStory(conversation.story_id) : null
  const publicCast = cast.map(member => ({
    id: member.character_id,
    name: member.character.name,
    avatar_url: member.character.avatar_url,
  }))
  return {
    ...conversation,
    group: story ? {
      kind: 'story',
      id: story.id,
      title: story.title,
      subtitle: story.hook || story.summary || story.genre || '',
      cover_url: story.cover_url,
      cast: publicCast,
    } : {
      kind: 'story',
      id: `legacy-story:${conversation.id}`,
      title: conversation.title || 'Recovered Story',
      subtitle: 'Legacy Story awaiting migration',
      cover_url: '',
      cast: publicCast,
    },
  }
}

function publicBootstrap(app) {
  return {
    version: PRODUCT_VERSION,
    product: PRODUCT_NAME,
    deployment: { scope: 'local-single-owner', multi_tenant: false },
    capabilities: [
      'framework-first-content',
      'explicit-content-lifecycle',
      'playthroughs',
      'player-journal',
      'portable-sharing',
      'editable-story-sources',
      'public-preview-links',
      'remix-links',
      'declarative-extensions',
      'sillytavern-card-import',
      'generation-presets',
      'sillytavern-generation-preset-import',
      'conversation-model-switching',
      'causal-control-loop',
      'typed-actions',
      'actor-scoped-observations',
      'persistent-agendas',
      'resumable-turns',
      'sillytavern-full-migration',
      'complete-content-editors',
      'story-owned-cast',
      'story-bundled-runtime',
      'single-storyteller-beat',
      'isolated-character-runtime',
      'persistent-character-state',
      'structured-scene-blocks',
      'bounded-long-context-retrieval',
      'conversation-attachments',
      'provider-media-capability-gating',
      'runtime-debugger',
      'usage-diagnostics',
    ],
    user_profile: app.repository.getUserProfile(),
    home: playerHome(app),
    thinking_intensities: THINKING_INTENSITIES,
    provider_presets: app.providers.listPresets(),
    provider_connections: app.providers.listConnections(),
    generation_presets: app.generationPresets.list(),
    account_connectors: app.accounts.descriptors(),
    account_connections: app.accounts.list(),
    extensions: app.extensions.list().map(item => ({ id: item.id, slug: item.slug, name: item.name, version: item.version, description: item.manifest.description, enabled: item.enabled, source: item.source })),
    contributions: app.extensions.contributions(),
    content_types: app.library.contentTypes(),
    personas: app.repository.listPersonas(),
    stories: app.repository.listStories().map(story => playerStory(story, app.repository.listPlaythroughs(story.id))),
    playthroughs: app.repository.listPlaythroughs(),
    conversations: app.repository.listConversations().map(conversation => playerConversationListItem(app, conversation)),
    sample: {
      story_id: 'story_glass_observatory',
      conversation_id: app.db.raw.prepare('SELECT id FROM conversations WHERE id = ?').get('conv_glass_observatory_test')?.id ?? null,
      cast_member_ids: ['char_mira_vale', 'char_rowan_ash', 'char_lyra_voss'],
    },
  }
}

function conversationView(app, conversationId, { creator = false } = {}) {
  const conversation = app.repository.getConversation(conversationId)
  const story = conversation.story_id ? app.repository.getStory(conversation.story_id) : null
  const persona = app.repository.getPersona(conversation.persona_id)
  const cast = app.repository.listConversationCast(conversationId)
  const branches = app.repository.listBranches(conversationId)
  const events = app.repository.events(conversationId)
  const projection = reduceEvents(events, story?.initial_state ?? {})
  const journal = buildPlayerJournal({ conversation, story, cast, projection, branches })
  const publicCausal = playerCausalResults(projection.receipts.slice(-20), projection.observations.slice(-100))
  const base = {
    conversation,
    media_capabilities: conversation.connection_id
      ? app.providers.mediaCapabilities(conversation.connection_id, conversation.model_id)
      : { images: false, text: true, audio: false },
    story: story ? playerStory(story, app.repository.listPlaythroughs(story.id)) : null,
    persona,
    cast: playerCast(cast, projection),
    character_runtime: cast.map(member => characterPublicRuntime(member, projection.characterStates?.[member.character_id])),
    branches,
    messages: creator || !story ? projection.messages : applyDisplayTransforms(story, projection.messages, cast),
    journal,
    causal: {
      state_revision: projection.stateRevision,
      recent_receipts: publicCausal.receipts,
      recent_observations: publicCausal.observations.slice(-30),
      active_agendas: Object.values(projection.agendas)
        .filter(agenda => agenda.status === 'active' && agenda.visibility === 'public')
        .map(playerAgenda),
      clocks: projection.clocks,
      known_facts: journal.known_facts,
      latest_loop: playerLoop(app.turns.listRuns(conversationId)[0]),
    },
    running: app.turns.isRunning(conversationId),
  }
  if (creator) return { ...base, story, cast, projection, events, usage: app.db.raw.prepare('SELECT * FROM usage_ledger WHERE conversation_id = ? ORDER BY id DESC LIMIT 100').all(conversationId) }
  return base
}

export function createHttpServer(app) {
  return createServer(async (request, response) => {
    const requestId = id('req')
    securityHeaders(response, requestId)
    const startedAt = Date.now()
    try {
      const url = new URL(request.url, app.config.publicUrl)
      const pathname = url.pathname
      const method = request.method || 'GET'
      const isOAuthCallback = pathname === '/api/account-connections/openrouter/callback'
      const isPublicShareRead = method === 'GET' && pathname.startsWith('/api/public/shares/')
      if (pathname.startsWith('/api/') && app.config.accessToken && !isOAuthCallback && !isPublicShareRead) {
        const authorization = request.headers.authorization?.replace(/^Bearer\s+/i, '')
        const headerToken = request.headers['x-harness-tavern-token']
        if (![authorization, headerToken].some(token => constantTimeEqual(token, app.config.accessToken))) {
          return sendJson(response, 401, { error: { code: 'unauthorized', message: 'Valid access token required' }, request_id: requestId })
        }
      }

      if (method === 'GET' && pathname === '/api/health') {
        return sendJson(response, 200, { status: 'ok', version: PRODUCT_VERSION, deployment_scope: 'local-single-owner', multi_tenant: false, database: app.db.integrityCheck(), uptime_seconds: Math.round(process.uptime()) })
      }
      let params
      if (method === 'GET' && (params = matchPath(pathname, '/api/public/shares/:token/download'))) {
        const share = app.shareLinks.getPublic(params.token)
        if (!share.can_import) {
          const error = new Error('This share is view-only')
          error.status = 403
          error.code = 'preview_only'
          throw error
        }
        return sendJsonDownload(response, share.snapshot, `${share.title || 'tavern-share'}.tavern`)
      }
      if (method === 'GET' && (params = matchPath(pathname, '/api/public/shares/:token'))) {
        return sendJson(response, 200, app.shareLinks.getPublic(params.token), { 'access-control-allow-origin': 'null' })
      }
      if (method === 'GET' && pathname === '/api/bootstrap') return sendJson(response, 200, publicBootstrap(app))
      if (method === 'GET' && pathname === '/api/home') return sendJson(response, 200, playerHome(app))
      if (method === 'GET' && pathname === '/api/library/content-types') return sendJson(response, 200, app.library.contentTypes())
      if (method === 'POST' && pathname === '/api/library/items') return sendJson(response, 201, app.library.add(await bodyJson(request, app.config.requestBodyLimit)))
      if (method === 'GET' && pathname === '/api/creator/bootstrap') {
        return sendJson(response, 200, {
          stories: app.repository.listStories(),
          personas: app.repository.listPersonas(),
          extensions: app.extensions.list(),
          contributions: app.extensions.contributions(),
          imports: app.repository.listImports(),
          story_sources: app.storySources.listBindings(),
        })
      }
      if (method === 'GET' && (params = matchPath(pathname, '/api/creator/characters/:id'))) {
        return sendJson(response, 200, app.storySources.getRuntimeCharacter(params.id))
      }
      if (method === 'PUT' && (params = matchPath(pathname, '/api/creator/characters/:id'))) {
        const input = await bodyJson(request, app.config.requestBodyLimit)
        const { character, expected_token: expectedToken, ...fields } = input
        app.storySources.updateRuntimeCharacter(params.id, character ?? fields, { expectedToken })
        return sendJson(response, 200, app.storySources.getRuntimeCharacter(params.id))
      }
      if (method === 'GET' && (params = matchPath(pathname, '/api/creator/stories/:id'))) {
        return sendJson(response, 200, app.storySources.getRuntimeStory(params.id))
      }
      if (method === 'PUT' && (params = matchPath(pathname, '/api/creator/stories/:id'))) {
        const input = await bodyJson(request, app.config.requestBodyLimit)
        const { story, expected_digest: expectedDigest, ...fields } = input
        app.storySources.updateRuntimeStory(params.id, story ?? fields, { expectedDigest })
        return sendJson(response, 200, app.storySources.getRuntimeStory(params.id))
      }
      if (method === 'POST' && (params = matchPath(pathname, '/api/creator/stories/:id/runtime-debug'))) {
        return sendJson(response, 200, storyRuntimeDebug(app, params.id, await bodyJson(request, app.config.requestBodyLimit)))
      }

      if (method === 'GET' && pathname === '/api/user-profile') return sendJson(response, 200, app.repository.getUserProfile())
      if (method === 'PATCH' && pathname === '/api/user-profile') return sendJson(response, 200, app.repository.updateUserProfile(await bodyJson(request, app.config.requestBodyLimit)))
      if (method === 'GET' && pathname === '/api/usage') return sendJson(response, 200, usageOverview(app))

      if (method === 'GET' && (params = matchPath(pathname, '/api/characters/:id'))) return sendJson(response, 200, playerCharacter(app.repository.getCharacter(params.id)))
      if (method === 'GET' && (params = matchPath(pathname, '/api/stories/:id'))) {
        const story = app.repository.getStory(params.id)
        return sendJson(response, 200, playerStory(story, app.repository.listPlaythroughs(story.id)))
      }
      if (method === 'GET' && (params = matchPath(pathname, '/api/story-sources/:id'))) return sendJson(response, 200, app.storySources.get(params.id))
      if (method === 'PUT' && (params = matchPath(pathname, '/api/story-sources/:id'))) {
        const input = await bodyJson(request, app.config.requestBodyLimit)
        return sendJson(response, 200, app.storySources.save(params.id, input.source ?? input, { expectedDigest: input.expected_digest }))
      }
      if (method === 'GET' && (params = matchPath(pathname, '/api/conversations/:id'))) return sendJson(response, 200, conversationView(app, params.id))
      if (method === 'GET' && (params = matchPath(pathname, '/api/creator/conversations/:id/inspect'))) return sendJson(response, 200, conversationView(app, params.id, { creator: true }))
      if (method === 'POST' && (params = matchPath(pathname, '/api/conversations/:id/assets'))) return sendJson(response, 201, app.assets.create(params.id, await bodyJson(request, app.config.requestBodyLimit)))
      if (method === 'GET' && (params = matchPath(pathname, '/api/assets/:id'))) return sendJson(response, 200, app.assets.get(params.id))
      if (method === 'GET' && (params = matchPath(pathname, '/api/assets/:id/content'))) return sendAssetContent(response, app.assets.content(params.id))
      if (method === 'DELETE' && (params = matchPath(pathname, '/api/assets/:id'))) return sendJson(response, 200, app.assets.remove(params.id))

      if (method === 'POST' && pathname === '/api/favorites') {
        const input = await bodyJson(request, app.config.requestBodyLimit)
        return sendJson(response, 200, app.repository.setFavorite(input.entity_type, input.entity_id, input.favorite !== false))
      }

      if (method === 'POST' && pathname === '/api/playthroughs') return sendJson(response, 201, app.repository.createPlaythrough(await bodyJson(request, app.config.requestBodyLimit)))
      if (method === 'POST' && pathname === '/api/conversations') {
        const error = new Error('Start a Story playthrough through /api/playthroughs. Standalone Character conversations are no longer a product concept.')
        error.status = 410
        error.code = 'story_playthrough_required'
        throw error
      }
      if (method === 'PATCH' && (params = matchPath(pathname, '/api/conversations/:id'))) return sendJson(response, 200, app.repository.updateConversation(params.id, await bodyJson(request, app.config.requestBodyLimit)))
      if (method === 'DELETE' && (params = matchPath(pathname, '/api/conversations/:id'))) return sendJson(response, 200, app.assets.deleteConversation(params.id))
      if (method === 'PATCH' && (params = matchPath(pathname, '/api/conversations/:id/cast/:characterId'))) {
        return sendJson(response, 200, playerCast(app.repository.updateConversationCast(params.id, params.characterId, await bodyJson(request, app.config.requestBodyLimit))))
      }
      if (method === 'POST' && (params = matchPath(pathname, '/api/conversations/:id/branches'))) return sendJson(response, 201, app.repository.forkBranch(params.id, await bodyJson(request, app.config.requestBodyLimit)))
      if (method === 'POST' && (params = matchPath(pathname, '/api/conversations/:id/branches/:branchId/switch'))) return sendJson(response, 200, app.repository.switchBranch(params.id, params.branchId))
      if (method === 'POST' && (params = matchPath(pathname, '/api/conversations/:id/cancel'))) return sendJson(response, 200, { cancelled: app.turns.cancel(params.id) })
      if (method === 'GET' && (params = matchPath(pathname, '/api/conversations/:id/control-loops'))) return sendJson(response, 200, app.turns.listRuns(params.id).map(playerLoop))
      if (method === 'GET' && (params = matchPath(pathname, '/api/control-loops/:id'))) return sendJson(response, 200, playerLoop(app.turns.getRun(params.id)))
      if (method === 'POST' && (params = matchPath(pathname, '/api/control-loops/:id/resume'))) {
        const run = app.turns.getRun(params.id)
        return sendJson(response, 200, playerTurnResult(app, run.conversation_id, await app.turns.resume(params.id)))
      }
      if (method === 'POST' && (params = matchPath(pathname, '/api/conversations/:id/turn'))) {
        const input = await bodyJson(request, app.config.requestBodyLimit)
        return sendJson(response, 200, playerTurnResult(app, params.id, await app.turns.run(params.id, { content: String(input.content ?? '').trim(), attachmentIds: input.attachment_ids ?? [], idempotencyKey: input.idempotency_key ?? null })))
      }
      if (method === 'POST' && (params = matchPath(pathname, '/api/conversations/:id/turn/stream'))) {
        const input = await bodyJson(request, app.config.requestBodyLimit)
        response.writeHead(200, {
          'content-type': 'text/event-stream; charset=utf-8',
          'cache-control': 'no-cache, no-transform',
          connection: 'keep-alive',
          'x-accel-buffering': 'no',
        })
        const emit = (event, data) => response.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
        const conversation = app.repository.getConversation(params.id)
        emit('turn.started', { thinking_intensity: conversation.thinking_intensity })
        try {
          const result = await app.turns.run(params.id, { content: String(input.content ?? '').trim(), attachmentIds: input.attachment_ids ?? [], idempotencyKey: input.idempotency_key ?? null })
          const publicResult = playerTurnResult(app, params.id, result)
          for (const receipt of publicResult.action_receipts) emit('action.receipt', receipt)
          for (const observation of publicResult.observations) emit('observation.created', observation)
          for (const message of publicResult.messages) {
            const chunks = message.content.match(/[\s\S]{1,64}/g) ?? []
            for (const chunk of chunks) emit('message.delta', { character_id: message.character_id, delta: chunk })
            emit('message.completed', message)
          }
          emit('turn.completed', publicResult)
        } catch (error) {
          emit('turn.failed', { code: error.code || 'turn_failed', message: error.message })
        }
        return response.end()
      }

      if (method === 'GET' && pathname === '/api/legacy/drafts') return sendJson(response, 200, app.repository.listLegacyDrafts(url.searchParams.get('type')))
      if (method === 'GET' && (params = matchPath(pathname, '/api/legacy/drafts/:id'))) return sendJson(response, 200, app.repository.getLegacyDraft(params.id))
      if ((method === 'POST' && ['/api/creator/character-drafts', '/api/creator/story-drafts'].includes(pathname))
        || pathname === '/api/creator/drafts'
        || matchPath(pathname, '/api/creator/drafts/:id')
        || matchPath(pathname, '/api/creator/drafts/:id/publish')) {
        const error = new Error('Guided content generation was removed from the core. Add explicit content through /api/library/items, import a standard file, or install an optional extension that owns its own generation behavior.')
        error.status = 410
        error.code = 'guided_creation_removed'
        throw error
      }
      if (method === 'POST' && matchPath(pathname, '/api/extensions/from-story/:storyId')) {
        const error = new Error('Core Story-to-template authoring was removed. Export the standard Story source or implement optional blueprint behavior in an extension.')
        error.status = 410
        error.code = 'core_template_authoring_removed'
        throw error
      }

      if (method === 'GET' && (params = matchPath(pathname, '/api/exports/characters/:id'))) {
        const format = url.searchParams.get('format')
        const card = format === 'sillytavern-v3'
          ? app.sharing.toCharacterCardV3(params.id)
          : format === 'sillytavern-v2' ? app.sharing.toCharacterCardV2(params.id) : app.sharing.exportCharacter(params.id)
        return sendJsonDownload(response, card, app.repository.getCharacter(params.id).slug)
      }
      if (method === 'GET' && (params = matchPath(pathname, '/api/exports/stories/:id'))) {
        const story = app.repository.getStory(params.id)
        const content = url.searchParams.get('format') === 'source'
          ? app.storySources.get(params.id).source
          : app.sharing.exportStory(params.id)
        const filename = url.searchParams.get('format') === 'source' ? `${story.slug}.story.tavern` : story.slug
        return sendJsonDownload(response, content, filename)
      }
      if (method === 'GET' && pathname === '/api/exports/library') {
        const profile = app.repository.getUserProfile()
        const pack = app.sharing.exportCollection({
          title: `${profile.name || 'My'} Tavern library`,
          character_ids: [],
          story_ids: app.repository.listStories().map(item => item.id),
          persona_ids: app.repository.listPersonas().map(item => item.id),
        })
        return sendJsonDownload(response, pack, 'my-tavern-library')
      }
      if (method === 'GET' && (params = matchPath(pathname, '/api/exports/conversations/:id'))) {
        const conversation = app.repository.getConversation(params.id)
        return sendJsonDownload(response, app.sharing.exportConversation(params.id), `${conversation.title}.playthrough.tavern`)
      }
      if (method === 'GET' && pathname === '/api/exports/backup') {
        return sendJsonDownload(response, app.sharing.exportBackup(), 'harness-tavern-backup')
      }
      if (method === 'POST' && pathname === '/api/shares') {
        const input = await bodyJson(request, app.config.requestBodyLimit)
        return sendJson(response, 201, app.shareLinks.create(input))
      }
      if (method === 'GET' && pathname === '/api/shares') {
        return sendJson(response, 200, app.shareLinks.list({ resource_type: url.searchParams.get('resource_type'), resource_id: url.searchParams.get('resource_id') }))
      }
      if (method === 'POST' && (params = matchPath(pathname, '/api/shares/:token/import'))) {
        const imported = app.shareLinks.import(params.token, await bodyJson(request, app.config.requestBodyLimit))
        return sendJson(response, 201, imported)
      }
      if (method === 'DELETE' && (params = matchPath(pathname, '/api/shares/:tokenHash'))) {
        return sendJson(response, 200, app.shareLinks.revoke(params.tokenHash))
      }
      // v0.11 compatibility aliases. New clients use /api/shares and /api/public/shares/:token.
      if (method === 'POST' && pathname === '/api/share-links') {
        const input = await bodyJson(request, app.config.requestBodyLimit)
        return sendJson(response, 201, app.shareLinks.create({ resource_type: input.resource_type ?? input.entity_type, resource_id: input.resource_id ?? input.entity_id, scope: input.scope ?? 'remix', expires_in_days: input.expires_in_days }))
      }
      if (method === 'GET' && (params = matchPath(pathname, '/api/share-links/:token'))) return sendJson(response, 200, app.shareLinks.getPublic(params.token).snapshot)
      if (method === 'POST' && pathname === '/api/import/preview') {
        const content = (await bodyJson(request, app.config.requestBodyLimit)).content
        return sendJson(response, 200, isStorySourceInput(content) ? app.storySources.preview(content) : app.sharing.preview(content))
      }
      if (method === 'POST' && pathname === '/api/import/apply') {
        const input = await bodyJson(request, app.config.requestBodyLimit)
        if (isStorySourceInput(input.content)) {
          return sendJson(response, 201, app.storySources.import(input.content, { strategy: input.strategy, sourceName: input.source_name }))
        }
        const imported = app.sharing.import(input.content, { strategy: input.strategy, source_name: input.source_name })
        return sendJson(response, 201, imported)
      }
      if (method === 'POST' && pathname === '/api/migrations/sillytavern/preview') {
        return sendJson(response, 201, app.migrations.preview(await bodyJson(request, app.config.migrationBodyLimit)))
      }
      if (method === 'GET' && (params = matchPath(pathname, '/api/migrations/sillytavern/:id'))) {
        return sendJson(response, 200, app.migrations.get(params.id))
      }
      if (method === 'POST' && (params = matchPath(pathname, '/api/migrations/sillytavern/:id/apply'))) {
        return sendJson(response, 201, app.migrations.apply(params.id, await bodyJson(request, app.config.requestBodyLimit)))
      }

      if (method === 'GET' && pathname === '/api/extensions') return sendJson(response, 200, { extensions: app.extensions.list(), contributions: app.extensions.contributions() })
      if (method === 'POST' && pathname === '/api/extensions/preview') return sendJson(response, 200, app.extensions.preview(await bodyJson(request, app.config.requestBodyLimit)))
      if (method === 'POST' && pathname === '/api/extensions') return sendJson(response, 201, app.extensions.install(await bodyJson(request, app.config.requestBodyLimit), { source: 'manual' }))
      if (method === 'PATCH' && (params = matchPath(pathname, '/api/extensions/:id'))) return sendJson(response, 200, app.extensions.setEnabled(params.id, Boolean((await bodyJson(request, app.config.requestBodyLimit)).enabled)))
      if (method === 'DELETE' && (params = matchPath(pathname, '/api/extensions/:id'))) {
        app.extensions.remove(params.id)
        return sendJson(response, 200, { deleted: true })
      }
      if (method === 'GET' && (params = matchPath(pathname, '/api/extensions/:id/export'))) return sendJsonDownload(response, app.extensions.export(params.id), app.extensions.get(params.id).slug)

      if (method === 'GET' && pathname === '/api/generation-presets') return sendJson(response, 200, app.generationPresets.list())
      if (method === 'POST' && pathname === '/api/generation-presets/import/preview') return sendJson(response, 200, app.generationPresets.previewImport(await bodyJson(request, app.config.requestBodyLimit)))
      if (method === 'POST' && pathname === '/api/generation-presets/import') return sendJson(response, 201, app.generationPresets.importPreset(await bodyJson(request, app.config.requestBodyLimit)))
      if (method === 'POST' && pathname === '/api/generation-presets') return sendJson(response, 201, app.generationPresets.create(await bodyJson(request, app.config.requestBodyLimit)))
      if (method === 'PATCH' && (params = matchPath(pathname, '/api/generation-presets/:id'))) return sendJson(response, 200, app.generationPresets.update(params.id, await bodyJson(request, app.config.requestBodyLimit)))
      if (method === 'DELETE' && (params = matchPath(pathname, '/api/generation-presets/:id'))) {
        app.generationPresets.remove(params.id)
        return sendJson(response, 200, { deleted: true })
      }

      if (method === 'POST' && pathname === '/api/provider-connections') return sendJson(response, 201, app.providers.createConnection(await bodyJson(request, app.config.requestBodyLimit)))
      if (method === 'PATCH' && (params = matchPath(pathname, '/api/provider-connections/:id'))) return sendJson(response, 200, app.providers.updateConnection(params.id, await bodyJson(request, app.config.requestBodyLimit)))
      if (method === 'DELETE' && (params = matchPath(pathname, '/api/provider-connections/:id'))) {
        app.providers.deleteConnection(params.id)
        return sendJson(response, 200, { deleted: true })
      }
      if (method === 'GET' && (params = matchPath(pathname, '/api/provider-connections/:id/models'))) {
        return sendJson(response, 200, await app.providers.listModels(params.id, {
          accountConnectionId: url.searchParams.get('account_connection_id'),
          refresh: url.searchParams.get('refresh') === 'true',
          signal: request.signal,
        }))
      }
      if (method === 'POST' && (params = matchPath(pathname, '/api/provider-connections/:id/test'))) {
        const input = await bodyJson(request, app.config.requestBodyLimit)
        return sendJson(response, 200, await app.providers.testConnection(params.id, { accountConnectionId: input.account_connection_id ?? null, signal: request.signal }))
      }
      if (method === 'GET' && (params = matchPath(pathname, '/api/provider-connections/:id/openrouter/providers'))) {
        return sendJson(response, 200, { providers: await app.providers.listOpenRouterProviders(params.id, { accountConnectionId: url.searchParams.get('account_connection_id'), signal: request.signal }) })
      }

      if (method === 'POST' && (params = matchPath(pathname, '/api/account-connections/:connector/begin'))) return sendJson(response, 200, app.accounts.begin(params.connector, await bodyJson(request, app.config.requestBodyLimit)))
      if (method === 'POST' && (params = matchPath(pathname, '/api/account-connections/:connector/complete'))) return sendJson(response, 201, await app.accounts.complete(params.connector, await bodyJson(request, app.config.requestBodyLimit)))
      if (method === 'GET' && pathname === '/api/account-connections/openrouter/callback') {
        const state = url.searchParams.get('state')
        const code = url.searchParams.get('code')
        const error = url.searchParams.get('error')
        if (error) return redirect(response, `/?oauth=error&message=${encodeURIComponent(error)}#settings`)
        try {
          await app.accounts.complete('openrouter-oauth', { state, code })
          return redirect(response, '/?oauth=success#settings')
        } catch (oauthError) {
          return redirect(response, `/?oauth=error&message=${encodeURIComponent(oauthError.message)}#settings`)
        }
      }
      if (method === 'DELETE' && (params = matchPath(pathname, '/api/account-connections/:id'))) {
        app.accounts.remove(params.id)
        return sendJson(response, 200, { deleted: true })
      }

      if (method === 'POST' && pathname === '/api/characters') return sendJson(response, 201, app.repository.createCharacter(await bodyJson(request, app.config.requestBodyLimit)))
      if (method === 'PATCH' && (params = matchPath(pathname, '/api/characters/:id'))) {
        return sendJson(response, 200, app.storySources.updateRuntimeCharacter(params.id, await bodyJson(request, app.config.requestBodyLimit)))
      }
      if (method === 'DELETE' && (params = matchPath(pathname, '/api/characters/:id'))) {
        app.repository.deleteCharacter(params.id)
        return sendJson(response, 200, { deleted: true })
      }
      if (method === 'POST' && pathname === '/api/personas') return sendJson(response, 201, app.repository.createPersona(await bodyJson(request, app.config.requestBodyLimit)))
      if (method === 'PATCH' && (params = matchPath(pathname, '/api/personas/:id'))) return sendJson(response, 200, app.repository.updatePersona(params.id, await bodyJson(request, app.config.requestBodyLimit)))
      if (method === 'POST' && pathname === '/api/stories') {
        return sendJson(response, 201, app.storySources.createRuntimeStory(await bodyJson(request, app.config.requestBodyLimit)))
      }
      if (method === 'PATCH' && (params = matchPath(pathname, '/api/stories/:id'))) {
        return sendJson(response, 200, app.storySources.updateRuntimeStory(params.id, await bodyJson(request, app.config.requestBodyLimit)))
      }
      if (method === 'DELETE' && (params = matchPath(pathname, '/api/stories/:id'))) {
        return sendJson(response, 200, app.storySources.remove(params.id))
      }

      if (pathname.startsWith('/api/')) return sendJson(response, 404, { error: { code: 'not_found', message: 'API route not found' }, request_id: requestId })
      return serveStatic(pathname, response)
    } catch (error) {
      app.logger.error('http.request.failed', { request_id: requestId, method: request.method, url: request.url, error: error.message, code: error.code })
      if (!response.headersSent) sendJson(response, error.status || 500, { error: { code: error.code || 'internal_error', message: error.status && (error.status < 500 || error.expose) ? error.message : 'Internal server error' }, request_id: requestId })
      else response.end()
    } finally {
      app.logger.debug('http.request', { request_id: requestId, method: request.method, url: request.url, duration_ms: Date.now() - startedAt })
    }
  })
}

function serveStatic(pathname, response) {
  const requested = pathname === '/'
    ? 'index.html'
    : pathname.startsWith('/share/')
      ? 'share.html'
      : decodeURIComponent(pathname).replace(/^[/\\]+/, '')
  const path = resolve(PUBLIC_DIR, requested)
  if (!(path === PUBLIC_DIR || path.startsWith(`${PUBLIC_DIR}${sep}`)) || !existsSync(path) || !statSync(path).isFile()) {
    const fallback = resolve(PUBLIC_DIR, 'index.html')
    response.writeHead(200, { 'content-type': MIME['.html'], 'cache-control': 'no-cache' })
    return createReadStream(fallback).pipe(response)
  }
  response.writeHead(200, { 'content-type': MIME[extname(path)] || 'application/octet-stream', 'cache-control': extname(path) === '.html' ? 'no-cache' : 'public, max-age=300' })
  createReadStream(path).pipe(response)
}
