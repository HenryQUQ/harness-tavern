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

await test('a story author can save a finished story as a reusable no-code template', async t => {
  const { app } = await testApp(t)
  const story = app.repository.getStory(SAMPLE_IDS.story)
  const saved = app.extensions.createStoryTemplate(story, { name: 'Three-way mystery pattern' })
  assert.equal(saved.template.name, 'Three-way mystery pattern')
  assert.equal(saved.template.defaults.cast_size, 3)
  const draft = app.creator.generateStoryDraft({
    template_id: saved.template.id,
    brief: 'A new mystery unfolds inside a lighthouse that only appears during eclipses.',
    title: 'The Eclipse Lighthouse',
  })
  assert.equal(draft.data.cast.length, 3)
  assert.ok(draft.data.world_rules.includes(story.world_rules[0]))
  assert.equal(draft.data.cast[1].role, story.cast[1].role)
  assert.equal(draft.data.cast[1].private_context, story.cast[1].private_context)
})

await test('story-template creation is available through the friendly HTTP journey', async t => {
  const { baseUrl } = await testApp(t)
  const saved = await jsonRequest(baseUrl, `/api/extensions/from-story/${SAMPLE_IDS.story}`, {
    method: 'POST',
    body: JSON.stringify({ name: 'Observatory-style ensemble' }),
  })
  assert.equal(saved.response.status, 201)
  const draft = await jsonRequest(baseUrl, '/api/creator/story-drafts', {
    method: 'POST',
    body: JSON.stringify({ template_id: saved.body.template.id, brief: 'Three diplomats are trapped in a silent orbital embassy.' }),
  })
  assert.equal(draft.response.status, 201)
  assert.equal(draft.body.data.characters.length, 3)
  assert.equal(draft.body.data.cast[0].role, saved.body.template.defaults.cast_blueprint[0].role)
})

await test('a complete Tavern library exports and imports through the same preview flow', async t => {
  const source = await testApp(t)
  source.app.creator.generateCharacterDraft({ brief: 'A patient ferry captain who remembers every passenger.' })
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
  assert.match(js, /Tavern story packs and SillyTavern Character Card JSON are supported/i)
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
