import assert from 'node:assert/strict'
import test from 'node:test'
import { reduceEvents } from '../src/domain/projection.js'
import { SAMPLE_IDS } from '../src/domain/seed.js'
import { testApp } from './helpers.js'

await test('portable playthroughs preserve the causal event stream on another Tavern', async t => {
  const source = await testApp(t)
  await source.app.turns.run(SAMPLE_IDS.conversation, { content: 'Take the archive key.', idempotencyKey: 'portable-take' })
  const pack = source.app.sharing.exportConversation(SAMPLE_IDS.conversation)
  assert.equal(pack.kind, 'playthrough')
  assert.equal(pack.items.conversations.length, 1)
  assert.ok(pack.items.conversations[0].events.some(event => event.type === 'action.resolved'))
  assert.ok(pack.items.conversations[0].events.every(event => event.event_uid))
  const sourceResolution = pack.items.conversations[0].events.find(event => event.type === 'action.resolved' && event.payload.action_type === 'take')
  assert.ok(sourceResolution.causation_id)

  const destination = await testApp(t, { HT_SEED_SAMPLE_CONVERSATION: 'false' })
  const imported = destination.app.sharing.import(pack, { strategy: 'copy', source_name: 'portable-playthrough.tavern.json' })
  assert.equal(imported.result.conversations.length, 1)
  const conversation = imported.result.conversations[0]
  const story = destination.app.repository.getStory(conversation.story_id)
  const projected = reduceEvents(destination.app.repository.events(conversation.id), story.initial_state)
  assert.deepEqual(projected.world.inventory.user, ['archive_key'])
  assert.equal(projected.world.items.archive_key.location, 'user')
  assert.ok(projected.receipts.some(receipt => receipt.action_type === 'take' && receipt.status === 'resolved'))
  const importedEvents = destination.app.repository.events(conversation.id)
  const importedResolution = importedEvents.find(event => event.type === 'action.resolved' && event.payload.action_type === 'take')
  assert.ok(importedEvents.some(event => event.event_uid === importedResolution.causation_id))
  assert.notEqual(importedResolution.causation_id, sourceResolution.causation_id)
  assert.notEqual(importedResolution.correlation_id, sourceResolution.correlation_id)
})

await test('full backups and Character Card V3 exports remain portable but exclude credentials', async t => {
  const { app } = await testApp(t)
  const secret = 'secret-that-must-not-appear-in-any-export'
  app.providers.createConnection({
    provider_id: 'deepseek', label: 'Private connection', api_key: secret,
    base_url: 'https://api.deepseek.com', default_model: 'deepseek-chat',
  })
  const backup = app.sharing.exportBackup()
  const serialized = JSON.stringify(backup)
  assert.equal(backup.kind, 'backup')
  assert.equal(backup.privacy.credentials_included, false)
  assert.equal(backup.privacy.provider_connections_included, false)
  assert.doesNotMatch(serialized, new RegExp(secret))
  assert.doesNotMatch(serialized, /secret_envelope|api_key/i)

  const card = app.sharing.toCharacterCardV3(SAMPLE_IDS.mira)
  assert.equal(card.spec, 'chara_card_v3')
  assert.equal(card.spec_version, '3.0')
  assert.equal(card.data.name, 'Mira Vale')
})

await test('portable pack imports roll back all database content when event replay fails', async t => {
  const source = await testApp(t)
  await source.app.turns.run(SAMPLE_IDS.conversation, { content: 'Take the archive key.' })
  const pack = source.app.sharing.exportConversation(SAMPLE_IDS.conversation)
  const destination = await testApp(t, { HT_SEED_SAMPLE_CONVERSATION: 'false' })
  const before = {
    characters: destination.app.repository.listCharacters().length,
    stories: destination.app.repository.listStories().length,
    conversations: destination.app.repository.listConversations().length,
    receipts: destination.app.db.raw.prepare('SELECT COUNT(*) AS count FROM import_receipts').get().count,
  }
  const appendEvent = destination.app.db.appendEvent.bind(destination.app.db)
  destination.app.db.appendEvent = input => {
    if (input.type === 'action.resolved') throw new Error('simulated event replay failure')
    return appendEvent(input)
  }

  assert.throws(
    () => destination.app.sharing.import(pack, { strategy: 'copy', source_name: 'broken-playthrough.tavern.json' }),
    /simulated event replay failure/,
  )
  assert.equal(destination.app.repository.listCharacters().length, before.characters)
  assert.equal(destination.app.repository.listStories().length, before.stories)
  assert.equal(destination.app.repository.listConversations().length, before.conversations)
  assert.equal(destination.app.db.raw.prepare('SELECT COUNT(*) AS count FROM import_receipts').get().count, before.receipts)
})

await test('a post-commit Story source failure is returned and retained as a repair warning', async t => {
  const source = await testApp(t)
  const pack = source.app.sharing.exportStory(SAMPLE_IDS.story)
  const destination = await testApp(t, { HT_SEED_SAMPLE_CONVERSATION: 'false' })
  destination.app.storySources.syncRuntimeStory = () => { throw new Error('simulated filesystem failure') }

  const imported = destination.app.sharing.import(pack, { strategy: 'copy', source_name: 'source-warning.tavern.json' })
  assert.equal(imported.result.stories.length, 1)
  assert.match(imported.result.source_sync_warnings[0].message, /simulated filesystem failure/)
  const receipt = destination.app.repository.listImports().find(item => item.id === imported.receipt.id)
  assert.match(receipt.result.source_sync_warnings[0].message, /simulated filesystem failure/)
})
