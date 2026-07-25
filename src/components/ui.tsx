import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from 'react'
import { useEffect } from 'react'
import { Search, X } from 'lucide-react'

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'success'

export function Button({
  variant = 'primary',
  size = 'md',
  className = '',
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant
  size?: 'sm' | 'md' | 'lg'
}) {
  return (
    <button className={`button button--${variant} button--${size} ${className}`} {...props}>
      {children}
    </button>
  )
}

export function IconButton({
  label,
  className = '',
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button className={`icon-button ${className}`} aria-label={label} title={label} {...props}>
      {children}
    </button>
  )
}

export function Panel({
  className = '',
  children,
}: {
  className?: string
  children: ReactNode
}) {
  return <section className={`panel ${className}`}>{children}</section>
}

export function Badge({
  tone = 'neutral',
  children,
  className = '',
}: {
  tone?: 'success' | 'danger' | 'warning' | 'info' | 'neutral' | 'purple'
  children: ReactNode
  className?: string
}) {
  return <span className={`badge badge--${tone} ${className}`}>{children}</span>
}

export function StatusDot({ status }: { status: string }) {
  const normalized = ['up', 'resolved', 'active', 'published'].includes(status.toLowerCase())
    ? 'up'
    : ['down', 'open', 'failed'].includes(status.toLowerCase())
      ? 'down'
      : ['paused', 'pending'].includes(status.toLowerCase())
        ? 'paused'
        : 'warning'
  return <span className={`status-dot status-dot--${normalized}`} aria-hidden="true" />
}

export function Toggle({
  checked,
  onChange,
  label,
  disabled = false,
}: {
  checked: boolean
  onChange: (next: boolean) => void
  label: string
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className={`toggle ${checked ? 'toggle--on' : ''}`}
      onClick={() => onChange(!checked)}
      disabled={disabled}
    >
      <span />
    </button>
  )
}

export function SearchInput({ className = '', ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className={`search-input ${className}`}>
      <Search size={18} aria-hidden="true" />
      <input type="search" {...props} />
    </label>
  )
}

export function Field({
  label,
  hint,
  error,
  children,
  className = '',
}: {
  label: string
  hint?: ReactNode
  error?: string
  children: ReactNode
  className?: string
}) {
  return (
    <label className={`field ${className}`}>
      <span className="field__label">{label}</span>
      {hint && <span className="field__hint">{hint}</span>}
      {children}
      {error && <span className="field__error">{error}</span>}
    </label>
  )
}

export function Select({
  children,
  className = '',
  ...props
}: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={`select ${className}`} {...props}>
      {children}
    </select>
  )
}

export function PageHeader({
  title,
  eyebrow,
  description,
  actions,
}: {
  title: ReactNode
  eyebrow?: string
  description?: ReactNode
  actions?: ReactNode
}) {
  return (
    <header className="page-header">
      <div>
        {eyebrow && <p className="eyebrow">{eyebrow}</p>}
        <h1>{title}<span className="title-dot">.</span></h1>
        {description && <p className="page-header__description">{description}</p>}
      </div>
      {actions && <div className="page-header__actions">{actions}</div>}
    </header>
  )
}

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon: ReactNode
  title: string
  description: string
  action?: ReactNode
}) {
  return (
    <div className="empty-state">
      <div className="empty-state__icon">{icon}</div>
      <h2>{title}</h2>
      <p>{description}</p>
      {action}
    </div>
  )
}

export function Modal({
  open,
  onClose,
  title,
  icon,
  children,
  width = 'md',
}: {
  open: boolean
  onClose: () => void
  title: ReactNode
  icon?: ReactNode
  children: ReactNode
  width?: 'sm' | 'md' | 'lg' | 'xl'
}) {
  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    document.body.classList.add('modal-open')
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.body.classList.remove('modal-open')
    }
  }, [open, onClose])

  if (!open) return null
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className={`modal modal--${width}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="modal__header">
          {icon && <div className="modal__icon">{icon}</div>}
          <h2 id="modal-title">{title}</h2>
          <IconButton label="Close" className="modal__close" onClick={onClose}>
            <X size={24} />
          </IconButton>
        </header>
        <div className="modal__body">{children}</div>
      </section>
    </div>
  )
}

export function SegmentedControl<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T
  options: Array<{ value: T; label: string }>
  onChange: (value: T) => void
  label: string
}) {
  return (
    <div className="segmented" role="group" aria-label={label}>
      {options.map((option) => (
        <button
          type="button"
          key={option.value}
          className={value === option.value ? 'is-active' : ''}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

export function Skeleton({ className = '' }: { className?: string }) {
  return <span className={`skeleton ${className}`} aria-hidden="true" />
}
