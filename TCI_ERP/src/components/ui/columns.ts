/**
 * Column widths for fixed-layout tables (DESIGN.md «No layout shift on
 * interaction»).
 *
 * A `<Table columns={…}>` is laid out with `table-layout: fixed`: every column
 * is exactly as wide as declared here, whatever its cells hold, so a status
 * that changes, a button that starts loading or a longer translation never
 * moves a neighbour. The one `COL.fill` column takes the width that is left.
 *
 * Status and action columns reserve the width of their WIDEST label in en,
 * ru and uz: `labelCol('policyStatus')`. The character counts in LABEL_SETS
 * are checked against the three locale files by `columns.test.ts`, which
 * prints the right number when a translation outgrows its reservation.
 */

/** A CSS width (`'8rem'`, `'calc(…)'`), or `'fill'` for the column that
 * takes the width left over (and cuts its text with an ellipsis). */
export type ColumnWidth = string

export const COL = {
  /** The main text column: takes the width left over, cuts with a tooltip. */
  fill: 'fill',
  /** 05 окт. 2026 / 05-okt 2026 / 05 Oct 2026 */
  date: '7.75rem',
  /** A date and a time: 05 окт. 2026, 17:02 */
  moment: '10.5rem',
  /** 05 окт. 2026 — 05 окт. 2027 */
  period: '15rem',
  /** An amount without its currency, up to 999,999,999,999.99 */
  amount: '9.5rem',
  /** An amount followed by its currency code: 1,250,000.00 UZS */
  money: '11.5rem',
  /** A short amount (a limit in whole units) with its currency: 1,250,000 USD */
  moneyShort: '9.5rem',
  /** A document number: TCI-2026-0007, CL-2026-0042, IR-2026-0001 */
  code: '9.25rem',
  /** A registration number (ИНН / OGRN / company number): up to 15 characters */
  regNumber: '10.5rem',
  /** A small count (its header is a word or two, which may wrap) */
  count: '6rem',
  /** A percentage: 85.0% */
  pct: '5.5rem',
  /** A currency code on its own */
  currency: '4.5rem',
  /** A grade badge (A1 … D) */
  grade: '5rem',
  /** A flag and an ISO country code */
  country: '5.5rem',
  /** One icon button (⋯, remove) */
  icon: '3.5rem',
  /** A number of days with its unit: 125 дней / 125 kun */
  days: '6.5rem',
  /** A person's name (requested by, assigned to) */
  person: '10rem',
  /** requested → approved, with the currency: 1,250,000 → 1,000,000 USD ⚑ 2 */
  pair: '15rem',
  /** Valid until: a date, «until review», or «revoked: <date>» */
  review: '12rem',
  /** A share as a bar and a percentage (portfolio ShareBar) */
  share: '8.5rem',
} as const

// ---------------------------------------------------------------------------
// Label reservations
// ---------------------------------------------------------------------------

export type LabelKind = 'badge' | 'button' | 'text'

export interface LabelSet {
  /** i18n keys; `prefix.*` stands for every string directly under `prefix`. */
  readonly keys: readonly string[]
  /** The longest of those labels in en, ru and uz, in characters. */
  readonly chars: number
  /** How a label is drawn: a status Badge, a small Button, or plain text. */
  readonly kind: LabelKind
}

/**
 * Measured on Inter (October 2026): a mixed-case label of ten characters or
 * more is at most 0.48rem per character in a 12px Badge, 0.53rem in a 13px
 * small Button and 0.56rem in 14px body text, whatever the script. Shorter
 * labels count as eight characters, so an all-caps two-letter code still fits.
 */
const PER_CHAR: Record<LabelKind, number> = { badge: 0.48, button: 0.53, text: 0.56 }
/** The label's own padding: Badge px-2 + ring; Button px-2.5 + border. */
const OWN_PAD: Record<LabelKind, number> = { badge: 1.125, button: 1.375, text: 0 }
/** A table cell's horizontal padding (px-4 on both sides; dense is px-3). */
const CELL_PAD = 2
/** Between two buttons in one action cell (gap-2). */
const GAP = 0.5
const MIN_CHARS = 8

/** The vocabularies drawn in status and action columns. Add one here before
 * using a new vocabulary in a column; the test then keeps it honest. */
