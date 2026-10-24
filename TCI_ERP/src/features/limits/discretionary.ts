/** Where a requested limit sits against the policy's discretionary limit (DL).
 *
 * The rule is the declarations' (`tci.classify_declaration_line`, 0026): a
 * buyer without a limit is covered up to the DL, EQUAL included, and a DL of
 * 0 is no DL at all. The request is in the policy's currency, as is the DL,
 * so nothing is converted. The note informs and never blocks: a named limit
 * within the DL is a legitimate request (certainty, a decision on record).
 */

export type DlPosition =
  /** The policy has no discretionary limit: every buyer needs a limit. */
  | { kind: 'none' }
  /** No amount typed yet: say what the DL is. */
  | { kind: 'known'; dl: number }
  | { kind: 'within'; dl: number }
  | { kind: 'above'; dl: number; excess: number }

export function dlPosition(amount: number | null, dl: number | null | undefined): DlPosition {
  if (dl == null || !Number.isFinite(dl) || dl <= 0) return { kind: 'none' }
  if (amount == null || !Number.isFinite(amount) || amount <= 0) return { kind: 'known', dl }
  if (amount <= dl) return { kind: 'within', dl }
  // Cent-exact: both sides are numeric(18,2).
  return { kind: 'above', dl, excess: Math.round((amount - dl) * 100) / 100 }
}
