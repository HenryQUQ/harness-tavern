import { homedir } from 'node:os'
import { resolve } from 'node:path'
import { parseBoolean } from './util.js'

function positiveInteger(value, fallback, name) {
  const parsed = Number(value ?? fallback)
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error(`${name} must be a positive integer`)
  return parsed
}

export function loadConfig(env = process.env) {
  const dataDir = resolve(env.HT_DATA_DIR || `${homedir()}/.harness-tavern`)
  const host = env.HT_HOST || '127.0.0.1'
  const port = Number(env.HT_PORT || 8787)
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('HT_PORT must be a valid TCP port')
  const isLoopback = ['127.0.0.1', '::1', 'localhost'].includes(host)
  const accessToken = env.HT_ACCESS_TOKEN || ''
  if (!isLoopback && !accessToken) throw new Error('HT_ACCESS_TOKEN is required for non-loopback binding')
  return Object.freeze({
    dataDir,
    databasePath: resolve(env.HT_DATABASE_PATH || `${dataDir}/tavern.sqlite3`),
    keyPath: resolve(env.HT_KEY_PATH || `${dataDir}/credentials.key`),
    storySourceDir: resolve(env.HT_STORY_SOURCE_DIR || `${dataDir}/stories`),
    host,
    port,
    publicUrl: env.HT_PUBLIC_URL || `http://${host === '0.0.0.0' ? '127.0.0.1' : host}:${port}`,
    accessToken,
    logLevel: env.HT_LOG_LEVEL || 'info',
    trustProxy: parseBoolean(env.HT_TRUST_PROXY),
    requestBodyLimit: positiveInteger(env.HT_REQUEST_BODY_LIMIT, 8_000_000, 'HT_REQUEST_BODY_LIMIT'),
    migrationBodyLimit: positiveInteger(env.HT_MIGRATION_BODY_LIMIT, 128_000_000, 'HT_MIGRATION_BODY_LIMIT'),
    providerTimeoutMs: positiveInteger(env.HT_PROVIDER_TIMEOUT_MS, 120_000, 'HT_PROVIDER_TIMEOUT_MS'),
    modelCatalogTtlMs: positiveInteger(env.HT_MODEL_CATALOG_TTL_MS, 900_000, 'HT_MODEL_CATALOG_TTL_MS'),
    seedSampleConversation: parseBoolean(env.HT_SEED_SAMPLE_CONVERSATION),
    openRouterClientName: env.HT_OPENROUTER_APP_NAME || 'Harness Tavern',
    openRouterSiteUrl: env.HT_OPENROUTER_SITE_URL || env.HT_PUBLIC_URL || `http://${host === '0.0.0.0' ? '127.0.0.1' : host}:${port}`,
  })
}
