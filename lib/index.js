/**
 * dsh-github-installer — Cordis loader ticket AND the session-free HTTP
 * bridge for the browser SettingsSection UI.
 *
 * The std facets (commands + tool) are activated by @dsh-std/adapter-dsh.
 * The settings UI talks to this product-level HTTP API over same-origin
 * fetch — the same pattern dsh-market uses for its settings UI — so the
 * UI works with zero agent-session dependency. All state-changing POST
 * routes are guarded by isTrustedRequest() (same-origin + Sec-Fetch-Site).
 */
import {
  cancelOperation,
  installTarget,
  uninstallTarget,
  updateTarget,
  installedList,
  listFull,
  operationSnapshot,
  status,
  updatableSummary,
} from './installer.js'

export const name = 'dsh-github-installer'

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    'cache-control': 'no-store',
    'content-type': 'application/json; charset=utf-8',
  })
  response.end(JSON.stringify(payload))
}

/**
 * Same-origin / fetch-metadata guard for the state-changing POST routes.
 *
 * CSRF 纵深防御（浏览器环境）：
 *  1. Origin.host 必须与 Host 头一致（跨站 form/image 会被挡下）；
 *  2. 浏览器发出的同源 fetch 会带 Sec-Fetch-Site: same-origin/none——
 *     若该头存在则必须匹配，堵住「同源子页面/被注入页面」发起的跨站请求；
 *  3. 非浏览器客户端（桌面内嵌 webview / 自动化工具）可能不带
 *     Sec-Fetch-Site —— 该头缺失时退回仅按 Origin/Host 判定。
 *
 * 判定失败会 console.warn 留痕（请求来源审计），便于排查异常调用。
 */
export function isTrustedRequest(headers) {
  if (headers === null || typeof headers !== 'object') return false
  const origin = headers.origin
  const host = headers.host
  let sameHost = false
  if (origin !== undefined && host !== undefined) {
    try {
      sameHost = new URL(origin).host === host
    } catch {
      sameHost = false
    }
  }
  if (!sameHost) {
    console.warn('[ghp-installer] rejected untrusted request:', {
      origin: origin ?? null,
      host: host ?? null,
      'sec-fetch-site': headers['sec-fetch-site'] ?? null,
    })
    return false
  }
  const secFetchSite = headers['sec-fetch-site']
  if (secFetchSite === undefined) return true
  if (secFetchSite === 'same-origin' || secFetchSite === 'none') return true
  console.warn('[ghp-installer] rejected cross-site fetch:', {
    origin,
    host,
    'sec-fetch-site': secFetchSite,
  })
  return false
}

function forbidden(response) {
  sendJson(response, 403, { ok: false, error: 'forbidden: untrusted request' })
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

function methodNotAllowed(response, allow) {
  response.writeHead(405, { allow })
  response.end()
}

export function apply(ctx) {
  ctx.inject(['webServer'], (host) => {
    host.effect(() => {
      const disposers = [
        host.webServer.register({
          kind: 'exact',
          path: '/ghp-installer/status',
          handler: (request, response) => {
            if (request.method !== 'GET') {
              methodNotAllowed(response, 'GET')
              return
            }
            sendJson(response, 200, status())
          },
        }),
        host.webServer.register({
          kind: 'exact',
          path: '/ghp-installer/list',
          handler: (request, response) => {
            if (request.method !== 'GET') {
              methodNotAllowed(response, 'GET')
              return
            }
            sendJson(response, 200, installedList())
          },
        }),
        host.webServer.register({
          kind: 'exact',
          path: '/ghp-installer/list-full',
          handler: async (request, response) => {
            if (request.method !== 'GET') {
              methodNotAllowed(response, 'GET')
              return
            }
            let force = false
            try {
              force = new URL(request.url ?? '/', 'http://dsh.invalid').searchParams.get('force') === '1'
            } catch {
              force = false
            }
            sendJson(response, 200, await listFull(force))
          },
        }),
        host.webServer.register({
          kind: 'exact',
          path: '/ghp-installer/check-updates',
          handler: async (request, response) => {
            if (request.method !== 'GET') {
              methodNotAllowed(response, 'GET')
              return
            }
            // An explicit check always refreshes the cache against the sources.
            sendJson(response, 200, await updatableSummary(true))
          },
        }),
        host.webServer.register({
          kind: 'exact',
          path: '/ghp-installer/install',
          handler: async (request, response) => {
            if (request.method !== 'POST') {
              methodNotAllowed(response, 'POST')
              return
            }
            if (!isTrustedRequest(request.headers)) {
              forbidden(response)
              return
            }
            try {
              const body = await readJsonBody(request)
              const url = body !== null && typeof body === 'object' && typeof body.url === 'string' ? body.url : ''
              if (url.trim() === '') {
                sendJson(response, 400, { ok: false, error: '缺少安装目标' })
                return
              }
              const result = await installTarget(url)
              if (result.ok !== true) {
                sendJson(response, 400, result)
                return
              }
              sendJson(response, 200, { ok: true, started: true })
            } catch (error) {
              sendJson(response, 400, { ok: false, error: String((error && error.message) || error) })
            }
          },
        }),
        host.webServer.register({
          kind: 'exact',
          path: '/ghp-installer/uninstall',
          handler: async (request, response) => {
            if (request.method !== 'POST') {
              methodNotAllowed(response, 'POST')
              return
            }
            if (!isTrustedRequest(request.headers)) {
              forbidden(response)
              return
            }
            try {
              const body = await readJsonBody(request)
              const name = body !== null && typeof body === 'object' && typeof body.name === 'string' ? body.name : ''
              const result = await uninstallTarget(name)
              if (result.ok !== true) {
                sendJson(response, 400, result)
                return
              }
              sendJson(response, 200, { ok: true, started: true })
            } catch (error) {
              sendJson(response, 400, { ok: false, error: String((error && error.message) || error) })
            }
          },
        }),
        host.webServer.register({
          kind: 'exact',
          path: '/ghp-installer/update',
          handler: async (request, response) => {
            if (request.method !== 'POST') {
              methodNotAllowed(response, 'POST')
              return
            }
            if (!isTrustedRequest(request.headers)) {
              forbidden(response)
              return
            }
            try {
              const body = await readJsonBody(request)
              const name = body !== null && typeof body === 'object' && typeof body.name === 'string' ? body.name : ''
              const result = await updateTarget(name)
              if (result.ok !== true) {
                sendJson(response, 400, result)
                return
              }
              sendJson(response, 200, { ok: true, started: true })
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
              methodNotAllowed(response, 'GET')
              return
            }
            sendJson(response, 200, operationSnapshot())
          },
        }),
        host.webServer.register({
          kind: 'exact',
          path: '/ghp-installer/cancel',
          handler: async (request, response) => {
            if (request.method !== 'POST') {
              methodNotAllowed(response, 'POST')
              return
            }
            if (!isTrustedRequest(request.headers)) {
              forbidden(response)
              return
            }
            sendJson(response, 200, { ok: true, cancelled: cancelOperation() })
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
    }, 'dsh-github-installer: http routes')
  })
}
