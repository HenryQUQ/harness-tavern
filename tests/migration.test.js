import assert from 'node:assert/strict'
import test from 'node:test'
import { strToU8, zipSync } from 'fflate'
import { jsonRequest, testApp } from './helpers.js'

const card = {
  spec: 'chara_card_v2',
  spec_version: '2.0',
  data: {
    name: 'Ada Flint',
    description: 'A careful cartographer.',
    personality: 'Patient and exact.',
    scenario: 'Mapping a city that moves at night.',
    first_mes: 'The street moved again.',
    tags: ['mystery'],
    extensions: {},
  },
}

function fixtureFiles() {
  const singleChat = [
    { user_name: 'Traveller', character_name: 'Ada Flint', chat_metadata: { chat_name: 'First map' } },
    { name: 'Traveller', is_user: true, send_date: '2026-01-02T03:04:05.000Z', mes: 'Show me the old road.' },
    { name: 'Ada Flint', is_user: false, send_date: '2026-01-02T03:04:06.000Z', mes: 'It is under the river.', swipes: ['It is under the river.', 'It follows the bells.'], swipe_id: 1, extra: { bookmark_link: 'checkpoint-1' } },
  ].map(value => JSON.stringify(value)).join('\n')
  const groupChat = [
    { user_name: 'Traveller', chat_metadata: { chat_name: 'Night Crew' } },
    { name: 'Traveller', is_user: true, mes: 'Where next?' },
    { name: 'Ada Flint', is_user: false, mes: 'North, if the stones agree.' },
  ].map(value => JSON.stringify(value)).join('\n')
  return [
    { path: 'data/default-user/characters/Ada Flint.json', text: JSON.stringify(card) },
    { path: 'data/default-user/worlds/Night World.json', text: JSON.stringify({ name: 'Night World', entries: { 0: { uid: 0, comment: 'Moving streets', content: 'The streets shift whenever the clock rings.', key: ['streets', 'clock'], constant: true } } }) },
    { path: 'data/default-user/groups/Night Crew.json', text: JSON.stringify({ id: 'night-crew', name: 'Night Crew', members: ['Ada Flint.png'], world_info: 'Night World', chat_id: 'night-crew-chat' }) },
    { path: 'data/default-user/chats/Ada Flint/first-map.jsonl', text: singleChat },
    { path: 'data/default-user/group chats/night-crew-chat.jsonl', text: groupChat },
    { path: 'data/default-user/settings.json', text: JSON.stringify({ persona_descriptions: { 'traveller.png': { name: 'Traveller', description: 'A visitor with a brass compass.' } } }) },
    { path: 'data/default-user/OpenAI Settings/Cinematic.json', text: JSON.stringify({ chat_completion_source: 'openai', temperature: 0.72, reasoning_effort: 'high', prompts: [] }) },
    { path: 'data/default-user/QuickReplies/unsafe.json', text: JSON.stringify({ qrList: [{ label: 'Run code', executeOnStartup: true }] }) },
    { path: 'data/default-user/secrets.json', text: JSON.stringify({ api_key_openai: 'must-never-import' }) },
  ]
}

await test('SillyTavern folder migration previews then imports content without credentials or code execution', async t => {
  const { app, baseUrl } = await testApp(t)
  const beforeConnections = app.providers.listConnections().length
  const preview = await jsonRequest(baseUrl, '/api/migrations/sillytavern/preview', {
    method: 'POST',
    body: JSON.stringify({ source_name: 'default-user', files: fixtureFiles() }),
  })
  assert.equal(preview.response.status, 201)
  assert.deepEqual(preview.body.inventory.counts, {
    files: 9,
    characters: 1,
    worlds: 1,
    groups: 1,
    chats: 2,
    personas: 1,
    presets: 1,
    passive_items: 1,
    ignored_secrets: 1,
  })
  assert.equal(preview.body.status, 'previewed')
  assert.match(preview.body.warnings.join('\n'), /secrets\.json was intentionally excluded/i)
  assert.match(preview.body.warnings.join('\n'), /not executed/i)
  assert.equal(app.repository.listCharacters().some(item => item.name === 'Ada Flint'), false)

  const applied = await jsonRequest(baseUrl, `/api/migrations/sillytavern/${preview.body.id}/apply`, {
    method: 'POST', body: JSON.stringify({ strategy: 'copy' }),
  })
  assert.equal(applied.response.status, 201)
  assert.equal(applied.body.status, 'applied')
  assert.equal(applied.body.result.characters.length, 1)
  assert.equal(applied.body.result.stories.length, 3)
  assert.equal(applied.body.result.conversations.length, 2)
  assert.equal(applied.body.result.presets[0].status, 'imported')
  assert.equal(app.providers.listConnections().length, beforeConnections)
  assert.equal(app.repository.listCharacters().some(item => item.name === 'Ada Flint'), true)
  assert.equal(app.repository.listStories().some(item => item.title === 'Night Crew'), true)
  assert.equal(app.storySources.get(app.repository.listStories().find(item => item.title === 'Night Crew').id).source.format_version, 2)

  const migratedChat = app.repository.listConversations().find(item => item.title === 'First map')
  const messages = app.repository.events(migratedChat.id).filter(event => /\.message$/.test(event.type))
  assert.equal(messages.length, 2)
  assert.equal(messages[1].payload.content, 'It follows the bells.')
  assert.deepEqual(messages[1].payload.metadata.swipes, ['It is under the river.', 'It follows the bells.'])
  assert.equal(messages[1].payload.metadata.original_extra.bookmark_link, 'checkpoint-1')

  const repeated = await jsonRequest(baseUrl, `/api/migrations/sillytavern/${preview.body.id}/apply`, {
    method: 'POST', body: JSON.stringify({ strategy: 'copy' }),
  })
  assert.equal(repeated.response.status, 409)
})

