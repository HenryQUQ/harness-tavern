import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { jsonRequest, testApp } from './helpers.js'
import { SAMPLE_IDS } from '../src/domain/seed.js'

function upload(baseUrl, conversationId, { filename = 'clue.txt', mimeType = 'text/plain', content = 'The cobalt answer is hidden under the lens.' } = {}) {
  return jsonRequest(baseUrl, `/api/conversations/${encodeURIComponent(conversationId)}/assets`, {
    method: 'POST',
    body: JSON.stringify({ filename, mime_type: mimeType, data_base64: Buffer.from(content).toString('base64') }),
  })
}

await test('uploads, serves, sends, and permanently associates a text attachment with one Storyteller turn', async t => {
  const { app, baseUrl } = await testApp(t)
  const adapter = app.providers.adapters.get('test')
  const originalComplete = adapter.complete.bind(adapter)
  const requests = []
  adapter.complete = async request => {
    requests.push(request)
    return originalComplete(request)
  }

  const created = await upload(baseUrl, SAMPLE_IDS.conversation, { filename: '线索.md', mimeType: 'text/markdown' })
  assert.equal(created.response.status, 201)
  assert.equal(created.body.attached, false)
  assert.equal(created.body.byte_size, 43)

  const metadata = await jsonRequest(baseUrl, `/api/assets/${created.body.id}`)
  assert.equal(metadata.response.status, 200)
  assert.equal(metadata.body.filename, '线索.md')
  const content = await fetch(`${baseUrl}${created.body.content_url}`)
  assert.equal(content.status, 200)
  assert.equal(await content.text(), 'The cobalt answer is hidden under the lens.')
  assert.match(content.headers.get('content-disposition'), /filename\*=UTF-8''/)

  const turn = await jsonRequest(baseUrl, `/api/conversations/${SAMPLE_IDS.conversation}/turn`, {
    method: 'POST',
    body: JSON.stringify({ content: '', attachment_ids: [created.body.id], idempotency_key: 'attachment-turn' }),
  })
  assert.equal(turn.response.status, 200)
  assert.equal(turn.body.messages.length, 1)
  assert.equal(turn.body.messages[0].character_id, 'narrator')
  assert.equal(requests.length, 3)
  assert.deepEqual(requests.map(request => request.phase), ['control', 'character', 'narration'])
  assert.equal(requests.every(request => request.attachments[0].delivery === 'text'), true)
  assert.match(requests[0].messages.map(item => item.content).join('\n'), /cobalt answer/)

  const view = await jsonRequest(baseUrl, `/api/conversations/${SAMPLE_IDS.conversation}`)
  const userMessage = view.body.messages.find(message => message.metadata?.attachments?.some(item => item.id === created.body.id))
  assert.ok(userMessage)
  assert.equal(userMessage.metadata.attachments[0].data_base64, undefined)
  assert.equal(userMessage.metadata.attachments[0].extracted_text, undefined)

  const attached = await jsonRequest(baseUrl, `/api/assets/${created.body.id}`)
  assert.equal(attached.body.attached, true)
  const removal = await jsonRequest(baseUrl, `/api/assets/${created.body.id}`, { method: 'DELETE' })
  assert.equal(removal.response.status, 409)
  assert.equal(removal.body.error.code, 'attachment_in_use')
  const reuse = await jsonRequest(baseUrl, `/api/conversations/${SAMPLE_IDS.conversation}/turn`, {
    method: 'POST',
    body: JSON.stringify({ content: 'Reuse it.', attachment_ids: [created.body.id] }),
  })
  assert.equal(reuse.response.status, 409)
  assert.equal(reuse.body.error.code, 'attachment_already_used')
})

await test('enforces attachment type, size, count, and conversation ownership boundaries', async t => {
  const { app, baseUrl } = await testApp(t)
  const unsupported = await upload(baseUrl, SAMPLE_IDS.conversation, { filename: 'page.html', mimeType: 'text/html', content: '<h1>unsafe</h1>' })
  assert.equal(unsupported.response.status, 415)
  assert.equal(unsupported.body.error.code, 'unsupported_attachment_type')

  const other = app.repository.createPlaythrough({ story_id: SAMPLE_IDS.story, persona_id: SAMPLE_IDS.persona, connection_id: SAMPLE_IDS.connection, skip_opening: true }).conversation
  const owned = await upload(baseUrl, SAMPLE_IDS.conversation)
  const wrongConversation = await jsonRequest(baseUrl, `/api/conversations/${other.id}/turn`, {
    method: 'POST',
    body: JSON.stringify({ content: 'Read this.', attachment_ids: [owned.body.id] }),
  })
  assert.equal(wrongConversation.response.status, 403)
  assert.equal(wrongConversation.body.error.code, 'attachment_scope_mismatch')

  const ids = [owned.body.id]
  for (let index = 0; index < 4; index += 1) ids.push((await upload(baseUrl, SAMPLE_IDS.conversation, { filename: `${index}.txt`, content: String(index) })).body.id)
  const tooMany = await jsonRequest(baseUrl, `/api/conversations/${SAMPLE_IDS.conversation}/turn`, {
    method: 'POST',
    body: JSON.stringify({ content: 'Five files.', attachment_ids: ids }),
  })
  assert.equal(tooMany.response.status, 400)
  assert.equal(tooMany.body.error.code, 'too_many_attachments')
})

await test('deletes unsent files and removes remaining asset bytes when a playthrough is deleted', async t => {
  const { app, baseUrl } = await testApp(t)
  const created = app.repository.createPlaythrough({ story_id: SAMPLE_IDS.story, persona_id: SAMPLE_IDS.persona, connection_id: SAMPLE_IDS.connection, skip_opening: true }).conversation
  const pending = await upload(baseUrl, created.id, { filename: 'temporary.txt', content: 'temporary' })
  const pendingPath = app.assets.raw(pending.body.id).storage_path
  assert.equal(existsSync(pendingPath), true)
  const removed = await jsonRequest(baseUrl, `/api/assets/${pending.body.id}`, { method: 'DELETE' })
  assert.equal(removed.response.status, 200)
  assert.equal(existsSync(pendingPath), false)

  const retained = await upload(baseUrl, created.id, { filename: 'conversation.txt', content: 'conversation-scoped' })
  const retainedPath = app.assets.raw(retained.body.id).storage_path
  const conversationRemoved = await jsonRequest(baseUrl, `/api/conversations/${created.id}`, { method: 'DELETE' })
  assert.equal(conversationRemoved.response.status, 200)
  assert.equal(existsSync(retainedPath), false)
})
