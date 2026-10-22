/**
 * Fixed column widths for the contract tables (DESIGN.md «No layout shift»).
 *
 * The status column reserves the widest contract status in en / ru / uz —
 * «Ko‘rib chiqilmoqda» (18 characters) — with the same arithmetic as
 * components/ui/columns.ts labelCol() for a badge: 18 × 0.5 + 1.125 + 2 cell
 * padding = 12.125rem. It belongs in LABEL_SETS as
 * `contractStatus: { keys: ['contractDrafts.statuses.*'], chars: 18, kind: 'badge' }`
 * (that file is maintained elsewhere; columns.test.ts in this folder keeps
 * the number honest until it moves).
 *
 * The version actions are four 2rem icon buttons — view, edit, compare and
 * the «Скачать» menu (DOCX / PDF; its name is the tooltip and the accessible
 * label) — with 0.25rem gaps and 2rem cell padding: the whole versions table
 * fits 60rem, the content width at 1280px with the sidebar docked.
 */

export const CONTRACT_STATUS_CHARS = 18
export const CONTRACT_STATUS_COL = '12.125rem'
export const VERSION_ACTIONS_COL = '11rem'
