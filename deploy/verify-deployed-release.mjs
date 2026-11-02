import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { selectDeployedImage } from './select-deployed-image.mjs'

export const clusterEndpoint = 'https://42c71c20-f7ee-4e76-b31b-3973adfebcf3.k8s.ondigitalocean.com'
const containers = { 'sslping-dashboard': 'dashboard', 'sslping-marketing-site': 'marketing-site' }

export function releaseTarget(name, expectedImage, sourceSha) {
  assert.ok(Object.hasOwn(containers, name), 'Unexpected deployment')
  assert.match(sourceSha, /^[a-f0-9]{40}$/, 'Expected a full source SHA')
  const repository = `registry.digitalocean.com/mitrohin-registry/${name}`
  assert.ok(expectedImage.startsWith(`${repository}@sha256:`), 'Unexpected release image')
  assert.match(expectedImage.slice(repository.length), /^@sha256:[a-f0-9]{64}$/, 'Expected an immutable release image')
  return { name, container: containers[name], repository, expectedImage, sourceSha }
}

export async function waitForRelease(target, snapshot, { now = Date.now, pause = sleep, timeoutMs = 180000, pollMs = 5000 } = {}) {
  const deadline = now() + timeoutMs
  do {
    try {
      const { deployment, pods } = snapshot(deadline - now())
      const actual = selectDeployedImage(deployment, pods, target.name, target.container, target.repository)
      assert.equal(actual, target.expectedImage, 'Running image differs from this release')
      assert.ok(now() <= deadline, 'Runtime verification deadline exceeded')
      return {
        schema_version: 1, status: 'verified', source_sha: target.sourceSha,
        expected_image: target.expectedImage,
        actual_image_ids: pods.items.map(p => p.status.containerStatuses.find(c => c.name === target.container).imageID),
        namespace: 'sslping', deployment: target.name,
        desired_replicas: deployment.spec.replicas, ready_replicas: deployment.status.readyReplicas,
        observed_at: new Date(now()).toISOString(), cluster_endpoint: clusterEndpoint,
      }
    } catch {
      // Retry transient API errors and unfinished rollouts, without logging raw
      // Kubernetes objects or subprocess errors that could contain private data.
    }
    const remaining = deadline - now()
    if (remaining <= 0) break
    await pause(Math.min(pollMs, remaining))
  } while (now() < deadline)
  throw new Error('Runtime did not become ready on the expected release image within the verification window')
}

export function runtimeReader(target, read, now = Date.now) {
  const context = read(['config', 'current-context'], 10000).trim()
  assert.ok(context, 'Kubernetes context is missing')
  const endpoint = read(['config', 'view', '--context', context, '--minify', '-o', 'jsonpath={.clusters[0].cluster.server}'], 10000).trim()
  assert.equal(endpoint, clusterEndpoint, 'Cluster identity mismatch')
  return remaining => {
    const deadline = now() + remaining
    const get = resource => {
      const timeout = Math.min(15000, deadline - now())
      assert.ok(timeout > 0, 'Runtime verification deadline exceeded')
      return JSON.parse(read(['--context', context, `--request-timeout=${Math.max(1, Math.ceil(timeout / 1000))}s`, '-n', 'sslping', 'get', ...resource, '-o', 'json'], timeout))
    }
    return { deployment: get(['deployment', target.name]), pods: get(['pods', '-l', `app.kubernetes.io/name=${target.name}`]) }
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    assert.equal(process.argv.length, 6, 'Expected deployment, image, source SHA, receipt path')
    const [, , name, image, sha, output] = process.argv
    const target = releaseTarget(name, image, sha)
    const read = (args, timeout) => execFileSync('kubectl', args, { encoding: 'utf8', timeout, maxBuffer: 2 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] })
    const receipt = await waitForRelease(target, runtimeReader(target, read))
    writeFileSync(output, JSON.stringify(receipt, null, 2) + '\n', { mode: 0o600, flag: 'wx' })
    console.log(`Verified ${receipt.deployment}: ${receipt.ready_replicas}/${receipt.desired_replicas} replicas on ${receipt.expected_image}`)
  } catch {
    console.error('Production runtime verification failed; no successful release receipt was produced.')
    process.exitCode = 1
  }
}
