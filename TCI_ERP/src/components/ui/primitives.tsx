/**
 * Core UI primitives per DESIGN.md. Screens compose these — no ad-hoc
 * one-off controls.
 *
 * Visual language (Delcreda corporate): navy #005288 for primary actions and
 * structure, process blue #0093D0 for focus, active states and the section
 * marker, condensed PT Sans Narrow for titles / labels / key figures, Inter
 * for running UI text. Crisp 6–10px radii, hairline borders, soft shadows.
 */
import { Suspense, createContext, useContext, useEffect, useId, useRef } from 'react'

import { BADGE_TONES, BadgeSizeContext, badgeClassName } from './badgeStyles'
import type { BadgeSize, BadgeTone } from './badgeStyles'
import { buttonClassName } from './buttonStyles'
import type { ButtonVariant } from './buttonStyles'
import { COL, tableMinWidth } from './columns'
import type { ColumnWidth } from './columns'
import type {
  ButtonHTMLAttributes,
  HTMLAttributes,
  InputHTMLAttributes,
  MouseEvent,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from 'react'

// ---------------------------------------------------------------------------
// Button (styles in buttonStyles.ts, shared with LinkButton)
// ---------------------------------------------------------------------------

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: 'md' | 'sm'
  /** Working: a spinner INSIDE the same box. The label keeps its place
   * (invisible), so the button is exactly as wide and tall as before and
   * nothing beside it moves; it is disabled while it works. */
  loading?: boolean
}

export function Button({ variant = 'primary', size = 'md', className = '', loading = false, children, disabled, ...rest }: ButtonProps) {
  return (
    <button
      type="button"
      className={buttonClassName(variant, size, `relative ${className}`)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? (
        <>
          <span className="invisible contents">{children}</span>
          <span aria-hidden className="absolute inset-0 flex items-center justify-center">
            <span className="size-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
          </span>
        </>
      ) : (
        children
      )}
    </button>
  )
}

// ---------------------------------------------------------------------------
// Form controls
// ---------------------------------------------------------------------------

const CONTROL_CLASSES =
  'w-full rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-900 shadow-[inset_0_1px_1px_rgb(0_0_0/0.03)] transition-colors placeholder:text-slate-400 hover:border-slate-400 focus:border-accent-500 focus:outline-none focus:ring-3 focus:ring-accent-500/20 disabled:bg-slate-50 disabled:text-slate-400'

interface FieldProps {
  label?: string
  /** Helper text under the control (text, or text with a link). */
  hint?: ReactNode
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

/** A Card takes any div attribute besides its look — a `data-*` hook, an
 * aria label — and passes it on. */
interface CardProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children' | 'className'> {
  children: ReactNode
  className?: string
}

/** Inside a card: an empty state needs no frame of its own (no box in a box). */
const FramedContext = createContext(false)

export function Card({ children, className = '', ...rest }: CardProps) {
  return (
    <FramedContext.Provider value={true}>
      <div {...rest} className={`rounded-lg border border-slate-200/90 bg-white shadow-card ${className}`}>
        {children}
      </div>
    </FramedContext.Provider>
  )
}

// ---------------------------------------------------------------------------
// Section title — the brand marker: a process-blue square + condensed caps
// ---------------------------------------------------------------------------

interface SectionTitleProps {
  children: ReactNode
  /** Right-aligned controls on the same line. */
  actions?: ReactNode
  /** One line of explanation under the title. */
  hint?: ReactNode
  /** A blue hairline under the title, as in the printed report. */
  rule?: boolean
  className?: string
}

