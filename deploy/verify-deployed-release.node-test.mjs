import assert from 'node:assert/strict'
import test from 'node:test'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { clusterEndpoint, releaseTarget, runtimeReader, waitForRelease } from './verify-deployed-release.mjs'

for (const [name, container] of [['sslping-dashboard', 'dashboard'], ['sslping-marketing-site', 'marketing-site']]) {
  const image = `registry.digitalocean.com/mitrohin-registry/${name}@sha256:${'a'.repeat(64)}`
  const target = releaseTarget(name, image, 'b'.repeat(40))
  function snapshot(actual = image) {
    const deployment = { kind: 'Deployment', metadata: { name, namespace: 'sslping', generation: 2, annotations: { private: 'do-not-export' } }, spec: { replicas: 2, selector: { matchLabels: { 'app.kubernetes.io/name': name } }, template: { spec: { containers: [{ name: container, image: actual }] } } }, status: { observedGeneration: 2, replicas: 2, updatedReplicas: 2, readyReplicas: 2, availableReplicas: 2 } }
    const pod = { metadata: { namespace: 'sslping', labels: { 'app.kubernetes.io/name': name } }, spec: { containers: [{ name: container, image: actual }] }, status: { phase: 'Running', conditions: [{ type: 'Ready', status: 'True' }], containerStatuses: [{ name: container, ready: true, state: { running: {} }, imageID: actual }] } }
    return { deployment, pods: { items: [structuredClone(pod), structuredClone(pod)] } }
  }
  function clock() { let t = 0; return { now: () => t, pause: async ms => { t += ms }, timeoutMs: 20, pollMs: 5 } }
  test(`${name}: receipt identifies the expected commit and every running replica, without API payload`, async () => {
    const receipt = await waitForRelease(target, () => snapshot(), clock())
    assert.equal(receipt.source_sha, 'b'.repeat(40))
    assert.equal(receipt.expected_image, image)
    assert.deepEqual(receipt.actual_image_ids, [image, image])
    assert.equal(receipt.ready_replicas, 2)
    assert.equal(receipt.desired_replicas, 2)
    assert.equal(receipt.cluster_endpoint, clusterEndpoint)
    assert.ok(receipt.observed_at)
    assert.ok(!JSON.stringify(receipt).includes('do-not-export'))
  })
  test(`${name}: retries a transient read and unfinished rollout before accepting`, async () => {
    let calls = 0
    const result = await waitForRelease(target, () => {
      calls++
      if (calls === 1) throw new Error('private upstream error')
      const state = snapshot()
      if (calls === 2) state.deployment.status.readyReplicas = 1
      return state
    }, clock())
    assert.equal(calls, 3)
    assert.equal(result.status, 'verified')
  })
  test(`${name}: a stable old image never yields a successful receipt`, async () => {
    await assert.rejects(waitForRelease(target, () => snapshot(image.replace('a'.repeat(64), 'c'.repeat(64))), clock()), /expected release image/)
  })
  test(`${name}: unavailable API has a finite deadline and does not expose its errors`, async () => {
    let calls = 0
    await assert.rejects(waitForRelease(target, () => { calls++; throw new Error('token=do-not-export') }, clock()), error => !error.message.includes('do-not-export'))
    assert.equal(calls, 4)
  })
  test(`${name}: CLI saves a private receipt, and a wrong cluster fails without one`, () => {
    const dir = mkdtempSync(join(tmpdir(), 'frontend-release-test-'))
    try {
      const fixture = snapshot()
      writeFileSync(join(dir, 'kubectl'), `#!/usr/bin/env node\nconst args = process.argv.slice(2);\nif (args.includes('current-context')) console.log('fixture-context');\nelse if (args.includes('view')) console.log(process.env.FIXTURE_CLUSTER);\nelse if (!args.includes('--context') || !args.includes('fixture-context')) process.exit(2);\nelse if (args.includes('deployment')) console.log(${JSON.stringify(JSON.stringify(fixture.deployment))});\nelse if (args.includes('pods')) console.log(${JSON.stringify(JSON.stringify(fixture.pods))});\nelse process.exit(2);\n`, { mode: 0o700 })
      const script = fileURLToPath(new URL('./verify-deployed-release.mjs', import.meta.url))
      const goodPath = join(dir, 'success.json')
      const run = (output, endpoint) => spawnSync(process.execPath, [script, name, image, target.sourceSha, output], { encoding: 'utf8', timeout: 5000, env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, FIXTURE_CLUSTER: endpoint } })
      const good = run(goodPath, clusterEndpoint)
      assert.equal(good.status, 0, good.stderr)
      assert.equal(statSync(goodPath).mode & 0o777, 0o600)
      assert.equal(JSON.parse(readFileSync(goodPath, 'utf8')).expected_image, image)
      const badPath = join(dir, 'failure.json')
      const bad = run(badPath, 'https://wrong-cluster')
      assert.equal(bad.status, 1)
      assert.equal(existsSync(badPath), false)
      assert.ok(!bad.stderr.includes('wrong-cluster'))
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })
}

test('wrong cluster stops before Deployment or pod reads', () => {
  const calls = []
  assert.throws(() => runtimeReader({}, args => { calls.push(args); return calls.length === 1 ? 'wrong-context' : 'https://wrong-cluster' }), /Cluster identity/)
  assert.equal(calls.length, 2)
  assert.ok(calls.every(args => args[0] === 'config'))
})
test('release inputs reject mutable images, foreign repository, and abbreviated source SHA', () => {
  for (const image of ['latest', 'example.invalid/repo@sha256:' + 'a'.repeat(64)]) assert.throws(() => releaseTarget('sslping-dashboard', image, 'b'.repeat(40)))
  assert.throws(() => releaseTarget('sslping-dashboard', 'registry.digitalocean.com/mitrohin-registry/sslping-dashboard@sha256:' + 'a'.repeat(64), 'short'))
})
