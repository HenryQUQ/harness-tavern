import { json, nowIso, sha256Hex, stableStringify } from '../util.js'
import { deserializeVector, serializeVector, vectorSimilarity, vectorize } from './retrieval.js'

function documentId(scope, sourceType, sourceId) {
  return `retrieval_${sha256Hex(`${scope}:${sourceType}:${sourceId}`).slice(0, 32)}`
}

function messageDocument(event) {
  if (!/^(user|assistant)\.message$/.test(event.type) || !event.payload?.content) return null
  return {
    storyId: null,
    conversationId: event.conversation_id,
    branchId: event.branch_id,
    sourceType: 'conversation-message',
    sourceId: event.event_uid,
    content: event.payload.content,
    metadata: {
      event_id: event.id,
      event_uid: event.event_uid,
      role: event.type.startsWith('user.') ? 'user' : 'assistant',
      actor_id: event.actor_id,
      created_at: event.created_at,
    },
  }
}

export class RetrievalIndex {
  constructor({ db, repository }) {
    this.db = db
    this.repository = repository
    this.upsertStatement = db.raw.prepare(`
      INSERT INTO retrieval_documents(
        id, story_id, conversation_id, branch_id, source_type, source_id,
        content, vector_json, metadata_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        story_id=excluded.story_id, conversation_id=excluded.conversation_id,
        branch_id=excluded.branch_id, content=excluded.content,
        vector_json=excluded.vector_json, metadata_json=excluded.metadata_json,
        updated_at=excluded.updated_at
    `)
  }

  upsert({ storyId = null, conversationId = null, branchId = null, sourceType, sourceId, content, metadata = {} }) {
    const scope = conversationId ? `conversation:${conversationId}` : `story:${storyId}`
    const timestamp = nowIso()
    const id = documentId(scope, sourceType, sourceId)
    this.upsertStatement.run(
      id, storyId, conversationId, branchId, sourceType, String(sourceId), String(content),
      stableStringify(serializeVector(content)), stableStringify(metadata), timestamp, timestamp,
    )
    return id
  }

  indexStory(story) {
    if (!story?.id) return { indexed: 0 }
    this.db.raw.prepare('DELETE FROM retrieval_documents WHERE story_id = ? AND conversation_id IS NULL').run(story.id)
    const documents = [
      { type: 'story', id: story.id, content: [story.title, story.hook, story.summary, story.premise, ...(story.world_rules ?? [])].filter(Boolean).join('\n'), metadata: { title: story.title } },
      ...(story.lore ?? []).map((entry, index) => ({ type: 'story-lore', id: entry.id ?? `lore-${index + 1}`, content: [entry.title, ...(entry.keywords ?? []), entry.content].filter(Boolean).join('\n'), metadata: { title: entry.title ?? '', visibility: entry.visibility ?? 'public' } })),
      ...(story.scenes ?? []).map((scene, index) => ({ type: 'story-scene', id: scene.id ?? `scene-${index + 1}`, content: [scene.title, scene.summary, scene.content, scene.description].filter(Boolean).join('\n'), metadata: { title: scene.title ?? '' } })),
    ].filter(item => item.content)
    for (const document of documents) this.upsert({ storyId: story.id, sourceType: document.type, sourceId: document.id, content: document.content, metadata: document.metadata })
    return { indexed: documents.length }
  }

  indexEvent(event) {
    const document = messageDocument(event)
    if (!document) return null
    return this.upsert(document)
  }

  indexConversation(conversationId, branchId = null) {
    const events = this.repository.events(conversationId, branchId)
    let indexed = 0
    for (const event of events) if (this.indexEvent(event)) indexed += 1
    return { indexed }
  }

  search({ storyId = null, conversationId = null, sourceTypes = [], query, limit = 8, minimum = 0.035 } = {}) {
    const clauses = []
    const parameters = []
    if (storyId) { clauses.push('story_id = ?'); parameters.push(storyId) }
    if (conversationId) { clauses.push('conversation_id = ?'); parameters.push(conversationId) }
    if (!clauses.length) return []
    if (sourceTypes.length) {
      clauses.push(`source_type IN (${sourceTypes.map(() => '?').join(',')})`)
      parameters.push(...sourceTypes)
    }
    const rows = this.db.raw.prepare(`SELECT * FROM retrieval_documents WHERE (${clauses.slice(0, storyId && conversationId ? 2 : 1).join(' OR ')})${clauses.length > (storyId && conversationId ? 2 : 1) ? ` AND ${clauses.slice(storyId && conversationId ? 2 : 1).join(' AND ')}` : ''}`).all(...parameters)
    const queryVector = vectorize(query)
    return rows.map(row => ({
      id: row.id,
      story_id: row.story_id,
      conversation_id: row.conversation_id,
      branch_id: row.branch_id,
      source_type: row.source_type,
      source_id: row.source_id,
      content: row.content,
      metadata: json(row.metadata_json, {}),
      score: vectorSimilarity(queryVector, deserializeVector(json(row.vector_json, []))),
    })).filter(item => item.score >= minimum)
      .sort((left, right) => right.score - left.score)
      .slice(0, Math.max(1, Math.min(50, Number(limit) || 8)))
  }

  stats() {
    const row = this.db.raw.prepare('SELECT COUNT(*) AS documents, COUNT(DISTINCT story_id) AS stories, COUNT(DISTINCT conversation_id) AS conversations FROM retrieval_documents').get()
    return { documents: Number(row.documents), stories: Number(row.stories), conversations: Number(row.conversations) }
  }

  rebuildAll() {
    let indexed = 0
    this.db.transaction(() => {
      this.db.raw.prepare('DELETE FROM retrieval_documents').run()
      for (const story of this.repository.listStories()) indexed += this.indexStory(story).indexed
      for (const conversation of this.repository.listConversations()) indexed += this.indexConversation(conversation.id, conversation.current_branch_id).indexed
    })
    return { indexed, ...this.stats() }
  }
}
