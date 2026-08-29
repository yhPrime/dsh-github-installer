/**
 * dsh-github-installer — host entry.
 *
 * Mounts HTTP routes that install any DeepSeek Harness plugin into the
 * current web profile from a GitHub repo URL, using the standard
 * `github:owner/repo` install protocol (the same one dsh-market uses).
 *
 * The install runs through the packaged pnpm pipeline the same way DSH
 * Desktop and dsh-market do: the desktop's bundled node + the
 * `.desktop-bin/pnpm-runner.mjs` wrapper (Windows locked-rename recovery +
 * idle timeout) + the bundled pnpm. After a successful `add`, the
 * `dsh.profile.bundles` layer list is reconciled against newly added
 * bundle-declaring packages (mirrors what the `dsh plugin` CLI does).
 *
 * Security: mutating routes accept same-origin POST only.
 */
import { spawn } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'

export const name = 'ghp-installer'

function sendJson(response, status, payload) {
  response.writeHead(status, {
    'cache-control': 'no-store',
    'content-type': 'application/json; charset=utf-8',
  })
  response.end(JSON.stringify(payload))
}

function sameOrigin(request) {
  const origin = request.headers.origin
  const host = request.headers.host
  if (origin === undefined || host === undefined) return false
  try {
    return new URL(origin).host === host
  } catch {
    return false
  }
}

