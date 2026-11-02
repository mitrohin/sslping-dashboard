import assert from 'node:assert/strict'
import test from 'node:test'
import { selectDeployedImage } from './select-deployed-image.mjs'

for (const [name, container] of [['sslping-dashboard', 'dashboard'], ['sslping-marketing-site', 'marketing-site']]) {
  const repository = `registry.digitalocean.com/mitrohin-registry/${name}`
  const image = `${repository}@sha256:${'a'.repeat(64)}`
  function fixture() {
    const deployment = { kind: 'Deployment', metadata: { name, namespace: 'sslping', generation: 3 }, spec: { replicas: 2, selector: { matchLabels: { 'app.kubernetes.io/name': name } }, template: { spec: { containers: [{ name: container, image }] } } }, status: { observedGeneration: 3, replicas: 2, updatedReplicas: 2, readyReplicas: 2, availableReplicas: 2 } }
    const pod = { metadata: { namespace: 'sslping', labels: { 'app.kubernetes.io/name': name } }, spec: { containers: [{ name: container, image }] }, status: { phase: 'Running', conditions: [{ type: 'Ready', status: 'True' }], containerStatuses: [{ name: container, ready: true, state: { running: {} }, imageID: image }] } }
    return [deployment, { items: [structuredClone(pod), structuredClone(pod)] }]
  }
  const select = (deployment, pods) => selectDeployedImage(deployment, pods, name, container, repository)
  test(`${name}: scans the immutable digest of all ready replicas`, () => {
    assert.equal(select(...fixture()), image)
  })
  const invalid = {
    'mutable tag': ([d]) => { d.spec.template.spec.containers[0].image = `${repository}:latest` },
    'foreign registry': ([d]) => { d.spec.template.spec.containers[0].image = `example.invalid/image@sha256:${'a'.repeat(64)}` },
    'malformed digest': ([d]) => { d.spec.template.spec.containers[0].image += '\nINJECTED=value' },
    'wrong deployment': ([d]) => { d.metadata.name = 'other' },
    'wrong namespace': ([d]) => { d.metadata.namespace = 'default' },
    'unobserved generation': ([d]) => { d.status.observedGeneration = 2 },
    'unfinished rollout': ([d]) => { d.status.updatedReplicas = 1 },
    'missing replica': ([, pods]) => { pods.items.pop() },
    'terminating replica': ([, pods]) => { pods.items[0].metadata.deletionTimestamp = '2026-11-02T10:00:00Z' },
    'unready replica': ([, pods]) => { pods.items[0].status.containerStatuses[0].ready = false },
    'old runtime digest': ([, pods]) => { pods.items[0].status.containerStatuses[0].imageID = `${repository}@sha256:${'b'.repeat(64)}` },
    'missing runtime evidence': ([, pods]) => { delete pods.items[0].status.containerStatuses[0].imageID },
  }
  for (const [reason, mutate] of Object.entries(invalid)) {
    test(`${name}: rejects ${reason}`, () => { const input = fixture(); mutate(input); assert.throws(() => select(...input)) })
  }
}
