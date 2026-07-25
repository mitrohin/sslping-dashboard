export function UptimeBars({
  values,
  compact = false,
  label = 'Uptime history',
}: {
  values: number[]
  compact?: boolean
  label?: string
}) {
  return (
    <div className={`uptime-bars ${compact ? 'uptime-bars--compact' : ''}`} aria-label={label}>
      {values.map((value, index) => (
        <span
          // Time-series index is stable for this visual dataset.
          key={index}
          className={value >= 99 ? 'is-up' : value <= 0 ? 'is-down' : 'is-warning'}
          title={`${value.toFixed(value % 1 ? 1 : 0)}%`}
        />
      ))}
    </div>
  )
}
