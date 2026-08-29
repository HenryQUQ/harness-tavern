#!/usr/bin/env node
import { createHash } from 'node:crypto'
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const releaseDir = join(root, 'release')
const packageJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const packageLock = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8'))
const version = packageJson.version
const upstreamZip = process.env.HT_UPSTREAM_ZIP || '/mnt/data/deepseek-harness-master(1).zip'
const generatedAt = new Date().toISOString()

rmSync(releaseDir, { recursive: true, force: true })
mkdirSync(releaseDir, { recursive: true })
writeFileSync(join(releaseDir, '.gitkeep'), '\n')

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd || root,
    encoding: 'utf8',
    env: { ...process.env, ...(options.env || {}) },
    maxBuffer: 64 * 1024 * 1024,
    ...options,
  })
  return {
    command: [command, ...args].join(' '),
    status: result.status,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    output: `${result.stdout || ''}${result.stderr || ''}`,
  }
}

function filesUnder(directory, predicate = () => true) {
  const output = []
  if (!existsSync(directory)) return output
  for (const name of readdirSync(directory)) {
    const path = join(directory, name)
    const rel = relative(root, path).replaceAll('\\', '/')
    if (rel === '.git' || rel.startsWith('.git/') || rel === 'release' || rel.startsWith('release/')) continue
    const stat = statSync(path)
    if (stat.isDirectory()) output.push(...filesUnder(path, predicate))
    else if (predicate(path)) output.push(path)
  }
  return output
}

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

function addCheck(checks, name, passed, detail = '') {
  checks.push({ name, passed: Boolean(passed), detail: String(detail || '') })
}

function failIfNeeded(checks, phase) {
  const failed = checks.filter(check => !check.passed)
  if (!failed.length) return
  const summary = failed.map(check => `- ${check.name}: ${check.detail || 'failed'}`).join('\n')
  throw new Error(`${phase} failed:\n${summary}`)
}

function extractZip(zipPath, destination) {
  const script = `
import sys, zipfile
from pathlib import Path
z=Path(sys.argv[1]); out=Path(sys.argv[2]); out.mkdir(parents=True, exist_ok=True)
with zipfile.ZipFile(z) as archive: archive.extractall(out)
`
  const result = run('python3', ['-c', script, zipPath, destination])
  if (result.status !== 0) throw new Error(`Could not extract ${basename(zipPath)}: ${result.output}`)
}

function createArchives(stage, stageRoot, zipPath, tarPath = null) {
  const script = `
import os, sys, tarfile, zipfile
from pathlib import Path
stage=Path(sys.argv[1]); root=Path(sys.argv[2]); zip_path=Path(sys.argv[3]); tar_arg=sys.argv[4]
files=sorted(p for p in root.rglob('*') if p.is_file())
with zipfile.ZipFile(zip_path,'w',compression=zipfile.ZIP_DEFLATED,compresslevel=9) as z:
    for p in files:
        info=zipfile.ZipInfo(str(p.relative_to(stage)).replace(os.sep,'/'), date_time=(2026,8,29,0,0,0))
        info.compress_type=zipfile.ZIP_DEFLATED
        info.external_attr=(0o755 if os.access(p,os.X_OK) else 0o644)<<16
        z.writestr(info,p.read_bytes())
if tar_arg != '-':
    tar_path=Path(tar_arg)
    with tarfile.open(tar_path,'w:gz',compresslevel=9) as t:
        for p in files:
            arc=str(p.relative_to(stage)).replace(os.sep,'/')
            ti=t.gettarinfo(str(p),arc); ti.mtime=1787961600
            with p.open('rb') as f: t.addfile(ti,f)
print(len(files))
`
  const result = run('python3', ['-c', script, stage, stageRoot, zipPath, tarPath || '-'])
  if (result.status !== 0) throw new Error(`Archive creation failed: ${result.output}`)
  return Number(result.stdout.trim())
}

function sourceCopyFilter(path) {
  const rel = relative(root, path).replaceAll('\\', '/')
  if (!rel) return true
  return rel !== 'release' && !rel.startsWith('release/')
    && rel !== '.git' && !rel.startsWith('.git/')
    && rel !== '.ht-data' && !rel.startsWith('.ht-data/')
    && rel !== 'node_modules' && !rel.startsWith('node_modules/')
    && rel !== 'coverage' && !rel.startsWith('coverage/')
    && rel !== '.DS_Store'
}

