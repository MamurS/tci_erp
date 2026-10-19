/**
 * Core UI primitives per DESIGN.md. Screens compose these — no ad-hoc
 * one-off controls.
 *
 * Visual language (Delcreda corporate): navy #005288 for primary actions and
 * structure, process blue #0093D0 for focus, active states and the section
 * marker, condensed PT Sans Narrow for titles / labels / key figures, Inter
 * for running UI text. Crisp 6–10px radii, hairline borders, soft shadows.
 */
import { useEffect, useId } from 'react'
import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from 'react'

// ---------------------------------------------------------------------------
// Button
// ---------------------------------------------------------------------------

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'accent'

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary:
    'bg-accent-600 text-white shadow-sm hover:bg-accent-700 active:bg-accent-800 disabled:bg-accent-600/45',
  secondary:
    'border border-slate-300 bg-white text-slate-700 shadow-sm hover:border-slate-400 hover:bg-slate-50 disabled:opacity-50',
  ghost: 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 disabled:opacity-50',
  danger: 'bg-neg-500 text-white shadow-sm hover:bg-neg-600 disabled:opacity-50',
  // The orange brand accent: one prominent call to action per screen, at most.
  accent: 'bg-brand-orange text-white shadow-sm hover:brightness-95 disabled:opacity-50',
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: 'md' | 'sm'
}

export function Button({ variant = 'primary', size = 'md', className = '', ...rest }: ButtonProps) {
  const sizing = size === 'sm' ? 'h-8 px-2.5 text-[13px]' : 'h-9 px-3.5 text-sm'
  return (
    <button
      type="button"
      className={`inline-flex shrink-0 items-center justify-center gap-1.5 rounded-md font-medium whitespace-nowrap transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-500 disabled:cursor-not-allowed [&_svg]:size-4 ${sizing} ${BUTTON_VARIANTS[variant]} ${className}`}
      {...rest}
    />
  )
}

// ---------------------------------------------------------------------------
// Form controls
// ---------------------------------------------------------------------------

const CONTROL_CLASSES =
  'w-full rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-900 shadow-[inset_0_1px_1px_rgb(0_0_0/0.03)] transition-colors placeholder:text-slate-400 hover:border-slate-400 focus:border-accent-500 focus:outline-none focus:ring-3 focus:ring-accent-500/20 disabled:bg-slate-50 disabled:text-slate-400'

interface FieldProps {
  label?: string
  /** Helper text under the control. */
  hint?: string
  children: ReactNode
  className?: string
}

export function Field({ label, hint, children, className = '' }: FieldProps) {
  return (
    <label className={`flex flex-col gap-1.5 ${className}`}>
      {label && (
        <span className="text-[12px] font-semibold tracking-wide text-slate-600 uppercase">
          {label}
        </span>
      )}
      {children}
      {hint && <span className="text-xs text-slate-500">{hint}</span>}
    </label>
  )
}

