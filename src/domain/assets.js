import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { extname, resolve } from 'node:path'
import { assert, cleanText, id, nowIso, sha256Hex } from '../util.js'

const MAX_ASSET_BYTES = 4 * 1024 * 1024
const MAX_TURN_ASSET_BYTES = 6 * 1024 * 1024
const MAX_TURN_ASSETS = 4
const ALLOWED_MIME = new Set([
  'image/png', 'image/jpeg', 'image/webp', 'image/gif',
  'text/plain', 'text/markdown', 'application/json', 'application/pdf',
  'audio/webm', 'audio/ogg', 'audio/mpeg', 'audio/wav', 'audio/mp4',
])
const EXTENSIONS = {
  'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp', 'image/gif': '.gif',
  'text/plain': '.txt', 'text/markdown': '.md', 'application/json': '.json', 'application/pdf': '.pdf',
  'audio/webm': '.webm', 'audio/ogg': '.ogg', 'audio/mpeg': '.mp3', 'audio/wav': '.wav', 'audio/mp4': '.m4a',
}

function canonicalBase64(value) {
  const source = String(value ?? '').trim()
  assert(source && source.length % 4 !== 1 && /^[A-Za-z0-9+/]*={0,2}$/.test(source), 'Attachment data is not valid base64', 400, 'invalid_attachment')
  const buffer = Buffer.from(source, 'base64')
  assert(buffer.toString('base64').replace(/=+$/, '') === source.replace(/=+$/, ''), 'Attachment data is not valid base64', 400, 'invalid_attachment')
  return buffer
}

function publicAsset(row) {
  return row ? {
    id: row.id,
    conversation_id: row.conversation_id,
    filename: row.filename,
    mime_type: row.mime_type,
    byte_size: row.byte_size,
    sha256: row.sha256,
    kind: row.mime_type.split('/')[0],
    attached: Boolean(row.message_event_uid),
    content_url: `/api/assets/${encodeURIComponent(row.id)}/content`,
    created_at: row.created_at,
  } : null
}

export class AssetService {
  constructor({ db, repository, config }) {
    this.db = db
    this.repository = repository
    this.root = resolve(config.dataDir, 'assets')
    mkdirSync(this.root, { recursive: true, mode: 0o700 })
  }

  create(conversationId, input = {}) {
    this.repository.getConversation(conversationId)
    const mimeType = String(input.mime_type ?? '').toLocaleLowerCase().split(';')[0].trim()
    assert(ALLOWED_MIME.has(mimeType), 'This attachment type is not supported', 415, 'unsupported_attachment_type')
    const data = canonicalBase64(input.data_base64)
    assert(data.length > 0 && data.length <= MAX_ASSET_BYTES, `Attachments must be between 1 byte and ${MAX_ASSET_BYTES} bytes`, 413, 'attachment_too_large')
    const assetId = id('asset')
    const suppliedExtension = extname(String(input.filename ?? '')).toLocaleLowerCase().replace(/[^.a-z0-9]/g, '')
    const extension = suppliedExtension && suppliedExtension.length <= 10 ? suppliedExtension : EXTENSIONS[mimeType] || '.bin'
    const storagePath = resolve(this.root, `${assetId}${extension}`)
    assert(storagePath.startsWith(`${this.root}/`), 'Attachment path is invalid', 400, 'invalid_attachment')
    writeFileSync(storagePath, data, { flag: 'wx', mode: 0o600 })
    const filename = cleanText(input.filename, 240) || `${assetId}${extension}`
    const extractedText = ['text/plain', 'text/markdown', 'application/json'].includes(mimeType)
      ? cleanText(data.toString('utf8'), 30_000)
      : ''
    try {
      this.db.raw.prepare(`
        INSERT INTO assets(id, conversation_id, message_event_uid, filename, mime_type, byte_size, sha256, storage_path, extracted_text, created_at)
        VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?)
      `).run(assetId, conversationId, filename, mimeType, data.length, sha256Hex(data), storagePath, extractedText, nowIso())
    } catch (error) {
      try { unlinkSync(storagePath) } catch {}
      throw error
    }
    return this.get(assetId)
  }

  get(assetId) {
    const row = this.db.raw.prepare('SELECT * FROM assets WHERE id = ?').get(assetId)
    assert(row, 'Attachment not found', 404, 'not_found')
    return publicAsset(row)
  }

  raw(assetId) {
    const row = this.db.raw.prepare('SELECT * FROM assets WHERE id = ?').get(assetId)
    assert(row && existsSync(row.storage_path), 'Attachment not found', 404, 'not_found')
    return row
  }

  content(assetId) {
    const row = this.raw(assetId)
    return { metadata: publicAsset(row), data: readFileSync(row.storage_path) }
  }

  resolve(conversationId, assetIds = []) {
    const unique = [...new Set((Array.isArray(assetIds) ? assetIds : []).map(String).filter(Boolean))]
    assert(unique.length <= MAX_TURN_ASSETS, `A turn can include at most ${MAX_TURN_ASSETS} attachments`, 400, 'too_many_attachments')
    const rows = unique.map(assetId => this.raw(assetId))
    assert(rows.every(row => row.conversation_id === conversationId), 'An attachment does not belong to this conversation', 403, 'attachment_scope_mismatch')
    assert(rows.reduce((total, row) => total + row.byte_size, 0) <= MAX_TURN_ASSET_BYTES, 'Attachments for one turn exceed the combined size limit', 413, 'attachments_too_large')
    return rows.map(row => ({
      ...publicAsset(row),
      message_event_uid: row.message_event_uid,
      extracted_text: row.extracted_text,
      data_base64: readFileSync(row.storage_path).toString('base64'),
    }))
  }

  attach(assetIds, eventUid) {
    for (const assetId of assetIds) this.db.raw.prepare('UPDATE assets SET message_event_uid = ? WHERE id = ? AND message_event_uid IS NULL').run(eventUid, assetId)
  }

  remove(assetId) {
    const row = this.raw(assetId)
    assert(!row.message_event_uid, 'Sent attachments are part of conversation history and cannot be removed independently', 409, 'attachment_in_use')
    this.db.raw.prepare('DELETE FROM assets WHERE id = ?').run(assetId)
    try { unlinkSync(row.storage_path) } catch {}
    return { deleted: true }
  }

  deleteConversation(conversationId) {
    const rows = this.db.raw.prepare('SELECT storage_path FROM assets WHERE conversation_id = ?').all(conversationId)
    const result = this.repository.deleteConversation(conversationId)
    for (const row of rows) {
      try { unlinkSync(row.storage_path) } catch {}
    }
    return result
  }
}