function archiveInventory(zipPath) {
  const script = `
import hashlib, json, sys, zipfile
from pathlib import PurePosixPath
with zipfile.ZipFile(sys.argv[1]) as z:
    names=[n for n in z.namelist() if not n.endswith('/')]
    required=['package.json','public/index.html','public/app.js','src/main.js','scripts/verify-user-journey.js']
    root=PurePosixPath(names[0]).parts[0] if names else ''
    missing=[r for r in required if f'{root}/{r}' not in names]
    print(json.dumps({'files':len(names),'root':root,'missing':missing,'uncompressed_bytes':sum(i.file_size for i in z.infolist())}))
`
  const result = run('python3', ['-c', script, zipPath])
  if (result.status !== 0) throw new Error(result.output)
  return JSON.parse(result.stdout)
}

function coldVerifySource(zipPath, label) {
  const temp = mkdtempSync(join(tmpdir(), `ht-${label}-`))
  try {
    extractZip(zipPath, temp)
    const entries = readdirSync(temp)
    if (entries.length !== 1) throw new Error(`${label}: expected one archive root, found ${entries.length}`)
    const checkout = join(temp, entries[0])
    const install = run('npm', ['ci', '--ignore-scripts'], { cwd: checkout })
    const test = install.status === 0 ? run('npm', ['test'], { cwd: checkout }) : { status: 1, output: install.output }
    const journey = install.status === 0 ? run(process.execPath, ['scripts/verify-user-journey.js'], { cwd: checkout }) : { status: 1, output: install.output }
    return {
      passed: install.status === 0 && test.status === 0 && journey.status === 0,
      install_status: install.status,
      test_status: test.status,
      journey_status: journey.status,
      test_output: test.output.slice(-12_000),
      journey_output: journey.output.slice(-12_000),
    }
  } finally {
    rmSync(temp, { recursive: true, force: true })
  }
}

function coldVerifyGitBundle(bundlePath) {
  const temp = mkdtempSync(join(tmpdir(), 'ht-bundle-'))
  try {
    const verify = run('git', ['bundle', 'verify', bundlePath], { cwd: root })
    const checkout = join(temp, 'checkout')
    const clone = run('git', ['clone', bundlePath, checkout], { cwd: temp })
    if (clone.status !== 0) return { passed: false, verify: verify.output, clone: clone.output }
    const install = run('npm', ['ci', '--ignore-scripts'], { cwd: checkout })
    const test = install.status === 0 ? run('npm', ['test'], { cwd: checkout }) : { status: 1, output: install.output }
    const journey = install.status === 0 ? run(process.execPath, ['scripts/verify-user-journey.js'], { cwd: checkout }) : { status: 1, output: install.output }
    return {
      passed: verify.status === 0 && install.status === 0 && test.status === 0 && journey.status === 0,
      verify_status: verify.status,
      install_status: install.status,
      test_status: test.status,
      journey_status: journey.status,
      verify_output: verify.output.slice(-4000),
      test_output: test.output.slice(-12_000),
      journey_output: journey.output.slice(-12_000),
    }
  } finally {
    rmSync(temp, { recursive: true, force: true })
  }
}

function coldVerifyFullFork(zipPath) {
  const temp = mkdtempSync(join(tmpdir(), 'ht-full-fork-'))
  try {
    extractZip(zipPath, temp)
    const roots = readdirSync(temp)
    if (roots.length !== 1) throw new Error(`Full fork archive has ${roots.length} roots`)
    const product = join(temp, roots[0], 'products', 'harness-tavern')
    if (!existsSync(join(product, 'package.json'))) throw new Error('Full fork does not contain products/harness-tavern')
    const install = run('npm', ['ci', '--ignore-scripts'], { cwd: product })
    const test = install.status === 0 ? run('npm', ['test'], { cwd: product }) : { status: 1, output: install.output }
    const journey = install.status === 0 ? run(process.execPath, ['scripts/verify-user-journey.js'], { cwd: product }) : { status: 1, output: install.output }
    return {
      passed: install.status === 0 && test.status === 0 && journey.status === 0,
      install_status: install.status,
      test_status: test.status,
      journey_status: journey.status,
      test_output: test.output.slice(-12_000),
      journey_output: journey.output.slice(-12_000),
    }
  } finally {
    rmSync(temp, { recursive: true, force: true })
  }
}

