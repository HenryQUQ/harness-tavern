import test from 'node:test'
import assert from 'node:assert/strict'
import { testApp, jsonRequest } from './helpers.js'

function extensionPack(overrides = {}) {
  return {
    format: 'harness-tavern-extension',
    format_version: 1,
    id: 'extension_clockwork_nights',
    slug: 'clockwork-nights',
    name: 'Clockwork Nights',
    version: '1.0.0',
    description: 'A safe declarative pack of creator templates and chat actions.',
    publisher: 'Example Creator',
    capabilities: {
      story_templates: [{ id: 'clockwork-mystery', name: 'Clockwork mystery', description: 'A mystery in a city driven by promises.', defaults: { genre: 'Clockpunk mystery', tone: 'Elegant and tense', cast_size: 3 } }],
      character_templates: [{ id: 'mechanist', name: 'The mechanist', description: 'A practical inventor with divided loyalties.', defaults: { tags: ['mechanist'] } }],
      quick_actions: [{ id: 'listen-machinery', label: 'Listen to the machinery', prompt: 'I pause and listen for changes in the machinery around us.' }],
      themes: [{ id: 'brass', name: 'Brass and midnight', tokens: { surface: '#15131b', accent: '#c59a54' } }],
    },
    ...overrides,
  }
}

await test('built-in declarative extension supplies approachable creator templates', async t => {
  const { app } = await testApp(t)
  const extensions = app.extensions.list()
  assert.ok(extensions.some(item => item.slug === 'tavern-basics'))
  const contributions = app.extensions.contributions()
  assert.ok(contributions.story_templates.some(item => item.id === 'ensemble-mystery'))
  assert.ok(contributions.quick_actions.some(item => /continue/i.test(item.label)))
})

await test('installs a no-code extension and immediately exposes its contributions', async t => {
  const { app } = await testApp(t)
  const installed = app.extensions.install(extensionPack())
  assert.equal(installed.slug, 'clockwork-nights')
  const contributions = app.extensions.contributions()
  assert.ok(contributions.story_templates.some(item => item.id === 'clockwork-mystery'))
  assert.ok(contributions.quick_actions.some(item => item.id === 'listen-machinery'))
  app.extensions.setEnabled(installed.id, false)
  assert.equal(app.extensions.contributions().quick_actions.some(item => item.id === 'listen-machinery'), false)
})

await test('declarative extension validation rejects executable code fields', async t => {
  const { app } = await testApp(t)
  assert.throws(() => app.extensions.install(extensionPack({ script: 'fetch("https://example.com")' })), /executable extension field/i)
  assert.throws(() => app.extensions.install(extensionPack({ capabilities: { quick_actions: [{ label: 'Bad', prompt: 'Hi', javascript: 'alert(1)' }] } })), /executable extension field/i)
})

await test('extension HTTP flow supports install, disable, export, and remove', async t => {
  const { baseUrl } = await testApp(t)
  const installed = await jsonRequest(baseUrl, '/api/extensions', { method: 'POST', body: JSON.stringify(extensionPack()) })
  assert.equal(installed.response.status, 201)
  const extensionId = installed.body.id
  const disabled = await jsonRequest(baseUrl, `/api/extensions/${extensionId}`, { method: 'PATCH', body: JSON.stringify({ enabled: false }) })
  assert.equal(disabled.response.status, 200)
  assert.equal(disabled.body.enabled, false)
  const exported = await jsonRequest(baseUrl, `/api/extensions/${extensionId}/export`)
  assert.equal(exported.response.status, 200)
  assert.equal(exported.body.format, 'harness-tavern-extension')
  const removed = await jsonRequest(baseUrl, `/api/extensions/${extensionId}`, { method: 'DELETE' })
  assert.equal(removed.response.status, 200)
})

await test('installed story templates are usable by the guided creator without technical configuration', async t => {
  const { app } = await testApp(t)
  app.extensions.install(extensionPack())
  const draft = app.creator.generateStoryDraft({ brief: 'The city clock stops and every promise made after midnight begins to come true.', template_id: 'clockwork-mystery' })
  assert.equal(draft.data.genre, 'Clockpunk mystery')
  assert.equal(draft.data.tone, 'Elegant and tense')
  assert.equal(draft.data.characters.length, 3)
})
