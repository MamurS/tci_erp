/**
 * What a click on a list row does (owner, 2026-10-27): anywhere on the row
 * opens the row's own object — the limit, the policy, the claim — while a
 * link, a button, a checkbox or a menu inside it does its own thing (the
 * buyer's name opens the company, the policy number the policy). A click
 * that ends a text selection selects; Ctrl / ⌘ / Shift or the middle button
 * opens a new tab, as a link would.
 */

/** What inside a row keeps its own click. `[data-row-ignore]` marks
 * anything else that must (a cell holding an inline editor). */
export const ROW_OWN_CLICK =
  'a, button, input, select, textarea, label, summary, [role="button"], [role="checkbox"], [role="menuitem"], [role="switch"], [role="tab"], [contenteditable="true"], [data-row-ignore]'

export type RowClickAction = 'ignore' | 'open' | 'newTab'

export interface RowClick {
  /** The click landed on (or inside) something matching ROW_OWN_CLICK. */
  ownClick: boolean
  /** The text the person has selected when the click ends. */
  selection: string
  button: number
  ctrlKey: boolean
  metaKey: boolean
  shiftKey: boolean
}

export function rowClickAction(click: RowClick): RowClickAction {
  if (click.ownClick) return 'ignore'
  if (click.selection.trim() !== '') return 'ignore'
  if (click.button === 1 || click.ctrlKey || click.metaKey || click.shiftKey) return 'newTab'
  if (click.button !== 0) return 'ignore'
  return 'open'
}
