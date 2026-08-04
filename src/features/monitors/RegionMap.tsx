import type { CSSProperties } from 'react'

export interface RegionMapRegion {
  id: string
  label: string
  color?: string
}

interface RegionCoordinates {
  latitude: number
  longitude: number
}

interface KnownRegion extends RegionCoordinates {
  aliases: readonly string[]
}

const knownRegions: readonly KnownRegion[] = [
  { aliases: ['local', 'frankfurt', 'fra'], latitude: 50.11, longitude: 8.68 },
  { aliases: ['singapore', 'sin', 'sg'], latitude: 1.35, longitude: 103.82 },
  { aliases: ['bangalore', 'bengaluru', 'blr'], latitude: 12.97, longitude: 77.59 },
  { aliases: ['amsterdam', 'ams'], latitude: 52.37, longitude: 4.9 },
  { aliases: ['london', 'lon', 'lhr'], latitude: 51.51, longitude: -0.13 },
  { aliases: ['warsaw', 'waw'], latitude: 52.23, longitude: 21.01 },
  { aliases: ['dubai', 'dxb'], latitude: 25.2, longitude: 55.27 },
  { aliases: ['mumbai', 'bom'], latitude: 19.08, longitude: 72.88 },
  { aliases: ['tokyo', 'nrt', 'hnd'], latitude: 35.68, longitude: 139.69 },
  { aliases: ['seoul', 'icn'], latitude: 37.57, longitude: 126.98 },
  { aliases: ['new york', 'new-york', 'nyc'], latitude: 40.71, longitude: -74.01 },
  { aliases: ['san francisco', 'san-francisco', 'sfo'], latitude: 37.77, longitude: -122.42 },
  { aliases: ['toronto', 'yyz'], latitude: 43.65, longitude: -79.38 },
  { aliases: ['sao paulo', 'são paulo', 'gru'], latitude: -23.55, longitude: -46.63 },
  { aliases: ['johannesburg', 'jnb'], latitude: -26.2, longitude: 28.05 },
  { aliases: ['sydney', 'syd'], latitude: -33.87, longitude: 151.21 },
  { aliases: ['north america'], latitude: 39.83, longitude: -98.58 },
  { aliases: ['europe'], latitude: 50.11, longitude: 8.68 },
  { aliases: ['asia pacific'], latitude: 1.35, longitude: 103.82 },
]

const markerColors = ['#48bff2', '#35d67b', '#a78bfa', '#f7b955', '#fb7185'] as const

function normalizeLocation(value: string): string {
  return value
    .toLocaleLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

export function resolveRegionCoordinates(region: RegionMapRegion): RegionCoordinates | undefined {
  const normalizedId = normalizeLocation(region.id)
  const normalizedLabel = normalizeLocation(region.label)
  return knownRegions.find((candidate) => candidate.aliases.some((alias) => {
    const normalizedAlias = normalizeLocation(alias)
    return normalizedId === normalizedAlias
      || normalizedId.startsWith(`${normalizedAlias} `)
      || normalizedLabel === normalizedAlias
      || normalizedLabel.includes(` ${normalizedAlias}`)
      || normalizedLabel.startsWith(`${normalizedAlias} `)
  }))
}

function projectToMap(coordinates: RegionCoordinates) {
  return {
    left: Number((((coordinates.longitude + 180) / 360) * 100).toFixed(2)),
    top: Number((((90 - coordinates.latitude) / 180) * 100).toFixed(2)),
  }
}

export function RegionMap({ regions, label }: { regions: readonly RegionMapRegion[]; label: string }) {
  const mappedRegions = regions.map((region, index) => {
    const coordinates = resolveRegionCoordinates(region)
    return {
      ...region,
      color: region.color ?? markerColors[index % markerColors.length],
      position: coordinates ? projectToMap(coordinates) : undefined,
    }
  })
  const accessibleLabel = `${label}: ${mappedRegions.map((region) => region.label).join(', ')}`

  return (
    <div className="region-map-block">
      <div className="region-map" role="img" aria-label={accessibleLabel}>
        <svg className="region-map__world" viewBox="0 0 360 176" aria-hidden="true">
          <defs>
            <linearGradient id="region-map-land" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#627892" />
              <stop offset="1" stopColor="#40546d" />
            </linearGradient>
          </defs>
          <g className="region-map__grid">
            <path d="M0 44H360M0 88H360M0 132H360" />
            <path d="M60 0V176M120 0V176M180 0V176M240 0V176M300 0V176" />
          </g>
          <g className="region-map__land" fill="url(#region-map-land)">
            <path d="M18 37 31 22 56 13 82 17 98 29 112 31 118 42 108 51 99 49 90 60 80 64 74 75 64 79 56 70 45 66 39 55 26 52Z" />
            <path d="m70 84 17 2 15 11 8 18-4 20-12 24-9-8-3-20-8-14-3-17-10-9Z" />
            <path d="m126 17 13-8 16 4 4 12-12 9-17-5Z" />
            <path d="m145 48 15-13 20-4 17 5 15-8 30 4 18 10 22 2 17 10 24 4 23 16-9 11-24 1-12 10-21-1-10-11-17 2-16-8-17 5-12-7-15 2-10-9-18-3Z" />
            <path d="m163 77 18-7 21 8 11 16-7 25-13 20-11 4-12-17-5-21-12-13Z" />
            <path d="m279 118 16-9 20 4 15 12-8 14-23 6-17-8Z" />
            <path d="m326 77 7-6 6 7-3 13-7-4Z" />
            <path d="m349 148 4-5 4 3-2 8Z" />
          </g>
          <g className="region-map__islands" fill="currentColor">
            <circle cx="249" cy="103" r="1.7" />
            <circle cx="263" cy="105" r="1.4" />
            <circle cx="276" cy="97" r="1.6" />
            <circle cx="315" cy="92" r="1.5" />
          </g>
        </svg>
        {mappedRegions.map((region) => region.position && (
          <span
            className="region-map__marker"
            data-testid={`region-marker-${region.id}`}
            key={region.id}
            title={region.label}
            style={{
              '--region-color': region.color,
              left: `${region.position.left}%`,
              top: `${region.position.top}%`,
            } as CSSProperties}
          >
            <span className="region-map__marker-pulse" />
            <span className="region-map__marker-dot" />
          </span>
        ))}
      </div>
      <div className="region-map__legend" aria-hidden="true">
        {mappedRegions.map((region) => (
          <span className="region-map__legend-item" key={region.id}>
            <i style={{ '--region-color': region.color } as CSSProperties} />
            {region.label}
          </span>
        ))}
      </div>
    </div>
  )
}
