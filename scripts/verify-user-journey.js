#!/usr/bin/env node
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createApp } from '../src/app.js'
import { SAMPLE_IDS } from '../src/domain/seed.js'
import { EXTENSION_FORMAT, EXTENSION_VERSION, PRODUCT_VERSION } from '../src/version.js'

function quietSink() { return { log() {}, info() {}, warn() {}, error() {}, debug() {} } }

async function start(label) {
  const dataDir = mkdtempSync(join(tmpdir(), `harness-tavern-${label}-`))
  const app = createApp({
    env: { ...process.env, HT_DATA_DIR: dataDir, HT_HOST: '127.0.0.1', HT_PORT: '0', HT_LOG_LEVEL: 'error' },
    loggerSink: quietSink(),
  })
  const address = await app.listen()
  return { app, dataDir, baseUrl: `http://127.0.0.1:${address.port}` }
}

async function request(baseUrl, path, { method = 'GET', body } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await response.text()
  let parsed = null
  try { parsed = text ? JSON.parse(text) : null } catch { parsed = text }
  assert.ok(response.ok, `${method} ${path} failed (${response.status}): ${text}`)
  return parsed
}

const first = await start('journey-a')
const second = await start('journey-b')
const report = { version: PRODUCT_VERSION, started_at: new Date().toISOString(), gates: [] }
const pass = (name, detail = '') => report.gates.push({ name, passed: true, detail })

