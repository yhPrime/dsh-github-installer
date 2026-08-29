/**
 * dsh-github-installer — Cordis loader ticket AND the session-free HTTP
 * bridge for the browser SettingsSection UI.
 *
 * The real std facets (commands + tool) are activated by @dsh-std/adapter-dsh.
 * The settings UI, however, talks to this product-level HTTP API over
 * same-origin fetch — exactly the pattern dsh-theme-picker uses with
 * dsh-market's HTTP API — so the UI works with zero agent-session dependency.
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
            if (!sameOrigin(request)) {
              sendJson(response, 403, { ok: false, error: 'forbidden: cross-origin request' })
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
            if (!sameOrigin(request)) {
              sendJson(response, 403, { ok: false, error: 'forbidden: cross-origin request' })
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
            if (!sameOrigin(request)) {
              sendJson(response, 403, { ok: false, error: 'forbidden: cross-origin request' })
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
            if (!sameOrigin(request)) {
              sendJson(response, 403, { ok: false, error: 'forbidden: cross-origin request' })
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
