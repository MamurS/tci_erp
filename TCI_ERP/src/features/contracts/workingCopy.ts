/**
 * The local working copy of a draft being edited: written on every change,
 * so closing the tab loses nothing, and NEVER a version — a version is made
 * only by an explicit save. Per draft and per person, in this browser only.
 * Every access is guarded: storage may be unavailable (private window,
 * blocked site data) and the editor must work without it.
 */

import type { ContractDoc } from './model'
import { isContractDoc } from './model'

export interface WorkingCopy {
  /** The version the edit started from. */
  baseVersionNo: number
  content: ContractDoc
  savedAt: string
}

export const workingCopyKey = (draftId: string, userId: string) => `tci-contract-wc:${draftId}:${userId}`

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

function storage(): StorageLike | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null
  } catch {
    return null
  }
}

export function readWorkingCopy(key: string, store: StorageLike | null = storage()): WorkingCopy | null {
  try {
    const raw = store?.getItem(key)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<WorkingCopy>
    if (typeof parsed.baseVersionNo !== 'number' || !isContractDoc(parsed.content) || typeof parsed.savedAt !== 'string') {
      return null
    }
    return parsed as WorkingCopy
  } catch {
    return null
  }
}

export function writeWorkingCopy(key: string, copy: WorkingCopy, store: StorageLike | null = storage()): boolean {
  try {
    store?.setItem(key, JSON.stringify(copy))
    return Boolean(store)
  } catch {
    return false
  }
}

export function clearWorkingCopy(key: string, store: StorageLike | null = storage()): void {
  try {
    store?.removeItem(key)
  } catch {
    // nothing to clear
  }
}
