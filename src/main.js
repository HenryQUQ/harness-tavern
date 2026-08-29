#!/usr/bin/env node
import { createApp } from './app.js'
import { seedDemo } from './domain/seed.js'
import { PRODUCT_VERSION } from './version.js'

const command = process.argv[2] || 'serve'
const app = createApp()

async function shutdown(code = 0) {
  try { await app.close() } finally { process.exit(code) }
}
process.on('SIGINT', () => void shutdown(130))
process.on('SIGTERM', () => void shutdown(0))

try {
  if (command === 'serve') {
    await app.listen()
  } else if (command === 'doctor') {
    console.log(JSON.stringify({
      version: PRODUCT_VERSION,
      database: app.config.databasePath,
      integrity: app.db.integrityCheck(),
      provider_connections: app.providers.listConnections().length,
      account_connections: app.accounts.list().length,
      extensions: app.extensions.list().length,
      characters: app.repository.listCharacters().length,
      stories: app.repository.listStories().length,
      playthroughs: app.repository.listPlaythroughs().length,
      conversations: app.repository.listConversations({ includeArchived: true }).length,
      drafts: app.repository.listDrafts().length,
    }, null, 2))
    await app.close()
  } else if (command === 'seed') {
    console.log(JSON.stringify(seedDemo({
      db: app.db,
      repository: app.repository,
      force: process.argv.includes('--force'),
      includeConversation: process.argv.includes('--with-conversation'),
    }), null, 2))
    await app.close()
  } else {
    throw new Error(`Unknown command: ${command}`)
  }
} catch (error) {
  console.error(error.stack || error.message)
  try { await app.close() } catch {}
  process.exitCode = 1
}