try {
  const bootstrap = await request(first.baseUrl, '/api/bootstrap')
  assert.equal(bootstrap.user_profile.onboarding_complete, false)
  assert.ok(bootstrap.home.stories.some(item => item.id === SAMPLE_IDS.story))
  pass('fresh-start', 'Demo content and a zero-configuration model are available.')

  const profile = await request(first.baseUrl, '/api/user-profile', {
    method: 'PATCH',
    body: {
      name: 'Avery',
      default_persona_id: SAMPLE_IDS.persona,
      persona_description: 'A curious traveller whose choices remain their own.',
      sync_default_persona: true,
      onboarding_complete: true,
      locale: 'en',
    },
  })
  assert.equal(profile.onboarding_complete, true)
  assert.equal(first.app.repository.getPersona(SAMPLE_IDS.persona).name, 'Avery')
  pass('onboarding', 'A nontechnical user can set identity without touching model settings.')

  const characterDraft = await request(first.baseUrl, '/api/creator/character-drafts', {
    method: 'POST',
    body: {
      name: 'Iona Reed',
      brief: 'A warm but independent night-train conductor who remembers passengers and refuses to flatter them.',
      relationship: 'a recurring companion',
      energy: 'quietly funny and observant',
    },
  })
  const characterPublish = await request(first.baseUrl, `/api/creator/drafts/${encodeURIComponent(characterDraft.id)}/publish`, { method: 'POST', body: {} })
  const character = characterPublish.character
  assert.equal(character.name, 'Iona Reed')
  const characterConversation = await request(first.baseUrl, '/api/conversations', {
    method: 'POST',
    body: { title: 'Night train with Iona', persona_id: SAMPLE_IDS.persona, character_ids: [character.id], thinking_intensity: 'auto' },
  })
  const characterTurn = await request(first.baseUrl, `/api/conversations/${encodeURIComponent(characterConversation.id)}/turn`, {
    method: 'POST',
    body: { content: 'The platform is empty. What did you notice before I arrived?' },
  })
  assert.ok(characterTurn.messages.some(message => message.character_id === character.id))
  pass('guided-character-to-chat', 'One short brief became a persistent character and a working conversation.')

  const storyDraft = await request(first.baseUrl, '/api/creator/story-drafts', {
    method: 'POST',
    body: {
      title: 'The Clockwork Orchard',
      brief: 'Three caretakers wake in an orchard where every fruit contains a memory, but one caretaker has been replacing the memories to prevent a disaster.',
      genre: 'Mystery fantasy',
      tone: 'Intimate, strange and hopeful',
      cast_size: 3,
      player_role: 'A visitor invited to judge which memories should be restored.',
    },
  })
  const storyPublish = await request(first.baseUrl, `/api/creator/drafts/${encodeURIComponent(storyDraft.id)}/publish`, {
    method: 'POST',
    body: { start_playthrough: true, persona_id: SAMPLE_IDS.persona },
  })
  assert.equal(storyPublish.story.cast.length, 3)
  const playConversation = storyPublish.playthrough.conversation
  const storyTurn = await request(first.baseUrl, `/api/conversations/${encodeURIComponent(playConversation.id)}/turn`, {
    method: 'POST',
    body: { content: 'Each of you, tell me what you think changed in the orchard last night.' },
  })
  assert.equal(storyTurn.effective_thinking_intensity, 'high')
  const journal = await request(first.baseUrl, `/api/conversations/${encodeURIComponent(playConversation.id)}`)
  assert.ok(journal.journal)
  assert.doesNotMatch(JSON.stringify(journal.journal), /private_context|director_context|creator_notes/i)
  pass('guided-story-to-playthrough', 'A plain-language brief became a 3-character story, playthrough, turn and player-safe Journal.')

  const templateExtension = await request(first.baseUrl, `/api/extensions/from-story/${encodeURIComponent(storyPublish.story.id)}`, {
    method: 'POST',
    body: { title: 'My memory mystery template', description: 'Reuse the cast structure without copying the finished story.' },
  })
  const templateId = templateExtension.template.id
  const secondDraft = await request(first.baseUrl, '/api/creator/story-drafts', {
    method: 'POST',
    body: { template_id: templateId, brief: 'A flooded library where three divers disagree about which sealed room should be opened.', title: 'Below the Silent Stacks' },
  })
  assert.equal(secondDraft.data.characters.length, 3)
  assert.ok(secondDraft.data.world_rules.length >= storyPublish.story.world_rules.length)
  pass('no-code-extensibility', 'A finished story became a reusable creation template without JSON or code.')

  const extensionPack = {
    format: EXTENSION_FORMAT,
    format_version: EXTENSION_VERSION,
    id: 'extension_gentle_prompts',
    slug: 'gentle-prompts',
    name: 'Gentle prompts',
    version: '1.0.0',
    description: 'Adds one friendly story starter.',
    publisher: 'Journey test',
    capabilities: {
      story_templates: [{ id: 'gentle-mystery', name: 'Gentle mystery', description: 'Low-conflict mystery for relationship-focused play.', defaults: { genre: 'Cozy mystery', tone: 'Gentle and curious', cast_size: 2 } }],
      quick_actions: [{ id: 'check-in', label: 'Check in', prompt: 'I pause and ask how everyone is feeling about the situation.' }],
    },
  }
  const preview = await request(first.baseUrl, '/api/extensions/preview', { method: 'POST', body: extensionPack })
  assert.equal(preview.counts.story_templates, 1)
  assert.match(preview.warnings.join(' '), /cannot execute code/i)
  const installed = await request(first.baseUrl, '/api/extensions', { method: 'POST', body: extensionPack })
  assert.equal(installed.name, 'Gentle prompts')
  pass('safe-add-on', 'A declarative add-on was previewed before installation and could not execute code.')

  const libraryResponse = await fetch(`${first.baseUrl}/api/exports/library`)
  assert.equal(libraryResponse.status, 200)
  const libraryPack = await libraryResponse.json()
  const importPreview = await request(second.baseUrl, '/api/import/preview', { method: 'POST', body: { content: libraryPack } })
  assert.ok(importPreview.counts.stories >= 2)
  const imported = await request(second.baseUrl, '/api/import/apply', { method: 'POST', body: { content: libraryPack, strategy: 'copy', source_name: 'cold-journey-library' } })
  assert.ok(imported.result.stories.length >= 2)
  assert.ok(imported.result.characters.length >= 4)
  pass('portable-library', 'A complete library exported from one fresh instance and imported into another.')

  const share = await request(first.baseUrl, '/api/shares', {
    method: 'POST',
    body: { resource_type: 'story', resource_id: storyPublish.story.id, scope: 'remix', expires_in_days: 7 },
  })
  const publicShare = await request(first.baseUrl, `/api/public/shares/${encodeURIComponent(share.token)}`)
  assert.equal(publicShare.resource_type, 'story')
  assert.equal(publicShare.scope, 'remix')
  const remix = await request(first.baseUrl, `/api/shares/${encodeURIComponent(share.token)}/import`, { method: 'POST', body: { strategy: 'copy' } })
  assert.equal(remix.result.stories.length, 1)
  const shares = await request(first.baseUrl, '/api/shares')
  assert.ok(shares.some(item => item.token_hash === share.token_hash && item.token === undefined))
  await request(first.baseUrl, `/api/shares/${encodeURIComponent(share.token_hash)}`, { method: 'DELETE' })
  const revoked = await fetch(`${first.baseUrl}/api/public/shares/${encodeURIComponent(share.token)}`)
  assert.equal(revoked.status, 410)
  pass('controlled-sharing', 'Preview/remix link works, management hides the token, and revocation is immediate.')

  const health = await request(first.baseUrl, '/api/health')
  assert.deepEqual(health.database, ['ok'])
  pass('database-integrity', 'SQLite integrity check returned ok after the full journey.')

  report.passed = true
  report.completed_at = new Date().toISOString()
  console.log(JSON.stringify(report, null, 2))
} finally {
  await first.app.close().catch(() => {})
  await second.app.close().catch(() => {})
  rmSync(first.dataDir, { recursive: true, force: true })
  rmSync(second.dataDir, { recursive: true, force: true })
}
