/** The compiled user guide (scripts/guide/content.ts writes it into ./content/). */
export type HelpLang = 'ru' | 'en' | 'uz'

export interface HelpHeading {
  id: string
  text: string
  level: number
}

export interface HelpTopic {
  id: string
  /** Section id (the section's 00-index.md). */
  section: string
  title: string
  /** Department roles (src/lib/roles.ts) or `all` = every staff role. */
  roles: string[]
  /** App routes (src/App.tsx patterns) this topic helps with. */
  pages: string[]
  order: number
  index?: boolean
  /** HTML compiled from the repository's Markdown (escaped; HtmlView renders it as React). */
  html: string
  headings: HelpHeading[]
  text: string
}

export interface HelpSection {
  id: string
  folder: string
  title: string
  roles: string[]
  topics: string[]
}

export interface HelpBundle {
  lang: HelpLang
  version: string
  sections: HelpSection[]
  topics: Record<string, HelpTopic>
  terms: Record<string, { text: string; topic: string; anchor: string | null }>
}

/** App route pattern → topics for it, best first. */
export type HelpPageMap = Record<string, { id: string; roles: string[] }[]>