export const LABEL_SETS = {
  policyStatus: { keys: ['policies.statuses.*'], chars: 21, kind: 'badge' },
  limitOutcome: { keys: ['limits.outcomes.*'], chars: 19, kind: 'badge' },
  /** A request's status — or «На валидации» while a step is pending (0060). */
  limitStatus: { keys: ['limits.statuses.*', 'limits.validation.badge'], chars: 20, kind: 'badge' },
  limitBand: { keys: ['limits.bands.*'], chars: 12, kind: 'badge' },
  /** A step of a limit-decision validation chain (0060). */
  validationStatus: { keys: ['limits.validation.statuses.*'], chars: 24, kind: 'badge' },
  requestStatus: { keys: ['requests.statuses.*'], chars: 25, kind: 'badge' },
  claimStatus: { keys: ['claims.statuses.*'], chars: 21, kind: 'badge' },
  claimVerdict: { keys: ['claims.verdicts.*'], chars: 16, kind: 'badge' },
  overdueStatus: { keys: ['overdues.statuses.*'], chars: 30, kind: 'badge' },
  declarationStatus: { keys: ['declarations.statuses.*'], chars: 14, kind: 'badge' },
  dataStatus: { keys: ['data.statuses.*'], chars: 32, kind: 'badge' },
  wordingStatus: { keys: ['wording.statuses.*'], chars: 9, kind: 'badge' },
  instalmentStatus: { keys: ['premium.instalmentStatuses.*'], chars: 22, kind: 'badge' },
  bankLineStatus: { keys: ['premium.bank.statuses.*'], chars: 18, kind: 'badge' },
  /** The primary button of an instalment row (invoice, or record a payment). */
  premiumAction: { keys: ['premium.actions.invoice', 'premium.actions.recordPayment'], chars: 20, kind: 'button' },
  // commercial offers (0058)
  offerStatus: { keys: ['offers.statuses.*'], chars: 22, kind: 'badge' },
  offerVersionState: { keys: ['offers.versionStates.*', 'offers.statuses.*'], chars: 22, kind: 'badge' },
  premiumSource: { keys: ['premium.sources.*'], chars: 18, kind: 'text' },
  portalRequestStatus: { keys: ['portal.limits.requestStatuses.*'], chars: 23, kind: 'badge' },
  portalSubmissionStatus: { keys: ['portal.submissions.statuses.*'], chars: 28, kind: 'badge' },
  ratingReason: { keys: ['limits.workbench.ratings.reasons.*'], chars: 21, kind: 'badge' },
  groupState: { keys: ['limits.workbench.groups.states.*'], chars: 21, kind: 'badge' },
  freshnessReason: { keys: ['data.freshness.reasons.*'], chars: 31, kind: 'badge' },
  authorityScope: { keys: ['admin.scopes.*'], chars: 12, kind: 'badge' },
  /** A client's limit: in force, or how it ended. */
  limitLifecycle: { keys: ['limits.lifecycles.*', 'limits.outcomes.*'], chars: 19, kind: 'badge' },
  coverageBasis: { keys: ['declarations.coverageBasis.*'], chars: 24, kind: 'badge' },
  /** A buyer of a submission: its decision, else its open request, else its identification. */
  packageState: {
    keys: ['limits.outcomes.*', 'limits.statuses.*', 'requests.resolutions.*'],
    chars: 20,
    kind: 'badge',
  },
  accountState: {
    keys: ['provisioning.disabled', 'provisioning.awaitingPasswordChange', 'provisioning.active'],
    chars: 18,
    kind: 'badge',
  },
  mfaState: { keys: ['account.mfa.on', 'account.mfa.off'], chars: 11, kind: 'badge' },
  overdueReported: { keys: ['overdues.lateBy', 'overdues.onTime'], chars: 18, kind: 'badge' },
  portalCover: { keys: ['portal.overdues.suspended', 'portal.overdues.noLimitAffected'], chars: 23, kind: 'badge' },
  securityEvent: { keys: ['admin.security.eventTypes.*'], chars: 28, kind: 'badge' },
  releaseState: {
    keys: ['limits.release.withClient', 'limits.release.windowShort', 'limits.release.held'],
    chars: 15,
    kind: 'badge',
  },
  monitoringSuspension: {
    keys: ['limits.workbench.monitoring.suspended', 'limits.workbench.monitoring.notSuspended'],
    chars: 16,
    kind: 'badge',
  },
  entityRole: { keys: ['entities.roles.*'], chars: 16, kind: 'badge' },
  requestRole: { keys: ['requests.roleApplicant', 'requests.roleBuyer'], chars: 9, kind: 'badge' },

  // Plain-text vocabularies drawn in their own column.
  policyStructure: { keys: ['policies.structures.*'], chars: 15, kind: 'text' },
  dataKind: { keys: ['data.kinds.*'], chars: 17, kind: 'text' },
  ratingBand: { keys: ['rating.bands.*'], chars: 19, kind: 'text' },

  // Buttons in action columns (one set per button, or per group of buttons
  // that take turns in the same place).
  resetPassword: { keys: ['provisioning.resetPassword'], chars: 15, kind: 'button' },
  unlock: { keys: ['admin.security.lockouts.unlock'], chars: 17, kind: 'button' },
  revokeSessions: { keys: ['admin.security.sessions.revoke'], chars: 27, kind: 'button' },
  editRoles: { keys: ['admin.editRoles'], chars: 6, kind: 'button' },
  disableEnable: { keys: ['provisioning.disable', 'provisioning.enable'], chars: 16, kind: 'button' },
  resolveProposal: { keys: ['limits.proposals.resolve'], chars: 10, kind: 'button' },
  fileClaim: { keys: ['portal.claims.actions.file'], chars: 17, kind: 'button' },
  /** A draft is submitted, a claim with questions answered — never both. */
  claimNextStep: { keys: ['portal.claims.actions.submit', 'portal.claims.actions.respond'], chars: 12, kind: 'button' },
  edit: { keys: ['common.edit'], chars: 10, kind: 'button' },
  delete: { keys: ['common.delete'], chars: 9, kind: 'button' },
  download: { keys: ['wording.templates.download'], chars: 12, kind: 'button' },
  openDataRequest: { keys: ['data.freshness.openRequest'], chars: 15, kind: 'text' },
  /** An authority grant row: edit / grant, and save while editing. */
  grantPrimary: { keys: ['common.edit', 'admin.grant', 'common.save'], chars: 10, kind: 'button' },
  grantSecondary: { keys: ['common.delete', 'common.cancel'], chars: 9, kind: 'button' },
  limitHistory: { keys: ['portal.limits.history'], chars: 7, kind: 'button' },
  /** Why a bank-statement line matched, or did not (premium payments). */
  bankMatchReason: { keys: ['premium.bank.reasons.*'], chars: 20, kind: 'text' },
  /** A version of the TCI brochure (0058) and its one labelled row action. */
  brochureStatus: { keys: ['brochure.statuses.*'], chars: 14, kind: 'badge' },
  brochurePublish: { keys: ['brochure.actions.publish'], chars: 12, kind: 'button' },
  /** A bank-statement line: confirm a match, or assign an unmatched one. */
  bankLineAction: { keys: ['premium.bank.actions.confirm', 'premium.bank.actions.assign'], chars: 11, kind: 'button' },
} as const satisfies Record<string, LabelSet>

