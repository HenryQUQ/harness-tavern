import test from 'node:test'
import assert from 'node:assert/strict'
import { testApp, jsonRequest } from './helpers.js'
import { SAMPLE_IDS } from '../src/domain/seed.js'

await test('a Character compatibility export is a single-cast Story pack', async t => {
  const { app } = await testApp(t)
  const pack = app.sharing.exportCharacter(SAMPLE_IDS.mira)
  assert.equal(pack.format, 'harness-tavern-pack')
  assert.equal(pack.kind, 'story')
  assert.equal(pack.items.stories.length, 1)
  assert.ok(pack.integrity.digest)
  const preview = app.sharing.preview(pack)
  assert.equal(preview.counts.characters, 1)
  assert.equal(preview.counts.stories, 1)
  assert.ok(preview.conflicts.some(item => item.type === 'character'))
  const imported = app.sharing.import(pack, { strategy: 'copy', source_name: 'mira.tavernpack' })
  assert.equal(imported.result.characters.length, 1)
  assert.notEqual(imported.result.characters[0].id, SAMPLE_IDS.mira)
  assert.match(imported.result.characters[0].slug, /^mira-vale-/)
  assert.equal(imported.result.stories.length, 1)
  assert.equal(imported.result.stories[0].cast[0].character_id, imported.result.characters[0].id)
})

await test('story packs include their cast and remap every character reference', async t => {
  const { app } = await testApp(t)
  const pack = app.sharing.exportStory(SAMPLE_IDS.story)
  assert.equal(pack.items.characters.length, 3)
  assert.equal(pack.items.stories.length, 1)
  const imported = app.sharing.import(pack, { strategy: 'copy', source_name: 'observatory.tavernpack' })
  assert.equal(imported.result.characters.length, 3)
  assert.equal(imported.result.stories.length, 1)
  const copiedStory = imported.result.stories[0]
  const copiedIds = new Set(imported.result.characters.map(item => item.id))
  assert.ok(copiedStory.cast.every(member => copiedIds.has(member.character_id)))
  assert.ok(copiedStory.scenes.every(scene => (scene.active_character_ids ?? []).every(characterId => copiedIds.has(characterId))))
})

await test('pack integrity rejects modified shared content', async t => {
  const { app } = await testApp(t)
  const pack = app.sharing.exportCharacter(SAMPLE_IDS.mira)
  pack.items.characters[0].name = 'Tampered name'
  assert.throws(() => app.sharing.preview(pack), /integrity/i)
})

await test('SillyTavern Character Card V2 imports through the same friendly preview flow', async t => {
  const { app } = await testApp(t)
  const card = {
    spec: 'chara_card_v2',
    spec_version: '2.0',
    data: {
      name: 'Nell the Cartographer',
      description: 'A travelling mapmaker who marks places that only exist at dusk.',
      personality: 'Curious, dryly funny, cautious with secrets.',
      scenario: 'The user finds Nell redrawing a road that vanished yesterday.',
      first_mes: '“You took the old road, didn’t you?”',
      tags: ['fantasy', 'traveller'],
      extensions: {},
    },
  }
  const preview = app.sharing.preview(card)
  assert.equal(preview.counts.characters, 1)
  assert.equal(preview.counts.stories, 1)
  assert.equal(preview.kind, 'story')
  const imported = app.sharing.import(card, { strategy: 'copy', source_name: 'nell.json' })
  assert.equal(imported.result.characters[0].name, 'Nell the Cartographer')
  assert.match(imported.result.characters[0].first_message, /old road/i)
  assert.equal(imported.result.stories[0].cast[0].character_id, imported.result.characters[0].id)
})

await test('preview share snapshots never reveal story or character private knowledge', async t => {
  const { app } = await testApp(t)
  const share = app.shareLinks.create({ resource_type: 'story', resource_id: SAMPLE_IDS.story, scope: 'preview' })
  const publicView = app.shareLinks.getPublic(share.token)
  const text = JSON.stringify(publicView)
  assert.equal(publicView.can_import, false)
  assert.doesNotMatch(text, /lens fragment in the lining/i)
  assert.doesNotMatch(text, /erased city/i)
  assert.doesNotMatch(text, /private_context/i)
  assert.doesNotMatch(text, /secrets/i)
})

await test('remix links import a complete playable copy while preview links stay read-only', async t => {
  const { app } = await testApp(t)
  const preview = app.shareLinks.create({ resource_type: 'story', resource_id: SAMPLE_IDS.story, scope: 'preview' })
  assert.throws(() => app.shareLinks.import(preview.token, { strategy: 'copy' }), /preview-only/i)
  const remix = app.shareLinks.create({ resource_type: 'story', resource_id: SAMPLE_IDS.story, scope: 'remix' })
  const result = app.shareLinks.import(remix.token, { strategy: 'copy' })
  assert.equal(result.result.stories.length, 1)
  assert.equal(result.result.characters.length, 3)
})

await test('conversation preview shares include only player-visible transcript and cast summaries', async t => {
  const { app } = await testApp(t)
  const share = app.shareLinks.create({ resource_type: 'conversation', resource_id: SAMPLE_IDS.conversation, scope: 'preview' })
  const publicView = app.shareLinks.getPublic(share.token)
  assert.equal(publicView.resource_type, 'conversation')
  assert.equal(publicView.snapshot.kind, 'playthrough-preview')
  assert.equal(publicView.snapshot.characters.length, 3)
  const narration = publicView.snapshot.messages.find(message => message.actor_id === 'narrator')
  assert.ok(narration)
  assert.equal(narration.role, 'narrator')
  assert.ok(narration.participant_ids.includes(SAMPLE_IDS.mira))
  assert.doesNotMatch(JSON.stringify(publicView.snapshot), /private_context|lens fragment in the lining/i)
})

await test('public share previews bypass deployment tokens but copying a remix still requires access', async t => {
  const { app, baseUrl } = await testApp(t, { HT_ACCESS_TOKEN: 'private-tavern' })
  const preview = app.shareLinks.create({ resource_type: 'story', resource_id: SAMPLE_IDS.story, scope: 'preview' })
  const anonymous = await jsonRequest(baseUrl, `/api/public/shares/${preview.token}`)
  assert.equal(anonymous.response.status, 200)
  const remix = app.shareLinks.create({ resource_type: 'story', resource_id: SAMPLE_IDS.story, scope: 'remix' })
  const rejected = await jsonRequest(baseUrl, `/api/shares/${remix.token}/import`, { method: 'POST', body: JSON.stringify({ strategy: 'copy' }) })
  assert.equal(rejected.response.status, 401)
  const accepted = await jsonRequest(baseUrl, `/api/shares/${remix.token}/import`, {
    method: 'POST',
    headers: { 'x-harness-tavern-token': 'private-tavern' },
    body: JSON.stringify({ strategy: 'copy' }),
  })
  assert.equal(accepted.response.status, 201)
})

await test('revoked and expired share links fail closed', async t => {
  const { app } = await testApp(t)
  const revoked = app.shareLinks.create({ resource_type: 'story', resource_id: SAMPLE_IDS.story, scope: 'preview' })
  app.shareLinks.revoke(revoked.id)
  assert.throws(() => app.shareLinks.getPublic(revoked.token), /not found|revoked/i)
  const expired = app.shareLinks.create({ resource_type: 'story', resource_id: SAMPLE_IDS.story, scope: 'preview' })
  app.db.raw.prepare('UPDATE content_shares SET expires_at = ? WHERE token_hash = ?').run('2000-01-01T00:00:00.000Z', expired.id)
  assert.throws(() => app.shareLinks.getPublic(expired.token), /expired/i)
})
