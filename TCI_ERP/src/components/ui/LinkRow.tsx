/**
 * A table row that opens its object (linkRow.ts has the rule). Use it for
 * every list whose rows ARE objects with a page of their own; the links in
 * its cells then point at THEIR objects (the company, the policy), never at
 * the row's. The row is focusable and opens with Enter, so the keyboard
 * reaches the row's object without a link of its own.
 */

import type { HTMLAttributes, KeyboardEvent, MouseEvent, ReactNode } from 'react'
import { useHref, useNavigate } from 'react-router-dom'

import { ROW_OWN_CLICK, rowClickAction } from './linkRow'

interface LinkRowProps extends Omit<HTMLAttributes<HTMLTableRowElement>, 'onClick' | 'onAuxClick' | 'onKeyDown'> {
  /** The row's object, as a router path. */
  to: string
  children: ReactNode
}

function ownClick(event: MouseEvent<HTMLTableRowElement>): boolean {
  const target = event.target as Element | null
  const own = target?.closest(ROW_OWN_CLICK)
  return own != null && event.currentTarget.contains(own)
}

export function LinkRow({ to, children, className = '', ...rest }: LinkRowProps) {
  const navigate = useNavigate()
  const href = useHref(to)

  const handle = (event: MouseEvent<HTMLTableRowElement>) => {
    const action = rowClickAction({
      ownClick: ownClick(event),
      selection: window.getSelection()?.toString() ?? '',
      button: event.button,
      ctrlKey: event.ctrlKey,
      metaKey: event.metaKey,
      shiftKey: event.shiftKey,
    })
    if (action === 'open') void navigate(to)
    else if (action === 'newTab') window.open(href, '_blank', 'noopener')
  }

  const onKeyDown = (event: KeyboardEvent<HTMLTableRowElement>) => {
    // Only the row itself: Enter on a link or a button inside does its own.
    if (event.key === 'Enter' && event.target === event.currentTarget) {
      event.preventDefault()
      void navigate(to)
    }
  }

  return (
    <tr
      {...rest}
      tabIndex={0}
      data-link-row={to}
      onClick={handle}
      onAuxClick={(e) => e.button === 1 && handle(e)}
      onKeyDown={onKeyDown}
      className={`cursor-pointer focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent-500 ${className}`}
    >
      {children}
    </tr>
  )
}