export type LabelSetName = keyof typeof LABEL_SETS

function rem(n: number): string {
  return `${Math.ceil(n * 8) / 8}rem`
}

function labelWidth(set: LabelSet): number {
  return Math.max(set.chars, MIN_CHARS) * PER_CHAR[set.kind] + OWN_PAD[set.kind]
}

/** A status or label column as wide as its longest label in en / ru / uz. */
export function labelCol(name: LabelSetName): ColumnWidth {
  return rem(labelWidth(LABEL_SETS[name]) + CELL_PAD)
}

/** An action column holding these labelled buttons side by side, plus any
 * icon buttons (⋯) after them, each sized for its widest translation. */
export function actionsCol(names: readonly LabelSetName[], icons = 0): ColumnWidth {
  const parts = names.map((n) => labelWidth(LABEL_SETS[n]))
  const items = parts.length + icons
  const width = parts.reduce((a, b) => a + b, 0) + icons * 2 + Math.max(items - 1, 0) * GAP
  return rem(width + CELL_PAD)
}

/** Several labels side by side in one cell (two role badges, say): the same
 * arithmetic as `actionsCol`, for badges or text. */
export const labelsCol = actionsCol

/** The width below which the table scrolls sideways instead of crushing a
 * column: every fixed width plus `fillMin` for each fill column. */
export function tableMinWidth(columns: readonly ColumnWidth[], fillMin = '6rem'): string {
  const parts = columns.map((c) => (c === COL.fill ? fillMin : c))
  return parts.length ? `calc(${parts.join(' + ')})` : 'auto'
}
