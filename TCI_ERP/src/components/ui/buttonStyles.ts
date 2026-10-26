/** The look of a Button — also worn by LinkButton, a navigation styled as one. */

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'dangerOutline' | 'accent' | 'onBand'

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary:
    'bg-accent-600 text-white shadow-sm hover:bg-accent-700 active:bg-accent-800 disabled:bg-accent-600/45',
  secondary:
    'border border-slate-300 bg-white text-slate-700 shadow-sm hover:border-slate-400 hover:bg-slate-50 disabled:opacity-50',
  ghost: 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 disabled:opacity-50',
  danger: 'bg-neg-500 text-white shadow-sm hover:bg-neg-600 disabled:opacity-50',
  // A destructive action offered beside ordinary ones (decline, withdraw,
  // cancel a policy): marked as dangerous without shouting over the primary.
  dangerOutline:
    'border border-neg-500/35 bg-white text-neg-500 shadow-sm hover:border-neg-500/60 hover:bg-neg-50 disabled:opacity-50',
  // The orange brand accent: one prominent call to action per screen, at most.
  accent: 'bg-sky-600 text-white shadow-sm hover:bg-sky-700 disabled:opacity-50',
  // The primary action on the navy hero band (HeroBand): white with navy text.
  onBand: 'bg-white text-accent-800 shadow-sm hover:bg-accent-50 active:bg-accent-100 disabled:opacity-50',
}

export function buttonClassName(variant: ButtonVariant = 'primary', size: 'md' | 'sm' = 'md', className = ''): string {
  const sizing = size === 'sm' ? 'h-8 px-3 text-small' : 'h-9 px-4 text-body'
  return `inline-flex shrink-0 items-center justify-center gap-2 rounded-md font-medium whitespace-nowrap transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-500 disabled:cursor-not-allowed [&_svg]:size-4 ${sizing} ${BUTTON_VARIANTS[variant]} ${className}`
}
