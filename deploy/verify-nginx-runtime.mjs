import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import http from 'node:http'
import { setTimeout as delay } from 'node:timers/promises'

// Exercise the built image with ordinary HTTP requests. No production access,
// vulnerability probes, registry credentials, or special HTTP/2 frames are used.
const image = process.argv[2]
assert.ok(image, 'Usage: node deploy/verify-nginx-runtime.mjs <built-image>')
const docker = (...args) => {
  const result = spawnSync('docker', args, { encoding: 'utf8', timeout: 60_000 })
  assert.equal(result.status, 0, result.stderr || result.error?.message || 'Docker command failed')
  return result.stdout.trim()
}
const source = await readFile(new URL('./nginx/default.conf', import.meta.url), 'utf8')
const host = [...source.matchAll(/server_name\s+([^;]+);/g)]
  .flatMap((match) => match[1].trim().split(/\s+/)).find((name) => name !== '_')
assert.ok(host, 'The runtime must have a named application virtual host')
const container = docker('run', '--rm', '--detach', '--read-only',
  '--tmpfs', '/tmp:rw,nosuid,nodev', '--tmpfs', '/var/cache/nginx:rw,nosuid,nodev',
  '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
  '--add-host', 'sslping-api:127.0.0.1', '--publish', '127.0.0.1::8080', image)

try {
  const version = docker('exec', container, 'sh', '-c', 'nginx -v 2>&1')
  const match = version.match(/nginx\/(\d+)\.(\d+)\.(\d+)(?:\s|$)/)
  assert.ok(match, 'The running nginx binary must report its upstream version')
  const [major, minor, patch] = match.slice(1).map(Number)
  const patched = major > 1 || (major === 1 && (
    minor > 31 || (minor === 31 && patch >= 9) || (minor === 30 && patch >= 7)
  ))
  assert.ok(patched, 'NGINX must include the upstream fixes for CVE-2026-123007 and CVE-2026-123633')
  console.log(version)
  console.log(docker('exec', container, 'apk', 'info', '--who-owns', '/usr/sbin/nginx'))
  docker('exec', container, 'nginx', '-t')
  const config = docker('exec', container, 'sh', '-c', 'nginx -T 2>&1')
  assert.doesNotMatch(config, /^\s*http2\s+on\s*;|^\s*listen\s+[^;\n]*\bhttp2\b/m,
    'This application image must retain its HTTP/1.1 listener configuration')

  const port = Number(docker('port', container, '8080/tcp').split(':').at(-1))
  const get = (path) => new Promise((resolve, reject) => {
    const request = http.get({ hostname: '127.0.0.1', port, path, headers: { Host: host } }, (response) => {
      let body = ''
      response.setEncoding('utf8')
      response.on('data', (chunk) => { body += chunk })
      response.once('end', () => resolve({ status: response.statusCode, headers: response.headers, body }))
      response.once('error', reject)
    })
    request.setTimeout(5000, () => request.destroy(new Error('Runtime request timed out')))
    request.once('error', reject)
  })
  let ready = false
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try { ready = (await get('/health/ready')).status === 200 } catch { /* Starting. */ }
    if (ready) break
    await delay(100)
  }
  assert.ok(ready, 'The application runtime must become ready')
  const page = await get('/')
  assert.equal(page.status, 200, 'The application virtual host must serve its normal entry page')
  assert.match(page.headers['content-type'] ?? '', /text\/html/)
  assert.ok(page.headers['content-security-policy'], 'Retain application security headers')
  const assets = [...page.body.matchAll(/(?:src|href)="(\/assets\/[^"\s]+\.(?:js|css))"/g)]
    .map((match) => match[1])
  assert.ok(assets.length >= 2, 'The entry page must reference built JS and CSS')
  for (const path of new Set(assets)) {
    const response = await get(path)
    assert.equal(response.status, 200, 'Built entry assets must remain available')
    assert.match(response.headers['content-type'] ?? '', path.endsWith('.js') ? /javascript/ : /text\/css/)
    assert.ok(response.headers['content-security-policy'], 'Retain asset security headers')
  }
  console.log('PASS: patched nginx version, valid config, HTTP/1.1 application listener, readiness, HTML and built assets')
} finally {
  docker('rm', '--force', container)
}
