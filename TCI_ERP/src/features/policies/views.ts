/** The three views of the «Полисы» section and their ?view= values. */

export const POLICY_VIEWS = ['registry', 'contracts', 'templates'] as const
export type PolicyView = (typeof POLICY_VIEWS)[number]

/** Anything but a known view is the registry. */
export function parsePolicyView(value: string | null | undefined): PolicyView {
  return (POLICY_VIEWS as readonly string[]).includes(value ?? '') ? (value as PolicyView) : 'registry'
}

/** Where the old /contracts and /wording addresses now live. */
export const LEGACY_POLICY_VIEW_PATHS: Record<string, string> = {
  '/contracts': '/policies?view=contracts',
  '/wording': '/policies?view=templates',
}
