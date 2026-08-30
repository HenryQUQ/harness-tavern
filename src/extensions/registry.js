import { assert, cleanText, id, json, nowIso, plainObject, slugify, stableStringify, uniqueStrings } from '../util.js'
import { EXTENSION_FORMAT, EXTENSION_VERSION } from '../version.js'

const CAPABILITIES = new Set(['story_templates', 'character_templates', 'quick_actions', 'themes'])
const FORBIDDEN_KEYS = new Set(['script', 'scripts', 'javascript', 'code', 'eval', 'module', 'entrypoint', '__proto__', 'prototype', 'constructor'])

const BUILTIN_MANIFEST = Object.freeze({
  format: EXTENSION_FORMAT,
  format_version: EXTENSION_VERSION,
  id: 'extension_tavern_basics',
  slug: 'tavern-basics',
  name: 'Tavern Foundation',
  version: '1.0.0',
  description: 'Base presentation tokens. Creative behaviors and content belong to optional extensions.',
  publisher: 'Harness Tavern',
  capabilities: {
    character_templates: [],
    story_templates: [],
    quick_actions: [],
    themes: [
      { id: 'midnight', name: 'Midnight Tavern', tokens: { surface: '#17151f', accent: '#9f8cff', warmth: '#e2b984' } },
      { id: 'parchment', name: 'Parchment', tokens: { surface: '#f4ecdc', accent: '#7a4d35', warmth: '#b36b3d' } },
    ],
  },
})

function rejectExecutable(value, path = 'manifest') {
  if (Array.isArray(value)) {
    value.forEach((item, index) => rejectExecutable(item, `${path}[${index}]`))
    return
  }
  if (!plainObject(value)) return
  for (const [key, child] of Object.entries(value)) {
    assert(!FORBIDDEN_KEYS.has(key.toLowerCase()), `Executable extension field is not allowed: ${path}.${key}`)
    rejectExecutable(child, `${path}.${key}`)
  }
}

function normalizeTemplate(value, index, kind) {
  assert(plainObject(value), `${kind} template ${index + 1} must be an object`)
  return {
    id: slugify(value.id || value.name || `${kind}-${index + 1}`),
    name: cleanText(value.name || value.id || `${kind} template`, 120),
    description: cleanText(value.description, 1000),
    defaults: plainObject(value.defaults) ? structuredClone(value.defaults) : {},
  }
}

function normalizeQuickAction(value, index) {
  assert(plainObject(value), `Quick action ${index + 1} must be an object`)
  return {
    id: slugify(value.id || value.label || `action-${index + 1}`),
    label: cleanText(value.label || value.name, 80),
    prompt: cleanText(value.prompt, 3000),
  }
}

function normalizeTheme(value, index) {
  assert(plainObject(value), `Theme ${index + 1} must be an object`)
  const tokens = plainObject(value.tokens) ? value.tokens : {}
  const safeTokens = {}
  for (const [key, token] of Object.entries(tokens).slice(0, 30)) {
    if (/^[a-z][a-z0-9_-]{0,40}$/i.test(key)) safeTokens[key] = cleanText(String(token), 100)
  }
  return { id: slugify(value.id || value.name || `theme-${index + 1}`), name: cleanText(value.name, 120), tokens: safeTokens }
}

export function normalizeExtensionManifest(input) {
  assert(plainObject(input), 'Extension pack must be a JSON object')
  rejectExecutable(input)
  assert(input.format === EXTENSION_FORMAT, `Extension format must be ${EXTENSION_FORMAT}`)
  assert(Number(input.format_version) === EXTENSION_VERSION, `Unsupported extension format version: ${input.format_version}`)
  const capabilities = plainObject(input.capabilities) ? input.capabilities : {}
  for (const key of Object.keys(capabilities)) assert(CAPABILITIES.has(key), `Unsupported extension capability: ${key}`)
  return {
    format: EXTENSION_FORMAT,
    format_version: EXTENSION_VERSION,
    id: cleanText(input.id, 160) || id('extension'),
    slug: slugify(input.slug || input.name || input.id, 'extension'),
    name: cleanText(input.name, 160) || 'Untitled extension',
    version: cleanText(input.version, 60) || '1.0.0',
    description: cleanText(input.description, 3000),
    publisher: cleanText(input.publisher, 160),
    homepage: cleanText(input.homepage, 1000),
    tags: uniqueStrings(input.tags, 30, 80),
    capabilities: {
      story_templates: (capabilities.story_templates ?? []).slice(0, 50).map((item, index) => normalizeTemplate(item, index, 'story')),
      character_templates: (capabilities.character_templates ?? []).slice(0, 50).map((item, index) => normalizeTemplate(item, index, 'character')),
      quick_actions: (capabilities.quick_actions ?? []).slice(0, 100).map(normalizeQuickAction).filter(item => item.label && item.prompt),
      themes: (capabilities.themes ?? []).slice(0, 20).map(normalizeTheme).filter(item => item.name),
    },
  }
}

