/**
 * dsh-github-installer — shared install logic (host facet + tool).
 *
 * Pure Node module loaded by the std host facet. Installs/uninstalls/updates
 * plugins in the current web profile using the standard pnpm pipeline the
 * same way DSH Desktop and dsh-market do: the desktop's bundled node + the
 * `.desktop-bin/pnpm-runner.mjs` wrapper + the bundled pnpm, then reconciles
 * `dsh.profile.bundles` like the `dsh plugin` CLI.
 */
import { spawn } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'

export const PLUGIN_NAME = 'dsh-github-installer'

// Packages the installer must never uninstall.
export function isProtected(name) {
  if (typeof name !== 'string') return true
  if (name === PLUGIN_NAME) return true
  if (name === 'dshmarket') return true
  if (name.startsWith('@deepseek-ai/')) return true
  if (name.startsWith('@dsh-std/')) return true
  return false
}

export function profileDir() {
  return join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'profiles', 'web')
}
function home() {
  return process.env.DSH_HOME || join(homedir(), '.dsh')
}
function appRoot() {
  // node.exe lives at <app>/node_modules/node/bin/node.exe
  return dirname(dirname(dirname(dirname(process.execPath))))
}
function pnpmEntry() {
  return join(appRoot(), 'node_modules', 'pnpm', 'bin', 'pnpm.cjs')
}
function runnerPath() {
  return join(home(), '.desktop-bin', 'pnpm-runner.mjs')
}

