/** The names of the empty-state pictograms (pictograms.tsx). */
export const PICTOGRAMS = [
  'companies',
  'documents',
  'limits',
  'claims',
  'allDone',
  'search',
  'chart',
  'inbox',
  'error',
] as const
export type PictogramName = (typeof PICTOGRAMS)[number]
