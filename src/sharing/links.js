import { assert, cleanText, json, nowIso, randomToken, sha256Base64Url, stableStringify } from '../util.js'
import { applyDisplayTransforms } from '../runtime/story-runtime.js'

function parseDays(value) {
  const number = Number(value)
  if (!Number.isFinite(number)) return 30
  return Math.max(1, Math.min(365, Math.round(number)))
}

function publicConversationSnapshot(repository, conversationId) {
  const conversation = repository.getConversation(conversationId)
  const events = repository.events(conversationId)
  const story = conversation.story_id ? repository.getStory(conversation.story_id) : null
  const cast = repository.listConversationCast(conversation.id)
  const castIds = new Set(cast.map(member => member.character.id))
  const characters = cast.map(member => ({
    id: member.character.id,
    name: member.character.name,
    tagline: member.character.tagline,
    avatar_url: member.character.avatar_url,
  }))
  const messages = events.filter(event => ['user.message', 'assistant.message', 'narrator.message'].includes(event.type)).map(event => ({
    role: event.type === 'user.message' ? 'user' : event.type === 'narrator.message' || event.actor_id === 'narrator' ? 'narrator' : 'assistant',
    actor_id: event.actor_id,
    content: event.payload.content ?? '',
    participant_ids: [...new Set(event.payload.metadata?.participant_ids ?? [])].filter(participantId => castIds.has(participantId)),
    created_at: event.created_at,
  }))
  return {
    kind: 'playthrough-preview',
    title: conversation.title,
    story: story ? { id: story.id, title: story.title, hook: story.hook, cover_url: story.cover_url, genre: story.genre, tone: story.tone } : null,
    characters,
    messages: (story ? applyDisplayTransforms(story, messages, cast) : messages).slice(-30),
    timeline_label: repository.listBranches(conversationId).find(branch => branch.id === conversation.current_branch_id)?.label || 'Main timeline',
  }
}

export class ShareLinkService {
  constructor({ db, repository, packs, config }) {
    this.db = db
    this.repository = repository
    this.packs = packs
    this.config = config
  }

  create({ resource_type, resource_id, scope = 'preview', expires_in_days = 30 } = {}) {
    const resourceType = cleanText(resource_type, 40)
    const resourceId = cleanText(resource_id, 200)
    assert(['story', 'conversation'].includes(resourceType), 'resource_type must be story or conversation')
    assert(resourceId, 'resource_id is required')
    const normalizedScope = scope === 'remix' ? 'remix' : 'preview'
    assert(resourceType !== 'conversation' || normalizedScope === 'preview', 'Playthrough shares are preview-only')
    let snapshot
    let title
    if (resourceType === 'story') {
      const story = this.repository.getStory(resourceId)
      title = story.title
      snapshot = normalizedScope === 'remix'
        ? this.packs.exportStory(resourceId)
        : { kind: 'story-preview', story: { id: story.id, title: story.title, hook: story.hook, summary: story.summary, premise: story.premise, genre: story.genre, tone: story.tone, cover_url: story.cover_url, player_role: story.player_role, tags: story.tags, content_warnings: story.content_warnings, cast: story.cast.map(member => ({ id: member.character.id, name: member.character.name, tagline: member.character.tagline, avatar_url: member.character.avatar_url, role: member.role, public_context: member.public_context })) } }
    } else {
      const conversation = this.repository.getConversation(resourceId)
      title = conversation.title
      snapshot = publicConversationSnapshot(this.repository, resourceId)
    }
    const token = randomToken(32)
    const tokenHash = sha256Base64Url(token)
    const days = parseDays(expires_in_days)
    const expiresAt = new Date(Date.now() + days * 86_400_000).toISOString()
    this.db.raw.prepare(`
      INSERT INTO content_shares(token_hash, token_preview, resource_type, resource_id, scope, title, snapshot_json, expires_at, revoked_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)
    `).run(tokenHash, `${token.slice(0, 5)}…${token.slice(-4)}`, resourceType, resourceId, normalizedScope, cleanText(title, 200), stableStringify(snapshot), expiresAt, nowIso())
    this.db.audit('share.created', 'share_link', tokenHash, { resource_type: resourceType, resource_id: resourceId, scope: normalizedScope })
    return {
      id: tokenHash,
      token_hash: tokenHash,
      token,
      url: new URL(`/share/${encodeURIComponent(token)}`, this.config.publicUrl).toString(),
      resource_type: resourceType,
      resource_id: resourceId,
      title,
      scope: normalizedScope,
      expires_at: expiresAt,
    }
  }

  list({ resource_type = null, resource_id = null } = {}) {
    const conditions = []
    const values = []
    if (resource_type) { conditions.push('resource_type = ?'); values.push(resource_type) }
    if (resource_id) { conditions.push('resource_id = ?'); values.push(resource_id) }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
    return this.db.raw.prepare(`SELECT token_hash, token_preview, resource_type, resource_id, scope, title, expires_at, revoked_at, created_at FROM content_shares ${where} ORDER BY created_at DESC`).all(...values)
      .map(row => ({ ...row, active: !row.revoked_at && (!row.expires_at || Date.parse(row.expires_at) > Date.now()) }))
  }

  getPublic(token) {
    const row = this.#row(token)
    const snapshot = json(row.snapshot_json, null)
    assert(snapshot, 'Share snapshot is invalid', 500, 'invalid_share_snapshot')
    return {
      resource_type: row.resource_type,
      resource_id: row.resource_id,
      title: row.title,
      scope: row.scope,
      expires_at: row.expires_at,
      created_at: row.created_at,
      can_import: row.scope === 'remix' && ['character', 'story'].includes(row.resource_type),
      snapshot,
    }
  }

  import(token, { strategy = 'copy' } = {}) {
    const share = this.getPublic(token)
    assert(share.can_import, 'This share link is preview-only', 403, 'preview_only')
    const result = this.packs.import(share.snapshot, { strategy })
    this.db.audit('share.imported', 'share_link', sha256Base64Url(token), { resource_type: share.resource_type })
    return result
  }

  revoke(tokenHash) {
    const result = this.db.raw.prepare('UPDATE content_shares SET revoked_at = ? WHERE token_hash = ?').run(nowIso(), tokenHash)
    assert(result.changes > 0, 'Share link not found', 404, 'not_found')
    this.db.audit('share.revoked', 'share_link', tokenHash)
    return { revoked: true }
  }

  #row(token) {
    const tokenHash = sha256Base64Url(String(token ?? ''))
    const row = this.db.raw.prepare('SELECT * FROM content_shares WHERE token_hash = ?').get(tokenHash)
    assert(row, 'Share link not found', 404, 'not_found')
    assert(!row.revoked_at, 'Share link has been revoked', 410, 'share_revoked')
    assert(!row.expires_at || Date.parse(row.expires_at) > Date.now(), 'Share link has expired', 410, 'share_expired')
    return row
  }
}