export function SectionTitle({ children, actions, hint, rule = false, className = '' }: SectionTitleProps) {
  if (hint)
    return (
      <div className={className}>
        <SectionTitle actions={actions} rule={rule}>
          {children}
        </SectionTitle>
        <p className="mt-1 text-[12px] leading-relaxed text-slate-500">{hint}</p>
      </div>
    )
  return (
    // One height for every section title, with or without a button beside
    // it (a small button is 32px), so neighbouring titles line up and a
    // button never hangs over the content below.
    <div
      className={`flex min-h-8 flex-wrap items-center justify-between gap-x-3 gap-y-2 ${
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
// PanelGrid / Panel — cards side by side whose contents start on one line
// ---------------------------------------------------------------------------

interface PanelGridProps {
  /** Column template; one column below the breakpoint. */
  cols?: string
  /** The gap between the cards (gap-5 by default). */
  gap?: string
  className?: string
  children: ReactNode
}

/**
 * A row of cards side by side (DESIGN.md «Side-by-side cards») — the ONE
 * way to put cards next to each other:
 *
 * - every card in a line is as tall as the tallest (the grid stretches its
 *   children): content stays top-aligned and the spare space stays at the
 *   bottom of the shorter card;
 * - a Panel is a two-row SUBGRID of this grid (head, body): the heads share
 *   a height, so the bodies start on one line, and the bodies share the
 *   rest; a Panel's `footer` is pinned to the bottom of its body, so the
 *   action bars of a row sit on one line at the bottom of the cards;
 * - any other child (a Card, or a component whose root is one) spans the
 *   same two rows and simply stretches; a growable element inside a Panel
 *   body (a list, a preview, a textarea) can take the spare height with
 *   `h-full`;
 * - `data-card-row` lets the layout guard check that the bottoms agree
 *   (e2e/layout/cardRows.spec.ts).
 */
export function PanelGrid({ cols = 'lg:grid-cols-2', gap = 'gap-5', className = '', children }: PanelGridProps) {
  return (
    <div data-card-row className={`grid *:row-span-2 ${gap} ${cols} ${className}`}>
      {children}
    </div>
  )
}

interface PanelProps {
  title: ReactNode
  hint?: ReactNode
  actions?: ReactNode
  /** An action bar pinned to the bottom of the card; inside a PanelGrid the
   * footers of a row line up on one baseline. */
  footer?: ReactNode
  className?: string
  children: ReactNode
}

/** A titled card. Inside a PanelGrid its body lines up with its neighbours'
 * and its footer with theirs, at the bottom of a card as tall as the row. */
export function Panel({ title, hint, actions, footer, className = '', children }: PanelProps) {
  return (
    <Card className={`row-span-2 grid min-w-0 grid-rows-subgrid gap-y-0 p-5 ${className}`}>
      <SectionTitle actions={actions} hint={hint} className="mb-3 min-w-0 self-start">
        {title}
      </SectionTitle>
      {/* The body takes the row's height; the footer sits at its bottom. */}
      <div className="flex min-w-0 flex-col">
        <div className="min-w-0 flex-1">{children}</div>
        {footer && <div className="min-w-0 pt-4">{footer}</div>}
      </div>
    </Card>
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

interface BadgeProps {
  tone?: BadgeTone
  /** `sm` (tables, rows) or `md` (beside a page title); by default the size
   * of the slot it sits in (BadgeSizeContext), `sm` anywhere else. */
  size?: BadgeSize
  title?: string
  children: ReactNode
}

/** A badge (DESIGN.md «Badges», badgeStyles.ts). */
export function Badge({ tone = 'neutral', size, title, children }: BadgeProps) {
  const slot = useContext(BadgeSizeContext)
  const resolved = size ?? slot
  // Never wider than its cell: a label longer than the column reserved for it
  // is cut with an ellipsis (a fixed Table names it in full on hover) instead
  // of widening the column or wrapping the row.
  const text = typeof children === 'string' ? children : undefined
  return (
    <span data-badge={resolved} title={title} className={badgeClassName(resolved, BADGE_TONES[tone])}>
      {text !== undefined ? <span className="min-w-0 truncate">{text}</span> : children}
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
  /** "solid": the selected option is filled navy at button height — a view
   * switch in a page header (List | Triage). */
  tone?: 'default' | 'solid'
}

/** Small mutually-exclusive switch (report type, display currency, language). */
export function Segmented({ value, options, onChange, ariaLabel, tone = 'default' }: SegmentedProps) {
  if (tone === 'solid') {
    return (
      <div className="inline-flex h-9 rounded-md border border-slate-200 bg-white p-0.5" role="group" aria-label={ariaLabel}>
        {options.map((option) => (
          <button
            key={option.key}
            type="button"
            disabled={option.disabled}
            aria-pressed={option.key === value}
            onClick={() => onChange(option.key)}
            className={`rounded-[5px] px-3.5 text-[13px] font-semibold transition-colors focus-visible:ring-2 focus-visible:ring-accent-400 focus-visible:outline-none ${
              option.key === value ? 'bg-accent-600 text-white' : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
            } ${option.disabled ? 'cursor-not-allowed opacity-50' : ''}`}
          >
            {option.label}
          </button>
        ))}
      </div>
    )
  }
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
          className={`rounded-[5px] px-2.5 py-1 text-xs font-semibold transition-colors focus-visible:ring-2 focus-visible:ring-accent-400 focus-visible:outline-none ${
            option.key === value
              ? 'bg-white text-accent-600 shadow-sm ring-1 ring-slate-200'
              : 'text-slate-600 hover:text-slate-900'
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
  /** Badges beside the title (a status, a grade, roles): `md`, centred on
   * the title, in the body font — never inside the heading itself. */
  status?: ReactNode
  subtitle?: ReactNode
  actions?: ReactNode
  /** Small line above the title (section / breadcrumb). */
  eyebrow?: ReactNode
}

export function PageHeader({ title, status, subtitle, actions, eyebrow }: PageHeaderProps) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        {eyebrow && (
          <div className="mb-1 text-[12px] font-semibold tracking-wider text-accent-500 uppercase">
            {eyebrow}
          </div>
        )}
        <div data-badge-row className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <h1 className="font-display text-[28px] leading-tight font-bold tracking-wide text-accent-600 uppercase">
            {title}
          </h1>
          {status && (
            <BadgeSizeContext.Provider value="md">
              <span className="inline-flex flex-wrap items-center gap-2">{status}</span>
            </BadgeSizeContext.Provider>
          )}
        </div>
        {subtitle && <p className="mt-1 max-w-3xl text-sm text-slate-500">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  )
}

// ---------------------------------------------------------------------------
// SectionPage / ViewBar
// ---------------------------------------------------------------------------

interface SectionPageProps {
  title: ReactNode
  subtitle?: ReactNode
  tabs: TabDef[]
  active: string
  onChange: (key: string) => void
  children: ReactNode
}

/**
 * A section with views (?view=): ONE header and ONE strip of tabs that never
 * move when the view changes — same width, same title, same subtitle. What a
 * view needs to say or offer goes in its ViewBar below the tabs. It takes the
 * shell's full content width like every other page, so the title does not
 * jump sideways when the person moves between sections.
 */
export function SectionPage({ title, subtitle, tabs, active, onChange, children }: SectionPageProps) {
  return (
    <div>
      <PageHeader title={title} subtitle={subtitle} />
      <div className="mb-5">
        <Tabs tabs={tabs} active={active} onChange={onChange} />
      </div>
      {/* Views load lazily; the header and the tabs must not blink while one does. */}
      <Suspense
        fallback={
          <div className="flex min-h-64 items-center justify-center">
            <Spinner />
          </div>
        }
      >
        {children}
      </Suspense>
    </div>
  )
}

interface ViewBarProps {
  /** One line on what this view is for. */
  hint?: ReactNode
  /** The view's own controls: filters, switches, its primary action. */
  actions?: ReactNode
}

/** The row under a section's tabs: the view's hint on the left, its actions
 * on the right, one fixed minimum height so the content below starts at the
 * same place in every view that has one. */
export function ViewBar({ hint, actions }: ViewBarProps) {
  if (!hint && !actions) return null
  return (
    <div className="mb-5 flex min-h-9 flex-wrap items-center justify-between gap-x-6 gap-y-3">
      {hint ? <p className="max-w-3xl min-w-0 flex-1 text-[13px] leading-relaxed text-slate-500">{hint}</p> : <span />}
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
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
  // On the page it is its own dashed box; inside a card or a panel the card
  // already frames it, so it is only the message.
  const framed = useContext(FramedContext)
  return (
    <div
      className={`flex flex-col items-center justify-center gap-2 text-center ${
        framed ? 'px-4 py-8' : 'rounded-lg border border-dashed border-slate-300 bg-white/70 px-6 py-14'
      }`}
    >
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

/**
 * A number in a pill — a tab's count, a sidebar badge, a filter chip's count.
 * Tabular digits, centred in a box at least `digits` wide, so a count going
 * from 9 to 10 (or a refetch) never pushes the label or the pill beside it.
 * The tone (background and text colour) is the caller's.
 */
export function Count({
  value,
  digits = 2,
  className = '',
  title,
}: {
  value: ReactNode
  digits?: number
  className?: string
  title?: string
}) {
  // The counter form of the `sm` badge (DESIGN.md «Badges»): its height,
  // font, text size and weight, with the narrower counter padding (px-1.5)
  // and a minimum width of `digits` numerals; only the tone (the caller's)
  // varies.
  return (
    <span
      data-badge="sm"
      title={title}
      style={{ minWidth: `calc(${digits}ch + 0.75rem)` }}
      className={`inline-flex h-5 shrink-0 items-center justify-center rounded-full px-1.5 font-sans text-xs leading-4 font-medium tabular-nums normal-case ${className}`}
    >
      {value}
    </span>
  )
}

export interface TabDef {
  key: string
  label: string
  /** Counter after the label. `null` keeps its place while it has nothing
   * to show (loading, or zero), so the tabs beside it never move when it
   * appears; leave it out on a tab that never counts. */
  count?: number | null
}

interface TabsProps {
  tabs: TabDef[]
  active: string
  onChange: (key: string) => void
  size?: 'md' | 'sm'
}

export function Tabs({ tabs, active, onChange, size = 'md' }: TabsProps) {
  // A section with many views tightens its tabs so the strip still fits a
  // laptop (1280 px) in every language instead of scrolling; credit limits,
  // with eight views since 0061, tightens once more.
  const dense = tabs.length > 5
  const crowded = tabs.length > 7
  const pad =
    size === 'sm'
      ? 'px-3 py-2 text-[13px]'
      : crowded
        ? 'px-1.5 py-2.5 text-[13px] leading-5'
        : dense
          ? 'px-2 py-2.5 text-sm'
          : 'px-3.5 py-2.5 text-sm'
  // The rule under the tabs is an inset shadow, not a border: the selected
  // tab's underline then sits ON it without a negative margin, so the strip
  // never overflows vertically (which showed a stray scrollbar on Windows).
  return (
    <div
      className={`scrollbar-thin flex ${dense ? 'gap-0.5' : 'gap-1'} overflow-x-auto overflow-y-hidden shadow-[inset_0_-1px_0_var(--color-slate-200)]`}
      role="tablist"
    >
      {tabs.map((tab) => {
        const selected = tab.key === active
        return (
          <button
            key={tab.key}
            type="button"
            role="tab"
            aria-selected={selected}
            onClick={() => onChange(tab.key)}
            className={`flex shrink-0 items-center gap-1.5 border-b-2 font-medium whitespace-nowrap transition-colors ${pad} ${
              selected
                ? 'border-accent-500 text-accent-600'
                : 'border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-800'
            }`}
          >
            {tab.label}
            {tab.count !== undefined && (
              <Count
                value={tab.count ?? ''}
                className={`${tab.count === null ? 'invisible' : ''} ${
                  selected ? 'bg-accent-100 text-accent-700' : 'bg-slate-100 text-slate-500'
                }`}
              />
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

/** Open modals, innermost last: Escape closes only the one on top. */
const openModals: string[] = []

export function Modal({ open, title, onClose, children, footer, wide = false }: ModalProps) {
  const titleId = useId()
  const closeRef = useRef(onClose)
  useEffect(() => {
    closeRef.current = onClose
  }, [onClose])

  useEffect(() => {
    if (!open) return
    openModals.push(titleId)
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && openModals[openModals.length - 1] === titleId) closeRef.current()
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      const at = openModals.lastIndexOf(titleId)
      if (at >= 0) openModals.splice(at, 1)
    }
  }, [open, titleId])

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
        {/* Fields placed directly in a dialog are spaced evenly, never touching. */}
        <div className="flex flex-col gap-4 px-5 py-4">{children}</div>
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
  /**
   * One width per column (columns.ts: `COL.*`, `labelCol`, `actionsCol`, or
   * any CSS width). The table is then laid out FIXED: a column is exactly
   * that wide whatever its cells hold, so nothing moves when a status, a
   * button or a translation changes. Cells keep to one line and cut with an
   * ellipsis; a cut cell shows its full text on hover.
   */
  columns?: readonly ColumnWidth[]
  /** The narrowest a fill column may get before the table scrolls sideways (6rem). */
  fillMin?: string
}

/** A cut cell (or a `truncate` element in it) names its full text on hover. */
function titleIfCut(event: MouseEvent<HTMLTableElement>) {
  const target = event.target as HTMLElement
  const el = target.closest<HTMLElement>('.truncate') ?? target.closest<HTMLElement>('td, th')
  if (!el || !event.currentTarget.contains(el)) return
  const cut = el.scrollWidth > el.clientWidth + 1
  if (cut && !el.hasAttribute('title')) {
    el.setAttribute('title', el.innerText.trim())
    el.dataset.autoTitle = '1'
  } else if (!cut && el.dataset.autoTitle) {
    el.removeAttribute('title')
    delete el.dataset.autoTitle
  }
}

/** Scrollable table container. `dense` is the financial variant: the navy
 * header band of the risk report, condensed caps, zebra rows. */
export function Table({ children, dense = false, className = '', columns, fillMin }: TableProps) {
  // On the page a table is its own card; inside a card it sits flush, its
  // rows on the card's own surface — never a box in a box.
  const framed = useContext(FramedContext)
  const fixed = columns !== undefined
  // Fixed layout: one line per cell, cut with an ellipsis (`:where` keeps it
  // overridable by a cell's own class, e.g. `whitespace-normal`).
  // Fixed layout: one line per body cell, cut with an ellipsis (`:where`
  // keeps it overridable by a cell's own class, e.g. `whitespace-normal`). A
  // header may wrap between words — it is never cut — and sits on the bottom
  // line, so a one-line header lines up with a two-line one beside it.
  const fixedCells = fixed
    ? 'table-fixed [:where(&_td,&_th)]:overflow-hidden [:where(&_td,&_th)]:text-ellipsis [:where(&_td)]:whitespace-nowrap [&_th]:whitespace-normal [&_th]:align-bottom [&_th]:[text-wrap:balance]'
    : '[&_th]:whitespace-nowrap'
  const head = dense
    ? '[&_thead_th]:bg-accent-600 [&_thead_th]:text-white [&_thead_th]:font-display [&_thead_th]:text-[13px] [&_thead_th]:font-bold [&_thead_th]:tracking-wide [&_thead_th]:border-accent-600 [:where(&_tbody_tr:nth-child(even))]:bg-accent-50/60'
    : '[&_thead_th]:bg-slate-50 [&_thead_th]:text-slate-500 [&_thead_th]:text-[12px] [&_thead_th]:font-semibold [&_thead_th]:tracking-wide [&_thead_th]:uppercase [&_thead_th]:border-slate-200'
  return (
    <div
      className={`scrollbar-thin overflow-x-auto ${
        framed ? 'rounded-md' : 'rounded-lg border border-slate-200/90 bg-white shadow-card'
      } ${className}`}
    >
      <table
        style={fixed ? { minWidth: tableMinWidth(columns, fillMin) } : undefined}
        onMouseOver={fixed ? titleIfCut : undefined}
        className={`w-full border-collapse ${fixedCells} ${dense ? 'text-[13px]' : 'text-sm'} [&_th]:border-b [&_td.num]:whitespace-nowrap [:where(&_th)]:text-left [&_td]:border-b [&_td]:border-slate-100 [:where(&_tbody_tr)]:transition-colors [:where(&_tbody_tr:hover)]:bg-accent-50 [&_tbody_tr:last-child_td]:border-b-0 ${head} ${
          dense
            ? '[&_th]:px-3 [&_th]:py-2 [&_td]:px-3 [&_td]:py-1.5'
            : '[&_th]:px-4 [&_th]:py-2.5 [&_td]:px-4 [&_td]:py-2.5'
        }`}
      >
        {fixed && (
          <colgroup>
            {columns.map((width, i) => (
              <col key={i} style={width === COL.fill ? undefined : { width }} />
            ))}
          </colgroup>
        )}
        {children}
      </table>
    </div>
  )
}

/**
 * The action cell of a table row: its buttons right-aligned in the column
 * reserved for them (`actionsCol`). It does not clip, so a focus ring or an
 * open menu is never cut. `reveal`: the buttons fade in while the row is
 * hovered or focused — by OPACITY, never display, so their space is always
 * taken and nothing in the row moves; they stay reachable by keyboard.
 */
export function RowActions({ children, reveal = false }: { children: ReactNode; reveal?: boolean }) {
  return (
    <td className="!overflow-visible">
      <div
        className={`flex items-center justify-end gap-2 ${
          reveal
            ? 'opacity-0 transition-opacity focus-within:opacity-100 [tr:focus-within>td>&]:opacity-100 [tr:hover>td>&]:opacity-100'
            : ''
        }`}
        // A click on an action must not also open the row.
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </td>
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
