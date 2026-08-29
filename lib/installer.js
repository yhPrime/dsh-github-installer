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
  state.settle(state)
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
    packages.push({
      name,
      version: pkg !== undefined && pkg.version !== undefined ? pkg.version : null,
      hasBundle: Boolean(pkg !== undefined && pkg.dsh && pkg.dsh.bundle && pkg.dsh.bundle.patch),
      hasClient: Boolean(pkg !== undefined && pkg.dsh && pkg.dsh.client),
      stdDeps: Object.keys(deps).filter((k) => k.startsWith('@dsh-std/')),
      protected: isProtected(name),
    })
  }
  const bundlesUpdated = reconcileBundles(beforeDeps)
  const adapterInstalled = Boolean(after !== undefined && after['@dsh-std/adapter-dsh'] !== undefined)
  const stdPlugin = packages.some((p) => p.stdDeps.length > 0)
  return {
    ok: true,
    kind: 'install',
    spec: state.target,
    added: packages,
    adapterInstalled,
    stdPlugin,
    needsRestart: packages.some((p) => p.hasBundle),
    bundlesUpdated,
    hint: packages.some((p) => p.hasBundle)
      ? '包含宿主端补丁（dsh.bundle），需要重启 DSH 后生效'
      : '刷新页面后即可生效',
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
    rows.push({
      name,
      spec: typeof spec === 'string' ? spec : String(spec),
      version: pkg !== undefined && pkg.version !== undefined ? pkg.version : null,
      protected: isProtected(name),
      hasBundle: Boolean(pkg !== undefined && pkg.dsh && pkg.dsh.bundle && pkg.dsh.bundle.patch),
      hasClient: Boolean(pkg !== undefined && pkg.dsh && pkg.dsh.client),
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
      spec: { title: '列出已安装插件', description: '列出 profile 中所有已安装的第三方插件' },
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
            return respond({ ok: true, running: op.running, kind: op.running ? op.kind : null, target: op.running ? op.target : null })
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
    execute(input) {
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