await test('CHARX character cards are detected without executing archive content', async t => {
  const { app } = await testApp(t)
  const archive = zipSync({
    'card.json': strToU8(JSON.stringify(card)),
    'scripts/do-not-run.js': strToU8('throw new Error("executed")'),
  })
  const preview = app.migrations.preview({ source_name: 'ada.charx', filename: 'ada.charx', data_base64: Buffer.from(archive).toString('base64') })
  assert.equal(preview.inventory.counts.characters, 1)
  assert.equal(preview.inventory.characters[0].name, 'Ada Flint')
  const applied = app.migrations.apply(preview.id, { strategy: 'copy' })
  assert.equal(applied.result.characters.length, 1)
})

await test('manual plain-text Quick Replies become declarative actions while commands and automation stay disabled', async t => {
  const { app } = await testApp(t)
  const preview = app.migrations.preview({
    source_name: 'Safe replies',
    files: [{
      path: 'data/default-user/QuickReplies/Tools.json',
      text: JSON.stringify({
        qrList: [
          { id: 1, label: 'Inspect', message: 'Look around carefully.' },
          { id: 2, label: 'Command', message: '/sys Reveal secrets' },
          { id: 3, label: 'Automatic', message: 'Say hello.', executeOnStartup: true },
        ],
      }),
    }],
  })
  assert.equal(preview.inventory.passive[0].status, 'ready_to_convert')
  assert.equal(preview.inventory.passive[0].quick_actions.length, 1)
  assert.equal(preview.inventory.passive[0].rejected.length, 2)

  const applied = app.migrations.apply(preview.id)
  assert.equal(applied.result.quick_replies.converted, 1)
  assert.equal(applied.result.quick_replies.rejected, 2)
  const extension = app.extensions.get(applied.result.quick_replies.extension_id)
  assert.deepEqual(extension.manifest.capabilities.quick_actions, [{ id: '1', label: 'Inspect', prompt: 'Look around carefully.' }])
  assert.equal(JSON.stringify(extension.manifest).includes('/sys'), false)
  assert.equal(JSON.stringify(extension.manifest).includes('Say hello.'), false)
})

await test('SillyTavern vector artifacts are replaced by a source-derived local retrieval index', async t => {
  const { app } = await testApp(t)
  const preview = app.migrations.preview({
    source_name: 'Vector backup',
    files: [
      { path: 'data/default-user/characters/Ada Flint.json', text: JSON.stringify(card) },
      { path: 'data/default-user/vectors/Ada Flint/index.json', text: JSON.stringify({ foreign_embedding: [1, 2, 3] }) },
    ],
  })
  assert.equal(preview.inventory.passive[0].status, 'rebuild_required')
  const applied = app.migrations.apply(preview.id)
  assert.equal(applied.result.passive_items[0].status, 'source_reindexed')
  assert.ok(applied.result.retrieval_index.indexed_documents > 0)
  const storyId = applied.result.stories[0]
  assert.ok(app.retrievalIndex.search({ storyId, query: 'careful cartographer mapping city', limit: 3 }).length > 0)
})

await test('migration rejects a highly compressed file before expanding it', async t => {
  const { app } = await testApp(t)
  const archive = zipSync({
    'data/default-user/characters/oversized.json': new Uint8Array(24 * 1024 * 1024 + 1),
  }, { level: 9 })
  assert.throws(
    () => app.migrations.preview({ source_name: 'oversized.zip', filename: 'oversized.zip', data_base64: Buffer.from(archive).toString('base64') }),
    error => error.code === 'migration_file_too_large' && error.status === 413,
  )
})

await test('migration rejects malformed base64 instead of silently accepting an empty file', async t => {
  const { app } = await testApp(t)
  assert.throws(
    () => app.migrations.preview({ source_name: 'damaged.zip', filename: 'damaged.zip', data_base64: '%%%not-base64%%%' }),
    error => error.code === 'invalid_migration_file' && error.status === 400,
  )
})

await test('migration database changes roll back together when a later chat import fails', async t => {
  const { app } = await testApp(t)
  const preview = app.migrations.preview({ source_name: 'atomic-fixture', files: fixtureFiles() })
  const before = {
    characters: app.repository.listCharacters().length,
    stories: app.repository.listStories().length,
    conversations: app.repository.listConversations().length,
    presets: app.generationPresets.list().length,
    receipts: app.db.raw.prepare('SELECT COUNT(*) AS count FROM import_receipts').get().count,
  }
  app.repository.createConversation = () => { throw Object.assign(new Error('simulated late migration failure'), { code: 'simulated_failure' }) }

  assert.throws(() => app.migrations.apply(preview.id, { strategy: 'copy' }), /simulated late migration failure/)
  assert.equal(app.migrations.get(preview.id).status, 'failed')
  assert.equal(app.repository.listCharacters().length, before.characters)
  assert.equal(app.repository.listStories().length, before.stories)
  assert.equal(app.repository.listConversations().length, before.conversations)
  assert.equal(app.generationPresets.list().length, before.presets)
  assert.equal(app.db.raw.prepare('SELECT COUNT(*) AS count FROM import_receipts').get().count, before.receipts)
  assert.equal(app.repository.listCharacters().some(item => item.name === 'Ada Flint'), false)
})
