/**
 * Focus rings for keyboard users only.
 *
 * Every focus style in the app is `focus-visible:` — but Chrome turns
 * `:focus-visible` ON for an element that was focused by a MOUSE CLICK as
 * soon as any key is pressed while it keeps the focus. The Agenda's own
 * shortcuts (J/K/T) are exactly such keys: click «Разбор», press J, and the
 * segment you clicked lights up with a light-blue ring nobody asked for.
 *
 * So we remember how the focus last ARRIVED, on <html data-focus-source>:
 *
 * - `pointer` — the focus came with a mouse / touch / pen press, or was moved
 *   by a script right after one (a menu focusing its first item, a dialog its
 *   first field): Chrome's own rule for programmatic focus;
 * - `keyboard` — the focus moved after a key press (Tab, arrows, J/K moving
 *   a row's focus, Escape returning it) or with no interaction yet.
 *
 * A key pressed while the focus stays put changes nothing. index.css narrows
 * the `focus-visible` variant to `keyboard`, and switches the browser's own
 * outline off under `pointer`, so the ring shows exactly when the focus was
 * reached from the keyboard. Text fields are untouched: they keep their
 * `focus:` ring on every focus, which shows where typing goes.
 */

export type FocusSource = 'pointer' | 'keyboard'

export const FOCUS_SOURCE_ATTR = 'data-focus-source'

/** Installs the listeners once; returns a function that removes them. */
export function trackFocusSource(doc: Document = document): () => void {
  const root = doc.documentElement
  let lastInput: FocusSource = 'keyboard'
  const set = (source: FocusSource) => {
    if (root.getAttribute(FOCUS_SOURCE_ATTR) !== source) root.setAttribute(FOCUS_SOURCE_ATTR, source)
  }
  const onPointer = () => {
    lastInput = 'pointer'
    set('pointer')
  }
  const onKey = (e: KeyboardEvent) => {
    // A modifier on its own is not navigation.
    if (e.key === 'Shift' || e.key === 'Control' || e.key === 'Alt' || e.key === 'Meta') return
    lastInput = 'keyboard'
  }
  const onFocus = () => set(lastInput)

  set('keyboard')
  doc.addEventListener('pointerdown', onPointer, true)
  doc.addEventListener('keydown', onKey, true)
  doc.addEventListener('focusin', onFocus, true)
  return () => {
    doc.removeEventListener('pointerdown', onPointer, true)
    doc.removeEventListener('keydown', onKey, true)
    doc.removeEventListener('focusin', onFocus, true)
  }
}