async function readJsonBody(request, maxBytes = 4096) {
  const chunks = []
  let size = 0
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.length
    if (size > maxBytes) throw new Error('request body too large')
    chunks.push(buffer)
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

export function apply(ctx) {
  const desktopProfiles = ctx.get('desktopProfiles')
  if (desktopProfiles === undefined) {
    console.error('[ghp-installer] desktopProfiles unavailable; routes disabled')
    return
  }
  const profile = desktopProfiles.current

  // --- resolved toolchain paths (same layout the desktop shims use) ---
  const home = process.env.DSH_HOME || join(homedir(), '.dsh')
  // node.exe lives at <app>/node_modules/node/bin/node.exe
  const appRoot = dirname(dirname(dirname(dirname(process.execPath))))
  const runner = join(home, '.desktop-bin', 'pnpm-runner.mjs')
  const pnpmEntry = join(appRoot, 'node_modules', 'pnpm', 'bin', 'pnpm.cjs')

  // --- GitHub URL -> pnpm spec (standard `github:owner/repo` protocol) ---
  function parseSource(input) {
    if (typeof input !== 'string') return { error: '缺少 GitHub 仓库地址' }
    const s = input.trim()
    if (s === '') return { error: '请输入 GitHub 仓库网址' }
    let m = /^github:([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)(?:#path:\/([A-Za-z0-9_./-]+))?$/.exec(s)
    if (m !== null) return { ok: true, spec: s, repo: m[1], subpath: m[2] === undefined ? null : m[2] }
    m = /^https?:\/\/github\.com\/([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+?)(?:\.git)?(?:\/tree\/[^/]+\/(.+?))?\/?$/.exec(s)
    if (m !== null) {
      const repo = m[1]
      const sub = m[2]
      if (sub !== undefined) {
        if (!/^[A-Za-z0-9_./-]+$/.test(sub) || sub.split('/').some((seg) => seg === '' || seg === '.' || seg === '..')) {
          return { error: '仓库子路径无效' }
        }
        return { ok: true, spec: 'github:' + repo + '#path:/' + sub, repo: repo, subpath: sub }
      }
      return { ok: true, spec: 'github:' + repo, repo: repo, subpath: null }
    }
    m = /^([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)$/.exec(s)
    if (m !== null) return { ok: true, spec: 'github:' + m[1], repo: m[1], subpath: null }
    return { error: '无法识别的 GitHub 仓库地址（支持 https://github.com/owner/repo 或 owner/repo）' }
  }

  // --- profile manifest helpers (direct fs, full Node host) ---
  function readManifest() {
    try {
      return JSON.parse(readFileSync(join(profile.dir, 'package.json'), 'utf8'))
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
      return JSON.parse(readFileSync(join(profile.dir, 'node_modules', name, 'package.json'), 'utf8'))
    } catch {
      return undefined
    }
  }
  function writeManifest(manifest) {
    try {
      writeFileSync(join(profile.dir, 'package.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf8')
      return true
    } catch {
      return false
    }
  }
  function tailText(lines, max) {
    const joined = lines.join('')
    return joined.length > max ? joined.slice(-max) : joined
  }

  // --- install orchestration (single active run) ---
  let active = null

  function runPnpmAdd(spec, onData, onChild) {
    return new Promise((resolvePromise) => {
      if (!existsSync(pnpmEntry)) {
        resolvePromise({ exitCode: 127, stdout: '', stderr: 'pnpm entry not found: ' + pnpmEntry })
        return
      }
      const argv0 = existsSync(runner) ? [runner, pnpmEntry] : [pnpmEntry]
      const child = spawn(process.execPath, argv0.concat(['add', spec]), {
        cwd: profile.dir,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, CI: 'true', NO_COLOR: '1', PNPM_MAX_WORKERS: '1' },
        windowsHide: true,
      })
      if (typeof onChild === 'function') onChild(child)
      let stdout = ''
      let stderr = ''
      child.stdout.on('data', (chunk) => {
        stdout = (stdout + chunk).slice(-262144)
        onData(chunk)
      })
      child.stderr.on('data', (chunk) => {
        stderr = (stderr + chunk).slice(-65536)
        onData(chunk)
      })
      child.on('error', (error) => resolvePromise({ exitCode: 127, stdout, stderr: String((error && error.message) || error) }))
      child.on('close', (code) => resolvePromise({ exitCode: code, stdout, stderr }))
    })
  }

  async function startInstall(spec, source) {
    if (active !== null && active.running) return { error: '已有安装任务正在进行，请等待完成', busy: true }
    const beforeDeps = readDeps()
    const state = {
      spec,
      source,
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
    runPnpmAdd(spec, push, (child) => { state.child = child }).then(async (result) => {
      state.running = false
      if (result.exitCode === 0) {
        state.result = await summarizeSuccess(state, beforeDeps)
      } else {
        state.result = {
          ok: false,
          exitCode: result.exitCode,
          stderrTail: tailText(state.lines, 4000),
          stderr: result.stderr ? result.stderr.slice(-2000) : '',
        }
      }
      state.settle(state)
    }).catch((error) => {
      state.running = false
      state.result = { ok: false, error: String((error && error.message) || error) }
      state.settle(state)
    })
    return { started: true, state }
  }

  async function summarizeSuccess(state, beforeDeps) {
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
      const stdDeps = Object.keys(deps).filter((k) => k.indexOf('@dsh-std/') === 0)
      packages.push({
        name,
        version: pkg !== undefined && pkg.version !== undefined ? pkg.version : null,
        hasBundle: Boolean(pkg !== undefined && pkg.dsh && pkg.dsh.bundle && pkg.dsh.bundle.patch),
        hasClient: Boolean(pkg !== undefined && pkg.dsh && pkg.dsh.client),
        stdDeps,
      })
    }
    // Replicate the `dsh plugin` CLI reconcile: append bundle-declaring new deps to dsh.profile.bundles
    let bundlesUpdated = false
    const manifest = readManifest()
    if (manifest !== undefined && typeof manifest.dependencies === 'object' && manifest.dependencies !== null) {
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
      if (changed) {
        manifest.dsh = {
          ...manifest.dsh,
          profile: { ...(manifest.dsh && manifest.dsh.profile), bundles },
        }
        bundlesUpdated = writeManifest(manifest)
      }
    }
    const adapterInstalled = Boolean(after !== undefined && after['@dsh-std/adapter-dsh'] !== undefined)
    const stdPlugin = packages.some((p) => p.stdDeps.length > 0)
    return {
      ok: true,
      spec: state.spec,
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

  // --- HTTP routes ---
  ctx.inject(['webServer'], (host) => {
    host.effect(() => {
      const disposers = [
        host.webServer.register({
          kind: 'exact',
          path: '/ghp-installer/status',
          handler: (request, response) => {
            if (request.method !== 'GET') {
              response.writeHead(405, { allow: 'GET' })
              response.end()
              return
            }
            const deps = readDeps()
            sendJson(response, 200, {
              ok: true,
              profile: { name: profile.name, dir: profile.dir },
              adapterInstalled: Boolean(deps !== undefined && deps['@dsh-std/adapter-dsh'] !== undefined),
              adapterSpec: deps !== undefined && deps['@dsh-std/adapter-dsh'] !== undefined ? deps['@dsh-std/adapter-dsh'] : null,
            })
          },
        }),
        host.webServer.register({
          kind: 'exact',
          path: '/ghp-installer/install',
          handler: async (request, response) => {
            if (request.method !== 'POST') {
              response.writeHead(405, { allow: 'POST' })
              response.end()
              return
            }
            if (!sameOrigin(request)) {
              sendJson(response, 403, { ok: false, error: 'forbidden: cross-origin request' })
              return
            }
            try {
              const body = await readJsonBody(request)
              const url = body !== null && typeof body === 'object' && typeof body.url === 'string' ? body.url : ''
              const parsed = parseSource(url)
              if (!parsed.ok) {
                sendJson(response, 400, { ok: false, error: parsed.error })
                return
              }
              const started = await startInstall(parsed.spec, { url, repo: parsed.repo, subpath: parsed.subpath })
              if (started.error !== undefined) {
                sendJson(response, 409, { ok: false, error: started.error, busy: started.busy === true })
                return
              }
              sendJson(response, 200, { started: true })
            } catch (error) {
              sendJson(response, 400, { ok: false, error: String((error && error.message) || error) })
            }
          },
        }),
        host.webServer.register({
          kind: 'exact',
          path: '/ghp-installer/status-poll',
          handler: (request, response) => {
            if (request.method !== 'GET') {
              response.writeHead(405, { allow: 'GET' })
              response.end()
              return
            }
            if (active === null) {
              sendJson(response, 200, { running: false, started: false })
              return
            }
            sendJson(response, 200, {
              running: active.running,
              started: true,
              spec: active.spec,
              repo: active.source.repo,
              subpath: active.source.subpath,
              lines: active.lines.slice(-60),
              result: active.result,
            })
          },
        }),
        host.webServer.register({
          kind: 'exact',
          path: '/ghp-installer/cancel',
          handler: async (request, response) => {
            if (request.method !== 'POST') {
              response.writeHead(405, { allow: 'POST' })
              response.end()
              return
            }
            if (!sameOrigin(request)) {
              sendJson(response, 403, { ok: false, error: 'forbidden: cross-origin request' })
              return
            }
            if (active !== null && active.running && active.child !== null) {
              try {
                spawn('taskkill', ['/pid', String(active.child.pid), '/t', '/f'], { stdio: 'ignore', windowsHide: true })
              } catch {
                /* the run settles on its own */
              }
              sendJson(response, 200, { cancelled: true })
            } else {
              sendJson(response, 200, { cancelled: false })
            }
          },
        }),
      ]
      return () => {
        for (const dispose of disposers) {
          try {
            dispose()
          } catch {
            /* ignore */
          }
        }
      }
    }, 'ghp-installer: http routes')
  })
}
