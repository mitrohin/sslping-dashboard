import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// Fail closed during rollout or when runtime evidence differs from the desired
// image. A successful scan must identify a stable, actually running digest.
export function selectDeployedImage(deployment, podList, name, containerName, repository) {
  assert.equal(deployment.kind, 'Deployment', 'Expected a Deployment')
  assert.equal(deployment.metadata?.namespace, 'sslping', 'Unexpected namespace')
  assert.equal(deployment.metadata?.name, name, 'Unexpected deployment')
  assert.equal(deployment.spec?.selector?.matchLabels?.['app.kubernetes.io/name'], name, 'Unexpected pod selector')
  assert.match(repository, /^registry\.digitalocean\.com\/mitrohin-registry\/sslping-(dashboard|marketing-site)$/)
  const image = deployment.spec?.template?.spec?.containers?.find(c => c.name === containerName)?.image
  assert.equal(typeof image, 'string', 'Container image is missing')
  assert.ok(image.startsWith(`${repository}@sha256:`), 'Unexpected image repository or mutable tag')
  assert.match(image.slice(repository.length), /^@sha256:[a-f0-9]{64}$/, 'Expected an immutable SHA256 image')
  const replicas = deployment.spec.replicas
  assert.ok(Number.isInteger(replicas) && replicas > 0, 'No desired replicas')
  assert.ok(Number.isInteger(deployment.metadata.generation) && deployment.status?.observedGeneration >= deployment.metadata.generation, 'Deployment generation not observed')
  for (const field of ['replicas', 'updatedReplicas', 'readyReplicas', 'availableReplicas']) {
    assert.equal(deployment.status?.[field], replicas, `Deployment is not stable: ${field}`)
  }
  assert.equal(deployment.status?.unavailableReplicas ?? 0, 0, 'Deployment has unavailable replicas')
  assert.ok(Array.isArray(podList.items), 'Pod list is missing')
  // Terminating/extra pods are intentionally rejected instead of silently
  // reporting a clean scan of only one side of an unfinished rollout.
  assert.equal(podList.items.length, replicas, 'Pod count differs from stable deployment')
  for (const pod of podList.items) {
    assert.equal(pod.metadata?.namespace, 'sslping', 'Unexpected pod namespace')
    assert.equal(pod.metadata?.labels?.['app.kubernetes.io/name'], name, 'Unexpected pod label')
    assert.ok(!pod.metadata?.deletionTimestamp, 'Pod is terminating')
    assert.equal(pod.status?.phase, 'Running', 'Pod is not running')
    assert.ok(pod.status?.conditions?.some(c => c.type === 'Ready' && c.status === 'True'), 'Pod is not Ready')
    assert.equal(pod.spec?.containers?.find(c => c.name === containerName)?.image, image, 'Pod has another desired image')
    const status = pod.status?.containerStatuses?.find(c => c.name === containerName)
    assert.ok(status?.ready && status.state?.running, 'Container is not running and ready')
    assert.equal(status.imageID?.replace(/^docker-pullable:\/\//, ''), image, 'Runtime digest differs from deployment image')
  }
  return image
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    assert.equal(process.argv.length, 7, 'Usage: select-deployed-image.mjs deployment.json pods.json deployment container repository')
    const [, , deploymentFile, podsFile, name, containerName, repository] = process.argv
    console.log(selectDeployedImage(JSON.parse(readFileSync(deploymentFile, 'utf8')), JSON.parse(readFileSync(podsFile, 'utf8')), name, containerName, repository))
  } catch (error) {
    // Do not dump full Kubernetes objects, credentials, or arbitrary API data.
    console.error(`Cannot verify deployed image: ${error.message.split('\n')[0]}`)
    process.exitCode = 1
  }
}
