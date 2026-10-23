/**
 * The ONE grid every row of the Agenda list is laid out on — a task row, a
 * row of a collapsed row's sub-list (premium instalments), and the comment
 * composer under a row — so their titles start at the same x in every group
 * and cannot drift apart (DESIGN.md «No layout shift on interaction»):
 *
 *   [stripe] [chevron] [type tag] [title + context, flexible] [due] [owner]
 *
 * Every track but the title's is fixed. A row without a chevron still takes
 * its slot; a sub-row leaves the chevron and tag slots empty, so its text
 * starts where the parent titles start. The row actions (Решить / Отложить /
 * ⋯) and a sub-row's amount + «Открыть» sit at the END of the title track,
 * revealed by opacity only, so they never move the title.
 *
 * Widths, measured in the browser on the app's Inter (October 2026):
 *
 * - TAG: the widest label of `agenda.tags.*` in en / ru / uz is ru
 *   «Групповой лимит» — 119 px as an `sm` badge (12 px medium, px-2;
 *   DESIGN.md «Badges»), 135 px with the ⚡ of an automatic task (12 px
 *   icon + 4 px gap). Every tag is reserved WITH the icon, so no combination
 *   can overflow; 8.75rem = 140 px leaves 5 px for font rendering. A
 *   label that would still not fit is cut with an ellipsis and names itself
 *   in its tooltip (TypeTag) — the column is never widened by a row. `rowGrid.test.ts` keeps TAG_LABEL_CHARS
 *   honest against the three locale files.
 * - DUE: the widest due label is uz «365 kundan keyin» — 113 px (13 px
 *   semibold, tabular digits) → 7.25rem = 116 px. Right-aligned.
 * - OWNER: the 28 px avatar (size-7).
 */

/** The longest `agenda.tags.*` label in en / ru / uz, in characters
 * (ru «Групповой лимит»). The tag track below is measured for it. */
export const TAG_LABEL_CHARS = 15

/** The tag track: the widest label (TAG_LABEL_CHARS) with the ⚡ icon. */
export const TAG_TRACK = '8.75rem'

/** The due track: «365 kundan keyin», the widest due label. */
export const DUE_TRACK = '7.25rem'

/**
 * The grid itself. A literal class string (Tailwind generates what it finds
 * in the source), restating the two tracks above — `rowGrid.test.ts` checks
 * that it does. Gaps are gap-x-3; the right edge is pr-4, as before.
 */
export const ROW_GRID = 'grid grid-cols-[3px_1.5rem_8.75rem_minmax(0,1fr)_7.25rem_1.75rem] gap-x-3 pr-4'

/** The tracks by name, for placing a cell that spans more than one. */
export const TRACK = {
  stripe: 'col-start-1',
  chevron: 'col-start-2',
  tag: 'col-start-3',
  main: 'col-start-4',
  due: 'col-start-5',
  owner: 'col-start-6',
  /** From the tag track to the right edge: a composer under the row. */
  tagToEnd: 'col-start-3 col-end-[-1]',
} as const
