import { createContext } from 'react'
import type { ComponentType } from 'react'

/**
 * The small «?» beside a page title (the user guide's topic for the page).
 * The shells provide it (src/features/help/HelpButton.tsx PageHelpLink);
 * PageHeader and HeroBand only render whatever is provided, so the UI
 * primitives never import a feature. Null: nothing beside the title.
 */
export const PageHelpContext = createContext<ComponentType<{ inverse?: boolean }> | null>(null)
