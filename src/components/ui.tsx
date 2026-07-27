import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from 'react'
import { useEffect, useId, useRef } from 'react'
import { CheckCircle2, ChevronDown, CircleAlert, Info, Search, TriangleAlert, X } from 'lucide-react'

let openModalCount = 0
let originalBodyPaddingRight = ''

function lockPageScroll() {
  if (openModalCount === 0) {
    const body = document.body
    const viewportWidth = document.documentElement.clientWidth
    const scrollbarWidth = viewportWidth > 0 ? Math.max(0, window.innerWidth - viewportWidth) : 0
    originalBodyPaddingRight = body.style.paddingRight

    if (scrollbarWidth > 0) {
      const currentPadding = Number.parseFloat(window.getComputedStyle(body).paddingRight) || 0
      body.style.paddingRight = `${currentPadding + scrollbarWidth}px`
    }
    body.classList.add('modal-open')
  }

  openModalCount += 1
  let released = false
  return () => {
    if (released) return
    released = true
    openModalCount = Math.max(0, openModalCount - 1)
    if (openModalCount > 0) return
    document.body.classList.remove('modal-open')
    document.body.style.paddingRight = originalBodyPaddingRight
  }
}

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

export type FeedbackTone = 'success' | 'error' | 'warning' | 'info'

const feedbackMeta = {
  success: { title: 'Changes saved', icon: CheckCircle2 },
  error: { title: 'Something went wrong', icon: CircleAlert },
  warning: { title: 'Attention required', icon: TriangleAlert },
  info: { title: 'Information', icon: Info },
} satisfies Record<FeedbackTone, { title: string; icon: typeof CheckCircle2 }>

export function FeedbackBanner({
  tone,
  title,
  children,
  action,
  onDismiss,
  className = '',
}: {
  tone: FeedbackTone
  title?: string
  children: ReactNode
  action?: ReactNode
  onDismiss?: () => void
  className?: string
}) {
  const meta = feedbackMeta[tone]
  const Icon = meta.icon

  return (
    <div
      className={`feedback-banner feedback-banner--${tone} ${className}`}
      role={tone === 'error' ? 'alert' : 'status'}
      aria-live={tone === 'error' ? 'assertive' : 'polite'}
    >
      <span className="feedback-banner__icon" aria-hidden="true"><Icon size={20} /></span>
      <div className="feedback-banner__copy">
        <strong>{title ?? meta.title}</strong>
        <span>{children}</span>
      </div>
      {action && <div className="feedback-banner__action">{action}</div>}
      {onDismiss && (
        <IconButton className="feedback-banner__dismiss" label="Dismiss notification" onClick={onDismiss}>
          <X size={18} />
        </IconButton>
      )}
    </div>
  )
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
      onClick={(event) => {
        // A few settings rows use the switch next to descriptive text. Prevent
        // an enclosing label from activating the button a second time.
        event.preventDefault()
        event.stopPropagation()
        onChange(!checked)
      }}
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
    <span className="select-control">
      <select className={`select ${className}`} {...props}>
        {children}
      </select>
      <ChevronDown className="select-control__chevron" aria-hidden="true" />
    </span>
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
  className = '',
}: {
  open: boolean
  onClose: () => void
  title: ReactNode
  icon?: ReactNode
  children: ReactNode
  width?: 'sm' | 'md' | 'lg' | 'xl'
  className?: string
}) {
  const titleId = useId()
  const dialogRef = useRef<HTMLElement>(null)
  const returnFocusRef = useRef<HTMLElement | null>(null)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  useEffect(() => {
    if (!open) return
    returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const focusableSelector = [
      'a[href]',
      'button:not([disabled])',
      'input:not([disabled])',
      'select:not([disabled])',
      'textarea:not([disabled])',
      '[tabindex]:not([tabindex="-1"])',
    ].join(',')
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onCloseRef.current()
        return
      }
      if (event.key !== 'Tab' || !dialogRef.current) return
      const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(focusableSelector))
        .filter((element) => element.getClientRects().length > 0)
      if (focusable.length === 0) {
        event.preventDefault()
        dialogRef.current.focus()
        return
      }
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && (document.activeElement === first || document.activeElement === dialogRef.current)) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    const unlockPageScroll = lockPageScroll()
    const focusFrame = window.requestAnimationFrame(() => {
      // Do not steal focus when the user (or an immediately rendered child)
      // has already moved it inside the dialog before this frame runs.
      if (dialogRef.current?.contains(document.activeElement)) return
      const first = dialogRef.current?.querySelector<HTMLElement>(focusableSelector)
      ;(first ?? dialogRef.current)?.focus()
    })
    return () => {
      window.cancelAnimationFrame(focusFrame)
      document.removeEventListener('keydown', onKeyDown)
      unlockPageScroll()
      returnFocusRef.current?.focus()
    }
  }, [open])

  if (!open) return null
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        ref={dialogRef}
        className={`modal modal--${width} ${className}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="modal__header">
          {icon && <div className="modal__icon">{icon}</div>}
          <h2 id={titleId}>{title}</h2>
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
