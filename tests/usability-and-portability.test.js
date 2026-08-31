import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { jsonRequest, testApp } from './helpers.js'
import { SAMPLE_IDS } from '../src/domain/seed.js'
import { resolveThinkingIntensity } from '../src/runtime/thinking.js'

function friendlyExtension() {
  return {
    format: 'harness-tavern-extension',
    format_version: 1,
    id: 'extension_rainy_evenings',
    slug: 'rainy-evenings',
    name: 'Rainy Evenings',
    version: '1.0.0',
    description: 'A no-code pack for quiet character stories.',
    publisher: 'A Tavern creator',
    capabilities: {
      story_templates: [{ id: 'quiet-cafe', name: 'A quiet café', description: 'Two people meet while a storm closes the city.', defaults: { genre: 'Slice of life', tone: 'Gentle and observant', cast_size: 2 } }],
      character_templates: [],
      quick_actions: [{ id: 'offer-tea', label: 'Offer tea', prompt: 'I offer them a warm cup of tea.' }],
      themes: [],
    },
  }
}

await test('extension preview explains capabilities before installation', async t => {
  const { baseUrl } = await testApp(t)
  const preview = await jsonRequest(baseUrl, '/api/extensions/preview', { method: 'POST', body: JSON.stringify(friendlyExtension()) })
  assert.equal(preview.response.status, 200)
  assert.equal(preview.body.manifest.name, 'Rainy Evenings')
  assert.equal(preview.body.counts.story_templates, 1)
  assert.equal(preview.body.counts.quick_actions, 1)
  assert.ok(preview.body.warnings.some(message => /cannot (?:run|execute) code/i.test(message)))
})

await test('extension templates remain optional declarative data and do not drive core Library creation', async t => {
  const { app } = await testApp(t)
  app.extensions.install(friendlyExtension())
  assert.ok(app.extensions.contributions().story_templates.some(item => item.id === 'quiet-cafe'))
  const created = app.library.add({
    kind: 'story',
    content: {
      title: 'Explicit empty structure',
      cast: [{ character_id: SAMPLE_IDS.mira }],
    },
  })
  assert.equal(created.item.genre, '')
  assert.equal(created.item.tone, '')
  assert.deepEqual(created.item.world_rules, [])
})

await test('the core refuses to turn a finished Story into an opinionated creation template', async t => {
  const { baseUrl } = await testApp(t)
  const removed = await jsonRequest(baseUrl, `/api/extensions/from-story/${SAMPLE_IDS.story}`, {
    method: 'POST',
    body: JSON.stringify({ name: 'Observatory-style ensemble' }),
  })
  assert.equal(removed.response.status, 410)
  assert.equal(removed.body.error.code, 'core_template_authoring_removed')
})

await test('a complete Tavern library exports and imports through the same preview flow', async t => {
  const source = await testApp(t)
  source.app.library.add({ kind: 'story', content: { title: 'The last ferry', cast: [{ character: { name: 'Ferry captain', description: 'Remembers every passenger.' } }] } })
  const exported = await jsonRequest(source.baseUrl, '/api/exports/library')
  assert.equal(exported.response.status, 200)
  assert.equal(exported.body.kind, 'collection')
  assert.ok(exported.body.items.characters.length >= 3)
  assert.ok(exported.body.items.stories.length >= 1)

  const target = await testApp(t)
  const preview = await jsonRequest(target.baseUrl, '/api/import/preview', {
    method: 'POST', body: JSON.stringify({ content: exported.body }),
  })
  assert.equal(preview.response.status, 200)
  assert.equal(preview.body.kind, 'collection')
  const imported = await jsonRequest(target.baseUrl, '/api/import/apply', {
    method: 'POST', body: JSON.stringify({ content: exported.body, strategy: 'copy', source_name: 'my-tavern-library.tavern.json' }),
  })
  assert.equal(imported.response.status, 201)
  assert.ok(imported.body.result.characters.length >= 3)
  assert.ok(imported.body.result.stories.length >= 1)
  assert.ok(imported.body.result.personas.length >= 1)
})

await test('share links can be listed and revoked without exposing raw database ids', async t => {
  const { baseUrl } = await testApp(t)
  const created = await jsonRequest(baseUrl, '/api/shares', {
    method: 'POST', body: JSON.stringify({ resource_type: 'story', resource_id: SAMPLE_IDS.story, scope: 'preview', expires_in_days: 30 }),
  })
  assert.equal(created.response.status, 201)
  const listed = await jsonRequest(baseUrl, '/api/shares')
  assert.equal(listed.response.status, 200)
  const share = listed.body.find(item => item.token_hash === created.body.token_hash)
  assert.equal(share.title, 'Midnight at the Glass Observatory')
  assert.equal(share.active, true)
  assert.equal(Object.keys(share).includes('token'), false)
  const revoked = await jsonRequest(baseUrl, `/api/shares/${created.body.token_hash}`, { method: 'DELETE' })
  assert.equal(revoked.response.status, 200)
  const publicRead = await jsonRequest(baseUrl, `/api/public/shares/${created.body.token}`)
  assert.equal(publicRead.response.status, 410)
})

await test('automatic thinking increases depth for coordinated three-character turns', () => {
  assert.equal(resolveThinkingIntensity('auto', {
    userMessage: 'Each of you compare what you know, then decide together what we should investigate next.',
    castSize: 3,
    hasStory: true,
    hasWorldState: true,
  }), 'high')
  assert.equal(resolveThinkingIntensity('auto', { userMessage: 'Hello.', castSize: 1 }), 'low')
})

await test('primary import and extension journeys are file-first and hide technical fallbacks', () => {
  const root = fileURLToPath(new URL('../public/', import.meta.url))
  const html = readFileSync(`${root}/index.html`, 'utf8')
  const js = readFileSync(`${root}/app.js`, 'utf8')
  const css = readFileSync(`${root}/styles.css`, 'utf8')
  assert.match(html, /Export my library/i)
  assert.match(html, /Manage share links/i)
  assert.match(js, /SillyTavern JSON\/PNG\/CHARX\/ZIP are supported/i)
  assert.match(js, /Migrate a SillyTavern data folder/i)
  assert.match(js, /Choose extension pack/i)
  assert.match(js, /Paste shared text instead/i)
  assert.match(css, /\.file-drop\s*\{/)
  assert.match(js, /openShareManager/)
})

await test('the public share landing page speaks in Tavern concepts rather than infrastructure terms', () => {
  const root = fileURLToPath(new URL('../public/', import.meta.url))
  const html = readFileSync(`${root}/share.html`, 'utf8')
  assert.match(html, /Shared through Harness Tavern/i)
  assert.doesNotMatch(html, /token hash|database id|provider routing/i)
})