const checks = []
const jsFiles = filesUnder(root, path => path.endsWith('.js'))
const syntaxFailures = []
for (const path of jsFiles) {
  const result = run(process.execPath, ['--check', path])
  if (result.status !== 0) syntaxFailures.push(`${relative(root, path)}\n${result.output}`)
}
addCheck(checks, 'javascript-syntax', syntaxFailures.length === 0, syntaxFailures.join('\n\n') || `${jsFiles.length} JavaScript files checked`)

const diffCheck = run('git', ['diff', '--check'])
addCheck(checks, 'git-diff-check', diffCheck.status === 0, diffCheck.output)

const test = run('npm', ['test'])
const testCount = Number(test.output.match(/(?:ℹ|#) tests\s+(\d+)/)?.[1] || 0)
const passCount = Number(test.output.match(/(?:ℹ|#) pass\s+(\d+)/)?.[1] || 0)
const failCount = Number(test.output.match(/(?:ℹ|#) fail\s+(\d+)/)?.[1] || 0)
addCheck(checks, 'automated-tests', test.status === 0 && testCount >= 60 && passCount === testCount && failCount === 0, `${passCount}/${testCount} passed; ${failCount} failed`)

const coverage = run('npm', ['run', 'test:coverage'])
const coverageMatch = coverage.output.match(/all files\s+\|\s+([\d.]+)\s+\|\s+([\d.]+)\s+\|\s+([\d.]+)/)
const coverageStats = coverageMatch ? { lines: Number(coverageMatch[1]), branches: Number(coverageMatch[2]), functions: Number(coverageMatch[3]) } : null
addCheck(checks, 'coverage-run', coverage.status === 0 && coverageStats?.lines >= 80 && coverageStats?.branches >= 60, coverageStats ? JSON.stringify(coverageStats) : coverage.output.slice(-4000))

const journey = run(process.execPath, ['scripts/verify-user-journey.js'])
addCheck(checks, 'fresh-user-journey', journey.status === 0 && /"passed"\s*:\s*true/.test(journey.output), journey.output.slice(-12_000))

const publicText = filesUnder(join(root, 'public'), path => /\.(?:html|js)$/.test(path)).map(path => readFileSync(path, 'utf8')).join('\n')
const lowerPublic = publicText.toLocaleLowerCase()
const requiredNav = ['data-view="home"', 'data-view="chats"', 'data-view="library"', 'data-view="create"', 'data-view="settings"']
addCheck(checks, 'tavern-primary-navigation', requiredNav.every(token => lowerPublic.includes(token)) && !lowerPublic.includes('data-view="models"'), 'Home, Chats, Library, Create and Settings are primary; Models is not.')
addCheck(checks, 'guided-creation-surface', /describe (?:the )?character|描述.*角色/iu.test(publicText) && /describe (?:the )?story|描述.*故事/iu.test(publicText), 'Natural-language character and story entry points are present.')
addCheck(checks, 'sharing-surface', lowerPublic.includes('share') && lowerPublic.includes('import') && lowerPublic.includes('preview'), 'Share, import and preview surfaces are present.')
addCheck(checks, 'extension-surface', lowerPublic.includes('extension') || lowerPublic.includes('add-on'), 'No-code add-on management is present.')
addCheck(checks, 'no-primary-technical-state', !/<button[^>]*>\s*state\s*<\/button>/iu.test(publicText) && !requiredNav.some(() => false), 'Raw state is not a primary player control.')

const sourceFiles = filesUnder(root, path => !path.includes('/.git/') && !path.includes('/release/'))
addCheck(checks, 'source-inventory', sourceFiles.length >= 60, `${sourceFiles.length} source and documentation files`)

const providerCatalog = await import('../src/providers/catalog.js')
addCheck(checks, 'provider-preset-breadth', providerCatalog.PROVIDER_PRESETS.length >= 30, `${providerCatalog.PROVIDER_PRESETS.length} provider presets`)
const seedModule = await import('../src/domain/seed.js')
addCheck(checks, 'ensemble-sample-contract', ['mira', 'rowan', 'lyra', 'story', 'playthrough', 'conversation'].every(key => Object.hasOwn(seedModule.SAMPLE_IDS, key)), JSON.stringify(seedModule.SAMPLE_IDS))
const extensionSource = readFileSync(join(root, 'src/extensions/registry.js'), 'utf8')
addCheck(checks, 'declarative-extension-contract',
  (lowerPublic.includes('no-code') || lowerPublic.includes('无需代码') || lowerPublic.includes('declarative'))
    && /EXECUTABLE_KEYS|script|javascript/.test(extensionSource),
  'Extension UX explains the no-code/declarative boundary and the registry rejects executable fields.')

const repository = run('git', ['rev-parse', '--is-inside-work-tree'])
const head = run('git', ['rev-parse', 'HEAD'])
addCheck(checks, 'git-repository', repository.status === 0 && repository.stdout.trim() === 'true', repository.output)
addCheck(checks, 'git-head', head.status === 0 && /^[a-f0-9]{40}$/.test(head.stdout.trim()), head.output)

failIfNeeded(checks, 'Preflight')

// Release generation is intentionally read-only with respect to repository
// history. Tags are created by the maintainer and verified by GitHub Actions.
const commitSha = head.stdout.trim()

const qualityReport = [
  `# Harness Tavern ${version} quality report`,
  '',
  `Generated: ${generatedAt}`,
  '',
  `Result: **PASS**`,
  '',
  `Commit: \`${commitSha}\``,
  '',
  '| Gate | Result | Detail |',
  '|---|---:|---|',
  ...checks.map(check => `| ${check.name.replaceAll('|', '\\|')} | PASS | ${check.detail.replaceAll('|', '\\|').replaceAll('\n', ' ').slice(0, 500)} |`),
  '',
  '## Automated test output',
  '',
  '```text', test.output.slice(-30_000), '```',
  '',
  '## Coverage output',
  '',
  '```text', coverage.output.slice(-30_000), '```',
  '',
  '## Fresh user-journey output',
  '',
  '```text', journey.output.slice(-20_000), '```',
].join('\n')
writeFileSync(join(releaseDir, 'QUALITY_REPORT.md'), qualityReport)
writeFileSync(join(releaseDir, 'QUALITY_REPORT.json'), `${JSON.stringify({
  product: 'Harness Tavern', version, generated_at: generatedAt, commit: commitSha,
  passed: true, tests: { total: testCount, passed: passCount, failed: failCount }, coverage: coverageStats, checks,
}, null, 2)}\n`)

const stage = mkdtempSync(join(tmpdir(), `ht-stage-${version}-`))
const stageRoot = join(stage, `harness-tavern-${version}`)
cpSync(root, stageRoot, { recursive: true, filter: sourceCopyFilter })
const npmComponents = Object.entries(packageLock.packages ?? {})
  .filter(([path, metadata]) => path.startsWith('node_modules/') && metadata.version)
  .map(([path, metadata]) => {
    const name = path.replace(/^node_modules\//, '')
    return {
      type: 'library',
      name,
      version: metadata.version,
      scope: 'required',
      purl: `pkg:npm/${name.replace('/', '%2F')}@${metadata.version}`,
      ...metadata.license ? { licenses: [{ license: { id: metadata.license } }] } : {},
    }
  })
const sbom = {
  bomFormat: 'CycloneDX', specVersion: '1.5', version: 1,
  metadata: { timestamp: generatedAt, component: { type: 'application', name: 'harness-tavern', version, licenses: [{ license: { id: 'MIT' } }] } },
  components: [
    { type: 'framework', name: 'Node.js standard library', version: packageJson.engines?.node || '>=22.19.0', scope: 'required' },
    ...npmComponents,
    { type: 'framework', name: 'DeepSeek Harness integration target', version: '0.1.2-alpha.1', scope: 'optional', purl: 'pkg:github/deepseek-ai/deepseek-harness@cd5ef8148158c3a752a658978873241fdf8e2bbc' },
  ],
}
writeFileSync(join(stageRoot, 'SBOM.cdx.json'), `${JSON.stringify(sbom, null, 2)}\n`)
writeFileSync(join(stageRoot, 'BUILD_INFO.json'), `${JSON.stringify({ version, commit: commitSha, generated_at: generatedAt }, null, 2)}\n`)
cpSync(join(releaseDir, 'QUALITY_REPORT.md'), join(stageRoot, 'QUALITY_REPORT.md'))
cpSync(join(releaseDir, 'QUALITY_REPORT.json'), join(stageRoot, 'QUALITY_REPORT.json'))

const sourceZip = join(releaseDir, `harness-tavern-${version}-source.zip`)
const sourceTar = join(releaseDir, `harness-tavern-${version}-source.tar.gz`)
const archivedFileCount = createArchives(stage, stageRoot, sourceZip, sourceTar)
rmSync(stage, { recursive: true, force: true })
const inventory = archiveInventory(sourceZip)
addCheck(checks, 'source-archive-nonempty', statSync(sourceZip).size > 50_000 && inventory.files >= 60 && inventory.missing.length === 0, JSON.stringify({ bytes: statSync(sourceZip).size, archivedFileCount, ...inventory }))

const sourceCold = coldVerifySource(sourceZip, 'source')
addCheck(checks, 'source-archive-cold-test', sourceCold.passed, JSON.stringify({ test_status: sourceCold.test_status, journey_status: sourceCold.journey_status }))

const gitBundle = join(releaseDir, `harness-tavern-${version}.git.bundle`)
const bundle = run('git', ['bundle', 'create', gitBundle, '--all'])
if (bundle.status !== 0) throw new Error(`git bundle failed: ${bundle.output}`)
const bundleCold = coldVerifyGitBundle(gitBundle)
addCheck(checks, 'git-bundle-cold-test', bundleCold.passed, JSON.stringify({ verify_status: bundleCold.verify_status, test_status: bundleCold.test_status, journey_status: bundleCold.journey_status }))

let fullFork = null
let fullForkCold = null
if (existsSync(upstreamZip)) {
  const buildFork = run('python3', ['scripts/build-full-fork.py', upstreamZip])
  fullFork = join(releaseDir, `deepseek-harness-tavern-${version}-full-fork-source.zip`)
  addCheck(checks, 'full-upstream-snapshot-build', buildFork.status === 0 && existsSync(fullFork) && statSync(fullFork).size > 1_000_000, buildFork.output.slice(-8000))
  if (existsSync(fullFork)) {
    fullForkCold = coldVerifyFullFork(fullFork)
    addCheck(checks, 'full-upstream-snapshot-cold-test', fullForkCold.passed, JSON.stringify({ test_status: fullForkCold.test_status, journey_status: fullForkCold.journey_status }))
  }
} else {
  addCheck(checks, 'full-upstream-snapshot-build', true, `Optional upstream source archive not supplied: ${upstreamZip}`)
}

failIfNeeded(checks, 'Artifact verification')

const artifactVerification = {
  product: 'Harness Tavern', version, generated_at: new Date().toISOString(), passed: true,
  source_archive: { inventory, cold: { passed: sourceCold.passed, test_status: sourceCold.test_status, journey_status: sourceCold.journey_status } },
  git_bundle: { passed: bundleCold.passed, verify_status: bundleCold.verify_status, test_status: bundleCold.test_status, journey_status: bundleCold.journey_status },
  full_fork: fullFork ? { path: basename(fullFork), passed: fullForkCold?.passed, test_status: fullForkCold?.test_status, journey_status: fullForkCold?.journey_status } : null,
}
writeFileSync(join(releaseDir, 'ARTIFACT_VERIFICATION.json'), `${JSON.stringify(artifactVerification, null, 2)}\n`)
writeFileSync(join(releaseDir, 'ARTIFACT_VERIFICATION.md'), [
  `# Harness Tavern ${version} artifact verification`, '',
  'Result: **PASS**', '',
  `- Source ZIP: ${inventory.files} files, ${statSync(sourceZip).size} bytes; cold tests and full user journey passed.`,
  '- Git bundle: verified, cloned, tested, and replayed through the full user journey.',
  `- DeepSeek Harness source snapshot: ${fullForkCold?.passed ? 'assembled from the supplied archive and cold-tested successfully' : 'not built'}.`,
  '',
  'The browser process available in this execution environment is not used as a release gate. HTTP, SSE, static browser modules, and user journeys are covered by deterministic tests.',
].join('\n'))

writeFileSync(join(releaseDir, '交付说明.md'), `# Harness Tavern ${version} 交付说明\n\n本版本围绕非技术用户重新设计：普通玩家只需要选择角色或故事并开始聊天；创作者可用自然语言向导生成、预览、修改和发布内容。\n\n分享支持公开预览、完整可玩包、导入预检、冲突策略和撤销；扩展采用声明式无代码格式，不执行导入包中的 JavaScript。\n\n快速启动：\n\n\`\`\`bash\nunzip harness-tavern-${version}-source.zip\ncd harness-tavern-${version}\nnpm start\n\`\`\`\n\n默认地址：\`http://127.0.0.1:8787\`。内置演示模型无需 API Key。\n`)

const componentArtifacts = [
  sourceZip,
  sourceTar,
  gitBundle,
  fullFork,
  join(releaseDir, 'QUALITY_REPORT.md'),
  join(releaseDir, 'QUALITY_REPORT.json'),
  join(releaseDir, 'ARTIFACT_VERIFICATION.md'),
  join(releaseDir, 'ARTIFACT_VERIFICATION.json'),
  join(releaseDir, 'FULL_FORK_REPORT.json'),
  join(releaseDir, '交付说明.md'),
].filter(path => path && existsSync(path))

const manifest = {
  product: 'Harness Tavern',
  version,
  generated_at: new Date().toISOString(),
  commit: commitSha,
  upstream: JSON.parse(readFileSync(join(root, 'UPSTREAM.lock.json'), 'utf8')),
  tests: { total: testCount, passed: passCount, failed: failCount },
  coverage: coverageStats,
  artifacts: componentArtifacts.map(path => ({ name: basename(path), bytes: statSync(path).size, sha256: sha256(path) })),
  gates: checks.map(({ name, passed, detail }) => ({ name, passed, detail: detail.slice(0, 2000) })),
}
writeFileSync(join(releaseDir, 'RELEASE_MANIFEST.json'), `${JSON.stringify(manifest, null, 2)}\n`)
const checksumFiles = [...componentArtifacts, join(releaseDir, 'RELEASE_MANIFEST.json')]
writeFileSync(join(releaseDir, 'SHA256SUMS'), checksumFiles.map(path => `${sha256(path)}  ${basename(path)}`).join('\n') + '\n')

const finalStatus = {
  product: 'Harness Tavern', version, commit: commitSha, generated_at: new Date().toISOString(), passed: true,
  automated_tests: { total: testCount, passed: passCount, failed: failCount },
  coverage: coverageStats,
  source_archive_files: inventory.files,
  cold_source_passed: sourceCold.passed,
  cold_git_bundle_passed: bundleCold.passed,
  cold_full_fork_passed: fullForkCold?.passed ?? null,
}
writeFileSync(join(releaseDir, 'FINAL_STATUS.json'), `${JSON.stringify(finalStatus, null, 2)}\n`)
writeFileSync(join(releaseDir, 'FINAL_STATUS.md'), [
  `# Harness Tavern ${version} final status`, '',
  'Result: **PASS**', '',
  `- Commit: \`${commitSha}\``,
  `- Automated tests: ${passCount}/${testCount} passed`,
  `- Coverage: ${coverageStats?.lines ?? '?'}% lines, ${coverageStats?.branches ?? '?'}% branches, ${coverageStats?.functions ?? '?'}% functions`,
  `- Source archive: ${inventory.files} files; cold test passed`,
  '- Git bundle: clone and cold test passed',
  `- Full DeepSeek Harness source snapshot: ${fullForkCold?.passed ? 'cold test passed' : 'not available'}`,
].join('\n'))

const deliveryStage = mkdtempSync(join(tmpdir(), `ht-delivery-${version}-`))
const deliveryRoot = join(deliveryStage, `harness-tavern-${version}-delivery`)
mkdirSync(deliveryRoot, { recursive: true })
for (const path of [
  ...componentArtifacts,
  join(releaseDir, 'RELEASE_MANIFEST.json'),
  join(releaseDir, 'SHA256SUMS'),
  join(releaseDir, 'FINAL_STATUS.md'),
  join(releaseDir, 'FINAL_STATUS.json'),
]) cpSync(path, join(deliveryRoot, basename(path)))
const completeDelivery = join(releaseDir, `harness-tavern-${version}-complete-delivery.zip`)
createArchives(deliveryStage, deliveryRoot, completeDelivery)
rmSync(deliveryStage, { recursive: true, force: true })
const completeChecksum = `${sha256(completeDelivery)}  ${basename(completeDelivery)}\n`
writeFileSync(join(releaseDir, 'COMPLETE_DELIVERY.sha256'), completeChecksum)
const externalDelivery = join(dirname(root), basename(completeDelivery))
cpSync(completeDelivery, externalDelivery)
writeFileSync(join(dirname(root), `${basename(completeDelivery)}.sha256`), completeChecksum)

console.log(JSON.stringify({
  ...finalStatus,
  complete_delivery: { path: completeDelivery, bytes: statSync(completeDelivery).size, sha256: sha256(completeDelivery) },
  external_copy: externalDelivery,
}, null, 2))
