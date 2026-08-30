import { loadConfig } from './config.js'
import { createLogger } from './logger.js'
import { Database } from './storage/database.js'
import { CredentialVault } from './storage/vault.js'
import { TavernRepository } from './domain/repository.js'
import { seedDemo } from './domain/seed.js'
import { ProviderRegistry } from './providers/registry.js'
import { AccountConnectionRegistry } from './account/registry.js'
import { ExtensionRegistry } from './extensions/registry.js'
import { CreatorService } from './domain/creator.js'
import { GenerationPresetRegistry } from './domain/generation-config.js'
import { SharingService } from './sharing/pack.js'
import { ShareLinkService } from './sharing/links.js'
import { StorySourceService } from './story/source.js'
import { ContextBuilder } from './runtime/context-builder.js'
import { TurnRuntime } from './runtime/turn-runtime.js'
import { SillyTavernMigrationService } from './migrations/sillytavern.js'
import { createHttpServer } from './server/http.js'

export function createApp({ env = process.env, loggerSink = console } = {}) {
  const config = loadConfig(env)
  const logger = createLogger(config.logLevel, loggerSink)
  const db = new Database(config.databasePath)
  const vault = new CredentialVault(config.keyPath)
  const repository = new TavernRepository(db)
  const providers = new ProviderRegistry({ db, vault, config })
  const accounts = new AccountConnectionRegistry({ db, vault, config })
  const extensions = new ExtensionRegistry({ db })
  const storySources = new StorySourceService({ repository, config, logger })
  const creator = new CreatorService({ repository, extensions, storySources })
  const generationPresets = new GenerationPresetRegistry({ db })
  const sharing = new SharingService({ repository, extensions, storySources, config })
  const shareLinks = new ShareLinkService({ db, repository, packs: sharing, config })
  const migrations = new SillyTavernMigrationService({ db, repository, sharing, generationPresets, storySources })
  const contextBuilder = new ContextBuilder({ repository })
  const turns = new TurnRuntime({ db, repository, providers, contextBuilder, logger })
  const app = { config, logger, db, vault, repository, providers, accounts, extensions, creator, generationPresets, sharing, storySources, shareLinks, migrations, contextBuilder, turns }
  seedDemo({ db, repository, includeConversation: config.seedSampleConversation })
  app.storySourceStatus = storySources.bootstrap()
  const server = createHttpServer(app)
  return {
    ...app,
    server,
    async listen() {
      await new Promise((resolve, reject) => {
        server.once('error', reject)
        server.listen(config.port, config.host, resolve)
      })
      const address = server.address()
      logger.info('server.started', { url: config.publicUrl, host: config.host, port: typeof address === 'object' ? address.port : config.port })
      return address
    },
    async close() {
      if (server.listening) await new Promise(resolve => server.close(resolve))
      db.close()
    },
  }
}
