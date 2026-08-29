#!/usr/bin/env node
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { basename, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const source = resolve(fileURLToPath(new URL('..', import.meta.url)))
const targetRoot = resolve(process.argv[2] || '')
if (!process.argv[2]) {
  console.error('Usage: node scripts/install-into-deepseek-harness.js /path/to/deepseek-harness')
  process.exit(2)
}
const packagePath = join(targetRoot, 'package.json')
if (!existsSync(packagePath) || !existsSync(join(targetRoot, 'packages', 'core', 'agent-loop'))) {
  console.error('Target does not look like a DeepSeek Harness checkout.')
  process.exit(2)
}
const pkg = JSON.parse(readFileSync(packagePath, 'utf8'))
if (pkg.name !== '@deepseek-ai/dsh-root') {
  console.error(`Unexpected upstream package name: ${pkg.name || '(missing)'}`)
  process.exit(2)
}
const destination = join(targetRoot, 'products', 'harness-tavern')
mkdirSync(join(targetRoot, 'products'), { recursive: true })
rmSync(destination, { recursive: true, force: true })
cpSync(source, destination, {
  recursive: true,
  filter(path) {
    const rel = relative(source, path).replaceAll('\\', '/')
    if (!rel) return true
    return rel !== '.git' && !rel.startsWith('.git/')
      && rel !== 'release' && !rel.startsWith('release/')
      && rel !== '.ht-data' && !rel.startsWith('.ht-data/')
      && rel !== 'node_modules' && !rel.startsWith('node_modules/')
  },
})
const receipt = {
  product: 'Harness Tavern',
  version: JSON.parse(readFileSync(join(source, 'package.json'), 'utf8')).version,
  installed_at: new Date().toISOString(),
  upstream_package: pkg.name,
  upstream_version: pkg.version,
  source_directory: basename(source),
  destination: 'products/harness-tavern',
  integration: 'isolated-product-surface',
}
writeFileSync(join(destination, 'product-integration.json'), `${JSON.stringify(receipt, null, 2)}\n`)
console.log(JSON.stringify({ ...receipt, absolute_destination: destination }, null, 2))
console.log('\nStart the Tavern product with:')
console.log(`  cd ${JSON.stringify(destination)}`)
console.log('  npm start')
