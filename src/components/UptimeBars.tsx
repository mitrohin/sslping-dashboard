export function UptimeBars({
  values,
  titles,
  compact = false,
  label = 'Uptime history',
}: {
  values: Array<number | null>
  titles?: string[]
  compact?: boolean
  label?: string
}) {
  return (
    <div className={`uptime-bars ${compact ? 'uptime-bars--compact' : ''}`} aria-label={label}>
      {values.map((value, index) => (
        <span
          // Time-series index is stable for this visual dataset.
          key={index}
          className={value === null ? 'is-no-data' : value >= 99 ? 'is-up' : value <= 0 ? 'is-down' : 'is-warning'}
          title={titles?.[index] ?? (value === null ? 'No checks in this hour' : `${value.toFixed(value % 1 ? 1 : 0)}%`)}
        />
      ))}
    </div>
  )
}
