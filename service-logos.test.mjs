import { createHash } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

describe('catalog service logo pack', () => {
  it('matches the locked 776-file manifest and contains inert SVG', async () => {
    const root = process.cwd()
    const manifest = JSON.parse(await readFile(path.join(root, 'data/service-logos.json'), 'utf8'))
    const directory = path.join(root, 'public/assets/service-logos')
    const compare = (left, right) => left.localeCompare(right, 'en')
    const files = (await readdir(directory)).filter((file) => file.endsWith('.svg')).sort(compare)
    const ids = Object.keys(manifest.services).sort(compare)

    expect(manifest.schema_version).toBe(1)
    expect(manifest.algorithm_version).toBe(2)
    expect(manifest.simple_icons_version).toBe('16.28.0')
    expect(ids).toHaveLength(776)
    expect(files).toEqual(ids.map((id) => `${id}.svg`).sort(compare))

    const unsafe = /<!doctype|<!entity|<\?xml-stylesheet|<\/?(?:script|style|foreignObject|iframe|object|embed|audio|video|canvas|animate|animateTransform|set)\b|\son[a-z0-9:_-]+\s*=|javascript\s*:|@import|expression\s*\(|\ssrc\s*=|\bxlink:/i
    for (const id of ids) {
      const entry = manifest.services[id]
      const asset = await readFile(path.join(directory, `${id}.svg`))
      expect(entry.file).toBe(`assets/service-logos/${id}.svg`)
      expect(entry.mime_type).toBe('image/svg+xml')
      expect(['official-svg', 'simple-icons', 'fallback']).toContain(entry.kind)
      expect(createHash('sha256').update(asset).digest('hex')).toBe(entry.sha256)
      expect(asset.toString('utf8')).not.toMatch(unsafe)
    }
  })

  it('serves existing logos with bounded caching and never caches missing ones', async () => {
    const config = await readFile(path.join(process.cwd(), 'deploy/nginx/default.conf'), 'utf8')
    const logoLocations = [...config.matchAll(/location \^~ \/assets\/service-logos\/ \{([\s\S]*?)\n\s*\}/g)]
    const missingLocations = [...config.matchAll(/location @service_logo_not_found \{([\s\S]*?)\n\s*\}/g)]

    expect(logoLocations).toHaveLength(3)
    expect(missingLocations).toHaveLength(3)
    for (const [, location] of logoLocations) {
      expect(location).toMatch(/try_files \$uri @service_logo_not_found;/)
      expect(location).toMatch(/max-age=86400, stale-while-revalidate=604800/)
      expect(location).not.toMatch(/immutable/)
    }
    for (const [, location] of missingLocations) {
      expect(location).toMatch(/Cache-Control "no-store" always;/)
      expect(location).toMatch(/return 404;/)
    }
  })
})