export function Input({ className = '', ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={`h-9 ${CONTROL_CLASSES} ${className}`} {...rest} />
}

export function Textarea({ className = '', ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={`${CONTROL_CLASSES} min-h-20 py-2 ${className}`} {...rest} />
}

export function Select({ className = '', children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={`h-9 ${CONTROL_CLASSES} pr-8 ${className}`} {...rest}>
      {children}
    </select>
  )
}

// ---------------------------------------------------------------------------
// Card
// ---------------------------------------------------------------------------

interface CardProps {
  children: ReactNode
  className?: string
}

export function Card({ children, className = '' }: CardProps) {
  return (
    <div className={`rounded-lg border border-slate-200/90 bg-white shadow-card ${className}`}>
      {children}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Section title — the brand marker: a process-blue square + condensed caps
// ---------------------------------------------------------------------------

interface SectionTitleProps {
  children: ReactNode
  /** Right-aligned controls on the same line. */
  actions?: ReactNode
  /** A blue hairline under the title, as in the printed report. */
  rule?: boolean
  className?: string
}

export function SectionTitle({ children, actions, rule = false, className = '' }: SectionTitleProps) {
  return (
    <div
      className={`flex items-center justify-between gap-3 ${
        rule ? 'border-b border-accent-500 pb-1.5' : ''
      } ${className}`}
    >
      <h2 className="flex items-center gap-2 font-display text-[17px] leading-tight font-bold tracking-wide text-accent-600 uppercase">
        <span aria-hidden="true" className="inline-block size-2.5 shrink-0 bg-accent-500" />
        {children}
      </h2>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  )
}

// ---------------------------------------------------------------------------
// StatCard — a key figure with its comparison (report «Key figures» style)
// ---------------------------------------------------------------------------

interface StatCardProps {
  label: ReactNode
  value: ReactNode
  /** Secondary line: prior period, change, context. */
  meta?: ReactNode
  /** Optional icon in the top-right corner. */
  icon?: ReactNode
  tone?: 'default' | 'warn' | 'neg' | 'pos'
  onClick?: () => void
  className?: string
}

const STAT_TONES: Record<NonNullable<StatCardProps['tone']>, string> = {
  default: 'border-t-accent-500',
  pos: 'border-t-pos-500',
  warn: 'border-t-brand-orange',
  neg: 'border-t-neg-500',
}

export function StatCard({
  label,
  value,
  meta,
  icon,
  tone = 'default',
  onClick,
  className = '',
}: StatCardProps) {
  const Tag = onClick ? 'button' : 'div'
  return (
    <Tag
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      className={`group flex flex-col gap-1 rounded-lg border border-slate-200/90 border-t-[3px] bg-white px-4 pt-3 pb-3.5 text-left shadow-card transition-shadow ${
        STAT_TONES[tone]
      } ${onClick ? 'cursor-pointer hover:shadow-pop focus-visible:outline-2 focus-visible:outline-accent-500' : ''} ${className}`}
    >
      <span className="flex items-start justify-between gap-2 text-[12px] font-medium text-slate-500">
        {label}
        {icon && <span className="text-accent-500 [&_svg]:size-4">{icon}</span>}
      </span>
      <span className="num text-left font-display text-[26px] leading-none font-bold text-accent-600">
        {value}
      </span>
      {meta && <span className="mt-0.5 text-[12px] text-slate-500">{meta}</span>}
    </Tag>
  )
}

// ---------------------------------------------------------------------------
// Badge
// ---------------------------------------------------------------------------

type BadgeTone = 'neutral' | 'accent' | 'pos' | 'neg' | 'negStrong' | 'warn'

const BADGE_TONES: Record<BadgeTone, string> = {
  neutral: 'bg-slate-100 text-slate-600 ring-slate-200',
  accent: 'bg-accent-50 text-accent-700 ring-accent-200',
  pos: 'bg-pos-50 text-pos-500 ring-pos-500/20',
  neg: 'bg-neg-50 text-neg-500 ring-neg-500/20',
  // Solid danger for statuses that must not be mistaken for ordinary
  // termination (e.g. policy annulment vs cancellation).
  negStrong: 'bg-neg-500 text-white ring-neg-500',
  warn: 'bg-warn-50 text-warn-500 ring-warn-500/25',
}

interface BadgeProps {
  tone?: BadgeTone
  /** lg: prominent badge (e.g. the grade badge in the buyer header). */
  size?: 'md' | 'lg'
  children: ReactNode
}

export function Badge({ tone = 'neutral', size = 'md', children }: BadgeProps) {
  const sizing = size === 'lg' ? 'px-3 py-1 text-sm font-bold' : 'px-2 py-0.5 text-xs font-medium'
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full whitespace-nowrap ring-1 ring-inset ${sizing} ${BADGE_TONES[tone]}`}
    >
      {children}
    </span>
  )
}

// ---------------------------------------------------------------------------
// Segmented control
// ---------------------------------------------------------------------------

export interface SegmentedOption {
  key: string
  label: string
  disabled?: boolean
}

interface SegmentedProps {
  value: string
  options: SegmentedOption[]
  onChange: (key: string) => void
  ariaLabel?: string
}

/** Small mutually-exclusive switch (report type, display currency, language). */
export function Segmented({ value, options, onChange, ariaLabel }: SegmentedProps) {
  return (
    <div
      className="inline-flex rounded-md border border-slate-200 bg-slate-100/70 p-0.5"
      role="group"
      aria-label={ariaLabel}
    >
      {options.map((option) => (
        <button
          key={option.key}
          type="button"
          disabled={option.disabled}
          aria-pressed={option.key === value}
          onClick={() => onChange(option.key)}
          className={`rounded-[5px] px-2.5 py-1 text-xs font-semibold transition-colors ${
            option.key === value
              ? 'bg-white text-accent-600 shadow-sm ring-1 ring-slate-200'
              : 'text-slate-500 hover:text-slate-800'
          } ${option.disabled ? 'cursor-not-allowed opacity-50' : ''}`}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// PageHeader
// ---------------------------------------------------------------------------

interface PageHeaderProps {
  title: ReactNode
  subtitle?: ReactNode
  actions?: ReactNode
  /** Small line above the title (section / breadcrumb). */
  eyebrow?: ReactNode
}

export function PageHeader({ title, subtitle, actions, eyebrow }: PageHeaderProps) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        {eyebrow && (
          <div className="mb-1 text-[12px] font-semibold tracking-wider text-accent-500 uppercase">
            {eyebrow}
          </div>
        )}
        <h1 className="font-display text-[28px] leading-tight font-bold tracking-wide text-accent-600 uppercase">
          {title}
        </h1>
        {subtitle && <p className="mt-1 max-w-3xl text-sm text-slate-500">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  )
}

// ---------------------------------------------------------------------------
// EmptyState
// ---------------------------------------------------------------------------

interface EmptyStateProps {
  title: string
  hint?: string
  action?: ReactNode
  icon?: ReactNode
}

export function EmptyState({ title, hint, action, icon }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-slate-300 bg-white/70 px-6 py-14 text-center">
      <span className="mb-1 flex size-11 items-center justify-center rounded-full bg-accent-50 text-accent-500 [&_svg]:size-5">
        {icon ?? (
          <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <rect x="4" y="4" width="16" height="16" rx="2" stroke="currentColor" strokeWidth="1.6" />
            <path d="M8 9h8M8 13h5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
        )}
      </span>
      <p className="text-sm font-semibold text-slate-800">{title}</p>
      {hint && <p className="max-w-md text-[13px] leading-relaxed text-slate-500">{hint}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------------------

export interface TabDef {
  key: string
  label: string
  /** Optional counter rendered after the label. */
  count?: number
}

interface TabsProps {
  tabs: TabDef[]
  active: string
  onChange: (key: string) => void
  size?: 'md' | 'sm'
}

export function Tabs({ tabs, active, onChange, size = 'md' }: TabsProps) {
  const pad = size === 'sm' ? 'px-3 py-2 text-[13px]' : 'px-3.5 py-2.5 text-sm'
  return (
    <div className="scrollbar-thin flex gap-1 overflow-x-auto border-b border-slate-200" role="tablist">
      {tabs.map((tab) => {
        const selected = tab.key === active
        return (
          <button
            key={tab.key}
            type="button"
            role="tab"
            aria-selected={selected}
            onClick={() => onChange(tab.key)}
            className={`-mb-px flex shrink-0 items-center gap-1.5 border-b-2 font-medium whitespace-nowrap transition-colors ${pad} ${
              selected
                ? 'border-accent-500 text-accent-600'
                : 'border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-800'
            }`}
          >
            {tab.label}
            {tab.count !== undefined && (
              <span
                className={`rounded-full px-1.5 text-[11px] font-semibold ${
                  selected ? 'bg-accent-100 text-accent-700' : 'bg-slate-100 text-slate-500'
                }`}
              >
                {tab.count}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Modal
// ---------------------------------------------------------------------------

interface ModalProps {
  open: boolean
  title: string
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  wide?: boolean
}

export function Modal({ open, title, onClose, children, footer, wide = false }: ModalProps) {
  const titleId = useId()

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null
  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-accent-900/45 p-4 pt-[8vh] backdrop-blur-[2px]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={`animate-fade-in w-full ${wide ? 'max-w-2xl' : 'max-w-md'} overflow-hidden rounded-xl bg-white shadow-pop ring-1 ring-slate-900/5`}
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3.5">
          <h2
            id={titleId}
            className="font-display text-[17px] font-bold tracking-wide text-accent-600 uppercase"
          >
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        <div className="px-5 py-4">{children}</div>
        {footer && (
          <div className="flex justify-end gap-2 border-t border-slate-200 bg-slate-50/70 px-5 py-3">
            {footer}
          </div>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Table (dense financial variant)
// ---------------------------------------------------------------------------

interface TableProps {
  children: ReactNode
  dense?: boolean
  className?: string
}

/** Scrollable table container. `dense` is the financial variant: the navy
 * header band of the risk report, condensed caps, zebra rows. */
export function Table({ children, dense = false, className = '' }: TableProps) {
  const head = dense
    ? '[&_thead_th]:bg-accent-600 [&_thead_th]:text-white [&_thead_th]:font-display [&_thead_th]:text-[13px] [&_thead_th]:font-bold [&_thead_th]:tracking-wide [&_thead_th]:border-accent-600 [:where(&_tbody_tr:nth-child(even))]:bg-accent-50/60'
    : '[&_thead_th]:bg-slate-50 [&_thead_th]:text-slate-500 [&_thead_th]:text-[12px] [&_thead_th]:font-semibold [&_thead_th]:tracking-wide [&_thead_th]:uppercase [&_thead_th]:border-slate-200'
  return (
    <div
      className={`scrollbar-thin overflow-x-auto rounded-lg border border-slate-200/90 bg-white shadow-card ${className}`}
    >
      <table
        className={`w-full border-collapse ${dense ? 'text-[13px]' : 'text-sm'} [&_th]:border-b [&_th]:text-left [&_td]:border-b [&_td]:border-slate-100 [:where(&_tbody_tr)]:transition-colors [:where(&_tbody_tr:hover)]:bg-accent-50 [&_tbody_tr:last-child_td]:border-b-0 ${head} ${
          dense
            ? '[&_th]:px-3 [&_th]:py-2 [&_td]:px-3 [&_td]:py-1.5'
            : '[&_th]:px-4 [&_th]:py-2.5 [&_td]:px-4 [&_td]:py-2.5'
        }`}
      >
        {children}
      </table>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Spinner / loading row
// ---------------------------------------------------------------------------

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2.5 py-12 text-sm text-slate-500" role="status">
      <span className="size-4 animate-spin rounded-full border-2 border-accent-100 border-t-accent-500" />
      {label}
    </div>
  )
}

/** Shimmer placeholder for content that is loading. */
export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse rounded-md bg-slate-200/70 ${className}`} />
}
