import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import http from 'node:http'
import { setTimeout as delay } from 'node:timers/promises'

// Exercise the built runtime: exact stable-entry locations must win over the
// immutable /assets/ prefix on every host, including conditional responses.
const image = process.argv[2]
assert.ok(image, 'Usage: node deploy/test-nginx-cache.mjs <built-dashboard-image>')
const docker = (...args) => execFileSync('docker', args, { encoding: 'utf8' }).trim()
const container = docker('run', '--rm', '--detach', '--add-host', 'sslping-api:127.0.0.1',
  '--publish', '127.0.0.1::8080', image)
let checks = 0

try {
  const port = Number(docker('port', container, '8080/tcp').split(':').at(-1))
  assert.ok(Number.isInteger(port) && port > 0, 'Published nginx port is required')
  const get = (host, path, headers = {}) => new Promise((resolve, reject) => {
    const request = http.get({ hostname: '127.0.0.1', port, path, headers: { Host: host, ...headers } }, response => {
      response.resume()
      response.once('end', () => resolve({ status: response.statusCode, headers: response.headers }))
      response.once('error', reject)
    })
    request.setTimeout(5000, () => request.destroy(new Error('Nginx request timed out')))
    request.once('error', reject)
  })

  let ready = false
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      ready = (await get('dashboard.sslping.io', '/health/ready')).status === 200
    } catch { /* The container may still be starting. */ }
    if (ready) break
    await delay(100)
  }
  assert.ok(ready, 'Nginx must become ready')

  const html = docker('exec', container, 'cat', '/usr/share/nginx/html/index.html')
  const hashed = ['js', 'css'].map(extension => {
    const filename = html.match(new RegExp(`/assets/(app-[A-Za-z0-9_-]+\\.${extension})"`))?.[1]
    assert.ok(filename, `Dashboard HTML must reference hashed main ${extension}`)
    return filename
  })
  assert.doesNotMatch(html, /(?:src|href)="\/assets\/app\.(?:js|css)"/)

  for (const host of ['dashboard.sslping.io', 'status.sslping.io', 'unknown.example']) {
    for (const asset of ['app.js', 'app.css', ...hashed]) {
      const expected = asset.startsWith('app.') ? 'no-cache' : 'public, max-age=31536000, immutable'
      const response = await get(host, `/assets/${asset}`)
      assert.equal(response.status, 200, `${host}/${asset}: successful GET`)
      assert.equal(response.headers['cache-control'], expected, `${host}/${asset}: Cache-Control`)
      assert.match(response.headers['content-type'] ?? '', asset.endsWith('.js') ? /javascript/ : /text\/css/)
      assert.ok(response.headers['content-security-policy'], `${host}/${asset}: retain security headers`)
      assert.ok(response.headers.etag, `${host}/${asset}: ETag supports revalidation`)
      checks += 1

      const conditional = await get(host, `/assets/${asset}`, { 'If-None-Match': response.headers.etag })
      assert.equal(conditional.status, 304, `${host}/${asset}: conditional GET`)
      assert.equal(conditional.headers['cache-control'], expected, `${host}/${asset}: 304 Cache-Control`)
      checks += 1
    }
  }
  assert.equal((await get('dashboard.sslping.io', '/login')).headers['cache-control'], 'no-store')
  checks += 1
  console.log(`PASS: ${checks} nginx cache checks (3 hosts, stable and hashed JS/CSS, 200/304, HTML)`)
} catch (error) {
  console.error(docker('logs', container))
  throw error
} finally {
  docker('rm', '--force', container)
}
