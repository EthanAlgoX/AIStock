// @vitest-environment node

import { describe, expect, it } from 'vitest'
import { createServer as createHttpServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer as createViteServer } from 'vite'

import config, { resolveAppRevision } from './vite.config'

describe('development API proxy', () => {
  it.each(['POST', 'DELETE'])('preserves the browser origin and host for a same-origin %s', async (method) => {
    const backend = createHttpServer((request, response) => {
      const expectedOrigin = `http://${request.headers.host}`
      response.writeHead(request.headers.origin === expectedOrigin ? 200 : 403, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ origin: request.headers.origin, host: request.headers.host, path: request.url, method: request.method }))
    })
    await new Promise<void>(resolve => backend.listen(0, '127.0.0.1', resolve))
    let frontend: Awaited<ReturnType<typeof createViteServer>> | undefined
    let cacheDir: string | undefined
    try {
      cacheDir = await mkdtemp(join(tmpdir(), 'dsa-vite-proxy-'))
      const proxy = config.server?.proxy?.['/api']
      if (!proxy || typeof proxy === 'string') throw new Error('API proxy options are missing')
      frontend = await createViteServer({
        configFile: false, logLevel: 'silent', appType: 'custom', cacheDir,
        server: { host: '127.0.0.1', port: 0, strictPort: true, hmr: false, watch: null,
          proxy: { '/api': { ...proxy, target: `http://127.0.0.1:${(backend.address() as AddressInfo).port}` } } },
      })
      await frontend.listen()
      const address = frontend.httpServer?.address() as AddressInfo
      const origin = `http://127.0.0.1:${address.port}`
      const response = await fetch(`${origin}/api/v1/workspace/tasks`, { method, headers: { Origin: origin } })
      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({ origin, host: `127.0.0.1:${address.port}`, path: '/api/v1/workspace/tasks', method })
      const crossOrigin = await fetch(`${origin}/api/v1/workspace/tasks`, { method, headers: { Origin: 'https://untrusted.example' } })
      expect(crossOrigin.status).toBe(403)
    } finally {
      await frontend?.close()
      await new Promise<void>(resolve => backend.close(() => resolve()))
      if (cacheDir) await rm(cacheDir, { recursive: true, force: true })
    }
  })
})

describe('resolveAppRevision', () => {
  it('prefers the explicitly injected release revision', () => {
    expect(resolveAppRevision({
      explicitRevision: 'release123456',
      checkedOutRevision: 'checkedout123',
      workflowRevision: 'workflow12345',
    })).toBe('release123456')
  })

  it('uses the checked-out revision before the workflow trigger revision', () => {
    expect(resolveAppRevision({
      checkedOutRevision: 'oldtag123456',
      workflowRevision: 'defaultbranch',
    })).toBe('oldtag123456')
  })

  it('falls back when the build has no Git checkout', () => {
    expect(resolveAppRevision({
      workflowRevision: 'workflow12345',
    })).toBe('workflow12345')
    expect(resolveAppRevision({})).toBe('unknown')
  })
})