function fromRow(row) {
  if (!row) return null
  return { ...row, enabled: Boolean(row.enabled), manifest: json(row.manifest_json, {}), manifest_json: undefined }
}

export class ExtensionRegistry {
  constructor({ db }) {
    this.db = db
    this.install(BUILTIN_MANIFEST, { source: 'builtin', enabled: true })
  }

  list() {
    return this.db.raw.prepare('SELECT * FROM extensions ORDER BY CASE WHEN source = \'builtin\' THEN 0 ELSE 1 END, name COLLATE NOCASE')
      .all().map(fromRow)
  }

  get(extensionId) {
    const row = this.db.raw.prepare('SELECT * FROM extensions WHERE id = ? OR slug = ?').get(extensionId, extensionId)
    assert(row, 'Extension not found', 404, 'not_found')
    return fromRow(row)
  }

  preview(input) {
    const manifest = normalizeExtensionManifest(input)
    const existing = this.db.raw.prepare('SELECT id, name, version FROM extensions WHERE slug = ?').get(manifest.slug)
    const counts = Object.fromEntries(Object.entries(manifest.capabilities).map(([key, values]) => [key, values.length]))
    return {
      manifest,
      existing: existing ?? null,
      counts,
      warnings: [
        'This extension is declarative: it can contribute optional data blueprints, composer actions, and themes, but it cannot execute code. Core Library creation never treats blueprints as generation instructions.',
        ...(existing ? [`An installed extension named “${existing.name}” will be updated.`] : []),
      ],
    }
  }

  install(input, { source = 'import', enabled = true } = {}) {
    const manifest = normalizeExtensionManifest(input)
    const existing = this.db.raw.prepare('SELECT * FROM extensions WHERE slug = ?').get(manifest.slug)
    const extensionId = existing?.id ?? manifest.id
    const timestamp = nowIso()
    this.db.raw.prepare(`
      INSERT INTO extensions(id, slug, name, version, manifest_json, enabled, source, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(slug) DO UPDATE SET name=excluded.name, version=excluded.version,
        manifest_json=excluded.manifest_json, enabled=excluded.enabled, source=excluded.source, updated_at=excluded.updated_at
    `).run(extensionId, manifest.slug, manifest.name, manifest.version, stableStringify({ ...manifest, id: extensionId }), enabled ? 1 : 0, source, existing?.created_at ?? timestamp, timestamp)
    this.db.audit('extension.installed', 'extension', extensionId, { slug: manifest.slug, source })
    return this.get(extensionId)
  }

  setEnabled(extensionId, enabled) {
    const extension = this.get(extensionId)
    this.db.raw.prepare('UPDATE extensions SET enabled = ?, updated_at = ? WHERE id = ?').run(enabled ? 1 : 0, nowIso(), extension.id)
    return this.get(extension.id)
  }

  remove(extensionId) {
    const extension = this.get(extensionId)
    assert(extension.source !== 'builtin', 'Built-in extensions cannot be removed; disable them instead', 409, 'builtin_extension')
    this.db.raw.prepare('DELETE FROM extensions WHERE id = ?').run(extension.id)
    this.db.audit('extension.removed', 'extension', extension.id)
  }

  contributions() {
    const result = { story_templates: [], character_templates: [], quick_actions: [], themes: [] }
    for (const extension of this.list().filter(item => item.enabled)) {
      for (const capability of CAPABILITIES) {
        for (const item of extension.manifest.capabilities?.[capability] ?? []) {
          result[capability].push({ ...structuredClone(item), extension_id: extension.id, extension_name: extension.name })
        }
      }
    }
    return result
  }

  export(extensionId) {
    return this.get(extensionId).manifest
  }

}

export { BUILTIN_MANIFEST }
