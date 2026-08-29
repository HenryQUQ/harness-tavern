#!/usr/bin/env node
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, extname, join, resolve } from 'node:path'
import { loadStorySourcePath, writeStoryProject } from '../src/story/source.js'
import { stableStringify } from '../src/util.js'

const [command = 'help', input, output] = process.argv.slice(2)

function usage() {
  console.log(`Harness Tavern editable Story source tools

Usage:
  npm run story:validate -- <story.tavern.json|project-directory>
  npm run story:import -- <story.tavern.json|project-directory>
  npm run story:export -- <story-id-or-key> <output-file-or-directory> [--project]

story:import links the editable file or project in place. Edit the files and run
the command again to validate and rebuild the SQLite runtime projection.`)
}

function pretty(value) {
  return `${JSON.stringify(JSON.parse(stableStringify(value)), null, 2)}\n`
}

async function withApp(run) {
  const { createApp } = await import('../src/app.js')
  const sink = { log() {}, warn: console.warn, error: console.error }
  const app = createApp({ loggerSink: sink })
  try { return await run(app) } finally { await app.close() }
}

try {
  if (command === 'help' || command === '--help' || command === '-h') {
    usage()
  } else if (command === 'validate') {
    if (!input) throw new Error('A Story source file or project directory is required')
    const loaded = loadStorySourcePath(input)
    console.log(JSON.stringify({
      valid: true,
      format: loaded.source.format,
      format_version: loaded.source.format_version,
      story_key: loaded.source.story_key,
      title: loaded.source.story.title,
      source_kind: loaded.kind,
      characters: loaded.source.characters.length,
      scenes: loaded.source.scenes?.length ?? 0,
      manifest: loaded.manifestPath,
    }, null, 2))
  } else if (command === 'import') {
    if (!input) throw new Error('A Story source file or project directory is required')
    await withApp(async app => {
      const compiled = app.storySources.compilePath(input, { strategy: 'replace' })
      console.log(JSON.stringify({
        imported: true,
        story_id: compiled.story.id,
        story_key: compiled.source.story_key,
        title: compiled.story.title,
        characters: compiled.characters.map(character => ({ id: character.id, name: character.name })),
      }, null, 2))
    })
  } else if (command === 'export') {
    if (!input || !output) throw new Error('A Story id/key and output path are required')
    await withApp(async app => {
      const { source } = app.storySources.get(input)
      const target = resolve(output)
      if (process.argv.includes('--project')) {
        const result = writeStoryProject(source, target)
        console.log(JSON.stringify({ exported: true, story_key: source.story_key, ...result }, null, 2))
      } else {
        const path = extname(target) ? target : join(target, `${source.story_key}.story.tavern.json`)
        mkdirSync(dirname(path), { recursive: true })
        writeFileSync(path, pretty(source), { encoding: 'utf8', mode: 0o600 })
        console.log(JSON.stringify({ exported: true, story_key: source.story_key, path }, null, 2))
      }
    })
  } else {
    usage()
    process.exitCode = 1
  }
} catch (error) {
  console.error(error.stack || error.message)
  process.exitCode = 1
}