// ---------------------------------------------------------------------------
// Source parsing: GitHub URLs / npm names / other git repositories / raw specs
// ---------------------------------------------------------------------------
export function parseSource(input) {
  if (typeof input !== 'string') return { error: '缺少安装目标' }
  const s = input.trim()
  if (s === '') return { error: '请输入 GitHub 仓库网址 / npm 包名 / Git 仓库地址' }

  // github.com URL (optionally with a monorepo /tree/<branch>/<subpath> suffix)
  let m = /^https?:\/\/github\.com\/([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+?)(?:\.git)?(?:\/tree\/[^/]+\/(.+?))?\/?$/.exec(s)
  if (m !== null) {
    const repo = m[1]
    const sub = m[2]
    if (sub !== undefined) {
      if (!/^[A-Za-z0-9_./-]+$/.test(sub) || sub.split('/').some((seg) => seg === '' || seg === '.' || seg === '..')) {
        return { error: '仓库子路径无效' }
      }
      return { ok: true, kind: 'github', spec: `github:${repo}#path:/${sub}`, target: `${repo}#${sub}` }
    }
    return { ok: true, kind: 'github', spec: `github:${repo}`, target: repo }
  }

  // bare `owner/repo` shorthand -> github
  m = /^([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)$/.exec(s)
  if (m !== null && !s.startsWith('@')) {
    return { ok: true, kind: 'github', spec: `github:${s}`, target: s }
  }

  // scoped / plain npm package name (optionally @version)
  m = /^(@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*(?:@[0-9][0-9a-zA-Z._-]*)?$/.exec(s)
  if (m !== null) {
    return { ok: true, kind: 'npm', spec: s, target: s }
  }

  // explicit pnpm specs pass through
  if (/^(github:|git\+|git:|npm:|file:|link:|workspace:)/.test(s)) {
    return { ok: true, kind: 'spec', spec: s, target: s }
  }

  // other git hosts: gitlab / gitee / bitbucket / codeberg / gitcode / generic host/owner/repo
  m = /^https?:\/\/([^/]+\/[^/]+\/[^/]+?)(?:\.git)?\/?$/.exec(s)
  if (m !== null) {
    return { ok: true, kind: 'git', spec: `git+${s.replace(/\/$/, '')}`, target: m[1] }
  }
  if (/^https?:\/\/[^/\s]+\.git(\?|#|$)/.test(s)) {
    return { ok: true, kind: 'git', spec: `git+${s}`, target: s }
  }

  return { error: '无法识别的安装目标（支持 GitHub 网址、owner/repo、npm 包名、其他 Git 仓库地址）' }
}

// ---------------------------------------------------------------------------
// Profile manifest helpers (direct fs)
// ---------------------------------------------------------------------------
function readManifest() {
  try {
    return JSON.parse(readFileSync(join(profileDir(), 'package.json'), 'utf8'))
  } catch {
    return undefined
  }
}
function readDeps() {
  const manifest = readManifest()
  if (manifest === undefined || typeof manifest.dependencies !== 'object' || manifest.dependencies === null) return undefined
  return manifest.dependencies
}
function readPackageJson(name) {
  try {
    return JSON.parse(readFileSync(join(profileDir(), 'node_modules', name, 'package.json'), 'utf8'))
  } catch {
    return undefined
  }
}
/**
 * Read the Community v0.15 std manifest (dsh-plugin.json) of an installed
 * package — the adapter-facing declaration that makes it a "standard
 * component" (STD) discoverable by @dsh-std/adapter-dsh.
 */
function readStdManifest(name) {
  try {
    return JSON.parse(readFileSync(join(profileDir(), 'node_modules', name, 'dsh-plugin.json'), 'utf8'))
  } catch {
    return undefined
  }
}
/**
 * Classify an installed package's DSH shape:
 *   'cordis' — host-patched bundle (dsh.bundle.patch, reconciles into bundles)
 *   'std'    — pure standard component (dsh-plugin.json, activated by adapter)
 *   'both'   — dual-channel (bundle shell + std facets, e.g. this plugin)
 *   'plain'  — ordinary dependency without any DSH component declaration
 */
export function componentShape(pkg, stdManifest) {
  const cordis = Boolean(pkg !== undefined && pkg.dsh && pkg.dsh.bundle && pkg.dsh.bundle.patch)
  const std = stdManifest !== undefined && stdManifest !== null && typeof stdManifest === 'object'
  if (cordis && std) return 'both'
  if (cordis) return 'cordis'
  if (std) return 'std'
  return 'plain'
}
function writeManifest(manifest) {
  try {
    writeFileSync(join(profileDir(), 'package.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf8')
    return true
  } catch {
    return false
  }
}
function tailText(lines, max) {
  const joined = lines.join('')
  return joined.length > max ? joined.slice(-max) : joined
}

// ---------------------------------------------------------------------------
// pnpm runner
// ---------------------------------------------------------------------------
function runPnpm(args, onData) {
  return new Promise((resolvePromise) => {
    const entry = pnpmEntry()
    if (!existsSync(entry)) {
      resolvePromise({ exitCode: 127, stdout: '', stderr: `pnpm entry not found: ${entry}` })
      return
    }
    const runner = runnerPath()
    const argv0 = existsSync(runner) ? [runner, entry] : [entry]
    const child = spawn(process.execPath, argv0.concat(args), {
      cwd: profileDir(),
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, CI: 'true', NO_COLOR: '1', PNPM_MAX_WORKERS: '1' },
      windowsHide: true,
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => {
      stdout = (stdout + chunk).slice(-262144)
      if (typeof onData === 'function') onData(chunk)
    })
    child.stderr.on('data', (chunk) => {
      stderr = (stderr + chunk).slice(-65536)
      if (typeof onData === 'function') onData(chunk)
    })
    child.on('error', (error) => resolvePromise({ exitCode: 127, stdout, stderr: String((error && error.message) || error) }))
    child.on('close', (code) => resolvePromise({ exitCode: code, stdout, stderr }))
  })
}

// ---------------------------------------------------------------------------
// Single active operation state (polled by the UI / tool)
// ---------------------------------------------------------------------------
let active = null

export function operationSnapshot() {
  if (active === null) return { running: false, started: false }
  return {
    running: active.running,
    started: true,
    kind: active.kind,
    target: active.target,
    lines: active.lines.slice(-60),
    result: active.result,
  }
}

export function cancelOperation() {
  if (active !== null && active.running && active.child !== null) {
    try {
      spawn('taskkill', ['/pid', String(active.child.pid), '/t', '/f'], { stdio: 'ignore', windowsHide: true })
    } catch {
      /* the run settles on its own */
    }
    return true
  }
  return false
}

function beginOperation(kind, target) {
  if (active !== null && active.running) {
    return { error: '已有安装/卸载/更新任务正在进行，请等待完成', busy: true }
  }
  const state = {
    kind,
    target,
    running: true,
    lines: [],
    result: null,
    startedAt: Date.now(),
    child: null,
    done: null,
    settle: null,
  }
  state.done = new Promise((resolveDone) => { state.settle = resolveDone })
  active = state
  const push = (chunk) => {
    const text = typeof chunk === 'string' ? chunk : String(chunk)
    state.lines.push(text)
    if (state.lines.length > 120) state.lines.splice(0, state.lines.length - 120)
  }
  return { state, push }
}

function settleOperation(state, result) {
  state.running = false
  state.result = result
  // Resolve the done promise with the *result* (carries ok/error/exitCode),
  // not the internal state object — HTTP routes and the manage_plugin tool
  // both await it and inspect `result.ok`. Resolving `state` (ok: undefined)
  // made every finished operation look like `操作失败 (exit undefined)` to
  // the UI even though pnpm had succeeded.
  state.settle(result)
}

// ---------------------------------------------------------------------------
// Operations
// ---------------------------------------------------------------------------
export async function installTarget(input, onProgress) {
  const parsed = parseSource(input)
  if (!parsed.ok) return { ok: false, error: parsed.error }
  const begun = beginOperation('install', parsed.target)
  if (begun.error !== undefined) return begun
  const { state, push } = begun
  const feed = typeof onProgress === 'function' ? onProgress : push
  const beforeDeps = readDeps()
  runPnpm(['add', parsed.spec], push).then(async (result) => {
    if (result.exitCode !== 0) {
      settleOperation(state, {
        ok: false,
        exitCode: result.exitCode,
        stderrTail: tailText(state.lines, 4000),
        stderr: result.stderr ? result.stderr.slice(-2000) : '',
      })
      feed(state.result)
      return
    }
    state.result = await summarizeAdd(state, beforeDeps, parsed)
    settleOperation(state, state.result)
    feed(state.result)
  }).catch((error) => {
    settleOperation(state, { ok: false, error: String((error && error.message) || error) })
    feed(state.result)
  })
  return state.done
}

async function summarizeAdd(state, beforeDeps, parsed) {
  const after = readDeps()
  const addedNames = []
  if (beforeDeps !== undefined && after !== undefined) {
    for (const name of Object.keys(after)) {
      if (!(name in beforeDeps)) addedNames.push(name)
    }
  }
  if (addedNames.length === 0) {
    for (const line of state.lines) {
      const m = /^\+\s+(@?[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)?)\s/.exec(line.trim())
      if (m !== null && !addedNames.includes(m[1])) addedNames.push(m[1])
    }
  }
  const packages = []
  for (const name of addedNames) {
    const pkg = readPackageJson(name)
    const deps = pkg !== undefined && typeof pkg.dependencies === 'object' && pkg.dependencies !== null ? pkg.dependencies : {}
    const stdManifest = readStdManifest(name)
    const shape = componentShape(pkg, stdManifest)
    const cordisBundle = shape === 'cordis' || shape === 'both'
    const stdComponent = shape === 'std' || shape === 'both'
    packages.push({
      name,
      version: pkg !== undefined && pkg.version !== undefined ? pkg.version : null,
      shape,
      cordisBundle,
      stdComponent,
      // Back-compat aliases consumed by older UI builds:
      hasBundle: cordisBundle,
      hasClient: Boolean(pkg !== undefined && pkg.dsh && pkg.dsh.client),
      stdManifestId: stdManifest !== undefined && typeof stdManifest.id === 'string' ? stdManifest.id : null,
      stdManifestVersion: stdManifest !== undefined && typeof stdManifest.version === 'string' ? stdManifest.version : null,
      stdDeps: Object.keys(deps).filter((k) => k.startsWith('@dsh-std/')),
      protected: isProtected(name),
    })
  }
  const bundlesUpdated = reconcileBundles(beforeDeps)
  const afterDeps = after
  const adapterInstalled = Boolean(afterDeps !== undefined && afterDeps['@dsh-std/adapter-dsh'] !== undefined)
  const stdPlugin = packages.some((p) => p.stdComponent || p.stdDeps.length > 0)
  const cordisPlugin = packages.some((p) => p.cordisBundle)
  const hasStd = packages.some((p) => p.stdComponent)
  const plainOnly = packages.length > 0 && !stdPlugin && !cordisPlugin
  const hint = cordisPlugin
    ? hasStd
      ? '双通道组件（dsh.bundle 补丁 + dsh-plugin.json 标准组件清单），重启 DSH 后生效'
      : '包含宿主端补丁（dsh.bundle），重启 DSH 后生效'
    : stdPlugin
      ? 'DSH 标准组件（dsh-plugin.json），由 @dsh-std/adapter-dsh 激活——重启 DSH 后生效'
      : plainOnly
        ? '已安装为普通依赖（未声明 DSH 组件，安装器不干预）'
        : '刷新页面后即可生效'
  return {
    ok: true,
    kind: 'install',
    spec: state.target,
    added: packages,
    adapterInstalled,
    stdPlugin,
    needsRestart: packages.some((p) => p.cordisBundle || p.stdComponent),
    bundlesUpdated,
    hint,
  }
}

export async function uninstallTarget(name, onProgress) {
  const target = String(name || '').trim()
  if (target === '') return { ok: false, error: '请输入要卸载的插件包名' }
  if (isProtected(target)) return { ok: false, error: `${target} 受保护，禁止卸载` }
  const deps = readDeps()
  if (deps === undefined || deps[target] === undefined) return { ok: false, error: `${target} 未安装` }
  const begun = beginOperation('uninstall', target)
  if (begun.error !== undefined) return begun
  const { state, push } = begun
  const feed = typeof onProgress === 'function' ? onProgress : push
  runPnpm(['remove', target], push).then(async (result) => {
    if (result.exitCode !== 0) {
      settleOperation(state, { ok: false, exitCode: result.exitCode, stderrTail: tailText(state.lines, 4000) })
      feed(state.result)
      return
    }
    const bundlesUpdated = dropFromBundles(target)
    settleOperation(state, { ok: true, kind: 'uninstall', removed: [target], bundlesUpdated })
    feed(state.result)
  }).catch((error) => {
    settleOperation(state, { ok: false, error: String((error && error.message) || error) })
    feed(state.result)
  })
  return state.done
}

export async function updateTarget(name, onProgress) {
  const target = String(name || '').trim()
  if (target === '') return { ok: false, error: '请输入要更新的插件包名' }
  const deps = readDeps()
  if (deps === undefined || deps[target] === undefined) return { ok: false, error: `${target} 未安装` }
  const begun = beginOperation('update', target)
  if (begun.error !== undefined) return begun
  const { state, push } = begun
  const feed = typeof onProgress === 'function' ? onProgress : push
  const before = readDeps()
  runPnpm(['update', target], push).then(async (result) => {
    if (result.exitCode !== 0) {
      settleOperation(state, { ok: false, exitCode: result.exitCode, stderrTail: tailText(state.lines, 4000) })
      feed(state.result)
      return
    }
    reconcileBundles(before)
    const pkg = readPackageJson(target)
    settleOperation(state, {
      ok: true,
      kind: 'update',
      updated: [target],
      version: pkg !== undefined && pkg.version !== undefined ? pkg.version : null,
      hint: '更新完成；若包含宿主端补丁变更，重启 DSH 后生效',
    })
    feed(state.result)
  }).catch((error) => {
    settleOperation(state, { ok: false, error: String((error && error.message) || error) })
    feed(state.result)
  })
  return state.done
}

// Append bundle-declaring new deps to dsh.profile.bundles (mirrors the dsh plugin CLI reconcile).
function reconcileBundles(beforeDeps) {
  const manifest = readManifest()
  if (manifest === undefined || typeof manifest.dependencies !== 'object' || manifest.dependencies === null) return false
  const bundles = Array.isArray(manifest.dsh && manifest.dsh.profile && manifest.dsh.profile.bundles)
    ? manifest.dsh.profile.bundles.slice()
    : []
  let changed = false
  for (const name of Object.keys(manifest.dependencies)) {
    if (beforeDeps !== undefined && Object.prototype.hasOwnProperty.call(beforeDeps, name)) continue
    const pkg = readPackageJson(name)
    if (pkg !== undefined && pkg.dsh && pkg.dsh.bundle && pkg.dsh.bundle.patch && !bundles.includes(name)) {
      bundles.push(name)
      changed = true
    }
  }
  if (!changed) return false
  manifest.dsh = {
    ...manifest.dsh,
    profile: { ...(manifest.dsh && manifest.dsh.profile), bundles },
  }
  return writeManifest(manifest)
}

function dropFromBundles(name) {
  const manifest = readManifest()
  if (manifest === undefined) return false
  const bundles = Array.isArray(manifest.dsh && manifest.dsh.profile && manifest.dsh.profile.bundles)
    ? manifest.dsh.profile.bundles
    : []
  const index = bundles.indexOf(name)
  if (index === -1) return false
  bundles.splice(index, 1)
  manifest.dsh = {
    ...manifest.dsh,
    profile: { ...(manifest.dsh && manifest.dsh.profile), bundles },
  }
  return writeManifest(manifest)
}

// ---------------------------------------------------------------------------
// Listing / status
// ---------------------------------------------------------------------------
export function installedList() {
  const deps = readDeps()
  if (deps === undefined) return { ok: false, error: '无法读取 profile 配置' }
  const rows = []
  for (const [name, spec] of Object.entries(deps)) {
    const pkg = readPackageJson(name)
    const stdManifest = readStdManifest(name)
    const shape = componentShape(pkg, stdManifest)
    rows.push({
      name,
      spec: typeof spec === 'string' ? spec : String(spec),
      version: pkg !== undefined && pkg.version !== undefined ? pkg.version : null,
      protected: isProtected(name),
      shape,
      cordisBundle: shape === 'cordis' || shape === 'both',
      stdComponent: shape === 'std' || shape === 'both',
      hasBundle: shape === 'cordis' || shape === 'both',
      hasClient: Boolean(pkg !== undefined && pkg.dsh && pkg.dsh.client),
      stdManifestId: stdManifest !== undefined && typeof stdManifest.id === 'string' ? stdManifest.id : null,
      stdManifestVersion: stdManifest !== undefined && typeof stdManifest.version === 'string' ? stdManifest.version : null,
    })
  }
  rows.sort((a, b) => a.name.localeCompare(b.name))
  return { ok: true, rows }
}

export function status() {
  const deps = readDeps()
  const snapshot = operationSnapshot()
  return {
    ok: true,
    profile: { name: 'web', dir: profileDir() },
    adapterInstalled: Boolean(deps !== undefined && deps['@dsh-std/adapter-dsh'] !== undefined),
    adapterSpec: deps !== undefined && deps['@dsh-std/adapter-dsh'] !== undefined ? deps['@dsh-std/adapter-dsh'] : null,
    operation: snapshot,
  }
}

// ---------------------------------------------------------------------------
// Source metadata + update detection (GitHub API / npm registry / git)
// ---------------------------------------------------------------------------
const META_CACHE_TTL_MS = 5 * 60 * 1000
const metaCache = new Map() // name -> { at, value }
const inflight = new Map() // name -> Promise

function classifySpec(spec) {
  const s = String(spec || '')
  let m = /^(?:github:|git\+https?:\/\/github\.com\/|https?:\/\/github\.com\/)([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+?)(?:\.git)?(?:#path:\/.*)?$/.exec(s)
  if (m !== null) {
    const parts = m[1].split('/')
    return { kind: 'github', owner: parts[0], repo: parts[1] }
  }
  m = /^git\+ssh:\/\/[^/\s]+\/([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+?)(?:\.git)?/.exec(s)
  if (m !== null) {
    const parts = m[1].split('/')
    return { kind: 'github', owner: parts[0], repo: parts[1] }
  }
  m = /^(?:git\+)?https?:\/\/([^/\s]+\/[^/\s]+\/[^/\s]+?)(?:\.git)?(?:#.*)?$/.exec(s)
  if (m !== null) return { kind: 'git', url: s.replace(/^git\+/, '') }
  if (/^(file:|link:|workspace:)/.test(s)) return { kind: 'local' }
  return { kind: 'npm' }
}

/** Installed git commit per owner/repo, read from pnpm-lock.yaml. */
function readLockCommits() {
  const commits = new Map()
  try {
    const lock = readFileSync(join(profileDir(), 'pnpm-lock.yaml'), 'utf8')
    for (const m of lock.matchAll(/git\+?(?:ssh|https?):\/\/[^#\s]*github\.com\/([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+?)(?:\.git)?#([0-9a-f]{40})/g)) {
      commits.set(m[1].toLowerCase(), m[2])
    }
    for (const m of lock.matchAll(/codeload\.github\.com\/([^/\s]+\/[^/\s]+)\/tar\.gz\/([0-9a-f]{40})/g)) {
      commits.set(m[1].toLowerCase(), m[2])
    }
  } catch {
    /* no lockfile — no git installs to report */
  }
  return commits
}

/** HEAD sha of a public git URL via `git ls-remote` (no GitHub API quota). */
function gitHeadSha(url) {
  return new Promise((resolvePromise) => {
    let settled = false
    const finish = (value) => { if (!settled) { settled = true; resolvePromise(value) } }
    const timer = setTimeout(() => finish(null), 15000)
    try {
      const child = spawn('git', ['ls-remote', url, 'HEAD'], {
        cwd: profileDir(),
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0', CI: 'true' },
        windowsHide: true,
      })
      let out = ''
      child.stdout.on('data', (chunk) => { out = (out + chunk).slice(-4096) })
      child.on('error', () => finish(null))
      child.on('close', (code) => {
        clearTimeout(timer)
        const m = /^([0-9a-f]{40})\s+HEAD/m.exec(out)
        finish(code === 0 && m !== null ? m[1] : null)
      })
    } catch {
      clearTimeout(timer)
      finish(null)
    }
  })
}

async function fetchJson(url) {
  try {
    const res = await fetch(url, {
      headers: { accept: 'application/json', 'user-agent': 'dsh-github-installer' },
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return res.json()
  } catch {
    // TLS/cert fallback for corporate-CA environments where Node fetch fails
    // but curl -k succeeds (mirrors git's http.sslverify=false behavior).
    return curlJson(url)
  }
}

/** Fetch + parse JSON via curl.exe -k (no cert verification). */
function curlJson(url) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn('curl.exe', [
      '-s', '-k', '--max-time', '20',
      '-H', 'user-agent: dsh-github-installer',
      '-H', 'accept: application/json',
      url,
    ], {
      cwd: profileDir(),
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })
    let out = ''
    child.stdout.on('data', (chunk) => { out = (out + chunk).slice(-262144) })
    child.on('error', () => rejectPromise(new Error('curl unavailable')))
    child.on('close', (code) => {
      if (code !== 0) {
        rejectPromise(new Error(`curl exit ${code}`))
        return
      }
      try {
        resolvePromise(JSON.parse(out))
      } catch {
        rejectPromise(new Error('curl returned invalid JSON'))
      }
    })
  })
}

async function githubRepoInfo(owner, repo) {
  const data = await fetchJson(`https://api.github.com/repos/${owner}/${repo}`)
  return {
    image: data.owner !== null && typeof data.owner === 'object' && typeof data.owner.avatar_url === 'string'
      ? data.owner.avatar_url
      : null,
    description: typeof data.description === 'string' ? data.description : '',
    stars: typeof data.stargazers_count === 'number' ? data.stargazers_count : null,
    homepage: typeof data.homepage === 'string' && data.homepage !== '' ? data.homepage
      : (typeof data.html_url === 'string' ? data.html_url : null),
  }
}

async function npmRegistryInfo(name) {
  const data = await fetchJson(`https://registry.npmjs.org/${encodeURIComponent(name)}/latest`)
  return {
    description: typeof data.description === 'string' ? data.description : '',
    latest: typeof data.version === 'string' ? data.version : null,
    homepage: typeof data.homepage === 'string' && data.homepage !== '' ? data.homepage : null,
  }
}

function normalizeVersion(value) {
  if (typeof value !== 'string') return null
  const m = /^[~^>=<v]*([0-9][0-9a-zA-Z.\-+]*)$/.exec(value.trim())
  return m !== null ? m[1] : (value.trim() === '' ? null : value.trim())
}

/** Loose semver comparison: -1 / 0 / 1 (a < b …). Prerelease sorts below release. */
function compareVersions(a, b) {
  const parse = (value) => {
    const m = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?/.exec(String(value || '').trim())
    return m === null ? null : { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]), pre: m[4] || null }
  }
  const pa = parse(a)
  const pb = parse(b)
  if (pa === null || pb === null) return String(a) === String(b) ? 0 : 0 // unknown — treat as equal
  for (const key of ['major', 'minor', 'patch']) {
    if (pa[key] !== pb[key]) return pa[key] < pb[key] ? -1 : 1
  }
  if (pa.pre === null && pb.pre === null) return 0
  if (pa.pre === null) return 1
  if (pb.pre === null) return -1
  return pa.pre.localeCompare(pb.pre)
}

async function pluginMeta(row, force) {
  const key = row.name
  const cached = metaCache.get(key)
  if (!force && cached !== undefined && Date.now() - cached.at < META_CACHE_TTL_MS) return cached.value
  if (inflight.has(key)) return inflight.get(key)
  const task = (async () => {
    const classified = classifySpec(row.spec)
    try {
      if (classified.kind === 'github') {
        const [repoInfo, head] = await Promise.all([
          githubRepoInfo(classified.owner, classified.repo).catch(() => null),
          gitHeadSha(`https://github.com/${classified.owner}/${classified.repo}`),
        ])
        const installedCommit = readLockCommits().get(`${classified.owner}/${classified.repo}`.toLowerCase()) || null
        let update = { available: false }
        if (installedCommit !== null && head !== null && head !== installedCommit) {
          update = { available: true, kind: 'git', current: installedCommit.slice(0, 7), next: head.slice(0, 7) }
        } else if (installedCommit === null && head !== null) {
          update = { available: true, kind: 'git', current: row.version || 'installed', next: head.slice(0, 7) }
        }
        return {
          state: repoInfo !== null ? 'ok' : (head !== null ? 'ok' : 'error'),
          image: repoInfo !== null ? repoInfo.image : null,
          description: repoInfo !== null ? repoInfo.description : '',
          stars: repoInfo !== null ? repoInfo.stars : null,
          homepage: repoInfo !== null ? repoInfo.homepage : null,
          update,
        }
      }
      if (classified.kind === 'npm') {
        const info = await npmRegistryInfo(row.name).catch(() => null)
        const installed = normalizeVersion(row.version)
        let update = { available: false }
        if (info !== null && installed !== null && info.latest !== null && compareVersions(info.latest, installed) === 1) {
          update = { available: true, kind: 'npm', current: installed, next: info.latest }
        }
        return {
          state: info !== null ? 'ok' : 'error',
          image: null,
          description: info !== null ? info.description : '',
          stars: null,
          homepage: info !== null ? info.homepage : null,
          update,
        }
      }
      return { state: 'unsupported', image: null, description: '', stars: null, homepage: null, update: { available: false } }
    } catch {
      return { state: 'error', image: null, description: '', stars: null, homepage: null, update: { available: false } }
    }
  })()
  inflight.set(key, task)
  try {
    const value = await task
    metaCache.set(key, { at: Date.now(), value })
    return value
  } finally {
    inflight.delete(key)
  }
}

/** Enriched installed list: image / description / stars / homepage / update state per plugin. */
export async function listFull(force) {
  const base = installedList()
  if (!base.ok) return base
  const rows = await Promise.all(base.rows.map(async (row) => {
    const meta = await pluginMeta(row, force === true)
    return {
      ...row,
      image: meta.image,
      description: meta.description,
      stars: meta.stars,
      homepage: meta.homepage,
      metaState: meta.state,
      updateAvailable: meta.update !== null && meta.update.available === true,
      updateKind: meta.update !== null && meta.update.available === true ? meta.update.kind : null,
      updateCurrent: meta.update !== null && meta.update.available === true ? meta.update.current : null,
      updateNext: meta.update !== null && meta.update.available === true ? meta.update.next : null,
    }
  }))
  return { ok: true, rows }
}

/** Updatable-plugin summary for the model tool's status action / check-updates route. */
export async function updatableSummary(force) {
  const full = await listFull(force === true)
  if (!full.ok) return { ok: false, error: full.error }
  const updatable = full.rows.filter((row) => row.updateAvailable)
  return { ok: true, count: updatable.length, names: updatable.map((row) => row.name), rows: full.rows }
}

// ---------------------------------------------------------------------------
// Command / tool descriptors
// ---------------------------------------------------------------------------
export const COMMAND_REFERENCE = Object.freeze({ apiVersion: 'commands.dsh/v1alpha1', kind: 'Command' })
export const TOOL_REFERENCE = Object.freeze({ apiVersion: 'tools.dsh/v1alpha1', kind: 'Tool' })

// Command resources (published as manifest extensions + runtime handlers).
export function commandResources() {
  const argument = (name, title, required = false) => ({ name, title, required })
  return [
    {
      name: 'ghp-install',
      spec: {
        title: '安装插件',
        description: '从 GitHub 网址 / npm 包名 / 其他 Git 仓库安装一个插件到当前 web 配置',
        arguments: [{ name: 'target', title: '仓库网址或包名', required: true }],
      },
    },
    {
      name: 'ghp-uninstall',
      spec: {
        title: '卸载插件',
        description: '卸载一个已安装的第三方插件（受保护包除外）',
        arguments: [{ name: 'package', title: '插件包名', required: true }],
      },
    },
    {
      name: 'ghp-update',
      spec: {
        title: '更新插件',
        description: '更新一个已安装的插件（Git 依赖重取 HEAD，npm 依赖更新到最新）',
        arguments: [{ name: 'package', title: '插件包名', required: true }],
      },
    },
    {
      name: 'ghp-list',
      spec: { title: '列出已安装插件', description: '列出 profile 中所有已安装的第三方插件（不含网络元数据）' },
    },
    {
      name: 'ghp-list-full',
      spec: {
        title: '列出已安装插件（含元数据与更新检测）',
        description: '列出已安装插件并补充图片/描述/星级/主页与更新检测（可选 force 强制刷新缓存）',
      },
    },
    {
      name: 'ghp-status',
      spec: { title: '查询插件管理状态', description: '返回当前安装/卸载/更新进度与 std 适配器状态' },
    },
    {
      name: 'ghp-cancel',
      spec: { title: '取消当前操作', description: '取消正在进行的安装/卸载/更新' },
    },
  ]
}

// One std Tool handler with four actions.
export function createToolHandler() {
  return Object.freeze({
    resolve() {
      return Object.freeze({
        name: 'manage_plugin',
        description:
          '管理 DeepSeek Harness 插件：从 GitHub 网址 / npm 包名 / 其他 Git 仓库安装插件，卸载或更新已安装的第三方插件，或查询状态。'
          + ' install 接受 https://github.com/owner/repo（支持 /tree/<分支>/<子目录>）、owner/repo、npm 包名、gitlab/gitee 等仓库地址。',
        parameters: {
          type: 'object',
          additionalProperties: false,
          properties: {
            action: {
              type: 'string',
              enum: ['install', 'uninstall', 'update', 'status'],
              description: '要执行的动作：install=安装，uninstall=卸载，update=更新，status=查询状态',
            },
            target: {
              type: 'string',
              description: 'install 时是仓库网址/包名；uninstall/update 时是插件包名；status 可省略',
            },
          },
          required: ['action'],
        },
        output: {
          type: 'object',
          additionalProperties: false,
          properties: {
            ok: { type: 'boolean' },
            summary: { type: 'string' },
            detail: { type: 'object' },
          },
          required: ['ok', 'summary'],
        },
        async execute(input, context) {
          const action = input && typeof input.action === 'string' ? input.action : ''
          const target = input && typeof input.target === 'string' ? input.target : ''
          const summarize = (result) => {
            if (result === undefined || result === null) return { ok: false, summary: '操作无结果' }
            if (result.ok !== true) {
              const error = result.error || `exit ${String(result.exitCode)}`
              const tail = result.stderrTail ? `\n${String(result.stderrTail).slice(-800)}` : ''
              return { ok: false, summary: `${action} 失败：${error}${tail}` }
            }
            if (action === 'install') {
              const added = (result.added || []).map((p) => `${p.name}@${p.version ?? '?'}${p.hasBundle ? ' [bundle]' : ''}`).join(', ')
              return { ok: true, summary: `已安装：${added || result.spec}\n${result.hint || ''}` }
            }
            if (action === 'uninstall') return { ok: true, summary: `已卸载：${(result.removed || []).join(', ')}` }
            if (action === 'update') return { ok: true, summary: `已更新：${(result.updated || []).join(', ')} @ ${result.version ?? '?'}` }
            return { ok: true, summary: '完成' }
          }
          const detail = (result) => (result === undefined || result === null ? null : { ...result })
          // Standard tool handlers return { data, content } — content is what the
          // model sees, data is the canonical JSON.
          const respond = (result) => {
            const summary = summarize(result)
            return {
              data: { ok: summary.ok, summary: summary.summary, detail: detail(result) },
              content: [{ type: 'text', text: summary.summary }],
            }
          }
          if (action === 'install') {
            if (target === '') return respond({ ok: false, error: 'install 需要 target（仓库网址或包名）' })
            return respond(await installTarget(target))
          }
          if (action === 'uninstall') {
            if (target === '') return respond({ ok: false, error: 'uninstall 需要 target（插件包名）' })
            return respond(await uninstallTarget(target))
          }
          if (action === 'update') {
            if (target === '') return respond({ ok: false, error: 'update 需要 target（插件包名）' })
            return respond(await updateTarget(target))
          }
          if (action === 'status') {
            const result = status()
            const op = result.operation
            const summary = await updatableSummary().catch(() => null)
            return respond({
              ok: true,
              running: op.running,
              kind: op.running ? op.kind : null,
              target: op.running ? op.target : null,
              updatable: summary !== null && summary.ok === true ? summary.names : [],
              updatableCount: summary !== null && summary.ok === true ? summary.count : 0,
            })
          }
          return respond({ ok: false, error: `未知动作 ${action}（install/uninstall/update/status）` })
        },
      })
    },
  })
}

// Command handler dispatch: one handler per command resource name.
export function createCommandHandler(resourceName) {
  const done = (result) => ({
    kind: result.ok === true ? 'success' : 'error',
    text: JSON.stringify(result),
  })
  return Object.freeze({
    async execute(input) {
      const raw = input && typeof input.rawInput === 'string' ? input.rawInput.trim() : ''
      if (resourceName === 'ghp-install') {
        if (raw === '') return done({ ok: false, error: '请输入 GitHub 仓库网址 / npm 包名 / Git 仓库地址' })
        void installTarget(raw)
        return done({ ok: true, started: true, message: `开始安装：${raw}` })
      }
      if (resourceName === 'ghp-uninstall') {
        if (raw === '') return done({ ok: false, error: '请输入要卸载的插件包名' })
        void uninstallTarget(raw)
        return done({ ok: true, started: true, message: `开始卸载：${raw}` })
      }
      if (resourceName === 'ghp-update') {
        if (raw === '') return done({ ok: false, error: '请输入要更新的插件包名' })
        void updateTarget(raw)
        return done({ ok: true, started: true, message: `开始更新：${raw}` })
      }
      if (resourceName === 'ghp-list') {
        return done(installedList())
      }
      if (resourceName === 'ghp-list-full') {
        return done(await listFull(raw === 'force'))
      }
      if (resourceName === 'ghp-status') {
        return done(status())
      }
      if (resourceName === 'ghp-cancel') {
        const cancelled = cancelOperation()
        return done({ ok: true, cancelled })
      }
      return done({ ok: false, error: `未知命令 ${resourceName}` })
    },
  })
}
