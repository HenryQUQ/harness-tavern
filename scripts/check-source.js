#!/usr/bin/env node
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { extname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const ignoredDirectories = new Set(['.git', '.ht-data', 'coverage', 'node_modules', 'release'])
const requiredFiles = [
  '.editorconfig', '.gitattributes', '.gitignore', '.nvmrc',
  'CONTRIBUTING.md', 'LICENSE', 'README.md', 'SECURITY.md',
  'package-lock.json', 'package.json',
]
const jsonExtensions = new Set(['.json', '.webmanifest'])
const failures = []

function filesUnder(directory) {
  const output = []
  for (const name of readdirSync(directory)) {
    if (ignoredDirectories.has(name)) continue
    const path = join(directory, name)
    const stat = statSync(path)
    if (stat.isDirectory()) output.push(...filesUnder(path))
    else output.push(path)
  }
  return output
}

function fail(path, message) {
  failures.push(`${relative(root, path) || path}: ${message}`)
}

const files = filesUnder(root)
const textFiles = []
for (const path of files) {
  const buffer = readFileSync(path)
  if (buffer.includes(0)) continue
  const source = buffer.toString('utf8')
  textFiles.push({ path, source })
  if (!source.endsWith('\n')) fail(path, 'must end with a newline')
  if (source.includes('\r')) fail(path, 'must use LF line endings')
  if (extname(path) !== '.md') {
    const trailingLine = source.split('\n').findIndex(line => /[\t ]+$/.test(line))
    if (trailingLine >= 0) fail(path, `has trailing whitespace on line ${trailingLine + 1}`)
  }
  if (/^(?:<{7}|={7}|>{7})(?: |$)/m.test(source)) fail(path, 'contains an unresolved merge marker')
  if (jsonExtensions.has(extname(path))) {
    try { JSON.parse(source) } catch (error) { fail(path, `invalid JSON: ${error.message}`) }
  }
}

for (const path of files.filter(path => extname(path) === '.js')) {
  const result = spawnSync(process.execPath, ['--check', path], { encoding: 'utf8' })
  if (result.status !== 0) fail(path, (result.stderr || result.stdout).trim())
}

for (const name of requiredFiles) {
  if (!files.some(path => relative(root, path) === name)) fail(name, 'required repository file is missing')
}

const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const lock = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8'))
const versionSource = readFileSync(join(root, 'src/version.js'), 'utf8')
const productVersion = versionSource.match(/PRODUCT_VERSION\s*=\s*['"]([^'"]+)/)?.[1]
if (pkg.version !== lock.version || pkg.version !== lock.packages?.['']?.version) fail('package-lock.json', 'root package version does not match package.json')
if (pkg.version !== productVersion) fail('src/version.js', 'PRODUCT_VERSION does not match package.json')

for (const { path, source } of textFiles.filter(item => /\.github\/workflows\/.*\.ya?ml$/.test(item.path))) {
  for (const match of source.matchAll(/^\s*uses:\s*([^@\s]+)@([^\s#]+)/gm)) {
    if (match[1].startsWith('./')) continue
    if (!/^[a-f0-9]{40}$/.test(match[2])) fail(path, `third-party action ${match[1]} must be pinned to a full commit SHA`)
  }
}

const secretPatterns = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /\bgithub_pat_[A-Za-z0-9_]{40,}\b/,
  /\bghp_[A-Za-z0-9]{36,}\b/,
  /\bsk-ant-[A-Za-z0-9_-]{40,}\b/,
  /\bsk-(?:proj-)?[A-Za-z0-9_-]{48,}\b/,
]
for (const { path, source } of textFiles) {
  if (secretPatterns.some(pattern => pattern.test(source))) fail(path, 'contains material resembling a live credential')
}

if (failures.length) {
  console.error(`Source check failed with ${failures.length} issue(s):\n- ${failures.join('\n- ')}`)
  process.exit(1)
}

console.log(`Source check passed: ${files.length} files, ${files.filter(path => extname(path) === '.js').length} JavaScript files.`)
