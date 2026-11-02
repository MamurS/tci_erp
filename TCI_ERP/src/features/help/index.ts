import { createElement } from 'react'

import { HelpPage } from './HelpPage'

export { HelpPage, TOUR_START_EVENT } from './HelpPage'
export { HelpButton, PageHelpLink } from './HelpButton'
export { useHelpHotkey } from './useHelpHotkey'

/** The portal's Help centre: client topics only (/portal/help). */
export function PortalHelpPage() {
  return createElement(HelpPage, { portal: true })
}
